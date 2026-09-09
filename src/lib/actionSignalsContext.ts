// Context + hook for the Action Center signals.
//
// Deliberately NOT co-located with the provider component: a module that
// exports both a component and non-component values breaks React Fast Refresh
// ("export is incompatible"), which re-evaluates the module and creates a
// SECOND context object. Consumers then read the fallback (empty) value while
// the provider still writes to the old context — the page shows
// "0 signals watched · 0 need attention" even though every loader succeeded.

import { createContext, useContext } from "react";
import type { ActionSignal, SignalReading } from "@/lib/actionSignals";

export type SignalState = {
  signal: ActionSignal;
  status: "loading" | "ok" | "error";
  reading: SignalReading | null;
  error: string | null;
  /** Muted signals still load and display, but never raise the badge. */
  muted: boolean;
};

export type ActionSignalsCtx = {
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

export const ActionSignalsContext = createContext<ActionSignalsCtx | null>(null);

export function useActionSignals(): ActionSignalsCtx {
  const ctx = useContext(ActionSignalsContext);
  if (!ctx) {
    return {
      states: [],
      attentionCount: 0,
      errorCount: 0,
      loading: false,
      lastLoadedAt: null,
      refresh: () => {},
      mutedIds: [],
      toggleMuted: () => {},
    };
  }
  return ctx;
}
