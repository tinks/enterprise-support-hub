import { describe, it, expect } from "vitest";
import { computeSla, businessHoursBetween, formatBusinessDuration, type SlaResult } from "@/lib/slaMetrics";

describe("formatBusinessDuration", () => {
  it("null → '—'", () => expect(formatBusinessDuration(null)).toBe("—"));
  it("sub-day values use hours+minutes", () => {
    expect(formatBusinessDuration(14400)).toBe("4h 0m");
  });
  it("exactly 1 business day (15h) → '1bd'", () => {
    expect(formatBusinessDuration(54000)).toBe("1bd");
  });
  it("exactly 2 business days (30h) → '2bd'", () => {
    expect(formatBusinessDuration(108000)).toBe("2bd");
  });
  it("exactly 5 business days (75h) → '5bd'", () => {
    expect(formatBusinessDuration(270000)).toBe("5bd");
  });
  it("4 business days + 6h (66h) → '4bd 6h'", () => {
    expect(formatBusinessDuration(237600)).toBe("4bd 6h");
  });
});


// Business-hours vs calendar pair fields on SlaResult.
const BH_PAIRS: Array<[keyof SlaResult, keyof SlaResult]> = [
  ["firstResponseAnyAgentS", "firstResponseAnyAgentBusinessHoursS"],
  ["timeToEscalationS", "timeToEscalationBusinessHoursS"],
  ["firstHumanReplyFromEscalationS", "firstHumanReplyFromEscalationBusinessHoursS"],
  ["firstHumanReplyFromOpenS", "firstHumanReplyFromOpenBusinessHoursS"],
];

function assertBhInvariants(r: SlaResult) {
  for (const [cal, bh] of BH_PAIRS) {
    const c = r[cal] as number | null;
    const b = r[bh] as number | null;
    // Null on calendar => null on BH; else BH is number >= 0 and <= calendar.
    if (c == null) {
      expect(b, `${String(bh)} should be null when ${String(cal)} is null`).toBeNull();
    } else {
      expect(typeof b === "number" && b >= 0, `${String(bh)} must be a non-negative number`).toBe(true);
      expect((b as number) <= c, `${String(bh)} (${b}) must be <= ${String(cal)} (${c})`).toBe(true);
    }
  }
}

// ============================================================================
// businessHoursBetween — focused unit tests (Europe/Berlin, DST-aware)
// ============================================================================
// Use fixed Berlin-local wall-clock times. June 2025 is CEST (UTC+2) so
// Berlin 10:00 = UTC 08:00, Berlin 23:00 = UTC 21:00.
describe("businessHoursBetween — Europe/Berlin business hours", () => {
  // 2025-06-02 is a Monday.
  const monday10Berlin = Date.UTC(2025, 5, 2, 8, 0, 0) / 1000;  // 10:00 Berlin
  const monday12Berlin = Date.UTC(2025, 5, 2, 10, 0, 0) / 1000; // 12:00 Berlin
  const monday23Berlin = Date.UTC(2025, 5, 2, 21, 0, 0) / 1000; // 23:00 Berlin
  const tuesday10Berlin = Date.UTC(2025, 5, 3, 8, 0, 0) / 1000; // Tue 10:00 Berlin
  // Saturday 2025-06-07 00:00 Berlin → Monday 2025-06-09 00:00 Berlin.
  const sat00Berlin = Date.UTC(2025, 5, 6, 22, 0, 0) / 1000; // Fri 22:00 UTC = Sat 00:00 CEST
  const mon00Berlin = Date.UTC(2025, 5, 8, 22, 0, 0) / 1000; // Sun 22:00 UTC = Mon 00:00 CEST

  const case1 = businessHoursBetween(monday10Berlin, monday12Berlin);
  const case2 = businessHoursBetween(monday23Berlin, tuesday10Berlin);
  const case3 = businessHoursBetween(sat00Berlin, mon00Berlin);

  // eslint-disable-next-line no-console
  console.log("businessHoursBetween cases:", {
    case1_mon_10_to_12: case1,
    case2_mon23_to_tue10: case2,
    case3_full_weekend: case3,
    calendar1: monday12Berlin - monday10Berlin,
    calendar2: tuesday10Berlin - monday23Berlin,
    calendar3: mon00Berlin - sat00Berlin,
  });

  it("(i) fully inside a single weekday window 10:00→12:00 == 7200s (BH == calendar)", () => {
    expect(case1).toBe(7200);
    expect(case1).toBe(monday12Berlin - monday10Berlin);
  });

  it("(ii) overnight weekday 23:00→next-day 10:00 == 7200s BH (calendar is 11h)", () => {
    expect(case2).toBe(7200);
    expect(tuesday10Berlin - monday23Berlin).toBe(11 * 3600);
    expect(case2).toBeLessThan(tuesday10Berlin - monday23Berlin);
  });

  it("(iii) full Sat+Sun == 0 BH", () => {
    expect(case3).toBe(0);
  });

  it("(iv) invariant BH ≤ calendar for arbitrary spans", () => {
    const spans: Array<[number, number]> = [
      [monday10Berlin, tuesday10Berlin],
      [monday10Berlin, mon00Berlin],
      [monday10Berlin, sat00Berlin],
      [monday23Berlin, mon00Berlin],
    ];
    for (const [a, b] of spans) {
      const bh = businessHoursBetween(a, b);
      const cal = b - a;
      expect(bh).toBeGreaterThanOrEqual(0);
      expect(bh).toBeLessThanOrEqual(cal);
    }
  });
});


