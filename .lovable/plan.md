

## Fix off-brand chart colours to match Lovable palette

### Problem
Several charts use blue (`hsl(221 83% 53%)`), amber (`hsl(35 92% 50%)`), and green (`hsl(142 76% 36%)`) fills that don't match the Lovable coral/pink/purple palette. The brand colours are: coral `#FF6B6B`, pink `#E66FD2`, purple `#9B87F5`.

### Colour mapping

| Chart | Current colour | New colour |
|-------|---------------|------------|
| Conversations by channel bar | Green (resolved config) | Coral `#FF6B6B` |
| Resolution time distribution bar | Blue `hsl(221 83% 53%)` | Purple `#9B87F5` |
| Resolution time trend line | Blue `hsl(221 83% 53%)` | Purple `#9B87F5` |
| Threads by customer bar | Amber `hsl(35 92% 50%)` | Pink `#E66FD2` |
| Gmail area gradient (volume chart) | Amber `hsl(35 92% 50%)` | Pink `#E66FD2` |
| Gmail hourly activity bar | Amber `hsl(35 92% 50%)` | Pink `#E66FD2` |
| chartConfig.resolved | Green `hsl(142 76% 36%)` | Keep green (semantic — indicates success) |

### Changes in `src/pages/Stats.tsx`

1. **Line 840** — Resolution time distribution bar: `fill="hsl(221 83% 53%)"` → `fill="#9B87F5"`
2. **Line 864** — Resolution time trend line: `stroke="hsl(221 83% 53%)"` → `stroke="#9B87F5"`
3. **Line 911** — Threads by customer bar: `fill="hsl(35 92% 50%)"` → `fill="#E66FD2"`
4. **Lines 937-939** — Gmail volume gradient: `hsl(35 92% 50%)` → `#E66FD2` (both stops)
5. **Line 950** — Gmail volume area stroke: `hsl(35 92% 50%)` → `#E66FD2`
6. **Line 978** — Gmail hourly bar: `hsl(35 92% 50%)` → `#E66FD2`
7. **Line 1063** — Conversations by channel bar: `fill={chartConfig.resolved.color}` → `fill="#FF6B6B"`
8. **chartConfig (line 57)** — Gmail config colour: already `#E66FD2` ✓

No other files affected — this is a styling-only change.

