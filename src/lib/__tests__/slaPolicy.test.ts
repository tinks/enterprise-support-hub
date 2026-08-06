import { describe, it, expect } from "vitest";
import {
  BUSINESS_DAY_SECONDS,
  CADENCE_TARGETS,
  DEFAULT_BUSINESS_HOURS,
  SLA_TARGETS,
  TRIAGE_TARGET_S,
  businessDaySeconds,
  businessHoursBetween,
  dbClockToEngine,
  policyToEngine,
  resolvePolicy,
  type SlaPolicy,
  type SlaPolicyTargetRow,
  type SlaPolicyVersionRow,
} from "../slaMetrics";

// Mirrors the seeded row in `sla_policy_versions` (migration batch 1).
const SEEDED_VERSION: SlaPolicyVersionRow = {
  id: "v-seed",
  effective_from: "2026-01-01T00:00:00Z",
  status: "provisional",
  label: "Seed from code constants (provisional)",
  business_hours: {
    tz: "Europe/Berlin",
    work_days: [1, 2, 3, 4, 5],
    day_start_hour: 9,
    day_end_hour: 24,
    holidays: [],
    business_day_seconds: 54000,
  },
};

// Mirrors the seeded rows in `sla_policy_targets`.
const SEEDED_TARGETS: SlaPolicyTargetRow[] = [
  { version_id: "v-seed", metric: "first_response", severity: 1, target_seconds: 1800, clock: "wall" },
  { version_id: "v-seed", metric: "first_response", severity: 2, target_seconds: 14400, clock: "business" },
  { version_id: "v-seed", metric: "first_response", severity: 3, target_seconds: 54000, clock: "business" },
  { version_id: "v-seed", metric: "first_response", severity: 4, target_seconds: 162000, clock: "business" },
  { version_id: "v-seed", metric: "resolution", severity: 1, target_seconds: 28800, clock: "wall" },
  { version_id: "v-seed", metric: "resolution", severity: 2, target_seconds: 108000, clock: "business" },
  { version_id: "v-seed", metric: "resolution", severity: 3, target_seconds: 270000, clock: "business" },
  { version_id: "v-seed", metric: "resolution", severity: 4, target_seconds: null, clock: "business" },
  { version_id: "v-seed", metric: "cadence", severity: 1, target_seconds: 3600, clock: "wall" },
  { version_id: "v-seed", metric: "cadence", severity: 2, target_seconds: 14400, clock: "business" },
  { version_id: "v-seed", metric: "cadence", severity: 3, target_seconds: null, clock: "business" },
  { version_id: "v-seed", metric: "cadence", severity: 4, target_seconds: null, clock: "business" },
  { version_id: "v-seed", metric: "triage", severity: null, target_seconds: 1800, clock: "business" },
];

describe("SLA policy config — seed reproduces the code constants", () => {
  const policy = policyToEngine(SEEDED_VERSION, SEEDED_TARGETS);

  it("targets deep-equal SLA_TARGETS", () => {
    expect(policy.targets).toEqual(SLA_TARGETS);
  });

  it("cadence deep-equals CADENCE_TARGETS", () => {
    expect(policy.cadence).toEqual(CADENCE_TARGETS);
  });

  it("triage target equals TRIAGE_TARGET_S", () => {
    expect(policy.triageTargetS).toBe(TRIAGE_TARGET_S);
  });

  it("business hours deep-equal DEFAULT_BUSINESS_HOURS and reproduce BUSINESS_DAY_SECONDS", () => {
    expect(policy.businessHours).toEqual(DEFAULT_BUSINESS_HOURS);
    expect(businessDaySeconds(policy.businessHours)).toBe(BUSINESS_DAY_SECONDS);
  });

  it("maps DB clock 'wall' → engine 'calendar'", () => {
    expect(dbClockToEngine("wall")).toBe("calendar");
    expect(dbClockToEngine("business")).toBe("business");
    expect(policy.targets[1].firstResponseClock).toBe("calendar");
    expect(policy.cadence[1]!.clock).toBe("calendar");
  });

  it("null target_seconds is an explicit 'no target', never a default", () => {
    expect(policy.targets[4].resolutionS).toBeNull();
    expect(policy.cadence[3]).toBeNull();
    expect(policy.cadence[4]).toBeNull();
  });

  it("a missing triage row yields null, not TRIAGE_TARGET_S", () => {
    const p = policyToEngine(
      SEEDED_VERSION,
      SEEDED_TARGETS.filter((r) => r.metric !== "triage"),
    );
    expect(p.triageTargetS).toBeNull();
  });

  it("parses version metadata", () => {
    expect(policy.status).toBe("provisional");
    expect(policy.effectiveFromMs).toBe(Date.parse("2026-01-01T00:00:00Z"));
  });
});

