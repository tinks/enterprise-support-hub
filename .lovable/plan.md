

## Add "Auto-mark Lovable employees as test" Toggle

### What changes

**1. Database migration — Add `auto_mark_employee_test` column to `settings`**

```sql
ALTER TABLE settings ADD COLUMN auto_mark_employee_test boolean NOT NULL DEFAULT true;
```

Defaults to `true` (current behavior preserved).

**2. Settings UI (`src/pages/Index.tsx`)**

- Add `auto_mark_employee_test: boolean` to `SettingsData` interface
- Include it in `saveSettings` update call
- Add a new toggle row near the test inbox field:
  - Label: "Auto-mark Lovable employee conversations as test"
  - Description: "When enabled, conversations from @lovable.dev users are automatically marked as test and routed to the test inbox"

**3. Edge function `slack-events/index.ts`**

Change the two `@lovable.dev` checks (lines ~300 and ~455) from:

```ts
if (empEmail.endsWith("@lovable.dev") && !settings.testing_mode)
```

to:

```ts
if (empEmail.endsWith("@lovable.dev") && settings.auto_mark_employee_test)
```

This decouples the employee auto-marking from the debug testing mode toggle, giving you independent control.

### Summary
- 1 migration (1 new boolean column)
- 1 UI file updated (new toggle + save)
- 1 edge function updated (2 condition changes)

