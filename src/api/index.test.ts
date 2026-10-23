/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: index의 엔드포인트 함수가 호출별 옵션 인자까지 현재 ApiAdapter로 그대로 넘기는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import * as api from './index'
import type { ApiAdapter } from './types'

describe('index 엔드포인트 함수', () => {
  it('마지막 옵션 인자까지 현재 어댑터로 넘긴다', async () => {
    const received: Record<string, unknown[]> = {}
    // 어떤 메서드를 불러도 받은 인자를 기록하고 빈 응답을 돌려주는 가짜 어댑터
    const fake = new Proxy({} as ApiAdapter, {
      get:
        (_target, name: string) =>
        (...args: unknown[]) => {
          received[name] = args
          return Promise.resolve({})
        },
    })
    api.setApiAdapter(fake)
    // 인자를 그대로 넘기는지만 보므로 본문 내용은 상관없다.
    const body = {} as never
    const options = { idempotencyKey: 'key-1', timeoutMs: 1_000 }

    await api.getHealth(options)
    await api.getMaps(options)
    await api.getMapGraph('seoul-station', options)
    await api.searchPois('seoul-station', 'express', options)
    await api.createSession(body, options)
    await api.patchSession('ses_1', body, options)
    await api.getNavigationState('ses_1', options)
    await api.sendMessage('ses_1', body, options)
    await api.postLocalization('ses_1', body, options)
    await api.confirmLocation('ses_1', body, options)
    await api.createRoute('ses_1', body, options)
    await api.postNavigationEvents('ses_1', body, options)
    await api.postFeedback('ses_1', body, options)

    expect(received).toEqual({
      getHealth: [options],
      getMaps: [options],
      getMapGraph: ['seoul-station', options],
      searchPois: ['seoul-station', 'express', options],
      createSession: [body, options],
      patchSession: ['ses_1', body, options],
      getNavigationState: ['ses_1', options],
      sendMessage: ['ses_1', body, options],
      postLocalization: ['ses_1', body, options],
      confirmLocation: ['ses_1', body, options],
      createRoute: ['ses_1', body, options],
      postNavigationEvents: ['ses_1', body, options],
      postFeedback: ['ses_1', body, options],
    })
  })
})
