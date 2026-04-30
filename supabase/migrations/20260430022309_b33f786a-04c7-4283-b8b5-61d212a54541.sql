-- Backfill: for every purchased+active domain whose project has no primary yet,
-- set it as primary so it shows as the Website URL.
WITH candidates AS (
  SELECT pd.id AS domain_id, pd.project_id
    FROM public.purchased_domains pdom
    JOIN public.project_domains pd
      ON pd.id = pdom.connected_domain_id
    JOIN public.projects p
      ON p.id = pd.project_id
   WHERE pdom.status = 'active'
     AND pd.status   = 'active'
     AND p.primary_domain_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.project_domains other
        WHERE other.project_id = pd.project_id
          AND other.is_primary = true
     )
)
UPDATE public.project_domains pd
   SET is_primary = true,
       updated_at = now()
  FROM candidates c
 WHERE pd.id = c.domain_id;

-- The sync_project_primary_domain trigger will copy is_primary into projects.primary_domain_id.