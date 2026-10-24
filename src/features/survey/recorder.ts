/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 브라우저 방향 이벤트를 두 채널 그대로 보존하고 권한·타이머·중단 시점을 관리한다
 */
import { compassHeading } from '../live/heading'
import type { CompassTrial, Posture, RawSample } from './model'

export interface OrientationInput {
  type: string
  absolute?: boolean | null
  alpha?: number | null
  beta?: number | null
  gamma?: number | null
  webkitCompassHeading?: number | null
  webkitCompassAccuracy?: number | null
}
export type RecorderPhase = 'idle' | 'requesting' | 'recording'
export interface RecorderPlatform {
  secure: boolean
  supported: boolean
  wallNow(): string
  monotonicNow(): number
  screenAngle(): number
  visible(): boolean
  permission(): Promise<'granted' | 'denied'>
  subscribe(sample: (event: OrientationInput) => void, interrupt: (reason: string) => void): () => void
  later(callback: () => void, ms: number): () => void
  every(callback: () => void, ms: number): () => void
}

const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
export const MAX_SAMPLES = 30000

export function rawSample(event: OrientationInput, elapsed: number, posture: Posture): RawSample {
  const alpha = finite(event.alpha), beta = finite(event.beta), gamma = finite(event.gamma)
  const webkit = finite(event.webkitCompassHeading)
  // 상대 방향이나 iOS 나침반 값을 임의로 절대 후면 방위로 바꾸지 않는다. 수평 자세에서는 후면 광축이 아래를 향한다.
  const canDerive = posture === 'rear_camera_forward_portrait' && event.absolute === true && webkit === null && beta !== null && gamma !== null
  const vertical = beta !== null && gamma !== null ? Math.abs(Math.cos(beta * Math.PI / 180) * Math.cos(gamma * Math.PI / 180)) : 1
  return {
    elapsed_ms: Math.max(0, elapsed), event_type: event.type === 'deviceorientationabsolute' ? 'deviceorientationabsolute' : 'deviceorientation',
    absolute: typeof event.absolute === 'boolean' ? event.absolute : null, alpha, beta, gamma,
    webkit_compass_heading: webkit, webkit_compass_accuracy: finite(event.webkitCompassAccuracy),
    derived_rear_heading_deg: canDerive && vertical < 0.999999 ? compassHeading(alpha, beta, gamma) : null,
  }
}

export class SensorRecorder {
  private platform: RecorderPlatform
  private update: (trial: CompassTrial, phase: RecorderPhase, flush: boolean) => void
  private trial: CompassTrial | null = null
  private phase: RecorderPhase = 'idle'
  private started = 0
  private stopCallbacks: (() => void)[] = []

  constructor(platform: RecorderPlatform, update: (trial: CompassTrial, phase: RecorderPhase, flush: boolean) => void) {
    this.platform = platform
    this.update = update
  }

