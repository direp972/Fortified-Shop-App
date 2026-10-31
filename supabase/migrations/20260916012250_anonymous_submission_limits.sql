-- The Get Listed form, the lead form and the upload bucket accept anonymous submissions.
-- Each application also sends an email, so a bot could flood the desk and burn the Resend
-- quota. Every submission now records the caller's address and is refused past 3 an hour
-- from one address (10 for leads), 20 an hour overall (60 for leads), or 60 KB. Uploads to
-- the public bucket stop at 60 an hour.
alter table public.leads add column if not exists ip text;
alter table public.manufacturer_applications add column if not exists ip text;

-- The real client address: the gateway's cf-connecting-ip, else the last x-forwarded-for
-- entry (earlier entries are caller-supplied).
create or replace function public.client_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h json;
  xff text[];
  ip text;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  ip := nullif(btrim(coalesce(h->>'cf-connecting-ip', '')), '');
  if ip is null then
    xff := regexp_split_to_array(coalesce(h->>'x-forwarded-for', ''), '\s*,\s*');
    if array_length(xff, 1) is not null then
      ip := nullif(btrim(xff[array_upper(xff, 1)]), '');
    end if;
  end if;
  return left(ip, 64);
end;
$$;
revoke all on function public.client_ip() from public, anon, authenticated;

create or replace function public.throttle_public_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_ip int;
  per_hour int;
  n int;
  ip text;
begin
  if octet_length(to_jsonb(new)::text) > 60000 then
    raise exception 'That submission is too large.';
  end if;
  if tg_table_name = 'manufacturer_applications' then
    per_ip := 3; per_hour := 20;
  else
    per_ip := 10; per_hour := 60;
  end if;
  execute format('select count(*) from public.%I where created_at > now() - interval ''1 hour''', tg_table_name) into n;
  if n >= per_hour then
    raise exception 'We are getting a lot of submissions right now — please try again in an hour, or email orders@roofcoil.com.';
  end if;
  ip := public.client_ip();
  if ip is not null then
    execute format('select count(*) from public.%I where ip = $1 and created_at > now() - interval ''1 hour''', tg_table_name) into n using ip;
    if n >= per_ip then
      raise exception 'Too many submissions from this connection — please try again in an hour, or email orders@roofcoil.com.';
    end if;
  end if;
  new.ip := ip;
  return new;
end;
$$;
revoke all on function public.throttle_public_submission() from public, anon, authenticated;

drop trigger if exists leads_throttle on public.leads;
create trigger leads_throttle before insert on public.leads
  for each row execute function public.throttle_public_submission();
drop trigger if exists applications_throttle on public.manufacturer_applications;
create trigger applications_throttle before insert on public.manufacturer_applications
  for each row execute function public.throttle_public_submission();

-- Uploads: the count runs as the definer so it sees every object regardless of RLS.
-- Deliberately executable by anon; it returns one number.
create or replace function public.recent_public_uploads()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from storage.objects o
  where o.bucket_id = 'mfr-colorcharts' and o.created_at > now() - interval '1 hour';
$$;
grant execute on function public.recent_public_uploads() to anon, authenticated;

drop policy if exists "anyone can upload a color chart" on storage.objects;
create policy "anyone can upload a color chart" on storage.objects
  for insert to anon
  with check (bucket_id = 'mfr-colorcharts' and public.recent_public_uploads() < 60);
drop policy if exists "signed-in users can upload a color chart" on storage.objects;
create policy "signed-in users can upload a color chart" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mfr-colorcharts' and public.recent_public_uploads() < 120);
