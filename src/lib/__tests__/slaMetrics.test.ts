import { describe, it, expect } from "vitest";
import { computeSla, businessHoursBetween, type SlaResult } from "@/lib/slaMetrics";

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
      [sat00Berlin, tuesday10Berlin],
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
  it("flags: sam participated, human replied", () => {
    expect(r.flags.samParticipated).toBe(true);
    expect(r.flags.noHumanReply).toBe(false);
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
  it("flags: human replied, sam did not participate", () => {
    expect(r.flags.noHumanReply).toBe(false);
    expect(r.flags.samParticipated).toBe(false);
  });
});
