import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Banknote, BookOpen, Camera, Check, ChevronRight, Footprints,
  ImagePlus, List, MessageCircle, Navigation, RefreshCw, Rotate3d, RotateCcw, Route, ScanLine, Star, Ticket, TimerOff, X,
} from 'lucide-react'
import { API_MODE } from './api/mode'
import { render } from './assistant'
import type { Action, Rendered } from './assistant'
import { NODES, POIS, TRAIN_NAME } from './data'
import type { Floor, Lang, NodeId, PhotoScenario, Text } from './data'
import { useRecovery } from './features/recovery/context'
import type { NoticeReason, Recovery, RecoveryAction, RelocateReason, SessionEndCause } from './features/recovery/recovery'
import { UI } from './i18n'
import { totalMeters } from './route'
import { useApp } from './store'
import type { Msg, SessionState } from './store'

// three.js and the panorama viewer are most of the bundle; keep them out of
// the first load and fetch them once a route is on screen.
const loadStreetView = () => import('./streetview')
const StreetView = lazy(() => loadStreetView().then((m) => ({ default: m.StreetView })))

const WALK_M_PER_MIN = 70

function LangToggle({ onDark = false }: { onDark?: boolean }) {
  const { lang, setLang } = useApp()
  return (
    <div className={`lang ${onDark ? 'on-dark' : ''}`} role="group" aria-label="Language">
      {(['en', 'ko'] as Lang[]).map((l) => (
        <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
          {l === 'en' ? 'EN' : '한'}
        </button>
      ))}
    </div>
  )
}

function FloorBadge({ floor }: { floor: Floor }) {
  return <span className="floor">{floor}</span>
}

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
        <p className="demo-note">{UI.demoNote[lang]}</p>
      </div>
    </main>
  )
}

/* ---------- Chat ---------- */

