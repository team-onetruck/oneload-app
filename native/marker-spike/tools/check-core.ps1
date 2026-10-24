$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows C# 컴파일러가 없습니다. dotnet run --project CoreChecks/MarkerCoreChecks.csproj를 사용하세요.' }
$output = Join-Path $project 'CoreChecks/bin/MarkerCoreChecks.exe'
New-Item -ItemType Directory -Force (Split-Path -Parent $output) | Out-Null
& $compiler /nologo "/out:$output" (Join-Path $project 'Assets/Hangil/Core/MarkerMath.cs') (Join-Path $project 'CoreChecks/Program.cs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $output
exit $LASTEXITCODE
