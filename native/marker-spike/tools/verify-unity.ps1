param(
    [Parameter(Mandatory = $true)][string]$EditorPath,
    [switch]$BuildAndroid
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $EditorPath -PathType Leaf)) { throw 'Unity 실행 파일 경로가 올바르지 않습니다. (Windows: Editor/Unity.exe, macOS: Unity.app/Contents/MacOS/Unity)' }
$logs = Join-Path $project 'Logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$method = if ($BuildAndroid) { 'Hangil.MarkerSpike.Editor.MarkerSpikeBuilder.BuildAndroid' } else { 'Hangil.MarkerSpike.Editor.MarkerSpikeBuilder.CreateScene' }
$log = Join-Path $logs 'batch-verification.log'
# Unity Hub 로그인·라이선스 활성화와 Android 모듈 설치는 사용자가 먼저 완료해야 한다.
& $EditorPath -batchmode -nographics -quit -projectPath $project -buildTarget Android -executeMethod $method -logFile $log
if ($LASTEXITCODE -ne 0) { throw "Unity 검증 실패(exit $LASTEXITCODE). 로그: $log" }
if (-not (Test-Path -LiteralPath (Join-Path $project 'Assets/Hangil/Generated/MarkerSpike.unity'))) {
    throw "Unity가 장면을 생성하지 않았습니다. 로그: $log"
}
if ($BuildAndroid -and -not (Test-Path -LiteralPath (Join-Path $project 'Builds/HangilMarkerLab.apk'))) {
    throw "APK가 생성되지 않았습니다. 로그: $log"
}
Write-Output "Unity 배치 검증 완료. 기기 설치·화면·성능 검증은 별도입니다. 로그: $log"
