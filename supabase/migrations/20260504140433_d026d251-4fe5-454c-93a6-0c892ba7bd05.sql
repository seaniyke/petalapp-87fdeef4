-- =========================================
-- mobile_apps: one Codemagic app per Petal project
-- =========================================
CREATE TABLE public.mobile_apps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL UNIQUE,
  bundle_id TEXT NOT NULL,
  codemagic_app_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL DEFAULT 'petal-default',
  default_branch TEXT NOT NULL DEFAULT 'main',
  latest_build_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT mobile_apps_bundle_id_format
    CHECK (bundle_id ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$')
);

CREATE INDEX idx_mobile_apps_project_id ON public.mobile_apps(project_id);

ALTER TABLE public.mobile_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their mobile app"
ON public.mobile_apps FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_apps.project_id
    AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
));

CREATE POLICY "Owners insert their mobile app"
ON public.mobile_apps FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_apps.project_id AND p.owner_id = auth.uid()
));

CREATE POLICY "Owners update their mobile app"
ON public.mobile_apps FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_apps.project_id AND p.owner_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_apps.project_id AND p.owner_id = auth.uid()
));

CREATE POLICY "Owners delete their mobile app"
ON public.mobile_apps FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_apps.project_id AND p.owner_id = auth.uid()
));

CREATE TRIGGER update_mobile_apps_updated_at
BEFORE UPDATE ON public.mobile_apps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- mobile_builds: every iOS/Android build attempt
-- =========================================
CREATE TABLE public.mobile_builds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mobile_app_id UUID NOT NULL REFERENCES public.mobile_apps(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  kind TEXT NOT NULL CHECK (kind IN ('unsigned','signed')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed')),
  codemagic_build_id TEXT,
  artifact_url TEXT,
  estimated_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC(10,4),
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_mobile_builds_app_id ON public.mobile_builds(mobile_app_id);
CREATE INDEX idx_mobile_builds_project_id ON public.mobile_builds(project_id);
CREATE INDEX idx_mobile_builds_user_id ON public.mobile_builds(user_id);
CREATE INDEX idx_mobile_builds_status ON public.mobile_builds(status);

ALTER TABLE public.mobile_builds ENABLE ROW LEVEL SECURITY;

-- Owners can read their builds; service role manages writes.
CREATE POLICY "Owners view their mobile builds"
ON public.mobile_builds FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = mobile_builds.project_id
    AND (p.owner_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
));

CREATE POLICY "Service role inserts mobile builds"
ON public.mobile_builds FOR INSERT
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role updates mobile builds"
ON public.mobile_builds FOR UPDATE
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER update_mobile_builds_updated_at
BEFORE UPDATE ON public.mobile_builds
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now that mobile_builds exists, wire latest_build_id as a real FK (SET NULL on delete to preserve the app row).
ALTER TABLE public.mobile_apps
  ADD CONSTRAINT mobile_apps_latest_build_fk
  FOREIGN KEY (latest_build_id) REFERENCES public.mobile_builds(id) ON DELETE SET NULL;