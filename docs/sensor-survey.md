<!--
Date: 2026-10-25
Author: Jung Minkyu
Purpose: 브라우저 방향 센서 답사 도구의 접속·측정·내보내기·검증과 실기기 확인 범위를 설명한다
-->

# 서울역 방향 센서 답사

앱과 같은 origin의 `/survey/sensors`를 열면 답사 전용 기록 화면이 나온다. 서비스 메뉴·데모 모드를 추가하지 않으며 백엔드 세션·지도·AI API를 호출하지 않는다. 이 주소를 팀원에게 공유해서 사용한다. 배포 환경에는 이 브랜치가 배포된 이후 적용된다.

## 측정 절차

1. 실제 iPhone Safari 또는 Android Chrome에서 HTTPS 주소를 연다. 개발 PC의 localhost는 시험할 수 있지만 휴대폰에서 PC의 HTTP IP 주소로 열면 보안 컨텍스트가 아니므로 센서가 차단될 수 있다.
2. 답사 ID·담당자·기기 ID·기종·OS·브라우저·버전과 지점 ID·이름·층·서 있는 위치를 입력한다. 모델·버전을 UA만으로 단정하지 않으며 실제 기기 설정에서 확인한다.
3. 자세 A(세로로 들고 후면 카메라 정면) 또는 B(화면을 위로 향해 수평), 반복 회차, 기록 시간을 고른다. 기본 10초, 범위 1~120초다.
4. 독립 기준 방향을 모르면 숫자를 비운다. 알고 있으면 0 이상 360 미만의 각도, 진북/자북/도면축, 조준 대상과 출처를 함께 입력한다. 시험 폰의 나침반을 정답으로 쓰지 않는다.
5. '권한 요청하고 기록 시작'을 직접 누른다. iOS의 requestPermission은 사용자 동작 안에서 호출한다. 지원하는 브라우저에는 절대 방향 요청 인자를 전달하고, 권한 API가 없는 Android 환경은 이벤트 구독으로 진행한다.
6. 같은 위치·자세에서 같은 대상을 바라본다. 설정 시간 후 자동 종료하거나 '기록 중지'를 누른다. 완료·권한 거절·중단 모두 회차가 남으며 입력 회차는 하나 증가한다.
7. 'JSON 다운로드'를 누른다. Safari가 미리보기를 열면 공유 → 파일에 저장한다. 기존 파일을 덮어쓰지 않도록 파일명에 답사 ID와 시각을 넣는다.

## 기록 내용과 의미

`deviceorientation`와 `deviceorientationabsolute`를 모두 받아 필터링·평균·중복 제거 없이 수신 순서대로 저장한다. 이벤트 시각은 실제 수집 시작 시점의 performance.now 기준 elapsed_ms이며 started_at에는 UTC ISO 시각을 저장한다. 브라우저가 제공하는 방향 이벤트는 센서 융합 결과이며 하드웨어 자이로의 원시 전압·원시 IMU 값은 아니다.

- 원본: alpha/beta/gamma, absolute, webkitCompassHeading/Accuracy, 이벤트 종류.
- 상황: 지점, 기기, 자세, 회차, 화면 회전각, 담당자, 특이사항, UA.
- 결과: readings(이벤트 수신), denied(권한 거절), unsupported(API 미지원·이벤트 미수신·보안 컨텍스트 아님), error(중단·시작 오류).
- 후면 방위: 세로 자세의 절대 Euler 이벤트이고 iOS 나침반 확장이 없을 때 기존 compassHeading 기하식을 사용한다. 상대 이벤트·수평 자세·수직에 가까운 광축·iOS 나침반 값에서는 null로 보존한다. 이 값은 현장 정확도 검증 결과가 아니다.

