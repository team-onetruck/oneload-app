/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 지도·AR·앵커 좌표 변환과 같은 촬영 프레임에 기반한 마커 정합을 계산한다
 */
import type { Alignment, AlignmentQuality, AnchorSample, ArScope, CaptureFrame, MarkerMetadata, MarkerObservation, Pose, Quaternion, Vec3 } from './types'

export const identityRotation: Quaternion = { x: 0, y: 0, z: 0, w: 1 }
export const finiteVec = (p: Vec3) => [p.x, p.y, p.z].every(Number.isFinite)
export const normalizeDegrees = (deg: number) => ((deg % 360) + 360) % 360
export const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const negative = (p: Vec3): Vec3 => ({ x: -p.x, y: -p.y, z: -p.z })

export function validPose(p: Pose): boolean {
  const q = p.rotation
  return finiteVec(p.position) && finiteVec(q) && Number.isFinite(q.w) && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 0.0001
}

export function yawRotation(deg: number): Quaternion {
  const half = deg * Math.PI / 360
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }
}

const conjugate = (q: Quaternion): Quaternion => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

export function rotate(q: Quaternion, p: Vec3): Vec3 {
  const rotated = multiply(multiply(q, { ...p, w: 0 }), conjugate(q))
  return { x: rotated.x, y: rotated.y, z: rotated.z }
}

export const transformPoint = (pose: Pose, p: Vec3) => add(rotate(pose.rotation, p), pose.position)
export const compose = (a: Pose, b: Pose): Pose => ({ position: transformPoint(a, b.position), rotation: multiply(a.rotation, b.rotation) })
export const inverse = (pose: Pose): Pose => ({ position: rotate(conjugate(pose.rotation), negative(pose.position)), rotation: conjugate(pose.rotation) })

export function headingDeg(rotation: Quaternion): number | null {
  const forward = rotate(rotation, { x: 0, y: 0, z: 1 })
  return Math.hypot(forward.x, forward.z) < 0.0001 ? null : normalizeDegrees(Math.atan2(forward.x, forward.z) * 180 / Math.PI)
}

export function tiltDeg(rotation: Quaternion): number {
  const up = rotate(rotation, { x: 0, y: 1, z: 0 })
  return Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI
}

export type AlignmentResult = { ok: true; alignment: Alignment } | { ok: false; reason: 'scope' | 'capture_mismatch' | 'invalid_pose' | 'marker_metadata' | 'not_tracking' | 'marker_tilt' }

// 프레임 식별자·시각을 둘 다 비교한다. 검출이 늦어져도 촬영 때의 포즈를 사용한다.
export function alignMarker(input: {
  scope: ArScope
  alignmentId: string
  marker: MarkerMetadata
  observation: MarkerObservation
  capture: CaptureFrame
  anchor: AnchorSample
  quality: AlignmentQuality
  maxMarkerTiltDeg: number
}): AlignmentResult {
  const { scope, alignmentId, marker, observation: obs, capture, anchor, quality, maxMarkerTiltDeg } = input
  if (!alignmentId || !anchor.anchorId || marker.mapId !== scope.mapId || marker.mapVersion !== scope.mapVersion || marker.floorId !== scope.floorId || [obs.arSessionId, capture.arSessionId, anchor.arSessionId].some((id) => id !== scope.arSessionId)) return { ok: false, reason: 'scope' }
  if (!capture.frameId || capture.frameId !== obs.frameId || capture.frameId !== anchor.frameId || !Number.isFinite(capture.capturedAtMs) || capture.capturedAtMs < 0 || capture.capturedAtMs !== obs.capturedAtMs) return { ok: false, reason: 'capture_mismatch' }
  if (capture.tracking !== 'tracking' || anchor.tracking !== 'tracking') return { ok: false, reason: 'not_tracking' }
  if (marker.markerId !== obs.markerId || marker.installation !== 'upright_wall' || !Number.isFinite(marker.sizeM) || marker.sizeM <= 0 || marker.sizeM !== obs.sizeUsedM || !finiteVec(marker.positionMapM) || !Number.isFinite(marker.yawDeg)) return { ok: false, reason: 'marker_metadata' }
  if (![capture.cameraPoseAr, anchor.poseAr, obs.markerPoseCamera].every(validPose)) return { ok: false, reason: 'invalid_pose' }
  const markerAr = compose(capture.cameraPoseAr, obs.markerPoseCamera)
  const observedYaw = headingDeg(markerAr.rotation)
  if (!Number.isFinite(maxMarkerTiltDeg) || maxMarkerTiltDeg < 0 || maxMarkerTiltDeg > 90 || observedYaw === null || tiltDeg(markerAr.rotation) > maxMarkerTiltDeg) return { ok: false, reason: 'marker_tilt' }
  const rotation = yawRotation(normalizeDegrees(observedYaw - marker.yawDeg))
  const pose: Pose = { rotation, position: add(markerAr.position, negative(rotate(rotation, marker.positionMapM))) }
  return {
    ok: true,
    alignment: {
      ...scope, alignmentId, anchorId: anchor.anchorId, measuredAtMs: capture.capturedAtMs,
      mapInAnchor: compose(inverse(anchor.poseAr), pose),
      originCameraMap: transformPoint(inverse(pose), capture.cameraPoseAr.position),
      quality: { ...quality },
    },
  }
}

// 앵커 갱신을 한 번만 합성한다. 반환값은 Unity world가 아닌 AR 세션 좌표다.
export const mapPoseAr = (alignment: Alignment, anchor: AnchorSample): Pose => compose(anchor.poseAr, alignment.mapInAnchor)

export function currentMapPosition(alignment: Alignment, frame: CaptureFrame, anchor: AnchorSample, floorElevationM: number) {
  const cameraMap = compose(inverse(mapPoseAr(alignment, anchor)), frame.cameraPoseAr)
  return { positionMapM: { ...cameraMap.position, y: floorElevationM }, headingDeg: headingDeg(cameraMap.rotation) }
}
