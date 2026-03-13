CREATE TABLE public.flow_node_positions (
  id text PRIMARY KEY,
  x double precision NOT NULL,
  y double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flow_node_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to flow_node_positions"
  ON public.flow_node_positions FOR ALL TO public
  USING (true) WITH CHECK (true);