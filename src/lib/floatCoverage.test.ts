import { describe, it, expect } from "vitest";
import {
  coveringSlackIds,
  parseTimeToMinutes,
  shiftCoversInstant,
  zonedParts,
  type FloatShift,
} from "./floatCoverage";

const pacificNoonToFive: FloatShift = {
  slack_user_id: "U_SAM",
  display_name: "Sam",
  starts_on: "2026-08-01",
  ends_on: "2026-08-15",
  start_time: "12:00",
  end_time: "17:00",
  time_zone: "America/Los_Angeles",
  active: true,
};

describe("parseTimeToMinutes", () => {
  it("handles HH:MM and HH:MM:SS", () => {
    expect(parseTimeToMinutes("12:00")).toBe(720);
    expect(parseTimeToMinutes("17:30:00")).toBe(1050);
    expect(parseTimeToMinutes("00:00")).toBe(0);
  });
});

describe("zonedParts", () => {
  it("reports the local date and minute-of-day, not UTC", () => {
    // 2026-08-05T02:00Z is still 2026-08-04 19:00 in Los Angeles.
    const p = zonedParts(new Date("2026-08-05T02:00:00Z"), "America/Los_Angeles");
    expect(p.date).toBe("2026-08-04");
    expect(p.minutes).toBe(19 * 60);
  });

  it("normalizes local midnight to minute 0", () => {
    const p = zonedParts(new Date("2026-08-05T07:00:00Z"), "America/Los_Angeles");
    expect(p.date).toBe("2026-08-05");
    expect(p.minutes).toBe(0);
  });
});

describe("shiftCoversInstant — same-day window", () => {
  it("covers the middle of the window", () => {
    // 2026-08-05 14:00 PDT = 21:00Z
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-05T21:00:00Z"))).toBe(true);
  });

  it("is inclusive at the start minute", () => {
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-05T19:00:00Z"))).toBe(true);
  });

  it("is exclusive at the end minute so back-to-back shifts don't double-ping", () => {
    // 17:00 PDT = 00:00Z next day
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-06T00:00:00Z"))).toBe(false);
  });

  it("does not cover before the window on a covered date", () => {
    // 09:00 PDT
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-05T16:00:00Z"))).toBe(false);
  });

  it("does not cover dates outside the range", () => {
    // 2026-07-31 14:00 PDT and 2026-08-16 14:00 PDT
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-07-31T21:00:00Z"))).toBe(false);
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-16T21:00:00Z"))).toBe(false);
  });

  it("covers both boundary days of the range", () => {
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-01T21:00:00Z"))).toBe(true);
    expect(shiftCoversInstant(pacificNoonToFive, new Date("2026-08-15T21:00:00Z"))).toBe(true);
  });

  it("ignores inactive shifts", () => {
    expect(
      shiftCoversInstant({ ...pacificNoonToFive, active: false }, new Date("2026-08-05T21:00:00Z")),
    ).toBe(false);
  });

  it("treats an invalid timezone as non-matching rather than throwing", () => {
    expect(
      shiftCoversInstant(
        { ...pacificNoonToFive, time_zone: "Not/AZone" },
        new Date("2026-08-05T21:00:00Z"),
      ),
    ).toBe(false);
  });
});

describe("shiftCoversInstant — DST boundary", () => {
  // US DST ends 2026-11-01: noon local stays noon local on both sides, so the
  // UTC instant that matches shifts by an hour. A fixed-offset implementation
  // would silently drift; this is the case that catches it.
  const nov: FloatShift = {
    ...pacificNoonToFive,
    starts_on: "2026-10-25",
    ends_on: "2026-11-05",
  };

  it("covers noon local before the switch (PDT, UTC-7)", () => {
    expect(shiftCoversInstant(nov, new Date("2026-10-30T19:00:00Z"))).toBe(true); // 12:00 PDT
    expect(shiftCoversInstant(nov, new Date("2026-10-30T18:00:00Z"))).toBe(false); // 11:00 PDT
  });

  it("covers noon local after the switch (PST, UTC-8)", () => {
    expect(shiftCoversInstant(nov, new Date("2026-11-03T20:00:00Z"))).toBe(true); // 12:00 PST
    expect(shiftCoversInstant(nov, new Date("2026-11-03T19:00:00Z"))).toBe(false); // 11:00 PST
  });
});

describe("shiftCoversInstant — window crossing midnight", () => {
  const overnight: FloatShift = {
    slack_user_id: "U_NIGHT",
    display_name: "Night",
    starts_on: "2026-08-01",
    ends_on: "2026-08-02",
    start_time: "22:00",
    end_time: "06:00",
    time_zone: "America/Los_Angeles",
    active: true,
  };

  it("covers the late-evening leg on a range date", () => {
    // 2026-08-01 23:00 PDT = 2026-08-02 06:00Z
    expect(shiftCoversInstant(overnight, new Date("2026-08-02T06:00:00Z"))).toBe(true);
  });

  it("covers the early-morning tail belonging to the previous range date", () => {
    // 2026-08-03 02:00 PDT — local date is outside the range, but the block
    // that began 2026-08-02 22:00 is still running.
    expect(shiftCoversInstant(overnight, new Date("2026-08-03T09:00:00Z"))).toBe(true);
  });

  it("does not cover the gap between the legs", () => {
    // 2026-08-02 12:00 PDT
    expect(shiftCoversInstant(overnight, new Date("2026-08-02T19:00:00Z"))).toBe(false);
  });

  it("does not cover the morning before the first range date", () => {
    // 2026-08-01 02:00 PDT — the 2026-07-31 block never existed.
    expect(shiftCoversInstant(overnight, new Date("2026-08-01T09:00:00Z"))).toBe(false);
  });
});

describe("coveringSlackIds", () => {
  const joel: FloatShift = {
    ...pacificNoonToFive,
    slack_user_id: "U_JOEL",
    display_name: "Joel",
    start_time: "15:00",
    end_time: "20:00",
  };

  it("returns everyone covering when shifts overlap", () => {
    // 2026-08-05 16:00 PDT sits in both windows.
    expect(coveringSlackIds([pacificNoonToFive, joel], new Date("2026-08-05T23:00:00Z"))).toEqual([
      "U_SAM",
      "U_JOEL",
    ]);
  });

  it("de-duplicates a person with two overlapping shifts", () => {
    expect(
      coveringSlackIds(
        [pacificNoonToFive, { ...joel, slack_user_id: "U_SAM" }],
        new Date("2026-08-05T23:00:00Z"),
      ),
    ).toEqual(["U_SAM"]);
  });

  it("returns empty for an empty schedule", () => {
    expect(coveringSlackIds([], new Date("2026-08-05T21:00:00Z"))).toEqual([]);
  });

  it("returns empty outside every shift — the 2AM case", () => {
    // 2026-08-05 02:00 PDT
    expect(coveringSlackIds([pacificNoonToFive, joel], new Date("2026-08-05T09:00:00Z"))).toEqual([]);
  });
});
