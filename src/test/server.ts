/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: vitest(Node)에서 백엔드 대신 응답하는 MSW 서버
 */
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

// 테스트 하나에서만 응답을 바꾸려면 server.use(...)로 덮어쓴다. 매 테스트 뒤 원래 핸들러로 돌아간다.
export const server = setupServer(...handlers)
