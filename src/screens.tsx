import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpDown, Banknote, BookOpen, Camera, Check, ChevronRight, Footprints,
  ImagePlus, List, MessageCircle, Navigation, RefreshCw, Rotate3d, RotateCcw, Route, ScanLine, Star, Ticket, TimerOff, X,
} from 'lucide-react'
import { apiMode, demoMode } from './api'
import { render } from './assistant'
import type { Rendered } from './assistant'
import { TRAIN_NAME } from './data'
import type { Lang, PhotoScenario, Text } from './data'
import type { ChatAction, ChatSource, ChatView, ErrorReason } from './features/chat/toViewModel'
import type { PlaceView } from './features/localization/views'
import { remainingDistanceM } from './features/route/toSteps'
import { useRecovery } from './features/recovery/context'
import type { NoticeReason, Recovery, RecoveryAction, RelocateReason, SessionEndCause } from './features/recovery/recovery'
import { UI, modeCopy } from './i18n'
import { useApp } from './store'
import type { Attachment, Msg, SessionState } from './store'

// three.js and the panorama viewer are most of the bundle; keep them out of
// the first load and fetch them once a route is on screen.
const loadStreetView = () => import('./streetview')
const StreetView = lazy(() => loadStreetView().then((m) => ({ default: m.StreetView })))
const loadLiveView = () => import('./liveview')
const LiveView = lazy(() => loadLiveView().then((m) => ({ default: m.LiveView })))

const WALK_M_PER_MIN = 70

// 상단 필·설정 패널·시작 화면 문구는 모드를 따른다. mock은 "Demo", http(실서버 연결)는 "Live"
const MODE = modeCopy(demoMode)

// 세션이 있으면 서버 언어도 바꾼다 (store.changeLang). 바꾸는 중에는 다시 누르지 못하게 잠근다
function LangToggle({ onDark = false }: { onDark?: boolean }) {
  const { lang, changeLang, langPending } = useApp()
  return (
    <div className={`lang ${onDark ? 'on-dark' : ''}`} role="group" aria-label="Language" aria-busy={langPending}>
      {(['en', 'ko'] as Lang[]).map((l) => (
        <button key={l} aria-pressed={lang === l} disabled={langPending} onClick={() => changeLang(l)}>
          {l === 'en' ? 'EN' : '한'}
        </button>
      ))}
    </div>
  )
}

// 서버 floor_id(string)와 데모 Floor를 함께 받는다
function FloorBadge({ floor }: { floor: string }) {
  return <span className="floor">{floor}</span>
}

// 장소 이름. 그래프에 없는 노드는 이름을 지어내지 않고 node id를 그대로 보여 준다
const placeName = (place: PlaceView, lang: Lang) => place.name?.[lang] ?? place.nodeId

function TopBar({ title, onBack, right }: { title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
      ) : (
        <span className="brand">
          <LineMark /> Hangil
        </span>
      )}
      {title && <h1 className="topbar-title">{title}</h1>}
      <div className="topbar-right">{right ?? <LangToggle />}</div>
    </header>
  )
}

// The brand mark is the route itself: a short line between two stations.
function LineMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 35 22" aria-hidden>
      <rect x="6" y="9" width="23" height="4" rx="2" fill="var(--line)" />
      <circle cx="7" cy="11" r="5.5" fill="#fff" stroke="var(--line)" strokeWidth="3" />
      <circle cx="28" cy="11" r="5.5" fill="var(--ink)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="28" cy="11" r="2.2" fill="#fff" />
    </svg>
  )
}

/* ---------- Welcome ---------- */

