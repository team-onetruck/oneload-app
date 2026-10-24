/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 서버 연결 화면의 카메라 안내 E2E. 모조 카메라와 흉내 낸 나침반 이벤트로 카메라 탭의 시작 안내, 화살표 방향, 방향이 흔들릴 때의 안내, 다른 탭으로 돌아갈 때 카메라 해제를 확인한다
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { GraphOut, RouteOut } from '../../src/api/types'
import { interceptApi, signPhoto } from '../support/mockApi'

// 크롬의 모조 카메라 장치를 쓰고 권한 창은 자동으로 허용한다 (실제 카메라 없이 getUserMedia가 영상을 준다).
// 방향 센서 권한도 미리 허용해 둔다: 크롬은 DeviceOrientationEvent.requestPermission이 있을 때 이 권한을 본다
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera', 'accelerometer', 'gyroscope', 'magnetometer'],
})

// 실제 HTTP 어댑터와 가로챈 서버 응답으로 첫 경로 단계까지 간다
async function reachRoute(page: Page) {
  const api = await interceptApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await line4.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'Express ticket counter' })).toBeVisible()
  return api
}

// 폰이 heading 방위를 향한 것처럼 deviceorientationabsolute를 계속 쏜다. 폰을 세워 든 자세(beta 90)에서 alpha = 360 - heading
async function aimPhone(page: Page, headings: number[]) {
  await page.evaluate((list) => {
    const w = window as unknown as { __aim?: number }
    clearInterval(w.__aim)
    let i = 0
    w.__aim = window.setInterval(() => {
      const heading = list[i++ % list.length]
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: (360 - heading) % 360, beta: 90, gamma: 0, absolute: true }))
    }, 40)
  }, headings)
}

const wrap = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180

test('카메라 안내: 카메라를 켜면 폰이 향한 방향에 맞춰 화살표가 돈다', async ({ page }) => {
  const api = await reachRoute(page)

  await page.getByRole('tab', { name: 'Camera' }).click()
  // 권한을 요청하기 전에 무엇을 하는지, 영상이 밖으로 나가지 않는다는 것을 먼저 알려 준다
  await expect(page.getByText('Point your camera ahead', { exact: false })).toBeVisible()
  await expect(page.getByText('never sent anywhere', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Turn on camera' }).click()

  await expect(page.locator('video.live-video')).toBeVisible()
  await expect(page.getByText('Location confirmed')).toBeVisible()
  await expect(page.getByText('Direction guide only', { exact: false })).toBeVisible()

  // 북쪽(0°)과 동쪽(90°)을 번갈아 보며 화살표 회전량이 (목표 방위 - 폰 방위)를 따르는지 본다
  const route = api.calls.find((call) => call.path === '/sessions/{id}/routes')!
  const step = (route.response as RouteOut).steps[0]
  const graph = api.calls.find((call) => call.path.endsWith('/graph'))!.response as GraphOut
  const targetHeading = graph.edges.find((edge) => edge.from === step.from_node_id && edge.to === step.to_node_id)!.heading_deg
  const arrow = page.locator('.live-arrow')
  for (const heading of [0, 90]) {
    await aimPhone(page, [heading])
    await expect(arrow).toBeVisible()
    await expect(arrow).toHaveAttribute('data-turn', String(Math.round(wrap(targetHeading - heading))))
  }
  await expect(page.locator('.live-hint')).toBeVisible()

  await expect(page.locator('.live-debug')).toHaveCount(0)
})

test('카메라 안내: 방향이 마구 흔들리면 화살표를 숨기고 이유를 말한다', async ({ page }) => {
  await reachRoute(page)
  await page.getByRole('tab', { name: 'Camera' }).click()
  await page.getByRole('button', { name: 'Turn on camera' }).click()
  await expect(page.locator('video.live-video')).toBeVisible()

  await aimPhone(page, [0, 120, 240, 60, 180, 300])
  await expect(page.getByText('Direction is unsteady', { exact: false })).toBeVisible()
  await expect(page.locator('.live-arrow')).toHaveCount(0)

  // 다시 안정되면 화살표가 돌아온다
  await aimPhone(page, [45])
  await expect(page.locator('.live-arrow')).toBeVisible()
})

test('카메라 안내: 방향 센서가 없는 기기는 화살표 없이 안내를 따르게 한다', async ({ page }) => {
  await reachRoute(page)
  await page.getByRole('tab', { name: 'Camera' }).click()
  await page.getByRole('button', { name: 'Turn on camera' }).click()
  await expect(page.locator('video.live-video')).toBeVisible()
  // 방향 이벤트를 하나도 보내지 않는다: 잠시 읽는 중이다가 센서 없음으로 바뀐다
  await expect(page.getByText('Reading direction', { exact: false })).toBeVisible()
  await expect(page.getByText('can’t read direction', { exact: false })).toBeVisible({ timeout: 6000 })
  await expect(page.locator('.live-arrow')).toHaveCount(0)
})

test('카메라 안내: 다른 탭으로 가면 카메라를 끈다', async ({ page }) => {
  await reachRoute(page)
  await page.getByRole('tab', { name: 'Camera' }).click()
  await page.getByRole('button', { name: 'Turn on camera' }).click()
  await expect(page.locator('video.live-video')).toBeVisible()
  // 켜진 영상 트랙 수를 센다
  const liveTracks = () =>
    page.evaluate(() => {
      const v = document.querySelector('video.live-video') as HTMLVideoElement | null
      return (v?.srcObject as MediaStream | null)?.getTracks().filter((t) => t.readyState === 'live').length ?? -1
    })
  expect(await liveTracks()).toBeGreaterThan(0)
  // 해제 여부를 보려고 트랙을 미리 잡아 둔다
  await page.evaluate(() => {
    const v = document.querySelector('video.live-video') as HTMLVideoElement
    ;(window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = (v.srcObject as MediaStream).getTracks()
  })
  await page.getByRole('tab', { name: 'Line' }).click()
  await expect(page.locator('video.live-video')).toHaveCount(0)
  const states = await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.map((t) => t.readyState))
  expect(states.every((s) => s === 'ended')).toBe(true)
})
