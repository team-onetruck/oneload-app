// PROTOTYPE stand-in for POST /sessions/{id}/messages. Keyword rules replace
// the LLM, but replies keep the AgentResponse shape: status, chips, sources.
import { FLOOR_FACT, NODES, SOURCES } from './data'
import type { Lang, NodeId, PoiId, Source, Text, TrainType } from './data'

export type Intent =
  | 'airport'
  | 'express'
  | 'allstop'
  | 'notSure'
  | 'pay'
  | 'whatCard'
  | 'hasCard'
  | 'noCard'
  | 'recharge'
  | 'deposit'
  | 'pickList'
  | 'buy'
  | 'platform'
  | 'lost'
  | 'fare'
  | 'unknown'

export type Status = 'answered' | 'needs_clarification' | 'destination_set' | 'relocalize' | 'cannot_answer' | 'out_of_scope' | 'error'

export type Action = 'findMe' | 'startRoute' | 'retry' | 'pickDest'

export type Tip = 'tapCard' | 'buySingle' | 'expressPay'

export interface Chip {
  label: Text
  intent: Intent
}

export type Reply =
  | { kind: 'greet' }
  | { kind: 'trainTypes' }
  | { kind: 'notSure' }
  | { kind: 'askCard' }
  | { kind: 'pay' }
  | { kind: 'whatCard' }
  | { kind: 'recharge' }
  | { kind: 'destSet'; poi: PoiId; from: NodeId | null; tip: Tip | null }
  | { kind: 'fare' }
  | { kind: 'deposit' }
  | { kind: 'outOfScope' }
  | { kind: 'lost' }
  | { kind: 'buy'; train: TrainType; withPhoto: boolean }
  | { kind: 'error' }

export interface Rendered {
  status: Status
  body: string
  list?: string[]
  note?: string
  /** Practical advice for this destination, shown as a callout. */
  tip?: string
  /** Part of the answer the team has not verified on site yet. */
  unverified?: string
  sources?: Source[]
  chips?: Chip[]
  actions?: Action[]
}

const L = (en: string, ko: string): Text => ({ en, ko })

const CHIP = {
  airport: { label: L('Incheon Airport', '인천공항'), intent: 'airport' },
  pay: { label: L('How do I pay?', '돈은 어떻게 내요?'), intent: 'pay' },
  deposit: { label: L('Card deposit refund', '교통카드 보증금 환급'), intent: 'deposit' },
  express: { label: L('Express', '직통열차'), intent: 'express' },
  allstop: { label: L('All-stop', '일반열차'), intent: 'allstop' },
  notSure: { label: L('Not sure', '잘 모르겠어요'), intent: 'notSure' },
  hasCard: { label: L('I have a transit card', '교통카드 있어요'), intent: 'hasCard' },
  noCard: { label: L('I don’t have one', '없어요'), intent: 'noCard' },
  whatCard: { label: L('What’s a transit card?', '교통카드가 뭐예요?'), intent: 'whatCard' },
  recharge: { label: L('How do I top it up?', '충전은 어떻게 해요?'), intent: 'recharge' },
  buy: { label: L('How do I buy a ticket?', '승차권은 어떻게 사요?'), intent: 'buy' },
  platform: { label: L('Go to the platform', '승강장으로 가기'), intent: 'platform' },
} satisfies Record<string, Chip>

