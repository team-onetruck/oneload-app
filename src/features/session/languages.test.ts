/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 기기 언어 목록에서 화면 언어를 고르는 규칙을 검증한다
 */
import { describe, expect, it } from 'vitest'
import { LANGUAGE_OPTIONS, detectDeviceLang } from './languages'

describe('detectDeviceLang', () => {
  it('한국어 기기는 지역 코드가 붙어도 ko를 고른다', () => {
    expect(detectDeviceLang(['ko-KR'])).toBe('ko')
    expect(detectDeviceLang(['ko'])).toBe('ko')
  })

  it('영어 기기는 en을 고른다', () => {
    expect(detectDeviceLang(['en-US'])).toBe('en')
  })

  it('지원하지 않는 언어는 건너뛰고 다음 우선순위를 본다', () => {
    expect(detectDeviceLang(['ja-JP', 'ko-KR', 'en-US'])).toBe('ko')
  })

  it('지원하는 언어가 하나도 없거나 목록이 비면 영어다', () => {
    expect(detectDeviceLang(['ja-JP', 'fr'])).toBe('en')
    expect(detectDeviceLang([])).toBe('en')
    expect(detectDeviceLang(undefined)).toBe('en')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(detectDeviceLang(['KO-kr'])).toBe('ko')
  })
})

describe('LANGUAGE_OPTIONS', () => {
  it('언어 코드가 겹치지 않는다', () => {
    const codes = LANGUAGE_OPTIONS.map((o) => o.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})
