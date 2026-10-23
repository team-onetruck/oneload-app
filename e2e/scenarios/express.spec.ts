/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 직통열차 시나리오 E2E. 인천공항 → 직통열차 → 사진 후보로 위치 확정 → 서버 경로로 표 사는 곳 도착까지, 서버에 간 요청 순서와 핵심 필드를 확인한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi, signPhoto } from '../support/mockApi'

test('직통열차: 사진 후보로 위치를 확정하고 서버 경로를 따라 표 사는 곳에 도착한다', async ({ page }) => {
  const api = await interceptApi(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'Express', exact: true }).click()
  await expect(page.getByText('You can pay by card or cash at the counter.')).toBeVisible()

  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))

  // 사진 결과는 후보일 뿐이다. 사용자가 고른 후보만 확정한다
  await expect(page.getByRole('heading', { name: 'Is this where you are?' })).toBeVisible()
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await line4.getByRole('button', { name: 'I’m here' }).click()

  await expect(page.getByRole('heading', { name: 'Express ticket counter' })).toBeVisible()
  await expect(page.getByText('Follow the “Airport Railroad” transfer signs, then go down to B2.')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'You’ve arrived' })).toBeVisible()

  // 도착 이벤트는 화면을 막지 않고 보내므로 다 갈 때까지 기다린다
  await expect.poll(api.eventTypes).toEqual(['navigation_started', 'arrived'])
  const sent = api.mutations()
  expect(sent.map((c) => `${c.method} ${c.path} ${c.status}`)).toEqual([
    'POST /sessions 201',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/localizations 200',
    'POST /sessions/{id}/location-confirmations 200',
    'POST /sessions/{id}/routes 200',
    'POST /sessions/{id}/navigation-events 200',
    'POST /sessions/{id}/navigation-events 200',
  ])
  const [session, airport, express, photo, confirm, route, ...events] = sent
  expect(session.body).toMatchObject({ language: 'en', map_id: 'seoul-station' })
  // 칩은 라벨을 문장으로 보낸다. 이 답변들에는 고른 POI가 없어서 selected_poi_id를 보내지 않는다
  expect(airport.body).toEqual({ message: 'Incheon Airport' })
  expect(express.body).toEqual({ message: 'Express' })
  expect(express.response).toMatchObject({ destination: { poi_id: 'poi-express-tickets' }, session: { state: 'needs_location' } })
  expect(photo.body).toMatchObject({ map_version: '2026-10-22.1', image: { type: 'image/jpeg' } })
  expect(confirm.body).toMatchObject({
    method: 'photo_candidate',
    localization_id: (photo.response as { localization_id: string }).localization_id,
    selected_node_id: 'line4-gates',
    expected_revision: (photo.response as { session: { revision: number } }).session.revision,
  })
  expect(route.body).toMatchObject({
    destination_poi_id: 'poi-express-tickets',
    expected_revision: (confirm.response as { session: { revision: number } }).session.revision,
  })
  expect(route.response).toMatchObject({ path_node_ids: ['line4-gates', 'arex-concourse', 'express-tickets'] })
  const routeId = (route.response as { route_id: string }).route_id
  for (const e of events) expect(e.body).toMatchObject({ route_id: routeId })

  const sessionId = (session.response as { session_id: string }).session_id
  expect(api.backend.session(sessionId)).toMatchObject({ state: 'arrived', confirmedNodeId: 'express-tickets' })
})
