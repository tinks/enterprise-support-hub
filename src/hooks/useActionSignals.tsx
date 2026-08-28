import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ACTION_SIGNALS, type ActionSignal, type SignalReading } from "@/lib/actionSignals";

export type SignalState = {
  signal: ActionSignal;
  status: "loading" | "ok" | "error";
  reading: SignalReading | null;
  error: string | null;
  /** Muted signals still load and display, but never raise the badge. */
  muted: boolean;
};

type Ctx = {
  states: SignalState[];
  /** Number of unmuted signals with count > 0. Errors are NOT counted as attention. */
  attentionCount: number;
  /** Number of signals whose loader failed. */
  errorCount: number;
  loading: boolean;
  lastLoadedAt: number | null;
  refresh: () => void;
  mutedIds: string[];
  toggleMuted: (id: string) => void;
};

const ActionSignalsContext = createContext<Ctx | null>(null);

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
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const lastFetchRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    lastFetchRef.current = Date.now();
    const results = await Promise.all(
      ACTION_SIGNALS.map(async (signal): Promise<SignalState> => {
        try {
          const reading = await signal.load();
          return { signal, status: "ok", reading, error: null };
        } catch (e: any) {
          // Loud, never silent: a failed query is an error card, not a zero.
          return { signal, status: "error", reading: null, error: e?.message ?? String(e) };
        }
      }),
    );
    setStates(results);
    setLastLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const value = useMemo<Ctx>(() => {
    const attentionCount = states.filter((s) => s.status === "ok" && (s.reading?.count ?? 0) > 0).length;
    const errorCount = states.filter((s) => s.status === "error").length;
    return {
      states,
      attentionCount,
      errorCount,
      loading: states.some((s) => s.status === "loading"),
      lastLoadedAt,
      refresh: load,
    };
  }, [states, lastLoadedAt, load]);

  return <ActionSignalsContext.Provider value={value}>{children}</ActionSignalsContext.Provider>;
}

export function useActionSignals(): Ctx {
  const ctx = useContext(ActionSignalsContext);
  if (!ctx) {
    return {
      states: [],
      attentionCount: 0,
      errorCount: 0,
      loading: false,
      lastLoadedAt: null,
      refresh: () => {},
    };
  }
  return ctx;
}
