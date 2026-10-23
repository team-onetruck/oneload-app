/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 앱이 쓰는 서버 호출 진입점. 엔드포인트별 함수를 현재 ApiAdapter로 넘긴다
 */
import { createApiClient } from './client'
import { createHttpAdapter } from './httpAdapter'
import type { ApiAdapter } from './types'

let adapter: ApiAdapter = createHttpAdapter(createApiClient())

// 작업 6에서 서버 없이 데모를 돌릴 mock 어댑터를 여기로 끼운다.
export function setApiAdapter(next: ApiAdapter) {
  adapter = next
}

// 호출할 때마다 현재 어댑터를 읽어서, 어댑터를 바꾼 뒤에도 같은 함수를 그대로 쓸 수 있다.
export const getHealth: ApiAdapter['getHealth'] = () => adapter.getHealth()
export const getMaps: ApiAdapter['getMaps'] = () => adapter.getMaps()
export const getMapGraph: ApiAdapter['getMapGraph'] = (mapId) => adapter.getMapGraph(mapId)
export const searchPois: ApiAdapter['searchPois'] = (mapId, query) => adapter.searchPois(mapId, query)
export const createSession: ApiAdapter['createSession'] = (body) => adapter.createSession(body)
export const patchSession: ApiAdapter['patchSession'] = (sessionId, body) => adapter.patchSession(sessionId, body)
export const getNavigationState: ApiAdapter['getNavigationState'] = (sessionId) => adapter.getNavigationState(sessionId)
export const sendMessage: ApiAdapter['sendMessage'] = (sessionId, body) => adapter.sendMessage(sessionId, body)
export const postLocalization: ApiAdapter['postLocalization'] = (sessionId, body) =>
  adapter.postLocalization(sessionId, body)
export const confirmLocation: ApiAdapter['confirmLocation'] = (sessionId, body) => adapter.confirmLocation(sessionId, body)
export const createRoute: ApiAdapter['createRoute'] = (sessionId, body) => adapter.createRoute(sessionId, body)
export const postNavigationEvents: ApiAdapter['postNavigationEvents'] = (sessionId, body) =>
  adapter.postNavigationEvents(sessionId, body)
export const postFeedback: ApiAdapter['postFeedback'] = (sessionId, body) => adapter.postFeedback(sessionId, body)
export const getSavedSessionId: ApiAdapter['getSavedSessionId'] = () => adapter.getSavedSessionId()
export const clearSession: ApiAdapter['clearSession'] = () => adapter.clearSession()

export { ApiError, isApiError, isAiServiceUnavailable, isRevisionConflict } from './errors'
export type { ApiErrorCode, ClientErrorCode, ServerErrorCode } from './errors'
export type * from './types'
