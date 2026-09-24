param([int]$ExpectedProcessId, [int]$Port = 8770)
$ErrorActionPreference = 'Stop'
$resimRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$resimTarget = Join-Path $resimRoot 'Resim.exe'
$resimStaged = Join-Path $resimRoot 'Resim.Host.test.exe'
$resimProjects = [IO.Path]::GetFullPath((Join-Path $resimRoot '..\ResimProjects'))
if (-not (Test-Path -LiteralPath $resimStaged) -or -not (Test-Path -LiteralPath (Join-Path $resimRoot 'Resim.Engine.exe'))) { throw '缺少已编译入口或计算引擎。' }
$resimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ExpectedProcessId"
if (-not $resimProcess -or $resimProcess.ExecutablePath -ne $resimTarget -or $resimProcess.CommandLine -notmatch "serve --port $Port(?:\s|$)") { throw '当前进程与预期不符，未进行替换。' }
$resimBackup = Join-Path ([IO.Path]::GetTempPath()) ('resim-host-backup-' + [guid]::NewGuid().ToString('N') + '.bin')
Copy-Item -LiteralPath $resimTarget -Destination $resimBackup
function Copy-ResimEntry([string]$Source) {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { Copy-Item -LiteralPath $Source -Destination $resimTarget -Force; return }
        catch { if ($attempt -eq 29) { throw }; Start-Sleep -Milliseconds 200 }
    }
}
function Start-ResimEntry {
    Start-Process -FilePath $resimTarget -ArgumentList @('serve','--port',"$Port",'--projects-dir',('"' + $resimProjects + '"')) -WorkingDirectory $resimRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $env:TEMP "resim-host-$Port.stdout.log") -RedirectStandardError (Join-Path $env:TEMP "resim-host-$Port.stderr.log")
}
try {
    Stop-Process -Id $ExpectedProcessId
    Wait-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue
    Copy-ResimEntry $resimStaged
    $resimStarted = Start-ResimEntry
    $resimReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try { $resimResponse = Invoke-RestMethod "http://127.0.0.1:$Port/api/output-folders" -Headers @{'X-Resim-Local'='1'} -TimeoutSec 1; $resimReady = $true; break }
        catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $resimReady) { throw '新入口未能就绪。' }
    @{ pid = $resimStarted.Id; projects = $resimResponse.path; status = 'ready' } | ConvertTo-Json -Compress
} catch {
    if ($resimStarted) { Stop-Process -Id $resimStarted.Id -ErrorAction SilentlyContinue }
    Copy-ResimEntry $resimBackup
    Start-ResimEntry | Out-Null
    throw
} finally {
    # Only the backup file allocated above is removed; project folders are untouched.
    if (Test-Path -LiteralPath $resimBackup) { Remove-Item -LiteralPath $resimBackup }
}
