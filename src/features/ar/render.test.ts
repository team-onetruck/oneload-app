/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 조건별 렌더 차단과 서버 경로 기하 보존을 합성 입력으로 검증한다
 */
import { describe, expect, it } from 'vitest'
import { arFixture, pose } from '../../test/fixtures/ar'
import { toActiveRoute } from '../route/guide'
import { arrowPositionAr, evaluateArFrame } from './render'
import type { HideReason, RenderInput } from './render'
import { toArRoute } from './route'

describe('바닥 화살표 렌더 조건', () => {
  it('서버 통로 중점에 화살표 하나를 고정하고 이동한 현재 위치만 갱신한다', () => {
    const { renderInput: input } = arFixture()
    const first = evaluateArFrame(input)
    expect(first.mode).toBe('floor_arrow')
    if (first.mode !== 'floor_arrow') throw new Error('합성 조건에서 렌더 실패')
    const world = arrowPositionAr(first, input.frame)!
    expect(world.x).toBeCloseTo(10)
    expect(world.y).toBeCloseTo(2)
    expect(world.z).toBeCloseTo(18)
    input.frame.cameraPoseAr = pose({ x: 12, y: 3.6, z: 19 }, 120)
    const moved = evaluateArFrame(input)
    expect(moved.mode).toBe('floor_arrow')
    if (moved.mode !== 'floor_arrow') throw new Error('이동 후 렌더 실패')
    expect(moved.arrowInAnchor).toEqual(first.arrowInAnchor)
    expect(moved.positionMapM.x).toBeCloseTo(1)
    expect(moved.positionMapM.z).toBeCloseTo(2)
    expect(moved.headingMapDeg).toBeCloseTo(30)
  })

  const blocked: [string, HideReason, (input: RenderInput) => void][] = [
    ['QA 정책 없음', 'policy_unverified', (i) => { i.policy = null }],
    ['미승인 정책', 'policy_unverified', (i) => { i.policy!.qaValidationId = '' }],
    ['지도 id', 'scope_mismatch', (i) => { i.scope.mapId = 'other' }],
    ['지도 버전', 'scope_mismatch', (i) => { i.alignment.mapVersion = 'other' }],
    ['층', 'scope_mismatch', (i) => { i.scope.floorId = 'F2' }],
    ['AR 세션', 'scope_mismatch', (i) => { i.frame.arSessionId = 'other' }],
    ['정합 id', 'scope_mismatch', (i) => { i.expectedAlignmentId = 'other' }],
    ['경로 버전', 'route_mismatch', (i) => { i.route.mapVersion = 'other' }],
    ['경로 revision', 'route_mismatch', (i) => { i.binding.routeRevision++ }],
    ['목적지', 'route_mismatch', (i) => { i.binding.destinationPoiId = 'other' }],
    ['경로 정합', 'route_mismatch', (i) => { i.binding.alignmentId = 'other' }],
    ['오래된 프레임', 'frame_stale', (i) => { i.nowMs += 101 }],
    ['미래 프레임', 'frame_stale', (i) => { i.frame.capturedAtMs++ }],
    ['추적 제한', 'tracking_unavailable', (i) => { i.frame.tracking = 'limited' }],
    ['앵커 없음', 'anchor_invalid', (i) => { i.frame.anchor = null }],
    ['다른 앵커', 'anchor_invalid', (i) => { i.frame.anchor!.anchorId = 'other' }],
    ['앵커 프레임 불일치', 'anchor_invalid', (i) => { i.frame.anchor!.frameId = 'other' }],
    ['앵커 추적 유실', 'anchor_invalid', (i) => { i.frame.anchor!.tracking = 'lost' }],
    ['미검증 검출기 잔차', 'quality_unverified', (i) => { i.alignment.quality.method = 'pixel-residual' }],
    ['정합 오차 초과', 'quality_unverified', (i) => { i.alignment.quality.errorM = 0.3 }],
    ['정합 오차 NaN', 'quality_unverified', (i) => { i.alignment.quality.errorDeg = NaN }],
    ['정합 만료', 'alignment_expired', (i) => { i.alignment.measuredAtMs = -60000 }],
    ['유효 거리 초과', 'travel_exceeded', (i) => { i.frame.cameraPoseAr.position.z -= 11 }],
    ['층 전환 구간', 'floor_transition', (i) => { i.route.segments[0].to.floorId = 'F2' }],
    ['같은 층의 계단', 'floor_transition', (i) => { i.route.segments[0].kind = 'stairs_up' }],
    ['높이가 다른 좌표', 'invalid_geometry', (i) => { i.route.segments[0].to.positionMapM.y++ }],
  ]
  it.each(blocked)('%s에서는 숨김과 2D 복구를 반환한다', (_label, reason, mutate) => {
    const { renderInput: input } = arFixture()
    // 픽스처의 공유 객체를 끊어 실제로 서로 다른 버전을 비교한다.
    const isolated = structuredClone(input)
    mutate(isolated)
    expect(evaluateArFrame(isolated)).toEqual({ mode: '2d_steps', reason })
  })

  it('앵커가 갱신돼도 화살표의 앵커 상대 좌표는 그대로 유지된다', () => {
    const { renderInput: input } = arFixture()
    const initial = evaluateArFrame(input)
    input.frame.anchor!.poseAr.position.x++
    input.frame.cameraPoseAr.position.x++
    const updated = evaluateArFrame(input)
    expect(updated.mode).toBe('floor_arrow')
    if (initial.mode === 'floor_arrow' && updated.mode === 'floor_arrow') {
      expect(updated.arrowInAnchor).toEqual(initial.arrowInAnchor)
      expect(arrowPositionAr(updated, input.frame)!.x).toBeCloseTo(11)
      expect(updated.positionMapM.x).toBeCloseTo(initial.positionMapM.x)
    }
  })
})

describe('현재 경로 계약의 AR 기하 어댑터', () => {
  it('기존 화면 모델에도 서버의 지도 버전·waypoint 좌표·step 연결을 보존한다', () => {
    const { routeOut } = arFixture()
    const active = toActiveRoute(routeOut)
    expect(active.arGeometry).toMatchObject({ mapId: routeOut.map_id, mapVersion: routeOut.map_version, routeRevision: routeOut.route_revision })
    expect(active.arGeometry!.segments[0].to.positionMapM).toEqual(routeOut.waypoints[1].position_map_m)
    routeOut.waypoints[1].position_map_m.x = 200
    expect(active.arGeometry!.segments[0].to.positionMapM.x).toBe(4)
  })

  it('층 전환을 제거하거나 다음 층 좌표를 현재 층에 투영하지 않는다', () => {
    const { routeOut } = arFixture()
    routeOut.waypoints[1].floor_id = 'F2'
    routeOut.waypoints[1].position_map_m.y = 5
    expect(toArRoute(routeOut)!.segments[0].to).toMatchObject({ floorId: 'F2', positionMapM: { y: 5 } })
  })

  it('waypoint 순서·수·좌표가 불완전하면 기존 2D 경로만 남긴다', () => {
    const { routeOut } = arFixture()
    routeOut.steps[0].to_node_id = '잘못된 연결'
    expect(toActiveRoute(routeOut).arGeometry).toBeNull()
    routeOut.steps[0].to_node_id = 'b'
    routeOut.waypoints[1].position_map_m.x = NaN
    expect(toArRoute(routeOut)).toBeNull()
    routeOut.waypoints.pop()
    expect(toArRoute(routeOut)).toBeNull()
  })
})
