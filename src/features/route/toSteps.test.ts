/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 응답을 단계 모델로 바꾸는 toSteps와 화살표 방향(서버 값 우선, northYaw+heading 폴백)을 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import type { GraphOut, RouteOut } from '../../api/types'
import { arrowYawDeg, remainingDistanceM, toSteps, wrapDegrees } from './toSteps'

// 백엔드 테스트 지도(backend/tests/fixtures/maps/seoul-station.json)의 4호선 개찰구 → 직통열차 표 사는 곳 경로
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
      instruction_en: 'Follow the “Airport Railroad” transfer signs, then go down to B2.',
      instruction_ko: '“공항철도” 환승 표지를 따라 B2로 내려가세요.',
      pano_id: 'pano-line4-gates',
      arrow_yaw_deg: -80,
    },
    {
      step_id: 's2',
      kind: 'walk',
      from_node_id: 'arex-concourse',
      to_node_id: 'express-tickets',
      distance_m: 30,
      instruction_en: 'Look for the “Express Train” ticket counter on this floor.',
      instruction_ko: '이 층에서 “직통열차” 표 사는 곳을 찾으세요.',
      pano_id: 'pano-arex-concourse',
      arrow_yaw_deg: -108,
    },
  ],
  session: { state: 'ready_to_navigate', revision: 5 },
}

const text = { en: '', ko: '' }
const graph: Pick<GraphOut, 'edges' | 'panoramas'> = {
  edges: [
    { from: 'line4-gates', to: 'arex-concourse', type: 'escalator', distance_m: 110, heading_deg: 240, instruction: text },
    { from: 'arex-concourse', to: 'express-tickets', type: 'corridor', distance_m: 30, heading_deg: 90, instruction: text },
  ],
  panoramas: [
    { pano_id: 'pano-line4-gates', node_id: 'line4-gates', image_url: '/panos/subway_entrance.webp', north_yaw_deg: -320, captured_at: null, is_example: true },
    { pano_id: 'pano-arex-concourse', node_id: 'arex-concourse', image_url: '/panos/metro_noord.webp', north_yaw_deg: 162, captured_at: null, is_example: true },
  ],
}

describe('toSteps', () => {
  it('서버 단계의 순서, 안내 문구(ko/en), 거리, pano_id, arrow_yaw_deg를 그대로 옮긴다', () => {
    const steps = toSteps(route)
    expect(steps.map((s) => s.stepId)).toEqual(['s1', 's2'])
    expect(steps[0]).toMatchObject({
      kind: 'escalator_down',
      fromNodeId: 'line4-gates',
      toNodeId: 'arex-concourse',
      distanceM: 110,
      instruction: { en: route.steps[0].instruction_en, ko: route.steps[0].instruction_ko },
      panoId: 'pano-line4-gates',
      arrowYawDeg: -80,
    })
  })

  it('waypoints의 층으로 층 이동 여부를 정한다', () => {
    const [down, walk] = toSteps(route)
    expect(down).toMatchObject({ fromFloorId: 'B1', toFloorId: 'B2', floorChange: true })
    expect(walk).toMatchObject({ fromFloorId: 'B2', toFloorId: 'B2', floorChange: false })
  })

  it('waypoints가 경로 노드 수와 다르면 층을 모르는 것으로 두고 층 이동으로 보지 않는다', () => {
    const [step] = toSteps({ ...route, waypoints: route.waypoints.slice(0, 1) })
    expect(step).toMatchObject({ fromFloorId: null, toFloorId: null, floorChange: false })
  })

  it('그래프를 주면 사진의 north_yaw_deg와 통로의 heading_deg를 폴백 재료로 채운다', () => {
    const [down, walk] = toSteps(route, graph)
    expect(down.fallback).toEqual({ northYawDeg: -320, headingDeg: 240 })
    expect(walk.fallback).toEqual({ northYawDeg: 162, headingDeg: 90 })
  })

  it('그래프가 없거나 사진·통로를 찾지 못하면 폴백 재료를 비운다', () => {
    expect(toSteps(route)[0].fallback).toBeNull()
    expect(toSteps(route, { edges: graph.edges, panoramas: [] })[0].fallback).toBeNull()
    expect(toSteps(route, { edges: [], panoramas: graph.panoramas })[0].fallback).toBeNull()
  })
})

describe('arrowYawDeg', () => {
  it('서버 arrow_yaw_deg가 있으면 폴백 계산과 달라도 서버 값을 쓴다', () => {
    expect(arrowYawDeg({ arrowYawDeg: -80, fallback: { northYawDeg: 0, headingDeg: 10 } })).toBe(-80)
  })

  it('서버 값이 없으면 northYaw + heading을 (-180, 180]로 맞춰 쓴다', () => {
    expect(arrowYawDeg({ arrowYawDeg: null, fallback: { northYawDeg: 162, headingDeg: 90 } })).toBe(-108)
    expect(arrowYawDeg({ arrowYawDeg: null, fallback: { northYawDeg: -320, headingDeg: 240 } })).toBe(-80)
  })

  it('서버 값도 폴백 재료도 없으면 화살표를 그리지 않도록 null을 돌려준다', () => {
    expect(arrowYawDeg({ arrowYawDeg: null, fallback: null })).toBeNull()
  })

  it('서버 값 0도는 없는 값으로 보지 않는다', () => {
    expect(arrowYawDeg({ arrowYawDeg: 0, fallback: { northYawDeg: 90, headingDeg: 0 } })).toBe(0)
  })
})

describe('wrapDegrees', () => {
  it('서버와 같이 (-180, 180] 범위로 맞춘다', () => {
    expect(wrapDegrees(252)).toBe(-108)
    expect(wrapDegrees(432)).toBe(72)
    expect(wrapDegrees(-400)).toBe(-40)
    expect(wrapDegrees(180)).toBe(180)
    expect(wrapDegrees(-180)).toBe(180)
    expect(wrapDegrees(0)).toBe(0)
  })
})

describe('remainingDistanceM', () => {
  it('지금 단계부터 도착까지 남은 거리를 더한다', () => {
    const steps = toSteps(route)
    expect(remainingDistanceM(steps, 0)).toBe(140)
    expect(remainingDistanceM(steps, 1)).toBe(30)
    expect(remainingDistanceM(steps, 2)).toBe(0)
  })
})
