WITH ranked AS (
  SELECT id, role, content,
         lag(role) OVER (PARTITION BY project_id ORDER BY created_at) AS prev_role,
         lag(content) OVER (PARTITION BY project_id ORDER BY created_at) AS prev_content
  FROM public.messages
)
DELETE FROM public.messages m
USING ranked r
WHERE m.id = r.id
  AND r.role = 'user'
  AND r.prev_role = 'user'
  AND btrim(r.content) = btrim(r.prev_content);