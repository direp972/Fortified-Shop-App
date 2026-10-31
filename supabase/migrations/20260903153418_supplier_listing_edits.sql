-- Supplier self-serve listing edits with staff review gate.

-- 1) Listings can belong to a supplier account (the person who may propose edits).
alter table public.directory_listings
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

-- Owner may read their own listing regardless of status (public policy only shows live).
drop policy if exists "owner reads own listing" on public.directory_listings;
create policy "owner reads own listing" on public.directory_listings
  for select using (owner_id = auth.uid());

-- 2) Proposed edits: never applied automatically — staff review in /directory-admin.html.
create table if not exists public.listing_edits (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.directory_listings(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submitted_email text,
  proposed jsonb not null default '{}'::jsonb,
  note text,
  status text not null default 'pending' check (status in ('pending','applied','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists listing_edits_listing_idx on public.listing_edits(listing_id);
create index if not exists listing_edits_status_idx on public.listing_edits(status);

-- Only whitelisted, size-bounded fields may be proposed; caps spam per listing.
create or replace function public.validate_listing_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array['name','phone','website','gmaps_url','licensed_states','coil_desc','fab_desc','colors','abilities'];
  k text;
  v jsonb;
  el jsonb;
begin
  if jsonb_typeof(new.proposed) is distinct from 'object' then
    raise exception 'proposed must be a JSON object';
  end if;
  if new.proposed = '{}'::jsonb and (new.note is null or btrim(new.note) = '') then
    raise exception 'nothing proposed';
  end if;
  if new.note is not null and length(new.note) > 4000 then
    raise exception 'note too long';
  end if;
  if new.submitted_email is not null and length(new.submitted_email) > 320 then
    raise exception 'email too long';
  end if;
  for k, v in select * from jsonb_each(new.proposed) loop
    if k <> all(allowed) then
      raise exception 'field % cannot be proposed', k;
    end if;
    if k in ('colors','abilities') then
      if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) > 100 then
        raise exception 'field % must be an array of at most 100 items', k;
      end if;
      for el in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(el) is distinct from 'string' or length(el #>> '{}') > 120 then
          raise exception 'field % items must be short strings', k;
        end if;
      end loop;
    else
      if jsonb_typeof(v) is distinct from 'string' or length(v #>> '{}') > 2000 then
        raise exception 'field % must be a string under 2000 chars', k;
      end if;
    end if;
  end loop;
  if tg_op = 'INSERT' and (select count(*) from public.listing_edits e
      where e.listing_id = new.listing_id and e.status = 'pending') >= 10 then
    raise exception 'too many pending edits for this listing';
  end if;
  return new;
end;
$$;
drop trigger if exists listing_edits_validate on public.listing_edits;
create trigger listing_edits_validate
  before insert or update of proposed, note, submitted_email on public.listing_edits
  for each row execute function public.validate_listing_edit();

alter table public.listing_edits enable row level security;

drop policy if exists "owner submits edits" on public.listing_edits;
create policy "owner submits edits" on public.listing_edits
  for insert with check (
    submitted_by = auth.uid()
    and exists (select 1 from public.directory_listings dl
                where dl.id = listing_id and dl.owner_id = auth.uid())
  );

drop policy if exists "owner or staff read edits" on public.listing_edits;
create policy "owner or staff read edits" on public.listing_edits
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from public.staff s where s.id = auth.uid())
  );

drop policy if exists "staff update edits" on public.listing_edits;
create policy "staff update edits" on public.listing_edits
  for update using (exists (select 1 from public.staff s where s.id = auth.uid()))
  with check (exists (select 1 from public.staff s where s.id = auth.uid()));

drop policy if exists "owner withdraws pending, staff delete" on public.listing_edits;
create policy "owner withdraws pending, staff delete" on public.listing_edits
  for delete using (
    (submitted_by = auth.uid() and status = 'pending')
    or exists (select 1 from public.staff s where s.id = auth.uid())
  );

-- 3) Staff-only RPCs to link a listing to a supplier account and list the links.
create or replace function public.set_listing_owner(p_listing_id uuid, p_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  if not exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'staff only';
  end if;
  if p_email is null or btrim(p_email) = '' then
    update public.directory_listings set owner_id = null where id = p_listing_id;
    if not found then raise exception 'no such listing'; end if;
    return 'cleared';
  end if;
  select id into uid from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if uid is null then
    return 'no-account';
  end if;
  update public.directory_listings set owner_id = uid where id = p_listing_id;
  if not found then raise exception 'no such listing'; end if;
  return 'linked';
end;
$$;
revoke all on function public.set_listing_owner(uuid, text) from public, anon;
grant execute on function public.set_listing_owner(uuid, text) to authenticated;

create or replace function public.staff_listing_owners()
returns table(listing_id uuid, email text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.staff where id = auth.uid()) then
    raise exception 'staff only';
  end if;
  return query
    select dl.id, u.email::text
    from public.directory_listings dl
    join auth.users u on u.id = dl.owner_id;
end;
$$;
revoke all on function public.staff_listing_owners() from public, anon;
grant execute on function public.staff_listing_owners() to authenticated;

-- 4) Link Adax Metals to Chance Freeman's account so this works for them immediately.
update public.directory_listings
  set owner_id = 'e28a49d7-3840-4a54-8044-998d6f2fcd59'
  where id = '8f4b5f8e-8b14-47d3-9a5f-1fe6072ac565';
