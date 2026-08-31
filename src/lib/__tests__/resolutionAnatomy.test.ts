import { describe, it, expect } from "vitest";
import { computeAnatomy, anatomyReconciles, computeEpisodes } from "@/lib/resolutionAnatomy";

const H = 3600;
const D = 86400;
const T0 = Date.UTC(2026, 7, 3, 8, 0, 0) / 1000; // Mon 2026-08-03 08:00 UTC

function conv(parts: Array<{ at: number; author: any; type?: string; body?: string }>, source: any) {
  return {
    created_at: source.at,
    source: { body: source.body ?? "help", author: source.author },
    conversation_parts: {
      conversation_parts: parts.map((p, i) => ({
        id: String(i),
        created_at: p.at,
        part_type: p.type ?? "comment",
        body: p.body ?? "text",
        author: p.author,
      })),
    },
  };
}

const CUSTOMER = { type: "user", id: "c1", email: "ada@acme.com", name: "Ada" };
const ADMIN = { type: "admin", id: "a1", email: "eren@lovable.dev", name: "Eren" };
const SAM = { type: "bot", id: "bot1", name: "Sam" };

describe("computeAnatomy", () => {
  it("splits a clean two-turn ticket", () => {
    // customer opens, we reply 2h later, customer confirms 1h later, close at +1h.
    const raw = conv(
      [
        { at: T0 + 2 * H, author: ADMIN },
        { at: T0 + 3 * H, author: CUSTOMER },
      ],
      { at: T0, author: CUSTOMER },
    );
    const a = computeAnatomy(raw, { closedAtSec: T0 + 4 * H });
    expect(a.totalS).toBe(4 * H);
    expect(a.ourClockS).toBe(3 * H); // 0→2h ours, then 3h→close ours again (customer spoke last)
    expect(a.theirClockS).toBe(1 * H);
    expect(a.driftS).toBe(0);
    expect(a.closedWithoutCustomerConfirm).toBe(false);
    expect(anatomyReconciles(a)).toBe(true);
  });

  it("attributes customer silence to their clock", () => {
    const raw = conv([{ at: T0 + H, author: ADMIN }], { at: T0, author: CUSTOMER });
    const a = computeAnatomy(raw, { closedAtSec: T0 + 10 * D });
    expect(a.ourClockS).toBe(H);
    expect(a.theirClockS).toBe(10 * D - H);
    expect(a.closedWithoutCustomerConfirm).toBe(true);
    expect(anatomyReconciles(a)).toBe(true);
  });

  it("treats Sam and bot parts as neutral — they do not discharge our reply", () => {
    const raw = conv(
      [
        { at: T0 + 5 * 60, author: SAM },
        { at: T0 + 6 * H, author: ADMIN },
      ],
      { at: T0, author: CUSTOMER },
    );
    const a = computeAnatomy(raw, { closedAtSec: T0 + 6 * H });
    expect(a.ourClockS).toBe(6 * H); // the whole pre-reply stretch stays ours
    expect(a.theirClockS).toBe(0);
    expect(a.adminReplyCount).toBe(1);
  });

  it("counts a shared relay inbox message as the customer speaking", () => {
    const relay = { type: "admin", id: "r1", email: "enterprise-support@lovable.dev", name: "Relay" };
    const raw = conv([{ at: T0 + 2 * H, author: relay }], { at: T0, author: ADMIN });
    const a = computeAnatomy(raw, { closedAtSec: T0 + 3 * H });
    // We opened (customer owed), relay message flips it back to us.
    expect(a.theirClockS).toBe(2 * H);
    expect(a.ourClockS).toBe(1 * H);
  });

  it("reports time to first close separately from the wall clock", () => {
    const raw = conv(
      [
        { at: T0 + H, author: ADMIN },
        { at: T0 + 2 * H, author: ADMIN, type: "close", body: "" },
        { at: T0 + 20 * D, author: CUSTOMER },
        { at: T0 + 21 * D, author: ADMIN },
      ],
      { at: T0, author: CUSTOMER },
    );
    const a = computeAnatomy(raw, { closedAtSec: T0 + 21 * D });
    expect(a.timeToFirstCloseS).toBe(2 * H);
    expect(a.totalS).toBe(21 * D);
  });

  it("returns nulls, never zeros, when there is no timeline", () => {
    const a = computeAnatomy({});
    expect(a.totalS).toBeNull();
    expect(a.ourClockS).toBeNull();
    expect(a.unavailableReason).toBe("no_timeline");
  });

  it("business seconds never exceed wall seconds", () => {
    const raw = conv([{ at: T0 + 4 * D, author: ADMIN }], { at: T0, author: CUSTOMER });
    const a = computeAnatomy(raw, { closedAtSec: T0 + 4 * D });
    expect(a.ourClockBizS!).toBeGreaterThan(0);
    expect(a.ourClockBizS!).toBeLessThan(a.ourClockS!);
  });
});

describe("computeEpisodes", () => {
  const CLOSE = (at: number, author: any = ADMIN) => ({ at, author, type: "close", body: "" });

  it("counts reopens from the payload even when Intercom emits no open part", () => {
    const raw = conv(
      [
        { at: T0 + H, author: ADMIN },
        CLOSE(T0 + 2 * H),
        { at: T0 + 20 * D, author: CUSTOMER }, // speaks after close ⇒ reopen
        { at: T0 + 20 * D + H, author: ADMIN },
        CLOSE(T0 + 21 * D),
      ],
      { at: T0, author: CUSTOMER },
    );
    const e = computeEpisodes(raw, { closedAtSec: T0 + 21 * D });
    expect(e.reopenCount).toBe(1);
    expect(e.firstReopenBy).toBe("customer");
    expect(e.episodes.length).toBe(2);
    expect(e.timeToFirstCloseS).toBe(2 * H);
    expect(e.betweenEpisodesS).toBe(20 * D - 2 * H);
  });

  it("labels an admin-driven reopen as ours", () => {
    const raw = conv(
      [CLOSE(T0 + H), { at: T0 + 10 * D, author: ADMIN }, CLOSE(T0 + 11 * D)],
      { at: T0, author: CUSTOMER },
    );
    const e = computeEpisodes(raw, { closedAtSec: T0 + 11 * D });
    expect(e.firstReopenBy).toBe("admin");
    expect(e.reopenCount).toBe(1);
  });

  it("reports a single episode for a never-reopened ticket", () => {
    const raw = conv([{ at: T0 + H, author: ADMIN }, CLOSE(T0 + 2 * H)], { at: T0, author: CUSTOMER });
    const e = computeEpisodes(raw, { closedAtSec: T0 + 2 * H });
    expect(e.reopenCount).toBe(0);
    expect(e.firstReopenBy).toBeNull();
    expect(e.betweenEpisodesS).toBe(0);
  });

  it("returns an empty result when there is no timeline", () => {
    expect(computeEpisodes({}).episodes).toEqual([]);
  });
});
