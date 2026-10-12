param([string]$Python='python')
$ErrorActionPreference='Stop'
$resimRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$resimEnvironment=Join-Path $PSScriptRoot '.venv'
$resimPython=Join-Path $resimEnvironment 'Scripts\python.exe'
if(-not (Test-Path -LiteralPath $resimPython)) {
    & $Python -m venv $resimEnvironment
    if($LASTEXITCODE -ne 0){throw 'Python 3.13 虚拟环境创建失败。'}
}
& $resimPython -c "import sys; assert sys.version_info[:2] == (3,13), 'Resim requires Python 3.13'"
if($LASTEXITCODE -ne 0){throw '请使用 Python 3.13。'}
& $resimPython -m pip install -r (Join-Path $resimRoot 'src\backend\requirements-lock.txt')
if($LASTEXITCODE -ne 0){throw '安装锁定依赖失败。'}
Write-Output '开发环境已就绪。运行 src/tools/dev.ps1 启动源码版。'
