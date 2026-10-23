/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 없이 데모를 돌리는 ApiAdapter 구현(VITE_API_MODE=mock). 기존 mock 규칙(assistant.ts, data.ts, route.ts)을 서버 응답 모양으로 돌려준다
 */
import { classify, render } from '../assistant'
import type { Intent, Reply, Tip } from '../assistant'
import { EDGES, NODES, PANOS, POIS, SCENARIOS } from '../data'
import type { EdgeKind, Lang, NodeId, PhotoScenario, PoiId, Text, TrainType } from '../data'
import { UI } from '../i18n'
import { findRoute } from '../route'
import { ApiError } from './errors'
import type { ServerErrorCode } from './errors'
import { MESSAGE_TRIGGER, NEXT_ACTION, nextState } from './sessionMachine'
import type { SessionStateName, Trigger } from './sessionMachine'
import type {
  ApiAdapter,
  GraphOut,
  LocalizationOut,
  MapsOut,
  MessageOut,
  NavigationStateOut,
  PoisOut,
  RouteOut,
  SessionStatus,
} from './types'

export const MOCK_MAP_ID = 'seoul-station'
// 데모 지도(data.ts)는 서버 지도와 따로 관리하므로 버전도 따로 둔다
export const MOCK_MAP_VERSION = 'demo'

// 답을 고르는 데 걸리는 시간처럼 보이게 기다린다 (기존 store의 AI_DELAY_MS, VISION_DELAY_MS)
const AI_DELAY_MS = 900
const VISION_DELAY_MS = 1600

type Card = 'yes' | 'no' | 'unknown'

interface MockSession {
  id: string
  language: Lang
  state: SessionStateName
  revision: number
  train: TrainType | null
  card: Card
  destination: PoiId | null
  here: NodeId | null
  routeId: string | null
  routeRevision: number
  eventIds: Set<string>
  // 마지막 답의 칩 라벨 → intent. 칩은 라벨을 문장으로 보내는데, 라벨만으로는 분류되지 않는 칩(교통카드 없어요 등)이 있다
  chipIntents: Map<string, Intent>
}

export interface MockAdapterOptions {
  // 테스트에서 0으로 줄인다
  aiDelayMs?: number
  visionDelayMs?: number
}

export interface MockAdapter extends ApiAdapter {
  // 데모 사진 버튼과 데모 패널의 "직접 올린 사진의 결과" 스위치. 다음 사진 위치 인식 결과를 정한다
  setPhotoScenario(scenario: PhotoScenario): void
}

// 서버 오류 형식과 같은 상태 코드 (backend/app/errors.py)
const STATUS: Partial<Record<ServerErrorCode, number>> = {
  INVALID_INPUT: 422,
  SESSION_UNAUTHORIZED: 401,
  MAP_NOT_FOUND: 404,
  POI_NOT_FOUND: 404,
  LOCALIZATION_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 422,
  MAP_VERSION_MISMATCH: 409,
  REVISION_CONFLICT: 409,
  INVALID_STATE: 409,
  LOCATION_NOT_CONFIRMED: 409,
}

