

## Move Import tab to top-level navigation

### What changes
The "Import" tab currently lives inside the Conversations page as a sub-tab. Move it to be a separate top-level route accessible from the main navigation bar, right next to "Conversations".

### Changes

**`src/App.tsx`**
- Add a new route: `<Route path="/import" element={<ImportPage />} />`
- Import the new page component

**`src/pages/ImportPage.tsx`** (new)
- Wrap `ImportTab` in `AppLayout` with appropriate page padding (matching Conversations style)
- Simple wrapper page component

**`src/components/AppLayout.tsx`**
- Add an "Import" nav link between "Conversations" and "Settings" using the `Import` (or `Download`) icon from lucide-react

**`src/pages/Conversations.tsx`**
- Remove the `Tabs`/`TabsList`/`TabsTrigger` wrapper
- Remove the `ImportTab` import and the import tab content
- The conversations table becomes the direct content again (unwrap from `TabsContent`)

**`src/pages/FlowDiagram.tsx`**
- Document that Import is now a standalone page accessible from the nav bar

### Files to edit
- `src/App.tsx`
- `src/pages/ImportPage.tsx` (new)
- `src/components/AppLayout.tsx`
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

