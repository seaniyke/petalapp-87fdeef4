CREATE TABLE public.tool_loop_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  turn_id uuid,
  project_id uuid,
  call_no int NOT NULL,
  work_unit text,
  model text,
  upstream_provider text,
  system_chars int,
  brief_chars int,
  history_chars int,
  prompt_tokens int,
  cached_tokens int,
  completion_tokens int,
  ttft_ms int,
  duration_ms int,
  output_tps numeric,
  tool_ms int,
  validation_ms int,
  tool_calls text[],
  files_written text[],
  progress boolean,
  compacted boolean,
  finish_reason text
);
GRANT ALL ON public.tool_loop_calls TO service_role;
GRANT SELECT ON public.tool_loop_calls TO authenticated;
ALTER TABLE public.tool_loop_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read tool loop calls" ON public.tool_loop_calls FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX tool_loop_calls_turn_idx ON public.tool_loop_calls (turn_id, call_no);