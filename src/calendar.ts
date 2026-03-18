import type { LocalDate, LocalTime } from "./nlu.js";

export interface Service {
  id: string;
  names: string[]; // how callers say it
  minutes: number;
  priceRands: number;
}

export interface Booking {
  id: string;
  callSid: string;
  service: string;
  date: LocalDate;
  time: LocalTime;
  name: string;
  phone: string;
}

const key = (d: LocalDate, t: LocalTime) => `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}T${String(t.h).padStart(2, "0")}:${String(t.min).padStart(2, "0")}`;

/** Port to the booking system (Fresha, Booksy, Google Calendar). In-memory adapter with business hours. */
export class SalonCalendar {
  readonly bookings: Booking[] = [];
  constructor(
    readonly services: Service[],
    private readonly hours = { open: 9, close: 17, slotMinutes: 30, closedDays: [0] as number[] },
  ) {}

  isOpen(d: LocalDate, t: LocalTime, minutes: number): boolean {
    const dow = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
    const start = t.h * 60 + t.min;
    return !this.hours.closedDays.includes(dow) && start >= this.hours.open * 60 && start + minutes <= this.hours.close * 60 && t.min % this.hours.slotMinutes === 0;
  }

  isFree(d: LocalDate, t: LocalTime, minutes: number): boolean {
    const s = t.h * 60 + t.min;
    return this.isOpen(d, t, minutes) && !this.bookings.some((b) => {
      if (key(b.date, { h: 0, min: 0 }) !== key(d, { h: 0, min: 0 })) return false;
      const bs = b.time.h * 60 + b.time.min;
      const bm = this.services.find((x) => x.id === b.service)!.minutes;
      return s < bs + bm && bs < s + minutes;
    });
  }

  /** Nearest free slots on the same day, closest to the requested time first. */
  alternatives(d: LocalDate, t: LocalTime, minutes: number, n = 2): LocalTime[] {
    const out: LocalTime[] = [];
    for (let m = this.hours.open * 60; m + minutes <= this.hours.close * 60; m += this.hours.slotMinutes) {
      const slot = { h: Math.floor(m / 60), min: m % 60 };
      if (this.isFree(d, slot, minutes)) out.push(slot);
    }
    const target = t.h * 60 + t.min;
    return out.sort((a, b) => Math.abs(a.h * 60 + a.min - target) - Math.abs(b.h * 60 + b.min - target)).slice(0, n);
  }

  /** Idempotent per call: Twilio retries webhooks, and a retry must not double-book. */
  book(b: Omit<Booking, "id">): Booking {
    const existing = this.bookings.find((x) => x.callSid === b.callSid);
    if (existing) return existing;
    const svc = this.services.find((s) => s.id === b.service)!;
    if (!this.isFree(b.date, b.time, svc.minutes)) throw new Error("slot no longer available");
    const booking = { ...b, id: `BK-${key(b.date, b.time).replace(/\D/g, "").slice(2)}` };
    this.bookings.push(booking);
    return booking;
  }
}

export const DEFAULT_SERVICES: Service[] = [
  { id: "wash_blowdry", names: ["wash and blow dry", "blow dry", "blowdry", "blow-dry", "wash"], minutes: 60, priceRands: 350 },
  { id: "braids", names: ["box braids", "braids", "braiding", "cornrows"], minutes: 180, priceRands: 900 },
  { id: "wig_install", names: ["wig install", "wig installation", "install a wig", "frontal install", "wig"], minutes: 90, priceRands: 650 },
  { id: "trim", names: ["trim", "haircut", "cut"], minutes: 30, priceRands: 200 },
];