iOS webkitCompassHeading는 자북 값으로 표시하고, 음수 방위·음수 정확도 등 무효 표시도 원본 그대로 남긴다. NaN/Infinity와 제공되지 않은 값만 JSON null로 바꾼다. Android의 absolute 이벤트를 자동으로 진북이라고 지정하지 않으며 sensor_reference는 implementation_defined로 남긴다. 자북·진북 변환이나 지점별 보정을 자동 적용하지 않는다.

모든 값이 null인 이벤트도 원본으로 저장될 수 있다. readings는 이벤트를 수신했다는 의미이며 방위가 유효하거나 정확하다는 뜻이 아니다. notes에 가공 방위가 없다는 사실을 남긴다.

## 중단·복구

- 측정 중 메타데이터 편집과 다운로드를 막아 서로 다른 조건의 이벤트가 한 회차에 섞이지 않게 한다.
- 화면 회전·브라우저 숨김·pagehide·기록 화면 종료 시 받은 샘플을 남기고 error로 마무리한다. 브라우저를 다시 열고 새 회차를 시작한다. 방향 이벤트 최대 30,000개에 도달해도 명시적으로 중단한다.
- 1초 간격과 시작·종료 시점에 localStorage에 저장한다. 새로고침 후 기록과 입력을 복구한다. 강제 종료 직전 최대 약 1초의 이벤트는 저장되지 않을 수 있고, 미완료 회차는 error와 미완료 notes로 남는다.
- 저장공간 부족·저장소 접근 제한은 화면에 알린다. 기록은 메모리에 유지되며 직접 다운로드할 수 있다. localStorage는 백업이 아니므로 매 지점 다운로드한다.
- 권한 창 대기 중 취소하면 늦게 온 허용 응답으로 기록이 다시 시작되지 않는다.

## 수집 스키마와 이전 답사 결합

`src/features/survey/survey.schema.json`과 `survey.template.json`은 앞서 작성한 survey-kit의 1.0.0 계약 사본이다. 별도 저장소 배포에서도 검증하도록 앱 안에 포함했다. 계약을 바꿀 때 두 사본을 함께 검토한다.

다운로드 직전에 Ajv Draft 2020-12와 날짜 형식을 검증한다. 출처·지점·기기·층·compass_trials를 포함한 전체 수집 manifest를 내보낸다. 좌표·층 높이·북쪽을 지어내지 않으므로 미측정 값은 null/unresolved로 남는다. 센서 기록 파일을 운영 지도 JSON으로 직접 로딩하지 않는다.

'기존 JSON 불러오기'로 field manifest를 불러오면 지도·사진 등 기존 배열을 유지하며 센서 시험을 추가한다. 스키마 오류·예시/템플릿·알 수 없는 센서 지점/기기 참조·중복 ID는 거부한다. 같은 기기 ID의 기종·OS·브라우저 정보를 바꿀 때는 새 ID를 사용한다. 같은 지점 ID의 층·이름·서 있는 위치도 일치해야 한다.

## 검증 범위

```sh
pnpm verify
pnpm exec playwright test --config playwright.survey.config.ts
pnpm build
```

독립 E2E 설정은 포트 4185를 사용한다. 기본 CI의 http 프로젝트도 scenarios/sensor-survey.spec.ts를 실행한다. 합성 iOS 확장·Android 절대 이벤트를 주입해 원본 저장·다운로드 스키마·복구·권한 거절·화면 숨김을 확인한다. E2E JSON은 test-results에 생성되며 Git에 넣지 않는다.

실제 iPhone Safari/Android Chrome의 권한창·센서 주기·축 규약·정확도·다운로드/파일 앱 동작은 해당 휴대폰에서 HTTPS로 확인해야 한다. 합성 이벤트 테스트를 실기기·서울역 정확도 검증으로 취급하지 않는다.

근거: [W3C 방향 이벤트](https://www.w3.org/TR/orientation-event/), [Apple 자북 방위](https://developer.apple.com/documentation/webkitjs/deviceorientationevent/1804777-webkitcompassheading), [Ajv Draft 2020-12](https://ajv.js.org/json-schema.html).
