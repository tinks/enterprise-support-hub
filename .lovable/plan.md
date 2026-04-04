

## Fix "Total incoming cases" overcounting Gmail threads

### Problem
The Overview card shows `stats.total + stats.gmailTotal + stats.manualTotal` which sums raw row counts. For Gmail, each email in a thread is a separate row, so `gmailTotal` (raw row count) is much larger than the deduplicated thread count shown in the Gmail section KPIs. This makes the total appear inflated (120 instead of ~73).

### Fix

**`src/pages/Stats.tsx`**

1. In the `stats` useMemo, add a deduplicated Gmail count using the same subject-based grouping already used for resolved/open Gmail stats:
   ```ts
   const gmailUniqueSubjects = new Set<string>();
   let gmailOrphans = 0;
   filteredGmail.forEach((g) => {
     if (g.subject) gmailUniqueSubjects.add(g.subject);
     else gmailOrphans++;
   });
   const gmailDeduped = gmailUniqueSubjects.size + gmailOrphans;
   ```

2. Return `gmailDeduped` from the stats object.

3. Update the Overview card to use `stats.total + stats.gmailDeduped + stats.manualTotal` instead of `stats.total + stats.gmailTotal + stats.manualTotal`.

4. Also update the Gmail section "Total" KPI to show `gmailDeduped` instead of `gmailTotal` for consistency (so 50+18+5 = 73 matches the overview).

### Files to edit
- `src/pages/Stats.tsx`

