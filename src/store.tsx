// PROTOTYPE session flow. Mirrors the backend session state machine
// (idle → needs_clarification → needs_location → needs_confirmation →
// ready_to_navigate → navigating → arrived) with in-memory mocks.
// 세션 생성과 채팅은 VITE_API_MODE(기본 http)에 따라 서버 또는 mock 규칙(가짜 세션 서버, assistant.ts)을 쓴다.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  clearSession, confirmLocation as confirmLocationApi, createRoute, createSession, getMapGraph, getNavigationState, isApiError, patchSession,
  postLocalization, postNavigationEvents, sendMessage,
} from './api'
import type { GraphOut, NavigationEvent, NavigationStateOut, SessionStatus } from './api'
import { API_MODE } from './api/mode'
import { classify } from './assistant'
import type { Intent, Reply, Tip } from './assistant'
import { NODES, POIS, SCENARIOS } from './data'
import type { Candidate, Lang, NodeId, PhotoScenario, PoiId, Text, TrainType } from './data'
import { messageBody, replyEffects, resyncPlan } from './features/chat/replyEffects'
import { sendChat } from './features/chat/sendChat'
import { toErrorView } from './features/chat/toViewModel'
import type { ChatChip, ChatView, ErrorView } from './features/chat/toViewModel'
import { compressImage } from './features/localization/compressImage'
import type { LocationChoice } from './features/localization/confirm'
import { sendConfirmation, sendPhoto } from './features/localization/flow'
import type { LocateResult } from './features/localization/locate'
import { candidateViews, manualPlaces, mockCandidateViews, mockManualPlaces } from './features/localization/views'
import type { CandidateView, PlaceView } from './features/localization/views'
import { createGraphCache } from './features/map/graphCache'
import { createNavigationEvent } from './features/route/events'
import type { NavigationEventType } from './features/route/events'
import { deliverEvents, sendRoute } from './features/route/flow'
import { mockGuide, serverGuide, toActiveRoute } from './features/route/guide'
import type { ActiveRoute } from './features/route/guide'
import { planReroute } from './features/route/request'
import { useRecovery } from './features/recovery/context'
import type { FailHandlers } from './features/recovery/context'
import { sendWithRecovery } from './features/recovery/retry'
import { patchLanguage } from './features/session/language'
import { createMockSessionServer } from './features/session/mockSession'
import { serverPoiOf } from './features/session/poiBridge'
import { findRoute } from './route'
import type { Step } from './route'

export type Screen = 'welcome' | 'chat' | 'locate' | 'analyzing' | 'candidates' | 'manual' | 'destinations' | 'route' | 'arrived'

export type SessionState =
  | 'idle'
  | 'needs_clarification'
  | 'needs_location'
  | 'needs_confirmation'
  | 'ready_to_navigate'
  | 'navigating'
  | 'arrived'

export interface Msg {
  id: number
  role: 'user' | 'assistant'
  text?: string | Text
  image?: string
  reply?: Reply
  // http 모드의 서버 응답·오류 말풍선 (reply는 mock 모드)
  view?: ChatView
  pending?: boolean
}

// 채팅에 첨부한 사진. url은 말풍선 미리보기, file은 서버로 보낼 원본이다
export interface Attachment {
  url: string
  file: Blob
}

// 사용자가 보낸 말 한 번. 말풍선에 보일 내용, 서버에 보낼 내용, mock 모드에서 할 일을 함께 담는다
interface Utterance {
  display?: string | Text
  message: string
  selectedPoiId?: string | null
  image?: Attachment
  mock: () => void
}

export interface Photo {
  src: string | null
  scenario: PhotoScenario
  // 찍거나 고른 원본. http 모드는 이 파일을 압축해 보낸다. 데모 사진(mock 모드)은 없다
  file?: Blob
}

// 직접 선택 화면에 온 이유. 사진 인식을 쓸 수 없어(503) 넘어왔으면 안내 한 줄을 보여 준다
export type ManualReason = 'ai_unavailable' | null

// 서버 세션의 식별 정보. 토큰은 src/api 클라이언트가 보관한다.
export interface SessionInfo {
  id: string
  mapId: string
  mapVersion: string
}

const AI_DELAY_MS = 900
const VISION_DELAY_MS = 1600
const MAP_ID = 'seoul-station'
const chatApi = { sendMessage, getNavigationState }
const sessionApi = { patchSession, getNavigationState }
const locationApi = { postLocalization, confirmLocation: confirmLocationApi, getNavigationState }
const routeApi = { createRoute, postNavigationEvents, getNavigationState }
// 도착하면 표 사는 법을 이어서 묻게 할 목적지 (data.ts PoiId)
const TICKET_POIS: ReadonlySet<PoiId> = new Set(['expressDesk', 'machines'])

