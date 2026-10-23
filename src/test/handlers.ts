/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 없이 테스트하도록 백엔드 /api/v1 계약을 흉내 내는 MSW 핸들러와 409·503·타임아웃 스위치
 */
import { delay, http } from 'msw'
import type { PathParams } from 'msw'
import type { ServerErrorCode } from '../api/errors'
import type { components } from '../api/schema'
import type {
  ConfirmationOut,
  CreateSessionOut,
  FeedbackOut,
  HealthOut,
  LocalizationOut,
  MapsOut,
  MessageOut,
  NavigationEventsOut,
  NavigationStateOut,
  PatchSessionOut,
  PoisOut,
  RouteOut,
} from '../api/types'
import { GRAPH, MAP_ID, MAP_SUMMARY, MAP_VERSION, POIS } from './fixtures/seoulStation'

// 백엔드 동작의 근거는 backend/app 아래 파일이다. 파일 이름을 각 부분 주석에 적어 둔다.

type Schemas = components['schemas']
type Lang = 'en' | 'ko'
type Slots = Schemas['Slots']
type Preferences = Schemas['Preferences']
type Candidate = Schemas['Candidate']
type AgentReply = Omit<MessageOut, 'message_id' | 'session'>

const API = '*/api/v1'

// --- 스위치 ---------------------------------------------------------------------------------

export type Endpoint =
  | 'health'
  | 'maps'
  | 'graph'
  | 'pois'
  | 'createSession'
  | 'patchSession'
  | 'navigationState'
  | 'messages'
  | 'localizations'
  | 'confirmations'
  | 'routes'
  | 'navigationEvents'
  | 'feedback'

type ImageQuality = 'usable' | 'blurry' | 'too_dark' | 'no_signage' | 'too_close'

// 사진에서 읽힌 내용. 핸들러는 사진을 실제로 읽지 않으므로 테스트가 정한다 (backend/app/domain/localization.py의 VisionFeatures).
export type VisionResult = 'unavailable' | { image_quality: ImageQuality; texts: string[] }

// 기본값: 4호선 환승 안내판을 찍은 사진. 후보는 4호선 개찰구, 1호선 개찰구 순이다.
const DEFAULT_VISION: VisionResult = { image_quality: 'usable', texts: ['공항철도', 'Airport Railroad', '4호선', 'Line 4'] }

interface Faults {
  revisionConflicts: number
  vision: VisionResult
  hangs: Map<Endpoint, number>
}

// --- 서버 상태 -----------------------------------------------------------------------------

type State =
  | 'idle'
  | 'needs_clarification'
  | 'needs_location'
  | 'needs_confirmation'
  | 'ready_to_navigate'
  | 'navigating'
  | 'arrived'
  | 'failed'

export interface SessionRow {
  id: string
  token: string
  language: Lang
  state: State
  revision: number
  slots: Slots
  preferences: Preferences
  destinationPoiId: string | null
  confirmedNodeId: string | null
  confirmedHeadingDeg: number | null
  activeRouteId: string | null
  eventIds: Set<string>
}

interface LocalizationRow {
  sessionId: string
  candidates: Candidate[]
  expiresAt: number
}

interface RouteRow {
  sessionId: string
  revision: number
}

interface StoredResponse {
  fingerprint: string
  status: number
  body: string
}

const db = {
  sessions: new Map<string, SessionRow>(),
  localizations: new Map<string, LocalizationRow>(),
  routes: new Map<string, RouteRow>(),
  idempotency: new Map<string, StoredResponse>(),
}

const faults: Faults = { revisionConflicts: 0, vision: DEFAULT_VISION, hangs: new Map() }

// 테스트가 서버 쪽 동작을 바꾸거나 상태를 들여다볼 때 쓴다. 매 테스트 뒤 reset()으로 되돌린다 (src/test/setup.ts).
export const mockBackend = {
  // 다음 n번의 revision 검사(PATCH 세션, 위치 확정, 경로)를 409 REVISION_CONFLICT로 돌려준다.
  // 다른 기기가 세션을 바꾼 것처럼 revision을 1 올리므로, 재동기화한 값으로 다시 보내야 성공한다.
  conflictNext(times = 1) {
    faults.revisionConflicts += times
  },
  // 사진 위치 인식 결과. 'unavailable'이면 503 AI_SERVICE_UNAVAILABLE이다 (지금 서버의 NoVision과 같은 동작).
  setVision(result: VisionResult) {
    faults.vision = result
  },
  // 이 엔드포인트의 다음 n번 요청은 응답하지 않는다. 클라이언트 타임아웃을 재현한다. Infinity면 계속 멈춘다.
  hang(endpoint: Endpoint, times = 1) {
    faults.hangs.set(endpoint, (faults.hangs.get(endpoint) ?? 0) + times)
  },
  session(sessionId: string): Readonly<SessionRow> | undefined {
    return db.sessions.get(sessionId)
  },
  reset() {
    db.sessions.clear()
    db.localizations.clear()
    db.routes.clear()
    db.idempotency.clear()
    faults.revisionConflicts = 0
    faults.vision = DEFAULT_VISION
    faults.hangs.clear()
  },
}

// --- 오류 형식 (backend/app/errors.py) --------------------------------------------------------

const STATUS: Record<ServerErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_INPUT: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  SESSION_UNAUTHORIZED: 401,
  SESSION_EXPIRED: 401,
  SESSION_FORBIDDEN: 403,
  NOT_FOUND: 404,
  MAP_NOT_FOUND: 404,
  POI_NOT_FOUND: 404,
  LOCALIZATION_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 422,
  LOCALIZATION_EXPIRED: 410,
  MAP_VERSION_MISMATCH: 409,
  REVISION_CONFLICT: 409,
  INVALID_STATE: 409,
  LOCATION_NOT_CONFIRMED: 409,
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE: 415,
  AI_SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
}

const RETRYABLE = new Set<ServerErrorCode>(['AI_SERVICE_UNAVAILABLE', 'REVISION_CONFLICT'])

class Fail extends Error {
  readonly code: ServerErrorCode
  readonly details: Record<string, unknown>

  constructor(code: ServerErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.details = details
  }
}

function invalid(loc: Array<string | number>, msg: string): never {
  throw new Fail('INVALID_INPUT', 'Request body is invalid.', { errors: [{ loc, msg }] })
}

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('')

// backend/app/security.py의 new_id와 같은 모양: prefix_16자리 hex
const newId = (prefix: string) => `${prefix}_${hex(8)}`

function jsonResponse(status: number, body: string, requestId: string) {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId } })
}