export function Welcome() {
  const { lang, setLang, starting, startSession } = useApp()
  return (
    <main className="screen welcome">
      <div className="welcome-line" aria-hidden>
        <span className="wl-bar" />
        {['B1', 'B2', 'B3'].map((f, i) => (
          <span key={f} className={`wl-stop ${i === 2 ? 'end' : ''}`} style={{ left: `${16 + i * 34}%` }}>
            <i />
            <b>{f}</b>
          </span>
        ))}
      </div>
      <div className="welcome-body">
        <h1 className="wordmark" aria-label="한길 Hangil">
          <span aria-hidden>
            한<span className="wm-dot">·</span>길
          </span>
          <span className="wm-latin" aria-hidden>
            Hangil
          </span>
        </h1>
        <p className="welcome-tag">{UI.tagline[lang]}</p>
        <p className="welcome-station">{UI.station[lang]}</p>
      </div>
      <div className="welcome-foot">
        <p className="label">{UI.chooseLang[lang]}</p>
        <div className="lang-choice">
          {(['en', 'ko'] as Lang[]).map((l) => (
            <button key={l} className={lang === l ? 'selected' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {lang === l && <Check size={18} />}
              {l === 'en' ? 'English' : '한국어'}
            </button>
          ))}
        </div>
        {starting.error && (
          <p className="start-error" role="alert">
            <AlertTriangle size={16} /> {UI.startFailed[lang]}
          </p>
        )}
        <button className="btn primary block" onClick={startSession} disabled={starting.pending} aria-busy={starting.pending}>
          {starting.pending ? (
            UI.connecting[lang]
          ) : starting.error ? (
            <>
              <RefreshCw size={18} /> {UI.retry[lang]}
            </>
          ) : (
            <>
              {UI.start[lang]} <ArrowRight size={20} />
            </>
          )}
        </button>
        <p className="demo-note">{MODE.note[lang]}</p>
      </div>
    </main>
  )
}

/* ---------- Chat ---------- */

// 말풍선 하나를 그리는 공통 모양. mock 응답(Rendered)과 서버 응답·오류(ChatView)를 여기로 맞춘다
interface Bubble {
  error: boolean
  body: string
  items: string[]
  tip: string | null
  note: string | null
  // 서버의 unverified_notes. 문장을 고치지 않고 "Not verified"로 구분해 보여 준다
  unverified: string[]
  // cannot_answer: 확인된 답이 없어 추측하지 않았다는 표시
  refused: boolean
  sources: ChatSource[]
  chips: { key: string; label: string; send: () => void }[]
  actions: ChatAction[]
}

// 오류 말풍선 문구. 오류 알림 시트와 같은 문구를 쓴다
const ERROR_TEXT: Record<ErrorReason, Text> = {
  timeout: UI.errTimeout,
  network: UI.errNetwork,
  conflict: UI.errConflict,
  ai_unavailable: UI.errAiUnavailable,
  failed: UI.errFailed,
  location_not_confirmed: UI.errNeedLocation,
  localization_expired: UI.errPhotoExpired,
  session: UI.endedForbidden,
  resync: UI.errResync,
}

function fromRendered(r: Rendered, lang: Lang, app: ReturnType<typeof useApp>): Bubble {
  return {
    error: r.status === 'error',
    body: r.body,
    items: r.list ?? [],
    tip: r.tip ?? null,
    note: r.note ?? null,
    unverified: r.unverified ? [r.unverified] : [],
    refused: r.status === 'cannot_answer',
    sources: (r.sources ?? []).map((s) => ({ id: s.id, title: s.title[lang], url: s.url ?? null, verifiedAt: s.verifiedAt })),
    chips: (r.chips ?? []).map((c) => ({ key: c.intent, label: c.label[lang], send: () => app.sendChip(c.label) })),
    actions: r.actions ?? [],
  }
}

function fromView(v: ChatView, lang: Lang, app: ReturnType<typeof useApp>): Bubble {
  if (v.kind === 'error')
    return { error: true, body: ERROR_TEXT[v.reason][lang], items: [], tip: null, note: null, unverified: [], refused: false, sources: [], chips: [], actions: v.actions }
  return {
    error: false,
    body: v.body,
    items: v.items,
    tip: v.tip,
    note: null,
    unverified: v.unverified,
    refused: v.refused,
    sources: v.sources,
    chips: v.chips.map((c, i) => ({ key: `${i}-${c.label}`, label: c.label, send: () => app.sendSuggested(c) })),
    actions: v.actions,
  }
}

function Sources({ b, lang }: { b: Bubble; lang: Lang }) {
  return (
    <>
      {b.refused && (
        <p className="tag-unverified">
          <AlertTriangle size={15} /> {UI.unverified[lang]}
        </p>
      )}
      {b.sources.length > 0 && (
        <ul className="sources">
          {b.sources.map((s) => (
            <li key={s.id}>
              <BookOpen size={14} />
              <span>
                {UI.sources[lang]} · {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title} ·{' '}
                <span className="nowrap">{UI.checked[lang]} {s.verifiedAt}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const ACTION_ICON: Record<ChatAction, ReactNode> = {
  findMe: <Camera size={19} />,
  retake: <Camera size={19} />,
  pickLocation: <List size={18} />,
  startRoute: <Navigation size={19} />,
  retry: <RefreshCw size={18} />,
  pickDest: <List size={18} />,
  restart: <RotateCcw size={18} />,
}
const ACTION_LABEL: Record<ChatAction, Text> = {
  findMe: UI.findMe,
  retake: UI.retake,
  pickLocation: UI.pickOnList,
  startRoute: UI.startRoute,
  retry: UI.retry,
  pickDest: UI.pickDest,
  restart: UI.newTrip,
}
const PRIMARY_ACTIONS = new Set<ChatAction>(['findMe', 'retake', 'startRoute'])

function AssistantMsg({ m, latest }: { m: Msg; latest: boolean }) {
  const app = useApp()
  const { lang } = app
  if (m.pending || (!m.reply && !m.view))
    return (
      <div className="msg assistant">
        <span className="avatar" aria-hidden />
        <p className="thinking">
          {UI.thinking[lang]}
          <span className="dots">
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    )
  const b = m.view ? fromView(m.view, lang, app) : fromRendered(render(m.reply!, lang), lang, app)
  const doAction = (a: ChatAction) => {
    if (a === 'findMe' || a === 'retake') app.setScreen('locate')
    if (a === 'pickLocation') app.setScreen('manual')
    if (a === 'startRoute') app.startRoute()
    if (a === 'pickDest') app.setScreen('destinations')
    if (a === 'restart') app.reset()
  }
  return (
    <div className={`msg assistant ${b.error ? 'is-error' : ''}`}>
      <span className="avatar" aria-hidden />
      <div className="msg-body">
        <p>{b.body}</p>
        {b.items.length > 0 && (
          <ol className="answer-list">
            {b.items.map((li, i) => (
              <li key={i}>{li}</li>
            ))}
          </ol>
        )}
        {b.tip && (
          <p className="tip">
            <Banknote size={18} /> {b.tip}
          </p>
        )}
        {b.note && <p className="note">{b.note}</p>}
        {b.unverified.map((note, i) => (
          <p key={i} className="unverified">
            <AlertTriangle size={16} />
            <span>
              <b>{UI.unverified[lang]}</b> · {note}
            </span>
          </p>
        ))}
        <Sources b={b} lang={lang} />
        {latest && b.chips.length > 0 && (
          <div className="chips">
            {b.chips.map((c) => (
              <button key={c.key} className="chip" onClick={c.send}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        {latest && b.actions.length > 0 && (
          <div className="actions">
            {b.actions.map((a) => (
              <button key={a} className={`btn ${PRIMARY_ACTIONS.has(a) ? 'primary' : a === 'retry' ? 'secondary' : 'ghost'}`} onClick={() => doAction(a)}>
                {ACTION_ICON[a]} {ACTION_LABEL[a][lang]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Chat() {
  const app = useApp()
  const { lang, messages, guide } = app
  const [text, setText] = useState('')
  const [image, setImage] = useState<Attachment | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const busy = messages.some((m) => m.pending)
  const navigating = app.routeActive && guide

  const submit = () => {
    if (busy || (!text.trim() && !image)) return
    app.sendText(text.trim(), image ?? undefined)
    setText('')
    setImage(null)
  }

  return (
    <main className="screen chat">
      <TopBar />
      {navigating && (
        <button className="resume" onClick={() => app.setScreen('route')}>
          <Navigation size={16} /> {placeName(guide.destination, lang)}
          <ChevronRight size={18} />
        </button>
      )}
      <div className="thread" aria-live="polite">
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.image && <img src={m.image} alt="" className="msg-img" />}
              {m.text && <p>{typeof m.text === 'string' ? m.text : m.text[lang]}</p>}
            </div>
          ) : (
            <AssistantMsg key={m.id} m={m} latest={m === lastAssistant} />
          ),
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {image && (
          <div className="attached">
            <img src={image.url} alt="" />
            <button type="button" className="icon-btn small" aria-label="Remove photo" onClick={() => setImage(null)}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="composer-row">
          <label className="icon-btn" aria-label={UI.attach[lang]}>
            <ImagePlus size={22} />
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setImage({ url: URL.createObjectURL(f), file: f })
              e.target.value = ''
            }} />
          </label>
          <input className="composer-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={UI.askPlaceholder[lang]} enterKeyHint="send" />
          <button className="send" type="submit" aria-label={UI.send[lang]} disabled={busy || (!text.trim() && !image)}>
            <ArrowUp size={20} />
          </button>
        </div>
      </form>
    </main>
  )
}

/* ---------- Locate ---------- */

function DemoSign({ scenario, large = false }: { scenario: PhotoScenario; large?: boolean }) {
  return (
    <div className={`sign sign-${scenario} ${large ? 'large' : ''}`} aria-hidden>
      {scenario === 'arexSign' && (
        <>
          <span className="sign-badge arex">A</span>
          <span className="sign-text">
            공항철도 →
            <small>Airport Railroad</small>
          </span>
          <span className="sign-corner l4">4</span>
        </>
      )}
      {scenario === 'ktxSign' && (
        <>
          <span className="sign-badge ktx">KTX</span>
          <span className="sign-text">
            맞이방
            <small>Departure Hall</small>
          </span>
        </>
      )}
      {scenario === 'blurry' && <span className="sign-blur" />}
    </div>
  )
}

const DEMO_PHOTOS: { id: PhotoScenario; label: Text }[] = [
  { id: 'arexSign', label: { en: 'Transfer sign', ko: '환승 안내판' } },
  { id: 'ktxSign', label: { en: 'KTX hall sign', ko: 'KTX 맞이방' } },
  { id: 'blurry', label: { en: 'Blurry photo', ko: '흐린 사진' } },
]

export function Locate() {
  const app = useApp()
  const { lang } = app
  return (
    <main className="screen locate">
      <TopBar onBack={() => app.setScreen(app.routeActive ? 'route' : 'chat')} title={UI.locateTitle[lang]} />
      <div className="viewfinder">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <ScanLine size={40} strokeWidth={1.5} />
        <p>{UI.locateHint[lang]}</p>
      </div>
      <label className="btn primary capture">
        <Camera size={20} /> {UI.takePhoto[lang]}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) app.analyzePhoto({ src: URL.createObjectURL(f), scenario: app.uploadScenario, file: f })
          e.target.value = ''
        }} />
      </label>
      {app.demoPhotos && (
        <>
          <p className="label pad">{UI.demoPhotos[lang]}</p>
          <div className="demo-photos">
            {DEMO_PHOTOS.map((p) => (
              <button key={p.id} className="demo-photo" onClick={() => app.analyzeDemoPhoto(p.id)}>
                <DemoSign scenario={p.id} />
                <span>{p.label[lang]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <button className="btn ghost block" onClick={() => app.setScreen('manual')}>
        <List size={18} /> {UI.pickOnList[lang]}
      </button>
    </main>
  )
}

function PhotoView({ large = false }: { large?: boolean }) {
  const { photo } = useApp()
  if (!photo) return null
  return photo.src ? <img className={`photo ${large ? 'large' : ''}`} src={photo.src} alt="" /> : <DemoSign scenario={photo.scenario} large={large} />
}

export function Analyzing() {
  const { lang } = useApp()
  return (
    <main className="screen analyzing">
      <div className="scan">
        <PhotoView large />
        <span className="scan-bar" aria-hidden />
      </div>
      <p className="scan-label" role="status">
        {UI.reading[lang]}
      </p>
      <p className="muted center">{UI.photoDiscarded[lang]}</p>
    </main>
  )
}

/* ---------- Candidates ---------- */

export function Candidates() {
  const app = useApp()
  const { lang, candidateList: candidates } = app
  if (!candidates.length)
    return (
      <main className="screen candidates">
        <TopBar onBack={() => app.setScreen('locate')} />
        <div className="pad">
          <div className="thumb-row">
            <PhotoView />
          </div>
          <h2 className="title">{UI.noMatchTitle[lang]}</h2>
          {/* 서버의 재촬영 안내(retake_hint)를 그대로 쓴다. mock 모드는 기본 문구 */}
          <p className="muted">{app.retakeHint ?? UI.noMatchBody[lang]}</p>
        </div>
        <div className="stack pad">
          <button className="btn primary block" onClick={() => app.setScreen('locate')}>
            <Camera size={19} /> {UI.retake[lang]}
          </button>
          <button className="btn secondary block" onClick={() => app.setScreen('manual')}>
            <List size={18} /> {UI.pickOnList[lang]}
          </button>
        </div>
      </main>
    )
  return (
    <main className="screen candidates">
      <TopBar onBack={() => app.setScreen('locate')} />
      <div className="pad">
        <div className="thumb-row">
          <PhotoView />
          <p className="muted small">{UI.photoDiscarded[lang]}</p>
        </div>
        <h2 className="title">{UI.candTitle[lang]}</h2>
        <p className="muted">{UI.candSub[lang]}</p>
      </div>
      <ol className="cand-list">
        {candidates.map((c, i) => (
          <li key={c.nodeId} className={`cand ${i === 0 ? 'top' : ''}`}>
            <span className="cand-ring" aria-hidden />
            <div className="cand-body">
              <p className="cand-rank">{i === 0 ? UI.bestMatch[lang] : UI.otherMatch[lang]}</p>
              <h3>
                {placeName(c, lang)} <FloorBadge floor={c.floor} />
              </h3>
              <p className="cand-saw">{UI.saw[lang]}</p>
              <ul>
                {/* 서버 근거는 세션 언어 문자열, 데모 근거는 두 언어 Text */}
                {c.evidence.map((e, j) => (
                  <li key={j}>{typeof e === 'string' ? e : e[lang]}</li>
                ))}
              </ul>
              {/* 상위 후보도 저절로 확정하지 않는다. 사용자가 누른 후보만 확정한다 */}
              <button
                className={`btn ${i === 0 ? 'primary' : 'secondary'}`}
                disabled={app.confirming}
                onClick={() => app.confirmLocation(c.nodeId, 'photo')}
              >
                <Check size={18} /> {UI.imHere[lang]}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="pad none-match">
        <p className="label">{UI.noneMatch[lang]}</p>
        <div className="two-up">
          <button className="btn secondary" onClick={() => app.setScreen('locate')}>
            <Camera size={18} /> {UI.retake[lang]}
          </button>
          <button className="btn secondary" onClick={() => app.setScreen('manual')}>
            <List size={18} /> {UI.pickShort[lang]}
          </button>
        </div>
      </div>
    </main>
  )
}

/* ---------- Lists ---------- */

// http 모드는 지도 그래프의 노드 전체, mock 모드는 데모 출발지 목록이다 (store.manualList)
export function Manual() {
  const app = useApp()
  const { lang, manualList } = app
  return (
    <main className="screen list-screen">
      <TopBar onBack={() => app.setScreen('locate')} title={UI.manualTitle[lang]} />
      {app.manualReason === 'ai_unavailable' && <p className="muted pad">{UI.manualAiUnavailable[lang]}</p>}
      {manualList ? (
        <ul className="rows">
          {manualList.map((p) => (
            <li key={p.nodeId}>
              <button className="row" disabled={app.confirming} onClick={() => app.confirmLocation(p.nodeId)}>
                <span className="ring" aria-hidden />
                <span className="row-name">{placeName(p, lang)}</span>
                <FloorBadge floor={p.floor} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted center" role="status">
          {UI.loadingPlaces[lang]}
        </p>
      )}
    </main>
  )
}

// 목적지 목록. http 모드는 GET /maps/{id}/pois, mock 모드는 data.ts (store.destinationList)
export function Destinations() {
  const app = useApp()
  const { lang, destinationList } = app
  return (
    <main className="screen list-screen">
      <TopBar onBack={() => app.setScreen('chat')} title={UI.destTitle[lang]} />
      {destinationList ? (
        <ul className="rows">
          {destinationList.map((d) => (
            <li key={d.poiId}>
              <button className="row" onClick={() => app.pickDestination(d.poiId)}>
                <span className="ring" aria-hidden />
                <span className="row-name">
                  {d.name[lang]}
                  <small>
                    {d.category[lang]}
                    {d.train && ` · ${TRAIN_NAME[d.train][lang]}`}
                    {!d.verified && <span className="row-unverified"> · {UI.unverified[lang]}</span>}
                  </small>
                </span>
                <FloorBadge floor={d.floor} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted center" role="status">
          {UI.loadingPlaces[lang]}
        </p>
      )}
    </main>
  )
}

/* ---------- Route: the signature line ---------- */

// 서버 step.kind (backend/app/domain/routing.py _step_kind). 모르는 종류는 걷기 아이콘으로 그린다
const KIND_ICON: Record<string, ReactNode> = {
  walk: <Footprints size={18} />,
  gate: <Ticket size={18} />,
  escalator_down: <ArrowDown size={18} />,
  escalator_up: <ArrowUp size={18} />,
  stairs_down: <ArrowDown size={18} />,
  stairs_up: <ArrowUp size={18} />,
  elevator: <ArrowUpDown size={18} />,
}
const kindIcon = (kind: string) => KIND_ICON[kind] ?? <Footprints size={18} />

// 서버 경로를 받는 중이거나 받지 못했을 때. 경로를 지어내지 않고 안내 한 줄과 '길을 잃었어요'만 둔다
function RouteWaiting() {
  const app = useApp()
  const { lang, routing, routeError } = app
  const noRoute = !routing && routeError === 'not_found'
  return (
    <main className="screen route">
      <header className="route-head">
        <div className="route-head-top">
          <button className="icon-btn on-dark" onClick={() => app.setScreen('chat')} aria-label={UI.ask[lang]}>
            <MessageCircle size={22} />
          </button>
          <LangToggle onDark />
        </div>
        <p className="route-to">{UI.to[lang]}</p>
      </header>
      <p className="pad muted" role="status">
        {routing ? UI.routeLoading[lang] : noRoute ? UI.noRoute[lang] : null}
      </p>
      {noRoute && (
        <div className="bottom-bar">
          <button className="btn secondary grow" onClick={app.reportLost}>
            {UI.lost[lang]}
          </button>
        </div>
      )}
    </main>
  )
}

export function RouteScreen() {
  const app = useApp()
  const { lang, guide, stepIdx, train, routing, routeError } = app
  const stationRefs = useRef<(HTMLSpanElement | null)[]>([])
  const lineRef = useRef<HTMLOListElement>(null)
  const [rail, setRail] = useState({ first: 0, last: 0, here: 0 })
  const [view, setView] = useState<'line' | 'street' | 'live'>('line')
  const stops = guide?.stops ?? []
  const legs = guide?.legs ?? []

  // Track, fill and the "you are here" ring are positioned from the real dot
  // centres, so the ring slides exactly station to station.
  useLayoutEffect(() => {
    const line = lineRef.current
    const dots = stationRefs.current.slice(0, stops.length)
    if (!line || !dots.length || dots.some((d) => !d)) return
    const top = line.getBoundingClientRect().top
    const centre = (d: HTMLSpanElement) => d.getBoundingClientRect().top - top + d.offsetHeight / 2
    setRail({ first: centre(dots[0]!), last: centre(dots[dots.length - 1]!), here: centre(dots[stepIdx]!) })
  }, [stepIdx, guide, lang, stops.length, view])

  useEffect(() => {
    stationRefs.current[stepIdx + 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [stepIdx])

  useEffect(() => {
    void loadStreetView()
    void loadLiveView()
  }, [])

  if (routing || routeError || !guide) return <RouteWaiting />
  const meters = remainingDistanceM(legs, stepIdx)
  const mins = Math.max(1, Math.ceil(meters / WALK_M_PER_MIN))
  const lastLeg = stepIdx >= legs.length - 1
  const leg = legs[stepIdx]

  return (
    <main className={`screen route ${view !== 'line' ? 'street-mode' : ''}`}>
      <header className="route-head">
        <div className="route-head-top">
          <button className="icon-btn on-dark" onClick={() => app.setScreen('chat')} aria-label={UI.ask[lang]}>
            <MessageCircle size={22} />
          </button>
          <LangToggle onDark />
        </div>
        <p className="route-to">{UI.to[lang]}</p>
        <h1 className="route-dest">{placeName(guide.destination, lang)}</h1>
        <div className="route-meta">
          {train && <span className="train-chip">AREX {TRAIN_NAME[train][lang]}</span>}
          <span className="num">
            {meters} m · {lang === 'en' ? `≈${mins} min walk` : `약 ${mins}분`}
          </span>
        </div>
        <div className="view-toggle" role="tablist">
          {(['line', 'street', 'live'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === 'line' ? <Route size={16} /> : v === 'street' ? <Rotate3d size={16} /> : <Camera size={16} />}
              {v === 'line' ? UI.viewLine[lang] : v === 'street' ? UI.viewStreet[lang] : UI.viewLive[lang]}
            </button>
          ))}
        </div>
      </header>

      {legs.length === 0 ? (
        <p className="pad muted">{UI.noRoute[lang]}</p>
      ) : view !== 'line' ? (
        <div className="sv-wrap">
          {leg && view === 'street' && (
            <Suspense fallback={<div className="sv" />}>
              <StreetView leg={leg} lang={lang} />
            </Suspense>
          )}
          {leg && view === 'live' && (
            <Suspense fallback={<div className="sv" />}>
              <LiveView
                leg={leg}
                lang={lang}
                showDebug={demoMode}
                onLeave={() => setView('line')}
                chip={
                  <>
                    <span className="live-chip-name">{placeName(leg.from, lang)}</span>
                    {leg.from.floor && <FloorBadge floor={leg.from.floor} />}
                    <em>{stepIdx === 0 ? UI.liveConfirmed[lang] : UI.liveStepped[lang]}</em>
                  </>
                }
              />
            </Suspense>
          )}
          {leg && (
            <div className="sv-step">
              <ol className="sv-progress" aria-label={`${stepIdx + 1} / ${legs.length}`}>
                {legs.map((l, i) => (
                  <li key={l.stepId} className={i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''} />
                ))}
              </ol>
              <div className="sv-step-row">
                <span className="leg-icon">{kindIcon(leg.kind)}</span>
                <p>
                  {leg.instruction[lang]}
                  <span className="num leg-m"> {leg.distanceM} m</span>
                </p>
              </div>
              <p className="sv-next">
                → {placeName(leg.to, lang)} {leg.to.floor && <FloorBadge floor={leg.to.floor} />}
              </p>
            </div>
          )}
        </div>
      ) : (
        <ol className="line" ref={lineRef}>
          <span className="line-track" style={{ top: rail.first, height: rail.last - rail.first }} aria-hidden />
          <span className="line-fill" style={{ top: rail.first, height: rail.here - rail.first }} aria-hidden />
          <span className="here" style={{ transform: `translateY(${rail.here}px)` }} aria-hidden />
          {stops.map((stop, i) => {
            const state = i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'
            const out = legs[i]
            const prevFloor = i > 0 ? stops[i - 1].floor : null
            return (
              <li key={`${stop.nodeId}-${i}`} className={`station ${state}`}>
                <div className="station-row">
                  <span className="dot" ref={(el) => { stationRefs.current[i] = el }} />
                  <span className="station-name">
                    {placeName(stop, lang)}
                    {state === 'current' && <em className="now-tag">{UI.now[lang]}</em>}
                  </span>
                  {stop.floor && prevFloor !== stop.floor && <FloorBadge floor={stop.floor} />}
                </div>
                {out && (
                  <div className={`leg ${state === 'current' ? 'active' : ''}`}>
                    <span className="leg-icon">{kindIcon(out.kind)}</span>
                    <p>
                      {out.instruction[lang]}
                      <span className="num leg-m"> {out.distanceM} m</span>
                    </p>
                  </div>
                )}
              </li>
            )
          })}
          <li className="line-foot muted small">{UI.routeOnly[lang]}</li>
        </ol>
      )}

      <div className="bottom-bar">
        <button className="btn secondary" onClick={app.reportLost}>
          {UI.lost[lang]}
        </button>
        {legs.length > 0 && (
          <button className="btn primary grow" onClick={app.nextStep}>
            {lastLeg ? (
              <>
                <Check size={20} /> {UI.arrivedBtn[lang]}
              </>
            ) : (
              <>
                {UI.next[lang]} <ArrowRight size={20} />
              </>
            )}
          </button>
        )}
      </div>
    </main>
  )
}

/* ---------- Arrived ---------- */

export function Arrived() {
  const app = useApp()
  // 도착한 장소. http 모드는 서버 node_id와 지도 그래프 이름, mock 모드는 data.ts 노드
  const { lang, arrivedPlace: place, atTickets } = app
  const [rating, setRating] = useState(0)
  if (!place) return null
  const goChat = (intent: 'buy' | 'platform') => {
    app.setScreen('chat')
    app.sendChip(intent === 'buy' ? { en: 'How do I buy a ticket?', ko: '승차권은 어떻게 사요?' } : { en: 'Go to the platform', ko: '승강장으로 가기' })
  }
  return (
    <main className="screen arrived">
      <div className="arrived-mark" aria-hidden>
        <span className="arrived-bar" />
        <span className="arrived-ring">
          <Check size={34} strokeWidth={3} />
        </span>
      </div>
      <h1 className="title center">{UI.arrivedTitle[lang]}</h1>
      <p className="arrived-place">
        {placeName(place, lang)} {place.floor && <FloorBadge floor={place.floor} />}
      </p>
      {atTickets ? (
        <div className="stack pad">
          <button className="btn primary block" onClick={() => goChat('buy')}>
            <Ticket size={19} /> {lang === 'en' ? 'How do I buy a ticket?' : '승차권은 어떻게 사요?'}
          </button>
          <button className="btn secondary block" onClick={() => goChat('platform')}>
            <Navigation size={18} /> {lang === 'en' ? 'Go to the platform' : '승강장으로 가기'}
          </button>
        </div>
      ) : (
        <div className="stack pad">
          <p className="label center">{UI.rate[lang]}</p>
          <div className="stars" role="radiogroup" aria-label={UI.rate[lang]}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n}`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>
                <Star size={30} />
              </button>
            ))}
          </div>
          {rating > 0 && <p className="muted center">{UI.thanks[lang]}</p>}
          <button className="btn secondary block" onClick={app.reset}>
            {UI.newTrip[lang]}
          </button>
        </div>
      )}
    </main>
  )
}

/* ---------- Session ended ---------- */

const ENDED_TITLE: Record<SessionEndCause, Text> = {
  expired: UI.endedExpired,
  unauthorized: UI.endedUnauthorized,
  forbidden: UI.endedForbidden,
  map_changed: UI.endedMapChanged,
}

// 세션을 더 이어 쓸 수 없을 때 보여 준다. 버튼은 '다시 시작' 하나이고, 새 세션은 시작 화면에서 사용자가 시작할 때 만든다.
export function SessionEndedView({ cause, lang, onRestart }: { cause: SessionEndCause; lang: Lang; onRestart: () => void }) {
  return (
    <main className="screen session-ended">
      <span className="ended-mark" aria-hidden>
        {cause === 'expired' ? <TimerOff size={30} /> : <AlertTriangle size={30} />}
      </span>
      <div className="pad">
        <h1 className="title center" role="alert">
          {ENDED_TITLE[cause][lang]}
        </h1>
        <p className="muted center">{UI.endedLoss[lang]}</p>
      </div>
      <div className="stack pad">
        <button className="btn primary block" onClick={onRestart}>
          <RotateCcw size={19} /> {UI.restart[lang]}
        </button>
      </div>
    </main>
  )
}

export function SessionEnded() {
  const { lang, reset } = useApp()
  const { ended } = useRecovery()
  if (!ended) return null
  return <SessionEndedView cause={ended.cause} lang={lang} onRestart={reset} />
}

/* ---------- Error notice ---------- */

// relocate는 위치 확인 화면으로 가는 버튼('locate') 하나를 준다. 그 화면에 다시 찍기와 목록에서 고르기가 있다
type NoticeButton = RecoveryAction | 'locate'
type NoticeRecovery = Exclude<Recovery, { type: 'sessionEnded' }>

const NOTICE_TEXT: Record<NoticeReason, Text> = {
  timeout: UI.errTimeout,
  network: UI.errNetwork,
  conflict: UI.errConflict,
  ai_unavailable: UI.errAiUnavailable,
  failed: UI.errFailed,
}
const RELOCATE_TEXT: Record<RelocateReason, { text: Text; button: Text }> = {
  location_not_confirmed: { text: UI.errNeedLocation, button: UI.findMe },
  localization_expired: { text: UI.errPhotoExpired, button: UI.retake },
}
const RECOVERY_LABEL: Record<RecoveryAction, Text> = { retry: UI.retry, manual: UI.pickShort, home: UI.newTrip }
const RECOVERY_ICON: Record<NoticeButton, ReactNode> = {
  retry: <RefreshCw size={18} />,
  manual: <List size={18} />,
  home: <RotateCcw size={18} />,
  locate: <Camera size={18} />,
}

function noticeContent(notice: NoticeRecovery): { text: Text; buttons: { id: NoticeButton; label: Text }[] } {
  if (notice.type === 'relocate') {
    const { text, button } = RELOCATE_TEXT[notice.reason]
    return { text, buttons: [{ id: 'locate', label: button }] }
  }
  const text = notice.type === 'resync' ? UI.errResync : NOTICE_TEXT[notice.reason]
  return { text, buttons: notice.actions.map((a) => ({ id: a, label: RECOVERY_LABEL[a] })) }
}

// 채팅 오류 말풍선과 같은 모양으로 아래에서 올라온다. 닫기 대신 탈출구 버튼 중 하나를 고르게 한다 (제품 원칙 4)
export function ErrorNoticeView({ notice, lang, onAction }: { notice: NoticeRecovery; lang: Lang; onAction: (action: NoticeButton) => void }) {
  const { text, buttons } = noticeContent(notice)
  return (
    <div className="sheet-backdrop">
      <section className="sheet recovery-sheet" role="alertdialog" aria-modal="true" aria-labelledby="recovery-text">
        <div className="msg assistant is-error">
          <span className="avatar" aria-hidden />
          <div className="msg-body">
            <p id="recovery-text">{text[lang]}</p>
            <div className="actions">
              {buttons.map((b, i) => (
                <button key={b.id} className={`btn ${i === 0 ? 'primary' : 'secondary'}`} onClick={() => onAction(b.id)}>
                  {RECOVERY_ICON[b.id]} {b.label[lang]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export function ErrorNotice() {
  const app = useApp()
  const recovery = useRecovery()
  const { notice } = recovery
  if (!notice) return null
  const onAction = (action: NoticeButton) => {
    recovery.clear()
    if (action === 'retry') notice.retry?.()
    else if (action === 'manual') notice.manual?.()
    else if (action === 'locate') app.setScreen('locate')
    else app.reset()
  }
  return <ErrorNoticeView notice={notice} lang={app.lang} onAction={onAction} />
}

/* ---------- Demo panel ---------- */

const STATES: SessionState[] = ['idle', 'needs_clarification', 'needs_location', 'needs_confirmation', 'ready_to_navigate', 'navigating', 'arrived']

export function DemoPanel() {
  const app = useApp()
  const { lang, session } = app
  return (
    <>
      <button className={`demo-pill ${new URLSearchParams(location.search).has('demo') ? '' : 'opt-in'}`} onClick={() => app.setDemoOpen(true)}>
        {MODE.pill[lang]}
      </button>
      {app.demoOpen && (
        <div className="sheet-backdrop" onClick={() => app.setDemoOpen(false)}>
          <section className="sheet" role="dialog" aria-label={MODE.panel[lang]} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>{MODE.panel[lang]}</h2>
              <button className="icon-btn" onClick={() => app.setDemoOpen(false)} aria-label={UI.close[lang]}>
                <X size={22} />
              </button>
            </div>
            <p className="label">
              {UI.sessionState[lang]} · rev {session?.revision ?? '–'} · {apiMode}
              {app.sessionInfo && ` · ${app.sessionInfo.id}`}
            </p>
            <ol className="state-line">
              {STATES.map((s) => (
                <li key={s} className={s === session?.state ? 'on' : ''}>
                  <span />
                  <code>{s}</code>
                </li>
              ))}
            </ol>
            <label className="switch">
              <input type="checkbox" checked={app.failNext} onChange={(e) => app.setFailNext(e.target.checked)} />
              <span>{UI.failNext[lang]}</span>
            </label>
            {/* 올린 사진의 결과를 고르는 스위치는 mock 모드에서만 의미가 있다. http 모드는 서버가 정한다 */}
            {app.demoPhotos && (
              <>
                <p className="label">{UI.uploadResult[lang]}</p>
                <div className="seg">
                  {DEMO_PHOTOS.map((p) => (
                    <button key={p.id} aria-pressed={app.uploadScenario === p.id} onClick={() => app.setUploadScenario(p.id)}>
                      {p.label[lang]}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="btn secondary block" onClick={app.reset}>
              <RefreshCw size={18} /> {MODE.reset[lang]}
            </button>
          </section>
        </div>
      )}
    </>
  )
}
