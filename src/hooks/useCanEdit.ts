import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns whether the signed-in user may WRITE (role `editor` or `admin`).
 * Read-only accounts (CSMs, new members) get `false`.
 *
 * UI gating only — the real enforcement is RLS via `public.can_edit()` plus the
 * `requireEditor` guard on the write edge functions.
 *
 * Mirrors useIsAdmin: only re-checks when the signed-in user id actually
 * changes, so token refresh / tab focus never flips controls off mid-session.
 */
export function useCanEdit() {
  const [canEdit, setCanEdit] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async (uid: string | null, isInitial: boolean) => {
      if (!isInitial && uid === lastUserIdRef.current) return;
      lastUserIdRef.current = uid;

      if (!uid) {
        if (!cancelled) {
          setCanEdit(false);
          setIsLoading(false);
        }
        return;
      }

      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .in("role", ["editor", "admin"]);
      if (!cancelled) {
        setCanEdit((data?.length ?? 0) > 0);
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

  return { canEdit, isLoading };
}
