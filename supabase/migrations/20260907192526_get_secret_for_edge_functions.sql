-- Edge Functions read their secrets (Resend API key, alert addresses, the shared alert
-- header) from Supabase Vault through this function, so a secret can be set or rotated
-- with one SQL statement instead of the dashboard's Edge Function Secrets page:
--   select vault.create_secret('re_…', 'RESEND_API_KEY');
-- Only the service role (which every Edge Function holds) may call it; anon and
-- signed-in users get "permission denied".
create or replace function public.get_secret(secret_name text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = secret_name
  order by s.created_at desc
  limit 1;
$$;

revoke all on function public.get_secret(text) from public;
revoke all on function public.get_secret(text) from anon;
revoke all on function public.get_secret(text) from authenticated;
grant execute on function public.get_secret(text) to service_role;
