// Hub-only "this ticket is a test" designation for v3 tickets.
//
// Truth lives on intercom_tickets_v3.is_test_ticket — a Hub column, never
// written back to Intercom. Test tickets are hidden from every reporting and
// watch surface by default; the shared `showTestData` preference (below) is the
// single explicit escape hatch that reveals them.
//
// This is deliberately per-ticket rather than per-account: the first three SSE
// tickets all carry customer_key='internal', which also covers 31 real tickets,
// so an account-level is_test flag would have swept real work out of reporting.

import { useCallback, useEffect, useState } from "react";

export type TestFlagRow = { is_test_ticket?: boolean | null };

/** True when the ticket is a Hub-designated test ticket. */
export function isTestTicket(row: TestFlagRow | null | undefined): boolean {
  return row?.is_test_ticket === true;
}

/**
 * Filter a ticket list for reporting. When `showTestData` is false (the
 * default everywhere) designated test tickets are dropped.
 */
export function excludeTestTickets<T extends TestFlagRow>(rows: T[], showTestData: boolean): T[] {
  return showTestData ? rows : rows.filter((r) => !isTestTicket(r));
}

const STORAGE_KEY = "esh.showTestData";
const EVENT = "esh:showTestData";

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared "show test data" preference. Persisted in localStorage and broadcast
 * so every mounted surface flips together — a report and the sidebar badge must
 * never disagree about whether test tickets are counted.
 */
export function useShowTestData(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(read);

  useEffect(() => {
    const onChange = () => setValue(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setValue(v);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [value, set];
}

/** Non-reactive read for modules outside React (e.g. actionSignals). */
export function showTestDataNow(): boolean {
  return read();
}