function errorResponse(fail: Fail, requestId: string) {
  const body = {
    error: { code: fail.code, message: fail.message, retryable: RETRYABLE.has(fail.code), details: fail.details },
    request_id: requestId,
  }
  return jsonResponse(STATUS[fail.code], JSON.stringify(body), requestId)
}

// --- 요청 처리 공통 (backend/app/middleware.py, backend/app/api/deps.py) ---------------------

interface Reply {
  status?: number
  body: unknown
}

interface Ctx {
  request: Request
  params: PathParams
}

// 모든 POST에는 Idempotency-Key가 필요하다. 같은 키와 같은 본문이면 저장된 응답을, 본문이 다르면 422를 준다.
// 지문은 경로 + Authorization + 본문 원문이다. multipart는 요청마다 경계값이 달라 같은 사진이어도 지문이 달라진다.
async function idempotent(request: Request, requestId: string, run: () => Promise<Reply>): Promise<Response> {
  const key = request.headers.get('Idempotency-Key')
  if (!key || key.length > 64) throw new Fail('BAD_REQUEST', 'Idempotency-Key header is required on POST.')
  const fingerprint = `${new URL(request.url).pathname}\n${request.headers.get('Authorization') ?? ''}\n${await request.clone().text()}`

  const stored = db.idempotency.get(key)
  if (stored) {
    if (stored.fingerprint !== fingerprint)
      throw new Fail('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request.')
    return jsonResponse(stored.status, stored.body, requestId)
  }

  const { status = 200, body } = await run()
  const text = JSON.stringify(body)
  // 성공한 응답만 저장한다. 실패한 요청은 같은 키로 다시 보내도 된다.
  if (status >= 200 && status < 300) db.idempotency.set(key, { fingerprint, status, body: text })
  return jsonResponse(status, text, requestId)
}

function handle(endpoint: Endpoint, run: (ctx: Ctx) => Promise<Reply> | Reply) {
  return async ({ request, params }: Ctx): Promise<Response> => {
    const left = faults.hangs.get(endpoint) ?? 0
    if (left > 0) {
      faults.hangs.set(endpoint, left - 1)
      await delay('infinite')
    }
    const requestId = `req_${hex(6)}`
    try {
      if (request.method === 'POST') return await idempotent(request, requestId, async () => run({ request, params }))
      const { status = 200, body } = await run({ request, params })
      return jsonResponse(status, JSON.stringify(body), requestId)
    } catch (error) {
      if (error instanceof Fail) return errorResponse(error, requestId)
      throw error
    }
  }
}

function authorize({ request, params }: Ctx): SessionRow {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!token) throw new Fail('SESSION_UNAUTHORIZED', 'A session token is required.')
  const row = [...db.sessions.values()].find((s) => s.token === token)
  if (!row) throw new Fail('SESSION_UNAUTHORIZED', 'The session token is not valid.')
  if (row.id !== params.sessionId) throw new Fail('SESSION_FORBIDDEN', 'The token belongs to a different session.')
  return row
}

function checkRevision(row: SessionRow, expected: number) {
  if (faults.revisionConflicts > 0) {
    faults.revisionConflicts -= 1
    row.revision += 1
  }
  if (expected !== row.revision)
    throw new Fail('REVISION_CONFLICT', 'The session changed. Sync with navigation-state and retry.', {
      revision: row.revision,
    })
}

function checkMapVersion(clientVersion: string) {
  if (clientVersion !== MAP_VERSION)
    throw new Fail('MAP_VERSION_MISMATCH', 'The map changed. Reload it and retry.', { required_map_version: MAP_VERSION })
}

const sessionStatus = (row: SessionRow) => ({ state: row.state, revision: row.revision })

// --- 본문 검증 (FastAPI가 하는 검사 중 클라이언트가 틀리기 쉬운 것만) -------------------------

type Body = Record<string, unknown>

async function readJson(request: Request): Promise<Body> {
  const parsed: unknown = await request.json().catch(() => invalid(['body'], 'JSON decode error'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    invalid(['body'], 'Input should be a valid dictionary')
  return parsed as Body
}

function str(body: Body, key: string, opts: { optional?: boolean; max?: number } = {}): string | null {
  const value = body[key]
  if (value === undefined || value === null) return opts.optional ? null : invalid(['body', key], 'Field required')
  if (typeof value !== 'string') return invalid(['body', key], 'Input should be a valid string')
  if (opts.max !== undefined && value.length > opts.max) invalid(['body', key], `String should have at most ${opts.max} characters`)
  return value
}

function int(body: Body, key: string): number {
  const value = body[key]
  if (value === undefined) return invalid(['body', key], 'Field required')
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid(['body', key], 'Input should be a valid integer')
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], loc: string[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value))
    invalid(loc, `Input should be ${allowed.map((a) => `'${a}'`).join(' or ')}`)
  return value as T
}

const lang = (value: unknown, loc: string[]) => oneOf(value, ['en', 'ko'] as const, loc)

// --- 세션 상태 기계 (backend/app/domain/session_state.py) ------------------------------------

type Trigger =
  | 'answered'
  | 'clarification_asked'
  | 'destination_set'
  | 'relocalize'
  | 'candidates_found'
  | 'no_match'
  | 'location_confirmed'
  | 'route_created'
  | 'navigation_started'
  | 'arrived'
  | 'navigation_cancelled'

const ACTIVE: State[] = ['idle', 'needs_clarification', 'needs_location', 'needs_confirmation', 'ready_to_navigate', 'navigating', 'arrived']
const LOCATING: State[] = ['needs_location', 'needs_confirmation']

// trigger -> [허용되는 상태, 다음 상태]. null은 그대로 둔다는 뜻이다.
const TRANSITIONS: Record<Trigger, [State[], State | null]> = {
  answered: [ACTIVE, null],
  clarification_asked: [ACTIVE, 'needs_clarification'],
  destination_set: [ACTIVE, null],
  relocalize: [ACTIVE, 'needs_location'],
  candidates_found: [LOCATING, 'needs_confirmation'],
  no_match: [LOCATING, 'needs_location'],
  location_confirmed: [LOCATING, 'ready_to_navigate'],
  route_created: [['ready_to_navigate', 'navigating'], null],
  navigation_started: [['ready_to_navigate'], 'navigating'],
  arrived: [['navigating'], 'arrived'],
  navigation_cancelled: [ACTIVE, 'idle'],
}

function nextState(state: State, trigger: Trigger, hasLocation = false): State {
  const [allowed, target] = TRANSITIONS[trigger]
  if (!allowed.includes(state))
    throw new Fail('INVALID_STATE', `Not allowed while the session is ${state}.`, { state })
  if (trigger === 'destination_set') return hasLocation ? 'ready_to_navigate' : 'needs_location'
  return target ?? state
}

