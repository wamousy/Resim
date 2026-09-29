param(
    [Parameter(Mandatory=$true)][string]$Application,
    [Parameter(Mandatory=$true)][string]$Verification,
    [int]$ExpectedProcessId=0,
    [int]$Port=8770,
    [string]$ProjectsDir
)
$ErrorActionPreference='Stop'
$resimRoot=[IO.Path]::GetFullPath((Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$resimBuild=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '.build'))
$resimSource=(Resolve-Path -LiteralPath $Application).Path
$resimApp=Join-Path $resimRoot 'app'
$resimEntry=Join-Path $resimApp 'Resim.exe'
function Assert-ResimChild([string]$Path,[string]$Parent) {
    if(-not [IO.Path]::GetFullPath($Path).StartsWith($Parent.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the expected workspace: $Path"
    }
}
Assert-ResimChild $resimSource $resimBuild
Assert-ResimChild $resimApp $resimRoot
if($Port -lt 1 -or $Port -gt 65535){throw 'Invalid port.'}
# Reparse points could move a file operation outside the verified workspace.
$resimNodes=@(Get-Item -LiteralPath $resimSource)+@(Get-ChildItem -LiteralPath $resimSource -Recurse -Force)
if($resimNodes | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }){throw 'Staging application contains a reparse point.'}
$resimEvidence=Get-Content -LiteralPath $Verification -Raw | ConvertFrom-Json
if(-not $resimEvidence.passed -or $resimEvidence.application -ne $resimSource){throw 'A passing verification for this exact staging application is required.'}
$resimManifest=Get-Content -LiteralPath (Join-Path $resimSource 'build-manifest.json') -Raw | ConvertFrom-Json
foreach($resimProperty in $resimManifest.files.PSObject.Properties) {
    $resimFile=[IO.Path]::GetFullPath((Join-Path $resimRoot $resimProperty.Name))
    Assert-ResimChild $resimFile $resimRoot
    if((Get-FileHash -LiteralPath $resimFile -Algorithm SHA256).Hash -ne $resimProperty.Value){throw "Source changed after build: $resimFile"}
}
foreach($resimName in @('Resim.exe','Resim.Engine.exe')) {
    $resimFile=Join-Path $resimSource $resimName
    $resimKey=$resimFile.Substring($resimRoot.Length+1)
    $resimExpected=$resimEvidence.files.PSObject.Properties | Where-Object { $_.Name.Replace('/','\') -eq $resimKey }
    if(-not $resimExpected -or (Get-FileHash -LiteralPath $resimFile -Algorithm SHA256).Hash -ne $resimExpected.Value){throw "Untested executable: $resimFile"}
}
$resimOldProcess=$null
if($ExpectedProcessId) {
    $resimOldProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedProcessId"
    if(-not $resimOldProcess -or $resimOldProcess.ExecutablePath -ne $resimEntry){throw 'Unexpected host process; nothing changed.'}
    $resimListeners=@(Get-NetTCPConnection -LocalPort $Port -State Listen)
    $resimOwnsPort=$ExpectedProcessId -in $resimListeners.OwningProcess
    if(-not $resimOwnsPort -and 4 -in $resimListeners.OwningProcess) {
        . (Join-Path $PSScriptRoot 'http-listener.ps1')
        $resimQueues=netsh http show servicestate view=requestq verbose=yes | Out-String
        $resimOwnsPort=$LASTEXITCODE -eq 0 -and (Test-ResimHttpQueueOwner $resimQueues $ExpectedProcessId $Port)
    }
    if(-not $resimOwnsPort){throw 'Host does not own the requested port; nothing changed.'}
    $resimHealth=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
    if($ProjectsDir -and [IO.Path]::GetFullPath($ProjectsDir) -ne [IO.Path]::GetFullPath($resimHealth.projects_dir)){throw 'Project directory differs from the running service.'}
    $ProjectsDir=$resimHealth.projects_dir
} else {
    if(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $resimEntry }){throw 'Specify ExpectedProcessId for the running application.'}
    if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue){throw 'Port already in use; nothing changed.'}
}
if(-not $ProjectsDir){$ProjectsDir=Join-Path $resimRoot '..\ResimProjects'}
$ProjectsDir=[IO.Path]::GetFullPath($ProjectsDir)
$resimStamp=[DateTime]::Now.ToString('yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$resimBackup=Join-Path $resimBuild ('previous-app-'+$resimStamp)
$resimPrepared=Join-Path $resimBuild ('prepared-app-'+$resimStamp)
$resimFailed=Join-Path $resimBuild ('failed-app-'+$resimStamp)
foreach($resimPath in @($resimBackup,$resimPrepared,$resimFailed)){Assert-ResimChild $resimPath $resimBuild}
Copy-Item -LiteralPath $resimSource -Destination $resimPrepared -Recurse
# Confirm the complete copy before stopping the current service.
foreach($resimFile in Get-ChildItem -LiteralPath $resimSource -File -Recurse) {
    $resimCopy=Join-Path $resimPrepared $resimFile.FullName.Substring($resimSource.Length+1)
    if((Get-FileHash -LiteralPath $resimFile.FullName).Hash -ne (Get-FileHash -LiteralPath $resimCopy).Hash){throw 'Application copy failed verification.'}
}
function Start-ResimPublished {
    Start-Process -FilePath $resimEntry -ArgumentList @('serve','--port',"$Port",'--projects-dir',('"'+$ProjectsDir+'"')) -WorkingDirectory $resimApp -WindowStyle Hidden -PassThru
}
$resimStarted=$null
$resimMovedOld=$false
$resimInstalled=$false
try {
    if($resimOldProcess){Stop-Process -Id $ExpectedProcessId; Wait-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue}
    if(Test-Path -LiteralPath $resimApp) {
        for($attempt=0;$attempt -lt 30;$attempt++) {
            try {Move-Item -LiteralPath $resimApp -Destination $resimBackup; $resimMovedOld=$true; break}
            catch {if($attempt -eq 29){throw}; Start-Sleep -Milliseconds 200}
        }
    }
    Move-Item -LiteralPath $resimPrepared -Destination $resimApp
    $resimInstalled=$true
    $resimStarted=Start-ResimPublished
    $resimReady=$false
    for($attempt=0;$attempt -lt 40;$attempt++) {
        if($resimStarted.HasExited){throw 'Published host exited during startup.'}
        try {
            $resimHealth=Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 1
            $null=Invoke-RestMethod "http://127.0.0.1:$Port/api/output-folders" -Headers @{'X-Resim-Local'='1'} -TimeoutSec 1
            if([IO.Path]::GetFullPath($resimHealth.projects_dir) -ne $ProjectsDir){throw 'Unexpected project directory.'}
            $resimReady=$true; break
        } catch {Start-Sleep -Milliseconds 200}
    }
    if(-not $resimReady){throw 'Published service did not become ready.'}
    @{status='ready';pid=$resimStarted.Id;application=$resimApp;projects=$ProjectsDir;backup=$resimBackup} | ConvertTo-Json
} catch {
    if($resimStarted -and -not $resimStarted.HasExited){Stop-Process -Id $resimStarted.Id; Wait-Process -Id $resimStarted.Id -ErrorAction SilentlyContinue}
    if($resimInstalled){Move-Item -LiteralPath $resimApp -Destination $resimFailed}
    if($resimMovedOld){Move-Item -LiteralPath $resimBackup -Destination $resimApp}
    if($resimOldProcess -and (Test-Path -LiteralPath $resimEntry)){Start-ResimPublished | Out-Null}
    throw
}
