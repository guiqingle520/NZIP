param([ValidateSet('NZIP','NZIPPaid','NZIPPaidPreview')][string]$Product='NZIP')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=if($Product -eq 'NZIP'){(Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version}else{'0.8.0'}
$work=Join-Path $root ('.cache/shell-tests/'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$test=Join-Path $work 'ShellTests.exe'
& (Join-Path $PSScriptRoot 'build-shell.ps1') -Test -Product $Product -Output $test
if($LASTEXITCODE -ne 0){throw 'Shell test compilation failed'}
& $test (Join-Path $root ('dist/'+$Product+'-'+$version+'-win-x64/NzipShell.dll')) (Join-Path $work 'selection')
if($LASTEXITCODE -ne 0){throw 'Native shell checks failed'}
