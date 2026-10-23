/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 경로 계산·길안내 이벤트 오류 코드를 사용자에게 보여 줄 한국어/영어 문구로 바꾼다
 */
import { isApiError } from '../../api/errors'
import type { ApiErrorCode } from '../../api/errors'
import type { Text } from '../../data'
import { UI } from '../../i18n'

const SESSION_ENDED: Text = { en: 'Your session ended. Please start over.', ko: '세션이 끝났어요. 처음부터 다시 시작해 주세요.' }
const OFFLINE: Text = {
  en: 'Couldn’t reach Hangil. Check your connection and try again.',
  ko: '한길 서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
}

// POST /routes와 /navigation-events가 돌려줄 수 있는 코드 (backend/app/api/routes.py, sessions.py, deps.py)
export const ROUTE_ERROR_TEXT: Partial<Record<ApiErrorCode, Text>> = {
  ROUTE_NOT_FOUND: UI.noRoute,
  LOCATION_NOT_CONFIRMED: { en: 'I need to check where you are first.', ko: '먼저 지금 위치를 확인해야 해요.' },
  // 세션 지도가 바뀐 경우와 앱 지도가 오래된 경우 모두 처음부터 다시 받는다
  MAP_VERSION_MISMATCH: { en: 'The station map was updated. Please start over.', ko: '역 지도가 업데이트됐어요. 처음부터 다시 시작해 주세요.' },
  POI_NOT_FOUND: {
    en: 'That destination isn’t on the verified map. Please choose it again.',
    ko: '확인된 지도에 없는 목적지예요. 목적지를 다시 골라 주세요.',
  },
  // /routes: 목적지가 /messages에서 정한 것과 다름, /navigation-events: route_id가 활성 경로가 아님
  INVALID_INPUT: { en: 'Your trip has changed. Please choose where to go again.', ko: '안내 정보가 바뀌었어요. 목적지를 다시 골라 주세요.' },
  INVALID_STATE: {
    en: 'Directions can’t continue from this step. Please try again.',
    ko: '지금 단계에서는 길안내를 이어갈 수 없어요. 다시 시도해 주세요.',
  },
  // navigation-state로 한 번 다시 맞춘 뒤에도 실패했을 때 보인다
  REVISION_CONFLICT: { en: 'Your trip changed in the meantime. Please try again.', ko: '그사이 진행 상태가 바뀌었어요. 다시 시도해 주세요.' },
  SESSION_UNAUTHORIZED: SESSION_ENDED,
  SESSION_EXPIRED: SESSION_ENDED,
  SESSION_FORBIDDEN: SESSION_ENDED,
  TIMEOUT: OFFLINE,
  NETWORK: OFFLINE,
}

export const ROUTE_ERROR_FALLBACK: Text = { en: 'Couldn’t load directions. Please try again.', ko: '길안내를 불러오지 못했어요. 다시 시도해 주세요.' }

// 서버 message는 개발용 영어 문장이라 화면에 그대로 쓰지 않는다. 모르는 오류는 일반 문구로 보여 준다.
export function routeErrorText(error: unknown): Text {
  return (isApiError(error) && ROUTE_ERROR_TEXT[error.code]) || ROUTE_ERROR_FALLBACK
}
