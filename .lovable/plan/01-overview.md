# Standardize the v3 issue views on one table template

Today each issue surface renders its own hand-rolled table. Same data, four different column orders, and two competing ways to reach Intercom:

| View | Column order today | Intercom affordance | Row click |
| --- | --- | --- | --- |
| Inbox v3 | ID · Subject · Contact · Customer · Owner · Product area · Classification · State · Lifecycle · RSA · CSAT · Resolve | clickable ID chip | opens detail sheet |
| Prospects | Subject · Contact · Domain · Customer · Owner · Product area · Status · Created · ↗ | trailing icon | opens detail sheet |
| Triage | Age (business) · Elapsed · Subject · Contact · Customer · Owner · Anchor · ↗ | trailing icon | none |
| Escalations | Type · Subject · Customer · Owner · Intercom · Linear · Hub state · Age · Note · ↗ | trailing icon | none |

The Customers evidence tables (`Subject · Created · Current attribution · Intercom`) and the SLA Workbench violations table are the same data again in two more shapes.

## The template

One shared component, `IssueTable`, owning the identity block, the Intercom link, sorting, empty/loading states, row click, and density. Each view passes only its own extra columns.

**Canonical order — identity block first, view-specific columns after, age last:**

```text
Intercom ID · Subject · Contact · Customer · Owner · [view-specific …] · Age
```

Why identity-first rather than keeping Triage's age column or Escalations' type column at the far left: the point of standardizing is that your eye lands on the same thing in the same place on every page. A view whose primary signal is a grade (Triage bands, Escalation type) keeps that signal by **colouring the row and putting a coloured pill in the Age cell**, not by hijacking column 1. Triage stays sorted oldest-first, so the grade still reads top-down without needing the leftmost slot.

**Intercom affordance:** the ID chip becomes the single canonical form everywhere — monospace conversation ID, small `↗`, opens Intercom in a new tab, click does not trigger the row's detail sheet. The trailing icon-only column is removed from Prospects, Triage, Escalations, and Customers.

**Row click:** every row opens the read-only detail sheet. Triage and Escalations gain one; Escalations keeps its inline hub-state select and note editor in the row (those stop propagation).
