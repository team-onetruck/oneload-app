/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: VITE_API_MODE로 서버(http)와 서버 없는 데모(mock) 중 어느 쪽으로 동작할지 정한다
 */

export type ApiMode = 'http' | 'mock'

// 값이 없거나 모르는 값이면 서버를 쓴다. mock은 VITE_API_MODE=mock으로 명시했을 때만 켠다.
export function parseApiMode(raw: string | undefined): ApiMode {
  return raw === 'mock' ? 'mock' : 'http'
}

export const API_MODE: ApiMode = parseApiMode(import.meta.env.VITE_API_MODE)
