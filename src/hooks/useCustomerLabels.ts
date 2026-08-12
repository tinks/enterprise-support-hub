import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CustomerAccountOption = { account_key: string; label: string };

/**
 * Single source of truth for turning a `customer_key` into a display label.
 * Previously duplicated (with drifting special-case handling) across every issue view.
 */
export function useCustomerLabels() {
  const [accounts, setAccounts] = useState<CustomerAccountOption[]>([]);

  useEffect(() => {
    supabase
      .from("v3_customer_accounts")
      .select("account_key,label")
      .order("label")
      .then(({ data }) => setAccounts((data ?? []) as CustomerAccountOption[]));
  }, []);

  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.account_key, a.label);
    return m;
  }, [accounts]);

  const accountLabel = useCallback(
    (key: string | null | undefined): string => {
      if (!key || key === "unattributed" || key === "unknown") return "Unattributed";
      if (key === "prospect_unmapped") return "Prospect (unmapped)";
      if (key === "prospect_personal") return "Prospect (personal)";
      if (key === "domain:_personal") return "Personal email";
      if (key.startsWith("domain:")) return key.slice(7);
      return map.get(key) ?? key;
    },
    [map],
  );

  return { accounts, accountLabel };
}
