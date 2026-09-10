import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ExternalLink, X, ChevronDown, ChevronUp } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";

/**
 * "What's broken right now" strip, shown on every page.
 *
 * Source of truth is `public.incidents`, populated by poll-slack-incidents from
 * the #incidents Slack channel. Only `status_category = 'live'` shows here:
 * Reviewing / Documenting incidents are already mitigated and belong in the log
 * at /incidents, not in an alarm banner.
 *
 * Dismissal is per browser session only (sessionStorage), keyed by the exact set
 * of live incident numbers — a NEW incident always re-opens the banner, so
 * dismissing "the noisy one" can never hide the next real outage.
 */

type LiveIncident = {
  incident_number: number;
  title: string;
  severity: string | null;
  status: string | null;
  is_customer_impacting: boolean;
  incident_url: string | null;
  status_page_url: string | null;
  incident_channel_id: string | null;
  incident_channel_name: string | null;
  declared_at: string;
};

const DISMISS_KEY = "esh-incident-banner-dismissed";
const REFRESH_MS = 60_000;

function sessionGet(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export default function IncidentBanner() {
  const [rows, setRows] = useState<LiveIncident[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(sessionGet());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("incidents")
        .select(
          "incident_number, title, severity, status, is_customer_impacting, incident_url, status_page_url, incident_channel_id, incident_channel_name, declared_at",
        )
        .eq("status_category", "live")
        .order("declared_at", { ascending: false })
        .limit(25);
      if (cancelled) return;
      // A read failure must never invent an all-clear or a fake incident: keep
      // whatever we last had and stay quiet.
      if (error) return;
      setRows((data ?? []) as LiveIncident[]);
    };

    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (rows.length === 0) return null;

  const key = rows.map((r) => r.incident_number).sort((a, b) => a - b).join(",");
  if (dismissedKey === key) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, key);
    } catch {
      /* private mode: banner simply stays */
    }
    setDismissedKey(key);
  };

  const customerImpacting = rows.filter((r) => r.is_customer_impacting).length;
  const shown = expanded ? rows : rows.slice(0, 1);

  return (
    <div className="border-b border-destructive/30 bg-destructive/10 text-sm">
      <div className="px-4 py-2 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">
              {rows.length === 1 ? "1 live incident" : `${rows.length} live incidents`}
            </span>
            {customerImpacting > 0 && (
              <span className="rounded-full bg-destructive text-destructive-foreground text-[11px] font-semibold px-2 py-0.5">
                {customerImpacting} customer-impacting
              </span>
            )}
            <Link to="/incidents" className="text-xs underline text-muted-foreground hover:text-foreground">
              Incident log
            </Link>
          </div>

          {shown.map((r) => (
            <div key={r.incident_number} className="flex items-center gap-2 flex-wrap text-foreground/90">
              <span className="text-xs text-muted-foreground">INC-{r.incident_number}</span>
              {r.severity && (
                <span className="text-xs rounded border border-border px-1.5 py-0.5">{r.severity}</span>
              )}
              <span className="truncate max-w-[60ch]">{r.title}</span>
              {r.status && <span className="text-xs text-muted-foreground">· {r.status}</span>}
              <span className="text-xs text-muted-foreground">
                · {formatDistanceToNowStrict(new Date(r.declared_at))} old
              </span>
              {r.is_customer_impacting && r.status_page_url && (
                <a
                  href={r.status_page_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline inline-flex items-center gap-1"
                >
                  Status page <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.incident_url && (
                <a
                  href={r.incident_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline inline-flex items-center gap-1"
                >
                  incident.io <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {r.incident_channel_id && (
                <a
                  href={`https://lovable-dev.slack.com/archives/${r.incident_channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline inline-flex items-center gap-1"
                >
                  {r.incident_channel_name ? `#${r.incident_channel_name}` : "Slack channel"}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}

          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              {expanded ? (
                <>
                  Show less <ChevronUp className="h-3 w-3" />
                </>
              ) : (
                <>
                  Show {rows.length - 1} more <ChevronDown className="h-3 w-3" />
                </>
              )}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss incident banner"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
