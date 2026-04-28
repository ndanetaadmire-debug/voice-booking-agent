import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES, SalonCalendar } from "../src/calendar.js";
import { type Action, type CallState, step, type Turn } from "../src/dialogue.js";

const TODAY = { y: 2026, m: 11, d: 14 };
const fresh = (): CallState => ({ callSid: "CA1", from: "+27821234567", step: "service", misses: 0 });
const say = (speech: string, confidence = 0.9): Turn => ({ speech, confidence });

function converse(turns: Turn[], cal = new SalonCalendar(DEFAULT_SERVICES), start = fresh()) {
  let state = start;
  const actions: Action[] = [];
  for (const t of turns) {
    const r = step(state, t, cal, TODAY);
    state = r.state;
    actions.push(r.action);
  }
  return { state, actions, cal, last: actions.at(-1)! };
}

describe("booking conversations", () => {
  it("happy path, one slot per turn", () => {
    const { last, cal, actions } = converse([say("braids please"), say("Tuesday"), say("at 10 am"), say("my name is Thandi"), say("yes")]);
    expect(actions[3]).toMatchObject({ kind: "ask", say: expect.stringMatching(/box braids on Tuesday, 17 November at 10 o'clock in the morning.*R900/) });
    expect(last).toMatchObject({ kind: "booked" });
    expect(cal.bookings[0]).toMatchObject({ service: "braids", time: { h: 10, min: 0 }, name: "Thandi", phone: "+27821234567" });
  });

  it("fills several slots from one sentence", () => {
    const { actions } = converse([say("Can I get a wig install on Monday at half past two"), say("Lerato")]);
    expect(actions[0]).toMatchObject({ say: expect.stringMatching(/your name/) });
    expect(actions[1]).toMatchObject({ say: expect.stringMatching(/wig install on Monday, 16 November at half past 2 in the afternoon/) });
  });

  it("offers nearest alternatives when the slot is taken, and respects business hours", () => {
    const cal = new SalonCalendar(DEFAULT_SERVICES);
    cal.book({ callSid: "other", service: "trim", date: { y: 2026, m: 11, d: 17 }, time: { h: 10, min: 0 }, name: "X", phone: "" });
    const taken = converse([say("a trim on Tuesday at 10am")], cal);
    expect(taken.last.kind === "ask" && taken.last.say).toMatch(/isn't available\. I can do half past 9 in the morning or half past 10 in the morning/);

    const sunday = converse([say("a trim tomorrow at 10am")]); // closed Sundays
    expect(sunday.last.kind === "ask" && sunday.last.say).toMatch(/fully booked for a trim on Sunday, 15 November/);
  });

  it("re-prompts on low ASR confidence, then offers the keypad, then hands off", () => {
    const { actions } = converse([say("mmrrbl", 0.2), say("", 0), say("??", 0.1)]);
    expect(actions[0]).toMatchObject({ kind: "ask", say: expect.stringMatching(/didn't catch/) });
    expect(actions[1]).toMatchObject({ kind: "ask", dtmf: true, say: expect.stringMatching(/Press 1 for wash and blow dry/) });
    expect(actions[2]).toMatchObject({ kind: "transfer", reason: "asr_failures" });
  });

  it("accepts keypad input", () => {
    const { state } = converse([{ speech: "", confidence: 0, digits: "2" }]);
    expect(state.service).toBe("braids");
  });

  it("caller can reach a human at any point", () => {
    expect(converse([say("braids"), say("can I talk to a real person")]).last).toMatchObject({ kind: "transfer", reason: "caller_request" });
    expect(converse([{ speech: "", confidence: 0, digits: "0" }]).last.kind).toBe("transfer");
  });

  it("'no' at confirmation lets the caller change the day", () => {
    const { last, state } = converse([say("trim"), say("Tuesday"), say("10 am"), say("Sipho"), say("no, wrong day")]);
    expect(last).toMatchObject({ say: expect.stringMatching(/Which day/) });
    expect(state.date).toBeUndefined();
  });

  it("handles a race: slot taken between confirm and commit", () => {
    const cal = new SalonCalendar(DEFAULT_SERVICES);
    const before = converse([say("trim"), say("Tuesday"), say("10 am"), say("Sipho")], cal);
    cal.book({ callSid: "rival", service: "trim", date: { y: 2026, m: 11, d: 17 }, time: { h: 10, min: 0 }, name: "R", phone: "" });
    const after = step(before.state, say("yes"), cal, TODAY);
    expect(after.action).toMatchObject({ kind: "ask", say: expect.stringMatching(/just taken/) });
  });

  it("booking is idempotent per call (webhook retries)", () => {
    const cal = new SalonCalendar(DEFAULT_SERVICES);
    const args = { callSid: "CA9", service: "trim", date: { y: 2026, m: 11, d: 17 }, time: { h: 11, min: 0 }, name: "A", phone: "" };
    expect(cal.book(args).id).toBe(cal.book(args).id);
    expect(cal.bookings).toHaveLength(1);
  });
});
