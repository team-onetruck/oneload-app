/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 실제 측량·센서·QA 승인값과 분리한 한 층·한 통로·마커 하나의 합성 입력을 만든다
 */
import type { RouteOut } from '../../api/types'
import { alignMarker, yawRotation } from '../../features/ar/coordinates'
import type { RenderInput } from '../../features/ar/render'
import { toArRoute } from '../../features/ar/route'
import type { AnchorSample, ArPolicy, ArScope, CaptureFrame, MarkerMetadata, MarkerObservation, Vec3 } from '../../features/ar/types'

export const pose = (position: Vec3, yaw = 0) => ({ position, rotation: yawRotation(yaw) })

export function arFixture() {
  const scope: ArScope = { mapId: 'fixture-corridor', mapVersion: 'fixture-v1', floorId: 'F1', arSessionId: 'fixture-run-1' }
  const marker: MarkerMetadata = { ...scope, markerId: 'fixture-marker', sizeM: 0.2, positionMapM: { x: 2, y: 1.5, z: 3 }, yawDeg: 90, installation: 'upright_wall' }
  const capture: CaptureFrame = { arSessionId: scope.arSessionId, frameId: 'capture-1', capturedAtMs: 1000, tracking: 'tracking', cameraPoseAr: pose({ x: 10, y: 3.6, z: 20 }, 90) }
  const observation: MarkerObservation = { markerId: marker.markerId, arSessionId: scope.arSessionId, frameId: capture.frameId, capturedAtMs: capture.capturedAtMs, sizeUsedM: marker.sizeM, markerPoseCamera: pose({ x: 2, y: -0.1, z: 3 }, 90) }
  const anchor: AnchorSample = { anchorId: 'fixture-anchor', arSessionId: scope.arSessionId, frameId: capture.frameId, tracking: 'tracking', poseAr: pose({ x: 10, y: 2, z: 20 }, 30) }
  const policy: ArPolicy = { qaValidationId: 'fixture-only-not-field-approved', acceptedErrorMethods: ['fixture-independent-point'], maxErrorM: 0.2, maxErrorDeg: 5, maxTiltDeg: 5, maxAgeMs: 60000, maxTravelM: 10, maxFrameAgeMs: 100, trackingGraceMs: 500 }
  const quality = { errorM: 0.1, errorDeg: 2, method: 'fixture-independent-point' }
  const alignmentInput = { scope, marker, observation, capture, anchor, quality, alignmentId: 'fixture-alignment-1', maxMarkerTiltDeg: 5 }
  const result = alignMarker(alignmentInput)
  if (!result.ok) throw new Error(`합성 정합 입력 오류: ${result.reason}`)
  const routeOut: RouteOut = {
    route_id: 'fixture-route', route_revision: 1, status: 'created', map_id: scope.mapId, map_version: scope.mapVersion,
    start_node_id: 'a', destination_poi_id: 'fixture-poi', distance_m: 4, path_node_ids: ['a', 'b'],
    waypoints: [
      { waypoint_id: 'w1', floor_id: scope.floorId, position_map_m: { x: 0, y: 0, z: 0 } },
      { waypoint_id: 'w2', floor_id: scope.floorId, position_map_m: { x: 4, y: 0, z: 0 } },
    ],
    steps: [{ step_id: 'fixture-step', kind: 'walk', from_node_id: 'a', to_node_id: 'b', distance_m: 4, instruction_ko: '합성 통로', instruction_en: 'Fixture corridor', pano_id: null, arrow_yaw_deg: null }],
    session: { state: 'ready_to_navigate', revision: 5 },
  }
  const route = toArRoute(routeOut)!
  const renderInput: RenderInput = {
    scope, expectedAlignmentId: result.alignment.alignmentId, route,
    binding: { routeId: route.routeId, routeRevision: route.routeRevision, destinationPoiId: route.destinationPoiId, arSessionId: scope.arSessionId, alignmentId: result.alignment.alignmentId },
    alignment: result.alignment, frame: { ...capture, anchor }, policy, nowMs: 1000, floorElevationM: 0, stepIndex: 0,
  }
  return { alignmentInput, renderInput, routeOut }
}