const CREATED_AT = 1_000_000_000;

// Fixture A: AI-handled then handed off to human.
// Includes an EARLY routing team-assignment at +1 (must be ignored) and a
// post-Sam team-assignment at +203 (the real escalation).
const conversation = {
  created_at: CREATED_AT,
  source: {
    author: { type: "user", id: "cust-1", name: "Customer" },
    body: "<p>help please</p>",
  },
  conversation_parts: {
    conversation_parts: [
      {
        // Initial routing — Sam-authored team assignment BEFORE Sam replies. Must be ignored.
        created_at: CREATED_AT + 1,
        part_type: "assignment",
        author: { type: "admin", id: "9520895", name: "Sam" },
        body: "",
        assigned_to: { type: "team", id: "team-42" },
      },
      {
        created_at: CREATED_AT + 5,
        part_type: "comment",
        author: { type: "bot", id: "bot-1", name: "Lovable Support" },
        body: "<p>auto reply</p>",
      },
      {
        created_at: CREATED_AT + 202,
        part_type: "comment",
        author: { type: "admin", id: "9520895", name: "Sam", email: "lovable@parahelp.com" },
        body: "<p>Sam here, looking into it</p>",
      },
      {
        // Post-Sam team assignment — the real escalation.
        created_at: CREATED_AT + 203,
        part_type: "assignment",
        author: { type: "admin", id: "9520895", name: "Sam" },
        body: "",
        assigned_to: { type: "team", id: "team-42" },
      },
      {
        created_at: CREATED_AT + 300,
        part_type: "note",
        author: { type: "admin", id: "10765619", name: "Matt" },
        body: "<p>internal note</p>",
      },
      {
        created_at: CREATED_AT + 1533,
        part_type: "assignment",
        author: { type: "admin", id: "10765619", name: "Matt" },
        body: "<p>Hi — Matt from Lovable, taking this over.</p>",
        assigned_to: { type: "admin", id: "10765619" },
      },
    ],
  },
  statistics: { time_to_last_close: null, count_reopens: 0 },
};

describe("computeSla — AI then human handoff", () => {
  const r = computeSla(conversation);
  // eslint-disable-next-line no-console
  console.log("Fixture A result:", {
    firstResponseAnyAgentS: r.firstResponseAnyAgentS,
    timeToEscalationS: r.timeToEscalationS,
    escalationBasis: r.escalationBasis,
    firstHumanReplyFromEscalationS: r.firstHumanReplyFromEscalationS,
    firstHumanReplyFromOpenS: r.firstHumanReplyFromOpenS,
    partsCount: r.partsCount,
  });

  it("first response counts Sam, not the operator bot", () => {
    expect(r.firstResponseAnyAgentS).toBe(202);
  });
  it("escalation anchors on post-AI team assignment at +203 (ignores +1 routing)", () => {
    expect(r.timeToEscalationS).toBe(203);
    expect(r.escalationBasis).toBe("post_ai_handoff");
  });
  it("first human reply from escalation = 1533 - 203 = 1330", () => {
    expect(r.firstHumanReplyFromEscalationS).toBe(1330);
  });
  it("first human reply from open = 1533", () => {
    expect(r.firstHumanReplyFromOpenS).toBe(1533);
  });
  it("note is present in timeline but does NOT count as reply", () => {
    const note = r.timeline.find((p) => p.partType === "note");
    expect(note).toBeTruthy();
    expect(note!.isPublicReply).toBe(false);
  });
  it("assignment-with-body IS a public reply", () => {
    const asg = r.timeline.find((p) => p.partType === "assignment" && p.body.length > 0);
    expect(asg).toBeTruthy();
    expect(asg!.isPublicReply).toBe(true);
  });
  it("flags: sam participated, human replied, customer present", () => {
    expect(r.flags.samParticipated).toBe(true);
    expect(r.flags.noHumanReply).toBe(false);
    expect(r.flags.noCustomerParticipant).toBe(false);
  });
  it("business-hours variants ≤ calendar counterparts and ≥ 0", () => {
    assertBhInvariants(r);
  });
});

