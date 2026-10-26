param([string]$DeviceSerial)
$ErrorActionPreference = 'Stop'
$adb = (Get-Command adb -ErrorAction Stop).Source
$listing = & $adb devices
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$devices = @($listing | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
if (-not $DeviceSerial) {
  if ($devices.Count -ne 1) {
    Write-Output '인증된 단말 한 대가 필요합니다. USB 데이터 케이블 연결 → USB 디버깅 허용 → 폰의 RSA 인증 창 허용 후 다시 실행하세요.'
    Write-Output '여러 기기를 연결했으면 -DeviceSerial로 실험 단말을 지정하세요.'
    exit 2
  }
  $DeviceSerial = $devices[0]
}
if ($devices -notcontains $DeviceSerial) { throw '지정한 단말이 device 상태가 아닙니다. 잠금을 풀고 USB 디버깅 인증을 확인하세요.' }
function Read-Property([string]$Name) {
  $value = & $adb -s $DeviceSerial shell getprop $Name
  if ($LASTEXITCODE -ne 0) { throw "단말 정보 조회 실패: $Name" }
  return ($value -join '').Trim()
}
$model = Read-Property 'ro.product.model'
$android = Read-Property 'ro.build.version.release'
$api = Read-Property 'ro.build.version.sdk'
$abi = Read-Property 'ro.product.cpu.abi'
$arcore = & $adb -s $DeviceSerial shell pm path com.google.ar.core
if ($LASTEXITCODE -ne 0) { throw 'Google Play Services for AR 조회 실패' }
Write-Output "모델=$model / Android=$android / API=$api / ABI=$abi"
if ([int]$api -lt 24 -or $abi -notmatch 'arm64') { throw '현재 실험 APK의 API 24 이상·ARM64 조건을 만족하지 않습니다.' }
if (-not ($arcore -match '^package:')) { throw 'Google Play Services for AR 설치·업데이트 후 다시 확인하세요.' }
Write-Output 'ADB 연결·API·ABI·AR 서비스 설치 확인 완료. 카메라 권한·실제 AR 추적 동작은 앱에서 따로 확인해야 합니다.'
