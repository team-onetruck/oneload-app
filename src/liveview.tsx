/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 화면의 카메라 탭. 후면 카메라 영상 위에 다음 지점이 있는 방향을 화살표로 얹는다. 위치는 확정된 지점뿐이고 방향만 실시간이다
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Camera, VideoOff } from 'lucide-react'
import type { Lang } from './data'
import { turnDeg, turnHint, unwrapAngle } from './features/live/heading'
import { useCamera, useCompass } from './features/live/sensors'
import { legDistanceLabel } from './features/route/guide'
import type { GuideLeg } from './features/route/guide'
import { UI } from './i18n'

// 바닥에 놓는 화살표가 아니라 화면에서 바로 가리키는 화살표라서, 거리뷰와 같은 모양을 평면으로 쓴다
const ARROW_PATH = '<path d="M32 4 60 36H43v24H21V36H4Z"/>'

const HINT = { ahead: UI.liveAhead, right: UI.liveRight, left: UI.liveLeft, behind: UI.liveBehind }

interface Props {
  leg: GuideLeg
  lang: Lang
  // 영상 위 왼쪽 위에 놓는 '지금 있는 지점' 칩 내용
  chip: ReactNode
  // 카메라를 쓸 수 없을 때 돌아갈 곳(노선 보기)
  onLeave: () => void
}

// 화살표가 바르게 보이려면 폰을 세워 앞을 비춰야 한다. 방향이 안 맞거나 못 읽으면 화살표를 숨기고 이유를 말한다
export function LiveView({ leg, lang, chip, onLeave }: Props) {
  const { status: cameraStatus, start: startCamera, attach: attachVideo } = useCamera()
  const { status: compassStatus, reading, start: startCompass } = useCompass()
  const target = leg.headingDeg

  const turn = cameraStatus === 'on' && compassStatus === 'reading' && reading.quality === 'ok' && reading.deg !== null && target !== null ? turnDeg(target, reading.deg) : null

  // 경계(359 → 1)에서 화살표가 한 바퀴 되돌아 돌지 않게 이어서 센 각도로 그린다
  const [rotation, setRotation] = useState(0)
  if (turn !== null && unwrapAngle(rotation, turn) !== rotation) setRotation(unwrapAngle(rotation, turn))

  // 권한 요청은 눌림 안에서 맨 먼저 보낸다 (iOS는 제스처 안에서만 방향 권한 창이 뜬다)
  const begin = () => {
    void startCompass()
    void startCamera()
  }

  if (cameraStatus === 'idle' || cameraStatus === 'starting')
    return (
      <div className="sv sv-missing">
        <Camera size={34} strokeWidth={1.6} />
        <p>{UI.liveIntro[lang]}</p>
        <p className="live-privacy">{UI.livePrivacy[lang]}</p>
        <button className="btn primary" onClick={begin} disabled={cameraStatus === 'starting'}>
          {UI.liveStart[lang]}
        </button>
      </div>
    )

  if (cameraStatus !== 'on')
    return (
      <div className="sv sv-missing">
        <VideoOff size={34} strokeWidth={1.6} />
        <p>{cameraStatus === 'denied' ? UI.liveCamDenied[lang] : UI.liveCamUnavailable[lang]}</p>
        <button className="btn secondary" onClick={onLeave}>
          {UI.liveBack[lang]}
        </button>
      </div>
    )

  const hint = turn === null ? null : HINT[turnHint(turn)][lang]
  const message =
    turn !== null
      ? null
      : target === null
        ? UI.liveNoHeading[lang]
        : compassStatus === 'denied'
          ? UI.liveCompassDenied[lang]
          : compassStatus === 'unsupported'
            ? UI.liveNoCompass[lang]
            : reading.quality === 'unstable'
              ? UI.liveUnstable[lang]
              : UI.liveReading[lang]

  return (
    <div className="sv live">
      <video ref={attachVideo} className="live-video" autoPlay playsInline muted />
      <div className="live-chip">{chip}</div>
      {turn !== null && (
        <div className="live-aim">
          <svg
            className="live-arrow"
            viewBox="0 0 64 64"
            role="img"
            aria-label={hint ?? undefined}
            data-turn={Math.round(turn)}
            style={{ transform: `rotate(${rotation}deg)` }}
            dangerouslySetInnerHTML={{ __html: ARROW_PATH }}
          />
          <span className="live-pill">{legDistanceLabel(leg)}</span>
          <span className="live-hint">{hint}</span>
        </div>
      )}
      {message && (
        <p className="live-msg" role="status">
          {message}
        </p>
      )}
      <p className="live-note">{UI.liveDirNote[lang]}</p>
    </div>
  )
}
