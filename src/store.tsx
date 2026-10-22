// PROTOTYPE session flow. Mirrors the backend session state machine
// (idle → needs_clarification → needs_location → needs_confirmation →
// ready_to_navigate → navigating → arrived) with in-memory mocks.
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { classify } from './assistant'
import type { Intent, Reply, Tip } from './assistant'
import { NODES, POIS, SCENARIOS } from './data'
import type { Candidate, Lang, NodeId, PhotoScenario, PoiId, Text, TrainType } from './data'
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

const AI_DELAY_MS = 900
const VISION_DELAY_MS = 1600

function useAppState() {
  const [lang, setLang] = useState<Lang>('en')
  const [screen, setScreen] = useState<Screen>('welcome')
  const [session, setSession] = useState<{ state: SessionState; revision: number }>({ state: 'idle', revision: 1 })
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
  // Handlers read the latest values through this ref so delayed replies
  // never act on a stale render's state.
  const live = useRef({ train, dest, here, failNext })
  useLayoutEffect(() => {
    live.current = { train, dest, here, failNext }
  })

  const moveTo = (state: SessionState) => setSession((s) => ({ state, revision: s.revision + 1 }))

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
    moveTo(here ? 'ready_to_navigate' : 'needs_location')
    reply({ kind: 'destSet', poi, from: here, tip })
  }

  const runIntent = (intent: Intent, withPhoto: boolean) => {
    lastIntent.current = { intent, withPhoto }
    const { train, here } = live.current
    switch (intent) {
      case 'airport':
        moveTo('needs_clarification')
        return reply({ kind: 'trainTypes' })
      case 'notSure':
        moveTo('needs_clarification')
        return reply({ kind: 'notSure' })
      case 'express':
        setTrain('express')
        return chooseDestination('expressDesk', 'expressPay')
      // All-stop needs one more answer: the route depends on whether they already have a transit card.
      case 'allstop':
        setTrain('allstop')
        moveTo('needs_clarification')
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
          moveTo('needs_clarification')
          return reply({ kind: 'trainTypes' })
        }
        return reply({ kind: 'buy', train, withPhoto })
      case 'platform':
        if (!train) {
          moveTo('needs_clarification')
          return reply({ kind: 'trainTypes' })
        }
        return chooseDestination(train === 'express' ? 'expressPlatform' : 'allstopPlatform')
      case 'lost':
        setHere(null)
        moveTo('needs_location')
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
    moveTo(route ? 'navigating' : 'ready_to_navigate')
    setScreen('route')
  }

  const analyzePhoto = (p: Photo) => {
    setPhoto(p)
    setScreen('analyzing')
    setTimeout(() => {
      const found = SCENARIOS[p.scenario]
      setCandidates(found)
      if (found.length) moveTo('needs_confirmation')
      setScreen('candidates')
    }, VISION_DELAY_MS)
  }

  // Location is confirmed only by an explicit user choice, never by the top candidate alone.
  const confirmLocation = (node: NodeId) => {
    setHere(node)
    moveTo('ready_to_navigate')
    if (live.current.dest) startRoute(node)
    else setScreen('chat')
  }

  const nextStep = () => {
    if (stepIdx + 1 < steps.length) return setStepIdx(stepIdx + 1)
    const arrivedAt = steps.length ? steps[steps.length - 1].edge.to : startNode
    setStepIdx(steps.length)
    setHere(arrivedAt)
    moveTo('arrived')
    setScreen('arrived')
  }

  const reportLost = () => {
    push({ role: 'user', text: { en: 'I think I’m lost', ko: '길을 잃은 것 같아요' } })
    runIntent('lost', false)
    setScreen('locate')
  }

  const reset = () => {
    setSession({ state: 'idle', revision: 1 })
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
    setScreen('welcome')
  }

  return {
    lang, setLang, screen, setScreen, session, train, dest, here, steps, startNode, stepIdx, messages, photo, candidates,
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
