/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 오류 복구 화면(세션 종료)의 문구와 버튼을 서버 렌더링 결과로 검증하는 단위 테스트
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Lang } from './data'
import type { SessionEndCause } from './features/recovery/recovery'
import { UI } from './i18n'
import { SessionEndedView } from './screens'

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