// Fixture B: straight to human, no AI turn.
const straightToHuman = {
  created_at: CREATED_AT,
  source: {
    author: { type: "user", id: "cust-2", name: "Customer" },
    body: "<p>urgent</p>",
  },
  conversation_parts: {
    conversation_parts: [
      {
        created_at: CREATED_AT + 1,
        part_type: "assignment",
        author: { type: "admin", id: "10765619", name: "Matt" },
        body: "",
        assigned_to: { type: "team", id: "team-42" },
      },
      {
        created_at: CREATED_AT + 600,
        part_type: "comment",
        author: { type: "admin", id: "10765619", name: "Matt" },
        body: "<p>Matt here.</p>",
      },
    ],
  },
  statistics: { time_to_last_close: null, count_reopens: 0 },
};

describe("computeSla — straight to human (no AI turn)", () => {
  const r = computeSla(straightToHuman);
  // eslint-disable-next-line no-console
  console.log("Fixture B result:", {
    timeToEscalationS: r.timeToEscalationS,
    escalationBasis: r.escalationBasis,
    firstHumanReplyFromEscalationS: r.firstHumanReplyFromEscalationS,
    samParticipated: r.flags.samParticipated,
  });

  it("falls back to team_assignment at +1", () => {
    expect(r.timeToEscalationS).toBe(1);
    expect(r.escalationBasis).toBe("team_assignment");
  });
  it("first human reply from escalation = 600 - 1 = 599", () => {
    expect(r.firstHumanReplyFromEscalationS).toBe(599);
  });
  it("sam did not participate", () => {
    expect(r.flags.samParticipated).toBe(false);
  });
  it("business-hours variants ≤ calendar counterparts and ≥ 0", () => {
    assertBhInvariants(r);
  });
});

// Fixture C: Slack-native — teammate mirrored into Intercom as author.type "user"
// under a contact id, but with a @lovable.dev email. Must classify as human_admin.
const slackTeammateMirrored = {
  created_at: CREATED_AT,
  source: {
    author: { type: "lead", id: "cust-x", name: "Mariah", email: "mariah@checkr.com" },
    body: "<p>question</p>",
  },
  conversation_parts: {
    conversation_parts: [
      {
        created_at: CREATED_AT + 29415,
        part_type: "comment",
        author: { type: "user", id: "contact-tine", name: "Tine Saint-Ghislain", email: "tine@lovable.dev" },
        body: "<p>here's the answer</p>",
      },
      {
        created_at: CREATED_AT + 40000,
        part_type: "comment",
        author: { type: "user", id: "cust-x", name: "Mariah", email: "mariah@checkr.com" },
        body: "<p>thanks</p>",
      },
    ],
  },
  statistics: { time_to_last_close: null, count_reopens: 0 },
};

describe("computeSla — Slack-mirrored teammate reply (author.type user, @lovable.dev)", () => {
  const r = computeSla(slackTeammateMirrored);
  // eslint-disable-next-line no-console
  console.log("Fixture C result:", {
    firstHumanReplyFromOpenS: r.firstHumanReplyFromOpenS,
    noHumanReply: r.flags.noHumanReply,
    samParticipated: r.flags.samParticipated,
    actors: r.timeline.map((p) => ({ name: p.authorName, actor: p.actor })),
  });

  it("teammate mirrored via Slack classifies as human_admin", () => {
    const tine = r.timeline.find((p) => p.authorName === "Tine Saint-Ghislain");
    expect(tine).toBeTruthy();
    expect(tine!.actor).toBe("human_admin");
  });
  it("customer parts still classify as customer", () => {
    const customers = r.timeline.filter((p) => p.authorName === "Mariah");
    expect(customers.length).toBeGreaterThan(0);
    for (const c of customers) expect(c.actor).toBe("customer");
  });
  it("first human reply from open = 29415 (the mirrored teammate reply)", () => {
    expect(r.firstHumanReplyFromOpenS).toBe(29415);
  });
  it("flags: human replied, sam did not participate, customer present", () => {
    expect(r.flags.noHumanReply).toBe(false);
    expect(r.flags.samParticipated).toBe(false);
    expect(r.flags.noCustomerParticipant).toBe(false);
  });
  it("business-hours variants ≤ calendar counterparts and ≥ 0", () => {
    assertBhInvariants(r);
  });
});

