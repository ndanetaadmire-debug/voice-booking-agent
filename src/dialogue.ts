import { type SalonCalendar } from "./calendar.js";
import {
  isNo, isYes, type LocalDate, type LocalTime, matchService, parseDate, parseName, parseTime, speakDate, speakTime, wantsHuman,
} from "./nlu.js";

export type Step = "service" | "date" | "time" | "name" | "confirm" | "done" | "handoff";

export interface CallState {
  callSid: string;
  from: string;
  step: Step;
  service?: string;
  date?: LocalDate;
  time?: LocalTime;
  name?: string;
  misses: number; // consecutive turns we couldn't understand
  bookingId?: string;
}

export interface Turn {
  speech: string;
  confidence: number; // ASR confidence 0..1
  digits?: string; // DTMF keypad input
}

export type Action =
  | { kind: "ask"; say: string; dtmf?: boolean }
  | { kind: "booked"; say: string; bookingId: string }
  | { kind: "transfer"; say: string; reason: string }
  | { kind: "hangup"; say: string };

const MIN_CONFIDENCE = 0.55;
const MAX_MISSES = 2;

export const GREETING = "Hi, thanks for calling Lwazi Hair Studio. I can book you in. What would you like done today? For example a wig install, braids or a wash and blow dry.";

/**
 * Slot-filling state machine. Pure: (state, turn) → (state, action). No I/O, so every
 * conversational path is unit-testable without a phone. Design rules for voice:
 *  - fill multiple slots from one utterance ("braids tomorrow at 10")
 *  - never repeat the same prompt verbatim after a miss; rephrase, then offer the keypad
 *  - always confirm before committing; read back date and time naturally
 *  - an exit to a human is always one sentence away
 */
export function step(state: CallState, turn: Turn, cal: SalonCalendar, today: LocalDate): { state: CallState; action: Action } {
  const s: CallState = { ...state };
  const text = turn.speech ?? "";

  if (wantsHuman(text) || turn.digits === "0") return transfer(s, "Of course, connecting you to reception now.", "caller_request");

  const lowConfidence = !turn.digits && (turn.confidence < MIN_CONFIDENCE || !text.trim());
  if (!lowConfidence) {
    // Opportunistically fill any slot mentioned, whatever we asked for.
    s.service ??= matchService(text, cal.services) ?? (turn.digits && s.step === "service" ? serviceByDigit(cal, turn.digits) : undefined);
    if (!s.date) s.date = parseDate(text, today) ?? undefined;
    if (!s.time && (s.step === "time" || /\d|o'?clock|half|quarter|noon|am|pm/.test(text))) s.time = parseTime(text) ?? undefined;
    if (s.step === "name" && !s.name) s.name = parseName(text) ?? undefined;
  }

  if (s.step === "confirm" && !lowConfidence) {
    if (isYes(text) || turn.digits === "1") return commit(s, cal);
    if (isNo(text) || turn.digits === "2") {
      s.time = undefined;
      s.date = undefined;
      s.misses = 0;
      return ask(s, "date", "No problem. Which day would suit you instead?");
    }
  }

  const svc = cal.services.find((x) => x.id === s.service);
  const next: Step = !svc ? "service" : !s.date ? "date" : !s.time ? "time" : !s.name ? "name" : "confirm";

  if (next === s.step && s.step !== "confirm") {
    s.misses += 1;
    if (s.misses > MAX_MISSES) return transfer(s, "Sorry, I'm having trouble hearing you. Let me put you through to reception.", "asr_failures");
    return { state: s, action: reprompt(s, cal) };
  }
  s.misses = 0;

  // Validate the requested slot as soon as we have date + time.
  if (svc && s.date && s.time && !cal.isFree(s.date, s.time, svc.minutes)) {
    const alts = cal.alternatives(s.date, s.time, svc.minutes);
    const wanted = speakTime(s.time);
    const wantedDate = s.date;
    s.time = undefined;
    if (!alts.length) {
      s.date = undefined;
      return ask(s, "date", `Sorry, we're fully booked for a ${svc.names[0]} on ${speakDate(wantedDate)}. Which other day works for you?`);
    }
    return ask(s, "time", `${wanted} isn't available. I can do ${alts.map(speakTime).join(" or ")}. Which would you prefer?`);
  }

  switch (next) {
    case "service":
      return ask(s, "service", "What would you like done today?");
    case "date":
      return ask(s, "date", `Great, a ${svc!.names[0]}. Which day would you like to come in?`);
    case "time":
      return ask(s, "time", `And what time on ${speakDate(s.date!)}?`);
    case "name":
      return ask(s, "name", "Lovely, that time is free. May I have your name for the booking?");
    default:
      return ask(s, "confirm",
        `Thanks ${s.name}. That's a ${svc!.names[0]} on ${speakDate(s.date!)} at ${speakTime(s.time!)}, about ${Math.round(svc!.minutes / 60 * 10) / 10} hours, from R${svc!.priceRands}. Shall I book it? Say yes, or press 1.`);
  }
}

function commit(s: CallState, cal: SalonCalendar): { state: CallState; action: Action } {
  try {
    const b = cal.book({ callSid: s.callSid, service: s.service!, date: s.date!, time: s.time!, name: s.name!, phone: s.from });
    s.step = "done";
    s.bookingId = b.id;
    return { state: s, action: { kind: "booked", bookingId: b.id, say: `You're booked. We'll send an SMS confirmation to the number you're calling from. See you on ${speakDate(s.date!)}. Goodbye!` } };
  } catch {
    // Someone else took the slot while we were talking.
    s.time = undefined;
    return ask(s, "time", "Sorry, that slot was just taken. What other time would work for you?");
  }
}

function ask(s: CallState, stepName: Step, say: string): { state: CallState; action: Action } {
  s.step = stepName;
  return { state: s, action: { kind: "ask", say } };
}

function transfer(s: CallState, say: string, reason: string): { state: CallState; action: Action } {
  s.step = "handoff";
  return { state: s, action: { kind: "transfer", say, reason } };
}

function reprompt(s: CallState, cal: SalonCalendar): Action {
  // First miss: rephrase with an example. Second miss: offer the keypad (works when speech doesn't).
  const keypad = s.misses >= 2;
  switch (s.step) {
    case "service":
      return keypad
        ? { kind: "ask", dtmf: true, say: `You can also use your keypad. ${cal.services.map((x, i) => `Press ${i + 1} for ${x.names[0]}`).join(". ")}.` }
        : { kind: "ask", say: "Sorry, I didn't catch that. Are you after braids, a wig install, a trim or a wash and blow dry?" };
    case "date":
      return { kind: "ask", say: "Sorry, which day? You can say something like tomorrow, or Friday the twentieth." };
    case "time":
      return { kind: "ask", say: "Sorry, what time? For example, ten in the morning or half past two." };
    case "name":
      return { kind: "ask", say: "Sorry, could you say just your first name?" };
    default:
      return { kind: "ask", say: "Should I go ahead and book it? Please say yes or no, or press 1 for yes and 2 for no.", dtmf: true };
  }
}

function serviceByDigit(cal: SalonCalendar, digits: string): string | undefined {
  return cal.services[Number(digits) - 1]?.id;
}
