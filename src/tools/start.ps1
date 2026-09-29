param([int]$Port=8770,[string]$ProjectsDir,[switch]$OpenBrowser,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$resimRepository=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $ProjectsDir) { $ProjectsDir=[IO.Path]::GetFullPath((Join-Path $resimRepository '..\ResimProjects')) }
$resimArguments=@('serve','--port',"$Port",'--projects-dir',$ProjectsDir)
if (-not $NoBrowser) { $resimArguments+='--open-browser' }
& (Join-Path $resimRepository 'app\Resim.exe') @resimArguments
exit $LASTEXITCODE
