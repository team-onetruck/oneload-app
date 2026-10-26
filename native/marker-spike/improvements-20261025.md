# Unity 화살표 실험: 개선 목적과 검증 기록

작성일: 2026-10-25. 대상: `native/marker-spike`.

## 왜 필요했으며 무엇을 위한 작업인가

웹의 카메라 방향 표시는 사용자가 어느 쪽을 보는지 알려 주지만, 바닥의 특정 위치에 놓인 화살표가 이동·회전 뒤에도 고정되는지는 검증하지 않는다. 이후 실내 AR 길안내로 연결하려면 기준 위치와 실제 공간의 좌표 관계, 추적을 잃었을 때의 표시 중단, 재정합 절차를 먼저 확인해야 한다.

이 실험은 벽의 인쇄 이미지와 직접 잰 높이·거리를 기준으로 AR 좌표를 맞추고 네이티브 앵커에 바닥 화살표 하나를 붙인다. **운영 길안내에 필요한 공간 정합의 최소 단위를 검증하기 위해** 만들었다. 서울역 전체 경로·서버 지도·자동 위치 추정을 연결한 제품은 아니다.

기존 화면은 영문 IMGUI 개발 패널이었다. 버튼이 비활성화돼도 측정값, 확인 체크, 그림 자세, 카메라, 공간 추적 중 무엇이 문제인지 알기 어려웠다. 예시 높이 1.20m를 실측값으로 오인하면 바닥 높이 자체가 잘못되어 정확도 측정도 의미가 없어진다. 이번 개선은 **처음 사용하는 팀원이 올바른 조건으로 반복 실험하고 실패를 복구할 수 있도록** 하는 데 목적이 있다.

## UX 변경과 목적

| 변경 | 필요한 이유 |
|---|---|
| 준비 → 벽 그림 찾기 → 바닥 표시와 비교의 3단계 | 다음 행동과 현재 상태를 알 수 있게 한다 |
| 한국어·영어 전환, 시작 불가 이유 표시 | 사용자가 막힌 원인을 직접 해결할 수 있게 한다 |
| 높이는 빈칸에서 시작, 숫자 키보드, 범위·소수점/쉼표 검사 | 예시 높이를 실제 값으로 사용하는 실수를 줄인다 |
| 입력 변경 시 실측 확인 해제 | 이전 값의 확인을 새 값에 잘못 재사용하지 않는다 |
| 실측 확인 후 입력을 접고 카메라 영역 확보 | 그림을 찾는 동안 측정 패널이 시야를 가리는 일을 줄인다 |
| 화면 안전 영역·스크롤·하단 고정 큰 버튼 | 노치·작은 화면에서도 안내를 읽고 재시도할 수 있게 한다 |
| 추적 유실·거리 초과·시간 만료·앵커 지연의 개별 복구 문구 | 오류 코드를 해석하지 않고 다시 시작할 수 있게 한다 |
| 앵커 생성 8초 대기 상한과 취소·재시도 | 응답이 돌아오지 않아 화면이 계속 잠기는 일을 막는다 |
| 측정용·실제 길안내 아님을 항상 표시 | 검증 전 화살표를 실제 통행 지시로 오인하지 않게 한다 |

30초·3m·8초는 실험 운영 한도이며 정확도 승인 기준은 아니다. 추적·앵커·카메라 공급·앱 중단 검사는 계속 매 프레임 실행하며 UI 갱신과 분리한다.

## 최적화한 부분과 확인 범위

| 변경 | 소스에서 확인한 변화 | 실측 전인 항목 |
|---|---|---|
| IMGUI → 유지형 uGUI | OnGUI 반복 레이아웃 제거. 상태 확인 최대 4Hz, 화면 내용은 상태·언어·초 표시가 바뀔 때 갱신 | CPU 시간·배터리·반응 속도 |
| 화살표 메시·재질 재사용 | 재정합마다 메시 생성·파괴 제거. 정상 재정합은 같은 오브젝트도 재사용. 앵커가 오브젝트를 파괴하면 같은 메시로 복구 | 반복 정합 시 GC·메모리 |
| 불필요한 Raycast 차단 | 텍스트·장식은 제외하고 버튼·입력·스크롤 영역만 터치 검색 | EventSystem CPU 비용 |
| 단일 이미지 추적, 그림자·HDR/MSAA 해제 | 단일 그림·단색 화살표 실험에 불필요한 렌더 설정 제거. AR 추적 프레임률을 강제로 낮추지 않음 | GPU 시간·발열 |
| 한글 글꼴 서브셋 | 필요한 문자만 정적 TTF에 포함. 시스템 한글 폰트에 의존하지 않음. OFL·출처·해시 보존 | 전체 APK 크기 |
| Profiler 구간 추가 | Hangil.Marker.Frame·Hangil.Marker.Hud로 추적 보호와 UI 비용 구분 | 측정값 자체 |

