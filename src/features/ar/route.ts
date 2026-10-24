/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 현재 백엔드의 경로 waypoint와 step을 검증하고 AR용 기하 모델로 보존한다
 */
import type { RouteOut } from '../../api/types'
import { finiteVec } from './coordinates'
import type { MapScope, Vec3 } from './types'

export interface ArWaypoint { waypointId: string; floorId: string; positionMapM: Vec3 }
export interface ArSegment { stepId: string; kind: string; from: ArWaypoint; to: ArWaypoint }
export interface ArRoute extends MapScope {
  routeId: string
  routeRevision: number
  destinationPoiId: string
  segments: ArSegment[]
}

// 현재 서버는 path_node_ids와 같은 순서로 waypoint 하나씩 반환한다. 불완전한 경로를 좌표로 추측하지 않는다.
export function toArRoute(out: RouteOut): ArRoute | null {
  if (!out.map_id || !out.map_version || !out.route_id || !out.destination_poi_id || !Number.isInteger(out.route_revision) || out.route_revision < 1 || out.waypoints.length < 2 || out.path_node_ids.length !== out.waypoints.length || out.steps.length !== out.waypoints.length - 1) return null
  if (new Set(out.waypoints.map((w) => w.waypoint_id)).size !== out.waypoints.length || new Set(out.steps.map((s) => s.step_id)).size !== out.steps.length) return null
  if (out.waypoints.some((w) => !w.waypoint_id || !w.floor_id || !finiteVec(w.position_map_m))) return null
  if (out.steps.some((s, i) => !s.step_id || s.from_node_id !== out.path_node_ids[i] || s.to_node_id !== out.path_node_ids[i + 1])) return null
  const points = out.waypoints.map((w): ArWaypoint => ({ waypointId: w.waypoint_id, floorId: w.floor_id, positionMapM: { ...w.position_map_m } }))
  return {
    mapId: out.map_id, mapVersion: out.map_version, routeId: out.route_id,
    routeRevision: out.route_revision, destinationPoiId: out.destination_poi_id,
    segments: out.steps.map((s, i) => ({ stepId: s.step_id, kind: s.kind, from: points[i], to: points[i + 1] })),
  }
}
