param([int]$ExpectedProcessId, [int]$Port = 8770)
$ErrorActionPreference = 'Stop'
$resimRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path $PSScriptRoot -Parent) 'app'))
$resimTarget = Join-Path $resimRoot 'Resim.Engine.exe'
$resimStaged = Join-Path $resimRoot 'Resim.Engine.next.exe'
$resimEntry = Join-Path $resimRoot 'Resim.exe'
if (-not (Test-Path -LiteralPath $resimStaged)) { throw 'Missing tested staging engine.' }
$resimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedProcessId"
if (-not $resimProcess -or $resimProcess.ExecutablePath -notin @($resimEntry, $resimTarget)) { throw 'Unexpected process; nothing changed.' }
$resimListeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen)
$resimOwnsPort = $ExpectedProcessId -in $resimListeners.OwningProcess
if (-not $resimOwnsPort -and 4 -in $resimListeners.OwningProcess -and $resimProcess.ExecutablePath -eq $resimEntry) {
    . (Join-Path $PSScriptRoot 'http-listener.ps1')
    $resimQueues = netsh http show servicestate view=requestq verbose=yes | Out-String
    if ($LASTEXITCODE -eq 0) { $resimOwnsPort = Test-ResimHttpQueueOwner $resimQueues $ExpectedProcessId $Port }
}
if (-not $resimOwnsPort) { throw 'The expected process does not own the requested port; no update performed.' }
$resimHealth = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
$resimProjects = [IO.Path]::GetFullPath($resimHealth.projects_dir)
$resimBackup = Join-Path ([IO.Path]::GetTempPath()) ('resim-engine-backup-' + [guid]::NewGuid().ToString('N') + '.bin')
Copy-Item -LiteralPath $resimTarget -Destination $resimBackup
function Copy-ResimEngine([string]$Source) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try { Copy-Item -LiteralPath $Source -Destination $resimTarget -Force; return }
        catch { if ($attempt -eq 39) { throw }; Start-Sleep -Milliseconds 200 }
    }
}
function Start-ResimHost {
    Start-Process -FilePath $resimEntry -ArgumentList @('serve','--port',"$Port",'--projects-dir',('"' + $resimProjects + '"')) -WorkingDirectory $resimRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "resim-host-$Port.stdout.log") -RedirectStandardError (Join-Path $env:TEMP "resim-host-$Port.stderr.log")
}
try {
    Stop-Process -Id $ExpectedProcessId
    Wait-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue
    Copy-ResimEngine $resimStaged
    $resimStarted = Start-ResimHost
    $resimReady = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        try { $resimResponse = Invoke-RestMethod "http://127.0.0.1:$Port/api/output-folders" -Headers @{'X-Resim-Local'='1'} -TimeoutSec 1; $resimReady = $true; break }
        catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $resimReady) { throw 'Updated service did not become ready.' }
    @{ pid = $resimStarted.Id; projects = $resimResponse.path; status = 'ready'; engine = (Get-FileHash -LiteralPath $resimTarget -Algorithm SHA256).Hash } | ConvertTo-Json -Compress
} catch {
    if ($resimStarted) { Stop-Process -Id $resimStarted.Id -ErrorAction SilentlyContinue }
    Copy-ResimEngine $resimBackup
    Start-ResimHost | Out-Null
    throw
} finally {
    if (Test-Path -LiteralPath $resimBackup) { Remove-Item -LiteralPath $resimBackup }
}
