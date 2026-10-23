/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 복구 상태를 들고 있는 Provider. store가 fail()을 쓸 수 있게 AppProvider 바깥에 둔다
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { clearSession } from '../../api'
import { RecoveryContext } from './context'
import type { FailHandlers, Notice, RecoveryValue } from './context'
import { recoveryFor } from './recovery'

export function RecoveryProvider({ children }: { children: ReactNode }) {
  const [ended, setEnded] = useState<RecoveryValue['ended']>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const fail = (error: unknown, handlers: FailHandlers = {}) => {
    const recovery = recoveryFor(error, { retry: Boolean(handlers.retry), manual: Boolean(handlers.manual) })
    if (recovery.type === 'sessionEnded') {
      // 이 토큰으로는 더 요청할 수 없다. 새 세션은 사용자가 '다시 시작'을 누른 뒤에 만든다.
      clearSession()
      setNotice(null)
      setEnded({ expired: recovery.expired })
      return
    }
    setNotice({ ...recovery, ...handlers })
  }

  const clear = () => {
    setEnded(null)
    setNotice(null)
  }

  return <RecoveryContext.Provider value={{ ended, notice, fail, clear }}>{children}</RecoveryContext.Provider>
}
