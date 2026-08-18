INSERT INTO public.changelog_entries (entry_date, title, body, tags, area)
VALUES (
  DATE '2026-08-18',
  'Severity rubric v2 imported from Notion',
  'Replaced the placeholder seed rubric (v1, retired) with the canonical Notion feeder doc "Severity Rubric — Rules & Worked Examples (Feeder)" (Locked v2, 2026-07-21), read live through the Notion connector gateway. propose-severity now prompts against rules A-D, the worked examples, and the lifecycle note. Import was manual; an auto-sync from Notion is on the backlog (blocked: the Enterprise Support Hub Notion connections are not linkable to this project yet).',
  ARRAY['severity-ai','notion','rubric'],
  'Severity AI'
);