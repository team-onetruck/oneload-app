/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 유효한 지도·세션·정합·앵커·품질에서만 바닥 화살표 명령과 현재 지도 위치를 만든다
 */
import { compose, currentMapPosition, distance, finiteVec, mapPoseAr, normalizeDegrees, tiltDeg, transformPoint, validPose, yawRotation } from './coordinates'
import type { ArRoute } from './route'
import type { Alignment, ArFrame, ArPolicy, ArScope, Pose, Vec3 } from './types'

export interface RouteBinding {
  routeId: string
  routeRevision: number
  destinationPoiId: string
  arSessionId: string
  alignmentId: string
}

export type HideReason = 'runtime_unavailable' | 'policy_unverified' | 'scope_mismatch' | 'route_mismatch' | 'frame_stale' | 'tracking_unavailable' | 'anchor_invalid' | 'quality_unverified' | 'alignment_expired' | 'travel_exceeded' | 'floor_transition' | 'invalid_geometry' | 'realignment_required'
export type RenderDecision =
  | { mode: '2d_steps'; reason: HideReason }
  | {
      mode: 'floor_arrow'
      alignmentId: string
      anchorId: string
      stepId: string
      // 앵커의 자식으로 한 번만 적용한다. 지도 루트 변환을 다시 곱하지 않는다.
      arrowInAnchor: Pose
      positionMapM: Vec3
      headingMapDeg: number
    }

export interface RenderInput {
  scope: ArScope
  expectedAlignmentId: string
  route: ArRoute
  binding: RouteBinding
  alignment: Alignment
  frame: ArFrame
  policy: ArPolicy | null
  nowMs: number
  floorElevationM: number
  stepIndex: number
}

const hidden = (reason: HideReason): RenderDecision => ({ mode: '2d_steps', reason })

export function validPolicy(p: ArPolicy | null): p is ArPolicy {
  return p !== null && Boolean(p.qaValidationId) && p.acceptedErrorMethods.length > 0 &&
    [p.maxErrorM, p.maxErrorDeg, p.maxTiltDeg, p.maxTravelM, p.trackingGraceMs].every((n) => Number.isFinite(n) && n >= 0) &&
    [p.maxAgeMs, p.maxFrameAgeMs].every((n) => Number.isFinite(n) && n > 0) && p.maxTiltDeg < 90
}

export function evaluateArFrame(input: RenderInput): RenderDecision {
  const { scope, expectedAlignmentId, route, binding, alignment: a, frame: f, policy: p, nowMs, floorElevationM, stepIndex } = input
  if (!validPolicy(p)) return hidden('policy_unverified')
  if (!expectedAlignmentId || a.alignmentId !== expectedAlignmentId || a.mapId !== scope.mapId || a.mapVersion !== scope.mapVersion || a.floorId !== scope.floorId || a.arSessionId !== scope.arSessionId || f.arSessionId !== scope.arSessionId) return hidden('scope_mismatch')
  if (route.mapId !== scope.mapId || route.mapVersion !== scope.mapVersion || binding.routeId !== route.routeId || binding.routeRevision !== route.routeRevision || binding.destinationPoiId !== route.destinationPoiId || binding.arSessionId !== scope.arSessionId || binding.alignmentId !== a.alignmentId) return hidden('route_mismatch')
  if (!Number.isFinite(nowMs) || !Number.isFinite(f.capturedAtMs) || f.capturedAtMs > nowMs || nowMs - f.capturedAtMs > p.maxFrameAgeMs || !f.frameId) return hidden('frame_stale')
  if (f.tracking !== 'tracking') return hidden('tracking_unavailable')
  const anchor = f.anchor
  if (!anchor || anchor.anchorId !== a.anchorId || anchor.arSessionId !== scope.arSessionId || anchor.frameId !== f.frameId || anchor.tracking !== 'tracking' || !validPose(anchor.poseAr) || !validPose(a.mapInAnchor) || !validPose(f.cameraPoseAr)) return hidden('anchor_invalid')
  const q = a.quality
  if (![q.errorM, q.errorDeg].every((n) => Number.isFinite(n) && n >= 0) || q.errorM > p.maxErrorM || q.errorDeg > p.maxErrorDeg || !p.acceptedErrorMethods.includes(q.method) || tiltDeg(mapPoseAr(a, anchor).rotation) > p.maxTiltDeg) return hidden('quality_unverified')
  if (!Number.isFinite(a.measuredAtMs) || a.measuredAtMs > nowMs || nowMs - a.measuredAtMs > p.maxAgeMs) return hidden('alignment_expired')
  if (!Number.isFinite(floorElevationM) || !finiteVec(a.originCameraMap)) return hidden('invalid_geometry')
  const current = currentMapPosition(a, f, anchor, floorElevationM)
  if (current.headingDeg === null || !finiteVec(current.positionMapM)) return hidden('invalid_geometry')
  const travelledM = Math.hypot(current.positionMapM.x - a.originCameraMap.x, current.positionMapM.z - a.originCameraMap.z)
  if (travelledM > p.maxTravelM) return hidden('travel_exceeded')
  const segment = route.segments[stepIndex]
  if (!segment) return hidden('invalid_geometry')
  if (segment.from.floorId !== scope.floorId || segment.to.floorId !== scope.floorId || segment.kind !== 'walk') return hidden('floor_transition')
  const from = segment.from.positionMapM
  const to = segment.to.positionMapM
  if (!finiteVec(from) || !finiteVec(to) || Math.abs(from.y - floorElevationM) > 0.001 || Math.abs(to.y - floorElevationM) > 0.001 || distance(from, to) < 0.001) return hidden('invalid_geometry')
  const yaw = normalizeDegrees(Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI)
  // 최소 실험의 화살표 하나를 통로 중점에 고정한다. 보행자 위치를 따라 옮기지 않는다.
  const arrowMap: Pose = { position: { x: (from.x + to.x) / 2, y: floorElevationM, z: (from.z + to.z) / 2 }, rotation: yawRotation(yaw) }
  return {
    mode: 'floor_arrow', alignmentId: a.alignmentId, anchorId: a.anchorId, stepId: segment.stepId,
    arrowInAnchor: compose(a.mapInAnchor, arrowMap),
    positionMapM: current.positionMapM, headingMapDeg: current.headingDeg,
  }
}

// 렌더 명령 검산용이다. 실제 렌더러는 앵커를 부모로 쓰므로 이 변환을 중복 적용하지 않는다.
export function arrowPositionAr(decision: Extract<RenderDecision, { mode: 'floor_arrow' }>, frame: ArFrame) {
  return frame.anchor ? transformPoint(frame.anchor.poseAr, decision.arrowInAnchor.position) : null
}