// 상태를 바꾸고 revision을 올린다 (backend/app/api/deps.py의 advance).
function advance(row: SessionRow, trigger: Trigger, hasLocation = false) {
  row.state = nextState(row.state, trigger, hasLocation)
  row.revision += 1
}

const NEXT_ACTION: Record<State, NavigationStateOut['next_action']> = {
  idle: 'reply',
  needs_clarification: 'reply',
  needs_location: 'locate',
  needs_confirmation: 'confirm_location',
  ready_to_navigate: 'navigate',
  navigating: 'continue_navigation',
  arrived: 'none',
  failed: 'none',
}

// --- 지도 ----------------------------------------------------------------------------------

const nodeById = new Map(GRAPH.nodes.map((n) => [n.id, n]))
const poiById = new Map(POIS.map((p) => [p.poi_id, p]))
const panoByNode = new Map(GRAPH.panoramas.map((p) => [p.node_id, p]))

function verifiedPoi(poiId: string) {
  const poi = poiById.get(poiId)
  return poi && poi.verified ? poi : undefined
}

function checkMapId(mapId: string) {
  if (mapId !== MAP_ID) throw new Fail('MAP_NOT_FOUND', `Unknown map ${mapId}.`)
}

// --- 대화 (backend/app/ai/rule_agent.py의 키워드 규칙) ---------------------------------------

const EXPRESS_TICKETS = 'poi-express-tickets'
const ALLSTOP_TICKETS = 'poi-allstop-tickets'
const EXPRESS_PLATFORM = 'poi-express-platform'
const ALLSTOP_PLATFORM = 'poi-allstop-platform'

type Say = (en: string, ko: string) => string
type Tip = 'express_pay' | 'tap_card' | 'buy_single'

const SOURCES = {
  floors: ['arex-official-seoul-floors', 'AREX official guide: Seoul Station', 'AREX 공식 안내: 서울역', 'https://www.airportrailroad.com/co/steUsfGud.do', '2026-10-22'],
  train_types: ['doc-arex-train-types', 'AREX train types (demo doc)', '공항철도 열차 종류 (데모 문서)', null, '2026-10-15'],
  express_ticket: ['doc-express-ticket', 'Buying an express ticket (demo doc)', '직통열차 승차권 구매 (데모 문서)', null, '2026-10-15'],
  allstop_ticket: ['doc-allstop-ticket', 'Riding the all-stop train (demo doc)', '일반열차 이용 (데모 문서)', null, '2026-10-15'],
  deposit: ['doc-deposit-refund', 'Single-journey card refund (demo doc)', '1회용 교통카드 보증금 환급 (데모 문서)', null, '2026-10-12'],
} as const

const TIPS: Record<Tip, [string, string]> = {
  express_pay: ['You can pay by card or cash at the counter.', '창구에서 카드나 현금으로 낼 수 있어요.'],
  tap_card: ['No ticket needed: tap your card at the All-stop gate.', '표는 필요 없어요. 일반열차 개찰구에서 카드를 찍으세요.'],
  buy_single: [
    'At the machine, choose Single journey. It may only take cash, so have some won ready.',
    '발매기에서 1회용 교통카드를 고르세요. 현금만 될 수 있으니 원화를 준비하세요.',
  ],
}

function source(say: Say, key: keyof typeof SOURCES): Schemas['Source'] {
  const [document_id, en, ko, source_url, verified_at] = SOURCES[key]
  return { document_id, title: say(en, ko), source_url, verified_at }
}

const option = (say: Say, en: string, ko: string): Schemas['SuggestedReply'] => ({ label: say(en, ko), selected_poi_id: null })

function reply(
  say: Say,
  slots: Slots,
  status: AgentReply['status'],
  intent: AgentReply['intent'],
  en: string,
  ko: string,
  fields: Partial<AgentReply> = {},
): AgentReply {
  return {
    status,
    intent,
    assistant_message: say(en, ko),
    items: [],
    tip: null,
    unverified_notes: [],
    slots,
    destination: null,
    suggested_replies: [],
    sources: [],
    next_action: status === 'needs_clarification' ? 'reply' : 'none',
    ...fields,
  }
}

function tipFor(poiId: string, slots: Slots): Tip | null {
  if (poiId === EXPRESS_TICKETS) return 'express_pay'
  if (poiId === ALLSTOP_TICKETS) return 'buy_single'
  if (poiId === ALLSTOP_PLATFORM && slots.has_transit_card === 'yes') return 'tap_card'
  return null
}

function destination(row: SessionRow, say: Say, slots: Slots, poiId: string, tip: Tip | null, intent: AgentReply['intent']) {
  const poi = poiById.get(poiId)!
  const name = row.language === 'en' ? poi.name_en : poi.name_ko
  const here = row.confirmedNodeId ? nodeById.get(row.confirmedNodeId)!.name[row.language] : null
  const [en, ko] = here
    ? [
        `Got it: the ${name}, on ${poi.floor_id}. You're at the ${here}, so we can go now.`,
        `${name}(으)로 안내할게요. ${poi.floor_id}에 있어요. 지금 ${here}에 있으니 바로 출발할 수 있어요.`,
      ]
    : [
        `I'll take you to the ${name}, on ${poi.floor_id}. First, take a photo of a nearby sign and confirm where you are.`,
        `${name}(으)로 안내할게요. ${poi.floor_id}에 있어요. 먼저 주변 안내판을 찍어서 지금 위치를 확인해주세요.`,
      ]
  return reply(say, slots, 'destination_set', intent, en, ko, {
    destination: { poi_id: poiId },
    tip: tip ? say(...TIPS[tip]) : null,
    sources: [source(say, 'floors')],
    next_action: here ? 'navigate' : 'locate',
  })
}

function trainTypes(say: Say, slots: Slots) {
  return reply(
    say,
    slots,
    'needs_clarification',
    'ticket_purchase_and_navigation',
    'Two Airport Railroad (AREX) trains go to Incheon Airport. They are paid for differently. Which one do you want?',
    '인천공항까지는 공항철도 열차가 두 종류예요. 내는 방법이 달라요. 어떤 열차로 갈까요?',
    {
      items: [
        say('Express: non-stop, every seat reserved. You buy a ticket.', '직통열차: 무정차, 전 좌석 지정석. 승차권을 사야 해요.'),
        say('All-stop: stops at every station. You tap a transit card, like the subway.', '일반열차: 모든 역에 정차. 지하철처럼 교통카드를 찍어요.'),
      ],
      suggested_replies: [option(say, 'Express', '직통열차'), option(say, 'All-stop', '일반열차'), option(say, 'Not sure', '잘 모르겠어요')],
      sources: [source(say, 'train_types')],
    },
  )
}

