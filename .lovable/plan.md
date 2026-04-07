

## Add column-level filters to inbox table

### Problem
Filters are in a collapsible section at the top, separate from the table columns they apply to. You can't filter by product area, classification, or "no owner" directly in the table. The current owner filter has an "unassigned" option but product area and classification don't have equivalent "empty" options.

### Solution
Move the owner and product area filters into the table header as clickable dropdowns on each column. Add a new classification column filter too. Each filter dropdown appears when you click the column header and includes an "Unassigned" / "None" option to filter for empty values.

### Changes

**`src/pages/Conversations.tsx`**

1. **Add new filter state variables:**
   - `productAreaFilter: string` — `"all"`, a specific area, or `"unassigned"`
   - `classificationFilter: string` — `"all"`, a specific value, or `"unassigned"`
   - Persist both in localStorage like the existing owner/source filters

2. **Move owner filter from top bar into table header:**
   - Remove the owner `<Select>` from the top filter bar
   - Add a filter dropdown icon in the "Owner" column header that opens a popover with owner options (Joel, Kristina, Sam, CSM, Unassigned, All)
   - Show a dot/indicator on the column header when a filter is active

3. **Add product area filter in table header:**
   - Add a filter dropdown icon in the "Product area" column header
   - Options: All, each product area from settings, plus "Unassigned" (for null/empty)
   - Apply in the `unified` useMemo alongside the existing owner filter

4. **Add classification filter in table header:**
   - Add a filter dropdown icon in the "Classification" column header
   - Options: All, Issue, Configuration, Bug, FR, Question, plus "Unassigned"
   - Apply in the `unified` useMemo

5. **Update the unified useMemo filtering:**
   - After owner filter, also apply product area and classification filters
   - For "unassigned": filter where the field is null or empty string

6. **Update `anyFilterActive` and `resetAll`:**
   - Include the two new filters in the active count and reset logic

7. **Keep source, status, and date filters in the top bar** — they work well there since they don't map to a single column cleanly

8. **Column header filter UI pattern:**
   - Each filterable column header gets a small funnel icon next to the column name
   - Clicking it opens a `Popover` with a list of options (radio-style, single select)
   - When a filter is active, the funnel icon is highlighted/filled
   - This pattern is reusable across owner, product area, and classification columns

**`src/pages/FlowDiagram.tsx`**
- Note that inbox has column-level filters for owner, product area, and classification

### Technical details

Filter popover component (inline in the column header):
```typescript
const ColumnFilter = ({ value, options, onChange, includeUnassigned }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button className={`ml-1 ${value !== "all" ? "text-primary" : "text-muted-foreground"}`}>
        <Filter className="h-3 w-3" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-44 p-2">
      <div className="flex flex-col gap-1">
        <button onClick={() => onChange("all")}>All</button>
        {includeUnassigned && <button onClick={() => onChange("unassigned")}>Unassigned</button>}
        {options.map(opt => <button key={opt} onClick={() => onChange(opt)}>{opt}</button>)}
      </div>
    </PopoverContent>
  </Popover>
)
```

Filtering logic added to unified useMemo:
```typescript
// After owner filter
const paFiltered = productAreaFilter === "all" ? ownerFiltered
  : productAreaFilter === "unassigned"
    ? ownerFiltered.filter(r => !(r.data as any).product_area)
    : ownerFiltered.filter(r => (r.data as any).product_area === productAreaFilter);

const classFiltered = classificationFilter === "all" ? paFiltered
  : classificationFilter === "unassigned"
    ? paFiltered.filter(r => !(r.data as any).classification)
    : paFiltered.filter(r => (r.data as any).classification === classificationFilter);
```

### Files to edit
- `src/pages/Conversations.tsx` — add column-level filter dropdowns for owner, product area, classification
- `src/pages/FlowDiagram.tsx` — note column-level filters

