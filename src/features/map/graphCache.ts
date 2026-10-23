/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 지도 그래프(GET /maps/{map_id}/graph)를 지도마다 한 번만 받아 위치 직접 선택과 경로 화면이 함께 쓰게 하는 캐시
 */
import type { GraphOut } from '../../api/types'

export interface GraphCache {
  // 같은 지도면 진행 중이거나 받아 둔 요청을 그대로 돌려준다
  get(mapId: string): Promise<GraphOut>
  clear(): void
}

export function createGraphCache(load: (mapId: string) => Promise<GraphOut>): GraphCache {
  let entry: { mapId: string; promise: Promise<GraphOut> } | null = null
  return {
    get(mapId) {
      if (entry?.mapId === mapId) return entry.promise
      const promise = load(mapId)
      entry = { mapId, promise }
      // 실패한 요청은 남기지 않는다. 다시 시도하면 새로 받는다.
      promise.catch(() => {
        if (entry?.promise === promise) entry = null
      })
      return promise
    },
    clear() {
      entry = null
    },
  }
}
