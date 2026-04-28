import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES } from "../src/calendar.js";
import { isNo, isYes, matchService, parseDate, parseName, parseTime, speakTime, wantsHuman } from "../src/nlu.js";

const TODAY = { y: 2026, m: 11, d: 14 }; // Saturday

describe("parseDate", () => {
  it.each([
    ["today please", { y: 2026, m: 11, d: 14 }],
    ["tomorrow", { y: 2026, m: 11, d: 15 }],
    ["the day after tomorrow", { y: 2026, m: 11, d: 16 }],
    ["on Tuesday", { y: 2026, m: 11, d: 17 }],
    ["next Friday", { y: 2026, m: 11, d: 20 }],
    ["Saturday", { y: 2026, m: 11, d: 21 }], // today is Saturday → next week
    ["the twentieth", { y: 2026, m: 11, d: 20 }],
    ["the 3rd", { y: 2026, m: 12, d: 3 }], // already past this month → next month
    ["5 January", { y: 2027, m: 1, d: 5 }],
  ])("%s", (said, expected) => expect(parseDate(said, TODAY)).toEqual(expected));

  it("ignores times and non-dates", () => {
    expect(parseDate("at 10 am", TODAY)).toBeNull();
    expect(parseDate("I'd like braids", TODAY)).toBeNull();
  });

  it("rolls the year over in December", () => {
    expect(parseDate("tomorrow", { y: 2026, m: 12, d: 31 })).toEqual({ y: 2027, m: 1, d: 1 });
  });
});

describe("parseTime", () => {
  it.each([
    ["at 10 am", { h: 10, min: 0 }],
    ["ten a.m.", { h: 10, min: 0 }],
    ["half past two", { h: 14, min: 30 }],
    ["quarter to eleven in the morning", { h: 10, min: 45 }],
    ["14:30", { h: 14, min: 30 }],
    ["two thirty", { h: 14, min: 30 }],
    ["3 o'clock", { h: 15, min: 0 }],
    ["at noon", { h: 12, min: 0 }],
    ["9 in the morning", { h: 9, min: 0 }],
  ])("%s", (said, expected) => expect(parseTime(said)).toEqual(expected));

  it("rejects nonsense", () => expect(parseTime("whenever")).toBeNull());
  it("speaks naturally", () => {
    expect(speakTime({ h: 14, min: 30 })).toBe("half past 2 in the afternoon");
    expect(speakTime({ h: 9, min: 0 })).toBe("9 o'clock in the morning");
  });
});

describe("intent helpers", () => {
  it("matches services despite ASR noise", () => {
    expect(matchService("I want my box braids done", DEFAULT_SERVICES)).toBe("braids");
    expect(matchService("a blow dri please", DEFAULT_SERVICES)).toBe("wash_blowdry");
    expect(matchService("wig instal", DEFAULT_SERVICES)).toBe("wig_install");
    expect(matchService("a pedicure", DEFAULT_SERVICES)).toBeNull();
  });
  it("yes / no / human / name", () => {
    expect(isYes("Yes please")).toBe(true);
    expect(isNo("no, wrong day")).toBe(true);
    expect(wantsHuman("can I speak to a person")).toBe(true);
    expect(parseName("my name is thandi mokoena")).toBe("Thandi Mokoena");
    expect(parseName("it's Lerato.")).toBe("Lerato");
    expect(parseName("<script>alert(1)</script>")).toBeNull();
  });
});
