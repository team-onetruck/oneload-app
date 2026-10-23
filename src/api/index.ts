/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 앱이 쓰는 서버 호출 진입점. 엔드포인트별 함수를 현재 ApiAdapter로 넘긴다
 */
import type { PhotoScenario } from '../data'
import { createApiClient } from './client'
import { createHttpAdapter } from './httpAdapter'
import { createMockAdapter } from './mockAdapter'
import { API_MODE } from './mode'
import type { ApiAdapter } from './types'

// 모드 분기는 여기 한 곳이다. mock은 서버 없이 기존 데모 규칙(assistant.ts, data.ts, route.ts)으로 같은 모양의 응답을 준다
const mock = API_MODE === 'mock' ? createMockAdapter() : null
let adapter: ApiAdapter = mock ?? createHttpAdapter(createApiClient())

// 테스트가 다른 어댑터를 끼울 때 쓴다
export function setApiAdapter(next: ApiAdapter) {
  adapter = next
}

// 데모 패널에 보일 모드 이름
export const apiMode = API_MODE
// 데모 사진 버튼과 업로드 결과 스위치는 서버 없는 데모(mock)에서만 쓴다
export const demoMode = mock !== null
// 다음 사진 위치 인식 결과를 데모 사진 종류로 정한다. http 모드에서는 아무 일도 하지 않는다
export const setDemoPhotoResult = (scenario: PhotoScenario) => mock?.setPhotoScenario(scenario)

// 호출할 때마다 현재 어댑터를 읽어서, 어댑터를 바꾼 뒤에도 같은 함수를 그대로 쓸 수 있다.
export const getHealth: ApiAdapter['getHealth'] = (options) => adapter.getHealth(options)
export const getMaps: ApiAdapter['getMaps'] = (options) => adapter.getMaps(options)
export const getMapGraph: ApiAdapter['getMapGraph'] = (mapId, options) => adapter.getMapGraph(mapId, options)
export const searchPois: ApiAdapter['searchPois'] = (mapId, query, options) => adapter.searchPois(mapId, query, options)
export const createSession: ApiAdapter['createSession'] = (body, options) => adapter.createSession(body, options)
export const patchSession: ApiAdapter['patchSession'] = (sessionId, body, options) =>
  adapter.patchSession(sessionId, body, options)
export const getNavigationState: ApiAdapter['getNavigationState'] = (sessionId, options) =>
  adapter.getNavigationState(sessionId, options)
export const sendMessage: ApiAdapter['sendMessage'] = (sessionId, body, options) =>
  adapter.sendMessage(sessionId, body, options)
export const postLocalization: ApiAdapter['postLocalization'] = (sessionId, body, options) =>
  adapter.postLocalization(sessionId, body, options)
export const confirmLocation: ApiAdapter['confirmLocation'] = (sessionId, body, options) =>
  adapter.confirmLocation(sessionId, body, options)
export const createRoute: ApiAdapter['createRoute'] = (sessionId, body, options) =>
  adapter.createRoute(sessionId, body, options)
export const postNavigationEvents: ApiAdapter['postNavigationEvents'] = (sessionId, body, options) =>
  adapter.postNavigationEvents(sessionId, body, options)
export const postFeedback: ApiAdapter['postFeedback'] = (sessionId, body, options) =>
  adapter.postFeedback(sessionId, body, options)
export const getSavedSessionId: ApiAdapter['getSavedSessionId'] = () => adapter.getSavedSessionId()
export const clearSession: ApiAdapter['clearSession'] = () => adapter.clearSession()

export { ApiError, isApiError, isAiServiceUnavailable, isRevisionConflict } from './errors'
export type { ApiErrorCode, ClientErrorCode, ServerErrorCode } from './errors'
export type * from './types'
