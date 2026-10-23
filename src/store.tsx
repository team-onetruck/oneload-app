// PROTOTYPE session flow. Mirrors the backend session state machine
// (idle → needs_clarification → needs_location → needs_confirmation →
// ready_to_navigate → navigating → arrived) with in-memory mocks.
// 세션 생성은 VITE_API_MODE(기본 http)에 따라 서버 또는 가짜 세션 서버를 쓴다.
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { clearSession, createSession } from './api'
import type { SessionStatus } from './api'
import { API_MODE } from './api/mode'
import { classify } from './assistant'
import type { Intent, Reply, Tip } from './assistant'
import { NODES, POIS, SCENARIOS } from './data'
import type { Candidate, Lang, NodeId, PhotoScenario, PoiId, Text, TrainType } from './data'
import { toErrorView } from './features/chat/toViewModel'
import type { ErrorView } from './features/chat/toViewModel'
import { useRecovery } from './features/recovery/context'
import { createMockSessionServer } from './features/session/mockSession'
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
  pending?: boolean
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

function useAppState() {
  const [lang, setLang] = useState<Lang>('en')
  const [screen, setScreen] = useState<Screen>('welcome')
  // state·revision은 서버(mock 모드에서는 가짜 서버) 응답의 session 필드로만 바뀐다. 시작 전에는 null
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [starting, setStarting] = useState<{ pending: boolean; error: ErrorView | null }>({ pending: false, error: null })
  const [train, setTrain] = useState<TrainType | null>(null)
  const [dest, setDest] = useState<PoiId | null>(null)
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
  const live = useRef({ train, dest, here, failNext })
  useLayoutEffect(() => {
    live.current = { train, dest, here, failNext }
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

  const sendText = (text: string, image?: string) => {
    let intent = classify(text)
    if (intent === 'unknown' && image && live.current.train) intent = 'buy'
    push({ role: 'user', text: text || undefined, image })
    runIntent(intent, Boolean(image))
  }

  const sendChip = (label: Text, intent: Intent) => {
    push({ role: 'user', text: label })
    runIntent(intent, false)
  }

  const retry = () => lastIntent.current && runIntent(lastIntent.current.intent, lastIntent.current.withPhoto)

  const pickDestination = (poi: PoiId) => {
    const p = POIS.find((x) => x.id === poi)!
    setTrain(p.train)
    push({ role: 'user', text: NODES[p.node].name })
    setScreen('chat')
    chooseDestination(poi)
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
    push({ role: 'user', text: { en: 'I think I’m lost', ko: '길을 잃은 것 같아요' } })
    runIntent('lost', false)
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
    lang, setLang, screen, setScreen, session, sessionInfo, applySession, starting, startSession, routeActive,
    train, dest, here, steps, startNode, stepIdx, messages, photo, candidates,
    failNext, setFailNext, uploadScenario, setUploadScenario, demoOpen, setDemoOpen,
    sendText, sendChip, retry, pickDestination, startRoute, analyzePhoto, confirmLocation, nextStep, reportLost, reset,
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
