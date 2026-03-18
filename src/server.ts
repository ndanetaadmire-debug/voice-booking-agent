import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import type { SalonCalendar } from "./calendar.js";
import { type CallState, GREETING, step } from "./dialogue.js";
import type { LocalDate } from "./nlu.js";
import { twiml, validTwilioRequest } from "./twilio.js";

export interface ServerDeps {
  calendar: SalonCalendar;
  authToken: string;
  publicBaseUrl: string; // the URL Twilio calls; part of the signature
  receptionNumber: string;
  today: () => LocalDate;
  sessionTtlMs?: number;
}

export function buildServer(d: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(formbody);
  const sessions = new Map<string, { state: CallState; expires: number }>();
  const ttl = d.sessionTtlMs ?? 30 * 60_000;
  const hints = d.calendar.services.flatMap((s) => s.names);

  // Every webhook must carry a valid Twilio signature.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/voice")) return;
    const url = d.publicBaseUrl + req.url;
    if (!validTwilioRequest(d.authToken, req.headers["x-twilio-signature"] as string | undefined, url, (req.body ?? {}) as Record<string, string>)) {
      return reply.code(403).send("invalid signature");
    }
  });

  const xml = (body: string) => ({ type: "text/xml", body });

  app.post("/voice/incoming", async (req, reply) => {
    const { CallSid, From } = req.body as Record<string, string>;
    sessions.set(CallSid!, { state: { callSid: CallSid!, from: From ?? "", step: "service", misses: 0 }, expires: Date.now() + ttl });
    const r = xml(twiml.gather(GREETING, { action: "/voice/turn", hints }));
    return reply.type(r.type).send(r.body);
  });

  app.post("/voice/turn", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const session = sessions.get(body.CallSid ?? "");
    if (!session) {
      return reply.type("text/xml").send(twiml.sayAndHangup("Sorry, something went wrong. Please call us again."));
    }
    const silence = (req.query as Record<string, string>).silence === "1";
    const { state, action } = step(
      session.state,
      { speech: silence ? "" : body.SpeechResult ?? "", confidence: silence ? 0 : Number(body.Confidence ?? (body.Digits ? 1 : 0)), digits: body.Digits },
      d.calendar,
      d.today(),
    );
    sessions.set(state.callSid, { state, expires: Date.now() + ttl });

    const out =
      action.kind === "ask" ? twiml.gather(action.say, { action: "/voice/turn", hints, dtmf: action.dtmf })
      : action.kind === "transfer" ? twiml.transfer(action.say, d.receptionNumber)
      : twiml.sayAndHangup(action.say);
    return reply.type("text/xml").send(out);
  });

  app.post("/voice/status", async (req) => {
    const { CallSid, CallStatus } = req.body as Record<string, string>;
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(CallStatus ?? "")) sessions.delete(CallSid ?? "");
    return { ok: true };
  });

  app.get("/healthz", async () => {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
    return { status: "ok", activeCalls: sessions.size };
  });

  return app;
}
