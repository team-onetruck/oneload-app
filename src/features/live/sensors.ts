/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 라이브 뷰가 쓰는 브라우저 센서 훅. 후면 카메라 영상과 폰이 향한 방위를 읽는다. 영상은 기기 밖으로 보내지 않는다
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { assessHeading, compassHeading } from './heading'
import type { HeadingReading, HeadingSample } from './heading'

// 화면에 반영하는 간격. 센서 이벤트는 초당 수십 번 오지만 화면은 이만큼만 다시 그린다
const TICK_MS = 100
// 시작한 뒤 이 시간 안에 방향 샘플이 하나도 없으면 이 기기·브라우저는 방향을 못 읽는다고 본다
const NO_SENSOR_MS = 3000
// 판정에 쓰지 않는 오래된 샘플은 이 시간이 지나면 버린다
const KEEP_MS = 2000

export type CameraStatus = 'idle' | 'starting' | 'on' | 'denied' | 'unavailable'

// 후면 카메라를 켜고 video 요소에 붙인다. start()는 눌림(제스처) 안에서 부른다. 화면을 떠나면(unmount) 트랙을 끈다
export function useCamera() {
  const [status, setStatus] = useState<CameraStatus>('idle')
  const stream = useRef<MediaStream | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)

  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
    if (el && stream.current) el.srcObject = stream.current
  }, [])

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])

  const start = useCallback(async () => {
    // http 주소나 오래된 브라우저에는 mediaDevices가 없다
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('unavailable')
    setStatus('starting')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      stream.current = s
      if (video.current) video.current.srcObject = s
      setStatus('on')
    } catch (err) {
      // 권한을 거절했거나(NotAllowedError) 카메라를 쓸 수 없는 경우를 나눈다
      setStatus(err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError') ? 'denied' : 'unavailable')
    }
  }, [])

  useEffect(() => stop, [stop])

  return { status, start, attach }
}

export type CompassStatus = 'idle' | 'reading' | 'denied' | 'unsupported'

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

const WAITING: HeadingReading = { quality: 'waiting', deg: null, samples: 0, spreadDeg: 0 }

// 폰이 향한 방위를 읽는다. start()는 눌림(제스처) 안에서 맨 먼저 부른다: iOS는 권한 요청이 제스처 안에서만 뜬다.
// iOS는 이벤트의 webkitCompassHeading(진북 기준)을, Android는 deviceorientationabsolute의 각도를 방위로 바꾼다.
// 상대 방향만 주는 deviceorientation(Android)은 쓰지 않는다. 북쪽을 모르기 때문이다
export function useCompass() {
  const [status, setStatus] = useState<CompassStatus>('idle')
  const [reading, setReading] = useState<HeadingReading>(WAITING)
  const samples = useRef<HeadingSample[]>([])

  const start = useCallback(async () => {
    const Ctor = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as OrientationCtor | undefined
    if (!Ctor) return setStatus('unsupported')
    if (typeof Ctor.requestPermission === 'function') {
      try {
        if ((await Ctor.requestPermission()) !== 'granted') return setStatus('denied')
      } catch {
        return setStatus('denied')
      }
    }
    setStatus('reading')
  }, [])

  useEffect(() => {
    if (status !== 'reading') return
    const push = (deg: number, accuracy: number | null) => {
      samples.current.push({ deg, accuracy, at: Date.now() })
    }
    const onOrientation = (e: Event) => {
      const ev = e as OrientationEventWithCompass
      if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading))
        push(ev.webkitCompassHeading, typeof ev.webkitCompassAccuracy === 'number' ? ev.webkitCompassAccuracy : null)
    }
    const onAbsolute = (e: Event) => {
      const ev = e as DeviceOrientationEvent
      const deg = compassHeading(ev.alpha, ev.beta, ev.gamma)
      if (deg !== null) push(deg, null)
    }
    window.addEventListener('deviceorientation', onOrientation)
    window.addEventListener('deviceorientationabsolute', onAbsolute)

    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const now = Date.now()
      samples.current = samples.current.filter((s) => now - s.at <= KEEP_MS)
      if (samples.current.length === 0 && now - startedAt > NO_SENSOR_MS) return setStatus('unsupported')
      setReading(assessHeading(samples.current, now))
    }, TICK_MS)

    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      window.removeEventListener('deviceorientationabsolute', onAbsolute)
      window.clearInterval(timer)
      samples.current = []
    }
  }, [status])

  return { status, reading, start }
}
