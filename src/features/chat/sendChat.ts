/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 채팅 메시지 한 번을 POST /messages로 보내고, 실패하면 오류 복구(같은 Idempotency-Key 재시도, INVALID_STATE 재동기화)로 넘긴다
 */
import { ApiError } from '../../api'
import type { ApiAdapter, MessageOut, MutationOptions, NavigationStateOut, SendMessageIn } from '../../api'
import type { RecoveryValue } from '../recovery/context'
import { sendWithRecovery } from '../recovery/retry'
import { toErrorView } from './toViewModel'
import type { ErrorView } from './toViewModel'

export interface ChatHooks {
  fail: RecoveryValue['fail']
  onReply(res: MessageOut): void
  // 실패한 말풍선에 보여 줄 오류
  onError(view: ErrorView): void
  // 오류 알림에서 '다시 시도'를 눌러 다시 보내기 시작할 때. 말풍선을 다시 '확인 중'으로 바꾼다
  onRetry(): void
  // 409 INVALID_STATE 뒤 다시 읽은 서버 상태
  onResync(state: NavigationStateOut): void
  // 오류 알림의 '목록에서 고르기' (목적지 목록)
  manual(): void
}

export interface ChatRequest {
  api: Pick<ApiAdapter, 'sendMessage' | 'getNavigationState'>
  sessionId: string
  body: SendMessageIn
  hooks: ChatHooks
  timeoutMs?: number
  // 데모 패널의 "다음 AI 요청 실패시키기": 첫 시도는 보내지 않고 타임아웃으로 처리한다. 다시 시도는 실제로 보낸다
  simulateTimeout?: boolean
}

export function sendChat({ api, sessionId, body, hooks, timeoutMs, simulateTimeout = false }: ChatRequest): Promise<void> {
  let simulate = simulateTimeout
  const send = (options: MutationOptions) => {
    if (simulate) {
      simulate = false
      return Promise.reject(new ApiError(0, 'TIMEOUT', 'demo: simulated timeout', null, { retryable: true }))
    }
    // 다시 시도에서는 options에 처음 요청의 키가 들어 있다. 본문은 처음과 같은 것을 다시 보낸다
    return api.sendMessage(sessionId, body, timeoutMs === undefined ? options : { ...options, timeoutMs })
  }

  return sendWithRecovery(send, {
    onSuccess: hooks.onReply,
    manual: hooks.manual,
    fail: (error, handlers = {}) => {
      const view = toErrorView(error)
      hooks.onError(view)
      // 지금 단계에서 할 수 없는 요청이라 다시 보내지 않는다. 서버 상태를 다시 읽어 맞는 화면으로 간다
      if (view.reason === 'resync') return void resync(api, sessionId, hooks)
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

async function resync(api: ChatRequest['api'], sessionId: string, hooks: ChatHooks) {
  try {
    hooks.onResync(await api.getNavigationState(sessionId))
  } catch (error) {
    hooks.fail(error)
  }
}
