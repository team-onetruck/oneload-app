/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 요청 한 번과 길안내 이벤트 전달을 보내고, 실패를 오류 복구(같은 키 재시도, revision·INVALID_STATE 재동기화)로 넘긴다
 */
import { isApiError } from '../../api/errors'
import { withRevisionResync } from '../../api/revision'
import type { ApiAdapter, MutationOptions, NavigationEvent, NavigationStateOut, RouteOut, SessionStatus } from '../../api/types'
import type { RecoveryValue } from '../recovery/context'
import { retryOptions, sendWithRecovery } from '../recovery/retry'
import { isRouteAlreadyClosed, sendNavigationEvents } from './events'
import { buildRouteRequest } from './request'
import type { RouteRequestInput } from './request'

type RouteApi = Pick<ApiAdapter, 'createRoute' | 'getNavigationState'>
type EventsApi = Pick<ApiAdapter, 'postNavigationEvents' | 'getNavigationState'>

export interface RouteHooks {
  fail: RecoveryValue['fail']
  onSuccess(out: RouteOut): void
  // 409 INVALID_STATE: 다시 보내지 않고, 다시 읽은 서버 상태로 맞는 화면에 간다. error는 그 409 오류다
  onInvalidState(state: NavigationStateOut, error: unknown): void
  // 오류 알림에서 '다시 시도'를 눌러 다시 보내기 시작할 때
  onRetry(): void
}

export interface RouteRequest {
  api: RouteApi
  sessionId: string
  // 첫 시도의 revision, 목적지, 지도 버전. revision은 409 REVISION_CONFLICT 뒤 다시 읽은 값으로 바뀐다
  input: RouteRequestInput
  // 길을 잃은 뒤 같은 목적지로 다시 계산할 때 true
  reroute: boolean
  onResync?: (state: NavigationStateOut) => void
  hooks: RouteHooks
}

async function resync(api: RouteApi, sessionId: string, hooks: RouteHooks, invalid: unknown) {
  try {
    hooks.onInvalidState(await api.getNavigationState(sessionId), invalid)
  } catch (error) {
    hooks.fail(error)
  }
}

// POST /routes. 위치 확정 흐름(features/localization/flow.ts)과 같은 규칙으로 실패를 다룬다.
export function sendRoute({ api, sessionId, input, reroute, onResync, hooks }: RouteRequest): Promise<void> {
  const send = (options: MutationOptions) => {
    // 받은 키는 처음 본문(처음 revision)에만 쓴다. 재동기화한 뒤 보내는 요청은 본문이 달라 새 키를 받는다.
    let first = true
    return withRevisionResync(
      (expected) => {
        const keyed = first ? options : {}
        first = false
        return api.createRoute(sessionId, buildRouteRequest({ ...input, revision: expected }, { reroute }), keyed)
      },
      { revision: input.revision, resync: () => api.getNavigationState(sessionId), onResync },
    )
  }
  return sendWithRecovery(send, {
    onSuccess: hooks.onSuccess,
    fail: (error, handlers = {}) => {
      if (isApiError(error) && error.code === 'INVALID_STATE') return void resync(api, sessionId, hooks, error)
      const { retry } = handlers
      hooks.fail(error, {
        ...handlers,
        retry: retry && (() => {
          hooks.onRetry()
          retry()
        }),
      })
    },
  })
}

export type DeliveryOutcome =
  // 보냈다. 서버 session을 반영하고, 남은 이벤트(50개 초과분)는 다음에 보낸다
  | { kind: 'sent'; session: SessionStatus; pending: NavigationEvent[] }
  // 도착·취소가 이미 반영돼 서버가 경로를 닫았다(isRouteAlreadyClosed). 다시 읽은 서버 상태를 반영한다
  | { kind: 'closed'; state: NavigationStateOut }
  // 보내지 못했다. 대기열은 그대로 두고 다음 이벤트와 함께 보낸다. 안내 화면은 막지 않는다
  | { kind: 'failed'; error: unknown; pending: NavigationEvent[] }

export interface DeliveryRequest {
  api: EventsApi
  sessionId: string
  routeId: string | null
  // 보낼 이벤트. event_id는 만들 때 정해져 있어 다시 보내도 같은 값이다
  pending: NavigationEvent[]
}

// 길안내 이벤트를 보낸다. 다시 보낼 수 있는 오류(타임아웃, 네트워크)는 처음 요청의 키로 한 번만 조용히 다시 보낸다.
// 첫 요청이 사실 반영됐다면 서버가 저장된 응답을 돌려주므로(backend/app/middleware.py) 두 번 반영되지 않는다.
export async function deliverEvents({ api, sessionId, routeId, pending }: DeliveryRequest): Promise<DeliveryOutcome> {
  let options: MutationOptions = {}
  for (let attempt = 0; ; attempt++) {
    try {
      const { out, pending: left } = await sendNavigationEvents(api, sessionId, routeId, pending, options)
      return { kind: 'sent', session: out.session, pending: left }
    } catch (error) {
      if (isRouteAlreadyClosed(error, pending)) {
        try {
          return { kind: 'closed', state: await api.getNavigationState(sessionId) }
        } catch (resyncError) {
          return { kind: 'failed', error: resyncError, pending }
        }
      }
      const retryable = isApiError(error) && error.retryable
      if (attempt >= 1 || !retryable) return { kind: 'failed', error, pending }
      options = retryOptions(error)
    }
  }
}
