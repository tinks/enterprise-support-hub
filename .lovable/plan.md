

## Add channel name combobox with suggestions

### What changes
Replace the plain text `<Input>` for channel name (line 238) with a combobox that shows a short list of commonly used channels not covered by the bot, while still allowing free-text entry.

### Channel suggestions
A small hardcoded list of channels the bot is not part of:
- `ext-lovable-control-tower`
- `ext-bts-lovable`
- `ext-lovable-tool-support-remote`
- `it-lovable-support`
- `workday-lovable`

### Implementation

**`src/components/ManualLogTab.tsx`**
- Import `Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem` from `@/components/ui/command`
- Replace the channel name `<Input>` with a `Popover` + `Command` combobox:
  - Typing filters the suggestion list
  - Clicking a suggestion fills the field
  - Custom text is accepted (not locked to suggestions)
  - Displays with `#` prefix

### Files to edit
- `src/components/ManualLogTab.tsx`

