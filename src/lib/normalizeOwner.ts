// Owner display normalization.
// "Tine Saint-Ghislain" and "Tine" are the same person — always show "Tine".
export function normalizeOwner<T extends string | null | undefined>(owner: T): T {
  if (!owner) return owner;
  const s = String(owner).trim();
  if (/^tine(\s|$)/i.test(s)) return "Tine" as T;
  return owner;
}
