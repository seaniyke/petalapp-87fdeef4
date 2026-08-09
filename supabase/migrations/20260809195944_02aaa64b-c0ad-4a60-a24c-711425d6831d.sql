update public.turns
set status = 'failed',
    ended_at = coalesce(ended_at, now()),
    error_message = coalesce(error_message, 'Turn ended without completing.')
where status = 'running'
  and created_at < now() - interval '10 minutes';