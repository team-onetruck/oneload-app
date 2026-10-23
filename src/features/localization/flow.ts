/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 위치 인식과 위치 확정 요청 한 번을 보내고, 실패하면 오류 복구(같은 키 재시도, revision·INVALID_STATE 재동기화)로 넘긴다
 */
import { isApiError } from '../../api/errors'
import { withRevisionResync } from '../../api/revision'
import type { ApiAdapter, ConfirmationOut, MutationOptions, NavigationStateOut } from '../../api/types'
import type { RecoveryValue } from '../recovery/context'
import { sendWithRecovery } from '../recovery/retry'
import { confirmChosenLocation } from './confirm'
import type { LocationChoice } from './confirm'
import { requestLocalization } from './locate'
import type { LocateRequest, LocateResult } from './locate'

type LocationApi = Pick<ApiAdapter, 'postLocalization' | 'confirmLocation' | 'getNavigationState'>

export interface LocationHooks<T> {
  fail: RecoveryValue['fail']
  onSuccess(out: T): void
  // 409 INVALID_STATE: 지금 단계에서 할 수 없는 요청이라 다시 보내지 않고, 다시 읽은 서버 상태로 맞는 화면에 간다
  onInvalidState(state: NavigationStateOut): void
  // 오류 알림에서 '다시 시도'를 눌러 다시 보내기 시작할 때
  onRetry(): void
  // 오류 알림의 '목록에서 고르기' (위치 직접 선택 화면)
  manual(): void
}

function recoverable<T>(api: LocationApi, sessionId: string, send: (options: MutationOptions) => Promise<T>, hooks: LocationHooks<T>) {
  return sendWithRecovery(send, {
    onSuccess: hooks.onSuccess,
    manual: hooks.manual,
    fail: (error, handlers = {}) => {
      if (isApiError(error) && error.code === 'INVALID_STATE') return void resync(api, sessionId, hooks)
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

async function resync<T>(api: LocationApi, sessionId: string, hooks: LocationHooks<T>) {
  try {
    hooks.onInvalidState(await api.getNavigationState(sessionId))
  } catch (error) {
    hooks.fail(error)
  }
}

export interface PhotoRequest {
  api: LocationApi
  req: LocateRequest
  // 이미 압축한 JPEG. 다시 시도해도 같은 사진을 보낸다
  image: Blob
  hooks: LocationHooks<LocateResult>
}

// 503은 오류가 아니라 manual 결과로 onSuccess에 온다 (locate.ts). 위치는 여기서 확정하지 않는다.
export function sendPhoto({ api, req, image, hooks }: PhotoRequest): Promise<void> {
  return recoverable(api, req.sessionId, (options) => requestLocalization(api, req, image, options), hooks)
}

export interface ConfirmRequest {
  api: LocationApi
  sessionId: string
  // 사용자가 누른 선택. 화면의 버튼에서만 만든다
  choice: LocationChoice
  // 직전 서버 응답의 session.revision
  revision: number
  // 409 REVISION_CONFLICT 뒤 다시 읽은 서버 상태
  onResync?: (state: NavigationStateOut) => void
  hooks: LocationHooks<ConfirmationOut>
}

export function sendConfirmation({ api, sessionId, choice, revision, onResync, hooks }: ConfirmRequest): Promise<void> {
  const send = (options: MutationOptions) => {
    // 받은 키는 처음 본문(처음 revision)에만 쓴다. 재동기화한 뒤 보내는 요청은 본문이 달라 새 키를 받는다.
    let first = true
    return withRevisionResync(
      (expected) => {
        const keyed = first ? options : {}
        first = false
        return confirmChosenLocation(api, sessionId, choice, expected, keyed)
      },
      { revision, resync: () => api.getNavigationState(sessionId), onResync },
    )
  }
  return recoverable(api, sessionId, send, hooks)
}
