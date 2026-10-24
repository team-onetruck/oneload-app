// 화면 상태와 사용자 동작. 서버 호출은 src/api의 어댑터 하나로만 하고, 세션 state·revision은 늘 응답 값을 쓴다.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  clearSession, confirmLocation as confirmLocationApi, createRoute, createSession, getMapGraph, getNavigationState, isApiError,
  patchSession, postLocalization, postNavigationEvents, searchPois, sendMessage,
} from './api'
import type { GraphOut, NavigationStateOut, PoisOut, SessionStatus } from './api'
import type { Reply } from './assistant'
import type { Lang, Text, TrainType } from './data'
import { messageBody, replyEffects, resyncPlan } from './features/chat/replyEffects'
import { sendChat } from './features/chat/sendChat'
import { toErrorView } from './features/chat/toViewModel'
import type { ChatChip, ChatView, ErrorView } from './features/chat/toViewModel'
import { compressImage } from './features/localization/compressImage'
import type { LocationChoice } from './features/localization/confirm'
import { sendConfirmation, sendPhoto } from './features/localization/flow'
import type { LocateResult } from './features/localization/locate'
import { candidateViews, manualPlaces } from './features/localization/views'
import type { CandidateView, PlaceView } from './features/localization/views'
import { destinationViews } from './features/map/destinations'
import type { DestinationView } from './features/map/destinations'
import { createGraphCache, createMapCache } from './features/map/graphCache'
import { createNavigationEvent } from './features/route/events'
import type { NavigationEventType } from './features/route/events'
import { deliverEvents, sendRoute } from './features/route/flow'
import type { DeliveryOutcome } from './features/route/flow'
import { serverGuide, toActiveRoute } from './features/route/guide'
import type { ActiveRoute } from './features/route/guide'
import { createEventOutbox } from './features/route/outbox'
import { planReroute } from './features/route/request'
import { useRecovery } from './features/recovery/context'
import type { FailHandlers } from './features/recovery/context'
import { sendWithRecovery } from './features/recovery/retry'
import { patchLanguage } from './features/session/language'
import { detectDeviceLang } from './features/session/languages'

export type Screen = 'welcome' | 'chat' | 'locate' | 'analyzing' | 'candidates' | 'manual' | 'destinations' | 'route' | 'arrived'

export interface Msg {
  id: number
  role: 'user' | 'assistant'
  text?: string | Text
  image?: string
  // 화면이 그리는 첫 인사(greet). 언어를 바꾸면 그 언어로 다시 그린다
  reply?: Reply
  // 서버의 응답·오류 말풍선
  view?: ChatView
  pending?: boolean
}

// 채팅에 첨부한 사진. url은 말풍선 미리보기, file은 서버로 보낼 원본이다
export interface Attachment {
  url: string
  file: Blob
}

// 사용자가 보낸 말 한 번. 말풍선에 보일 내용과 서버에 보낼 내용을 함께 담는다
interface Utterance {
  display?: string | Text
  message: string
  selectedPoiId?: string | null
  image?: Attachment
}

export interface Photo {
  src: string
  // 사용자가 찍거나 올린 사진. 압축해서 보낸다
  file: Blob
}

// 직접 선택 화면에 온 이유. 사진 인식을 쓸 수 없어(503) 넘어왔으면 안내 한 줄을 보여 준다
export type ManualReason = 'ai_unavailable' | null

// 서버 세션의 식별 정보. 토큰은 src/api 클라이언트가 보관한다.
export interface SessionInfo {
  id: string
  mapId: string
  mapVersion: string
}

