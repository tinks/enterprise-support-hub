// Engineering-wait union arithmetic (Engine v3, multi-Linear escalations).
//
// No live ticket yet has two escalation windows that BOTH contribute inside the
// resolution window, so the union/merge path in resolveEngWaitWindows is not
// exercised by production data. These tests pin it deterministically:
// overlapping, adjacent, disjoint, clamped-out, and single-issue cases.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEngineeringWait,
  customerWaitSegments,
  resolveEngWaitWindows,
  type EngEscalation,
  type TimelinePart,
} from "../_shared/sla-core.ts";

const CLOCK_START = 0;
const CLOSE_AT = 1000;
const wall = (a: number, b: number) => b - a;

function part(over: Partial<TimelinePart> & { ts: number }): TimelinePart {
  return {
    actor: "human_admin",
    authorName: null,
    authorId: null,
    authorEmail: null,
    partType: "comment",
    body: "",
    isPublicReply: false,
    isNote: false,
    assignedToType: null,
    assignedToId: null,
    eventDetails: null,
    relayFrom: null,
    ...over,
  };
}

/**
 * Customer at t=0, admin public reply at t=10, Linear reference attached at
 * t=10 — so the whole [10, 1000) stretch is waiting-on-customer and every
 * second of an engineering window inside it is convertible.
 */
const timeline: TimelinePart[] = [
  part({ ts: 0, actor: "customer", isPublicReply: true }),
  part({ ts: 10, actor: "human_admin", isPublicReply: true }),
  part({
    ts: 10,
    partType: "conversation_attribute_updated_by_admin",
    eventDetails: {
      attribute: { name: "Escalated Issue" },
      value: { name: "https://linear.app/lovable/issue/ENT-1/a" },
    },
  }),
];

const esc = (created: number, completed: number | null): EngEscalation => ({
  escalationRowAtS: null,
  linearCreatedAtS: created,
  linearCompletedAtS: completed,
  linearCanceledAtS: null,
});

function engSeconds(escs: EngEscalation[]): number {
  const segs = customerWaitSegments(timeline, CLOCK_START, CLOSE_AT);
  const windows = resolveEngWaitWindows(timeline, CLOCK_START, CLOSE_AT, escs);
  return computeEngineeringWait(segs, windows, wall)!;
}

function windowSpans(escs: EngEscalation[]): Array<[number, number]> {
  return resolveEngWaitWindows(timeline, CLOCK_START, CLOSE_AT, escs)
    .map((w) => [w.startS!, w.endS!] as [number, number]);
}

Deno.test("wait segment covers the whole post-reply window", () => {
  assertEquals(customerWaitSegments(timeline, CLOCK_START, CLOSE_AT), [
    { startS: 10, endS: CLOSE_AT },
  ]);
});

Deno.test("single issue is unchanged by the multi-issue path", () => {
  assertEquals(windowSpans([esc(100, 500)]), [[100, 500]]);
  assertEquals(engSeconds([esc(100, 500)]), 400);
});

Deno.test("overlapping issues merge and never double-count", () => {
  const escs = [esc(100, 500), esc(400, 700)];
  assertEquals(windowSpans(escs), [[100, 700]]);
  // 600, not 400 + 300 = 700.
  assertEquals(engSeconds(escs), 600);
});

Deno.test("fully contained issue adds nothing", () => {
  const escs = [esc(100, 700), esc(200, 300)];
  assertEquals(windowSpans(escs), [[100, 700]]);
  assertEquals(engSeconds(escs), 600);
});

Deno.test("adjacent issues merge into one continuous window", () => {
  const escs = [esc(100, 300), esc(300, 500)];
  assertEquals(windowSpans(escs), [[100, 500]]);
  assertEquals(engSeconds(escs), 400);
});

Deno.test("disjoint issues stay separate and the gap is customer wait", () => {
  const escs = [esc(100, 200), esc(500, 600)];
  assertEquals(windowSpans(escs), [[100, 200], [500, 600]]);
  assertEquals(engSeconds(escs), 200);
});

Deno.test("input order does not change the result", () => {
  assertEquals(engSeconds([esc(400, 700), esc(100, 500)]), 600);
  assertEquals(engSeconds([esc(500, 600), esc(100, 200)]), 200);
});

Deno.test("issue created after the ticket closed is clamped away", () => {
  // The real shape of 215475479744265: ENT-3478 in window, ENT-3798 filed later.
  const escs = [esc(100, 500), esc(1200, null)];
  assertEquals(windowSpans(escs), [[100, 500]]);
  assertEquals(engSeconds(escs), 400);
});

Deno.test("open issue runs to the ticket close, and swallows a second issue", () => {
  const escs = [esc(100, null), esc(600, 800)];
  assertEquals(windowSpans(escs), [[100, CLOSE_AT]]);
  assertEquals(engSeconds(escs), 900);
});

Deno.test("eng wait never exceeds the customer-wait it is carved from", () => {
  const escs = [esc(0, null), esc(200, null)];
  const waitTotal = CLOSE_AT - 10;
  assertEquals(engSeconds(escs) <= waitTotal, true);
  assertEquals(engSeconds(escs), waitTotal); // window clamps to the wait start
});