function Sources({ r, lang }: { r: Rendered; lang: Lang }) {
  if (r.status === 'cannot_answer')
    return (
      <p className="tag-unverified">
        <AlertTriangle size={15} /> {UI.unverified[lang]}
      </p>
    )
  if (!r.sources?.length) return null
  return (
    <ul className="sources">
      {r.sources.map((s) => (
        <li key={s.id}>
          <BookOpen size={14} />
          <span>
            {UI.sources[lang]} · {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title[lang]}</a> : s.title[lang]} ·{' '}
            <span className="nowrap">{UI.checked[lang]} {s.verifiedAt}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

const ACTION_ICON: Record<Action, ReactNode> = {
  findMe: <Camera size={19} />,
  startRoute: <Navigation size={19} />,
  retry: <RefreshCw size={18} />,
  pickDest: <List size={18} />,
}
const ACTION_LABEL: Record<Action, Text> = { findMe: UI.findMe, startRoute: UI.startRoute, retry: UI.retry, pickDest: UI.pickDest }

function AssistantMsg({ m, latest }: { m: Msg; latest: boolean }) {
  const app = useApp()
  const { lang } = app
  if (m.pending || !m.reply)
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
  const r = render(m.reply, lang)
  const doAction = (a: Action) => {
    if (a === 'findMe') app.setScreen('locate')
    if (a === 'startRoute' && app.here) app.startRoute(app.here)
    if (a === 'retry') app.retry()
    if (a === 'pickDest') app.setScreen('destinations')
  }
  return (
    <div className={`msg assistant ${r.status === 'error' ? 'is-error' : ''}`}>
      <span className="avatar" aria-hidden />
      <div className="msg-body">
        <p>{r.body}</p>
        {r.list && (
          <ol className="answer-list">
            {r.list.map((li) => (
              <li key={li}>{li}</li>
            ))}
          </ol>
        )}
        {r.tip && (
          <p className="tip">
            <Banknote size={18} /> {r.tip}
          </p>
        )}
        {r.note && <p className="note">{r.note}</p>}
        {r.unverified && (
          <p className="unverified">
            <AlertTriangle size={16} />
            <span>
              <b>{UI.unverified[lang]}</b> · {r.unverified}
            </span>
          </p>
        )}
        <Sources r={r} lang={lang} />
        {latest && r.chips && r.chips.length > 0 && (
          <div className="chips">
            {r.chips.map((c) => (
              <button key={c.intent} className="chip" onClick={() => app.sendChip(c.label, c.intent)}>
                {c.label[lang]}
              </button>
            ))}
          </div>
        )}
        {latest && r.actions && (
          <div className="actions">
            {r.actions.map((a) => (
              <button key={a} className={`btn ${a === 'findMe' || a === 'startRoute' ? 'primary' : a === 'retry' ? 'secondary' : 'ghost'}`} onClick={() => doAction(a)}>
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
  const { lang, messages, dest } = app
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const busy = messages.some((m) => m.pending)
  const navigating = app.routeActive && dest

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
          <Navigation size={16} /> {NODES[dest].name[lang]}
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
            <img src={image} alt="" />
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
              if (f) setImage(URL.createObjectURL(f))
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
          if (f) app.analyzePhoto({ src: URL.createObjectURL(f), scenario: app.uploadScenario })
          e.target.value = ''
        }} />
      </label>
      <p className="label pad">{UI.demoPhotos[lang]}</p>
      <div className="demo-photos">
        {DEMO_PHOTOS.map((p) => (
          <button key={p.id} className="demo-photo" onClick={() => app.analyzePhoto({ src: null, scenario: p.id })}>
            <DemoSign scenario={p.id} />
            <span>{p.label[lang]}</span>
          </button>
        ))}
      </div>
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
  const { lang, candidates } = app
  if (!candidates.length)
    return (
      <main className="screen candidates">
        <TopBar onBack={() => app.setScreen('locate')} />
        <div className="pad">
          <div className="thumb-row">
            <PhotoView />
          </div>
          <h2 className="title">{UI.noMatchTitle[lang]}</h2>
          <p className="muted">{UI.noMatchBody[lang]}</p>
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
          <li key={c.node} className={`cand ${i === 0 ? 'top' : ''}`}>
            <span className="cand-ring" aria-hidden />
            <div className="cand-body">
              <p className="cand-rank">{i === 0 ? UI.bestMatch[lang] : UI.otherMatch[lang]}</p>
              <h3>
                {NODES[c.node].name[lang]} <FloorBadge floor={NODES[c.node].floor} />
              </h3>
              <p className="cand-saw">{UI.saw[lang]}</p>
              <ul>
                {c.evidence.map((e) => (
                  <li key={e.en}>{e[lang]}</li>
                ))}
              </ul>
              <button className={`btn ${i === 0 ? 'primary' : 'secondary'}`} onClick={() => app.confirmLocation(c.node)}>
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

const START_NODES: NodeId[] = ['ktxHall', 'l1gate', 'l4gate', 'concourse', 'expressDesk', 'machines']

export function Manual() {
  const app = useApp()
  const { lang } = app
  return (
    <main className="screen list-screen">
      <TopBar onBack={() => app.setScreen('locate')} title={UI.manualTitle[lang]} />
      <ul className="rows">
        {START_NODES.map((n) => (
          <li key={n}>
            <button className="row" onClick={() => app.confirmLocation(n)}>
              <span className="ring" aria-hidden />
              <span className="row-name">{NODES[n].name[lang]}</span>
              <FloorBadge floor={NODES[n].floor} />
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

export function Destinations() {
  const app = useApp()
  const { lang } = app
  return (
    <main className="screen list-screen">
      <TopBar onBack={() => app.setScreen('chat')} title={UI.destTitle[lang]} />
      <ul className="rows">
        {POIS.map((p) => (
          <li key={p.id}>
            <button className="row" onClick={() => app.pickDestination(p.id)}>
              <span className="ring" aria-hidden />
              <span className="row-name">
                {NODES[p.node].name[lang]}
                <small>
                  {p.category[lang]}
                  {p.train && ` · ${TRAIN_NAME[p.train][lang]}`}
                </small>
              </span>
              <FloorBadge floor={NODES[p.node].floor} />
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}

/* ---------- Route: the signature line ---------- */

const KIND_ICON = { walk: <Footprints size={18} />, escalator_down: <ArrowDown size={18} />, gate: <Ticket size={18} /> }

export function RouteScreen() {
  const app = useApp()
  const { lang, steps, stepIdx, startNode, dest, train } = app
  const stationRefs = useRef<(HTMLSpanElement | null)[]>([])
  const lineRef = useRef<HTMLOListElement>(null)
  const [rail, setRail] = useState({ first: 0, last: 0, here: 0 })
  const [view, setView] = useState<'line' | 'street'>('line')
  const stations: NodeId[] = startNode ? [startNode, ...steps.map((s) => s.edge.to)] : []

  // Track, fill and the "you are here" ring are positioned from the real dot
  // centres, so the ring slides exactly station to station.
  useLayoutEffect(() => {
    const line = lineRef.current
    const dots = stationRefs.current.slice(0, stations.length)
    if (!line || !dots.length || dots.some((d) => !d)) return
    const top = line.getBoundingClientRect().top
    const centre = (d: HTMLSpanElement) => d.getBoundingClientRect().top - top + d.offsetHeight / 2
    setRail({ first: centre(dots[0]!), last: centre(dots[dots.length - 1]!), here: centre(dots[stepIdx]!) })
  }, [stepIdx, steps, lang, stations.length, view])

  useEffect(() => {
    stationRefs.current[stepIdx + 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [stepIdx])

  useEffect(() => {
    void loadStreetView()
  }, [])

  if (!dest || !startNode) return null
  const remaining = steps.slice(stepIdx)
  const meters = totalMeters(remaining)
  const mins = Math.max(1, Math.ceil(meters / WALK_M_PER_MIN))
  const lastLeg = stepIdx >= steps.length - 1

  return (
    <main className={`screen route ${view === 'street' ? 'street-mode' : ''}`}>
      <header className="route-head">
        <div className="route-head-top">
          <button className="icon-btn on-dark" onClick={() => app.setScreen('chat')} aria-label={UI.ask[lang]}>
            <MessageCircle size={22} />
          </button>
          <LangToggle onDark />
        </div>
        <p className="route-to">{UI.to[lang]}</p>
        <h1 className="route-dest">{NODES[dest].name[lang]}</h1>
        <div className="route-meta">
          {train && <span className="train-chip">AREX {TRAIN_NAME[train][lang]}</span>}
          <span className="num">
            {meters} m · {lang === 'en' ? `≈${mins} min walk` : `약 ${mins}분`}
          </span>
        </div>
        <div className="view-toggle" role="tablist">
          {(['line', 'street'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {v === 'line' ? <Route size={16} /> : <Rotate3d size={16} />}
              {v === 'line' ? UI.viewLine[lang] : UI.viewStreet[lang]}
            </button>
          ))}
        </div>
      </header>

      {steps.length === 0 ? (
        <p className="pad muted">{UI.noRoute[lang]}</p>
      ) : view === 'street' ? (
        <div className="sv-wrap">
          <Suspense fallback={<div className="sv" />}>
            <StreetView node={stations[stepIdx]} leg={steps[stepIdx]?.edge} lang={lang} />
          </Suspense>
          {steps[stepIdx] && (
            <div className="sv-step">
              <ol className="sv-progress" aria-label={`${stepIdx + 1} / ${steps.length}`}>
                {steps.map((_, i) => (
                  <li key={i} className={i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''} />
                ))}
              </ol>
              <div className="sv-step-row">
                <span className="leg-icon">{KIND_ICON[steps[stepIdx].edge.kind]}</span>
                <p>
                  {steps[stepIdx].edge.text[lang]}
                  <span className="num leg-m"> {steps[stepIdx].edge.meters} m</span>
                </p>
              </div>
              <p className="sv-next">
                → {NODES[steps[stepIdx].edge.to].name[lang]} <FloorBadge floor={NODES[steps[stepIdx].edge.to].floor} />
              </p>
            </div>
          )}
        </div>
      ) : (
        <ol className="line" ref={lineRef}>
          <span className="line-track" style={{ top: rail.first, height: rail.last - rail.first }} aria-hidden />
          <span className="line-fill" style={{ top: rail.first, height: rail.here - rail.first }} aria-hidden />
          <span className="here" style={{ transform: `translateY(${rail.here}px)` }} aria-hidden />
          {stations.map((n, i) => {
            const state = i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'
            const leg = steps[i]
            const prevFloor = i > 0 ? NODES[stations[i - 1]].floor : null
            return (
              <li key={`${n}-${i}`} className={`station ${state}`}>
                <div className="station-row">
                  <span className="dot" ref={(el) => { stationRefs.current[i] = el }} />
                  <span className="station-name">
                    {NODES[n].name[lang]}
                    {state === 'current' && <em className="now-tag">{UI.now[lang]}</em>}
                  </span>
                  {prevFloor !== NODES[n].floor && <FloorBadge floor={NODES[n].floor} />}
                </div>
                {leg && (
                  <div className={`leg ${state === 'current' ? 'active' : ''}`}>
                    <span className="leg-icon">{KIND_ICON[leg.edge.kind]}</span>
                    <p>
                      {leg.edge.text[lang]}
                      <span className="num leg-m"> {leg.edge.meters} m</span>
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
      </div>
    </main>
  )
}

/* ---------- Arrived ---------- */

export function Arrived() {
  const app = useApp()
  const { lang, here } = app
  const [rating, setRating] = useState(0)
  if (!here) return null
  const atTickets = here === 'expressDesk' || here === 'machines'
  const goChat = (intent: 'buy' | 'platform') => {
    app.setScreen('chat')
    app.sendChip(
      intent === 'buy' ? { en: 'How do I buy a ticket?', ko: '승차권은 어떻게 사요?' } : { en: 'Go to the platform', ko: '승강장으로 가기' },
      intent,
    )
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
        {NODES[here].name[lang]} <FloorBadge floor={NODES[here].floor} />
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
        {UI.demo[lang]}
      </button>
      {app.demoOpen && (
        <div className="sheet-backdrop" onClick={() => app.setDemoOpen(false)}>
          <section className="sheet" role="dialog" aria-label={UI.demoPanel[lang]} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>{UI.demoPanel[lang]}</h2>
              <button className="icon-btn" onClick={() => app.setDemoOpen(false)} aria-label={UI.close[lang]}>
                <X size={22} />
              </button>
            </div>
            <p className="label">
              {UI.sessionState[lang]} · rev {session?.revision ?? '–'} · {API_MODE}
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
            <p className="label">{UI.uploadResult[lang]}</p>
            <div className="seg">
              {DEMO_PHOTOS.map((p) => (
                <button key={p.id} aria-pressed={app.uploadScenario === p.id} onClick={() => app.setUploadScenario(p.id)}>
                  {p.label[lang]}
                </button>
              ))}
            </div>
            <button className="btn secondary block" onClick={app.reset}>
              <RefreshCw size={18} /> {UI.reset[lang]}
            </button>
          </section>
        </div>
      )}
    </>
  )
}
