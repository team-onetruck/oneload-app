# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The shipped product is planned as a native mobile app (Unity + AR Foundation). This repository's web build is the demo client: a mobile-sized web app that calls the same backend API and shows 2D step-by-step guidance instead of AR arrows.

## Stack

React + TypeScript + Vite (from the team system design draft). Prototype uses in-memory mock data; no backend calls yet.

## Users

- Primary: foreign tourists at Seoul Station who do not know Korean transit conventions (ticket machines, gates, train types, deposit refunds) and are often carrying luggage, in a hurry to reach Incheon Airport.
- Secondary: Korean visitors new to a large, complex station.
- Situation: standing inside the station, one hand on the phone, underground with unreliable GPS, reading signs they may not understand.

## Product Purpose

Hangil (한길) tells people where to go inside a transit hub and what to do once there, using camera photos and conversational AI. MVP task at Seoul Station: understand AREX all-stop vs express trains, pick one, confirm current location from a sign photo, walk to the matching ticket point, learn how to buy, then walk to the platform.

Success: the user reaches the right ticket point and platform without guessing, and never receives a confidently wrong location or invented fact.

## Positioning

Hangil never decides where you are on its own. It shows location candidates with the evidence it saw (sign text, exit numbers), and the user confirms. Answers about procedures cite verified sources; unknown fares, button positions, or routes are stated as unknown rather than invented. Routes use only registered, verified passages.

## Operating Context

- Representative flow: language choice → natural-language question → clarification (all-stop vs express) → destination set → sign photo → location candidates → user confirms → step-by-step route → ticket machine photo + question → purchase steps → platform guidance.
- Recovery: user says they went the wrong way or picks a wrong exit → relocate (new photo or manual pick) → reroute.
- Failure paths: no match on photo (retake guidance + manual choice), AI timeout (retry + manual choice).
- Evaluated by the PM and real users on task completion, time, and retakes.

## Capabilities and Constraints

- Korean and English, switchable mid-session.
- Photo upload or capture; images are processed and discarded, users are told to frame signs, not people.
- Hangil does not take payment or bookings; it may link to verified official pages.
- AR floor arrows exist only in the native app; the web demo shows 2D steps.
- Undecided: exact station nodes, ticket point locations, fares, official links. All prototype data is fictional and must be labeled as such.

## Brand Commitments

- Service name: 한길 (Hangil).

## Evidence on Hand

- Requirements spec v0.2, API/sequence spec v0.3, system design draft (backend repo, local only).
- No real station data, photos, fares, or testimonials yet. Do not fabricate them.

## Product Principles

1. Confirm before guiding: never start directions from an unconfirmed location.
2. Show the evidence: every location candidate and factual answer carries its basis.
3. Say "unknown" out loud: unverified numbers, places, or buttons are never invented.
4. Always offer a way out: retake, manual choice, or retry on every failure.
5. Same core flow in Korean and English.

## Accessibility & Inclusion

- Guidance never relies on color alone; text always accompanies status.
- Large tap targets for one-handed use while walking with luggage.
