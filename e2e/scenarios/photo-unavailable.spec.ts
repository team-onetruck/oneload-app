/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 사진 인식 503 시나리오 E2E. 503 AI_SERVICE_UNAVAILABLE이면 위치를 추측하지 않고 직접 선택으로 넘어가, 고른 위치로 확정하고 서버 경로를 받는지 확인한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi, signPhoto } from '../support/mockApi'

test('사진 503: 직접 선택 목록에서 고른 위치로 확정하고 서버 경로로 안내를 시작한다', async ({ page }) => {
  const api = await interceptApi(page)
  // 지금 실서버와 같다: 사진 인식이 연결되지 않아 항상 503
  api.backend.setVision('unavailable')
  await page.goto('/')

  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))

  // 오류 알림 없이 직접 선택 화면으로 넘어가고, 왜 넘어왔는지 한 줄로 알린다
  await expect(page.getByRole('heading', { name: 'Where are you?' })).toBeVisible()
  await expect(page.getByText('Photo recognition isn’t available right now. Please choose where you are from the list.')).toBeVisible()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.getByRole('button', { name: /KTX hall \(Seoul Station\)/ }).click()

  await expect(page.getByRole('heading', { name: 'Express ticket counter' })).toBeVisible()
  await expect(page.getByText('Follow the blue “Airport Railroad” signs and take the escalators down to B2.')).toBeVisible()

  await expect.poll(api.eventTypes).toEqual(['navigation_started'])
  const sent = api.mutations()
  expect(sent.map((c) => `${c.method} ${c.path} ${c.status}`)).toEqual([
    'POST /sessions 201',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/messages 200',
    // 503은 다시 보내지 않는다
    'POST /sessions/{id}/localizations 503',
    'POST /sessions/{id}/location-confirmations 200',
    'POST /sessions/{id}/routes 200',
    'POST /sessions/{id}/navigation-events 200',
  ])
  const [, , express, photo, confirm, route] = sent
  expect(photo.response).toMatchObject({ error: { code: 'AI_SERVICE_UNAVAILABLE', retryable: true } })
  // 503은 세션을 바꾸지 않으므로 확정 요청의 revision은 목적지를 정한 응답의 값 그대로다
  const revision = (express.response as { session: { revision: number } }).session.revision
  expect(confirm.body).toEqual({ expected_revision: revision, method: 'manual', selected_node_id: 'ktx-hall' })
  expect(route.body).toMatchObject({ destination_poi_id: 'poi-express-tickets' })
  expect(route.response).toMatchObject({ start_node_id: 'ktx-hall', path_node_ids: ['ktx-hall', 'arex-concourse', 'express-tickets'] })
})
