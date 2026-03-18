/**
 * Deterministic understanding of what callers actually say. Speech-to-text gives us words, not
 * structure: "tomorrow at half past two", "next Friday ten a m", "the fourteenth at 9".
 * Rules beat an LLM here: they're instant (latency is everything on a call), free and testable.
 */

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  "twenty first": 21, "twenty second": 22, "twenty third": 23, "twenty fourth": 24, "twenty fifth": 25, "twenty sixth": 26,
  "twenty seventh": 27, "twenty eighth": 28, "twenty ninth": 29, thirtieth: 30, "thirty first": 31,
};
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function normalizeSpeech(s: string): string {
  return s.toLowerCase().replace(/[.,!?]/g, " ").replace(/\ba\.?\s?m\b/g, "am").replace(/\bp\.?\s?m\b/g, "pm").replace(/\s+/g, " ").trim();
}

export interface LocalDate {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Parse a spoken date relative to `today` (in the business's timezone). Returns null if no date is present. */
export function parseDate(raw: string, today: LocalDate): LocalDate | null {
  const s = normalizeSpeech(raw);
  const base = new Date(Date.UTC(today.y, today.m - 1, today.d));
  const shift = (days: number) => {
    const d = new Date(base.getTime() + days * 86_400_000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  };
  if (/\btoday\b/.test(s)) return shift(0);
  if (/\b(day after tomorrow)\b/.test(s)) return shift(2);
  if (/\btomorrow\b/.test(s)) return shift(1);
  const dow = DAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(s));
  if (dow >= 0) {
    // "Friday" and "next Friday" both mean the coming Friday; on a Friday they mean a week from today.
    const delta = (dow - base.getUTCDay() + 7) % 7 || 7;
    return shift(delta);
  }
  // "the 14th", "the fourteenth", "14 november"
  let day: number | undefined;
  const numeric = s.match(/\b(\d{1,2})(st|nd|rd|th)?\b(?!\s*(:|am|pm|o'?clock))/);
  for (const [w, n] of Object.entries(ORDINALS).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${w}\\b`).test(s)) {
      day = n;
      break;
    }
  }
  if (day === undefined && numeric && /\bthe\b|\b(st|nd|rd|th)\b|january|february|march|april|may|june|july|august|september|october|november|december/.test(s)) {
    day = Number(numeric[1]);
  }
  if (day === undefined || day < 1 || day > 31) return null;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const mi = months.findIndex((m) => s.includes(m));
  let m = mi >= 0 ? mi + 1 : today.m;
  let y = today.y;
  if (mi < 0 && day < today.d) m += 1; // "the 3rd" when today is the 14th means next month
  if (m > 12) { m = 1; y += 1; }
  if (mi >= 0 && (m < today.m || (m === today.m && day < today.d))) y += 1;
  return { y, m, d: day };
}

export interface LocalTime {
  h: number;
  min: number;
}

/** Parse a spoken time. Bare hours 1–7 are assumed afternoon (no salon opens at 3am). */
export function parseTime(raw: string): LocalTime | null {
  const s = normalizeSpeech(raw).replace(/\bo'?clock\b/g, "");
  if (/\bnoon|midday\b/.test(s)) return { h: 12, min: 0 };
  const word = (w: string | undefined) => (w === undefined ? undefined : /^\d+$/.test(w) ? Number(w) : NUM_WORDS[w]);
  let h: number | undefined;
  let min = 0;

  const half = s.match(/\bhalf past (\w+)/);
  const quarterPast = s.match(/\bquarter past (\w+)/);
  const quarterTo = s.match(/\bquarter to (\w+)/);
  const colon = s.match(/\b(\d{1,2})[:h](\d{2})\b/);
  const spaced = s.match(/\b(\d{1,2}|\w+) (\d{2}|thirty|fifteen|forty five|forty-five)\s*(am|pm)?\b/);
  const bare = s.match(/\b(?:at\s+)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm)?\b/);

  if (half) { h = word(half[1]); min = 30; }
  else if (quarterPast) { h = word(quarterPast[1]); min = 15; }
  else if (quarterTo) { const n = word(quarterTo[1]); h = n === undefined ? undefined : n - 1; min = 45; }
  else if (colon) { h = Number(colon[1]); min = Number(colon[2]); }
  else if (spaced && word(spaced[1]) !== undefined && /^(\d{2}|thirty|fifteen|forty.five)$/.test(spaced[2]!)) {
    h = word(spaced[1]);
    min = /^\d{2}$/.test(spaced[2]!) ? Number(spaced[2]) : spaced[2] === "thirty" ? 30 : spaced[2] === "fifteen" ? 15 : 45;
  } else if (bare) { h = word(bare[1]); }
  if (h === undefined || h > 23 || min > 59) return null;

  const pm = /\bpm\b|\bafternoon\b|\bevening\b/.test(s);
  const am = /\bam\b|\bmorning\b/.test(s);
  if (pm && h < 12) h += 12;
  else if (am && h === 12) h = 0;
  else if (!am && !pm && h >= 1 && h <= 7) h += 12;
  return { h, min };
}

/** Edit distance for fuzzy service matching ("blow dry" vs "blowdry", ASR mishearings). */
export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function matchService(raw: string, services: Array<{ id: string; names: string[] }>): string | null {
  const s = normalizeSpeech(raw);
  let best: { id: string; score: number } | null = null;
  for (const svc of services) {
    for (const name of svc.names) {
      if (s.includes(name)) return svc.id;
      const words = s.split(" ");
      const n = name.split(" ").length;
      for (let i = 0; i + n <= words.length; i++) {
        const span = words.slice(i, i + n).join(" ");
        const dist = levenshtein(span, name) / Math.max(name.length, 1);
        if (dist <= 0.25 && (!best || dist < best.score)) best = { id: svc.id, score: dist };
      }
    }
  }
  return best?.id ?? null;
}

export const isYes = (s: string) => /\b(yes|yeah|yep|correct|that's right|that is right|sure|please do|perfect|ja)\b/.test(normalizeSpeech(s));
export const isNo = (s: string) => /\b(no|nope|not quite|wrong|change|different)\b/.test(normalizeSpeech(s));
export const wantsHuman = (s: string) => /\b(human|person|agent|operator|reception|receptionist|someone|speak to)\b/.test(normalizeSpeech(s));

/** "Thandi" from "my name is Thandi Mokoena" / "it's Thandi" / "Thandi". */
export function parseName(raw: string): string | null {
  const s = raw.trim().replace(/[.,!?]+$/, "");
  const m = s.match(/(?:my name is|this is|it's|it is|i am|i'm|call me)\s+(.+)$/i);
  const name = (m?.[1] ?? s).trim();
  if (!/^[\p{L}' -]{2,40}$/u.test(name) || name.split(/\s+/).length > 3) return null;
  return name.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function speakTime(t: LocalTime): string {
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
  const suffix = t.h < 12 ? "in the morning" : t.h < 17 ? "in the afternoon" : "in the evening";
  return t.min === 0 ? `${h12} o'clock ${suffix}` : t.min === 30 ? `half past ${h12} ${suffix}` : `${h12}:${String(t.min).padStart(2, "0")} ${suffix}`;
}

export function speakDate(d: LocalDate): string {
  const dt = new Date(Date.UTC(d.y, d.m - 1, d.d));
  return dt.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