// Fixture D: internal-only thread — CSM + admin + bot, no external customer.
const internalOnly = {
  created_at: CREATED_AT,
  source: {
    author: { type: "user", id: "csm-1", name: "CSM", email: "csm@lovable.dev" },
    body: "<p>filing on behalf of customer</p>",
  },
  conversation_parts: {
    conversation_parts: [
      {
        created_at: CREATED_AT + 60,
        part_type: "comment",
        author: { type: "bot", id: "bot-1", name: "Lovable Support" },
        body: "<p>auto reply</p>",
      },
      {
        created_at: CREATED_AT + 300,
        part_type: "comment",
        author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" },
        body: "<p>on it</p>",
      },
      {
        created_at: CREATED_AT + 900,
        part_type: "comment",
        author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" },
        body: "<p>done, relaying externally</p>",
      },
    ],
  },
  statistics: { time_to_last_close: null, count_reopens: 0 },
};

describe("computeSla — internal-only thread (no customer participant)", () => {
  const r = computeSla(internalOnly);
  it("flags.noCustomerParticipant is true", () => {
    expect(r.flags.noCustomerParticipant).toBe(true);
  });
  it("no timeline part classifies as customer", () => {
    expect(r.timeline.some((p) => p.actor === "customer")).toBe(false);
  });
});

// ============================================================================
// SLA compliance targets — parseSeverity + evaluateCompliance
// ============================================================================
import {
  parseSeverity,
  evaluateCompliance,
  SLA_TARGETS,
  BUSINESS_DAY_SECONDS,
  type SlaResult as SlaResult2,
} from "@/lib/slaMetrics";

describe("parseSeverity", () => {
  it("accepts string digits 1..4", () => {
    expect(parseSeverity("1")).toBe(1);
    expect(parseSeverity("2")).toBe(2);
    expect(parseSeverity("3")).toBe(3);
    expect(parseSeverity("4")).toBe(4);
  });
  it("accepts numeric 1..4", () => {
    expect(parseSeverity(2)).toBe(2);
  });
  it("returns null for 0, blank, non-numeric, null, undefined", () => {
    expect(parseSeverity("0")).toBeNull();
    expect(parseSeverity("")).toBeNull();
    expect(parseSeverity("foo")).toBeNull();
    expect(parseSeverity(null)).toBeNull();
    expect(parseSeverity(undefined)).toBeNull();
    expect(parseSeverity(5)).toBeNull();
  });
  it("does NOT default unknown to any severity (surface-errors-loudly)", () => {
    expect(parseSeverity({})).toBeNull();
    expect(parseSeverity([])).toBeNull();
  });
});

// Minimal SlaResult factory — only the fields evaluateCompliance reads.
function mkSla(over: Partial<SlaResult2>): SlaResult2 {
  return {
    createdAtS: 0,
    enterpriseInboxAssignedAtS: null,
    slaClockStartS: 0,
    preInboxTimeS: null,
    firstResponseAnyAgentS: null,
    firstResponseAnyAgentBusinessHoursS: null,
    timeToEscalationS: null,
    timeToEscalationBusinessHoursS: null,
    escalationTs: null,
    escalationBasis: null,
    firstHumanReplyFromEscalationS: null,
    firstHumanReplyFromEscalationBusinessHoursS: null,
    firstHumanReplyFromOpenS: null,
    firstHumanReplyFromOpenBusinessHoursS: null,
    firstHumanReplyFromInboxS: null,
    firstHumanReplyFromInboxBusinessHoursS: null,
    firstSupportReplyS: null,
    firstSupportReplyFromInboxS: null,
    firstSupportReplyFromInboxBusinessHoursS: null,

    ttrS: null,
    ttrBusinessHoursS: null,
    resolutionActiveS: null,
    resolutionActiveBusinessHoursS: null,
    reopenCount: 0,
    handlingTimeS: 0,
    handlingTimeBusinessHoursS: 0,
    partsCount: 0,
    flags: { isTicket: false, samParticipated: false, noHumanReply: false, hasParts: false, noCustomerParticipant: false, manuallyLogged: false },
    initiatedBy: "customer",
    timeline: [],
    ...over,
  };
}

