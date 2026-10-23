/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: VITE_API_MODE 해석(parseApiMode) 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { parseApiMode } from './mode'

describe('parseApiMode', () => {
  it('값이 없으면 http를 쓴다', () => {
    expect(parseApiMode(undefined)).toBe('http')
    expect(parseApiMode('')).toBe('http')
  })

  it('mock이라고 명시했을 때만 mock을 쓴다', () => {
    expect(parseApiMode('mock')).toBe('mock')
    expect(parseApiMode('http')).toBe('http')
  })

  it('모르는 값은 http로 본다', () => {
    expect(parseApiMode('MOCK')).toBe('http')
    expect(parseApiMode('server')).toBe('http')
  })
})
