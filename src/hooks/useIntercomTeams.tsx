import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cached Intercom team id -> name map (populated daily by sync-intercom-fields).
 * Falls back to the raw id when a team has never been synced.
 */
export function useIntercomTeams() {
  const [map, setMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("intercom_teams").select("team_id, name");
      if (cancelled || !data) return;
      const next: Record<string, string> = {};
      for (const row of data) next[row.team_id] = row.name;
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const teamLabel = useMemo(
    () => (id: string | null | undefined) => (id ? map[id] || id : "—"),
    [map],
  );

  return { teamMap: map, teamLabel };
}