  async start(trial: CompassTrial, durationMs: number) {
    if (this.trial) throw new Error('이미 기록 중입니다.')
    this.trial = { ...trial, samples: [] }
    this.phase = 'requesting'
    this.emit(true)
    if (!this.platform.secure) return this.finish('unsupported', 'HTTPS 보안 연결이 아니어서 센서 권한을 요청하지 못함.')
    if (!this.platform.supported) return this.finish('unsupported', 'DeviceOrientationEvent를 지원하지 않음.')
    const current = this.trial
    try {
      // 이 호출은 시작 버튼의 사용자 동작 안에서 await 전에 실행한다.
      const granted = await this.platform.permission()
      if (this.trial !== current) return
      if (granted !== 'granted') return this.finish('denied', '방향 센서 권한 거절.')
      if (!this.platform.visible()) return this.finish('error', '권한 요청 중 화면이 숨겨짐. 다시 기록 필요.')
      this.started = this.platform.monotonicNow()
      current.started_at = this.platform.wallNow()
      current.screen_angle_deg = this.platform.screenAngle()
      this.phase = 'recording'
      this.stopCallbacks.push(this.platform.subscribe((event) => this.receive(event), (reason) => this.stop(reason, 'error')))
      this.stopCallbacks.push(this.platform.every(() => this.emit(false), 250))
      this.stopCallbacks.push(this.platform.later(() => this.stop('설정한 기록 시간 완료.'), durationMs))
      this.emit(true)
    } catch (error) {
      if (this.trial !== current) return
      const denied = error instanceof Error && error.name === 'NotAllowedError'
      this.finish(denied ? 'denied' : 'error', denied ? '센서 권한 요청이 거절됨.' : `센서 시작 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private receive(event: OrientationInput) {
    if (!this.trial || this.phase !== 'recording') return
    if (this.platform.screenAngle() !== this.trial.screen_angle_deg) return this.stop('화면 방향이 바뀌어 회차를 중단함. 회전 후 새 회차로 기록.', 'error')
    if (this.trial.samples.length >= MAX_SAMPLES) return this.stop('최대 이벤트 수 도달. 이후 샘플은 저장하지 않고 기록 종료.', 'error')
    const sample = rawSample(event, this.platform.monotonicNow() - this.started, this.trial.posture)
    this.trial.samples.push(sample)
    if (sample.webkit_compass_heading !== null) this.trial.sensor_reference = 'magnetic_north'
    else if (sample.absolute === true && this.trial.sensor_reference === 'unknown') this.trial.sensor_reference = 'implementation_defined'
  }

  stop(reason = '사용자가 기록 중지.', forced?: CompassTrial['result']) {
    if (!this.trial) return
    const result = forced ?? (this.phase === 'requesting' ? 'error' : this.trial.samples.length ? 'readings' : 'unsupported')
    this.finish(result, reason + (!this.trial.samples.length ? ' 수신한 방향 이벤트 없음.' : ''))
  }

  private finish(result: CompassTrial['result'], reason: string) {
    if (!this.trial) return
    for (const stop of this.stopCallbacks.splice(0)) stop()
    const trial = this.trial
    trial.result = result
    trial.notes = trial.notes.replace('기록 미완료. 종료 전 중단되면 복구한 부분 기록으로 취급.', `종료: ${this.platform.wallNow()}\n${reason}`)
    if (trial.samples.some((sample) => sample.webkit_compass_heading !== null)) trial.notes += '\niOS 나침반은 자북 원본으로 보관. 후면 방위 변환은 미검증이므로 null.'
    if (trial.samples.length && trial.samples.every((sample) => sample.derived_rear_heading_deg === null)) trial.notes += '\n이벤트는 수신했지만 가공 가능한 절대 후면 방위는 없음.'
    this.phase = 'idle'
    this.emit(true)
    this.trial = null
  }

  private emit(flush: boolean) {
    if (this.trial) this.update({ ...this.trial, samples: [...this.trial.samples] }, this.phase, flush)
  }

  dispose() { this.stop('기록 화면을 떠나 종료.', 'error') }
}

type PermissionCtor = typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'> }

export function browserPlatform(): RecorderPlatform {
  const ctor = window.DeviceOrientationEvent as PermissionCtor | undefined
  const screenAngle = () => finite(window.screen.orientation?.angle) ?? finite((window as Window & { orientation?: number }).orientation) ?? 0
  return {
    secure: window.isSecureContext, supported: typeof ctor !== 'undefined',
    wallNow: () => new Date().toISOString(), monotonicNow: () => performance.now(), screenAngle,
    visible: () => document.visibilityState !== 'hidden',
    permission: () => ctor?.requestPermission ? ctor.requestPermission(true) : Promise.resolve('granted'),
    subscribe(sample, interrupt) {
      const initialAngle = screenAngle()
      const orientation = (event: Event) => sample(event as DeviceOrientationEvent)
      const hidden = () => { if (document.visibilityState === 'hidden') interrupt('브라우저 화면이 숨겨져 기록 중단. 화면을 켜고 새 회차로 기록하세요.') }
      const rotated = () => { if (screenAngle() !== initialAngle) interrupt('화면 방향 변경으로 기록 중단. 새 회차로 다시 시작하세요.') }
      const pagehide = () => interrupt('페이지 이동·종료로 기록 중단.')
      window.addEventListener('deviceorientation', orientation)
      window.addEventListener('deviceorientationabsolute', orientation)
      document.addEventListener('visibilitychange', hidden)
      window.addEventListener('pagehide', pagehide)
      window.addEventListener('orientationchange', rotated)
      window.screen.orientation?.addEventListener('change', rotated)
      return () => {
        window.removeEventListener('deviceorientation', orientation)
        window.removeEventListener('deviceorientationabsolute', orientation)
        document.removeEventListener('visibilitychange', hidden)
        window.removeEventListener('pagehide', pagehide)
        window.removeEventListener('orientationchange', rotated)
        window.screen.orientation?.removeEventListener('change', rotated)
      }
    },
    later: (callback, ms) => { const id = window.setTimeout(callback, ms); return () => window.clearTimeout(id) },
    every: (callback, ms) => { const id = window.setInterval(callback, ms); return () => window.clearInterval(id) },
  }
}
