/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: ApiAdapter의 http 구현. 백엔드 /api/v1 엔드포인트를 하나씩 호출한다
 */
import type { ApiClient } from './client'
import type {
  ApiAdapter,
  ConfirmationOut,
  CreateSessionOut,
  FeedbackOut,
  GraphOut,
  HealthOut,
  LocalizationOut,
  MapsOut,
  MessageOut,
  NavigationEventsOut,
  NavigationStateOut,
  PatchSessionOut,
  PoisOut,
  RouteOut,
} from './types'

const sessionPath = (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}`
const mapPath = (mapId: string) => `/maps/${encodeURIComponent(mapId)}`

// 값이 없는 필드는 빼고 넣는다. 서버는 문자열 필드만 읽어 MessageIn으로 검증한다 (backend/app/api/conversation.py).
function toFormData(fields: Record<string, string | Blob | null | undefined>): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) if (value !== null && value !== undefined) form.append(key, value)
  return form
}

export function createHttpAdapter(client: ApiClient): ApiAdapter {
  return {
    getHealth: () => client.request<HealthOut>('/health'),
    getMaps: () => client.request<MapsOut>('/maps'),
    getMapGraph: (mapId) => client.request<GraphOut>(`${mapPath(mapId)}/graph`),
    searchPois: (mapId, query) => client.request<PoisOut>(`${mapPath(mapId)}/pois`, { query: { query } }),

    async createSession(body) {
      const out = await client.request<CreateSessionOut>('/sessions', { method: 'POST', json: body })
      client.setSession({ sessionId: out.session_id, token: out.session_token })
      return out
    },

    patchSession: (sessionId, body) =>
      client.request<PatchSessionOut>(sessionPath(sessionId), { method: 'PATCH', json: body }),

    getNavigationState: (sessionId) =>
      client.request<NavigationStateOut>(`${sessionPath(sessionId)}/navigation-state`),

    // 텍스트는 JSON, 사진이 있으면 multipart로 보낸다.
    sendMessage: (sessionId, { image, ...message }) =>
      client.request<MessageOut>(
        `${sessionPath(sessionId)}/messages`,
        image ? { method: 'POST', form: toFormData({ ...message, image }) } : { method: 'POST', json: message },
      ),

    postLocalization: (sessionId, body) =>
      client.request<LocalizationOut>(`${sessionPath(sessionId)}/localizations`, {
        method: 'POST',
        form: toFormData(body),
      }),

    confirmLocation: (sessionId, body) =>
      client.request<ConfirmationOut>(`${sessionPath(sessionId)}/location-confirmations`, {
        method: 'POST',
        json: body,
      }),

    createRoute: (sessionId, body) =>
      client.request<RouteOut>(`${sessionPath(sessionId)}/routes`, { method: 'POST', json: body }),

    postNavigationEvents: (sessionId, body) =>
      client.request<NavigationEventsOut>(`${sessionPath(sessionId)}/navigation-events`, {
        method: 'POST',
        json: body,
      }),

    postFeedback: (sessionId, body) =>
      client.request<FeedbackOut>(`${sessionPath(sessionId)}/feedback`, { method: 'POST', json: body }),

    getSavedSessionId: () => client.getSession()?.sessionId ?? null,
    clearSession: () => client.clearSession(),
  }
}
