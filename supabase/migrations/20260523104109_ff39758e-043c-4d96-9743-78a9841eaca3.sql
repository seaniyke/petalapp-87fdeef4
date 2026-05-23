
-- 1) project_backends: hide service_role_key from client roles (column-level security).
--    Server code uses the service role key which bypasses RLS/column privileges.
REVOKE SELECT (service_role_key) ON public.project_backends FROM anon, authenticated;

-- 2) preview_shares: replace blanket anon SELECT (which leaked all tokens) with
--    a SECURITY DEFINER RPC that returns a single share only when the caller
--    supplies the exact token.
DROP POLICY IF EXISTS "Public can read shares by token" ON public.preview_shares;

CREATE OR REPLACE FUNCTION public.get_preview_share_by_token(_token text)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  token text,
  created_by uuid,
  allow_comments boolean,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.project_id, s.token, s.created_by, s.allow_comments,
         s.expires_at, s.revoked_at, s.created_at
    FROM public.preview_shares s
   WHERE s.token = _token
     AND s.revoked_at IS NULL
     AND (s.expires_at IS NULL OR s.expires_at > now())
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_preview_share_by_token(text) TO anon, authenticated;
