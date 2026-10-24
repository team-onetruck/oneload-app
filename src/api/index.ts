/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 앱이 쓰는 서버 호출 진입점. 엔드포인트별 함수를 현재 ApiAdapter로 넘긴다
 */
import { createApiClient } from './client'
import { createHttpAdapter } from './httpAdapter'
import type { ApiAdapter } from './types'

// 앱은 항상 실제 서버를 호출한다. mock 어댑터는 단위 테스트에서만 직접 사용한다.
const adapter: ApiAdapter = createHttpAdapter(createApiClient())

// 모든 호출은 같은 HTTP 어댑터를 거친다.
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
