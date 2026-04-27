-- One row per project; holds Petal's in-flight assistant reply so a browser
-- refresh during a long build doesn't lose the partial text the user was
-- already seeing on screen. Cleared when the run finishes (success/abort/fail).
CREATE TABLE public.message_drafts (
  project_id uuid NOT NULL PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  partial_content text NOT NULL DEFAULT '',
  partial_plan text NOT NULL DEFAULT '',
  partial_recap text NOT NULL DEFAULT '',
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.message_drafts ENABLE ROW LEVEL SECURITY;

-- Owners can read their own draft (admins can read everything).
CREATE POLICY "Owners view their message drafts"
ON public.message_drafts
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = message_drafts.project_id
      AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

-- Owners can insert/update/delete their own draft.
CREATE POLICY "Owners insert their message drafts"
ON public.message_drafts
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = message_drafts.project_id
      AND p.owner_id = auth.uid()
  )
);

CREATE POLICY "Owners update their message drafts"
ON public.message_drafts
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = message_drafts.project_id
      AND p.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = message_drafts.project_id
      AND p.owner_id = auth.uid()
  )
);

CREATE POLICY "Owners delete their message drafts"
ON public.message_drafts
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = message_drafts.project_id
      AND p.owner_id = auth.uid()
  )
);

-- Touch updated_at on every write so cleanup logic can purge stale drafts.
CREATE TRIGGER message_drafts_set_updated_at
BEFORE UPDATE ON public.message_drafts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();