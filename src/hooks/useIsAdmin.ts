import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns whether the currently signed-in user has the `admin` role.
 * Server-side enforcement always comes from RLS policies + `has_role()`;
 * this hook is only for UI gating (hiding nav items, disabling buttons).
 *
 * Only re-checks when the signed-in user id actually changes. We deliberately
 * ignore `TOKEN_REFRESHED` (and other same-user auth events) — those fire on
 * tab focus / silent token refresh and would otherwise flip `isLoading` back
 * to true, making admin-gated cards briefly unmount when the user switches
 * browser tabs.
 */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async (uid: string | null, isInitial: boolean) => {
      // Skip if the user hasn't changed — avoids flicker on token refresh /
      // tab-visibility auth events.
      if (!isInitial && uid === lastUserIdRef.current) return;
      lastUserIdRef.current = uid;

      if (!uid) {
        if (!cancelled) {
          setIsAdmin(false);
          setIsLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "admin")
        .maybeSingle();
      if (!cancelled) {
        setIsAdmin(!!data);
        setIsLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      check(data.session?.user?.id ?? null, true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      check(session?.user?.id ?? null, false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return { isAdmin, isLoading };
}
