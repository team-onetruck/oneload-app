/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 복구 화면(세션 종료)의 문구와 버튼을 서버 렌더링 결과로 검증하는 단위 테스트
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api/errors'
import type { ApiErrorCode } from './api/errors'
import type { Lang } from './data'
import { recoveryFor } from './features/recovery/recovery'
import type { Recovery, SessionEndCause } from './features/recovery/recovery'
import { UI } from './i18n'
import { ErrorNoticeView, SessionEndedView } from './screens'

const CAUSES: SessionEndCause[] = ['expired', 'unauthorized', 'forbidden', 'map_changed']

const ended = (cause: SessionEndCause, lang: Lang = 'ko') =>
  renderToStaticMarkup(createElement(SessionEndedView, { cause, lang, onRestart: () => {} }))

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''))

describe('SessionEndedView', () => {
  for (const cause of CAUSES)
    it(`${cause}: 버튼은 '다시 시작' 하나뿐이고 진행 상태를 잃는다고 알린다`, () => {
      for (const lang of ['ko', 'en'] as const) {
        const html = ended(cause, lang)
        expect(buttons(html).map((b) => b.trim())).toEqual([UI.restart[lang]])
        expect(html).toContain(UI.endedLoss[lang])
      }
    })

  it('만료 문구는 expired일 때만 쓴다', () => {
    expect(ended('expired')).toContain('오래 사용하지 않아 세션이 끝났어요')
    for (const cause of CAUSES.filter((c) => c !== 'expired')) expect(ended(cause)).not.toContain('오래 사용하지 않아')
  })

  it('cause마다 정해진 문구를 보여 준다', () => {
    expect(ended('unauthorized')).toContain('세션을 확인할 수 없어요')
    expect(ended('map_changed')).toContain('지도가 바뀌어 새로 시작해야 해요')
    expect(ended('forbidden')).toContain(UI.endedForbidden.ko)
  })
})

type NoticeRecovery = Exclude<Recovery, { type: 'sessionEnded' }>

const notice = (n: NoticeRecovery, lang: Lang = 'ko') =>
  renderToStaticMarkup(createElement(ErrorNoticeView, { notice: n, lang, onAction: () => {} }))

describe('ErrorNoticeView', () => {
  it('타임아웃은 문구와 다시 시도·목록에서 고르기 버튼을 보여 준다', () => {
    const html = notice({ type: 'notice', reason: 'timeout', actions: ['retry', 'manual'] })
    expect(html).toContain(UI.errTimeout.ko)
    expect(buttons(html).map((b) => b.trim())).toEqual(['다시 시도', '목록에서 고르기'])
  })

  it('재시도 뒤에도 남은 충돌은 다시 시도와 처음으로를 보여 준다', () => {
    const html = notice({ type: 'notice', reason: 'conflict', actions: ['retry', 'home'] }, 'en')
    expect(html).toContain(UI.errConflict.en)
    expect(buttons(html).map((b) => b.trim())).toEqual([UI.retry.en, UI.newTrip.en])
  })

  it('사진 인식 503은 위치를 추측하지 않고 목록에서 고르기를 먼저 보여 준다', () => {
    const html = notice({ type: 'notice', reason: 'ai_unavailable', actions: ['manual', 'retry'] })
    expect(html).toContain(UI.errAiUnavailable.ko)
    expect(buttons(html).map((b) => b.trim())[0]).toBe('목록에서 고르기')
  })

  it('위치 확인 이동은 사유에 맞는 버튼 하나를 보여 준다', () => {
    expect(buttons(notice({ type: 'relocate', reason: 'location_not_confirmed' })).map((b) => b.trim())).toEqual([UI.findMe.ko])
    expect(buttons(notice({ type: 'relocate', reason: 'localization_expired' })).map((b) => b.trim())).toEqual([UI.retake.ko])
  })

  it('INVALID_STATE 재동기화는 처음으로를 보여 준다', () => {
    expect(buttons(notice({ type: 'resync', actions: ['home'] })).map((b) => b.trim())).toEqual(['처음으로'])
  })

  // recoveryFor가 세션 종료가 아닌 결과를 낼 수 있는 모든 코드에 대해, 화면에 버튼이 하나 이상 남는지 본다.
  const CODES: ApiErrorCode[] = [
    'BAD_REQUEST', 'INVALID_INPUT', 'IDEMPOTENCY_KEY_REUSED', 'NOT_FOUND', 'MAP_NOT_FOUND', 'POI_NOT_FOUND',
    'LOCALIZATION_NOT_FOUND', 'ROUTE_NOT_FOUND', 'LOCALIZATION_EXPIRED', 'REVISION_CONFLICT', 'INVALID_STATE',
    'LOCATION_NOT_CONFIRMED', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'AI_SERVICE_UNAVAILABLE', 'INTERNAL',
    'NETWORK', 'TIMEOUT', 'UNEXPECTED_RESPONSE',
  ]
  for (const code of CODES)
    it(`${code}: 재시도·직접 선택이 없는 곳에서도 버튼이 하나 이상 있다`, () => {
      const recovery = recoveryFor(new ApiError(0, code, code), { retry: false, manual: false })
      if (recovery.type === 'sessionEnded') throw new Error(`${code}는 세션 종료가 아니어야 한다`)
      for (const lang of ['ko', 'en'] as const) expect(buttons(notice(recovery, lang)).length).toBeGreaterThan(0)
    })
})
