/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 경로 응답(RouteOut)을 안내 화면이 쓰는 단계 모델로 바꾸고, 거리뷰 화살표 방향을 정한다
 */
import type { GraphOut, RouteOut } from '../../api/types'
import type { Text } from '../../data'

type ServerStep = RouteOut['steps'][number]
type GraphEdge = GraphOut['edges'][number]
type GraphPanorama = GraphOut['panoramas'][number]

// 서버 화살표가 없을 때 쓰는 기존 계산(사진 속 북쪽 + 통로 방향)의 재료. 지도 그래프에서 채운다.
export interface ArrowFallback {
  // 사진 안에서 지도 북쪽이 놓인 방향 (Panorama.north_yaw_deg)
  northYawDeg: number
  // 통로의 지도 방위, 0 = 북쪽, 시계 방향 (Edge.heading_deg)
  headingDeg: number
}

export interface RouteStepView {
  stepId: string
  // walk, gate, elevator, escalator_up/down, stairs_up/down (backend/app/domain/routing.py _step_kind)
  kind: string
  fromNodeId: string
  toNodeId: string
  distanceM: number
  instruction: Text
  // waypoints에서 읽은 층. 경로와 waypoints가 맞지 않으면 null
  fromFloorId: string | null
  toFloorId: string | null
  floorChange: boolean
  // 이 단계 출발 지점의 거리뷰 사진. 사진이 없는 지점이면 null
  panoId: string | null
  // 서버가 계산한 화살표 방향. 있으면 이 값을 우선한다
  arrowYawDeg: number | null
  fallback: ArrowFallback | null
}

// (-180, 180]로 맞춘다. 서버와 같은 규칙이다 (backend/app/domain/routing.py _wrap_degrees).
export function wrapDegrees(angle: number): number {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

// waypoints는 path_node_ids와 같은 순서로 한 노드에 하나씩 온다 (backend/app/api/routes.py).
function floorsByNode(route: RouteOut): Map<string, string> {
  const floors = new Map<string, string>()
  if (route.waypoints.length !== route.path_node_ids.length) return floors
  route.path_node_ids.forEach((nodeId, i) => floors.set(nodeId, route.waypoints[i].floor_id))
  return floors
}

function fallbackFor(step: ServerStep, edges: GraphEdge[], panoramas: GraphPanorama[]): ArrowFallback | null {
  const pano =
    panoramas.find((p) => step.pano_id !== null && p.pano_id === step.pano_id) ??
    panoramas.find((p) => p.node_id === step.from_node_id)
  const edge = edges.find((e) => e.from === step.from_node_id && e.to === step.to_node_id)
  return pano && edge ? { northYawDeg: pano.north_yaw_deg, headingDeg: edge.heading_deg } : null
}

// 단계 순서, 문구, 거리는 서버 값을 그대로 쓴다. 그래프를 주면 화살표 폴백 재료도 채운다.
export function toSteps(route: RouteOut, graph?: Pick<GraphOut, 'edges' | 'panoramas'>): RouteStepView[] {
  const floors = floorsByNode(route)
  return route.steps.map((step) => {
    const fromFloorId = floors.get(step.from_node_id) ?? null
    const toFloorId = floors.get(step.to_node_id) ?? null
    return {
      stepId: step.step_id,
      kind: step.kind,
      fromNodeId: step.from_node_id,
      toNodeId: step.to_node_id,
      distanceM: step.distance_m,
      instruction: { en: step.instruction_en, ko: step.instruction_ko },
      fromFloorId,
      toFloorId,
      floorChange: fromFloorId !== null && toFloorId !== null && fromFloorId !== toFloorId,
      panoId: step.pano_id,
      arrowYawDeg: step.arrow_yaw_deg,
      fallback: graph ? fallbackFor(step, graph.edges, graph.panoramas) : null,
    }
  })
}

// 서버 화살표를 우선하고, 없을 때만 northYaw + heading으로 계산한다. 둘 다 없으면 화살표를 그리지 않는다.
export function arrowYawDeg(step: Pick<RouteStepView, 'arrowYawDeg' | 'fallback'>): number | null {
  if (step.arrowYawDeg !== null) return step.arrowYawDeg
  return step.fallback ? wrapDegrees(step.fallback.northYawDeg + step.fallback.headingDeg) : null
}

// fromIdx 단계부터 도착까지 남은 거리
export const remainingDistanceM = (steps: Pick<RouteStepView, 'distanceM'>[], fromIdx: number) =>
  steps.slice(fromIdx).reduce((m, s) => m + s.distanceM, 0)
