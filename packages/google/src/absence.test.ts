import { describe, expect, it } from "vitest";
import { absenceSecondsByDay, type CalendarEvent } from "./absence.ts";

const HOUR = 3_600;
const tokyo = { timeZone: "Asia/Tokyo", from: "2026-11-01", to: "2026-11-30" };

/** Google Calendar API の時刻つき予定(dateTime はオフセットつき) */
const timed = (start: string, end: string): CalendarEvent => ({
  start: { dateTime: start },
  end: { dateTime: end },
});

describe("absenceSecondsByDay: Out of Office の予定を、日ごとの不在秒数に直す", () => {
  it("13:00〜18:00 の不在は、その日に 5h", () => {
    expect(absenceSecondsByDay([timed("2026-11-09T13:00:00+09:00", "2026-11-09T18:00:00+09:00")], tokyo)).toEqual({
      "2026-11-09": 5 * HOUR,
    });
  });

  it("UTC で書かれた時刻も、指定したタイムゾーンの日付に割り当てる", () => {
    // 2026-11-09T15:00Z = 日本時間 11/10 0:00
    expect(absenceSecondsByDay([timed("2026-11-09T15:00:00Z", "2026-11-09T18:00:00Z")], tokyo)).toEqual({
      "2026-11-10": 3 * HOUR,
    });
  });

  it("日をまたぐ不在は日ごとに分ける: 11/09 20:00〜11/10 10:00 → 4h と 10h", () => {
    expect(absenceSecondsByDay([timed("2026-11-09T20:00:00+09:00", "2026-11-10T10:00:00+09:00")], tokyo)).toEqual({
      "2026-11-09": 4 * HOUR,
      "2026-11-10": 10 * HOUR,
    });
  });

  it("数日にわたる不在は、まるごとの日を 24h にする", () => {
    expect(absenceSecondsByDay([timed("2026-11-09T00:00:00+09:00", "2026-11-11T00:00:00+09:00")], tokyo)).toEqual({
      "2026-11-09": 24 * HOUR,
      "2026-11-10": 24 * HOUR,
    });
  });

  it("重なる予定は二重に数えない: 10:00〜14:00 と 12:00〜16:00 → 6h", () => {
    expect(
      absenceSecondsByDay(
        [
          timed("2026-11-09T10:00:00+09:00", "2026-11-09T14:00:00+09:00"),
          timed("2026-11-09T12:00:00+09:00", "2026-11-09T16:00:00+09:00"),
        ],
        tokyo,
      ),
    ).toEqual({ "2026-11-09": 6 * HOUR });
  });

  it("終日予定(date だけ)も扱う。end は翌日を指す(その日を含まない)", () => {
    expect(absenceSecondsByDay([{ start: { date: "2026-11-09" }, end: { date: "2026-11-11" } }], tokyo)).toEqual({
      "2026-11-09": 24 * HOUR,
      "2026-11-10": 24 * HOUR,
    });
  });

  it("from〜to の外の部分は切り捨てる", () => {
    expect(
      absenceSecondsByDay([timed("2026-10-31T20:00:00+09:00", "2026-11-01T02:00:00+09:00")], tokyo),
    ).toEqual({ "2026-11-01": 2 * HOUR });
    expect(
      absenceSecondsByDay([timed("2026-11-30T22:00:00+09:00", "2026-12-01T05:00:00+09:00")], tokyo),
    ).toEqual({ "2026-11-30": 2 * HOUR });
  });

  it("夏時間のあるタイムゾーンでは、切り替えの日は 23h", () => {
    expect(
      absenceSecondsByDay([{ start: { date: "2026-03-08" }, end: { date: "2026-03-09" } }], {
        timeZone: "America/Los_Angeles",
        from: "2026-03-01",
        to: "2026-03-31",
      }),
    ).toEqual({ "2026-03-08": 23 * HOUR });
  });

  it("予定がなければ空", () => {
    expect(absenceSecondsByDay([], tokyo)).toEqual({});
  });

  it("終了が開始より前の予定は受け付けない", () => {
    expect(() =>
      absenceSecondsByDay([timed("2026-11-09T18:00:00+09:00", "2026-11-09T13:00:00+09:00")], tokyo),
    ).toThrow(RangeError);
  });

  it("開始・終了のどちらもない予定は受け付けない", () => {
    expect(() => absenceSecondsByDay([{ start: {}, end: {} }], tokyo)).toThrow(RangeError);
  });

  it("不正なタイムゾーンは受け付けない", () => {
    expect(() => absenceSecondsByDay([], { ...tokyo, timeZone: "Mars/Olympus" })).toThrow(RangeError);
  });
});
