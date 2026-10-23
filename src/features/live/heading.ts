/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 라이브 뷰의 방향 계산. 폰 센서 값을 나침반 방위로 바꾸고, 믿어도 되는지 판정하고, 화살표 각도와 말로 된 방향 힌트를 만든다 (브라우저 API 없는 순수 함수)
 */
import { wrapDegrees } from '../route/toSteps'

// 아래 숫자는 서울역 현장 실측(docs/phase0-compass-field-test.md) 전의 가정이다. 실측 뒤에 맞춘다.
// 최근 이 시간(ms) 안의 샘플로 방향을 판단한다
export const WINDOW_MS = 1000
// 샘플이 이보다 적으면 아직 읽는 중이다
export const MIN_SAMPLES = 5
// 샘플이 이만큼(원형 표준편차, 도) 넘게 흔들리면 믿지 않는다
export const MAX_SPREAD_DEG = 25
// iOS가 알려 주는 방향 정확도(도)가 이보다 나쁘거나 음수(무효)면 믿지 않는다
export const MAX_ACCURACY_DEG = 30

const RAD = Math.PI / 180

export interface HeadingSample {
  // 폰 뒷면(카메라)이 향한 방위, 0 = 북쪽, 시계 방향
  deg: number
  // 기기가 알려 준 정확도(도). 모르면 null (Android 이벤트에는 없다)
  accuracy: number | null
  at: number
}

// [0, 360)
export const normalizeDegrees = (angle: number): number => ((angle % 360) + 360) % 360

// 폰 뒷면이 향한 방위. 폰을 세워 들고 앞을 비추는 자세에 맞는 식이다 (W3C Device Orientation의 compassHeading 예제와 같다).
// alpha·beta·gamma는 deviceorientationabsolute 이벤트 값(도)이다. 계산할 수 없으면 null
export function compassHeading(alpha: number | null, beta: number | null, gamma: number | null): number | null {
  if (alpha === null || beta === null || gamma === null) return null
  const a = alpha * RAD
  const b = beta * RAD
  const g = gamma * RAD
  const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  if (!Number.isFinite(east) || !Number.isFinite(north) || (east === 0 && north === 0)) return null
  return normalizeDegrees(Math.atan2(east, north) / RAD)
}

// 원 위의 평균. 359°와 1°의 평균은 180°가 아니라 0°다
export function circularMean(degs: number[]): number {
  const x = degs.reduce((sum, d) => sum + Math.cos(d * RAD), 0)
  const y = degs.reduce((sum, d) => sum + Math.sin(d * RAD), 0)
  return normalizeDegrees(Math.atan2(y, x) / RAD)
}

// 원형 표준편차(도). 값이 한곳에 모여 있으면 0에 가깝다
export function circularSpread(degs: number[]): number {
  const n = degs.length
  if (n === 0) return 0
  const x = degs.reduce((sum, d) => sum + Math.cos(d * RAD), 0) / n
  const y = degs.reduce((sum, d) => sum + Math.sin(d * RAD), 0) / n
  const r = Math.min(1, Math.hypot(x, y))
  return r <= 0 ? 180 : Math.sqrt(-2 * Math.log(r)) / RAD
}

// target을 향하려면 지금 향한 방향(from)에서 얼마나 돌아야 하는가. (-180, 180], 양수 = 오른쪽
export const turnDeg = (target: number, from: number): number => wrapDegrees(target - from)

// 화살표 CSS 각도가 경계(359 → 1)에서 한 바퀴 되돌아 돌지 않게 이어서 센다. target과 같은 방향이면서 prev에 가장 가까운 값
export const unwrapAngle = (prev: number, target: number): number => prev + wrapDegrees(target - prev)

export type HeadingQuality = 'waiting' | 'unstable' | 'ok'

export interface HeadingReading {
  quality: HeadingQuality
  // 쓸 수 있는 방향(최근 샘플의 원형 평균). ok일 때만 값이 있다
  deg: number | null
  // 판정에 쓴 샘플 수와 흔들림. 데모 화면의 확인용 표시에 쓴다
  samples: number
  spreadDeg: number
}

export function assessHeading(samples: HeadingSample[], now: number): HeadingReading {
  const recent = samples.filter((s) => now - s.at <= WINDOW_MS)
  const spreadDeg = circularSpread(recent.map((s) => s.deg))
  const base = { samples: recent.length, spreadDeg }
  if (recent.length < MIN_SAMPLES) return { quality: 'waiting', deg: null, ...base }
  // 샘플은 시간순으로 쌓이므로 마지막이 가장 최근이다
  const accuracy = recent[recent.length - 1].accuracy
  const badAccuracy = accuracy !== null && (accuracy < 0 || accuracy > MAX_ACCURACY_DEG)
  if (badAccuracy || spreadDeg > MAX_SPREAD_DEG) return { quality: 'unstable', deg: null, ...base }
  return { quality: 'ok', deg: circularMean(recent.map((s) => s.deg)), ...base }
}

export type TurnHint = 'ahead' | 'right' | 'left' | 'behind'

// 화살표를 못 보거나 돌려 보기 어려운 사람을 위한 말. 경계는 가정이다
export function turnHint(turn: number): TurnHint {
  const abs = Math.abs(turn)
  if (abs <= 25) return 'ahead'
  if (abs > 135) return 'behind'
  return turn > 0 ? 'right' : 'left'
}
