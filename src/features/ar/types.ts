/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 실제 단말 어댑터가 공급해야 하는 좌표·촬영·앵커·품질 경계를 정의한다
 */
export interface Vec3 { x: number; y: number; z: number }
export interface Quaternion extends Vec3 { w: number }
export interface Pose { position: Vec3; rotation: Quaternion }

export interface MapScope { mapId: string; mapVersion: string }
export interface ArScope extends MapScope { floorId: string; arSessionId: string }

// 모든 포즈는 미터, +y 위, +z 전방, Unity 회전 규약이다. XR Origin 변환은 제거한다.
// 검출기 고유 축·단위·마커 앞면 방향은 네이티브 어댑터에서 변환한 뒤 전달한다.
export interface CaptureFrame {
  arSessionId: string
  frameId: string
  capturedAtMs: number
  cameraPoseAr: Pose
  tracking: 'tracking' | 'limited' | 'lost'
}

export interface MarkerMetadata extends MapScope {
  markerId: string
  floorId: string
  sizeM: number
  positionMapM: Vec3
  yawDeg: number
  installation: 'upright_wall'
}

export interface MarkerObservation {
  markerId: string
  arSessionId: string
  frameId: string
  capturedAtMs: number
  sizeUsedM: number
  // 마커 +y는 인쇄물 위쪽, +z는 앞면 바깥쪽이다. 검출 완료 시점의 카메라 포즈가 아니다.
  markerPoseCamera: Pose
}

export interface AlignmentQuality {
  errorM: number
  errorDeg: number
  method: string
}

// 이 값들은 제품 기본값이 아니다. 현장 검증한 정책이 없으면 렌더를 금지한다.
export interface ArPolicy {
  qaValidationId: string
  acceptedErrorMethods: readonly string[]
  maxErrorM: number
  maxErrorDeg: number
  maxTiltDeg: number
  maxAgeMs: number
  maxTravelM: number
  maxFrameAgeMs: number
  trackingGraceMs: number
}

export interface AnchorSample {
  anchorId: string
  arSessionId: string
  frameId: string
  tracking: 'tracking' | 'limited' | 'lost'
  poseAr: Pose
}

export interface Alignment extends ArScope {
  alignmentId: string
  anchorId: string
  measuredAtMs: number
  // 지도 루트는 이 앵커의 자식이다. 앵커의 최신 포즈는 매 프레임 다시 공급한다.
  mapInAnchor: Pose
  originCameraMap: Vec3
  quality: AlignmentQuality
}

export interface ArFrame extends CaptureFrame {
  anchor: AnchorSample | null
  // 단기 유실 후 앵커와 정합의 유효성을 실제 런타임에서 재검증한 경우에만 설정한다.
  recoveryValidatedAlignmentId?: string
}
