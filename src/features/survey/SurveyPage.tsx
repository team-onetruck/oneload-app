/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 답사 전용 화면에서 지점·기기·자세·회차를 입력하고 센서 기록을 복구·다운로드한다
 */
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { assertManifest, createManifest, downloadName, parseSurvey, prepareTrial, putTrial, serializeSurvey } from './model'
import type { CompassTrial, SurveyForm, SurveyManifest } from './model'
import { browserPlatform, SensorRecorder } from './recorder'
import type { RecorderPhase } from './recorder'
import './survey.css'

const STORAGE_KEY = 'hangil.sensor-survey.v1'
const initialForm = (): SurveyForm => ({
  surveyId: `SS-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })}`,
  collector: '', deviceId: '', model: '', osVersion: '', browser: '', browserVersion: '',
  nodeId: '', nodeName: '', floorId: '', standing: '', posture: 'rear_camera_forward_portrait',
  repeat: '1', duration: '10', target: '', referenceDeg: '', referenceNorth: 'unknown', referenceSource: '', notes: '',
})

function loadDraft() {
  const form = initialForm()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { form, manifest: createManifest(form.surveyId), notice: '' }
    const parsed = JSON.parse(raw) as { manifest: unknown; form: Partial<SurveyForm> }
    assertManifest(parsed.manifest)
    for (const key of Object.keys(form) as (keyof SurveyForm)[]) {
      const value = parsed.form?.[key]
      if (typeof value === 'string' && key !== 'posture' && key !== 'referenceNorth') form[key] = value
    }
    if (parsed.form?.posture === 'flat_screen_up') form.posture = 'flat_screen_up'
    if (['unknown', 'true_north', 'magnetic_north', 'map_axis'].includes(parsed.form?.referenceNorth ?? '')) form.referenceNorth = parsed.form.referenceNorth!
    form.surveyId = parsed.manifest.survey_id
    return { form, manifest: parsed.manifest, notice: '이 기기에 저장된 기록을 복구했습니다. 중단된 회차는 error·미완료 기록으로 남습니다.' }
  } catch {
    return { form, manifest: createManifest(form.surveyId), notice: '저장된 기록을 읽지 못했습니다. 기존 저장값은 새로 기록하거나 가져오기 전까지 덮어쓰지 않습니다.' }
  }
}

const resultLabel = { readings: '이벤트 수신', denied: '권한 거절', unsupported: '이벤트 없음·미지원', error: '중단·오류' }

