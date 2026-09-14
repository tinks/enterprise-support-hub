import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ACTION_SIGNALS } from "@/lib/actionSignals";
import { supabase } from "@/integrations/supabase/client";
import {
  ActionSignalsContext,
  type ActionSignalsCtx,
  type SignalState,
} from "@/lib/actionSignalsContext";

// This module exports ONLY the provider component. Context, hook and types live
// in "@/lib/actionSignalsContext" so Fast Refresh never invalidates the context
// identity (see the comment there).

const MUTED_KEY = "esh.actionSignals.muted";

const readMuted = (): string[] => {
  try {
    const raw = localStorage.getItem(MUTED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
};

const initialStates = (): SignalState[] =>
  ACTION_SIGNALS.map((signal) => ({ signal, status: "loading", reading: null, error: null, muted: false }));

export function ActionSignalsProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<SignalState[]>(initialStates);
  const [mutedIds, setMutedIds] = useState<string[]>(readMuted);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const lastFetchRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Signals query SECURITY DEFINER RPCs that are granted to `authenticated`
  // only. Loading them while signed out (e.g. on /login) produced
  // "permission denied for function ..." errors in the Postgres logs, so the
  // provider stays idle until a session exists.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session);
    });
    supabase.auth.getSession().then(({ data: { session } }) => setSignedIn(!!session));
    return () => subscription.unsubscribe();
  }, []);

  const toggleMuted = useCallback((id: string) => {
    setMutedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(MUTED_KEY, JSON.stringify(next));
      } catch {
        /* non-fatal: mute is a display preference */
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!signedIn) return;
    lastFetchRef.current = Date.now();
    const results = await Promise.all(
      ACTION_SIGNALS.map(async (signal): Promise<SignalState> => {
        try {
          const reading = await signal.load();
          return { signal, status: "ok", reading, error: null, muted: false };
        } catch (e: any) {
          // Loud, never silent: a failed query is an error card, not a zero.
          return { signal, status: "error", reading: null, error: e?.message ?? String(e), muted: false };
        }
      }),
    );
    setStates(results);
    setLastLoadedAt(Date.now());
  }, [signedIn]);

  useEffect(() => {
    if (signedIn) load();
  }, [load, signedIn]);

  // Same lightweight refetch pattern as /triage: focus/visibility, debounced
  // 300ms, at most one fetch per 10s.
  useEffect(() => {
    const maybeRefetch = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (Date.now() - lastFetchRef.current < 10_000) return;
        load();
      }, 300);
    };
    window.addEventListener("focus", maybeRefetch);
    document.addEventListener("visibilitychange", maybeRefetch);
    return () => {
      window.removeEventListener("focus", maybeRefetch);
      document.removeEventListener("visibilitychange", maybeRefetch);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [load]);

  const value = useMemo<ActionSignalsCtx>(() => {
    const withMute = states.map((s) => ({ ...s, muted: mutedIds.includes(s.signal.id) }));
    const attentionCount = withMute.filter(
      (s) => !s.muted && s.status === "ok" && (s.reading?.count ?? 0) > 0,
    ).length;
    const errorCount = withMute.filter((s) => !s.muted && s.status === "error").length;
    return {
      states: withMute,
      attentionCount,
      errorCount,
      loading: withMute.some((s) => s.status === "loading"),
      lastLoadedAt,
      refresh: load,
      mutedIds,
      toggleMuted,
    };
  }, [states, mutedIds, lastLoadedAt, load, toggleMuted]);

  return <ActionSignalsContext.Provider value={value}>{children}</ActionSignalsContext.Provider>;
}

export default ActionSignalsProvider;
