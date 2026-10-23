/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로·재탐색 요청 본문 빌더와 재탐색 가능 여부 판단(planReroute)을 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import type { NavigationStateOut } from '../../api/types'
import { buildRerouteRequest, buildRouteRequest, planReroute } from './request'

const input = { revision: 5, destinationPoiId: 'poi-express-tickets', mapVersion: '2026-10-22.1' }

describe('buildRouteRequest', () => {
  it('확정 위치에서 출발하는 처음 경로 요청을 만든다', () => {
    expect(buildRouteRequest(input)).toEqual({
      expected_revision: 5,
      destination_poi_id: 'poi-express-tickets',
      map_version: '2026-10-22.1',
      start: { type: 'confirmed_node' },
      reroute: false,
    })
  })

  it('선호를 주지 않으면 preferences를 빼서 서버가 세션 선호를 쓰게 한다', () => {
    expect(buildRouteRequest(input)).not.toHaveProperty('preferences')
    expect(buildRouteRequest({ ...input, preferences: { avoid_stairs: true } }).preferences).toEqual({ avoid_stairs: true })
  })
})

describe('buildRerouteRequest', () => {
  it('같은 목적지로 reroute=true 요청을 만든다', () => {
    expect(buildRerouteRequest(input)).toEqual({ ...buildRouteRequest(input), reroute: true })
  })
})

describe('planReroute', () => {
  const state = (patch: Partial<NavigationStateOut>): NavigationStateOut => ({
    session: { state: 'ready_to_navigate', revision: 9 },
    destination_poi_id: 'poi-express-tickets',
    confirmed_node_id: 'arex-concourse',
    active_route_id: 'route_1',
    route_revision: 1,
    map_version: '2026-10-22.1',
    next_action: 'navigate',
    ...patch,
  })

  it('길을 잃은 뒤 서버가 확정 위치를 지웠으면 위치부터 다시 확인하게 한다', () => {
    const lost = state({ session: { state: 'needs_location', revision: 8 }, confirmed_node_id: null, next_action: 'locate' })
    expect(planReroute(lost, '2026-10-22.1')).toEqual({ kind: 'needs_location' })
  })

  it('위치를 다시 확정했으면 서버의 목적지와 revision으로 재탐색 요청을 만든다', () => {
    expect(planReroute(state({}), '2026-10-22.1')).toEqual({
      kind: 'ready',
      request: buildRerouteRequest({ revision: 9, destinationPoiId: 'poi-express-tickets', mapVersion: '2026-10-22.1' }),
    })
  })

  it('지도 버전은 서버 세션 값이 아니라 앱이 가진 값을 보낸다', () => {
    const plan = planReroute(state({ map_version: '2026-11-01.1' }), '2026-10-22.1')
    expect(plan.kind === 'ready' && plan.request.map_version).toBe('2026-10-22.1')
  })

  it('목적지가 없으면 재탐색하지 않고 목적지부터 다시 정하게 한다', () => {
    expect(planReroute(state({ destination_poi_id: null, confirmed_node_id: null }), '2026-10-22.1')).toEqual({ kind: 'no_destination' })
  })
})
