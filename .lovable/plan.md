## Fix empty Daily volume chart

**Root cause:** In `src/pages/insights/TrendsTab.tsx` (lines 67–75) the chart container is `flex items-end h-48`. `items-end` overrides the default `stretch`, so each day column collapses to `height: auto`. The bars inside use `height: X%`, which resolves against a 0-height parent — so nothing renders even though April has 513 rows of data.

### Fix (one block, ~3 lines changed)

```tsx
<div className="flex items-stretch gap-1 h-48">
  {series.map(s => (
    <div key={s.day} className="flex-1 h-full flex flex-col-reverse gap-px" title={`Day ${s.day}: ${s.total}`}>
      {sources.map(src => s[src] > 0 && (
        <div key={src} style={{ height: `${(s[src] / max) * 100}%`, background: colors[src] }} />
      ))}
    </div>
  ))}
</div>
```

Changes:
1. `items-end` → `items-stretch` so each day column fills the 192px row.
2. Add `h-full` on each column so the inner `height: %` bars resolve correctly.
3. `flex-col-reverse` already stacks bars from the bottom — no extra alignment needed.

No data, query, or business-logic changes.