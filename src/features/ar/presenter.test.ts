/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 추적 복구·무응답 프레임·재정합·층 전환·취소 뒤 지연 요청을 렌더 포트 경계에서 검증한다
 */
import { describe, expect, it, vi } from 'vitest'
import { arFixture } from '../../test/fixtures/ar'
import { createArPresenter } from './presenter'

function setup() {
  const { renderInput: input } = arFixture()
  const apply = vi.fn()
  const diagnostic = vi.fn()
  const presenter = createArPresenter({ apply }, diagnostic)
  presenter.setContext({ ...input.scope, alignmentId: input.expectedAlignmentId })
  return { input, apply, diagnostic, presenter }
}

describe('AR 렌더 수명과 지연 결과', () => {
  it('추적 제한 순간 숨기고 grace 안에도 명시적인 재검증이 있어야 다시 표시한다', () => {
    const { input, presenter, apply } = setup()
    expect(presenter.present(input).mode).toBe('floor_arrow')
    input.frame.tracking = 'limited'
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'tracking_unavailable' })
    expect(apply).toHaveBeenLastCalledWith({ mode: '2d_steps', reason: 'tracking_unavailable' })
    input.nowMs = input.frame.capturedAtMs = 1050
    input.frame.tracking = 'tracking'
    input.frame.recoveryValidatedAlignmentId = input.expectedAlignmentId
    expect(presenter.present(input).mode).toBe('floor_arrow')
  })

  it('grace 안에 추적 상태만 돌아온 경우 이전 정합을 폐기한다', () => {
    const { input, presenter } = setup()
    input.frame.tracking = 'lost'
    presenter.present(input)
    input.frame.tracking = 'tracking'
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'realignment_required' })
    input.frame.recoveryValidatedAlignmentId = input.expectedAlignmentId
    expect(presenter.present(input).mode).toBe('2d_steps')
  })

  it('grace를 넘긴 복구는 새 정합 id 없이는 렌더하지 않는다', () => {
    const { input, presenter } = setup()
    input.frame.tracking = 'lost'
    presenter.present(input)
    input.nowMs = input.frame.capturedAtMs = 1600
    input.frame.tracking = 'tracking'
    input.frame.recoveryValidatedAlignmentId = input.expectedAlignmentId
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'realignment_required' })
    input.expectedAlignmentId = input.alignment.alignmentId = input.binding.alignmentId = '새 정합'
    presenter.setContext({ ...input.scope, alignmentId: input.expectedAlignmentId })
    expect(presenter.present(input).mode).toBe('floor_arrow')
  })

  it('센서 콜백이 멈춰도 업데이트 루프가 오래된 화살표를 숨긴다', () => {
    const { input, presenter } = setup()
    presenter.present(input)
    expect(presenter.tick(1101)).toEqual({ mode: '2d_steps', reason: 'frame_stale' })
    presenter.tick(1700)
    input.nowMs = input.frame.capturedAtMs = 1701
    input.frame.recoveryValidatedAlignmentId = input.expectedAlignmentId
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'realignment_required' })
  })

  it('층 전환 단계에서 숨긴 정합은 단계 번호를 되돌려도 살아나지 않는다', () => {
    const { input, presenter } = setup()
    input.route.segments[0].to.floorId = 'F2'
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'floor_transition' })
    input.route.segments[0].to.floorId = 'F1'
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'realignment_required' })
  })

  it('먼저 도착한 최신 프레임을 옛 프레임으로 덮어쓰지 않는다', () => {
    const { input, presenter } = setup()
    const old = structuredClone(input)
    input.nowMs = input.frame.capturedAtMs = 1050
    presenter.present(input)
    old.nowMs = 1060
    expect(presenter.present(old)).toEqual({ mode: '2d_steps', reason: 'frame_stale' })
  })

  it('새 경로 요청·재정합·취소 뒤 이전 비동기 결과를 반영할 수 없다', () => {
    const { input, presenter } = setup()
    const first = presenter.beginRouteRequest()
    const second = presenter.beginRouteRequest()
    expect(presenter.isCurrent(first)).toBe(false)
    expect(presenter.isCurrent(second)).toBe(true)
    presenter.setContext({ ...input.scope, alignmentId: '새 정합' })
    expect(presenter.isCurrent(second)).toBe(false)
    const third = presenter.beginRouteRequest()
    presenter.stop()
    expect(presenter.isCurrent(third)).toBe(false)
    expect(presenter.present(input).mode).toBe('2d_steps')
  })

  it('AR 세션 리셋 뒤 이전 세션의 프레임과 경로를 다시 표시하지 않는다', () => {
    const { input, presenter } = setup()
    presenter.present(input)
    presenter.setContext({ ...input.scope, arSessionId: '새 AR 세션', alignmentId: '새 정합' })
    expect(presenter.present(input)).toEqual({ mode: '2d_steps', reason: 'scope_mismatch' })
  })

  it('로컬 진단은 상태가 바뀔 때만 증가하며 서버 이벤트로 전송하지 않는다', () => {
    const { input, presenter, diagnostic } = setup()
    presenter.present(input)
    presenter.present(input)
    input.frame.tracking = 'lost'
    presenter.present(input)
    expect(diagnostic.mock.calls.map(([event]) => event.eventSeq)).toEqual([1, 2, 3])
  })
})
