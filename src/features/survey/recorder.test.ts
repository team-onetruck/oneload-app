/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: iOS·Android 원시값 보존과 권한·자동 종료·회전·화면 숨김·취소 후 정리를 검증한다
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompassTrial } from './model'
import { MAX_SAMPLES, rawSample, SensorRecorder } from './recorder'
import type { OrientationInput, RecorderPhase, RecorderPlatform } from './recorder'

function harness(permission = Promise.resolve<'granted' | 'denied'>('granted')) {
  let receive: (event: OrientationInput) => void = () => {}
  let interrupt: (reason: string) => void = () => {}
  let angle = 0
  const unsubscribe = vi.fn()
  const updates: { trial: CompassTrial; phase: RecorderPhase }[] = []
  const platform: RecorderPlatform = {
    secure: true, supported: true, wallNow: () => new Date().toISOString(), monotonicNow: () => Date.now(), screenAngle: () => angle, visible: () => true,
    permission: vi.fn(() => permission),
    subscribe: vi.fn((onSample, onInterrupt) => { receive = onSample; interrupt = onInterrupt; return unsubscribe }),
    later: (callback, ms) => { const id = setTimeout(callback, ms); return () => clearTimeout(id) },
    every: (callback, ms) => { const id = setInterval(callback, ms); return () => clearInterval(id) },
  }
  const recorder = new SensorRecorder(platform, (trial, phase) => updates.push({ trial, phase }))
  const trial: CompassTrial = {
    trial_id: 'trial-A', node_id: 'node-A', device_id: 'phone-A', started_at: new Date().toISOString(), repeat_index: 1,
    posture: 'rear_camera_forward_portrait', screen_angle_deg: 0, reference_target_description: '고정 기둥',
    reference_heading: { deg: null, reference: 'unknown', method: 'not_measured', source_ids: [], uncertainty_deg: null },
    sensor_reference: 'unknown', normalization_to_map_deg: null, normalization_source_ids: [], result: 'error', samples: [],
    notes: '기록 미완료. 종료 전 중단되면 복구한 부분 기록으로 취급.',
  }
  return { recorder, platform, trial, updates, unsubscribe, emit: (event: OrientationInput) => receive(event), interrupt: (reason: string) => interrupt(reason), rotate: () => { angle = 90 }, last: () => updates.at(-1)! }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('원시 방향 이벤트', () => {
  it('0과 음수 정확도를 보존하고 비정상 수치는 null로 직렬화한다', () => {
    const sample = rawSample({ type: 'deviceorientation', absolute: false, alpha: 0, beta: NaN, gamma: Infinity, webkitCompassHeading: -1, webkitCompassAccuracy: -1 }, 12, 'rear_camera_forward_portrait')
    expect(sample).toMatchObject({ alpha: 0, beta: null, gamma: null, absolute: false, webkit_compass_heading: -1, webkit_compass_accuracy: -1, derived_rear_heading_deg: null })
  })
  it('Android 절대 이벤트에서만 후면 방위를 구하고 상대·수평·iOS 값은 추측하지 않는다', () => {
    const absolute = { type: 'deviceorientationabsolute', absolute: true, alpha: 270, beta: 90, gamma: 0 }
    expect(rawSample(absolute, 0, 'rear_camera_forward_portrait').derived_rear_heading_deg).toBeCloseTo(90)
    expect(rawSample({ ...absolute, absolute: false }, 0, 'rear_camera_forward_portrait').derived_rear_heading_deg).toBeNull()
    expect(rawSample(absolute, 0, 'flat_screen_up').derived_rear_heading_deg).toBeNull()
    expect(rawSample({ ...absolute, webkitCompassHeading: 91 }, 0, 'rear_camera_forward_portrait').derived_rear_heading_deg).toBeNull()
  })
})

describe('답사 레코더 수명주기', () => {
  it('사용자 동작 안에서 권한을 즉시 요청하고 두 채널을 원래 순서로 저장한다', async () => {
    const h = harness()
    const starting = h.recorder.start(h.trial, 1000)
    expect(h.platform.permission).toHaveBeenCalledOnce()
    await starting
    h.emit({ type: 'deviceorientation', absolute: false, alpha: 15, beta: 90, gamma: 0 })
    vi.advanceTimersByTime(30)
    h.emit({ type: 'deviceorientationabsolute', absolute: true, alpha: 270, beta: 90, gamma: 0 })
    vi.advanceTimersByTime(970)
    expect(h.last().phase).toBe('idle')
    expect(h.last().trial.samples.map((sample) => sample.event_type)).toEqual(['deviceorientation', 'deviceorientationabsolute'])
    expect(h.last().trial.samples.map((sample) => sample.elapsed_ms)).toEqual([0, 30])
    expect(h.last().trial.result).toBe('readings')
    expect(h.last().trial.normalization_to_map_deg).toBeNull()
    expect(h.unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('iOS 나침반을 자북 원본으로 기록한다', async () => {
    const h = harness()
    await h.recorder.start(h.trial, 1000)
    h.emit({ type: 'deviceorientation', webkitCompassHeading: 0, webkitCompassAccuracy: -1, alpha: 42, beta: 89, gamma: 1 })
    h.recorder.stop()
    expect(h.last().trial).toMatchObject({ sensor_reference: 'magnetic_north', result: 'readings' })
    expect(h.last().trial.samples[0].webkit_compass_heading).toBe(0)
    expect(h.last().trial.samples[0].webkit_compass_accuracy).toBe(-1)
  })
  it('권한 거절은 빈 samples의 denied 기록으로 남기고 리스너를 설치하지 않는다', async () => {
    const h = harness(Promise.resolve('denied'))
    await h.recorder.start(h.trial, 1000)
    expect(h.last().trial.result).toBe('denied')
    expect(h.platform.subscribe).not.toHaveBeenCalled()
  })
  it('이벤트 미수신·보안 연결 없음·API 미지원을 각각 기록한다', async () => {
    const h = harness()
    await h.recorder.start(h.trial, 1000)
    vi.advanceTimersByTime(1000)
    expect(h.last().trial.result).toBe('unsupported')
    for (const key of ['secure', 'supported'] as const) {
      const unavailable = harness()
      unavailable.platform[key] = false
      await unavailable.recorder.start(unavailable.trial, 1000)
      expect(unavailable.last().trial.result).toBe('unsupported')
      expect(unavailable.platform.permission).not.toHaveBeenCalled()
    }
  })
  it('권한 대기 중 취소한 뒤 허용 응답이 와도 기록을 재시작하지 않는다', async () => {
    let grant: (value: 'granted') => void = () => {}
    const h = harness(new Promise((resolve) => { grant = resolve }))
    const pending = h.recorder.start(h.trial, 1000)
    h.recorder.stop()
    grant('granted')
    await pending
    expect(h.last().trial.result).toBe('error')
    expect(h.platform.subscribe).not.toHaveBeenCalled()
  })
  it('화면 숨김과 회전은 이미 받은 이벤트를 유지한 error 기록으로 끝낸다', async () => {
    for (const reason of ['hidden', 'rotation']) {
      const h = harness()
      await h.recorder.start(h.trial, 1000)
      h.emit({ type: 'deviceorientation', alpha: 0 })
      if (reason === 'hidden') h.interrupt('화면 숨김')
      else { h.rotate(); h.emit({ type: 'deviceorientation', alpha: 1 }) }
      expect(h.last().trial.result).toBe('error')
      expect(h.last().trial.samples).toHaveLength(1)
      expect(h.unsubscribe).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  })
  it('과도한 이벤트는 상한에서 명시적으로 중단한다', async () => {
    const h = harness()
    await h.recorder.start(h.trial, 1000)
    for (let i = 0; i <= MAX_SAMPLES; i++) h.emit({ type: 'deviceorientation', alpha: i })
    expect(h.last().trial.samples).toHaveLength(MAX_SAMPLES)
    expect(h.last().trial.result).toBe('error')
    expect(h.last().trial.notes).toContain('최대 이벤트')
  })
})
