/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: '다시 시도'가 실패한 변경 요청을 처음과 같은 Idempotency-Key로 다시 보내게 하는 헬퍼
 */
import { isApiError } from '../../api/errors'
import type { MutationOptions } from '../../api/types'
import type { FailHandlers, RecoveryValue } from './context'

// 실패한 요청을 다시 보낼 옵션. 처음 요청의 키(ApiError.idempotencyKey)를 넣어, 첫 요청이 사실 서버에서 처리됐다면
// 저장된 응답을 돌려받고 두 번 반영되지 않게 한다 (backend/app/middleware.py). 키가 없던 요청은 options를 그대로 쓴다.
export function retryOptions(error: unknown, options: MutationOptions = {}): MutationOptions {
  return isApiError(error) && error.idempotencyKey ? { ...options, idempotencyKey: error.idempotencyKey } : options
}

// send를 처음 요청과 같은 키로 다시 부른다.
export function retryWith<T>(error: unknown, send: (options: MutationOptions) => Promise<T>): Promise<T> {
  return send(retryOptions(error))
}

export interface RecoverableCall<T> {
  fail: RecoveryValue['fail']
  onSuccess: (out: T) => void
  // 목록에서 직접 고르는 화면이 있는 단계면 넘긴다
  manual?: FailHandlers['manual']
}

// 변경 요청을 보내고, 실패하면 fail()로 넘긴다. '다시 시도'를 누르면 처음 키로 다시 보내고, 또 실패하면 다시 fail()로 간다.
// 서버는 키·경로·토큰·본문이 모두 같아야 같은 요청으로 보므로, send는 처음과 같은 본문을 만들어야 한다 (expected_revision도 처음 값).
export async function sendWithRecovery<T>(
  send: (options: MutationOptions) => Promise<T>,
  call: RecoverableCall<T>,
  options: MutationOptions = {},
): Promise<void> {
  let out: T
  try {
    out = await send(options)
  } catch (error) {
    call.fail(error, {
      retry: () => void sendWithRecovery(send, call, retryOptions(error, options)),
      manual: call.manual,
    })
    return
  }
  call.onSuccess(out)
}
