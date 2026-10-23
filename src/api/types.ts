/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 생성된 OpenAPI 타입에서 요청·응답 타입을 꺼내고, 서버 구현을 바꿔 끼울 ApiAdapter 경계를 정의한다
 */
import type { components, operations } from './schema'

type Schemas = components['schemas']

// 요청 본문
export type CreateSessionIn = Schemas['CreateSessionIn']
export type PatchSessionIn = Schemas['PatchSessionIn']
// /messages 본문은 서버가 직접 문서화해서 components에 없고 operation 안에만 있다 (backend/app/api/conversation.py).
export type MessageIn =
  operations['send_message_api_v1_sessions__session_id__messages_post']['requestBody']['content']['application/json']
export type ConfirmationIn = Schemas['ConfirmationIn']
export type RouteIn = Schemas['RouteIn']
export type NavigationEventsIn = Schemas['NavigationEventsIn']
export type NavigationEvent = Schemas['NavigationEvent']
export type FeedbackIn = Schemas['FeedbackIn']

// 사진은 multipart로 보낸다. 생성 타입은 binary 필드를 string으로 적으므로 Blob으로 바꿔 쓴다.
export type SendMessageIn = MessageIn & { image?: Blob }
export type LocalizationIn = Omit<Schemas['Body_localize_api_v1_sessions__session_id__localizations_post'], 'image'> & {
  image: Blob
}

// 응답 본문
export type SessionStatus = Schemas['SessionStatus']
export type HealthOut = Schemas['HealthOut']
export type MapsOut = Schemas['MapsOut']
export type GraphOut = Schemas['GraphOut']
export type PoisOut = Schemas['PoisOut']
export type CreateSessionOut = Schemas['CreateSessionOut']
export type PatchSessionOut = Schemas['PatchSessionOut']
export type NavigationStateOut = Schemas['NavigationStateOut']
export type MessageOut = Schemas['MessageOut']
export type LocalizationOut = Schemas['LocalizationOut']
export type ConfirmationOut = Schemas['ConfirmationOut']
export type RouteOut = Schemas['RouteOut']
export type NavigationEventsOut = Schemas['NavigationEventsOut']
export type FeedbackOut = Schemas['FeedbackOut']

// 호출별 옵션. timeoutMs를 넘기면 클라이언트 기본값(따로 정하지 않으면 DEFAULT_TIMEOUT_MS, 15초) 대신 쓴다.
export interface CallOptions {
  timeoutMs?: number
}

// 변경 요청 옵션. 재시도할 때는 처음 요청의 키(ApiError.idempotencyKey)를 넘기고 본문도 똑같이 보낸다.
// 서버는 POST에서만 키를 보고, 같은 키·경로·토큰·본문이면 저장된 성공 응답을 돌려준다 (backend/app/middleware.py).
// multipart 본문은 경계값을 키로 정해 직렬화하므로(src/api/multipart.ts) 같은 키·같은 사진이면 같은 바이트가 나간다.
export interface MutationOptions extends CallOptions {
  idempotencyKey?: string
}

// 화면과 features가 보는 서버 경계. http 구현(httpAdapter.ts)과 mock 구현(mockAdapter.ts)이 같은 인터페이스를 따르고, index.ts가 VITE_API_MODE로 하나를 고른다.
export interface ApiAdapter {
  getHealth(options?: CallOptions): Promise<HealthOut>
  getMaps(options?: CallOptions): Promise<MapsOut>
  getMapGraph(mapId: string, options?: CallOptions): Promise<GraphOut>
  searchPois(mapId: string, query?: string, options?: CallOptions): Promise<PoisOut>

  // 성공하면 받은 세션 토큰을 보관해 이후 세션 API에 붙인다.
  createSession(body: CreateSessionIn, options?: MutationOptions): Promise<CreateSessionOut>
  // PATCH는 서버가 키를 보지 않는다. 중복 변경은 expected_revision이 막는다.
  patchSession(sessionId: string, body: PatchSessionIn, options?: MutationOptions): Promise<PatchSessionOut>
  getNavigationState(sessionId: string, options?: CallOptions): Promise<NavigationStateOut>
  sendMessage(sessionId: string, body: SendMessageIn, options?: MutationOptions): Promise<MessageOut>
  postLocalization(sessionId: string, body: LocalizationIn, options?: MutationOptions): Promise<LocalizationOut>
  confirmLocation(sessionId: string, body: ConfirmationIn, options?: MutationOptions): Promise<ConfirmationOut>
  createRoute(sessionId: string, body: RouteIn, options?: MutationOptions): Promise<RouteOut>
  postNavigationEvents(
    sessionId: string,
    body: NavigationEventsIn,
    options?: MutationOptions,
  ): Promise<NavigationEventsOut>
  postFeedback(sessionId: string, body: FeedbackIn, options?: MutationOptions): Promise<FeedbackOut>

  // 새로고침 뒤 이어 쓸 수 있는 세션 id. 보관된 토큰이 없으면 null
  getSavedSessionId(): string | null
  clearSession(): void
}