describe("evaluateCompliance", () => {
  it("Sev2 support reply just under 4h business → firstResponse.met = true", () => {
    const sla = mkSla({ firstSupportReplyFromInboxBusinessHoursS: 4 * 3600 - 1, firstSupportReplyFromInboxS: 4 * 3600 - 1 });
    const c = evaluateCompliance(sla, 2);
    expect(c.firstResponse.clock).toBe("business");
    expect(c.firstResponse.target).toBe(SLA_TARGETS[2].firstResponseS);
    expect(c.firstResponse.met).toBe(true);
  });
  it("Sev2 support reply just over 4h business → firstResponse.met = false", () => {
    const sla = mkSla({ firstSupportReplyFromInboxBusinessHoursS: 4 * 3600 + 1 });
    const c = evaluateCompliance(sla, 2);
    expect(c.firstResponse.met).toBe(false);
  });
  it("clamped FRT of 0 (support replied before the inbox anchor) → met = true", () => {
    const sla = mkSla({ firstSupportReplyFromInboxS: 0, firstSupportReplyFromInboxBusinessHoursS: 0 });
    for (const sev of [1, 2, 3, 4] as const) {
      expect(evaluateCompliance(sla, sev).firstResponse.met).toBe(true);
    }
  });
  it("Sev4 resolution.met stays null regardless of ttr", () => {
    const sla = mkSla({ ttrBusinessHoursS: 999999, ttrS: 999999 });
    const c = evaluateCompliance(sla, 4);
    expect(c.resolution.target).toBeNull();
    expect(c.resolution.met).toBeNull();
  });
  it("both firstSupportReplyFromInbox values null → firstResponse.met = null (not-evaluable)", () => {
    const sla = mkSla({ firstSupportReplyFromInboxS: null, firstSupportReplyFromInboxBusinessHoursS: null });
    for (const sev of [1, 2, 3, 4] as const) {
      const c = evaluateCompliance(sla, sev);
      expect(c.firstResponse.value).toBeNull();
      expect(c.firstResponse.met).toBeNull();
    }
  });
  it("a human_admin reply with NO support reply → firstResponse not-evaluable", () => {
    const sla = mkSla({
      firstHumanReplyFromInboxS: 60,
      firstHumanReplyFromInboxBusinessHoursS: 60,
      firstSupportReplyFromInboxS: null,
      firstSupportReplyFromInboxBusinessHoursS: null,
    });
    expect(evaluateCompliance(sla, 2).firstResponse.met).toBeNull();
  });
  it("Sev1 uses calendar clocks for both first response and resolution", () => {
    const sla = mkSla({ firstSupportReplyFromInboxS: 20 * 60, ttrS: 4 * 3600, resolutionActiveS: 4 * 3600 });
    const c = evaluateCompliance(sla, 1);
    expect(c.firstResponse.clock).toBe("calendar");
    expect(c.resolution.clock).toBe("calendar");
    expect(c.firstResponse.met).toBe(true);
    expect(c.resolution.met).toBe(true);
  });
  it("BUSINESS_DAY_SECONDS = 15h (54000)", () => {
    expect(BUSINESS_DAY_SECONDS).toBe(15 * 3600);
  });

  // FRT source: SUPPORT reply, anchored to the Enterprise Inbox and clamped.
  // FromOpen / FromEscalation / FromInbox(human) are retained on SlaResult for
  // back-compat but are NOT used for compliance.
  it("FR reads firstSupportReplyFromInbox regardless of escalationBasis", () => {
    const sla = mkSla({
      escalationBasis: "post_ai_handoff",
      firstSupportReplyFromInboxBusinessHoursS: 30 * 60,        // anchored — the one used
      firstHumanReplyFromEscalationBusinessHoursS: 15 * 3600,   // must be ignored
      firstHumanReplyFromOpenBusinessHoursS: 15 * 3600,         // must be ignored
      firstHumanReplyFromInboxBusinessHoursS: 15 * 3600,        // must be ignored
    });
    const c = evaluateCompliance(sla, 2);
    expect(c.firstResponse.value).toBe(30 * 60);
    expect(c.firstResponse.met).toBe(true);
  });
  it("FromOpen ignored even when FromInbox is set differently", () => {
    const sla = mkSla({
      escalationBasis: "first_human",
      firstSupportReplyFromInboxBusinessHoursS: 30 * 60,
      firstHumanReplyFromOpenBusinessHoursS: 15 * 3600,
    });
    const c = evaluateCompliance(sla, 2);
    expect(c.firstResponse.value).toBe(30 * 60);
    expect(c.firstResponse.met).toBe(true);
  });

});

// FIX 2: Stop-the-clock resolution.
import { computeSla as computeSlaSTC } from "@/lib/slaMetrics";