export default function SurveyPage() {
  const [initial] = useState(loadDraft)
  const [form, setForm] = useState(initial.form)
  const [manifest, setManifest] = useState(initial.manifest)
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(initial.notice)
  const [storageWarning, setStorageWarning] = useState('')
  const [active, setActive] = useState<CompassTrial | null>(null)
  const [importing, setImporting] = useState(false)
  const manifestRef = useRef(manifest)
  const formRef = useRef(form)
  const lastSaved = useRef(0)
  const recorderRef = useRef<SensorRecorder | null>(null)
  formRef.current = form

  const save = (next: SurveyManifest, flush: boolean) => {
    if (!flush && Date.now() - lastSaved.current < 1000) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ manifest: next, form: formRef.current }))
      lastSaved.current = Date.now()
      setStorageWarning('')
    } catch {
      setStorageWarning('이 브라우저에 임시 저장하지 못했습니다. 기록은 메모리에 있으니 화면을 떠나기 전에 JSON을 다운로드하세요.')
    }
  }

  useEffect(() => {
    const recorder = new SensorRecorder(browserPlatform(), (trial, nextPhase, flush) => {
      const next = putTrial(manifestRef.current, trial)
      manifestRef.current = next
      setManifest(next)
      setActive(trial)
      setPhase(nextPhase)
      if (nextPhase === 'idle') {
        const updated = { ...formRef.current, repeat: String(trial.repeat_index + 1) }
        formRef.current = updated
        setForm(updated)
      }
      save(next, flush)
    })
    recorderRef.current = recorder
    return () => { recorder.dispose(); recorderRef.current = null }
    // 레코더는 폼을 시작 시점에 고정하고 최신 manifest·폼은 ref에서 읽는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const change = (key: keyof SurveyForm, value: string) => setForm((previous) => ({ ...previous, [key]: value }))
  const busy = phase !== 'idle' || importing

  const start = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      let current = manifestRef.current
      if (!current.compass_trials.length && current.survey_id !== form.surveyId.trim()) current = createManifest(form.surveyId.trim())
      const prepared = prepareTrial(current, form, `heading-${crypto.randomUUID()}`, new Date().toISOString(), browserPlatform().screenAngle(), navigator.userAgent)
      manifestRef.current = prepared.manifest
      setManifest(prepared.manifest)
      if (!recorderRef.current) throw new Error('기록 화면을 준비 중입니다. 잠시 후 다시 시작하세요.')
      void recorderRef.current.start(prepared.trial, prepared.durationMs).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const download = () => {
    setError('')
    try {
      const at = new Date().toISOString()
      const json = serializeSurvey(manifestRef.current, at)
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName(manifestRef.current.survey_id, at)
      document.body.append(link)
      link.click()
      link.remove()
      // Safari가 파일을 소비하기 전에 URL을 해제하지 않는다.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setNotice('JSON 다운로드를 요청했습니다. Safari에서 미리보기가 열리면 공유 → 파일에 저장을 선택하세요.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importSurvey = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 30 * 1024 * 1024) return setError('가져올 JSON은 30MB 이하로 선택하세요.')
    setImporting(true)
    try {
      const imported = parseSurvey(await file.text())
      if (manifestRef.current.compass_trials.length && !window.confirm('현재 기록 대신 선택한 JSON을 불러옵니다. 현재 기록을 다운로드했는지 확인하세요.')) return
      manifestRef.current = imported
      setManifest(imported)
      setActive(null)
      const updated = { ...formRef.current, surveyId: imported.survey_id, repeat: '1' }
      formRef.current = updated
      setForm(updated)
      save(imported, true)
      setError('')
      setNotice('스키마를 검증하고 JSON을 불러왔습니다. 기존 지도·사진 기록은 유지하며 시험을 추가합니다.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setImporting(false) }
  }

  const reset = () => {
    if (manifest.compass_trials.length && !window.confirm('기기의 임시 기록을 새 답사로 바꿉니다. JSON을 다운로드했는지 확인하세요.')) return
    const updated = initialForm()
    const next = createManifest(updated.surveyId)
    formRef.current = updated
    setForm(updated)
    manifestRef.current = next
    setManifest(next)
    setActive(null)
    setError('')
    save(next, true)
    setNotice('새 답사를 준비했습니다.')
  }

  const field = (key: keyof SurveyForm, label: string, required = true, type = 'text') => (
    <label className="survey-field" htmlFor={`survey-${key}`}>
      <span>{label}{!required && ' (선택)'}</span>
      <input id={`survey-${key}`} type={type} required={required} value={form[key]} onChange={(event) => change(key, event.target.value)} maxLength={type === 'number' ? undefined : 500} step={type === 'number' ? 'any' : undefined} />
    </label>
  )
  const latest = active?.samples.at(-1)

  return (
    <main className="survey-page" lang="ko">
      <header className="survey-header">
        <p className="survey-eyebrow">한길 · 서울역 현장 답사</p>
        <h1>방향 센서 기록</h1>
        <p>지점에 멈춰 같은 대상을 바라보고 기록하세요. 원시 방향 이벤트는 이 기기에 보관되며 서버로 전송하지 않습니다.</p>
        <a href="/" onClick={(event) => { if (busy) { event.preventDefault(); setError('기록을 중지한 뒤 이동하세요.') } }}>한길 서비스로 돌아가기</a>
      </header>
      {!window.isSecureContext && <p className="survey-error" role="alert">HTTPS 연결이 필요합니다. 현재 연결에서는 미지원 결과만 기록할 수 있습니다.</p>}
      {error && <p className="survey-error" role="alert">{error}</p>}
      {storageWarning && <p className="survey-error" role="alert">{storageWarning}</p>}
      {notice && <p className="survey-notice" role="status">{notice}</p>}
      <form onSubmit={start}>
        <fieldset disabled={busy}>
          <legend>답사와 기기</legend>
          <div className="survey-grid">
            {field('surveyId', '답사 ID')}{field('collector', '담당자')}
            {field('deviceId', '기기 ID')}{field('model', '기종')}
            {field('osVersion', 'OS 버전')}{field('browser', '브라우저')}{field('browserVersion', '브라우저 버전')}
          </div>
          <p className="survey-help">예: SS-2026-10-24 / phone-A / iPhone 모델 / iOS 버전 / Safari. 기종·버전은 실제 설정에서 확인하세요.</p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>지점과 반복 회차</legend>
          <div className="survey-grid">
            {field('nodeId', '지점 ID')}{field('nodeName', '지점 이름')}{field('floorId', '층')}
            {field('standing', '서 있는 위치')}
            <label className="survey-field" htmlFor="survey-posture"><span>자세</span><select id="survey-posture" value={form.posture} onChange={(event) => change('posture', event.target.value)}><option value="rear_camera_forward_portrait">A · 세로로 들고 후면 카메라 정면</option><option value="flat_screen_up">B · 화면을 위로 향해 수평</option></select></label>
            {field('repeat', '반복 회차', true, 'number')}{field('duration', '기록 시간 (초)', true, 'number')}
          </div>
          <p className="survey-help">기본 10초, 최대 120초. 완료·거절·중단 기록을 남긴 뒤 회차가 자동 증가합니다. 화면을 회전하거나 앱을 숨기면 해당 회차를 종료합니다.</p>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>비교할 기준 방향</legend>
          <div className="survey-grid">
            {field('target', '조준 대상', false)}{field('referenceDeg', '기준 방향 (0~360도 미만)', false, 'number')}
            <label className="survey-field" htmlFor="survey-referenceNorth"><span>기준 방향의 북쪽</span><select id="survey-referenceNorth" value={form.referenceNorth} onChange={(event) => change('referenceNorth', event.target.value)}><option value="unknown">모름</option><option value="true_north">진북</option><option value="magnetic_north">자북</option><option value="map_axis">도면의 기준축</option></select></label>
            {field('referenceSource', '독립 기준 방향 출처', false)}{field('notes', '특이사항·자석 케이스 사용 여부', false)}
          </div>
          <p className="survey-help">모르면 방향 숫자를 비워 두세요. 같은 시험 폰의 나침반을 정답으로 쓰지 않습니다. iOS 나침반은 자북 원본으로 저장하고 후면 방위로 임의 변환하지 않습니다.</p>
        </fieldset>
        <div className="survey-controls">
          <button type="submit" className="survey-primary" disabled={busy}>권한 요청하고 기록 시작</button>
          <button type="button" className="survey-secondary" disabled={!busy} onClick={() => recorderRef.current?.stop()}>기록 중지</button>
        </div>
      </form>
      <section className="survey-panel" aria-label="현재 기록">
        <p role="status" className="survey-recording">{phase === 'requesting' ? '권한 응답을 기다리는 중' : phase === 'recording' ? '기록 중' : '기록 대기'} · {active?.samples.length ?? 0}개 이벤트</p>
        <p>마지막 이벤트: {latest?.event_type ?? '—'} · {latest ? `${Math.round(latest.elapsed_ms)} ms` : '—'}</p>
        <dl className="survey-values">
          <div><dt>alpha / beta / gamma</dt><dd>{latest ? `${latest.alpha ?? '—'} / ${latest.beta ?? '—'} / ${latest.gamma ?? '—'}` : '—'}</dd></div>
          <div><dt>iOS 방위 / 정확도</dt><dd>{latest ? `${latest.webkit_compass_heading ?? '—'} / ${latest.webkit_compass_accuracy ?? '—'}` : '—'}</dd></div>
          <div><dt>가공한 후면 방위</dt><dd>{latest?.derived_rear_heading_deg ?? '—'}</dd></div>
        </dl>
        <p className="survey-help">두 종류의 이벤트를 필터링·평균하지 않고 모두 저장합니다. 가공 방위가 없어도 수신한 원본과 오류는 남습니다.</p>
      </section>
      <section className="survey-panel" aria-label="저장된 시험">
        <h2>저장된 시험 {manifest.compass_trials.length}회</h2>
        <ol className="survey-trials">{manifest.compass_trials.map((trial) => <li key={trial.trial_id}><strong>{trial.node_id} · {trial.device_id} · {trial.repeat_index}회</strong><span>{trial.posture === 'flat_screen_up' ? '수평' : '후면 정면'} · {trial.samples.length}개 · {trial.trial_id === active?.trial_id && busy ? '진행 중' : resultLabel[trial.result]}</span></li>)}</ol>
        <div className="survey-controls">
          <button type="button" className="survey-primary" disabled={busy || !manifest.compass_trials.length} onClick={download}>JSON 다운로드</button>
          <label className={`survey-secondary survey-upload${busy ? ' survey-disabled' : ''}`}>기존 JSON 불러오기<input aria-label="기존 JSON 불러오기" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void importSurvey(event) }} /></label>
          <button type="button" className="survey-secondary" disabled={busy} onClick={reset}>새 답사</button>
        </div>
        <p className="survey-help">1초 간격으로 이 브라우저에 임시 저장합니다. 브라우저 저장공간은 백업이 아니므로 지점마다 다운로드하세요. 내보내기 전 수집 스키마 1.0.0을 검사합니다.</p>
      </section>
    </main>
  )
}