const fail = (code: ServerErrorCode, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(STATUS[code] ?? 400, code, message, null, { retryable: code === 'REVISION_CONFLICT', details })

const isNodeId = (id: string): id is NodeId => id in NODES

const EDGE_TYPE: Record<EdgeKind, GraphOut['edges'][number]['type']> = { walk: 'corridor', escalator_down: 'escalator', gate: 'gate' }

const panoId = (node: NodeId) => `pano-${node}`

// 데모 지도 그래프. 노드 id는 data.ts NodeId를 그대로 쓴다. data.ts에는 좌표·높이가 없어서 0으로 둔다
function demoGraph(): GraphOut {
  const nodes = Object.values(NODES)
  const floors = [...new Set(nodes.map((n) => n.floor))].map((floor_id) => ({ floor_id, elevation_m: 0 }))
  return {
    map_id: MOCK_MAP_ID,
    map_version: MOCK_MAP_VERSION,
    coordinate_system: {},
    floors,
    nodes: nodes.map((n) => ({ id: n.id, floor_id: n.floor, position: { x: 0, y: 0, z: 0 }, name: n.name })),
    edges: EDGES.map((e) => ({
      from: e.from,
      to: e.to,
      type: EDGE_TYPE[e.kind],
      distance_m: e.meters,
      heading_deg: e.heading,
      instruction: e.text,
    })),
    landmarks: [],
    // 모두 다른 역에서 찍은 CC0 예시 사진이다. 화면은 is_example이면 "예시 사진" 라벨을 붙인다
    panoramas: (Object.keys(PANOS) as NodeId[]).map((node) => ({
      pano_id: panoId(node),
      node_id: node,
      image_url: PANOS[node]!.src,
      north_yaw_deg: PANOS[node]!.northYaw,
      captured_at: null,
      is_example: true,
    })),
  }
}

function demoPois(): PoisOut['pois'] {
  return POIS.map((p) => ({
    poi_id: p.id,
    name_ko: NODES[p.node].name.ko,
    name_en: NODES[p.node].name.en,
    category: p.category,
    train_type: p.train,
    floor_id: NODES[p.node].floor,
    nearest_node_id: p.node,
    aliases: [],
    verified: true,
  }))
}

// 기존 store.runIntent의 규칙. 상태를 바꾸지 않고 답과 바꿀 값만 돌려준다
interface Decision {
  reply: Reply
  train?: TrainType
  card?: Card
  destination?: PoiId
  relocalize?: boolean
}

function decide(s: MockSession, intent: Intent, withPhoto: boolean): Decision {
  const destination = (poi: PoiId, tip: Tip | null, extra: Partial<Decision> = {}): Decision => ({
    reply: { kind: 'destSet', poi, from: s.here, tip },
    destination: poi,
    ...extra,
  })
  switch (intent) {
    case 'airport':
      return { reply: { kind: 'trainTypes' } }
    case 'notSure':
      return { reply: { kind: 'notSure' } }
    case 'express':
      return destination('expressDesk', 'expressPay', { train: 'express' })
    // 일반열차는 교통카드가 있는지에 따라 목적지가 달라서 한 번 더 묻는다
    case 'allstop':
      return { reply: { kind: 'askCard' }, train: 'allstop' }
    case 'hasCard':
      return destination('allstopPlatform', 'tapCard', { train: 'allstop', card: 'yes' })
    case 'noCard':
      return destination('machines', 'buySingle', { train: 'allstop', card: 'no' })
    case 'pay':
    case 'whatCard':
    case 'recharge':
    case 'deposit':
    case 'fare':
      return { reply: { kind: intent } }
    case 'buy':
      return s.train ? { reply: { kind: 'buy', train: s.train, withPhoto } } : { reply: { kind: 'trainTypes' } }
    case 'platform':
      if (!s.train) return { reply: { kind: 'trainTypes' } }
      return destination(s.train === 'express' ? 'expressPlatform' : 'allstopPlatform', null)
    case 'lost':
      return { reply: { kind: 'lost' }, relocalize: true }
    case 'pickList':
    case 'unknown':
      return { reply: s.here && s.train && withPhoto ? { kind: 'buy', train: s.train, withPhoto } : { kind: 'outOfScope' } }
  }
}

const AGENT_INTENT: Partial<Record<Reply['kind'], MessageOut['intent']>> = {
  trainTypes: 'ticket_purchase_and_navigation',
  notSure: 'ticket_purchase_and_navigation',
  askCard: 'payment_question',
  pay: 'payment_question',
  whatCard: 'payment_question',
  recharge: 'payment_question',
  deposit: 'usage_question',
  fare: 'usage_question',
  buy: 'usage_question',
  destSet: 'navigate_to_poi',
  lost: 'report_off_route',
  outOfScope: 'out_of_scope',
}

export function createMockAdapter(options: MockAdapterOptions = {}): MockAdapter {
  const aiDelayMs = options.aiDelayMs ?? AI_DELAY_MS
  const visionDelayMs = options.visionDelayMs ?? VISION_DELAY_MS
  const wait = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

  let session: MockSession | null = null
  let photoScenario: PhotoScenario = 'arexSign'
  let seq = 0
  const nextId = (prefix: string) => `${prefix}_${++seq}`
  const localizations = new Map<string, { sessionId: string; candidates: NodeId[] }>()

  const sessionStatus = (s: MockSession): SessionStatus => ({ state: s.state, revision: s.revision })

  const requireSession = (sessionId: string) => {
    if (!session || session.id !== sessionId) throw fail('SESSION_UNAUTHORIZED', 'The session token is not valid.')
    return session
  }

  // 서버처럼 상태를 바꿀 때마다 revision을 1 올린다. 허용되지 않으면 409 INVALID_STATE
  const advance = (s: MockSession, trigger: Trigger, hasLocation = false) => {
    const next = nextState(s.state, trigger, hasLocation)
    if (!next) throw fail('INVALID_STATE', `Not allowed while the session is ${s.state}.`, { state: s.state })
    s.state = next
    s.revision += 1
  }

  const checkRevision = (s: MockSession, expected: number) => {
    if (expected !== s.revision) throw fail('REVISION_CONFLICT', 'The session changed. Sync with navigation-state and retry.', { revision: s.revision })
  }

  const checkMapVersion = (version: string) => {
    if (version !== MOCK_MAP_VERSION) throw fail('MAP_VERSION_MISMATCH', 'The map changed. Reload it and retry.', { required_map_version: MOCK_MAP_VERSION })
  }

  const rememberChips = (s: MockSession, reply: Reply) => {
    s.chipIntents = new Map()
    for (const chip of render(reply, 'en').chips ?? []) {
      s.chipIntents.set(chip.label.en, chip.intent)
      s.chipIntents.set(chip.label.ko, chip.intent)
    }
  }

  const toMessageOut = (s: MockSession, reply: Reply): MessageOut => {
    const r = render(reply, s.language)
    const status = r.status === 'error' ? 'cannot_answer' : r.status
    const actions = r.actions ?? []
    return {
      status,
      intent: AGENT_INTENT[reply.kind] ?? 'out_of_scope',
      // note(예: "어떤 열차로 갈까요?")는 응답에 칸이 없어서 본문 뒤에 붙인다
      assistant_message: [r.body, r.note].filter(Boolean).join(' '),
      items: r.list ?? [],
      tip: r.tip ?? null,
      unverified_notes: r.unverified ? [r.unverified] : [],
      slots: { train_type: s.train ?? 'unknown', has_transit_card: s.card },
      destination: reply.kind === 'destSet' ? { poi_id: reply.poi } : null,
      suggested_replies: (r.chips ?? []).map((c) => ({ label: c.label[s.language], selected_poi_id: null })),
      sources: (r.sources ?? []).map((src) => ({
        document_id: src.id,
        title: src.title[s.language],
        source_url: src.url ?? null,
        verified_at: src.verifiedAt,
      })),
      next_action: actions.includes('findMe') ? 'locate' : actions.includes('startRoute') ? 'navigate' : status === 'needs_clarification' ? 'reply' : 'none',
      message_id: nextId('msg'),
      session: sessionStatus(s),
    }
  }

  return {
    setPhotoScenario(scenario) {
      photoScenario = scenario
    },

    getHealth: async () => ({ status: 'ok', api_version: 'mock', dependencies: {} }),

    getMaps: async (): Promise<MapsOut> => {
      const graph = demoGraph()
      return { maps: [{ map_id: MOCK_MAP_ID, name: { en: 'Seoul Station · Airport Railroad', ko: '서울역 · 공항철도' }, version: MOCK_MAP_VERSION, floors: graph.floors, ar_supported: false }] }
    },

    getMapGraph: async (mapId) => {
      if (mapId !== MOCK_MAP_ID) throw fail('MAP_NOT_FOUND', `Unknown map ${mapId}.`)
      return demoGraph()
    },

    searchPois: async (mapId, query = '') => {
      if (mapId !== MOCK_MAP_ID) throw fail('MAP_NOT_FOUND', `Unknown map ${mapId}.`)
      const q = query.trim().toLowerCase()
      const pois = demoPois().filter((p) => !q || [p.name_en, p.name_ko].some((n) => n.toLowerCase().includes(q)))
      return { map_id: MOCK_MAP_ID, map_version: MOCK_MAP_VERSION, pois }
    },

    createSession: async (body) => {
      if (body.map_id !== MOCK_MAP_ID) throw fail('MAP_NOT_FOUND', `Unknown map ${body.map_id}.`)
      const s: MockSession = {
        id: nextId('ses_mock'),
        language: body.language,
        state: 'idle',
        revision: 1,
        train: null,
        card: 'unknown',
        destination: null,
        here: null,
        routeId: null,
        routeRevision: 0,
        eventIds: new Set(),
        chipIntents: new Map(),
      }
      // 첫 인사 말풍선(화면이 그리는 greet)의 칩도 intent로 받는다
      rememberChips(s, { kind: 'greet' })
      session = s
      return {
        session_id: s.id,
        session_token: 'mock',
        expires_in_s: 2 * 60 * 60,
        language: s.language,
        map_id: MOCK_MAP_ID,
        map_version: MOCK_MAP_VERSION,
        session: sessionStatus(s),
      }
    },

    patchSession: async (sessionId, body) => {
      const s = requireSession(sessionId)
      checkRevision(s, body.expected_revision)
      if (body.language) s.language = body.language
      s.revision += 1
      return { session_id: s.id, language: s.language, preferences: { avoid_stairs: false }, requires_route_refresh: false, session: sessionStatus(s) }
    },

    getNavigationState: async (sessionId): Promise<NavigationStateOut> => {
      const s = requireSession(sessionId)
      return {
        session: sessionStatus(s),
        destination_poi_id: s.destination,
        confirmed_node_id: s.here,
        active_route_id: s.routeId,
        route_revision: s.routeId ? s.routeRevision : null,
        map_version: MOCK_MAP_VERSION,
        next_action: NEXT_ACTION[s.state],
      }
    },

    sendMessage: async (sessionId, body) => {
      const s = requireSession(sessionId)
      if (body.language) s.language = body.language
      const message = (body.message ?? '').trim()
      const withPhoto = Boolean(body.image)

      let decision: Decision
      const picked = body.selected_poi_id ? POIS.find((p) => p.id === body.selected_poi_id) : undefined
      if (picked) {
        // 목적지 목록에서 고른 곳. 열차 종류는 그 목적지를 따른다
        decision = { reply: { kind: 'destSet', poi: picked.id, from: s.here, tip: null }, destination: picked.id, train: picked.train }
      } else {
        let intent = s.chipIntents.get(message) ?? classify(message)
        if (intent === 'unknown' && withPhoto && s.train) intent = 'buy'
        decision = decide(s, intent, withPhoto)
      }

      // 상태는 요청을 받은 순간 바꾸고, 답만 늦게 돌려준다 (서버도 처리한 뒤 응답한다)
      const status = render(decision.reply, s.language).status
      const here = decision.relocalize ? null : s.here
      const trigger = MESSAGE_TRIGGER[status === 'error' ? 'cannot_answer' : status]
      advance(s, trigger, here !== null)
      if (decision.train) s.train = decision.train
      if (decision.card) s.card = decision.card
      s.here = here
      if (decision.destination) {
        s.destination = decision.destination
        s.routeId = null
      }
      rememberChips(s, decision.reply)
      const out = toMessageOut(s, decision.reply)
      await wait(aiDelayMs)
      return out
    },

    postLocalization: async (sessionId, body) => {
      const s = requireSession(sessionId)
      checkMapVersion(body.map_version)
      // 위치를 확인하는 중이 아니면 사진을 받지 않는다 (서버와 같다)
      if (!nextState(s.state, 'no_match')) throw fail('INVALID_STATE', `Not allowed while the session is ${s.state}.`, { state: s.state })
      const found = SCENARIOS[photoScenario]
      const localizationId = nextId('loc')
      localizations.set(localizationId, { sessionId: s.id, candidates: found.map((c) => c.node) })
      advance(s, found.length ? 'candidates_found' : 'no_match')
      const out: LocalizationOut = {
        localization_id: localizationId,
        status: found.length ? 'needs_confirmation' : 'no_match',
        map_version: MOCK_MAP_VERSION,
        expires_in_s: 5 * 60,
        // 점수는 순서만 뜻한다. 화면에 확률처럼 보이지 않는다
        candidates: found.map((c, i) => ({
          node_id: c.node,
          floor_id: NODES[c.node].floor,
          rank_score: Math.round(((found.length - i) / (found.length + 1)) * 100) / 100,
          heading_deg: null,
          landmark_id: `demo-${photoScenario}`,
          evidence: c.evidence.map((e: Text) => e[s.language]),
        })),
        retake_hint: found.length ? null : UI.noMatchBody[s.language],
        next_action: found.length ? 'confirm_location' : 'recapture',
        session: sessionStatus(s),
      }
      await wait(visionDelayMs)
      return out
    },

    confirmLocation: async (sessionId, body) => {
      const s = requireSession(sessionId)
      checkRevision(s, body.expected_revision)
      const nodeId = body.selected_node_id
      if (!isNodeId(nodeId)) throw fail('INVALID_INPUT', `Unknown node ${nodeId}.`)
      if (body.method === 'photo_candidate') {
        const shot = body.localization_id ? localizations.get(body.localization_id) : undefined
        if (!shot || shot.sessionId !== s.id) throw fail('LOCALIZATION_NOT_FOUND', 'Unknown localization_id.')
        if (!shot.candidates.includes(nodeId)) throw fail('INVALID_INPUT', 'selected_node_id is not one of the candidates.')
      }
      advance(s, 'location_confirmed')
      s.here = nodeId
      return {
        status: 'confirmed',
        location: { map_id: MOCK_MAP_ID, floor_id: NODES[nodeId].floor, node_id: nodeId, heading_deg: body.selected_heading_deg ?? null, method: body.method },
        session: sessionStatus(s),
      }
    },

    createRoute: async (sessionId, body): Promise<RouteOut> => {
      const s = requireSession(sessionId)
      checkRevision(s, body.expected_revision)
      checkMapVersion(body.map_version)
      const poi = POIS.find((p) => p.id === body.destination_poi_id)
      if (!poi) throw fail('POI_NOT_FOUND', `Unknown destination ${body.destination_poi_id}.`)
      if (poi.id !== s.destination) throw fail('INVALID_INPUT', 'Set the destination through /messages first.', { destination_poi_id: s.destination })
      if (!s.here) throw fail('LOCATION_NOT_CONFIRMED', 'Confirm the current location first.')
      // 등록된 통로만 쓴다. 없으면 경로를 지어내지 않는다
      const steps = findRoute(s.here, poi.node)
      if (!steps) throw fail('ROUTE_NOT_FOUND', 'No registered route from here.', { start_node_id: s.here })
      advance(s, 'route_created')
      if (!(body.reroute && s.routeId)) {
        s.routeId = nextId('route')
        s.routeRevision = 0
      }
      s.routeRevision += 1
      const path = [s.here, ...steps.map((st) => st.edge.to)]
      return {
        route_id: s.routeId!,
        route_revision: s.routeRevision,
        status: 'created',
        map_id: MOCK_MAP_ID,
        map_version: MOCK_MAP_VERSION,
        start_node_id: s.here,
        destination_poi_id: poi.id,
        distance_m: steps.reduce((m, st) => m + st.edge.meters, 0),
        path_node_ids: path,
        waypoints: path.map((id, i) => ({ waypoint_id: `w${i + 1}`, floor_id: NODES[id].floor, position_map_m: { x: 0, y: 0, z: 0 } })),
        steps: steps.map(({ edge }, i) => ({
          step_id: `s${i + 1}`,
          kind: edge.kind,
          from_node_id: edge.from,
          to_node_id: edge.to,
          distance_m: edge.meters,
          instruction_en: edge.text.en,
          instruction_ko: edge.text.ko,
          pano_id: PANOS[edge.from] ? panoId(edge.from) : null,
          // 화살표는 화면이 그래프의 사진 북쪽 + 통로 방향으로 계산한다 (features/route/toSteps.ts의 fallback, 기존 mock과 같다)
          arrow_yaw_deg: null,
        })),
        session: sessionStatus(s),
      }
    },

    postNavigationEvents: async (sessionId, body) => {
      const s = requireSession(sessionId)
      if (body.route_id && body.route_id !== s.routeId) throw fail('INVALID_INPUT', 'route_id is not the active route.', { active_route_id: s.routeId })
      // 중간에 실패하면 하나도 반영하지 않는다 (서버의 트랜잭션과 같다)
      const draft: MockSession = { ...s, eventIds: new Set(s.eventIds) }
      for (const event of body.events) {
        if (draft.eventIds.has(event.event_id)) continue
        draft.eventIds.add(event.event_id)
        if (event.type === 'navigation_started') {
          if (!draft.routeId) throw fail('INVALID_STATE', 'Create a route before starting navigation.', { state: draft.state })
          advance(draft, 'navigation_started')
        } else if (event.type === 'arrived') {
          advance(draft, 'arrived')
          // 도착 지점이 새 현재 위치가 되어 다음 목적지는 여기서 출발한다
          const poi = POIS.find((p) => p.id === draft.destination)
          draft.here = poi ? poi.node : draft.here
          draft.routeId = null
        } else {
          advance(draft, 'navigation_cancelled')
          draft.destination = null
          draft.routeId = null
        }
      }
      Object.assign(s, draft)
      return { accepted_event_ids: body.events.map((e) => e.event_id), session: sessionStatus(s) }
    },

    postFeedback: async (sessionId) => {
      requireSession(sessionId)
      return { feedback_id: nextId('fb'), status: 'received' }
    },

    getSavedSessionId: () => session?.id ?? null,
    clearSession: () => {
      session = null
    },
  }
}
