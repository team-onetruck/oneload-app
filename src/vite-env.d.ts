/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 앱이 쓰는 Vite 환경변수 타입 선언
 */
export {}

declare global {
  interface ImportMetaEnv {
    // API 기본 주소. 비우면 같은 origin의 /api/v1 (배포에서는 Caddy가 /api/*를 백엔드로 넘긴다)
    readonly VITE_API_BASE_URL?: string
  }

  // vite.config.ts의 define이 package.json version으로 채운다. 세션 생성의 client.app_version에 쓴다.
  const __APP_VERSION__: string
}
