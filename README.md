# 한길 (Hangil) web prototype

Clickable, phone-sized prototype of the Hangil demo client for the Seoul Station / AREX scenario: a foreign visitor who doesn't know how tickets, transit cards and cash work, gets to the right ticket point and platform.

**Prototype only.** All replies, photo recognition and routes are in-memory mocks shaped like the backend contracts (`/api/v1` messages, localizations, routes). Nothing calls a server yet.

- Floors of AREX ticket points (B2 express, B3 all-stop) and platforms (B7) follow the [AREX official guide](https://www.airportrailroad.com/co/steUsfGud.do), checked 2026-10-22.
- Passages, distances, sign wording and "demo doc" sources are placeholders until the field survey.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static files in dist/
```

Desktop shows a 390×844 phone frame; on a phone it fills the screen.

## Demo controls

The **Demo** pill (top of the frame; a slim tab on the right edge on phones) shows the session state machine and lets you:

- make the next AI request time out (error + retry path),
- choose what an uploaded photo resolves to (match / KTX hall / no match),
- reset the demo.

## Scenario map

| Flow | Try |
| --- | --- |
| Payment questions | "How do I pay?", "What's a transit card?", "Can I pay with a credit card?" |
| Express | Incheon Airport → Express → photo → B2 counter → how to buy → B7 platform |
| All-stop, no card | All-stop → "I don't have one" → B3 machines (single-journey ticket) |
| All-stop, has card | All-stop → "I have a transit card" → straight to B3 gates → B7 |
| Refusals | "How much is the fare?" → no guessing |
| Recovery | Blurry photo → retake / choose on list; "I'm lost" on the route |
