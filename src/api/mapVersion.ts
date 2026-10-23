/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 409 MAP_VERSION_MISMATCH가 오면 서버의 최신 지도 버전을 받아 한 번만 다시 보내는 래퍼
 */
import { isApiError } from './errors'

export interface MapVersionRefreshOptions {
  // 앱이 가진 지도 버전 (요청에 넣는 map_version)
  mapVersion: string
  // 서버의 최신 지도 버전을 읽는다. 예: GET /maps의 version, GET /maps/{id}/graph의 map_version
  refresh: () => Promise<string>
  // 새 버전을 받았을 때 부른다. 앱이 가진 지도 데이터도 이 버전으로 다시 받아야 한다
  onRefresh?: (mapVersion: string) => void
}

const isMapVersionMismatch = (e: unknown) => isApiError(e) && e.code === 'MAP_VERSION_MISMATCH'

// map_version을 보내는 요청(POST /localizations, /routes)을 감싼다 (backend/app/api/deps.py check_map_version).
// 같은 코드는 세션을 시작한 뒤 서버 지도가 바뀐 경우(deps.py map_of)에도 오는데, 이때는 버전을 바꿔 보내도 다시 실패한다.
// 그 실패는 그대로 던지고, recoveryFor가 세션 종료(map_changed)로 바꾼다.
export async function withMapVersionRefresh<T>(
  send: (mapVersion: string) => Promise<T>,
  { mapVersion, refresh, onRefresh }: MapVersionRefreshOptions,
): Promise<T> {
  let mismatch: unknown
  try {
    return await send(mapVersion)
  } catch (error) {
    if (!isMapVersionMismatch(error)) throw error
    mismatch = error
  }
  const latest = await refresh()
  // 서버 버전과 이미 같다면 앱의 버전 문제(check_map_version)가 아니라 세션의 지도가 바뀐 경우(map_of)라 다시 보내지 않는다.
  if (latest === mapVersion) throw mismatch
  onRefresh?.(latest)
  return send(latest)
}