function agentReply(row: SessionRow, message: string, hasImage: boolean, selectedPoiId: string | null): AgentReply {
  const say: Say = row.language === 'en' ? (en) => en : (_en, ko) => ko
  const slots: Slots = { ...row.slots }
  const text = message.toLowerCase()
  // 영어는 단어 경계로("press"가 "express"에 걸리지 않게), 한국어는 조사가 붙으므로 부분 문자열로 찾는다.
  const isAscii = (w: string) => [...w].every((c) => c.charCodeAt(0) < 128)
  const has = (...words: string[]) =>
    words.some((w) =>
      isAscii(w) ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) : text.includes(w),
    )

  const selected = selectedPoiId ? verifiedPoi(selectedPoiId) : undefined
  if (selected) {
    slots.train_type = selected.train_type ?? slots.train_type
    return destination(row, say, slots, selected.poi_id, tipFor(selected.poi_id, slots), 'navigate_to_poi')
  }

  const awaitingCard = slots.train_type === 'allstop' && slots.has_transit_card === 'unknown'
  if (awaitingCard && has("don't", 'do not', 'no', '없어', '없음', '아니')) {
    slots.has_transit_card = 'no'
    return destination(row, say, slots, ALLSTOP_TICKETS, 'buy_single', 'payment_question')
  }
  if (awaitingCard && has('i have', 'have one', 'yes', '있어', '있음', '네')) {
    slots.has_transit_card = 'yes'
    return destination(row, say, slots, ALLSTOP_PLATFORM, 'tap_card', 'payment_question')
  }

  if (has('fare', 'price', 'how much', '요금', '얼마', '가격'))
    return reply(
      say,
      slots,
      'cannot_answer',
      'usage_question',
      "I don't have a verified fare, so I won't guess. The price is shown on the ticket machine screen, or ask at the counter.",
      '확인된 요금 정보가 없어서 추측하지 않을게요. 발매기 화면에 가격이 나오고, 창구에서도 물어볼 수 있어요.',
      { suggested_replies: [option(say, 'How do I pay?', '돈은 어떻게 내요?')] },
    )
  if (has('lost', 'wrong', '잘못', '길을 잃', '헤매'))
    return reply(
      say,
      slots,
      'relocalize',
      'report_off_route',
      "No problem. I won't assume where you are; let's check again.",
      '괜찮아요. 위치를 짐작하지 않고 다시 확인할게요.',
      { next_action: 'locate' },
    )
  if (has('recharge', 'top up', 'top-up', '충전'))
    return reply(say, slots, 'answered', 'payment_question', 'To top up a transit card:', '교통카드 충전 방법:', {
      items: [
        say('Find a recharge machine near the gates.', '개찰구 근처 충전기를 찾으세요.'),
        say('Put the card on the reader.', '카드를 올려놓으세요.'),
        say('Choose an amount and insert cash.', '금액을 고르고 현금을 넣으세요.'),
      ],
      unverified_notes: [say("I can't confirm card payment for top-ups here. Plan on cash.", '여기서 카드로 충전되는지는 확인할 수 없어요. 현금을 준비하세요.')],
      sources: [source(say, 'allstop_ticket')],
    })
  if (has('deposit', 'refund', '보증금', '환급'))
    return reply(
      say,
      slots,
      'answered',
      'usage_question',
      'A single-journey ticket has a deposit you get back after your trip:',
      '1회용 교통카드는 보증금이 있고, 이용 후 돌려받을 수 있어요.',
      {
        items: [
          say('Find a deposit refund machine near the gates where you get off.', '내린 역 개찰구 근처의 보증금 환급기를 찾으세요.'),
          say('Put the card in the slot.', '카드를 투입구에 넣으세요.'),
          say('Take the coins that come out.', '나오는 동전을 받으세요.'),
        ],
        unverified_notes: [
          say("Refund machine locations aren't on the map yet, so I can't guide you to one.", '환급기 위치는 아직 지도에 없어서 길안내는 할 수 없어요.'),
        ],
        sources: [source(say, 'deposit')],
      },
    )
  if (has('t-money', 'tmoney', 'transit card', '교통카드', '티머니'))
    return reply(
      say,
      slots,
      'answered',
      'payment_question',
      'A transit card (T-money is the common one) is a rechargeable card for the subway, buses and the AREX All-stop train.',
      '교통카드(대표적으로 티머니)는 지하철·버스·공항철도 일반열차에 쓰는 충전식 카드예요.',
      {
        items: [
          say('Buy one at a convenience store or a station machine.', '편의점이나 역 발매기에서 살 수 있어요.'),
          say('Top it up with cash.', '현금으로 충전해요.'),
          say('Tap it when you enter and again when you leave.', '들어갈 때 한 번, 나올 때 한 번 찍어요.'),
        ],
        unverified_notes: [say('Where to buy one inside this part of Seoul Station is not registered yet.', '서울역 이 구역 안의 판매 위치는 아직 등록 전이에요.')],
        suggested_replies: [
          option(say, 'I have a transit card', '교통카드 있어요'),
          option(say, "I don't have one", '없어요'),
          option(say, 'How do I top it up?', '충전은 어떻게 해요?'),
        ],
        sources: [source(say, 'allstop_ticket')],
      },
    )
  if (has('pay', 'cash', 'credit', 'card', '결제', '현금', '카드', '돈'))
    return reply(say, slots, 'answered', 'payment_question', 'It depends on the train:', '열차에 따라 달라요.', {
      items: [
        say('Express: buy a ticket at the counter or machine on B2. Card or cash.', '직통열차: B2 표 사는 곳(창구·발매기)에서 승차권 구매. 카드 또는 현금.'),
        say('All-stop with a transit card: just tap it at the gate on B3.', '일반열차 + 교통카드: B3 개찰구에서 카드만 찍으면 돼요.'),
        say('All-stop without a card: buy a single-journey ticket at the machine on B3.', '일반열차 + 카드 없음: B3 발매기에서 1회용 교통카드를 사요.'),
      ],
      unverified_notes: [
        say(
          'Which machines here accept credit cards is not confirmed yet. Keep some cash (won) just in case.',
          '여기 발매기 중 신용카드가 되는 기계는 아직 확인 전이에요. 혹시 모르니 현금(원화)을 조금 준비하세요.',
        ),
      ],
      suggested_replies: [option(say, 'Express', '직통열차'), option(say, 'All-stop', '일반열차'), option(say, "What's a transit card?", '교통카드가 뭐예요?')],
      sources: [source(say, 'floors'), source(say, 'express_ticket'), source(say, 'allstop_ticket')],
    })
  if (has('press', 'buy', 'purchase', 'ticket', '구매', '눌러', '사요', '승차권') || (hasImage && row.confirmedNodeId)) {
    if (slots.train_type === 'unknown') return trainTypes(say, slots)
    const express = slots.train_type === 'express'
    const [seenEn, seenKo] = hasImage ? ['I can see a ticket machine in your photo. ', '사진에서 발매기가 보여요. '] : ['', '']
    const [introEn, introKo] = express
      ? ['To buy an Express ticket:', '직통열차 승차권은 이렇게 사요.']
      : ['For the All-stop train without a transit card:', '교통카드 없이 일반열차를 탈 때는:']
    return reply(say, slots, 'answered', 'usage_question', seenEn + introEn, seenKo + introKo, {
      items: express
        ? [
            say('Switch the screen to English if needed.', '필요하면 화면 언어를 바꾸세요.'),
            say('Choose Express train.', '직통열차를 선택하세요.'),
            say('Choose how many people.', '인원을 선택하세요.'),
            say('Pay by card or cash, then take your ticket.', '카드나 현금으로 결제하고 승차권을 받으세요.'),
          ]
        : [
            say('Switch the screen to English.', '화면 언어를 바꾸세요.'),
            say('Choose Single journey ticket.', '1회용 교통카드를 고르세요.'),
            say('Choose Incheon Airport as your destination.', '목적지로 인천공항을 고르세요.'),
            say('Insert cash and take the card.', '현금을 넣고 카드를 받으세요.'),
          ],
      unverified_notes: [
        say(
          "Exact button names and positions aren't verified. If the screen looks different, ask the staff nearby.",
          '버튼 이름과 위치는 확인 전이에요. 화면이 다르면 근처 직원에게 물어보세요.',
        ),
      ],
      suggested_replies: [option(say, 'Go to the platform', '승강장으로 가기')],
      sources: [source(say, express ? 'express_ticket' : 'allstop_ticket')],
    })
  }
  if (has('platform', '승강장', '타는 곳')) {
    if (slots.train_type === 'unknown') return trainTypes(say, slots)
    const poiId = slots.train_type === 'express' ? EXPRESS_PLATFORM : ALLSTOP_PLATFORM
    return destination(row, say, slots, poiId, tipFor(poiId, slots), 'navigate_to_poi')
  }
  if (has('express', '직통')) {
    slots.train_type = 'express'
    return destination(row, say, slots, EXPRESS_TICKETS, 'express_pay', 'ticket_purchase_and_navigation')
  }
  if (has('all-stop', 'all stop', 'allstop', 'regular', '일반')) {
    slots.train_type = 'allstop'
    return reply(
      say,
      slots,
      'needs_clarification',
      'payment_question',
      'For the All-stop train you tap a transit card at the gate. Do you have one, like T-money?',
      '일반열차는 개찰구에서 교통카드를 찍어요. 티머니 같은 교통카드가 있나요?',
      {
        suggested_replies: [
          option(say, 'I have a transit card', '교통카드 있어요'),
          option(say, "I don't have one", '없어요'),
          option(say, "What's a transit card?", '교통카드가 뭐예요?'),
        ],
        sources: [source(say, 'allstop_ticket')],
      },
    )
  }
  if (has('airport', 'incheon', 'icn', 'arex', '공항', '인천')) return trainTypes(say, slots)
  if (has('not sure', 'which', 'difference', '모르', '차이'))
    return reply(say, slots, 'needs_clarification', 'ticket_purchase_and_navigation', 'A simple way to decide:', '이렇게 고르면 쉬워요.', {
      items: [
        say('Lots of luggage, or you want a guaranteed seat: Express.', '짐이 많거나 꼭 앉아서 가고 싶다면: 직통열차'),
        say("You have (or will get) a transit card and don't mind stops: All-stop.", '교통카드가 있거나 살 거고, 정차해도 괜찮다면: 일반열차'),
      ],
      unverified_notes: [say("I don't have verified fares or travel times, so I won't compare them.", '확인된 요금·소요시간이 없어서 비교하지 않을게요.')],
      suggested_replies: [option(say, 'Express', '직통열차'), option(say, 'All-stop', '일반열차')],
      sources: [source(say, 'train_types')],
    })
  return reply(
    say,
    slots,
    'out_of_scope',
    'out_of_scope',
    'Right now I cover the Airport Railroad at Seoul Station: tickets, cards, cash and the way to the platform.',
    '지금은 서울역 공항철도 구역을 도와드려요. 표·카드·현금, 승강장 가는 길을 물어보세요.',
    {
      suggested_replies: [
        option(say, 'Incheon Airport', '인천공항'),
        option(say, 'How do I pay?', '돈은 어떻게 내요?'),
        option(say, "What's a transit card?", '교통카드가 뭐예요?'),
      ],
    },
  )
}

