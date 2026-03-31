

## Update look and feel to Lovable colour palette

### Lovable brand colours
Based on the Lovable website, the brand uses a warm gradient palette:
- **Primary**: A warm coral/red-orange (`#FF6B6B` → HSL ~0 100% 71%`)
- **Accent gradient**: Coral to pink to purple (`#FF6B6B` → `#E66FD2` → `#9B87F5`)
- **Dark foreground**: Near-black (`#1A1A2E`)
- **Neutral background**: Warm off-white

### Changes

**File: `src/index.css`** — Replace the CSS custom properties with Lovable-themed colours:

Light mode:
- `--primary`: Warm coral-red (matches Lovable heart logo)
- `--primary-foreground`: White
- `--accent`: Soft pink tint
- `--destructive`: Keep red but align with palette
- `--background`: Warm off-white (`0 0% 99%`)
- `--muted`: Soft warm grey
- `--border`: Light warm grey
- `--ring`: Coral primary

Dark mode:
- Corresponding dark variants with the same coral primary

**File: `src/components/AppLayout.tsx`** — Add the Lovable logo to the nav bar and apply a subtle bottom-border gradient accent:
- Add `<img src="/lovable-logo.png" className="h-6 w-6" />` before the nav links
- Add app name "Lovable Enterprise Support Hub" as compact text next to logo
- Apply a gradient accent line under the nav (`bg-gradient-to-r from-[#FF6B6B] via-[#E66FD2] to-[#9B87F5]` with `h-0.5`)

**File: `src/pages/Stats.tsx`** — Update chart colours to use the Lovable palette:
- `chartConfig.resolved`: Green stays (success)
- `chartConfig.slack`: Coral primary
- `chartConfig.gmail`: Pink/purple accent
- `chartConfig.resolution`: Purple
- `chartConfig.cumulative`: Coral
- Heatmap cells: Use coral-to-purple gradient intensity instead of current primary

**File: `src/pages/Stats.tsx`** — Hero banner: Add a subtle gradient background using Lovable colours instead of plain `bg-card`

**File: `src/App.css`** — Remove unused default Vite styles (cleanup)

**File: `src/pages/ProjectKnowledge.tsx`** — Update the pending-change banner accent from orange to coral to match

**File: `src/pages/FlowDiagram.tsx`** — Document the colour palette change

### Summary of colour tokens

```text
Light mode:
  --primary:      0 100% 71%        (#FF6B6B coral)
  --primary-fg:   0 0% 100%         (white)
  --accent:       330 80% 95%       (soft pink)
  --accent-fg:    240 10% 20%
  --background:   30 20% 99%        (warm white)
  --card:         0 0% 100%
  --muted:        30 10% 96%
  --border:       30 10% 90%
  --ring:         0 100% 71%
```

### Files to edit
- `src/index.css` — colour tokens
- `src/components/AppLayout.tsx` — nav bar with logo + gradient accent
- `src/pages/Stats.tsx` — chart colours + hero gradient
- `src/App.css` — cleanup
- `src/pages/ProjectKnowledge.tsx` — banner accent alignment
- `src/pages/FlowDiagram.tsx` — document the change

