import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES, SalonCalendar } from "../src/calendar.js";
import { buildServer } from "../src/server.js";
import { twilioSignature, twiml, validTwilioRequest } from "../src/twilio.js";

const TOKEN = "test_auth_token";
const BASE = "https://voice.example.com";

function app() {
  const cal = new SalonCalendar(DEFAULT_SERVICES);
  return { cal, app: buildServer({ calendar: cal, authToken: TOKEN, publicBaseUrl: BASE, receptionNumber: "+27110000000", today: () => ({ y: 2026, m: 11, d: 14 }) }) };
}

async function post(a: ReturnType<typeof app>["app"], path: string, params: Record<string, string>, sign = true) {
  const body = new URLSearchParams(params).toString();
  return a.inject({
    method: "POST", url: path, payload: body,
    headers: { "content-type": "application/x-www-form-urlencoded", ...(sign ? { "x-twilio-signature": twilioSignature(TOKEN, BASE + path, params) } : {}) },
  });
}

describe("Twilio security", () => {
  it("validates signatures over URL + sorted params", () => {
    const sig = twilioSignature(TOKEN, `${BASE}/voice/turn`, { CallSid: "CA1", SpeechResult: "yes" });
    expect(validTwilioRequest(TOKEN, sig, `${BASE}/voice/turn`, { SpeechResult: "yes", CallSid: "CA1" })).toBe(true);
    expect(validTwilioRequest(TOKEN, sig, `${BASE}/voice/turn`, { SpeechResult: "no", CallSid: "CA1" })).toBe(false);
  });

  it("rejects unsigned webhooks", async () => {
    const { app: a } = app();
    expect((await post(a, "/voice/incoming", { CallSid: "CA1" }, false)).statusCode).toBe(403);
  });

  it("escapes everything spoken in TwiML", () => {
    expect(twiml.sayAndHangup('Bye <Thandi> & "co"')).toContain("Bye &lt;Thandi&gt; &amp; &quot;co&quot;");
  });
});

describe("full call over webhooks", () => {
  it("books an appointment end to end", async () => {
    const { app: a, cal } = app();
    const start = await post(a, "/voice/incoming", { CallSid: "CA42", From: "+27821234567" });
    expect(start.headers["content-type"]).toContain("text/xml");
    expect(start.body).toContain('<Gather input="speech dtmf"');
    expect(start.body).toContain("Lwazi Hair Studio");

    for (const said of ["wig install on Tuesday at 11", "Naledi"]) {
      await post(a, "/voice/turn", { CallSid: "CA42", SpeechResult: said, Confidence: "0.92" });
    }
    const done = await post(a, "/voice/turn", { CallSid: "CA42", SpeechResult: "yes please", Confidence: "0.95" });
    expect(done.body).toContain("You&apos;re booked");
    expect(done.body).toContain("<Hangup/>");
    expect(cal.bookings).toMatchObject([{ name: "Naledi", service: "wig_install", time: { h: 11, min: 0 } }]);
  });

  it("silence redirect re-prompts, transfer dials reception, status cleans up", async () => {
    const { app: a } = app();
    await post(a, "/voice/incoming", { CallSid: "CA7" });
    const silent = await post(a, "/voice/turn?silence=1", { CallSid: "CA7" });
    expect(silent.body).toContain("didn&apos;t catch");
    const human = await post(a, "/voice/turn", { CallSid: "CA7", SpeechResult: "reception please", Confidence: "0.9" });
    expect(human.body).toContain("<Dial timeout=\"20\">+27110000000</Dial>");
    await post(a, "/voice/status", { CallSid: "CA7", CallStatus: "completed" });
    expect((await a.inject({ method: "GET", url: "/healthz" })).json().activeCalls).toBe(0);
    expect((await post(a, "/voice/turn", { CallSid: "unknown" })).body).toContain("<Hangup/>");
  });
});
