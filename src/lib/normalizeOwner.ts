// Owner display normalization.
// "Tine Saint-Ghislain" → "Tine", "Kristina Bodurova" → "Kristina".
export function normalizeOwner<T extends string | null | undefined>(owner: T): T {
  if (!owner) return owner;
  const s = String(owner).trim();
  if (/^tine(\s|$)/i.test(s)) return "Tine" as T;
  if (/^kristina(\s|$)/i.test(s)) return "Kristina" as T;
  return owner;
}
