/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로·이벤트 오류 코드가 알맞은 한국어/영어 사용자 문구로 바뀌는지 검증하는 단위 테스트
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors'
import type { ApiErrorCode } from '../../api/errors'
import { UI } from '../../i18n'
import { ROUTE_ERROR_FALLBACK, ROUTE_ERROR_TEXT, routeErrorText } from './messages'

const error = (code: ApiErrorCode, status = 409) => new ApiError(status, code, 'server message')

describe('routeErrorText', () => {
  it('등록된 경로가 없으면 기존 안내 문구(UI.noRoute)를 쓴다', () => {
    expect(routeErrorText(error('ROUTE_NOT_FOUND', 422))).toEqual(UI.noRoute)
  })

  it('지도 버전 불일치는 처음부터 다시 시작하라고 안내한다', () => {
    expect(routeErrorText(error('MAP_VERSION_MISMATCH')).ko).toContain('지도')
    expect(routeErrorText(error('MAP_VERSION_MISMATCH')).en).toContain('map')
  })

  it('위치 미확정, 상태 불일치, 목적지 불일치를 서로 다른 문구로 구분한다', () => {
    const texts = (['LOCATION_NOT_CONFIRMED', 'INVALID_STATE', 'INVALID_INPUT'] as const).map((c) => routeErrorText(error(c)).ko)
    expect(new Set(texts).size).toBe(3)
  })

  it('세션 만료·인증 오류는 모두 다시 시작 안내로 묶는다', () => {
    const ended = routeErrorText(error('SESSION_EXPIRED', 401))
    expect(routeErrorText(error('SESSION_UNAUTHORIZED', 401))).toEqual(ended)
    expect(routeErrorText(error('SESSION_FORBIDDEN', 403))).toEqual(ended)
  })

  it('타임아웃과 네트워크 오류는 연결 확인 문구로 보여 준다', () => {
    expect(routeErrorText(new ApiError(0, 'TIMEOUT', ''))).toEqual(routeErrorText(new ApiError(0, 'NETWORK', '')))
  })

  it('목록에 없는 코드나 ApiError가 아닌 오류는 일반 문구로 보여 준다', () => {
    expect(routeErrorText(error('INTERNAL', 500))).toEqual(ROUTE_ERROR_FALLBACK)
    expect(routeErrorText(new TypeError('boom'))).toEqual(ROUTE_ERROR_FALLBACK)
    expect(routeErrorText(undefined)).toEqual(ROUTE_ERROR_FALLBACK)
  })

  it('서버의 개발용 message를 화면 문구로 쓰지 않는다', () => {
    expect(Object.values(routeErrorText(error('INVALID_STATE')))).not.toContain('server message')
  })

  it('모든 문구에 한국어와 영어가 다 있다', () => {
    for (const text of [...Object.values(ROUTE_ERROR_TEXT), ROUTE_ERROR_FALLBACK]) {
      expect(text?.en.trim()).toBeTruthy()
      expect(text?.ko.trim()).toBeTruthy()
    }
  })
})
