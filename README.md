# voice-booking-agent

[![CI](https://github.com/ndanetaadmire-debug/voice-booking-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/ndanetaadmire-debug/voice-booking-agent/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Twilio](https://img.shields.io/badge/Twilio-Voice-F22F46?logo=twilio&logoColor=white)
![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen)
![Tests](https://img.shields.io/badge/tests-38-blue)

**A phone receptionist for salons and clinics.** Callers ring, say what they want in their own words, and get booked into a real free slot, with the date and time read back naturally and a person one sentence away.

```
Agent:  Hi, thanks for calling Lwazi Hair Studio. What would you like done today?
Caller: Can I get a wig install on Monday at half past two?
Agent:  Lovely, that time is free. May I have your name for the booking?
Caller: Naledi.
Agent:  Thanks Naledi. That's a wig install on Monday, 16 November at half past 2 in the
        afternoon, about 1.5 hours, from R650. Shall I book it? Say yes, or press 1.
Caller: Yes please.
Agent:  You're booked. We'll send an SMS confirmation… Goodbye!
```

## Voice is a different UX problem

On a phone call there's no screen to fall back on, every second of latency is felt, and speech recognition mishears. The design follows from that.

| Problem | Approach |
|---|---|
| **Latency** | Understanding is deterministic: spoken dates ("the day after tomorrow", "the twentieth", "next Friday"), times ("half past two", "quarter to eleven in the morning", "14:30") and fuzzy service matching ("blow dri" → wash & blow dry). No LLM round-trip per turn. |
| **People say several things at once** | Slot filling picks up service, day and time from one sentence, whatever was asked. |
| **Misrecognition** | Low ASR confidence triggers a *rephrased* prompt with an example; the second miss offers the **keypad** (DTMF); the third hands off to reception. It never repeats the same sentence robotically. |
| **Booking something they didn't mean** | Always a natural read-back and explicit yes / press 1 before committing; "no" lets them change the day. |
| **Slot clashes** | Business hours, closed days and overlapping service durations are checked as soon as day and time are known; the **nearest free alternatives** are offered ("I can do half past 9 or half past 10"). |
| **Races** | If someone takes the slot between read-back and "yes", the caller is told and asked for another time. |
| **Webhook retries** | Bookings are **idempotent per CallSid**: a Twilio retry can't double-book. |
| **Forged webhooks** | Every request's `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params) is verified in constant time. |
| **Injection via speech** | Everything spoken back is XML-escaped in TwiML; names are validated. |
| **Wanting a person** | "Reception", "a real person" or pressing 0 transfers immediately, from any step. |

## Architecture

```
Twilio ──POST──▶ /voice/incoming ─▶ <Gather speech+dtmf> greeting
       ──POST──▶ /voice/turn     ─▶ step(state, turn) ─▶ <Gather> | <Dial reception> | <Say><Hangup>
       ──POST──▶ /voice/status   ─▶ clean up session
```

- `src/nlu.ts` — spoken date/time parsing, fuzzy service matching, yes/no/human intents, name parsing, natural read-back
- `src/dialogue.ts` — **pure** slot-filling state machine `(state, turn) → (state, action)`; every conversational path is unit-tested without a phone
- `src/calendar.ts` — booking port: hours, durations, overlaps, alternatives, idempotent booking
- `src/twilio.ts` — signature validation and an escaping TwiML builder
- `src/server.ts` — Fastify webhooks, per-call sessions with TTL

## Run

```bash
cp .env.example .env
npm ci && npm run dev
# Point your Twilio number's Voice webhook at https://<PUBLIC_BASE_URL>/voice/incoming
npm run ci        # typecheck + 38 tests + build
```

The tests run whole calls over signed webhooks, alongside table-driven checks of how people actually say dates and times. They caught a real bug in the "fully booked" message, which named the wrong day.

---

Built by **[Admire T. Ndaneta](https://admire-portfolio.vercel.app)**. MIT licensed.
