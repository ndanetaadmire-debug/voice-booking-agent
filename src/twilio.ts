import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio request validation: HMAC-SHA1 over the full URL followed by each POST param
 * (sorted by key) as key+value, base64-encoded, compared in constant time.
 * Without this anyone can POST fake "caller said yes" turns to the webhook.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioRequest(authToken: string, signature: string | undefined, url: string, params: Record<string, string>): boolean {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Minimal TwiML builder. Everything spoken is XML-escaped (caller names end up in prompts). */
export const twiml = {
  gather(say: string, opts: { action: string; hints?: string[]; dtmf?: boolean; language?: string }): string {
    const input = opts.dtmf ? "dtmf speech" : "speech dtmf";
    const hints = opts.hints?.length ? ` hints="${esc(opts.hints.join(", "))}"` : "";
    return doc(
      `<Gather input="${input}" action="${esc(opts.action)}" method="POST" speechTimeout="auto" timeout="5" numDigits="1" language="${opts.language ?? "en-ZA"}"${hints}>` +
        `<Say voice="Polly.Ayanda-Neural">${esc(say)}</Say></Gather>` +
        `<Redirect method="POST">${esc(`${opts.action}?silence=1`)}</Redirect>`,
    );
  },
  sayAndHangup(say: string): string {
    return doc(`<Say voice="Polly.Ayanda-Neural">${esc(say)}</Say><Hangup/>`);
  },
  transfer(say: string, number: string): string {
    return doc(`<Say voice="Polly.Ayanda-Neural">${esc(say)}</Say><Dial timeout="20">${esc(number)}</Dial>`);
  },
};

const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
