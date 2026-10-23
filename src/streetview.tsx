import { useEffect, useRef, useState } from 'react'
import { Viewer } from '@photo-sphere-viewer/core'
import type { MarkerConfig } from '@photo-sphere-viewer/markers-plugin'
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin'
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import { Compass, ImageOff, LocateFixed } from 'lucide-react'
import type { Lang } from './data'
import { legDistanceLabel } from './features/route/guide'
import type { GuideLeg, GuidePano } from './features/route/guide'
import { UI } from './i18n'

const RAD = Math.PI / 180
// The arrow sits on the floor a little ahead of the viewer.
const ARROW_PITCH = -0.32
const LOOK_PITCH = -0.12
// Always a forward arrow laid on the floor; a level change is spelled out in the label.
const ARROW_PATH = '<path d="M32 4 60 36H43v24H21V36H4Z"/>'

// 화살표 방향(yawDeg)은 경로 모델이 정한다: 서버 arrow_yaw_deg 우선, 없으면 northYaw + heading (features/route/guide.ts)
function arrowMarker(leg: GuideLeg, lang: Lang, yaw: number): MarkerConfig {
  const label = legDistanceLabel(leg)
  return {
    id: 'next',
    position: { yaw, pitch: ARROW_PITCH },
    html: `<div class="sv-arrow"><svg viewBox="0 0 64 64" aria-hidden="true">${ARROW_PATH}</svg><span>${label}</span></div>`,
    anchor: 'center center',
    tooltip: { content: leg.instruction[lang], position: 'top center' },
  }
}

function PanoViewer({ pano, leg, lang }: { pano: GuidePano; leg: GuideLeg; lang: Lang }) {
  const box = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const [gyro, setGyro] = useState<boolean | null>(null)
  // 방향을 모르면 화살표 없이 사진만 보여 준다
  const yaw = (leg.yawDeg ?? 0) * RAD

  // One viewer per mount; later steps swap the panorama with a fade so the
  // walk feels like stepping forward rather than reloading a page.
  useEffect(() => {
    const v = new Viewer({
      container: box.current!,
      panorama: pano.src,
      defaultYaw: yaw,
      defaultPitch: LOOK_PITCH,
      navbar: false,
      mousewheel: false,
      loadingTxt: '',
      plugins: [MarkersPlugin, GyroscopePlugin],
    })
    viewer.current = v
    v.getPlugin<GyroscopePlugin>(GyroscopePlugin).isSupported().then(setGyro)
    return () => {
      v.destroy()
      viewer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; updates below
  }, [])

  useEffect(() => {
    const v = viewer.current
    if (!v) return
    const markers = v.getPlugin<MarkersPlugin>(MarkersPlugin)
    markers.clearMarkers()
    const show = () => leg.yawDeg !== null && markers.setMarkers([arrowMarker(leg, lang, yaw)])
    if (v.config.panorama === pano.src) {
      show()
      v.animate({ yaw, pitch: LOOK_PITCH, speed: '4rpm' })
    } else {
      v.setPanorama(pano.src, { position: { yaw, pitch: LOOK_PITCH }, transition: { speed: 900, effect: 'fade' }, showLoader: false }).then(show)
    }
  }, [pano.src, yaw, leg, lang])

  const faceArrow = () => viewer.current?.animate({ yaw, pitch: LOOK_PITCH, speed: '6rpm' })
  const toggleGyro = () => viewer.current?.getPlugin<GyroscopePlugin>(GyroscopePlugin).toggle()

  return (
    <div className="sv">
      <div ref={box} className="sv-canvas" />
      {pano.example && <p className="sv-example">{pano.example[lang]}</p>}
      <div className="sv-tools">
        {leg.yawDeg !== null && (
          <button className="sv-tool" onClick={faceArrow} aria-label={UI.svFace[lang]}>
            <LocateFixed size={20} />
          </button>
        )}
        {gyro && (
          <button className="sv-tool" onClick={toggleGyro} aria-label={UI.svGyro[lang]}>
            <Compass size={20} />
          </button>
        )}
      </div>
    </div>
  )
}

// 지금 단계 출발 지점의 사진과 다음 지점 방향 화살표. 사진이 없는 지점은 안내만 따르게 한다
export function StreetView({ leg, lang }: { leg: GuideLeg; lang: Lang }) {
  if (!leg.pano)
    return (
      <div className="sv sv-missing">
        <ImageOff size={34} strokeWidth={1.6} />
        <p>{UI.svMissing[lang]}</p>
      </div>
    )
  return <PanoViewer pano={leg.pano} leg={leg} lang={lang} />
}
