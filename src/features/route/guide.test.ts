/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 화면 모델(serverGuide)이 서버 값과 지도 그래프를 화면 모양으로 옮기는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import type { RouteOut } from '../../api/types'
import { UI } from '../../i18n'
import { GRAPH } from '../../test/fixtures/seoulStation'
import { serverGuide, toActiveRoute } from './guide'

// 가짜 백엔드가 4호선 개찰구 → 직통열차 표 사는 곳으로 돌려주는 경로와 같은 모양. 두 번째 단계는 사진이 없다고 둔다
const route: RouteOut = {
  route_id: 'route_1',
  route_revision: 1,
  status: 'created',
  map_id: 'seoul-station',
  map_version: '2026-10-22.1',
  start_node_id: 'line4-gates',
  destination_poi_id: 'poi-express-tickets',
  distance_m: 140,
  path_node_ids: ['line4-gates', 'arex-concourse', 'express-tickets'],
  waypoints: [
    { waypoint_id: 'w1', floor_id: 'B1', position_map_m: { x: 60, y: -6, z: 30 } },
    { waypoint_id: 'w2', floor_id: 'B2', position_map_m: { x: 0, y: -12, z: 0 } },
    { waypoint_id: 'w3', floor_id: 'B2', position_map_m: { x: 30, y: -12, z: 0 } },
  ],
  steps: [
    {
      step_id: 's1',
      kind: 'escalator_down',
      from_node_id: 'line4-gates',
      to_node_id: 'arex-concourse',
      distance_m: 110,
      instruction_en: 'server en 1',
      instruction_ko: '서버 문구 1',
      pano_id: 'pano-line4-gates',
      arrow_yaw_deg: -80,
    },
    {
      step_id: 's2',
      kind: 'walk',
      from_node_id: 'arex-concourse',
      to_node_id: 'express-tickets',
      distance_m: 30,
      instruction_en: 'server en 2',
      instruction_ko: '서버 문구 2',
      pano_id: null,
      arrow_yaw_deg: null,
    },
  ],
  session: { state: 'ready_to_navigate', revision: 5 },
}

describe('toActiveRoute', () => {
  it('경로 id·revision·목적지와 waypoints의 층을 담는다', () => {
    const active = toActiveRoute(route)
    expect(active).toMatchObject({ routeId: 'route_1', routeRevision: 1, destinationPoiId: 'poi-express-tickets' })
    expect(active.stops).toEqual([
      { nodeId: 'line4-gates', floorId: 'B1' },
      { nodeId: 'arex-concourse', floorId: 'B2' },
      { nodeId: 'express-tickets', floorId: 'B2' },
    ])
  })
})

describe('serverGuide', () => {
  it('노드 이름은 지도 그래프, 문구·거리·화살표는 서버 step 값을 쓴다', () => {
    const guide = serverGuide(toActiveRoute(route, GRAPH), GRAPH)
    const names = new Map(GRAPH.nodes.map((n) => [n.id, n.name]))
    expect(guide.stops.map((s) => s.name)).toEqual(route.path_node_ids.map((id) => names.get(id)))
    expect(guide.destination).toMatchObject({ nodeId: 'express-tickets', floor: 'B2', name: names.get('express-tickets') })
    expect(guide.legs[0]).toMatchObject({
      kind: 'escalator_down',
      distanceM: 110,
      instruction: { en: 'server en 1', ko: '서버 문구 1' },
      floorChange: true,
      yawDeg: -80,
    })
  })

  it('사진은 pano_id로 그래프의 image_url을 찾고, 예시 사진이면 공통 예시 문구를 붙인다', () => {
    const [first] = serverGuide(toActiveRoute(route, GRAPH), GRAPH).legs
    expect(first.pano).toEqual({ src: '/panos/subway_entrance.webp', example: UI.svExample })
  })

  it('서버 화살표가 없으면 그래프의 north_yaw_deg + heading_deg로 계산하고, 사진이 없으면 사진은 비운다', () => {
    const second = serverGuide(toActiveRoute(route, GRAPH), GRAPH).legs[1]
    expect(second.pano).toBeNull()
    // arex-concourse 사진(north 162) + 대합실 → 직통 표 통로(heading 90) = 252 → -108
    expect(second.yawDeg).toBe(-108)
  })

  it('그래프를 아직 못 받았으면 이름과 사진은 비우고 서버 값만으로 그린다', () => {
    const guide = serverGuide(toActiveRoute(route), null)
    expect(guide.stops.every((s) => s.name === null)).toBe(true)
    expect(guide.legs[0]).toMatchObject({ pano: null, yawDeg: -80 })
    expect(guide.legs[1].yawDeg).toBeNull()
  })
})
