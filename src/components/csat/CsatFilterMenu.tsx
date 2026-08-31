import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SlidersHorizontal } from "lucide-react";
import { CsatFilters, CsatSummary, csatExclusionNote } from "@/lib/csat";

/**
 * Shared control for how CSAT is counted. Nothing is hidden silently — the
 * popover always states how many responses each rule removed.
 */
export function CsatFilterMenu({
  filters,
  onChange,
  summary,
}: {
  filters: CsatFilters;
  onChange: (next: Partial<CsatFilters>) => void;
  summary?: CsatSummary;
}) {
  const note = summary ? csatExclusionNote(summary) : null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          CSAT counting
          {note ? <span className="text-xs text-muted-foreground">({note})</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="text-sm font-medium">How CSAT is counted</div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="csat-internal" className="text-sm">Exclude internal raters</Label>
            <p className="text-xs text-muted-foreground">
              Ratings given by lovable.dev staff or roster teammates
              {summary ? ` (${summary.internalExcluded} in view)` : ""}.
            </p>
          </div>
          <Switch
            id="csat-internal"
            checked={filters.excludeInternal}
            onCheckedChange={(v) => onChange({ excludeInternal: v })}
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label htmlFor="csat-override" className="text-sm">Exclude overridden ratings</Label>
            <p className="text-xs text-muted-foreground">
              Ratings suppressed with a written reason
              {summary ? ` (${summary.overriddenExcluded} in view)` : ""}.
            </p>
          </div>
          <Switch
            id="csat-override"
            checked={filters.excludeOverridden}
            onCheckedChange={(v) => onChange({ excludeOverridden: v })}
          />
        </div>
        {summary ? (
          <p className="text-xs text-muted-foreground border-t border-border pt-2">
            Counting {summary.n} of {summary.rawN} responses in the current view.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
