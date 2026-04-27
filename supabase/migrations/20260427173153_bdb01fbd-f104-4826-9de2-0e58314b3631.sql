-- Per-project memory: small set of stable facts about what the user is
-- building, who it's for, and what they like / don't like. Loaded into the
-- system prompt of both /api/triage and /api/generate so Petal stops feeling
-- cold every turn. Updated by a tiny "memory writer" model after each
-- successful build.
--
-- Design: key/value rows (not JSONB blob) so individual facts can be added,
-- updated or removed without re-writing the whole memory and so we can index
-- and query by key cheaply. Hard cap of 30 keys per project at the
-- application layer keeps prompt-size bounded.

CREATE TABLE public.project_memory (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE INDEX project_memory_project_id_idx ON public.project_memory(project_id);

ALTER TABLE public.project_memory ENABLE ROW LEVEL SECURITY;

-- Owners (and admins) may read their project memory.
CREATE POLICY "Owners view their project memory"
  ON public.project_memory
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_memory.project_id
        AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- Owners may insert/update/delete their own project memory. Server-side
-- writes from the memory-writer use the user's JWT so RLS still applies.
CREATE POLICY "Owners insert their project memory"
  ON public.project_memory
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_memory.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners update their project memory"
  ON public.project_memory
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_memory.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners delete their project memory"
  ON public.project_memory
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_memory.project_id
        AND p.owner_id = auth.uid()
    )
  );

CREATE TRIGGER update_project_memory_updated_at
  BEFORE UPDATE ON public.project_memory
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();