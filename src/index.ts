import { DEFAULT_SERVICES, SalonCalendar } from "./calendar.js";
import { buildServer } from "./server.js";

const required = ["TWILIO_AUTH_TOKEN", "PUBLIC_BASE_URL", "RECEPTION_NUMBER"] as const;
for (const k of required) if (!process.env[k]) throw new Error(`${k} is required`);

const today = () => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date()).split("-").map(Number);
  return { y: y!, m: m!, d: d! };
};

const app = buildServer({
  calendar: new SalonCalendar(DEFAULT_SERVICES),
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  publicBaseUrl: process.env.PUBLIC_BASE_URL!,
  receptionNumber: process.env.RECEPTION_NUMBER!,
  today,
});
await app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" });
