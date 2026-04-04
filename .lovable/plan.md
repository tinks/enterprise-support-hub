

## Rename "Admin" to "Support representative" in manual log form

### What changes
Update the role label and placeholder text in the ManualLogTab so "Admin" becomes "Support representative" in the UI. The underlying `role` value stored in the database stays `"admin"` — only the display text changes.

### Implementation

**`src/components/ManualLogTab.tsx`**

1. **Line 207** — Change the SelectItem label:
   - From: `<SelectItem value="admin">Admin</SelectItem>`
   - To: `<SelectItem value="admin">Support representative</SelectItem>`

2. **Line 216** — Change the placeholder:
   - From: `placeholder="Select admin"`
   - To: `placeholder="Select support representative"`

3. **Line 202** — Widen the role selector to fit the longer label:
   - From: `className="w-[100px] h-8 text-xs"`
   - To: `className="w-[180px] h-8 text-xs"`

### Files to edit
- `src/components/ManualLogTab.tsx`

