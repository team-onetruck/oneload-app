/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 메뉴에 보여 줄 언어 목록과, 시작할 때 기기 언어로 화면 언어를 정하는 함수
 */
import type { Lang } from '../../data'

// 각 언어는 자기 언어로 적는다. 다국어 팩이 늘면 여기에 한 줄씩 더하면 메뉴에 나타난다
export const LANGUAGE_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
]

// 기기 언어 목록(우선순위 순)에서 앱이 지원하는 첫 언어를 고른다. 하나도 없으면 영어다
export function detectDeviceLang(preferred: readonly string[] | undefined = typeof navigator === 'undefined' ? undefined : navigator.languages): Lang {
  for (const tag of preferred ?? []) {
    const base = tag.toLowerCase().split('-')[0]
    const found = LANGUAGE_OPTIONS.find((o) => o.code === base)
    if (found) return found.code
  }
  return 'en'
}