export function classify(raw: string): Intent {
  const s = raw.toLowerCase()
  // 영어 키워드는 단어 앞쪽 경계에서만 맞춘다. "express" 안의 "press"는 buy가 아니고, "tickets"처럼 뒤에 붙는 말은 그대로 맞는다.
  // 한국어는 조사가 바로 붙으므로 부분 문자열로 찾는다.
  const has = (...k: string[]) =>
    k.some((w) => (/^[\x20-\x7e]+$/.test(w) ? new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s) : s.includes(w)))
  if (has('fare', 'price', 'cost', 'how much', '요금', '얼마', '가격')) return 'fare'
  if (has('lost', 'wrong', '잘못', '길을 잃', '헤매')) return 'lost'
  if (has('recharge', 'top up', 'top-up', 'charge', '충전')) return 'recharge'
  if (has('deposit', 'refund', '보증금', '환급')) return 'deposit'
  if (has('t-money', 'tmoney', 'transit card', 'travel card', '교통카드', '티머니')) return 'whatCard'
  if (has('pay', 'cash', 'credit', 'money', 'card', '결제', '현금', '카드', '돈')) return 'pay'
  if (has('press', 'buy', 'purchase', 'ticket', '어떻게 사', '구매', '눌러', '표', '승차권')) return 'buy'
  if (has('platform', '승강장', '타는 곳')) return 'platform'
  if (has('express', '직통')) return 'express'
  if (has('all-stop', 'all stop', 'allstop', 'regular', 'local', '일반')) return 'allstop'
  if (has('airport', 'incheon', 'icn', 'arex', '공항', '인천')) return 'airport'
  if (has('not sure', "don't know", 'which', '모르', '뭐가 달라', '차이')) return 'notSure'
  return 'unknown'
}

