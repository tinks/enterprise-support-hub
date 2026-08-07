import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DashboardTeammate = { to: string; label: string };

/**
 * The people who get an entry in the "Dashboards" nav flyout.
 * Sourced from `public.teammates` where the roster entry is active and the
 * admin has explicitly turned the dashboard toggle on. Sam (role='ai') is
 * never included. This is nav curation only — `/my/:owner` remains reachable
 * for any owner name, and nothing here is access control.
 */
const FALLBACK: DashboardTeammate[] = [
  { to: "/my/joel", label: "Joel" },
  { to: "/my/kristina", label: "Kristina" },
  { to: "/my/tine", label: "Tine" },
  { to: "/my/eren", label: "Eren" },
  { to: "/my/matt", label: "Matt" },
];

export function useDashboardTeammates() {
  const [items, setItems] = useState<DashboardTeammate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("teammates")
        .select("name, role, active, show_dashboard")
        .eq("active", true)
        .eq("show_dashboard", true)
        .neq("role", "ai")
        .order("name");

      if (cancelled) return;

      if (error || !data) {
        // Never leave the nav empty on a transient failure.
        setItems(FALLBACK);
      } else {
        setItems(
          data
            .filter((r: any) => !!r.name)
            .map((r: any) => ({ to: `/my/${String(r.name).toLowerCase()}`, label: r.name })),
        );
      }
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { items, isLoading };
}
