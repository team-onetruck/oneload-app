// PROTOTYPE session flow. Mirrors the backend session state machine
// (idle → needs_clarification → needs_location → needs_confirmation →
// ready_to_navigate → navigating → arrived) with in-memory mocks.
// 세션 생성과 채팅은 VITE_API_MODE(기본 http)에 따라 서버 또는 mock 규칙(가짜 세션 서버, assistant.ts)을 쓴다.
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { clearSession, createSession, getNavigationState, patchSession, sendMessage } from './api'
import type { SessionStatus } from './api'
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
}

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
  // 서버가 정한 목적지 POI id. dest는 데모 경로용으로 이어 붙인 값이다 (poiBridge)
  const [destinationPoiId, setDestinationPoiId] = useState<string | null>(null)
  const [here, setHere] = useState<NodeId | null>(null)
  const [steps, setSteps] = useState<Step[]>([])
  const [startNode, setStartNode] = useState<NodeId | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
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
  // Handlers read the latest values through this ref so delayed replies
  // never act on a stale render's state.
  const sessionId = sessionInfo?.id ?? null
  const hasRoute = steps.length > 0
  const revision = session?.revision ?? 0
  const live = useRef({ train, dest, here, failNext, lang, sessionId, hasRoute, revision })
  useLayoutEffect(() => {
    live.current = { train, dest, here, failNext, lang, sessionId, hasRoute, revision }
  })

  // 응답의 session을 그대로 반영한다. 늦게 도착한 옛 응답이 더 새 값을 덮지 않도록 revision이 작으면 버린다.
  const applySession = (next: SessionStatus) => setSession((cur) => (cur && next.revision < cur.revision ? cur : next))

  // mock 모드에서만 가짜 서버가 상태를 바꾼다. http 모드의 위치·경로 흐름은 아직 서버에 알리지 않으므로
  // (작업 3, 4) 세션도 바꾸지 않는다.
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
    reply({ kind: 'destSet', poi, from: here, tip })
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

  const startRoute = (from: NodeId) => {
    const { dest } = live.current
    if (!dest) return setScreen('chat')
    const route = findRoute(from, POIS.find((p) => p.id === dest)!.node)
    setStartNode(from)
    setSteps(route ?? [])
    setStepIdx(0)
    mockMove(route ? 'navigating' : 'ready_to_navigate')
    setScreen('route')
  }

  const analyzePhoto = (p: Photo) => {
    setPhoto(p)
    setScreen('analyzing')
    setTimeout(() => {
      const found = SCENARIOS[p.scenario]
      setCandidates(found)
      if (found.length) mockMove('needs_confirmation')
      setScreen('candidates')
    }, VISION_DELAY_MS)
  }

  // Location is confirmed only by an explicit user choice, never by the top candidate alone.
  const confirmLocation = (node: NodeId) => {
    setHere(node)
    mockMove('ready_to_navigate')
    if (live.current.dest) startRoute(node)
    else setScreen('chat')
  }

  const nextStep = () => {
    if (stepIdx + 1 < steps.length) return setStepIdx(stepIdx + 1)
    const arrivedAt = steps.length ? steps[steps.length - 1].edge.to : startNode
    setStepIdx(steps.length)
    setHere(arrivedAt)
    mockMove('arrived')
    setScreen('arrived')
  }

  const reportLost = () => {
    const text: Text = { en: 'I think I’m lost', ko: '길을 잃은 것 같아요' }
    say({ display: text, message: text[live.current.lang], mock: () => runIntent('lost', false) })
    setScreen('locate')
  }

  const reset = () => {
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
    setStepIdx(0)
    setMessages([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
    setPhoto(null)
    setCandidates([])
    setFailNext(false)
    setDemoOpen(false)
    // 세션 종료 화면의 '다시 시작', 오류 알림의 '처음으로', 데모 초기화가 모두 여기로 온다
    recovery.clear()
    setScreen('welcome')
  }

  // 경로 화면으로 돌아갈 수 있는지. http 모드의 경로는 아직 서버와 연결되지 않아서(작업 4)
  // 서버 상태 대신 화면에 진행 중인 경로가 있는지로 판단한다.
  const routeActive = API_MODE === 'mock' ? session?.state === 'navigating' : here !== null && stepIdx < steps.length

  return {
    lang, setLang, changeLang, langPending, screen, setScreen, session, sessionInfo, applySession, starting, startSession, routeActive,
    train, dest, destinationPoiId, here, steps, startNode, stepIdx, messages, photo, candidates,
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
