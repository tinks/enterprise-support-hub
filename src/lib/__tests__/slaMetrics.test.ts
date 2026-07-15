import { describe, it, expect } from "vitest";
import { computeSla } from "@/lib/slaMetrics";

// Synthetic Intercom conversation per the spec.
const CREATED_AT = 1_000_000_000;

const conversation = {
  created_at: CREATED_AT,
  source: {
    author: { type: "user", id: "cust-1", name: "Customer" },
    body: "<p>help please</p>",
  },
  conversation_parts: {
    conversation_parts: [
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

describe("computeSla synthetic fixture", () => {
  const r = computeSla(conversation);
  // eslint-disable-next-line no-console
  console.log("SLA fixture result:", {
    firstResponseAnyAgentS: r.firstResponseAnyAgentS,
    timeToEscalationS: r.timeToEscalationS,
    escalationBasis: r.escalationBasis,
    firstHumanReplyFromEscalationS: r.firstHumanReplyFromEscalationS,
    firstHumanReplyFromOpenS: r.firstHumanReplyFromOpenS,
    partsCount: r.partsCount,
    samParticipated: r.flags.samParticipated,
    noHumanReply: r.flags.noHumanReply,
  });

  it("first response counts Sam, not the operator bot", () => {
    expect(r.firstResponseAnyAgentS).toBe(202);
  });
  it("escalation fires on team assignment at +203", () => {
    expect(r.timeToEscalationS).toBe(203);
    expect(r.escalationBasis).toBe("team_assignment");
  });
  it("first human reply from escalation = 1533 - 203 = 1330", () => {
    expect(r.firstHumanReplyFromEscalationS).toBe(1330);
  });
  it("first human reply from open = 1533 (assignment-with-body counts)", () => {
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
