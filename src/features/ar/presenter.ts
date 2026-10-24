/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 네이티브 렌더러 경계에서 추적 유실·층 전환·지연 응답을 차단하고 로컬 진단 순서를 유지한다
 */
import { evaluateArFrame, validPolicy } from './render'
import type { RenderDecision, RenderInput } from './render'
import type { ArScope } from './types'

export interface ArContext extends ArScope { alignmentId: string }
export interface RequestTicket { generation: number; operationSeq: number }
export interface ArDiagnostic {
  eventSeq: number
  context: ArContext | null
  decision: RenderDecision
}

const contextKey = (c: ArContext) => JSON.stringify([c.mapId, c.mapVersion, c.floorId, c.arSessionId, c.alignmentId])

// 네이티브 엔진은 숨김 명령을 받으면 실제 화살표 오브젝트를 비활성화해야 한다.
// 이 포트에는 실제 엔진 구현이 아직 없으며 테스트가 주입하는 포트와 구분한다.
export interface ArRenderPort { apply(decision: RenderDecision): void }

export function createArPresenter(port: ArRenderPort, onDiagnostic: (event: ArDiagnostic) => void = () => {}) {
  let context: ArContext | null = null
  let generation = 0
  let operationSeq = 0
  let eventSeq = 0
  let lastInput: RenderInput | null = null
  let lastTimeMs = -Infinity
  let latestCaptureMs = -Infinity
  let lossAtMs: number | null = null
  let invalidated = false
  let decision: RenderDecision = { mode: '2d_steps', reason: 'runtime_unavailable' }

  function publish(next: RenderDecision) {
    const changed = decision.mode !== next.mode || (decision.mode === '2d_steps' && next.mode === '2d_steps' && decision.reason !== next.reason)
    decision = next
    port.apply(next)
    if (changed) onDiagnostic({ eventSeq: ++eventSeq, context: context && { ...context }, decision: next })
    return next
  }

  function present(input: RenderInput): RenderDecision {
    if (!context || contextKey(context) !== contextKey({ ...input.scope, alignmentId: input.expectedAlignmentId })) return publish({ mode: '2d_steps', reason: 'scope_mismatch' })
    if (!Number.isFinite(input.nowMs) || input.nowMs < lastTimeMs || input.frame.capturedAtMs < latestCaptureMs) return publish({ mode: '2d_steps', reason: 'frame_stale' })
    lastTimeMs = input.nowMs
    latestCaptureMs = input.frame.capturedAtMs
    lastInput = input
    if (invalidated) return publish({ mode: '2d_steps', reason: 'realignment_required' })
    let next = evaluateArFrame(input)
    const unavailable = next.mode === '2d_steps' && ['tracking_unavailable', 'anchor_invalid', 'frame_stale'].includes(next.reason)
    if (unavailable) {
      lossAtMs ??= input.nowMs
      if (validPolicy(input.policy) && input.nowMs - lossAtMs > input.policy.trackingGraceMs) invalidated = true
    } else if (lossAtMs !== null) {
      const beyondGrace = !validPolicy(input.policy) || input.nowMs - lossAtMs > input.policy.trackingGraceMs
      const validated = input.frame.recoveryValidatedAlignmentId === context.alignmentId
      if (beyondGrace || !validated) {
        invalidated = true
        next = { mode: '2d_steps', reason: 'realignment_required' }
      } else {
        lossAtMs = null
      }
    }
    // 층 전환 단계에 진입한 정합은 단계 번호를 되돌려도 재사용하지 않는다.
    if (next.mode === '2d_steps' && ['floor_transition', 'alignment_expired', 'travel_exceeded', 'quality_unverified'].includes(next.reason)) invalidated = true
    return publish(next)
  }

  return {
    setContext(next: ArContext | null) {
      if (next && context && contextKey(next) === contextKey(context)) return
      context = next && { ...next }
      generation++
      lastInput = null
      lastTimeMs = -Infinity
      latestCaptureMs = -Infinity
      lossAtMs = null
      invalidated = false
      publish({ mode: '2d_steps', reason: 'realignment_required' })
    },
    // 하나의 경로 요청을 새로 시작하면 이전 요청·재시도 결과를 더 이상 적용하지 않는다.
    beginRouteRequest(): RequestTicket { return { generation, operationSeq: ++operationSeq } },
    isCurrent(ticket: RequestTicket): boolean { return context !== null && ticket.generation === generation && ticket.operationSeq === operationSeq },
    present,
    // 프레임 공급이 중단돼도 엔진의 업데이트 루프에서 호출하여 오래된 화살표를 숨긴다.
    tick(nowMs: number): RenderDecision {
      return lastInput ? present({ ...lastInput, nowMs }) : publish({ mode: '2d_steps', reason: 'runtime_unavailable' })
    },
    stop() {
      context = null
      generation++
      lastInput = null
      publish({ mode: '2d_steps', reason: 'runtime_unavailable' })
    },
  }
}
