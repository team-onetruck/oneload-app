# 갤럭시 S24+에서 마커 하나·바닥 화살표 하나

2026-10-25 UX·최적화 개선: [목적·변경 내용·검증 결과와 설치 후 측정 순서](improvements-20261025.md).

사용자가 Unity + AR Foundation을 선택한 뒤 준비한 독립 **측정용 소스 프로젝트**다. 기존 React 웹을 교체하지 않으며 백엔드·Agent를 호출하지 않는다. 2026-10-26 macOS의 Unity `6000.3.1f1`에서 **Unity C# 컴파일, 장면 생성, APK 빌드를 배치 모드로 통과**했고, 사용자가 Galaxy S24+에서 마커 인식과 화살표 동작을 확인했다. 정합 오차·성능 수치는 아직 측정하지 않았다([기기 검증 기록](field-checklist.md)). C# 공통 수학·수명 검사는 Unity 없이도 실제 컴파일해 실행한다.

## 사용자가 준비할 것

| 준비물 | 할 일 |
| --- | --- |
| 갤럭시 S24+ | OS 버전을 기록하고 Google Play Services for AR을 업데이트한다. 공식 ARCore 지원 모델이지만 설치 상태·기기 정책·실제 추적은 별도 확인한다 |
| USB 데이터 케이블 | PC 연결 후 개발자 옵션의 USB 디버깅을 켜고 폰에 뜨는 이 PC의 RSA 인증을 허용한다. 충전 전용 케이블은 사용할 수 없다 |
| Unity Hub·Editor | Unity **6.3 LTS**와 **Android Build Support**, 그 하위 **Android SDK & NDK Tools·OpenJDK**를 설치한다. 기존 PC의 Java 17·Android CLI를 Unity 빌드 도구로 대신하지 않는다 |
| 인쇄물·줄자·테이프 | `print-target.html`을 A4·100%·페이지 맞춤 해제로 무광 인쇄한다. 이미지 자체 가로 **18.0 cm**, 검산선 **10.0 cm**를 실제로 확인한다 |
| 실험 공간 | 밝고 평평하며 바닥에 무늬가 있는 방이나 짧은 통로. 마커를 수직 벽에 평평하게 고정하고, 바닥의 목표점·독립 확인점을 줄자로 표시한다 |

레이저 거리계, LiDAR 폰, 클라우드 앵커, 유료 AI API 키는 필요 없다. Android 첫 실험에는 Mac이 필요 없다. 이후 iPhone 빌드에는 Mac·Xcode·서명과 별도 기기 검증이 필요하다.

## 기준 버전과 타깃

- Editor 파일은 Unity 공식 AR Foundation Samples의 6.3 브랜치와 같은 `6000.3.1f1`을 기준으로 준비했다. Hub의 다른 6.3 LTS 패치를 사용하면 실제 Editor 버전을 검증 기록에 남긴다.
- AR Foundation·ARCore XR Plugin·ARKit XR Plugin은 `6.3.5`로 맞췄다. `Packages/packages-lock.json`에 Editor가 해결한 의존성 전체를 고정했다.
- Android: ARM64·IL2CPP·OpenGLES3·최소 API 25(Unity 6.3의 최소 지원 버전)·Development Build. 타깃 SDK는 Editor 자동 선택이며 실제 S24+ OS/API는 연결 후 기록한다. 스토어 출시 설정이 아니다.
- 기준 이미지는 Google ARCore SDK의 `default.jpg` 원본이다. 등록한 그림을 찾는 **이미지 추적**이며 QR 해독·AprilTag 검출이 아니다. 전체 출처·라이선스를 `ThirdParty/`에 보존했다.
- 공식 `arcoreimg eval-img` 결과 **100**. 이미지 특징점 평가일 뿐 실제 인식 성공률·정합 정확도 승인값이 아니다.

## 처음 여는 순서

