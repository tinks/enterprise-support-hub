import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Stats {
  count: number;
  medianFirstResponseSec: number | null;
  medianResponseSec: number | null;
  medianTimeToCloseSec: number | null;
  medianHandlingTimeSec: number | null;
}

function median(nums: number[]): number | null {
  const v = nums.filter((n) => typeof n === "number" && isFinite(n) && n > 0);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function monthRange(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) / 1000;
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1) / 1000;
  return [start, end];
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

async function computeStatsForMonth(
  month: string,
  inboxId: string,
  token: string,
): Promise<Stats> {
  const [start, end] = monthRange(month);

  const firstResp: number[] = [];
  const respMedian: number[] = [];
  const timeToClose: number[] = [];
  const handling: number[] = [];

  let starting_after: string | null = null;
  let pages = 0;
  let total = 0;
  const HARD_CAP = 1000;

  while (pages < 25) {
    pages++;
    const body: any = {
      query: {
        operator: "AND",
        value: [
          { field: "team_assignee_id", operator: "=", value: inboxId },
          { field: "created_at", operator: ">", value: start },
          { field: "created_at", operator: "<", value: end },
        ],
      },
      pagination: { per_page: 150, ...(starting_after ? { starting_after } : {}) },
    };

    const res = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": "2.11",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Intercom search failed [${res.status}]: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const convos: any[] = data.conversations || [];
    for (const c of convos) {
      total++;
      const s = c.statistics || {};
      if (typeof s.time_to_admin_reply === "number") firstResp.push(s.time_to_admin_reply);
      if (typeof s.median_time_to_reply === "number") respMedian.push(s.median_time_to_reply);
      if (typeof s.time_to_last_close === "number") timeToClose.push(s.time_to_last_close);
      // Handling time approximation: time to last close minus initial customer wait
      if (typeof s.time_to_last_close === "number" && typeof s.time_to_admin_reply === "number") {
        const h = s.time_to_last_close - s.time_to_admin_reply;
        if (h > 0) handling.push(h);
      }
      if (total >= HARD_CAP) break;
    }
    if (total >= HARD_CAP) break;
    starting_after = data?.pages?.next?.starting_after || null;
    if (!starting_after) break;
  }

  return {
    count: total,
    medianFirstResponseSec: median(firstResp),
    medianResponseSec: median(respMedian),
    medianTimeToCloseSec: median(timeToClose),
    medianHandlingTimeSec: median(handling),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("INTERCOM_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let month = "";
  try {
    const body = await req.json();
    month = String(body?.month || "");
  } catch {}
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return new Response(JSON.stringify({ error: "month must be YYYY-MM" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: settings } = await sb.from("settings").select("intercom_inbox_id").limit(1).single();
  const inboxId = String(settings?.intercom_inbox_id || "");
  if (!inboxId) {
    return new Response(JSON.stringify({ error: "No enterprise inbox configured" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const [current, previous] = await Promise.all([
      computeStatsForMonth(month, inboxId, token),
      computeStatsForMonth(prevMonth(month), inboxId, token),
    ]);
    return new Response(JSON.stringify({ ok: true, month, inboxId, current, previous }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
