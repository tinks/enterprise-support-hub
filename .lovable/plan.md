

## Add "Total resolved cases" KPI to the Overview section

### What changes
Add a second card in the Overview grid showing the total resolved cases across all sources: Slack resolved + Gmail resolved (deduplicated) + Manual entries resolved.

### Implementation

**`src/pages/Stats.tsx`**

1. After the existing "Total incoming cases" `<Card>` (~line 904), add a new card:
   ```tsx
   <Card>
     <CardContent className="flex flex-col items-center justify-center p-5">
       <ThumbsUp className="mb-2 h-5 w-5 text-[#9B87F5]" />
       <p className="text-3xl font-bold text-foreground">
         {stats.resolved + stats.gmailResolved + stats.manualResolved}
       </p>
       <p className="text-xs text-muted-foreground">Total resolved cases</p>
     </CardContent>
   </Card>
   ```

All three values (`stats.resolved`, `stats.gmailResolved`, `stats.manualResolved`) already exist in the stats object — no computation changes needed.

### Files to edit
- `src/pages/Stats.tsx`

