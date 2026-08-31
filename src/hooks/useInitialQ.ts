import { useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Reads the `?q=` deep-link param once, on first render.
 * Used to seed a page's existing search box from Deep search results.
 */
export function useInitialQ(): string {
  const [params] = useSearchParams();
  const [initial] = useState(() => params.get("q") ?? "");
  return initial;
}