const isNodeId = (id: string): id is NodeId => id in NODES

// mock 모드의 현재 위치(here)는 data.ts NodeId다. http 모드는 서버 node_id를 그대로 쓰고 데모 노드로 바꾸지 않는다
const mockNode = (id: string | null): NodeId | null => (id !== null && isNodeId(id) ? id : null)

function useAppState() {
  const [lang, setLang] = useState<Lang>('en')
  const [screen, setScreen] = useState<Screen>('welcome')
  // state·revision은 서버(mock 모드에서는 가짜 서버) 응답의 session 필드로만 바뀐다. 시작 전에는 null
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [starting, setStarting] = useState<{ pending: boolean; error: ErrorView | null }>({ pending: false, error: null })
  // 언어 PATCH를 보내는 중이면 언어 버튼을 잠근다
  const [langPending, setLangPending] = useState(false)
  const [train, setTrain] = useState<TrainType | null>(null)
  const [dest, setDest] = useState<PoiId | null>(null)
  // 서버가 정한 목적지 POI id. http 모드의 경로 요청은 이 값을 쓴다. dest는 데모 PoiId로 이은 값이다 (mock 경로, 목적지 목록, 도착 화면; poiBridge)
  const [destinationPoiId, setDestinationPoiId] = useState<string | null>(null)
  // 현재 위치. http 모드는 서버가 확정한 node_id, mock 모드는 data.ts NodeId
  const [here, setHere] = useState<string | null>(null)
  // mock 모드의 데모 경로 (findRoute)
  const [steps, setSteps] = useState<Step[]>([])
  const [startNode, setStartNode] = useState<NodeId | null>(null)
  // http 모드: 서버가 만든 진행 중 경로와 요청 상태. 단계 진행(stepIdx)은 두 모드 모두 화면 상태로만 둔다
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<'not_found' | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
  const [photo, setPhoto] = useState<Photo | null>(null)
  // mock 모드의 데모 후보 (data.ts SCENARIOS)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  // http 모드: 지도 그래프(직접 선택 목록, 후보 이름, 경로 화면의 노드 이름·사진)와 마지막 사진 결과(후보 / 재촬영 / 503 직접 선택)
  const [graph, setGraph] = useState<GraphOut | null>(null)
  const [located, setLocated] = useState<LocateResult | null>(null)
  // 위치 확정 요청을 보내는 중이면 후보·목록 버튼을 잠근다
  const [confirming, setConfirming] = useState(false)
  const [failNext, setFailNext] = useState(false)
  const [uploadScenario, setUploadScenario] = useState<PhotoScenario>('arexSign')
  const [demoOpen, setDemoOpen] = useState(false)
  const nextId = useRef(1)
  const lastIntent = useRef<{ intent: Intent; withPhoto: boolean } | null>(null)
  const mockServer = useRef(createMockSessionServer())
  // 오류 복구 상태. RecoveryProvider가 AppProvider 바깥에 있어서 store에서도 fail()을 쓸 수 있다
  const recovery = useRecovery()
  // 초기화 뒤에 도착한 세션 생성 응답을 버리기 위한 번호
  const startSeq = useRef(0)
  // 다시 찍었거나 초기화한 뒤에 도착한 옛 사진 결과를 버리기 위한 번호
  const photoSeq = useRef(0)
  const graphCache = useRef(createGraphCache((mapId) => getMapGraph(mapId)))
  // '길을 잃었어요' 뒤 위치를 다시 확정하면 같은 목적지로 다시 계산한다 (http 모드)
  const rerouting = useRef(false)
  // 보내지 못한 길안내 이벤트. 다음 이벤트와 함께 보내고, 경로가 바뀌면 버린다 (http 모드)
  const pendingEvents = useRef<{ routeId: string | null; events: NavigationEvent[] }>({ routeId: null, events: [] })
  // Handlers read the latest values through this ref so delayed replies
  // never act on a stale render's state.
  const sessionId = sessionInfo?.id ?? null
  const hasRoute = API_MODE === 'mock' ? steps.length > 0 : activeRoute !== null
  const revision = session?.revision ?? 0
  const live = useRef({ train, dest, destinationPoiId, here, failNext, lang, sessionId, sessionInfo, hasRoute, revision, located, confirming, activeRoute, stepIdx })
  useLayoutEffect(() => {
    live.current = { train, dest, destinationPoiId, here, failNext, lang, sessionId, sessionInfo, hasRoute, revision, located, confirming, activeRoute, stepIdx }
  })

  // 응답의 session을 그대로 반영한다. 늦게 도착한 옛 응답이 더 새 값을 덮지 않도록 revision이 작으면 버린다.
  const applySession = (next: SessionStatus) => setSession((cur) => (cur && next.revision < cur.revision ? cur : next))

  // mock 모드에서만 가짜 서버가 상태를 바꾼다. http 모드는 서버 응답의 session만 반영한다.
  const mockMove = (state: SessionState) => {
    if (API_MODE === 'mock') applySession(mockServer.current.advance(state))
  }

  // 시작 화면의 "시작하기". http 모드는 POST /sessions로 세션을 만든 뒤 채팅으로 넘어간다.
  const startSession = async () => {
    if (API_MODE === 'mock') {
      setSession(mockServer.current.start())
      return setScreen('chat')
    }
    const seq = ++startSeq.current
    setStarting({ pending: true, error: null })
    try {
      const out = await createSession({
        language: lang,
        map_id: MAP_ID,
        client: { platform: 'web', app_version: __APP_VERSION__, ar_capable: false },
      })
      if (seq !== startSeq.current) return
      setSessionInfo({ id: out.session_id, mapId: out.map_id, mapVersion: out.map_version })
      setSession(out.session)
      setLang(out.language)
      setStarting({ pending: false, error: null })
      setScreen('chat')
    } catch (error) {
      if (seq === startSeq.current) setStarting({ pending: false, error: toErrorView(error) })
    }
  }

  // 언어 바꾸기. 세션 전(시작 화면)과 mock 모드는 화면 언어만 바꾼다.
  // http 세션은 PATCH /sessions/{id}(409면 navigation-state로 맞춰 한 번 재시도)로 서버 언어를 바꾸고 응답의 language·session을 쓴다.
  const changeLang = (next: Lang) => {
    const { sessionId: sid, lang: prev } = live.current
    if (API_MODE === 'mock' || !sid || next === prev) return setLang(next)
    const current = () => live.current.sessionId === sid
    // 누르는 즉시 바꿔 보여 주고, 실패하면 원래 언어로 되돌린다
    const begin = () => {
      setLang(next)
      setLangPending(true)
    }
    begin()
    void sendWithRecovery(
      (options) =>
        patchLanguage(
          { api: sessionApi, sessionId: sid, language: next, revision: live.current.revision, onResync: (state) => current() && applySession(state.session) },
          options,
        ),
      {
        onSuccess: (out) => {
          setLangPending(false)
          if (!current()) return
          setLang(out.language)
          applySession(out.session)
        },
        fail: (error, handlers = {}) => {
          setLangPending(false)
          if (!current()) return
          setLang(prev)
          const { retry } = handlers
          recovery.fail(error, {
            ...handlers,
            retry: retry && (() => {
              begin()
              retry()
            }),
          })
        },
      },
    )
  }

  const push = (m: Omit<Msg, 'id'>) => {
    const id = nextId.current++
    setMessages((ms) => [...ms, { ...m, id }])
    return id
  }

  // Simulates the LLM round trip, including the timeout path (AT-07).
  const reply = (r: Reply) => {
    const id = push({ role: 'assistant', pending: true })
    const fail = live.current.failNext
    if (fail) setFailNext(false)
    setTimeout(() => {
      setMessages((ms) => ms.map((m) => (m.id === id ? { id, role: 'assistant', reply: fail ? { kind: 'error' } : r } : m)))
    }, AI_DELAY_MS)
  }

  const chooseDestination = (poi: PoiId, tip: Tip | null = null) => {
    const { here } = live.current
    setDest(poi)
    mockMove(here ? 'ready_to_navigate' : 'needs_location')
    reply({ kind: 'destSet', poi, from: mockNode(here), tip })
  }

  const runIntent = (intent: Intent, withPhoto: boolean) => {
    lastIntent.current = { intent, withPhoto }
    const { train, here } = live.current
    switch (intent) {
      case 'airport':
        mockMove('needs_clarification')
        return reply({ kind: 'trainTypes' })
      case 'notSure':
        mockMove('needs_clarification')
        return reply({ kind: 'notSure' })
      case 'express':
        setTrain('express')
        return chooseDestination('expressDesk', 'expressPay')
      // All-stop needs one more answer: the route depends on whether they already have a transit card.
      case 'allstop':
        setTrain('allstop')
        mockMove('needs_clarification')
        return reply({ kind: 'askCard' })
      case 'hasCard':
        setTrain('allstop')
        return chooseDestination('allstopPlatform', 'tapCard')
      case 'noCard':
        setTrain('allstop')
        return chooseDestination('machines', 'buySingle')
      case 'pay':
        return reply({ kind: 'pay' })
      case 'whatCard':
        return reply({ kind: 'whatCard' })
      case 'recharge':
        return reply({ kind: 'recharge' })
      case 'deposit':
        return reply({ kind: 'deposit' })
      case 'fare':
        return reply({ kind: 'fare' })
      case 'buy':
        if (!train) {
          mockMove('needs_clarification')
          return reply({ kind: 'trainTypes' })
        }
        return reply({ kind: 'buy', train, withPhoto })
      case 'platform':
        if (!train) {
          mockMove('needs_clarification')
          return reply({ kind: 'trainTypes' })
        }
        return chooseDestination(train === 'express' ? 'expressPlatform' : 'allstopPlatform')
      case 'lost':
        setHere(null)
        mockMove('needs_location')
        return reply({ kind: 'lost' })
      case 'pickList':
        return setScreen('destinations')
      case 'unknown':
        return reply(here && train && withPhoto ? { kind: 'buy', train, withPhoto } : { kind: 'outOfScope' })
    }
  }

  // http 모드: POST /messages로 보내고 응답(세션, 목적지, 열차, 말풍선)을 반영한다. 실패는 오류 알림으로 넘긴다.
  const askServer = async (u: Utterance) => {
    const sid = live.current.sessionId
    if (!sid) return
    const id = push({ role: 'assistant', pending: true })
    const setBubble = (patch: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === id ? { id, role: 'assistant', ...patch } : m)))
    // 초기화 뒤에 도착한 옛 세션의 응답과 오류는 버린다
    const current = () => live.current.sessionId === sid
    const fail = (error: unknown, handlers?: FailHandlers) => current() && recovery.fail(error, handlers)
    const simulateTimeout = live.current.failNext
    if (simulateTimeout) setFailNext(false)

    let image: Blob | undefined
    if (u.image) {
      try {
        // 서버 조건(JPEG, 2MB 이하)에 맞춘다
        image = await compressImage(u.image.file)
      } catch (error) {
        setBubble({ view: { ...toErrorView(error), actions: [] } })
        return fail(error, { manual: () => setScreen('destinations') })
      }
    }

    await sendChat({
      api: chatApi,
      sessionId: sid,
      body: messageBody(u.message, u.selectedPoiId ?? null, image),
      simulateTimeout,
      hooks: {
        fail,
        onReply: (res) => {
          if (!current()) return
          const e = replyEffects(res)
          applySession(e.session)
          setTrain(e.train)
          if (e.destination) {
            setDestinationPoiId(e.destination.serverPoiId)
            setDest(e.destination.local)
            // 목적지가 바뀌면 화면의 옛 경로는 쓰지 않는다 (서버도 active_route_id를 지운다)
            setSteps([])
            setActiveRoute(null)
            setRouteError(null)
            rerouting.current = false
            setStepIdx(0)
          }
          if (e.clearLocation) setHere(null)
          setBubble({ view: e.view })
        },
        // 버튼은 오류 알림 시트에 있다. INVALID_STATE만 onResync에서 말풍선 버튼을 채운다
        onError: (view) => setBubble({ view: { ...view, actions: [] } }),
        onRetry: () => setBubble({ pending: true }),
        onResync: (state) => {
          if (!current()) return
          applySession(state.session)
          const plan = resyncPlan(state.next_action, live.current.hasRoute)
          setMessages((ms) => ms.map((m) => (m.id === id && m.view?.kind === 'error' ? { ...m, view: { ...m.view, actions: plan.actions } } : m)))
          setScreen(plan.screen)
        },
        manual: () => setScreen('destinations'),
      },
    })
  }

  // 사용자 말을 말풍선으로 남기고, 서버(http) 또는 기존 mock 규칙으로 답한다. 모드 분기는 여기 한 곳이다.
  const say = (u: Utterance) => {
    push({ role: 'user', text: u.display || undefined, image: u.image?.url })
    if (API_MODE === 'http') return void askServer(u)
    u.mock()
  }

  const sendText = (text: string, image?: Attachment) => {
    let intent = classify(text)
    if (intent === 'unknown' && image && live.current.train) intent = 'buy'
    say({ display: text, message: text, image, mock: () => runIntent(intent, Boolean(image)) })
  }

  // mock 응답(인사말 등)의 칩. http 모드에서는 라벨을 문장으로 보낸다
  const sendChip = (label: Text, intent: Intent) => {
    say({ display: label, message: label[live.current.lang], mock: () => runIntent(intent, false) })
  }

  // 서버 응답의 추천 답변 칩. selected_poi_id가 있으면 그대로 다시 보낸다
  const sendSuggested = (chip: ChatChip) => {
    say({ display: chip.label, message: chip.label, selectedPoiId: chip.selectedPoiId, mock: () => runIntent(classify(chip.label), false) })
  }

  const retry = () => lastIntent.current && runIntent(lastIntent.current.intent, lastIntent.current.withPhoto)

  // 목적지 목록에서 고르기. http 모드는 이름과 함께 서버 POI id를 selected_poi_id로 보낸다
  const pickDestination = (poi: PoiId) => {
    const p = POIS.find((x) => x.id === poi)!
    const name = NODES[p.node].name
    setScreen('chat')
    say({
      display: name,
      message: name[live.current.lang],
      selectedPoiId: serverPoiOf(poi),
      mock: () => {
        setTrain(p.train)
        chooseDestination(poi)
      },
    })
  }

  // mock 모드: 데모 경로(findRoute)로 길안내를 시작한다
  const startMockRoute = (from: NodeId) => {
    const { dest } = live.current
    if (!dest) return setScreen('chat')
    const route = findRoute(from, POIS.find((p) => p.id === dest)!.node)
    setStartNode(from)
    setSteps(route ?? [])
    setStepIdx(0)
    mockMove(route ? 'navigating' : 'ready_to_navigate')
    setScreen('route')
  }

  // http 모드: 지도 그래프를 처음 필요할 때 한 번 받는다. 지도마다 한 번만 요청하고 실패하면 오류 알림에서 다시 시도한다
  const ensureGraph = () => {
    const { sessionId: sid, sessionInfo: info } = live.current
    if (API_MODE === 'mock' || !sid || !info) return
    graphCache.current.get(info.mapId).then(
      (g) => live.current.sessionId === sid && setGraph(g),
      (error) => live.current.sessionId === sid && recovery.fail(error, { retry: ensureGraph }),
    )
  }

  // 위치 확인 화면들에 들어오면 그래프를 준비한다. 최신 ensureGraph를 ref로 읽어 화면이 바뀔 때만 부른다
  const loadGraph = useRef(ensureGraph)
  useLayoutEffect(() => {
    loadGraph.current = ensureGraph
  })
  useEffect(() => {
    if (screen === 'locate' || screen === 'candidates' || screen === 'manual') loadGraph.current()
  }, [screen])

  // 409 INVALID_STATE 뒤: 다시 읽은 서버 상태로 맞는 화면에 간다. 채팅으로 가면 채팅과 같은 오류 말풍선과 버튼을 남긴다
  const resyncTo = (state: NavigationStateOut, error: unknown) => {
    applySession(state.session)
    const plan = resyncPlan(state.next_action, live.current.hasRoute)
    if (plan.screen === 'chat') push({ role: 'assistant', view: { ...toErrorView(error), actions: plan.actions } })
    setScreen(plan.screen)
  }

  // http 모드: 길안내 이벤트를 보낸다. 보내지 못해도 안내는 막지 않고, 남은 이벤트는 다음 이벤트와 함께 다시 보낸다.
  // event_id는 만들 때 정해져 있어서 같은 이벤트를 다시 보내도 서버는 한 번만 반영한다
  const report = (type: NavigationEventType, routeId: string) => {
    const sid = live.current.sessionId
    if (!sid) return
    const queued = pendingEvents.current.routeId === routeId ? pendingEvents.current.events : []
    const events = [...queued, createNavigationEvent(type)]
    pendingEvents.current = { routeId, events }
    void deliverEvents({ api: routeApi, sessionId: sid, routeId, pending: events }).then((outcome) => {
      if (live.current.sessionId !== sid) return
      if (outcome.kind === 'failed') {
        console.warn('[route] 길안내 이벤트를 보내지 못했어요. 다음 이벤트와 함께 다시 보냅니다', { type, error: outcome.error })
        return
      }
      // 보낸 것만 대기열에서 뺀다. 그사이 쌓인 이벤트는 남긴다
      const left = outcome.kind === 'sent' ? new Set(outcome.pending) : new Set<NavigationEvent>()
      const done = new Set(events.filter((e) => !left.has(e)).map((e) => e.event_id))
      if (pendingEvents.current.routeId === routeId) {
        pendingEvents.current = { routeId, events: pendingEvents.current.events.filter((e) => !done.has(e.event_id)) }
      }
      // closed: 도착·취소가 이미 반영돼 있었다. 다시 읽은 서버 상태를 그대로 쓴다
      applySession(outcome.kind === 'sent' ? outcome.session : outcome.state.session)
    })
  }

  // http 모드: 확정된 위치에서 서버 경로를 받는다. reroute면 같은 목적지로 다시 계산한다(서버는 route_id를 유지하고 route_revision만 올린다)
  const routeOnServer = async ({ reroute, destinationPoiId: poi, revision: expected }: { reroute: boolean; destinationPoiId: string; revision: number }) => {
    const { sessionId: sid, sessionInfo: info } = live.current
    if (!sid || !info) return
    const current = () => live.current.sessionId === sid
    setRouting(true)
    setRouteError(null)
    setScreen('route')
    let g: GraphOut
    try {
      // 노드 이름·사진과 보낼 map_version을 지도 그래프에서 읽는다
      g = await graphCache.current.get(info.mapId)
    } catch (error) {
      setRouting(false)
      if (current()) recovery.fail(error, { retry: () => void routeOnServer({ reroute, destinationPoiId: poi, revision: live.current.revision }) })
      return
    }
    if (!current()) return
    setGraph(g)
    await sendRoute({
      api: routeApi,
      sessionId: sid,
      input: { revision: expected, destinationPoiId: poi, mapVersion: g.map_version },
      reroute,
      onResync: (state) => current() && applySession(state.session),
      hooks: {
        fail: (error, handlers) => {
          setRouting(false)
          if (!current()) return
          // 등록된 경로가 없으면 경로 화면 안에서 알리고 경로를 지어내지 않는다. 다른 출발 위치는 '길을 잃었어요'로 다시 고른다
          if (isApiError(error) && error.code === 'ROUTE_NOT_FOUND') return setRouteError('not_found')
          recovery.fail(error, handlers)
        },
        onSuccess: (out) => {
          setRouting(false)
          if (!current()) return
          applySession(out.session)
          rerouting.current = false
          if (pendingEvents.current.routeId !== out.route_id) pendingEvents.current = { routeId: out.route_id, events: [] }
          setActiveRoute(toActiveRoute(out, g))
          setStepIdx(0)
          // 서버는 시작 이벤트를 ready_to_navigate에서만 받는다. 안내 중에 다시 계산한 경우는 이미 navigating이다
          if (out.session.state === 'ready_to_navigate') report('navigation_started', out.route_id)
        },
        onInvalidState: (state, error) => {
          setRouting(false)
          if (current()) resyncTo(state, error)
        },
        onRetry: () => setRouting(true),
      },
    })
  }

  // http 모드: 길을 잃은 뒤 위치를 다시 확정했을 때. navigation-state로 재탐색할 수 있는지 보고 같은 목적지로 다시 계산한다
  const rerouteOnServer = async () => {
    const { sessionId: sid, sessionInfo: info } = live.current
    if (!sid || !info) return
    const current = () => live.current.sessionId === sid
    let loaded: [NavigationStateOut, GraphOut]
    try {
      loaded = await Promise.all([getNavigationState(sid), graphCache.current.get(info.mapId)])
    } catch (error) {
      if (current()) recovery.fail(error, { retry: () => void rerouteOnServer() })
      return
    }
    if (!current()) return
    const [state, g] = loaded
    applySession(state.session)
    const plan = planReroute(state, g.map_version)
    if (plan.kind === 'needs_location') return setScreen('locate')
    if (plan.kind === 'no_destination') {
      rerouting.current = false
      return setScreen('chat')
    }
    await routeOnServer({ reroute: true, destinationPoiId: plan.request.destination_poi_id, revision: plan.request.expected_revision })
  }

  // http 모드: 사진을 서버 조건(JPEG, 2MB 이하)으로 줄여 보내고, 결과에 맞는 화면으로 간다. 위치는 여기서 확정하지 않는다
  const locateOnServer = async (file: Blob) => {
    const { sessionId: sid, sessionInfo: info, here: lastNode } = live.current
    if (!sid || !info) return setScreen('locate')
    const seq = ++photoSeq.current
    const current = () => seq === photoSeq.current && live.current.sessionId === sid
    setLocated(null)
    ensureGraph()

    let image: Blob
    try {
      image = await compressImage(file)
    } catch (error) {
      if (!current()) return
      setScreen('locate')
      return recovery.fail(error, { manual: () => setScreen('manual') })
    }

    await sendPhoto({
      api: locationApi,
      req: { sessionId: sid, mapVersion: info.mapVersion, lastNodeId: lastNode },
      image,
      hooks: {
        fail: (error, handlers) => {
          if (!current()) return
          setScreen('locate')
          recovery.fail(error, handlers)
        },
        onSuccess: (result) => {
          if (!current()) return
          setLocated(result)
          // 503: 사진 인식을 쓸 수 없다. 위치를 추측하지 않고 목록에서 고르게 한다 (서버 세션은 그대로)
          if (result.kind === 'manual') return setScreen('manual')
          applySession(result.session)
          setScreen('candidates')
        },
        onInvalidState: (state, error) => current() && resyncTo(state, error),
        onRetry: () => current() && setScreen('analyzing'),
        manual: () => setScreen('manual'),
      },
    })
  }

  const analyzePhoto = (p: Photo) => {
    setPhoto(p)
    setScreen('analyzing')
    // 모드 분기는 여기 한 곳이다. http 모드는 데모 사진(파일 없음)을 보여 주지 않는다
    if (API_MODE === 'http') return p.file ? void locateOnServer(p.file) : setScreen('locate')
    setTimeout(() => {
      const found = SCENARIOS[p.scenario]
      setCandidates(found)
      if (found.length) mockMove('needs_confirmation')
      setScreen('candidates')
    }, VISION_DELAY_MS)
  }

  // http 모드: 사용자가 고른 위치를 확정한다. 409 REVISION_CONFLICT면 다시 맞춰 한 번 더 보내고, 응답의 session·location을 쓴다
  const confirmOnServer = (choice: LocationChoice) => {
    const sid = live.current.sessionId
    if (!sid || live.current.confirming) return
    const current = () => live.current.sessionId === sid
    setConfirming(true)
    void sendConfirmation({
      api: locationApi,
      sessionId: sid,
      choice,
      revision: live.current.revision,
      onResync: (state) => current() && applySession(state.session),
      hooks: {
        fail: (error, handlers) => {
          setConfirming(false)
          if (current()) recovery.fail(error, handlers)
        },
        onSuccess: (out) => {
          setConfirming(false)
          if (!current()) return
          applySession(out.session)
          setHere(out.location.node_id)
          setLocated(null)
          // 길을 잃은 뒤라면 같은 목적지로 다시 계산하고, 목적지가 있으면 서버 경로로 길안내를 시작한다
          if (rerouting.current) return void rerouteOnServer()
          const poi = live.current.destinationPoiId
          if (poi) return void routeOnServer({ reroute: false, destinationPoiId: poi, revision: out.session.revision })
          setScreen('chat')
        },
        onInvalidState: (state, error) => {
          setConfirming(false)
          if (current()) resyncTo(state, error)
        },
        onRetry: () => setConfirming(true),
        manual: () => setScreen('manual'),
      },
    })
  }

  // Location is confirmed only by an explicit user choice, never by the top candidate alone.
  // from: 'photo'는 후보 화면, 'list'는 직접 선택 목록에서 누른 것이다
  const confirmLocation = (nodeId: string, from: 'photo' | 'list' = 'list') => {
    if (API_MODE === 'http') {
      const shot = live.current.located
      if (from === 'list') return confirmOnServer({ method: 'manual', nodeId })
      const candidate = shot?.kind === 'candidates' ? shot.candidates.find((c) => c.node_id === nodeId) : undefined
      if (shot?.kind === 'candidates' && candidate) confirmOnServer({ method: 'photo_candidate', localizationId: shot.localizationId, candidate })
      return
    }
    if (!isNodeId(nodeId)) return
    setHere(nodeId)
    mockMove('ready_to_navigate')
    if (live.current.dest) startMockRoute(nodeId)
    else setScreen('chat')
  }

  // 길안내 시작('길안내 시작' 버튼). 모드 분기는 여기 한 곳이다
  const startRoute = () => {
    const { here, destinationPoiId: poi, revision } = live.current
    if (API_MODE === 'http') return poi ? void routeOnServer({ reroute: false, destinationPoiId: poi, revision }) : setScreen('chat')
    if (here && isNodeId(here)) startMockRoute(here)
  }

  // '다음'은 화면의 단계만 넘긴다. 마지막 단계를 넘기면 도착이고, http 모드는 서버에 arrived를 알린다
  const nextStep = () => {
    if (API_MODE === 'http') {
      const route = live.current.activeRoute
      if (!route) return
      if (stepIdx + 1 < route.steps.length) return setStepIdx(stepIdx + 1)
      setStepIdx(route.steps.length)
      // 서버도 도착하면 목적지 노드를 새 현재 위치로 둔다 (backend/app/api/sessions.py)
      setHere(route.stops[route.stops.length - 1].nodeId)
      report('arrived', route.routeId)
      return setScreen('arrived')
    }
    if (stepIdx + 1 < steps.length) return setStepIdx(stepIdx + 1)
    const arrivedAt = steps.length ? steps[steps.length - 1].edge.to : startNode
    setStepIdx(steps.length)
    setHere(arrivedAt)
    mockMove('arrived')
    setScreen('arrived')
  }

  const reportLost = () => {
    // http 모드: 서버는 relocalize로 확정 위치만 지우고 목적지·경로는 남긴다. 위치를 다시 확정하면 같은 목적지로 다시 계산한다.
    // navigation_cancelled는 목적지까지 지우므로 여기서는 보내지 않는다
    if (API_MODE === 'http') rerouting.current = live.current.activeRoute !== null
    const text: Text = { en: 'I think I’m lost', ko: '길을 잃은 것 같아요' }
    say({ display: text, message: text[live.current.lang], mock: () => runIntent('lost', false) })
    setScreen('locate')
  }

  const reset = () => {
    // 안내 중에 처음으로 가면 서버에 취소를 알린다. 요청 헤더는 보내는 순간 만들어지므로 세션 토큰을 지우기 전에 보낸다
    const { activeRoute: route, stepIdx: at } = live.current
    if (API_MODE === 'http' && route && at < route.steps.length) report('navigation_cancelled', route.routeId)
    startSeq.current++
    // 다음 "시작하기"에서 새 세션을 만든다. 서버 세션은 2시간 동안 요청이 없으면 만료된다.
    if (API_MODE === 'http') clearSession()
    setSession(null)
    setSessionInfo(null)
    setStarting({ pending: false, error: null })
    setTrain(null)
    setDest(null)
    setDestinationPoiId(null)
    setHere(null)
    setSteps([])
    setStartNode(null)
    setActiveRoute(null)
    setRouting(false)
    setRouteError(null)
    rerouting.current = false
    pendingEvents.current = { routeId: null, events: [] }
    setStepIdx(0)
    setMessages([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
    setPhoto(null)
    setCandidates([])
    photoSeq.current++
    graphCache.current.clear()
    setGraph(null)
    setLocated(null)
    setConfirming(false)
    setFailNext(false)
    setDemoOpen(false)
    // 세션 종료 화면의 '다시 시작', 오류 알림의 '처음으로', 데모 초기화가 모두 여기로 온다
    recovery.clear()
    setScreen('welcome')
  }

  // 경로 화면으로 돌아갈 수 있는지. http 모드는 서버 경로가 있고 아직 도착하지 않았을 때다
  // (시작 이벤트를 보내지 못해도 안내는 막지 않으므로 서버 state 대신 화면의 경로로 판단한다)
  const routeActive = API_MODE === 'mock' ? session?.state === 'navigating' : activeRoute !== null && stepIdx < activeRoute.steps.length

  // 경로 화면(노선 보기·거리뷰)이 그리는 모델. http 모드는 서버 경로와 지도 그래프, mock 모드는 데모 경로(findRoute)
  const guide = useMemo(() => {
    if (API_MODE === 'http') return activeRoute ? serverGuide(activeRoute, graph) : null
    return startNode && dest ? mockGuide(steps, startNode, POIS.find((p) => p.id === dest)!.node) : null
  }, [activeRoute, graph, steps, startNode, dest])

  // 도착 화면에 보일 장소. http 모드는 지도 그래프의 이름(없으면 node id), mock 모드는 data.ts
  const arrivedNode = graph?.nodes.find((n) => n.id === here)
  const arrivedPlace: PlaceView | null =
    here === null
      ? null
      : API_MODE === 'mock'
        ? isNodeId(here) ? { nodeId: here, floor: NODES[here].floor, name: NODES[here].name } : null
        : { nodeId: here, floor: arrivedNode?.floor_id ?? '', name: arrivedNode?.name ?? null }
  // 표 사는 곳에 도착했으면 표 사는 법을 이어서 묻게 한다. dest는 서버 목적지를 데모 PoiId로 이은 값이다 (replyEffects, poiBridge)
  const atTickets = dest !== null && TICKET_POIS.has(dest)

  // 후보·직접 선택 화면이 보는 목록. http 모드는 서버 후보와 지도 그래프(받는 중이면 null), mock 모드는 data.ts
  const candidateList: CandidateView[] =
    API_MODE === 'mock' ? mockCandidateViews(candidates) : located?.kind === 'candidates' ? candidateViews(located.candidates, graph) : []
  const retakeHint = API_MODE === 'http' && located?.kind === 'no_match' ? located.retakeHint : null
  // 마지막 사진이 503이었으면 직접 선택 화면에 안내 한 줄을 보여 준다. 다시 찍거나 확정하면 지워진다
  const manualReason: ManualReason = located?.kind === 'manual' ? located.reason : null
  const manualList: PlaceView[] | null = API_MODE === 'mock' ? mockManualPlaces() : graph ? manualPlaces(graph) : null
  // 데모 사진과 업로드 결과 스위치는 서버로 보낼 파일이 없어 mock 모드에서만 쓴다
  const demoPhotos = API_MODE === 'mock'

  return {
    lang, setLang, changeLang, langPending, screen, setScreen, session, sessionInfo, applySession, starting, startSession, routeActive,
    train, dest, destinationPoiId, here, guide, routing, routeError, arrivedPlace, atTickets, stepIdx, messages, photo,
    graph, ensureGraph, candidateList, retakeHint, manualList, manualReason, confirming, demoPhotos,
    failNext, setFailNext, uploadScenario, setUploadScenario, demoOpen, setDemoOpen,
    sendText, sendChip, sendSuggested, retry, pickDestination, startRoute, analyzePhoto, confirmLocation, nextStep, reportLost, reset,
  }
}

type App = ReturnType<typeof useAppState>
const Ctx = createContext<App | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={useAppState()}>{children}</Ctx.Provider>
}

export function useApp() {
  const app = useContext(Ctx)
  if (!app) throw new Error('useApp outside AppProvider')
  return app
}
