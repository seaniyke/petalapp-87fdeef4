
-- Universal Integration Resolver: cache for third-party docs/SDK metadata
-- Petal fetches docs on demand for any service the user mentions, then caches
-- the canonical SDK signature so the next user gets it instantly.

CREATE TABLE IF NOT EXISTS public.integration_docs_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  npm_package TEXT,
  docs_url TEXT,
  homepage_url TEXT,
  -- Compact, prompt-ready summary: install + import + minimal SDK example.
  prompt_block TEXT NOT NULL,
  -- Names of secrets the integration needs (e.g. ["TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN"]).
  required_secrets JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Free-form metadata: category, tags, source list, etc.
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Source attribution (which strategy succeeded: "context7" | "llms-txt" | "npm" | "ai").
  source TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_integration_docs_cache_service ON public.integration_docs_cache(service_slug);
CREATE INDEX IF NOT EXISTS idx_integration_docs_cache_refreshed ON public.integration_docs_cache(refreshed_at);

-- Server-side only table (server uses service-role). RLS enabled to deny
-- public client access — the table holds aggregated, non-sensitive docs but
-- has no business being readable from the browser.
ALTER TABLE public.integration_docs_cache ENABLE ROW LEVEL SECURITY;

-- No policies = nothing accessible via anon/authenticated clients.
-- Service role bypasses RLS, so the generate pipeline can read/write freely.