const MAP_ID = 'seoul-station'
const chatApi = { sendMessage, getNavigationState }
const sessionApi = { patchSession, getNavigationState }
const locationApi = { postLocalization, confirmLocation: confirmLocationApi, getNavigationState }
const routeApi = { createRoute, postNavigationEvents, getNavigationState }
function useAppState() {
  // 시작 언어는 기기 언어를 따른다. 이후에는 메뉴의 언어 설정(changeLang)으로만 바꾼다
  const [lang, setLang] = useState<Lang>(() => detectDeviceLang())
  const [screen, setScreen] = useState<Screen>('welcome')
  const [menuOpen, setMenuOpen] = useState(false)
  // state·revision은 서버 응답의 session 필드로만 바뀐다. 시작 전에는 null
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [starting, setStarting] = useState<{ pending: boolean; error: ErrorView | null }>({ pending: false, error: null })
  // 언어 PATCH를 보내는 중이면 언어 버튼을 잠근다
  const [langPending, setLangPending] = useState(false)
  const [train, setTrain] = useState<TrainType | null>(null)
  // 목적지. 서버가 정한 poi_id를 경로 요청에 그대로 쓴다
  const [dest, setDest] = useState<string | null>(null)
  // 현재 위치. 서버가 확정한 node_id
  const [here, setHere] = useState<string | null>(null)
  // 서버가 만든 진행 중 경로와 요청 상태. 단계 진행(stepIdx)은 화면 상태로만 둔다
  const [activeRoute, setActiveRoute] = useState<ActiveRoute | null>(null)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState<'not_found' | null>(null)
  const [stepIdx, setStepIdx] = useState(0)
  const [messages, setMessages] = useState<Msg[]>([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
  const [photo, setPhoto] = useState<Photo | null>(null)
  // 지도 그래프(직접 선택 목록, 후보 이름, 경로 화면의 노드 이름·사진)와 마지막 사진 결과(후보 / 재촬영 / 503 직접 선택)
  const [graph, setGraph] = useState<GraphOut | null>(null)
  // 목적지 목록 (GET /maps/{id}/pois). 목록 화면에 들어올 때 지도마다 한 번 받는다
  const [pois, setPois] = useState<PoisOut | null>(null)
  const [located, setLocated] = useState<LocateResult | null>(null)
  // 위치 확정 요청을 보내는 중이면 후보·목록 버튼을 잠근다
  const [confirming, setConfirming] = useState(false)
  const nextId = useRef(1)
  // 오류 복구 상태. RecoveryProvider가 AppProvider 바깥에 있어서 store에서도 fail()을 쓸 수 있다
  const recovery = useRecovery()
  // 초기화 뒤에 도착한 세션 생성 응답을 버리기 위한 번호
  const startSeq = useRef(0)
  // 다시 찍었거나 초기화한 뒤에 도착한 옛 사진 결과를 버리기 위한 번호
  const photoSeq = useRef(0)
  const graphCache = useRef(createGraphCache((mapId) => getMapGraph(mapId)))
  // 검색어 없이 전체 목록을 받는다
  const poiCache = useRef(createMapCache((mapId) => searchPois(mapId)))
  // '길을 잃었어요' 뒤 위치를 다시 확정하면 같은 목적지로 다시 계산한다 
  const rerouting = useRef(false)
  // 길안내 이벤트 대기열. 한 번에 한 묶음씩 보내고, 보내는 중인 이벤트는 다음 묶음에 넣지 않으며, 실패한 것만 되돌린다.
  // 경로가 바뀌면 옛 대기열을 버린다 (features/route/outbox.ts)
  const outbox = useRef(
    createEventOutbox(async (routeId, batch): Promise<DeliveryOutcome> => {
      const sid = live.current.sessionId
      if (!sid) return { kind: 'failed', error: new Error('세션이 없어 길안내 이벤트를 보내지 않았어요'), pending: batch }
      const outcome = await deliverEvents({ api: routeApi, sessionId: sid, routeId, pending: batch })
      // 초기화 뒤에 도착한 옛 세션의 결과는 반영하지 않는다
      if (live.current.sessionId !== sid) return outcome
      if (outcome.kind === 'failed') {
        console.warn('[route] 길안내 이벤트를 보내지 못했어요. 다음 이벤트와 함께 다시 보냅니다', {
          events: batch.map((e) => e.type),
          error: outcome.error,
        })
      } else {
        // closed: 도착·취소가 이미 반영돼 있었다. 다시 읽은 서버 상태를 그대로 쓴다
        applySession(outcome.kind === 'sent' ? outcome.session : outcome.state.session)
      }
      return outcome
    }),
  )
  // Handlers read the latest values through this ref so delayed replies
  // never act on a stale render's state.
  const sessionId = sessionInfo?.id ?? null
  const hasRoute = activeRoute !== null
  const revision = session?.revision ?? 0
  const live = useRef({ train, dest, here, lang, sessionId, sessionInfo, hasRoute, revision, located, confirming, activeRoute, stepIdx })
  useLayoutEffect(() => {
    live.current = { train, dest, here, lang, sessionId, sessionInfo, hasRoute, revision, located, confirming, activeRoute, stepIdx }
  })

  // 응답의 session을 그대로 반영한다. 늦게 도착한 옛 응답이 더 새 값을 덮지 않도록 revision이 작으면 버린다.
  const applySession = (next: SessionStatus) => setSession((cur) => (cur && next.revision < cur.revision ? cur : next))

  // 시작 화면의 "시작하기". POST /sessions로 세션을 만든 뒤 채팅으로 넘어간다.
  const startSession = async () => {
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

  // 언어 바꾸기. 세션 전(시작 화면)에는 화면 언어만 바꾼다.
  // 세션이 있으면 PATCH /sessions/{id}(409면 navigation-state로 맞춰 한 번 재시도)로 서버 언어를 바꾸고 응답의 language·session을 쓴다.
  const changeLang = (next: Lang) => {
    const { sessionId: sid, lang: prev } = live.current
    if (!sid || next === prev) return setLang(next)
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

  // POST /messages로 보내고 응답(세션, 목적지, 열차, 말풍선)을 반영한다. 실패는 오류 알림으로 넘긴다.
  const askServer = async (u: Utterance) => {
    const sid = live.current.sessionId
    if (!sid) return
    const id = push({ role: 'assistant', pending: true })
    const setBubble = (patch: Partial<Msg>) => setMessages((ms) => ms.map((m) => (m.id === id ? { id, role: 'assistant', ...patch } : m)))
    // 초기화 뒤에 도착한 옛 세션의 응답과 오류는 버린다
    const current = () => live.current.sessionId === sid
    const fail = (error: unknown, handlers?: FailHandlers) => current() && recovery.fail(error, handlers)

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
      hooks: {
        fail,
        onReply: (res) => {
          if (!current()) return
          const e = replyEffects(res)
          applySession(e.session)
          setTrain(e.train)
          if (e.destination) {
            setDest(e.destination)
            // 목적지가 바뀌면 화면의 옛 경로는 쓰지 않는다 (서버도 active_route_id를 지운다)
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

  // 사용자 말을 말풍선으로 남기고 서버에 보낸다
  const say = (u: Utterance) => {
    push({ role: 'user', text: u.display || undefined, image: u.image?.url })
    void askServer(u)
  }

  const sendText = (text: string, image?: Attachment) => say({ display: text, message: text, image })

  // 첫 인사 말풍선과 도착 화면의 버튼. 라벨을 지금 언어의 문장으로 보낸다
  const sendChip = (label: Text) => say({ display: label, message: label[live.current.lang] })

  // 서버 응답의 추천 답변 칩. selected_poi_id가 있으면 그대로 다시 보낸다
  const sendSuggested = (chip: ChatChip) => say({ display: chip.label, message: chip.label, selectedPoiId: chip.selectedPoiId })

  // 목적지 목록에서 고르기. 이름과 함께 poi_id를 그대로 selected_poi_id로 보낸다
  const pickDestination = (poiId: string) => {
    const picked = destinationList?.find((d) => d.poiId === poiId)
    if (!picked) return
    setScreen('chat')
    say({ display: picked.name, message: picked.name[live.current.lang], selectedPoiId: poiId })
  }

  // 지도 그래프를 처음 필요할 때 한 번 받는다. 지도마다 한 번만 요청하고 실패하면 오류 알림에서 다시 시도한다
  const ensureGraph = () => {
    const { sessionId: sid, sessionInfo: info } = live.current
    if (!sid || !info) return
    graphCache.current.get(info.mapId).then(
      (g) => live.current.sessionId === sid && setGraph(g),
      (error) => live.current.sessionId === sid && recovery.fail(error, { retry: ensureGraph }),
    )
  }

  // 목적지 목록을 처음 필요할 때 한 번 받는다. 목록 화면에서 실패하면 오류 알림에서 다시 시도하고,
  // 도착 화면(표 사는 곳인지 판단)에서는 알리지 않는다. 그때는 표 사는 법 버튼 대신 평가 화면이 보인다
  const ensurePois = (report = true) => {
    const { sessionId: sid, sessionInfo: info } = live.current
    if (!sid || !info) return
    poiCache.current.get(info.mapId).then(
      (out) => live.current.sessionId === sid && setPois(out),
      (error) => {
        if (live.current.sessionId !== sid) return
        if (report) recovery.fail(error, { retry: () => ensurePois() })
        else console.warn('[destinations] 목적지 목록을 받지 못했어요', error)
      },
    )
  }

  // 위치 확인 화면들에 들어오면 그래프를, 목적지 목록 화면에 들어오면 목록을 준비한다.
  // 최신 함수를 ref로 읽어 화면이 바뀔 때만 부른다
  const loaders = useRef({ ensureGraph, ensurePois })
  useLayoutEffect(() => {
    loaders.current = { ensureGraph, ensurePois }
  })
  useEffect(() => {
    if (screen === 'locate' || screen === 'candidates' || screen === 'manual') loaders.current.ensureGraph()
    if (screen === 'destinations') loaders.current.ensurePois()
    if (screen === 'arrived') loaders.current.ensurePois(false)
  }, [screen])

  // 409 INVALID_STATE 뒤: 다시 읽은 서버 상태로 맞는 화면에 간다. 채팅으로 가면 채팅과 같은 오류 말풍선과 버튼을 남긴다
  const resyncTo = (state: NavigationStateOut, error: unknown) => {
    applySession(state.session)
    const plan = resyncPlan(state.next_action, live.current.hasRoute)
    if (plan.screen === 'chat') push({ role: 'assistant', view: { ...toErrorView(error), actions: plan.actions } })
    setScreen(plan.screen)
  }

  // 길안내 이벤트를 보낸다. 보내지 못해도 안내는 막지 않는다. 순서와 재전송은 대기열이 맡는다.
  // event_id는 만들 때 정해져 있어서 같은 이벤트를 다시 보내도 서버는 한 번만 반영한다
  const report = (type: NavigationEventType, routeId: string, options?: { now?: boolean }) => {
    if (!live.current.sessionId) return
    outbox.current.push(routeId, createNavigationEvent(type), options)
  }

  // 확정된 위치에서 서버 경로를 받는다. reroute면 같은 목적지로 다시 계산한다(서버는 route_id를 유지하고 route_revision만 올린다)
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

  // 길을 잃은 뒤 위치를 다시 확정했을 때. navigation-state로 재탐색할 수 있는지 보고 같은 목적지로 다시 계산한다
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

  // 사진을 서버 조건(JPEG, 2MB 이하)으로 줄여 보내고, 결과에 맞는 화면으로 간다. 위치는 여기서 확정하지 않는다
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
    void locateOnServer(p.file)
  }

  // 사용자가 고른 위치를 확정한다. 409 REVISION_CONFLICT면 다시 맞춰 한 번 더 보내고, 응답의 session·location을 쓴다
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
          const poi = live.current.dest
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
    const shot = live.current.located
    if (from === 'list') return confirmOnServer({ method: 'manual', nodeId })
    const candidate = shot?.kind === 'candidates' ? shot.candidates.find((c) => c.node_id === nodeId) : undefined
    if (shot?.kind === 'candidates' && candidate) confirmOnServer({ method: 'photo_candidate', localizationId: shot.localizationId, candidate })
  }

  // 길안내 시작('길안내 시작' 버튼)
  const startRoute = () => {
    const { dest: poi, revision } = live.current
    if (poi) return void routeOnServer({ reroute: false, destinationPoiId: poi, revision })
    setScreen('chat')
  }

  // '다음'은 화면의 단계만 넘긴다. 마지막 단계를 넘기면 도착이고 서버에 arrived를 알린다
  const nextStep = () => {
    const route = live.current.activeRoute
    if (!route) return
    if (stepIdx + 1 < route.steps.length) return setStepIdx(stepIdx + 1)
    setStepIdx(route.steps.length)
    // 서버도 도착하면 목적지 노드를 새 현재 위치로 둔다 (backend/app/api/sessions.py)
    setHere(route.stops[route.stops.length - 1].nodeId)
    report('arrived', route.routeId)
    setScreen('arrived')
  }

  const reportLost = () => {
    // 서버는 relocalize로 확정 위치만 지우고 목적지·경로는 남긴다. 위치를 다시 확정하면 같은 목적지로 다시 계산한다.
    // navigation_cancelled는 목적지까지 지우므로 여기서는 보내지 않는다
    rerouting.current = live.current.activeRoute !== null
    const text: Text = { en: 'I think I’m lost', ko: '길을 잃은 것 같아요' }
    say({ display: text, message: text[live.current.lang] })
    setScreen('locate')
  }

  const reset = () => {
    // 안내 중에 처음으로 가면 서버에 취소를 알린다. 요청 헤더는 보내는 순간 만들어지므로 세션 토큰을 지우기 전에,
    // 보내는 중인 묶음을 기다리지 않고 바로 보낸다 (세션을 버리므로 순서는 상관없다)
    const { activeRoute: route, stepIdx: at } = live.current
    if (route && at < route.steps.length) report('navigation_cancelled', route.routeId, { now: true })
    startSeq.current++
    // 다음 "시작하기"에서 새 세션을 만든다. 서버 세션은 2시간 동안 요청이 없으면 만료된다.
    clearSession()
    setSession(null)
    setSessionInfo(null)
    setStarting({ pending: false, error: null })
    setTrain(null)
    setDest(null)
    setHere(null)
    setActiveRoute(null)
    setRouting(false)
    setRouteError(null)
    rerouting.current = false
    outbox.current.reset()
    setStepIdx(0)
    setMessages([{ id: 0, role: 'assistant', reply: { kind: 'greet' } }])
    setPhoto(null)
    photoSeq.current++
    graphCache.current.clear()
    setGraph(null)
    poiCache.current.clear()
    setPois(null)
    setLocated(null)
    setConfirming(false)
    setMenuOpen(false)
    // 세션 종료 화면의 '다시 시작', 오류 알림의 '처음으로'가 모두 여기로 온다
    recovery.clear()
    setScreen('welcome')
  }

  // 경로 화면으로 돌아갈 수 있는지. 서버 경로가 있고 아직 도착하지 않았을 때다
  // (시작 이벤트를 보내지 못해도 안내는 막지 않으므로 서버 state 대신 화면의 경로로 판단한다)
  const routeActive = activeRoute !== null && stepIdx < activeRoute.steps.length

  // 경로 화면(노선 보기·거리뷰)이 그리는 모델. 서버 경로와 지도 그래프로 만든다
  const guide = useMemo(() => (activeRoute ? serverGuide(activeRoute, graph) : null), [activeRoute, graph])

  // 도착 화면에 보일 장소. 지도 그래프의 이름(없으면 node id)
  const arrivedNode = graph?.nodes.find((n) => n.id === here)
  const arrivedPlace: PlaceView | null = here === null ? null : { nodeId: here, floor: arrivedNode?.floor_id ?? '', name: arrivedNode?.name ?? null }
  // 목적지 목록 화면이 보는 목록. 서버 POI(받는 중이면 null)
  const destinationList: DestinationView[] | null = pois ? destinationViews(pois) : null
  // 표 사는 곳(category tickets)에 도착했으면 표 사는 법을 이어서 묻게 한다. 서버 POI 목록에서 찾는다
  const atTickets = destinationList?.find((d) => d.poiId === dest)?.tickets ?? false

  // 후보·직접 선택 화면이 보는 목록. 서버 후보와 지도 그래프(받는 중이면 null)
  const candidateList: CandidateView[] = located?.kind === 'candidates' ? candidateViews(located.candidates, graph) : []
  const retakeHint = located?.kind === 'no_match' ? located.retakeHint : null
  // 마지막 사진이 503이었으면 직접 선택 화면에 안내 한 줄을 보여 준다. 다시 찍거나 확정하면 지워진다
  const manualReason: ManualReason = located?.kind === 'manual' ? located.reason : null
  const manualList: PlaceView[] | null = graph ? manualPlaces(graph) : null

  return {
    lang, changeLang, langPending, menuOpen, setMenuOpen, screen, setScreen, session, sessionInfo, applySession, starting, startSession, routeActive,
    train, dest, here, guide, routing, routeError, arrivedPlace, atTickets, stepIdx, messages, photo,
    graph, ensureGraph, destinationList, candidateList, retakeHint, manualList, manualReason, confirming,
    sendText, sendChip, sendSuggested, pickDestination, startRoute, analyzePhoto, confirmLocation, nextStep, reportLost, reset,
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
