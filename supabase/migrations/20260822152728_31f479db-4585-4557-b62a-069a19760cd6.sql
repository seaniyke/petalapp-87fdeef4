create or replace function public.project_screenshot_url(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.dist_path
  from public.project_builds b
  join public.projects p on p.id = b.project_id
  where b.project_id = p_project_id
    and b.status = 'ready'
    and b.dist_path is not null
    and (p.is_public = true or p.owner_id = auth.uid())
  order by b.created_at desc
  limit 1
$$;

grant execute on function public.project_screenshot_url(uuid) to anon, authenticated, service_role;