1. Unity Hub에서 이 폴더(`Packages`·`Assets`·`ProjectSettings`가 있는 `native/marker-spike`)를 프로젝트로 추가하고 연다. 패키지 설치·스크립트 컴파일이 끝날 때까지 기다린다. 오류가 있으면 먼저 해결하며 APK 성공으로 간주하지 않는다.
2. **Player → Other Settings → Active Input Handling**은 Both로 저장돼 있다. 입력 시스템 전환 질문이 나오면 허용하고 Editor를 재시작한다.
3. **File → Build Profiles → Android → Switch Platform**을 선택한다.
4. **Project Settings → XR Plug-in Management → Android**의 ARCore와 Initialize XR on Startup은 켜진 상태로 저장돼 있다(`Assets/XR/`). **XR Plug-in Management → Project Validation**에 Android 오류가 없는지 확인한다.
5. **Hangil → Create Marker Experiment Scene**을 누른다. AR Session·XR Origin·카메라·기준 이미지 라이브러리·앵커 매니저·실험 UI가 생성된다. 생성물은 `Assets/Hangil/Generated/`이며 재생성 가능하다. 수정한 장면이 있으면 먼저 저장한다.
6. Play Mode는 물리 공간 검증을 대신하지 않는다. USB로 폰을 연결하고 아래 연결 점검을 실행한 뒤 **Hangil → Build Android APK**를 누른다.

```powershell
# 이 폴더에서 실행. 읽기만 하며 설치·설정 변경은 하지 않는다.
powershell -NoProfile -ExecutionPolicy Bypass -File tools/android-preflight.ps1

# 빌드 성공 후에만 사용한다. 폰에서 카메라 권한을 허용한다.
adb install -r Builds/HangilMarkerLab.apk
# 설치 후 폰에서 Hangil Marker Lab 아이콘을 누른다.
```

## 실제 측정 순서

1. 마커의 `↑ 이쪽이 위`가 위를 향하게 붙인다. 바닥부터 **그림 중심**까지의 높이를 줄자로 측정한다. 제목·종이 위쪽 높이가 아니다.
2. 마커 바로 아래 바닥점에서 벽 바깥 방향으로 **1 m**를 재어 화살표 중심 목표점을 표시한다. 독립 검증점도 옆에 따로 표시한다. 초기 지도는 이 벽/바닥을 기준으로 한 로컬 미터 좌표이며 서울역 지도나 자북 정합을 뜻하지 않는다.
3. 앱을 켜고 주변 바닥·벽을 천천히 비춰 공간 추적을 시작한다. 인쇄물 전체가 충분히 보이게 마커를 비춘다. 어둡거나 반사되거나 너무 작게 보이면 인식을 다시 시도한다.
4. 실측 마커 중심 높이와 목표 거리(기본 1m)를 입력한다. 높이는 빈칸에서 시작한다. 그림 너비 18cm와 거리를 직접 재고 확인을 체크한다. 그림을 찾았다는 안내가 나오면 **화살표 표시하기 / Show test arrow**를 누른다. 입력 변경 시 확인이 해제되며 소수점 쉼표 키보드도 지원한다. 상단에서 한국어·영어를 바꿀 수 있다.
5. 네이티브 `TryAddAnchorAsync` 성공과 정상 앵커 추적 후에만 화살표를 표시한다. 카메라를 옮기고 마커를 시야 밖으로 돌려도 화살표 중심이 바닥 테이프 근처에 유지되는지 확인한다.
6. 가상 화살표와 실제 테이프 사이의 위치·방향 오차를 실측해 기록한다. 줄자로 표시한 독립 검증점, 카메라의 보기 방향·위치, 이동 전후를 함께 비교한다. 화면의 한 시점 스크린샷만으로 3D 오차를 확정하지 않는다.
7. 마커 가림·카메라 가림·앱 백그라운드 이동·재실행을 시험한다. 추적·앵커 유실, 앱 중단, 카메라 공급 중단 시 즉시 숨기고 새 정합을 요구해야 한다. 마커를 다시 비춘 뒤 수동으로 정합한다.

실험 종료 한도는 **30초 또는 3 m**다. 운영 품질 기준이나 드리프트 허용치가 아니며, 넘으면 새로 정합한다. 계단·층 전환·자동 재탐색·도착 판정은 포함하지 않는다. 마커를 옮기거나 종이가 휘면 측정을 다시 한다. 이미지를 볼 수 없더라도 세션·앵커 추적이 유지되면 한도 내에서 표시하므로, 실제 벽 고정 마커를 움직이지 않는 조건이 필요하다.