describe("computeSla — stop-the-clock resolutionActiveS", () => {
  const CREATED = 2_000_000_000;
  const stopClockConv = {
    created_at: CREATED,
    source: {
      author: { type: "user", id: "cust-9", name: "Customer" },
      body: "<p>help</p>",
    },
    conversation_parts: {
      conversation_parts: [
        // We reply ~1h in.
        {
          created_at: CREATED + 3600,
          part_type: "comment",
          author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" },
          body: "<p>looking</p>",
        },
        // Customer replies ~10h later (we were waiting on them — NOT counted).
        {
          created_at: CREATED + 3600 + 10 * 3600,
          part_type: "comment",
          author: { type: "user", id: "cust-9", name: "Customer" },
          body: "<p>more info</p>",
        },
        // We reply + close ~1h later.
        {
          created_at: CREATED + 3600 + 10 * 3600 + 3600,
          part_type: "comment",
          author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" },
          body: "<p>fixed</p>",
        },
      ],
    },
    statistics: {
      time_to_last_close: 12 * 3600,
      last_close_at: CREATED + 3600 + 10 * 3600 + 3600,
      count_reopens: 0,
    },
  };

  const r = computeSlaSTC(stopClockConv);
  it("resolutionActiveS ≈ 2h (the two in-our-court intervals)", () => {
    expect(r.resolutionActiveS).toBe(2 * 3600);
  });
  it("resolutionActiveS < calendar close-open (~12h)", () => {
    const calendar = 12 * 3600;
    expect(r.resolutionActiveS!).toBeLessThan(calendar);
  });
  it("ttrS remains present (back-compat)", () => {
    expect(r.ttrS).toBe(12 * 3600);
  });
});

