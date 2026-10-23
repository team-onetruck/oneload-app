/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 일반열차 + 교통카드 없음 시나리오 E2E. 카드가 없다고 답하면 일반열차 표 사는 곳(발매기)으로 안내되는지, 서버에 간 요청 순서와 핵심 필드를 확인한다
 */
import { expect, test } from '@playwright/test'
import { interceptApi, signPhoto } from '../support/mockApi'

test('일반열차 + 카드 없음: 발매기를 목적지로 정하고 사진 후보로 위치를 확정해 서버 경로를 따라간다', async ({ page }) => {
  const api = await interceptApi(page)
  await page.goto('/')

  await page.getByRole('button', { name: 'Start' }).click()
  await page.getByRole('button', { name: 'Incheon Airport' }).click()
  await page.getByRole('button', { name: 'All-stop', exact: true }).click()
  await expect(page.getByText('Do you have one, like T-money?')).toBeVisible()
  await page.getByRole('button', { name: "I don't have one" }).click()
  await expect(page.getByText('At the machine, choose Single journey.', { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Find where I am' }).click()
  await page.locator('label', { hasText: 'Take a photo' }).locator('input[type=file]').setInputFiles(await signPhoto(page))
  await expect(page.getByRole('heading', { name: 'Is this where you are?' })).toBeVisible()
  const line4 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /Line 4 Seoul Station gates/ }) })
  await line4.getByRole('button', { name: 'I’m here' }).click()

  await expect(page.getByRole('heading', { name: 'All-stop ticket machines' })).toBeVisible()
  await expect(page.getByText('Go down one more floor to B3 for all-stop tickets.')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'I’m here' }).click()
  await expect(page.getByRole('heading', { name: 'You’ve arrived' })).toBeVisible()
  // 표 사는 곳에 도착했으므로 표 사는 법을 이어서 물을 수 있다
  await expect(page.getByRole('button', { name: 'How do I buy a ticket?' })).toBeVisible()

  await expect.poll(api.eventTypes).toEqual(['navigation_started', 'arrived'])
  const sent = api.mutations()
  expect(sent.map((c) => `${c.method} ${c.path} ${c.status}`)).toEqual([
    'POST /sessions 201',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/messages 200',
    'POST /sessions/{id}/localizations 200',
    'POST /sessions/{id}/location-confirmations 200',
    'POST /sessions/{id}/routes 200',
    'POST /sessions/{id}/navigation-events 200',
    'POST /sessions/{id}/navigation-events 200',
  ])
  const [, airport, allstop, noCard, , confirm, route] = sent
  expect([airport.body, allstop.body, noCard.body]).toEqual([{ message: 'Incheon Airport' }, { message: 'All-stop' }, { message: "I don't have one" }])
  expect(allstop.response).toMatchObject({ status: 'needs_clarification', slots: { train_type: 'allstop', has_transit_card: 'unknown' } })
  expect(noCard.response).toMatchObject({
    destination: { poi_id: 'poi-allstop-tickets' },
    slots: { train_type: 'allstop', has_transit_card: 'no' },
    session: { state: 'needs_location' },
  })
  expect(confirm.body).toMatchObject({ method: 'photo_candidate', selected_node_id: 'line4-gates' })
  expect(route.body).toMatchObject({ destination_poi_id: 'poi-allstop-tickets' })
  expect(route.response).toMatchObject({ path_node_ids: ['line4-gates', 'arex-concourse', 'allstop-tickets'] })
})