## 구현 내용과 아직 확인하지 못한 것

`MarkerMath`는 지도→AR yaw/이동과 현재 위치 역변환을 계산한다. 실험 지도 원점은 마커 바로 아래 바닥, 마커의 지도 포즈는 `(0, 실측 높이, 0)`이고 +z는 벽 바깥 방향이다. `MarkerSpike`는 Unity가 정규화한 추적 이미지의 +y 법선과 +z 인쇄물 위쪽을 사용한다. 원시 ARCore/AprilTag 포즈를 직접 사용하지 않는다.

SDK 이미지 포즈로 구한 지도 루트를 네이티브 앵커의 자식으로 유지한다. 앵커 생성 응답이 취소·세션 변경 뒤에 오면 제거하며, 월드 변환을 이중 적용하지 않는다. XR Origin은 이동·회전·스케일 변경 없는 Device 모드와 카메라 높이 오프셋 0으로 제한한다. 생성한 장면의 이 조건이 달라지면 정합을 금지한다.

고주파 추적·렌더는 기기 안에서 처리한다. 카메라 `frameReceived`는 공급 중단 감시용이며 **촬영 영상과 검출 포즈의 정확한 타임스탬프 동기화 증거가 아니다**. 이 실험에는 사진 업로드가 없다. 향후 비전 입력을 연결할 때는 실제 원본 프레임·포즈 동기화 경계를 별도로 구현해야 한다.

이번 코드는 전체 TS 기반 보호 로직의 C# 이식이 아니다. 운영 `map_version/floor_id/route_revision` 결합, 서버 정합 저장, 현재 지도 좌표 출발, 보행 가능한 통로 연결, 품질 승인 정책과 2D 대체는 기존 웹/서버 계약과 함께 후속 통합한다. 실험 화면은 정확도 미검증 상태를 항상 표시한다.

## 검증 명령·기록

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/check-core.ps1
node tools/check-project.mjs
# .NET 8 SDK 환경/CI의 동일 공통 로직 검사
dotnet run --project CoreChecks/MarkerCoreChecks.csproj
```

현재 확인: C# 공통 로직 실제 컴파일·실행 **54개 통과**, 타깃·UI 글꼴 SHA256·패키지 버전·문자 집합·Unity GUID 검사, 공식 이미지 특징점 점수 100. `marker-core` CI는 공통 로직만 검사한다. Unity 배치 검증(UPM 해결, 런타임/Editor 어셈블리 컴파일, 장면 생성, APK 빌드)은 Unity가 설치된 PC에서 아래처럼 실행한다. 저장소의 설정만으로 동작하며 Editor에서 수동으로 바꿀 것이 없다. **실제 앵커 유지와 정확도는 미측정**이다.

```bash
# macOS (PowerShell 7: brew install powershell)
pwsh -NoProfile -File tools/verify-unity.ps1 -EditorPath /Applications/Unity/Hub/Editor/6000.3.1f1/Unity.app/Contents/MacOS/Unity
pwsh -NoProfile -File tools/verify-unity.ps1 -EditorPath /Applications/Unity/Hub/Editor/6000.3.1f1/Unity.app/Contents/MacOS/Unity -BuildAndroid
```

Unity 6 Personal 라이선스는 검증하는 그 PC의 Unity Hub에서 로그인하고 활성화해야 한다. 활성화가 안 된 상태면 `No valid Unity Editor license found`(exit 198)로 끝난다.

현장 결과는 `field-checklist.md`에 단말/OS·Editor/패키지 버전·인쇄 크기·설치 높이·조명·거리·오차·추적 중단 결과와 실패 원인을 기록한다. 수치가 없으면 미측정으로 남긴다.

공식 근거: [S24+ 지원](https://developers.google.com/ar/devices), [기준 이미지 추적](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.3/manual/features/image-tracking/artrackedimagemanager.html), [이미지 좌표축](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.3/manual/xr-simulation/simulation-environments.html), [앵커 생성](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.3/manual/features/anchors/aranchormanager.html), [이미지 선택·품질 도구](https://developers.google.com/ar/develop/augmented-images).
