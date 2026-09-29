param([int]$Port=8771,[string]$ProjectsDir,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$resimRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$resimPython=Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if(-not (Test-Path -LiteralPath $resimPython)){throw '请先运行 src/tools/setup-dev.ps1。'}
if(-not $ProjectsDir){$ProjectsDir=[IO.Path]::GetFullPath((Join-Path $resimRoot '..\ResimProjects'))}
$resimBuild=Join-Path $PSScriptRoot '.build\dev'
New-Item -ItemType Directory -Force -Path $resimBuild | Out-Null
$resimHost=Join-Path $resimBuild 'Resim.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll "/out:$resimHost" (Join-Path $resimRoot 'src\backend\desktop\ResimHost.cs')
if($LASTEXITCODE -ne 0){throw 'Windows 入口编译失败。请先关闭已有源码服务再重试。'}
$resimOldPython=$env:RESIM_ENGINE_PYTHON
$resimOldScript=$env:RESIM_ENGINE_SCRIPT
try {
    $env:RESIM_ENGINE_PYTHON=$resimPython
    $env:RESIM_ENGINE_SCRIPT=Join-Path $resimRoot 'src\backend\entry.py'
    $resimArgs=@('serve','--port',"$Port",'--projects-dir',$ProjectsDir)
    if(-not $NoBrowser){$resimArgs+='--open-browser'}
    & $resimHost @resimArgs
    $resimExit=$LASTEXITCODE
} finally {
    $env:RESIM_ENGINE_PYTHON=$resimOldPython
    $env:RESIM_ENGINE_SCRIPT=$resimOldScript
}
exit $resimExit