const MESSAGE_TRIGGER: Record<AgentReply['status'], Trigger> = {
  answered: 'answered',
  cannot_answer: 'answered',
  out_of_scope: 'answered',
  needs_clarification: 'clarification_asked',
  destination_set: 'destination_set',
  relocalize: 'relocalize',
}

// --- 사진 (backend/app/api/deps.py의 read_jpeg, backend/app/domain/localization.py) ----------

const MAX_IMAGE_BYTES = 2 * 1024 * 1024

async function readJpeg(upload: FormDataEntryValue | null): Promise<void> {
  if (!(upload instanceof Blob)) return
  if (upload.size > MAX_IMAGE_BYTES) throw new Fail('IMAGE_TOO_LARGE', 'Images must be 2 MB or smaller.')
  const head = new Uint8Array(await upload.slice(0, 3).arrayBuffer())
  if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw new Fail('UNSUPPORTED_IMAGE', 'Images must be JPEG.')
}

const MAX_CANDIDATES = 3
const HINT_BONUS = 0.5
const normalise = (text: string) => text.replace(/[\s\-·.,'’]/g, '').toLowerCase()

function matchLocation(texts: string[], floorHint: string | null, lastNodeId: string | null, language: Lang): Candidate[] {
  const seen = new Set(texts.map(normalise))
  const neighbours = new Set(
    lastNodeId ? GRAPH.edges.flatMap((e) => (e.from === lastNodeId ? [e.to] : e.to === lastNodeId ? [e.from] : [])) : [],
  )
  const scored: Array<[number, Candidate]> = []
  for (const landmark of GRAPH.landmarks) {
    const matched = landmark.sign_texts.filter((s) => seen.has(normalise(s)))
    if (!matched.length) continue
    const node = nodeById.get(landmark.node_id)!
    const score = matched.length + (floorHint === node.floor_id ? HINT_BONUS : 0) + (neighbours.has(node.id) ? HINT_BONUS : 0)
    scored.push([
      score,
      {
        node_id: node.id,
        floor_id: node.floor_id,
        rank_score: Math.round((score / (score + 1)) * 100) / 100,
        heading_deg: null,
        landmark_id: landmark.landmark_id,
        evidence: matched.map((s) => (language === 'en' ? `Sign reads “${s}”` : `“${s}” 안내판`)),
      },
    ])
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, MAX_CANDIDATES)
    .map(([, candidate]) => candidate)
}

const RETAKE_HINTS: Record<ImageQuality, [string, string]> = {
  blurry: ['The photo is blurry. Hold still and try again.', '사진이 흐려요. 잠시 멈춰서 다시 찍어주세요.'],
  too_dark: ['The photo is too dark. Try facing a lit sign.', '사진이 어두워요. 밝은 안내판 쪽을 찍어주세요.'],
  too_close: ['Step back a little so the whole sign fits.', '안내판 전체가 나오게 조금 뒤로 물러나 찍어주세요.'],
  no_signage: [
    "I can't see a sign. Try a wider shot with a line name or station sign.",
    '안내판이 보이지 않아요. 노선 이름이나 역 안내판이 보이게 넓게 찍어주세요.',
  ],
  usable: [
    "I can't tell where this is. Try a wider shot with a line name or station sign.",
    '위치를 알아보기 어려워요. 노선 이름이나 역 안내판이 보이게 넓게 찍어주세요.',
  ],
}

const LOCALIZATION_TTL_S = 5 * 60

// --- 경로 (backend/app/domain/routing.py) ---------------------------------------------------

function planRoute(start: string, goal: string, avoidStairs: boolean) {
  const edges = GRAPH.edges.filter((e) => !(avoidStairs && e.type === 'stairs'))
  const dist = new Map<string, number>([[start, 0]])
  const prev = new Map<string, (typeof edges)[number]>()
  const open = new Set([start])
  while (open.size) {
    const cur = [...open].reduce((a, b) => (dist.get(b)! < dist.get(a)! ? b : a))
    open.delete(cur)
    if (cur === goal) break
    for (const edge of edges) {
      if (edge.from !== cur) continue
      const d = dist.get(cur)! + edge.distance_m
      if (d < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, d)
        prev.set(edge.to, edge)
        open.add(edge.to)
      }
    }
  }
  if (start !== goal && !prev.has(goal)) return null
  const path: typeof edges = []
  for (let n = goal; n !== start; n = prev.get(n)!.from) path.unshift(prev.get(n)!)
  return { pathNodeIds: [start, ...path.map((e) => e.to)], edges: path }
}

// (-180, 180]로 맞춘다.
function wrapDegrees(angle: number) {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

function stepKind(edge: (typeof GRAPH.edges)[number]) {
  if (edge.type === 'corridor') return 'walk'
  if (edge.type === 'gate' || edge.type === 'elevator') return edge.type
  const down = nodeById.get(edge.to)!.position.y < nodeById.get(edge.from)!.position.y
  return `${edge.type}_${down ? 'down' : 'up'}`
}

// --- 핸들러 --------------------------------------------------------------------------------

export const handlers = [
  http.get(`${API}/health`, handle('health', (): Reply => ({ body: { status: 'ok', api_version: 'v1', dependencies: { database: 'ok' } } satisfies HealthOut }))),

  // 지도는 공개 데이터라 토큰이 필요 없다 (backend/app/api/maps.py).
  http.get(`${API}/maps`, handle('maps', (): Reply => ({ body: { maps: [MAP_SUMMARY] } satisfies MapsOut }))),

  http.get(
    `${API}/maps/:mapId/graph`,
    handle('graph', ({ params }): Reply => {
      checkMapId(String(params.mapId))
      return { body: GRAPH }
    }),
  ),

  http.get(
    `${API}/maps/:mapId/pois`,
    handle('pois', ({ request, params }): Reply => {
      checkMapId(String(params.mapId))
      const q = (new URL(request.url).searchParams.get('query') ?? '').trim().toLowerCase()
      const pois = POIS.filter((p) => p.verified && (!q || [p.name_en, p.name_ko, ...p.aliases].some((s) => s.toLowerCase().includes(q))))
      return { body: { map_id: MAP_ID, map_version: MAP_VERSION, pois } satisfies PoisOut }
    }),
  ),

  // --- 세션 (backend/app/api/sessions.py) ---

  http.post(
    `${API}/sessions`,
    handle('createSession', async ({ request }): Promise<Reply> => {
      const body = await readJson(request)
      const language = lang(body.language, ['body', 'language'])
      const mapId = str(body, 'map_id')!
      const client = body.client
      if (typeof client !== 'object' || client === null) invalid(['body', 'client'], 'Field required')
      str(client as Body, 'platform')
      str(client as Body, 'app_version')
      checkMapId(mapId)

      const row: SessionRow = {
        id: newId('ses'),
        token: hex(32),
        language,
        state: 'idle',
        revision: 1,
        slots: { train_type: 'unknown', has_transit_card: 'unknown' },
        preferences: { avoid_stairs: false },
        destinationPoiId: null,
        confirmedNodeId: null,
        confirmedHeadingDeg: null,
        activeRouteId: null,
        eventIds: new Set(),
      }
      db.sessions.set(row.id, row)
      const out: CreateSessionOut = {
        session_id: row.id,
        session_token: row.token,
        expires_in_s: 2 * 60 * 60,
        language,
        map_id: MAP_ID,
        map_version: MAP_VERSION,
        session: sessionStatus(row),
      }
      return { status: 201, body: out }
    }),
  ),

  http.patch(
    `${API}/sessions/:sessionId`,
    handle('patchSession', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      const body = await readJson(ctx.request)
      // 목적지는 /messages로만 정하므로 모르는 필드는 거절한다 (PatchSessionIn의 extra="forbid").
      for (const key of Object.keys(body))
        if (!['expected_revision', 'language', 'preferences'].includes(key)) invalid(['body', key], 'Extra inputs are not permitted')
      const expected = int(body, 'expected_revision')
      const language = body.language == null ? null : lang(body.language, ['body', 'language'])
      let preferences: Preferences | null = null
      if (body.preferences != null) {
        const avoid = (body.preferences as Body).avoid_stairs ?? false
        if (typeof avoid !== 'boolean') invalid(['body', 'preferences', 'avoid_stairs'], 'Input should be a valid boolean')
        preferences = { avoid_stairs: avoid }
      }

      checkRevision(row, expected)
      const changed = preferences !== null && preferences.avoid_stairs !== row.preferences.avoid_stairs
      if (language) row.language = language
      if (preferences) row.preferences = preferences
      row.revision += 1
      const out: PatchSessionOut = {
        session_id: row.id,
        language: row.language,
        preferences: row.preferences,
        requires_route_refresh: changed && row.activeRouteId !== null,
        session: sessionStatus(row),
      }
      return { body: out }
    }),
  ),

  http.get(
    `${API}/sessions/:sessionId/navigation-state`,
    handle('navigationState', (ctx): Reply => {
      const row = authorize(ctx)
      const route = row.activeRouteId ? db.routes.get(row.activeRouteId) : undefined
      const out: NavigationStateOut = {
        session: sessionStatus(row),
        destination_poi_id: row.destinationPoiId,
        confirmed_node_id: row.confirmedNodeId,
        active_route_id: row.activeRouteId,
        route_revision: route?.revision ?? null,
        map_version: MAP_VERSION,
        next_action: NEXT_ACTION[row.state],
      }
      return { body: out }
    }),
  ),

  // --- 대화 (backend/app/api/conversation.py) ---

  http.post(
    `${API}/sessions/:sessionId/messages`,
    handle('messages', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      // 텍스트는 JSON, 사진이 붙으면 multipart로 온다.
      let body: Body
      let hasImage = false
      if ((ctx.request.headers.get('Content-Type') ?? '').startsWith('multipart/form-data')) {
        const form = await ctx.request.formData()
        const image = form.get('image')
        await readJpeg(image)
        hasImage = image instanceof Blob
        body = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== 'image' && typeof v === 'string'))
      } else {
        body = await readJson(ctx.request)
      }
      const message = str(body, 'message', { optional: true, max: 1000 }) ?? ''
      const language = body.language == null ? null : lang(body.language, ['body', 'language'])
      const selectedPoiId = str(body, 'selected_poi_id', { optional: true })
      if (!message.trim() && !selectedPoiId) invalid(['body'], 'Value error, message or selected_poi_id is required')

      if (language) row.language = language
      const agent = agentReply(row, message, hasImage, selectedPoiId)
      const confirmedNodeId = agent.status === 'relocalize' ? null : row.confirmedNodeId
      const state = nextState(row.state, MESSAGE_TRIGGER[agent.status], confirmedNodeId !== null)

      row.slots = agent.slots
      row.confirmedNodeId = confirmedNodeId
      if (agent.destination) {
        row.destinationPoiId = agent.destination.poi_id
        row.activeRouteId = null
      }
      row.state = state
      row.revision += 1
      const out: MessageOut = { ...agent, message_id: newId('msg'), session: sessionStatus(row) }
      return { body: out }
    }),
  ),

  // --- 위치 (backend/app/api/location.py) ---

  http.post(
    `${API}/sessions/:sessionId/localizations`,
    handle('localizations', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      const form = await ctx.request.formData().catch(() => invalid(['body'], 'Expected multipart/form-data'))
      const image = form.get('image')
      const mapVersion = form.get('map_version')
      if (!(image instanceof Blob)) invalid(['body', 'image'], 'Field required')
      if (typeof mapVersion !== 'string') invalid(['body', 'map_version'], 'Field required')
      const floorHint = form.get('floor_hint')
      const lastNodeId = form.get('last_node_id')

      // 위치를 스스로 확정하지 않는다. 사용자가 /location-confirmations로 고른다.
      checkMapVersion(mapVersion)
      if (!TRANSITIONS.no_match[0].includes(row.state))
        throw new Fail('INVALID_STATE', `Not allowed while the session is ${row.state}.`, { state: row.state })
      await readJpeg(image)
      if (faults.vision === 'unavailable')
        throw new Fail('AI_SERVICE_UNAVAILABLE', 'Photo recognition is not configured on this server.')

      const { image_quality, texts } = faults.vision
      const candidates =
        image_quality === 'usable'
          ? matchLocation(texts, typeof floorHint === 'string' ? floorHint : null, typeof lastNodeId === 'string' ? lastNodeId : null, row.language)
          : []
      const localizationId = newId('loc')
      db.localizations.set(localizationId, { sessionId: row.id, candidates, expiresAt: Date.now() + LOCALIZATION_TTL_S * 1000 })
      advance(row, candidates.length ? 'candidates_found' : 'no_match')

      const [en, ko] = RETAKE_HINTS[image_quality]
      const out: LocalizationOut = {
        localization_id: localizationId,
        status: candidates.length ? 'needs_confirmation' : 'no_match',
        map_version: MAP_VERSION,
        expires_in_s: LOCALIZATION_TTL_S,
        candidates,
        retake_hint: candidates.length ? null : row.language === 'en' ? en : ko,
        next_action: candidates.length ? 'confirm_location' : 'recapture',
        session: sessionStatus(row),
      }
      return { body: out }
    }),
  ),

  http.post(
    `${API}/sessions/:sessionId/location-confirmations`,
    handle('confirmations', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      const body = await readJson(ctx.request)
      const expected = int(body, 'expected_revision')
      const method = oneOf(body.method, ['photo_candidate', 'manual'] as const, ['body', 'method'])
      const localizationId = str(body, 'localization_id', { optional: true })
      const selectedNodeId = str(body, 'selected_node_id')!
      const heading = typeof body.selected_heading_deg === 'number' ? body.selected_heading_deg : null
      if (method === 'photo_candidate' && !localizationId)
        invalid(['body'], 'Value error, localization_id is required for photo_candidate')

      checkRevision(row, expected)
      const node = nodeById.get(selectedNodeId)
      if (!node) throw new Fail('INVALID_INPUT', `Unknown node ${selectedNodeId}.`)
      if (method === 'photo_candidate') {
        const localization = db.localizations.get(localizationId!)
        if (!localization || localization.sessionId !== row.id) throw new Fail('LOCALIZATION_NOT_FOUND', 'Unknown localization_id.')
        if (localization.expiresAt < Date.now()) throw new Fail('LOCALIZATION_EXPIRED', 'The photo result expired. Take a new photo.')
        if (!localization.candidates.some((c) => c.node_id === node.id))
          throw new Fail('INVALID_INPUT', 'selected_node_id is not one of the candidates.')
      }

      advance(row, 'location_confirmed')
      row.confirmedNodeId = node.id
      row.confirmedHeadingDeg = heading
      const out: ConfirmationOut = {
        status: 'confirmed',
        location: { map_id: MAP_ID, floor_id: node.floor_id, node_id: node.id, heading_deg: heading, method },
        session: sessionStatus(row),
      }
      return { body: out }
    }),
  ),

  // --- 경로와 길안내 (backend/app/api/routes.py, sessions.py) ---

  http.post(
    `${API}/sessions/:sessionId/routes`,
    handle('routes', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      const body = await readJson(ctx.request)
      const expected = int(body, 'expected_revision')
      const destinationPoiId = str(body, 'destination_poi_id')!
      const mapVersion = str(body, 'map_version')!
      const reroute = body.reroute === true
      const avoidStairs =
        body.preferences != null ? (body.preferences as Body).avoid_stairs === true : row.preferences.avoid_stairs

      // 경로는 백엔드만 만든다. 목적지는 /messages에서 정한 것과 같아야 한다.
      checkRevision(row, expected)
      checkMapVersion(mapVersion)
      if (!verifiedPoi(destinationPoiId)) throw new Fail('POI_NOT_FOUND', `Unknown destination ${destinationPoiId}.`)
      if (destinationPoiId !== row.destinationPoiId)
        throw new Fail('INVALID_INPUT', 'Set the destination through /messages first.', { destination_poi_id: row.destinationPoiId })
      if (row.confirmedNodeId === null) throw new Fail('LOCATION_NOT_CONFIRMED', 'Confirm the current location first.')

      const goal = poiById.get(destinationPoiId)!.nearest_node_id
      const planned = planRoute(row.confirmedNodeId, goal, avoidStairs)
      if (!planned)
        throw new Fail('ROUTE_NOT_FOUND', 'No registered route from here.', {
          start_node_id: row.confirmedNodeId,
          avoid_stairs: avoidStairs,
        })
      advance(row, 'route_created')

      // 다시 계산하면 같은 route_id에 revision만 올리고, 새 목적지면 새 route_id를 준다.
      const previousId = reroute && row.activeRouteId && db.routes.has(row.activeRouteId) ? row.activeRouteId : null
      const routeId = previousId ?? newId('route')
      const routeRevision = previousId ? db.routes.get(previousId)!.revision + 1 : 1
      db.routes.set(routeId, { sessionId: row.id, revision: routeRevision })
      row.activeRouteId = routeId

      const steps = planned.edges.map((edge, i) => {
        const pano = panoByNode.get(edge.from)
        return {
          step_id: `s${i + 1}`,
          kind: stepKind(edge),
          from_node_id: edge.from,
          to_node_id: edge.to,
          distance_m: edge.distance_m,
          instruction_en: edge.instruction.en,
          instruction_ko: edge.instruction.ko,
          pano_id: pano?.pano_id ?? null,
          // 사진 안에서 다음 구간이 가리키는 방향: 사진의 북쪽 + 구간의 지도 방위
          arrow_yaw_deg: pano ? wrapDegrees(pano.north_yaw_deg + edge.heading_deg) : null,
        }
      })
      const out: RouteOut = {
        route_id: routeId,
        route_revision: routeRevision,
        status: 'created',
        map_id: MAP_ID,
        map_version: MAP_VERSION,
        start_node_id: row.confirmedNodeId,
        destination_poi_id: destinationPoiId,
        distance_m: steps.reduce((sum, s) => sum + s.distance_m, 0),
        path_node_ids: planned.pathNodeIds,
        waypoints: planned.pathNodeIds.map((id, i) => {
          const node = nodeById.get(id)!
          return { waypoint_id: `w${i + 1}`, floor_id: node.floor_id, position_map_m: node.position }
        }),
        steps,
        session: sessionStatus(row),
      }
      return { body: out }
    }),
  ),

  http.post(
    `${API}/sessions/:sessionId/navigation-events`,
    handle('navigationEvents', async (ctx): Promise<Reply> => {
      const row = authorize(ctx)
      const body = await readJson(ctx.request)
      const routeId = str(body, 'route_id', { optional: true })
      const events = body.events
      if (!Array.isArray(events) || events.length < 1 || events.length > 50)
        invalid(['body', 'events'], 'List should have at least 1 item and at most 50 items')
      const parsed = events.map((e: unknown, i) => {
        const event = (typeof e === 'object' && e !== null ? e : {}) as Body
        str(event, 'client_timestamp')
        return {
          id: str(event, 'event_id', { max: 64 })!,
          type: oneOf(event.type, ['navigation_started', 'arrived', 'navigation_cancelled'] as const, ['body', 'events', String(i), 'type']),
        }
      })
      if (routeId && routeId !== row.activeRouteId)
        throw new Fail('INVALID_INPUT', 'route_id is not the active route.', { active_route_id: row.activeRouteId })

      // 중간에 실패하면 서버는 트랜잭션을 되돌리므로, 사본에 적용하고 끝까지 성공했을 때만 반영한다.
      const draft: SessionRow = { ...row, eventIds: new Set(row.eventIds) }
      for (const event of parsed) {
        if (draft.eventIds.has(event.id)) continue
        draft.eventIds.add(event.id)
        if (event.type === 'navigation_started') {
          if (!draft.activeRouteId)
            throw new Fail('INVALID_STATE', 'Create a route before starting navigation.', { state: draft.state })
          advance(draft, 'navigation_started')
        } else if (event.type === 'arrived') {
          advance(draft, 'arrived')
          // 도착 지점이 새 현재 위치가 되어 다음 목적지는 여기서 출발한다.
          draft.confirmedNodeId = poiById.get(draft.destinationPoiId!)!.nearest_node_id
          draft.activeRouteId = null
        } else {
          advance(draft, 'navigation_cancelled')
          draft.destinationPoiId = null
          draft.activeRouteId = null
        }
      }
      Object.assign(row, draft)
      const out: NavigationEventsOut = { accepted_event_ids: parsed.map((e) => e.id), session: sessionStatus(row) }
      return { body: out }
    }),
  ),

  http.post(
    `${API}/sessions/:sessionId/feedback`,
    handle('feedback', async (ctx): Promise<Reply> => {
      authorize(ctx)
      const body = await readJson(ctx.request)
      const rating = int(body, 'rating')
      if (rating < 1 || rating > 5) invalid(['body', 'rating'], 'Input should be between 1 and 5')
      str(body, 'category', { max: 32 })
      str(body, 'comment', { optional: true, max: 2000 })
      return { status: 201, body: { feedback_id: newId('fb'), status: 'received' } satisfies FeedbackOut }
    }),
  ),
]
