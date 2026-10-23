/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 화면(노선 보기·거리뷰)이 그리는 모델. 서버 경로(steps + 지도 그래프)와 데모 경로(data.ts)를 같은 모양으로 바꾼다
 */
import type { GraphOut, RouteOut } from '../../api/types'
import type { Text } from '../../data'
import { UI } from '../../i18n'
import type { PlaceView } from '../localization/views'
import { arrowYawDeg, toSteps } from './toSteps'
import type { RouteStepView } from './toSteps'

// 서버가 만든 진행 중 경로. 단계 순서·문구·거리·화살표는 서버 값이다
export interface ActiveRoute {
  routeId: string
  routeRevision: number
  destinationPoiId: string
  // 출발부터 도착까지 노드와 층(waypoints). 경로와 waypoints가 맞지 않으면 층은 null
  stops: { nodeId: string; floorId: string | null }[]
  steps: RouteStepView[]
}

export function toActiveRoute(out: RouteOut, graph?: Pick<GraphOut, 'edges' | 'panoramas'>): ActiveRoute {
  const floors = out.waypoints.length === out.path_node_ids.length ? out.waypoints.map((w) => w.floor_id) : []
  return {
    routeId: out.route_id,
    routeRevision: out.route_revision,
    destinationPoiId: out.destination_poi_id,
    stops: out.path_node_ids.map((nodeId, i) => ({ nodeId, floorId: floors[i] ?? null })),
    steps: toSteps(out, graph),
  }
}

export interface GuidePano {
  src: string
  // 다른 곳에서 찍은 예시 사진이면 화면에 붙일 문구. 현장 사진이면 null
  example: Text | null
}

export interface GuideLeg {
  stepId: string
  kind: string
  distanceM: number
  instruction: Text
  from: PlaceView
  to: PlaceView
  floorChange: boolean
  // 이 단계 출발 지점의 거리뷰 사진. 없으면 '사진 없음' 화면을 보여 준다
  pano: GuidePano | null
  // 사진 위 화살표 방향. 서버 arrow_yaw_deg를 우선하고, 없으면 northYaw + heading. 둘 다 없으면 화살표를 그리지 않는다
  yawDeg: number | null
  // 이 단계 통로의 지도 방위, 0 = 북쪽, 시계 방향 (Edge.heading_deg). 라이브 뷰가 폰 나침반과 비교한다. 그래프에 없으면 null
  headingDeg: number | null
}

// 화살표 아래 알약에 쓰는 문구: 거리, 층이 바뀌면 층도 함께
export function legDistanceLabel(leg: Pick<GuideLeg, 'distanceM' | 'floorChange' | 'from' | 'to'>): string {
  const from = leg.from.floor
  const to = leg.to.floor
  return !leg.floorChange || !from || !to ? `${leg.distanceM} m` : `${leg.distanceM} m · ${from} → ${to}`
}

export interface RouteGuide {
  destination: PlaceView
  // 출발 지점부터 도착 지점까지. legs보다 하나 많다
  stops: PlaceView[]
  legs: GuideLeg[]
}

// 노드 이름과 사진 주소는 지도 그래프에서 찾는다. 그래프에 없으면 이름은 null(화면은 node id를 그대로 보여 준다), 사진은 없음으로 둔다.
export function serverGuide(route: ActiveRoute, graph: GraphOut | null): RouteGuide {
  const nodes = new Map(graph?.nodes.map((n) => [n.id, n]))
  const panos = new Map(graph?.panoramas.map((p) => [p.pano_id, p]))
  const stops = route.stops.map(({ nodeId, floorId }): PlaceView => {
    const node = nodes.get(nodeId)
    return { nodeId, floor: floorId ?? node?.floor_id ?? '', name: node?.name ?? null }
  })
  const place = (nodeId: string, floorId: string | null): PlaceView =>
    stops.find((s) => s.nodeId === nodeId) ?? { nodeId, floor: floorId ?? '', name: nodes.get(nodeId)?.name ?? null }
  const legs = route.steps.map((step): GuideLeg => {
    const pano = step.panoId ? panos.get(step.panoId) : undefined
    return {
      stepId: step.stepId,
      kind: step.kind,
      distanceM: step.distanceM,
      instruction: step.instruction,
      from: place(step.fromNodeId, step.fromFloorId),
      to: place(step.toNodeId, step.toFloorId),
      floorChange: step.floorChange,
      pano: pano ? { src: pano.image_url, example: pano.is_example ? UI.svExample : null } : null,
      yawDeg: arrowYawDeg(step),
      headingDeg: step.fallback?.headingDeg ?? null,
    }
  })
  return { destination: stops[stops.length - 1], stops, legs }
}
