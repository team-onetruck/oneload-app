/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 모든 vitest 파일에서 MSW 서버를 켜고, 테스트마다 핸들러와 가짜 백엔드 상태를 되돌린다
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { mockBackend } from './handlers'
import { server } from './server'

// 핸들러가 없는 요청은 실제 네트워크로 나가지 않고 실패한다.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  server.resetHandlers()
  mockBackend.reset()
})

afterAll(() => server.close())