글꼴 크기는 `ThirdParty/font-source.json`의 실제 bytes·해시를 따른다. UI 문구 변경 시 `tools/subset-font.py`로 다시 만들며 CI가 오래된 문자 집합을 차단한다. FPS 개선률이나 발열 감소율은 측정하지 않아 수치 성과로 쓰지 않는다.

## 이번 검증

- Windows C# 컴파일러로 공통 로직 **54개 통과**: 좌표 변환, 취소 뒤 지연 결과, 추적·앵커 유실, 실험 한도, 측정 입력과 안내 상태.
- `tools/check-project.mjs`: 타깃·글꼴 SHA256, 패키지 고정, 글꼴 문자 집합, Unity GUID 검사.
- Unity 전체 C# 컴파일, 장면·터치, APK, 실제 기기 정확도·성능은 **미실행**. 이 PC에는 Unity Editor가 없다. 공통 C# 검사는 이를 대신하지 않는다.

## 설치 후 확인 순서

1. Unity Hub 로그인·라이선스 활성화 후 Unity 6.3 LTS와 Android Build Support/SDK/NDK/OpenJDK를 설치한다. 기준 버전은 6000.3.1f1이다. 여유 있는 드라이브를 선택한다.
2. 프로젝트를 열어 UPM 해결·전체 컴파일을 확인한다. Android ARCore Loader를 켜고 Project Validation을 통과시킨다.
3. 아래 배치 검증은 장면 생성과 APK 빌드를 실행한다. 로그인·설치·라이선스를 자동 승인하지 않는다.

```powershell
# native/marker-spike에서, 실제 설치 경로로 바꿔 실행
./tools/verify-unity.ps1 -EditorPath 'E:/Unity/6000.3.1f1/Editor/Unity.exe'
./tools/verify-unity.ps1 -EditorPath 'E:/Unity/6000.3.1f1/Editor/Unity.exe' -BuildAndroid
```

4. `field-checklist.md`의 한영 UI, 작은 화면·키보드·노치, 권한 거부/재허용, 앱 중단/복귀, 생성 중 취소를 확인한다.
5. 같은 폰·OS·AR 서비스·조명·거리에서 이전/개선 버전을 비교한다. 준비 정합 5회 뒤 30초 이동 확인을 3회 반복한다. CPU/GPU frame ms 중앙값·P95, Hangil.Marker.*, GC Allocated In Frame, 정합 대기 시간·메모리와 위치·방향 오차를 기록한다. Profiler 연결 조건은 동일하게 유지하고 실제 사용 빌드도 별도 확인한다.
6. 재정합 20회 후 앵커·메시 수와 메모리가 계속 증가하는지 확인한다. 앱 복귀·추적 복구 뒤 이전 화살표가 되살아나면 실패다. 이 결과 전에는 실제 AR 실행 완료로 병합하지 않는다.

## 공식 근거

- [AR Foundation 이미지 추적](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.3/manual/features/image-tracking/artrackedimagemanager.html)
- [AR Session 프레임률](https://docs.unity3d.com/Packages/com.unity.xr.arfoundation@6.3/api/UnityEngine.XR.ARFoundation.ARSession.html)
- [Unity UI 최적화](https://unity.com/how-to/unity-ui-optimization-tips)
- [uGUI 어셈블리](https://github.com/Unity-Technologies/uGUI/blob/main/com.unity.ugui/Runtime/UGUI/UnityEngine.UI.asmdef)
- [Unity 6.3 공식 샘플의 uGUI·입력 패키지 고정 버전](https://github.com/Unity-Technologies/arfoundation-samples/blob/6.3/Packages/manifest.json)
- [Noto Sans KR 원본·OFL](https://github.com/google/fonts/tree/main/ofl/notosanskr)