describe("resolvePolicy", () => {
  const mk = (id: string, iso: string): SlaPolicy =>
    policyToEngine({ ...SEEDED_VERSION, id, effective_from: iso }, []);

  const a = mk("a", "2026-01-01T00:00:00Z");
  const b = mk("b", "2026-06-01T00:00:00Z");
  const c = mk("c", "2026-09-01T00:00:00Z");
  const all = [c, a, b]; // deliberately unordered

  it("returns null when the anchor precedes every version", () => {
    expect(resolvePolicy(Date.parse("2025-12-31T23:59:59Z"), all)).toBeNull();
  });

  it("returns null for an empty policy list", () => {
    expect(resolvePolicy(Date.now(), [])).toBeNull();
  });

  it("picks the greatest effective_from <= anchor regardless of input order", () => {
    expect(resolvePolicy(Date.parse("2026-03-01T00:00:00Z"), all)?.id).toBe("a");
    expect(resolvePolicy(Date.parse("2026-07-15T00:00:00Z"), all)?.id).toBe("b");
    expect(resolvePolicy(Date.parse("2027-01-01T00:00:00Z"), all)?.id).toBe("c");
  });

  it("is inclusive at the effective boundary", () => {
    expect(resolvePolicy(Date.parse("2026-06-01T00:00:00Z"), all)?.id).toBe("b");
    expect(resolvePolicy(Date.parse("2026-06-01T00:00:00Z") - 1, all)?.id).toBe("a");
  });
});

describe("businessHoursBetween — injectable config is bit-identical by default", () => {
  const cases: Array<[string, string]> = [
    ["2026-07-06T08:00:00Z", "2026-07-06T18:00:00Z"], // Monday, spans window start
    ["2026-07-03T20:00:00Z", "2026-07-07T10:00:00Z"], // across a weekend
    ["2026-01-15T06:00:00Z", "2026-01-15T07:00:00Z"], // entirely before hours (winter/CET)
    ["2026-03-27T12:00:00Z", "2026-03-31T12:00:00Z"], // across the DST boundary
    ["2026-07-06T12:00:00Z", "2026-07-06T12:00:00Z"], // zero-length
  ];

  for (const [start, end] of cases) {
    it(`${start} → ${end} matches with and without an explicit config`, () => {
      const s = Date.parse(start) / 1000;
      const e = Date.parse(end) / 1000;
      expect(businessHoursBetween(s, e, DEFAULT_BUSINESS_HOURS)).toBe(businessHoursBetween(s, e));
    });
  }

  it("businessDaySeconds() default equals BUSINESS_DAY_SECONDS", () => {
    expect(businessDaySeconds()).toBe(BUSINESS_DAY_SECONDS);
  });

  it("a holiday in the config removes that day's hours", () => {
    const s = Date.parse("2026-07-06T00:00:00Z") / 1000; // Monday
    const e = Date.parse("2026-07-07T00:00:00Z") / 1000;
    const base = businessHoursBetween(s, e);
    const withHoliday = businessHoursBetween(s, e, {
      ...DEFAULT_BUSINESS_HOURS,
      holidays: ["2026-07-06"],
    });
    expect(base).toBeGreaterThan(0);
    expect(withHoliday).toBe(0);
  });
});
