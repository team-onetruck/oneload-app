/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 상단 필·설정 패널 제목·시작 화면 문구가 모드(mock 데모 / http 실서버)에 따라 바뀌는지 검증한다
 */
import { describe, expect, it } from 'vitest'
import { modeCopy } from './i18n'

describe('modeCopy', () => {
  it('mock(데모)은 Demo·Demo controls·프로토타입 문구를 그대로 쓴다', () => {
    const copy = modeCopy(true)
    expect([copy.pill.en, copy.panel.en, copy.pill.ko, copy.panel.ko]).toEqual(['Demo', 'Demo controls', '데모', '데모 설정'])
    expect(copy.note.en).toMatch(/^Prototype\./)
  })

  it('http(실서버 연결)는 Live·Dev controls·서버 연결 문구를 쓴다', () => {
    const copy = modeCopy(false)
    expect([copy.pill.en, copy.panel.en, copy.pill.ko, copy.panel.ko]).toEqual(['Live', 'Dev controls', '실서버', '개발자 설정'])
    expect(copy.note.en).toMatch(/^Connected to the Hangil server\./)
    expect(copy.note.ko).toMatch(/^한길 서버에 연결돼 있어요\./)
    expect(copy.note.en).not.toContain('Prototype')
  })
})
