-- Shops claim their own listing. Manage your listing (public/manage-listing.html) shows a
-- signed-in account with no listing the live directory; "This is my shop" calls
-- claim_listing(). When the account's confirmed email is at the listing's own website
-- domain and nobody owns the listing yet, the account is linked on the spot; anything else
-- becomes a pending claim that staff approve or dismiss in the directory admin through
-- decide_listing_claim(). Both outcomes are emailed by listing-alert (kinds claim and
-- claim_decided) from the pg_net trigger below. Rows are written only by the two
-- functions; claimants can read their own, staff can read all.
create table if not exists public.listing_claims (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.directory_listings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  method text check (method in ('domain', 'staff')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);
create unique index if not exists listing_claims_one_pending
  on public.listing_claims (listing_id, user_id) where status = 'pending';
create index if not exists listing_claims_listing on public.listing_claims (listing_id);
alter table public.listing_claims enable row level security;
revoke all on table public.listing_claims from public, anon, authenticated;
grant select on table public.listing_claims to authenticated;
drop policy if exists "claimant or staff read claims" on public.listing_claims;
create policy "claimant or staff read claims" on public.listing_claims
  for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.staff s where s.id = auth.uid()));

-- The host of a website for matching against an email domain: scheme, "www." and any path
-- stripped, lower case; null when there is nothing usable.
create or replace function public.site_host(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      split_part(split_part(regexp_replace(lower(btrim(coalesce(p_url, ''))), '^[a-z]+://', ''), '/', 1), ':', 1),
      '^www\.', ''),
    '');
$$;
revoke all on function public.site_host(text) from public, anon, authenticated;

-- Returns 'linked' (matched the website domain, owner set now), 'pending' (staff will
-- decide), or 'already-yours'. Raises with a plain message the page can show.
create or replace function public.claim_listing(p_listing_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  u_email text;
  u_confirmed timestamptz;
  l record;
  email_domain text;
  host text;
  note text;
  pending_count int;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select lower(u.email), u.email_confirmed_at into u_email, u_confirmed from auth.users u where u.id = uid;
  if u_email is null or u_confirmed is null then raise exception 'Confirm your email address first.'; end if;
  select d.id, d.name, d.owner_id, d.website, d.status into l from public.directory_listings d where d.id = p_listing_id;
  if l.id is null or l.status <> 'live' then raise exception 'That listing is not on the directory.'; end if;
  if l.owner_id = uid then return 'already-yours'; end if;
  if exists (select 1 from public.listing_claims c where c.listing_id = p_listing_id and c.user_id = uid and c.status = 'pending') then
    return 'pending';
  end if;
  select count(*) into pending_count from public.listing_claims c where c.user_id = uid and c.status = 'pending';
  if pending_count >= 3 then raise exception 'You already have three claims waiting for review.'; end if;
  note := nullif(left(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g'), 500), '');
  email_domain := split_part(u_email, '@', 2);
  host := public.site_host(l.website);
  if l.owner_id is null and host is not null
     and host !~ '^(gmail|googlemail|yahoo|hotmail|outlook|live|aol|icloud|me|msn|mail|ymail|protonmail|proton|comcast|att|sbcglobal|verizon)\.(com|net|me)$'
     and (email_domain = host or email_domain like ('%.' || host)) then
    update public.directory_listings set owner_id = uid, updated_at = now() where id = p_listing_id;
    insert into public.listing_claims (listing_id, user_id, email, note, status, method, reviewed_at)
      values (p_listing_id, uid, u_email, note, 'approved', 'domain', now());
    return 'linked';
  end if;
  insert into public.listing_claims (listing_id, user_id, email, note) values (p_listing_id, uid, u_email, note);
  return 'pending';
end;
$$;
revoke all on function public.claim_listing(uuid, text) from public, anon;
grant execute on function public.claim_listing(uuid, text) to authenticated;

-- Staff only. Approving sets the listing's owner to the claimant.
create or replace function public.decide_listing_claim(p_claim_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
begin
  if not exists (select 1 from public.staff s where s.id = auth.uid()) then raise exception 'staff only'; end if;
  select * into c from public.listing_claims where id = p_claim_id and status = 'pending' for update;
  if c.id is null then return 'gone'; end if;
  if p_approve then
    update public.directory_listings set owner_id = c.user_id, updated_at = now() where id = c.listing_id;
  end if;
  update public.listing_claims
     set status = case when p_approve then 'approved' else 'dismissed' end,
         method = 'staff', reviewed_at = now(), reviewed_by = auth.uid()
   where id = p_claim_id;
  return case when p_approve then 'approved' else 'dismissed' end;
end;
$$;
revoke all on function public.decide_listing_claim(uuid, boolean) from public, anon;
grant execute on function public.decide_listing_claim(uuid, boolean) to authenticated;

-- A new pending claim emails the desk (kind claim); a decision, staff's or the automatic
-- domain match, emails the claimant (kind claim_decided).
create or replace function public.notify_listing_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then kind := 'claim';
  elsif new.status in ('approved', 'dismissed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then kind := 'claim_decided';
  else return new;
  end if;
  begin
    perform net.http_post(
      url := 'https://znueitseoqijhkkvdomc.supabase.co/functions/v1/listing-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-alert-secret', coalesce(public.get_secret('ALERT_SECRET'), '')
      ),
      body := jsonb_build_object(
        'kind', kind,
        'record', jsonb_build_object(
          'id', new.id,
          'status', new.status,
          'method', new.method,
          'email', new.email,
          'note', new.note,
          'listing_id', new.listing_id,
          'listing_name', (select l.name from public.directory_listings l where l.id = new.listing_id),
          'listing_website', (select l.website from public.directory_listings l where l.id = new.listing_id))),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;
revoke all on function public.notify_listing_claim() from public, anon, authenticated;
drop trigger if exists listing_claim_alert on public.listing_claims;
create trigger listing_claim_alert after insert or update of status on public.listing_claims
  for each row execute function public.notify_listing_claim();
