

## Auto-open "To" date picker after selecting "From" date

### What Changes

When the user selects a "From" date in the custom range, the "To" date popover automatically opens so they can immediately pick the end date.

### Technical Details

**File: `src/pages/Stats.tsx`**

- Add a state variable `toPopoverOpen` to control the "To" popover's open state
- In the "From" calendar's `onSelect`, after setting `customFrom`, set `toPopoverOpen` to `true`
- Pass `open={toPopoverOpen}` and `onOpenChange={setToPopoverOpen}` to the "To" `Popover`

```tsx
const [toPopoverOpen, setToPopoverOpen] = useState(false);

// From calendar onSelect:
onSelect={(date) => { setCustomFrom(date); setToPopoverOpen(true); }}

// To Popover:
<Popover open={toPopoverOpen} onOpenChange={setToPopoverOpen}>
```