// ============================================================================
// Initiation classification
// ============================================================================
describe("computeSla — initiatedBy", () => {
  const T0 = 3_000_000_000;
  it("source authored by a @lovable.dev admin → 'agent'", () => {
    const conv = {
      created_at: T0,
      source: { author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>reaching out</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    };
    expect(computeSla(conv).initiatedBy).toBe("agent");
  });
  it("source authored by an external customer → 'customer'", () => {
    const conv = {
      created_at: T0,
      source: { author: { type: "user", id: "cust-9", name: "Alice", email: "alice@acme.com" }, body: "<p>help</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    };
    expect(computeSla(conv).initiatedBy).toBe("customer");
  });
  it("missing source → defaults to 'customer' (anti-masking)", () => {
    const conv = { created_at: T0, conversation_parts: { conversation_parts: [] }, statistics: {} };
    expect(computeSla(conv).initiatedBy).toBe("customer");
  });
  it("Sam-opened conversation → 'agent'", () => {
    const conv = {
      created_at: T0,
      source: { author: { type: "admin", id: "9520895", name: "Sam", email: "lovable@parahelp.com" }, body: "<p>proactive</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    };
    expect(computeSla(conv).initiatedBy).toBe("agent");
  });
});



// ============================================================================
// Enterprise Inbox anchor — clock-start = first assignment to team 8484447
// ============================================================================
import { ENTERPRISE_INBOX_TEAM_ID } from "@/lib/slaMetrics";

describe("computeSla — Enterprise Inbox anchor", () => {
  const T = 4_000_000_000;
  it("anchor = ts of first team-8484447 assignment; slaClockStartS = anchor", () => {
    const conv = {
      created_at: T,
      source: { author: { type: "user", id: "cust", name: "C" }, body: "<p>help</p>" },
      conversation_parts: {
        conversation_parts: [
          // Sam replies before inbox assignment — must NOT anchor.
          { created_at: T + 100, part_type: "comment", author: { type: "admin", id: "9520895", name: "Sam", email: "lovable@parahelp.com" }, body: "<p>auto</p>" },
          // Routing to some other team — must be ignored for anchor.
          { created_at: T + 150, part_type: "assignment", author: { type: "admin", id: "9520895" }, body: "", assigned_to: { type: "team", id: "team-other" } },
          // Enterprise Inbox assignment — THE anchor.
          { created_at: T + 500, part_type: "assignment", author: { type: "admin", id: "9520895" }, body: "", assigned_to: { type: "team", id: ENTERPRISE_INBOX_TEAM_ID } },
          // Human reply after anchor.
          { created_at: T + 800, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>hi</p>" },
        ],
      },
      statistics: {},
    };
    const r = computeSla(conv);
    expect(r.enterpriseInboxAssignedAtS).toBe(T + 500);
    expect(r.slaClockStartS).toBe(T + 500);
    expect(r.preInboxTimeS).toBe(500);
  });

  it("no inbox assignment → slaClockStartS falls back to createdAt; anchor + preInboxTime null", () => {
    const conv = {
      created_at: T,
      source: { author: { type: "user", id: "cust", name: "C" }, body: "<p>help</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    };
    const r = computeSla(conv);
    expect(r.enterpriseInboxAssignedAtS).toBeNull();
    expect(r.slaClockStartS).toBe(T);
    expect(r.preInboxTimeS).toBeNull();
  });
});

describe("computeSla — firstHumanReplyFromInbox (anchored FRT)", () => {
  const T = 5_000_000_000;
  const withParts = (parts: any[]) => ({
    created_at: T,
    source: { author: { type: "user", id: "cust", name: "C" }, body: "<p>help</p>" },
    conversation_parts: { conversation_parts: parts },
    statistics: {},
  });

  it("human reply BEFORE inbox anchor is ignored; first reply AT/AFTER is measured", () => {
    const r = computeSla(withParts([
      // Pre-anchor human reply (e.g., during intake) — must NOT count.
      { created_at: T + 100, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>early</p>" },
      // Anchor.
      { created_at: T + 500, part_type: "assignment", author: { type: "admin", id: "9520895" }, body: "", assigned_to: { type: "team", id: ENTERPRISE_INBOX_TEAM_ID } },
      // Human reply after anchor.
      { created_at: T + 900, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>real</p>" },
    ]));
    expect(r.firstHumanReplyFromInboxS).toBe(400); // 900 - 500
  });

  it("no human reply after the anchor → firstHumanReplyFromInboxS null", () => {
    const r = computeSla(withParts([
      { created_at: T + 100, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>early only</p>" },
      { created_at: T + 500, part_type: "assignment", author: { type: "admin", id: "9520895" }, body: "", assigned_to: { type: "team", id: ENTERPRISE_INBOX_TEAM_ID } },
    ]));
    expect(r.firstHumanReplyFromInboxS).toBeNull();
    expect(r.firstHumanReplyFromInboxBusinessHoursS).toBeNull();
  });

  it("no anchor (fallback to createdAt) → measures from open", () => {
    const r = computeSla(withParts([
      { created_at: T + 300, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>hi</p>" },
    ]));
    expect(r.firstHumanReplyFromInboxS).toBe(300);
  });
});

describe("computeSla — resolutionActiveS anchored to inbox", () => {
  const T = 6_000_000_000;
  it("only counts in-our-court time from anchor forward; pre-anchor Sam handling excluded", () => {
    const conv = {
      created_at: T,
      source: { author: { type: "user", id: "cust", name: "C" }, body: "<p>help</p>" },
      conversation_parts: {
        conversation_parts: [
          // Sam handles a big chunk pre-anchor — MUST be excluded.
          { created_at: T + 3600, part_type: "comment", author: { type: "admin", id: "9520895", name: "Sam", email: "lovable@parahelp.com" }, body: "<p>auto</p>" },
          // Anchor at +10000.
          { created_at: T + 10000, part_type: "assignment", author: { type: "admin", id: "9520895" }, body: "", assigned_to: { type: "team", id: ENTERPRISE_INBOX_TEAM_ID } },
          // Human reply at +11000 (ball leaves our court).
          { created_at: T + 11000, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>looking</p>" },
          // Customer replies at +20000 (ball back — segStart = 20000).
          { created_at: T + 20000, part_type: "comment", author: { type: "user", id: "cust", name: "C" }, body: "<p>more</p>" },
          // We reply + close at +21000 (segment +20000→+21000 = 1000s).
          { created_at: T + 21000, part_type: "comment", author: { type: "admin", id: "10765619", name: "Matt", email: "matt@lovable.dev" }, body: "<p>done</p>" },
        ],
      },
      statistics: { last_close_at: T + 21000, time_to_last_close: 21000, count_reopens: 0 },
    };
    const r = computeSla(conv);
    // From anchor (10000) → first human reply (11000) = 1000s; customer 20000 → close 21000 = 1000s. Total 2000s.
    expect(r.resolutionActiveS).toBe(2000);
    // Old-style total ttrS still reflects createdAt→close.
    expect(r.ttrS).toBe(21000);
  });
});

describe("computeSla — manuallyLogged flag", () => {
  it("true when source body contains 'manually logged slack_thread' (case-insensitive)", () => {
    const r = computeSla({
      created_at: 7_000_000_000,
      source: { author: { type: "user", id: "u", name: "n" }, body: "<p>Manually Logged Slack_Thread from channel foo</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    });
    expect(r.flags.manuallyLogged).toBe(true);
  });
  it("false for a normal customer message", () => {
    const r = computeSla({
      created_at: 7_000_000_000,
      source: { author: { type: "user", id: "u", name: "n" }, body: "<p>help me please</p>" },
      conversation_parts: { conversation_parts: [] },
      statistics: {},
    });
    expect(r.flags.manuallyLogged).toBe(false);
  });
});

// ============================================================================
// Commit 2 — SUPPORT-based, clamped First Response.
// ============================================================================
describe("computeSla — support-roster FRT", () => {
  const ANCHOR_OFFSET = 3600; // inbox assignment 1h after creation
  const CREATED = 7_100_000_000;

  const conv = (replies: any[]) => ({
    created_at: CREATED,
    source: { author: { type: "user", id: "cust", name: "Cust", email: "a@acme.com" }, body: "<p>help</p>" },
    conversation_parts: {
      conversation_parts: [
        {
          created_at: CREATED + ANCHOR_OFFSET,
          part_type: "assignment",
          author: { type: "admin", id: "999", name: "router" },
          assigned_to: { type: "team", id: "8484447" },
          body: null,
        },
        ...replies,
      ],
    },
    statistics: {},
  });

  const roster = {
    supportEmails: new Set(["tine@lovable.dev"]),
    supportAdminIds: new Set(["10476723"]),
  };

  it("support reply BEFORE the inbox anchor → FRT clamped to 0 (met)", () => {
    const r = computeSla(
      conv([
        {
          created_at: CREATED + 60,
          part_type: "comment",
          author: { type: "user", id: "contact-tine", name: "Tine", email: "Tine@Lovable.dev" },
          body: "<p>on it</p>",
        },
      ]),
      roster,
    );
    expect(r.firstSupportReplyS).toBe(CREATED + 60);
    expect(r.firstSupportReplyFromInboxS).toBe(0);
    expect(r.firstSupportReplyFromInboxBusinessHoursS).toBe(0);
  });

  it("matches by intercom_admin_id too", () => {
    const r = computeSla(
      conv([
        {
          created_at: CREATED + ANCHOR_OFFSET + 600,
          part_type: "comment",
          author: { type: "admin", id: "10476723", name: "Tine" },
          body: "<p>hi</p>",
        },
      ]),
      roster,
    );
    expect(r.firstSupportReplyFromInboxS).toBe(600);
  });

  it("Sam (role=ai, not on the roster) does NOT satisfy First Response", () => {
    const r = computeSla(
      conv([
        {
          created_at: CREATED + ANCHOR_OFFSET + 30,
          part_type: "comment",
          author: { type: "admin", id: "9520895", name: "Sam", email: "lovable@parahelp.com" },
          body: "<p>AI answer</p>",
        },
      ]),
      roster,
    );
    expect(r.firstSupportReplyS).toBeNull();
    expect(r.firstSupportReplyFromInboxS).toBeNull();
  });

  it("a non-roster @lovable.dev human does NOT satisfy First Response when a roster is supplied", () => {
    const r = computeSla(
      conv([
        {
          created_at: CREATED + ANCHOR_OFFSET + 30,
          part_type: "comment",
          author: { type: "admin", id: "555", name: "CSM", email: "csm@lovable.dev" },
          body: "<p>relaying</p>",
        },
      ]),
      roster,
    );
    expect(r.firstSupportReplyFromInboxS).toBeNull();
  });

  it("NO roster → falls back to any human_admin reply (back-compat)", () => {
    const parts = [
      {
        created_at: CREATED + ANCHOR_OFFSET + 30,
        part_type: "comment",
        author: { type: "admin", id: "555", name: "CSM", email: "csm@lovable.dev" },
        body: "<p>relaying</p>",
      },
    ];
    expect(computeSla(conv(parts)).firstSupportReplyFromInboxS).toBe(30);
    expect(
      computeSla(conv(parts), { supportEmails: new Set(), supportAdminIds: new Set() })
        .firstSupportReplyFromInboxS,
    ).toBe(30);
  });

  it("extractTimeline lowercases author emails", () => {
    const r = computeSla(
      conv([
        {
          created_at: CREATED + ANCHOR_OFFSET + 30,
          part_type: "comment",
          author: { type: "user", id: "x", name: "T", email: "MiXeD@Lovable.DEV" },
          body: "<p>hi</p>",
        },
      ]),
    );
    expect(r.timeline.some((p) => p.authorEmail === "mixed@lovable.dev")).toBe(true);
  });
});