export function render(r: Reply, lang: Lang): Rendered {
  const T = (en: string, ko: string) => (lang === 'en' ? en : ko)
  switch (r.kind) {
    case 'greet':
      return {
        status: 'answered',
        body: T(
          'Welcome to Seoul Station. I’m Hangil. Tell me where you’re going, or ask how tickets, cards and cash work here.',
          '서울역에 오신 걸 환영해요. 한길이에요. 어디로 가는지 말해주거나, 표·카드·현금을 어떻게 쓰는지 물어보세요.',
        ),
        chips: [CHIP.airport, CHIP.pay, CHIP.deposit],
        actions: ['pickDest'],
      }
    case 'trainTypes':
      return {
        status: 'needs_clarification',
        body: T('Two Airport Railroad (AREX) trains go to Incheon Airport. They are paid for differently:', '인천공항까지는 공항철도 열차가 두 종류예요. 내는 방법이 달라요.'),
        list: [
          T('Express: non-stop, every seat reserved. You buy a ticket.', '직통열차: 무정차, 전 좌석 지정석. 승차권을 사야 해요.'),
          T('All-stop: stops at every station. You tap a transit card, like the subway.', '일반열차: 모든 역에 정차. 지하철처럼 교통카드를 찍어요.'),
        ],
        note: T('Which one do you want?', '어떤 열차로 갈까요?'),
        sources: [SOURCES.trainTypes],
        chips: [CHIP.express, CHIP.allstop, CHIP.notSure],
      }
    case 'notSure':
      return {
        status: 'needs_clarification',
        body: T('A simple way to decide:', '이렇게 고르면 쉬워요.'),
        list: [
          T('Lots of luggage, or you want a guaranteed seat: Express.', '짐이 많거나 꼭 앉아서 가고 싶다면: 직통열차'),
          T('You have (or will get) a transit card and don’t mind stops: All-stop.', '교통카드가 있거나 살 거고, 정차해도 괜찮다면: 일반열차'),
        ],
        note: T('I don’t have verified fares or travel times, so I won’t compare them.', '확인된 요금·소요시간이 없어서 비교하지 않을게요.'),
        sources: [SOURCES.trainTypes],
        chips: [CHIP.express, CHIP.allstop],
      }
    case 'askCard':
      return {
        status: 'needs_clarification',
        body: T('For the All-stop train you tap a transit card at the gate. Do you have one, like T-money?', '일반열차는 개찰구에서 교통카드를 찍어요. 티머니 같은 교통카드가 있나요?'),
        sources: [SOURCES.allstopTicket],
        chips: [CHIP.hasCard, CHIP.noCard, CHIP.whatCard],
      }
    case 'pay':
      return {
        status: 'answered',
        body: T('It depends on the train:', '열차에 따라 달라요.'),
        list: [
          T('Express: buy a ticket at the counter or machine on B2. Card or cash.', '직통열차: B2 표 사는 곳(창구·발매기)에서 승차권 구매. 카드 또는 현금.'),
          T('All-stop with a transit card: just tap it at the gate on B3.', '일반열차 + 교통카드: B3 개찰구에서 카드만 찍으면 돼요.'),
          T('All-stop without a card: buy a single-journey ticket at the machine on B3.', '일반열차 + 카드 없음: B3 발매기에서 1회용 교통카드를 사요.'),
        ],
        unverified: T('Which machines here accept credit cards is not confirmed yet. Keep some cash (won) just in case.', '여기 발매기 중 신용카드가 되는 기계는 아직 확인 전이에요. 혹시 모르니 현금(원화)을 조금 준비하세요.'),
        sources: [SOURCES.arexFloors, SOURCES.expressTicket, SOURCES.allstopTicket],
        chips: [CHIP.express, CHIP.allstop, CHIP.whatCard],
      }
    case 'whatCard':
      return {
        status: 'answered',
        body: T('A transit card (T-money is the common one) is a rechargeable card for the subway, buses and the AREX All-stop train.', '교통카드(대표적으로 티머니)는 지하철·버스·공항철도 일반열차에 쓰는 충전식 카드예요.'),
        list: [
          T('Buy one at a convenience store or a station machine.', '편의점이나 역 발매기에서 살 수 있어요.'),
          T('Top it up with cash.', '현금으로 충전해요.'),
          T('Tap it when you enter and again when you leave.', '들어갈 때 한 번, 나올 때 한 번 찍어요.'),
        ],
        unverified: T('Where to buy one inside this part of Seoul Station is not registered yet.', '서울역 이 구역 안의 판매 위치는 아직 등록 전이에요.'),
        sources: [SOURCES.allstopTicket],
        chips: [CHIP.hasCard, CHIP.noCard, CHIP.recharge],
      }
    case 'recharge':
      return {
        status: 'answered',
        body: T('To top up a transit card:', '교통카드 충전 방법:'),
        list: [
          T('Find a recharge machine near the gates.', '개찰구 근처 충전기를 찾으세요.'),
          T('Put the card on the reader.', '카드를 올려놓으세요.'),
          T('Choose an amount and insert cash.', '금액을 고르고 현금을 넣으세요.'),
        ],
        unverified: T('I can’t confirm card payment for top-ups here. Plan on cash.', '여기서 카드로 충전되는지는 확인할 수 없어요. 현금을 준비하세요.'),
        sources: [SOURCES.allstopTicket],
        chips: [CHIP.airport],
      }
    case 'destSet': {
      const dest = NODES[r.poi].name[lang]
      const tip =
        r.tip === 'tapCard'
          ? T('No ticket needed: tap your card at the All-stop gate.', '표는 필요 없어요. 일반열차 개찰구에서 카드를 찍으세요.')
          : r.tip === 'buySingle'
            ? T('At the machine, choose Single journey. It may only take cash, so have some won ready.', '발매기에서 1회용 교통카드를 고르세요. 현금만 될 수 있으니 원화를 준비하세요.')
            : r.tip === 'expressPay'
              ? T('You can pay by card or cash at the counter.', '창구에서 카드나 현금으로 낼 수 있어요.')
              : null
      const floor = FLOOR_FACT[r.poi][lang]
      const sources = [SOURCES.arexFloors]
      if (r.from)
        return {
          status: 'destination_set',
          body: T(`Got it: ${dest}. ${floor} You’re at ${NODES[r.from].name.en}, so we can go now.`, `${dest}(으)로 안내할게요. ${floor} 지금 ${NODES[r.from].name.ko}에 있으니 바로 출발할 수 있어요.`),
          tip: tip ?? undefined,
          sources,
          actions: ['startRoute'],
        }
      return {
        status: 'destination_set',
        body: T(`I’ll take you to the ${dest}. ${floor}`, `${dest}(으)로 안내할게요. ${floor}`),
        tip: tip ?? undefined,
        note: T('First, take a photo of a nearby sign. I’ll show what I recognise and you confirm.', '먼저 주변 안내판을 찍어주세요. 알아본 내용을 보여드리면 직접 확인해주세요.'),
        sources,
        actions: ['findMe'],
      }
    }
    case 'fare':
      return {
        status: 'cannot_answer',
        body: T('I don’t have a verified fare, so I won’t guess. Fares change.', '확인된 요금 정보가 없어서 추측하지 않을게요. 요금은 바뀔 수 있어요.'),
        note: T('The price is shown on the ticket machine screen, or ask at the counter.', '발매기 화면에 가격이 나오고, 창구에서도 물어볼 수 있어요.'),
        chips: [CHIP.pay, CHIP.airport],
      }
    case 'deposit':
      return {
        status: 'answered',
        body: T('A single-journey ticket has a deposit you get back after your trip:', '1회용 교통카드는 보증금이 있고, 이용 후 돌려받을 수 있어요.'),
        list: [
          T('Find a deposit refund machine near the gates where you get off.', '내린 역 개찰구 근처의 보증금 환급기를 찾으세요.'),
          T('Put the card in the slot.', '카드를 투입구에 넣으세요.'),
          T('Take the coins that come out.', '나오는 동전을 받으세요.'),
        ],
        unverified: T('Refund machine locations aren’t registered in this map yet, so I can’t guide you to one.', '환급기 위치는 아직 지도에 없어서 길안내는 할 수 없어요.'),
        sources: [SOURCES.deposit],
        chips: [CHIP.airport],
      }
    case 'outOfScope':
      return {
        status: 'out_of_scope',
        body: T('Right now I cover the Airport Railroad at Seoul Station: tickets, cards, cash and the way to the platform. Try one of these:', '지금은 서울역 공항철도 구역을 도와드려요. 표·카드·현금, 승강장 가는 길을 물어보세요.'),
        chips: [CHIP.airport, CHIP.pay, CHIP.whatCard],
        actions: ['pickDest'],
      }
    case 'lost':
      return {
        status: 'relocalize',
        body: T('No problem. I won’t assume where you are; let’s check again.', '괜찮아요. 위치를 짐작하지 않고 다시 확인할게요.'),
        actions: ['findMe'],
      }
    case 'buy': {
      const express = r.train === 'express'
      const seen = r.withPhoto ? T('I can see a ticket machine screen in your photo. ', '사진에서 발매기 화면이 보여요. ') : ''
      return {
        status: 'answered',
        body: seen + (express ? T('To buy an Express ticket:', '직통열차 승차권은 이렇게 사요.') : T('For the All-stop train without a transit card:', '교통카드 없이 일반열차를 탈 때는:')),
        list: express
          ? [
              T('Switch the screen to English if needed.', '필요하면 화면 언어를 바꾸세요.'),
              T('Choose Express train.', '직통열차를 선택하세요.'),
              T('Choose how many people.', '인원을 선택하세요.'),
              T('Pay by card or cash, then take your ticket.', '카드나 현금으로 결제하고 승차권을 받으세요.'),
            ]
          : [
              T('Switch the screen to English.', '화면 언어를 바꾸세요.'),
              T('Choose Single journey ticket.', '1회용 교통카드를 고르세요.'),
              T('Choose Incheon Airport as your destination.', '목적지로 인천공항을 고르세요.'),
              T('Insert cash and take the card.', '현금을 넣고 카드를 받으세요.'),
            ],
        unverified: T('Exact button names and positions aren’t verified. If the screen looks different, ask the staff nearby.', '버튼 이름과 위치는 확인 전이에요. 화면이 다르면 근처 직원에게 물어보세요.'),
        sources: [express ? SOURCES.expressTicket : SOURCES.allstopTicket],
        chips: [CHIP.platform],
      }
    }
    case 'error':
      return {
        status: 'error',
        body: T('Hangil couldn’t answer in time. Nothing was lost.', '한길이 제시간에 답하지 못했어요. 대화 내용은 그대로예요.'),
        actions: ['retry', 'pickDest'],
      }
  }
}
