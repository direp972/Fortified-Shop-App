-- Hardening from adversarial review of the supplier listing-edit feature.

-- anon has no business touching listing_edits; authenticated keeps only
-- RLS-governed DML (TRUNCATE/REFERENCES/TRIGGER would bypass or sidestep RLS).
revoke all on table public.listing_edits from anon;
revoke truncate, references, trigger on table public.listing_edits from authenticated;

-- Hide owner_id (and write privileges) from the public anon key. The grant list
-- mirrors every current column except owner_id — a column added later must be
-- granted to anon here too or the public directory can't select it.
revoke all on table public.directory_listings from anon;
grant select (id, application_id, status, name, badges, address, city, area_keywords, lat, lng, abilities, colors, coil_desc, fab_desc, website, phone, colorchart_url, created_at, updated_at, photos, logo_url, licensed_states, featured, logo_bg, locations, gmaps_url) on public.directory_listings to anon;

-- FK hygiene: a review must not block deleting a staff account, and a supplier
-- deleting their account must not erase the audit trail (rows orphan to
-- staff-only visibility because the owner policies compare against NULL).
alter table public.listing_edits drop constraint if exists listing_edits_reviewed_by_fkey;
alter table public.listing_edits add constraint listing_edits_reviewed_by_fkey
  foreign key (reviewed_by) references auth.users(id) on delete set null;
alter table public.listing_edits alter column submitted_by drop not null;
alter table public.listing_edits drop constraint if exists listing_edits_submitted_by_fkey;
alter table public.listing_edits add constraint listing_edits_submitted_by_fkey
  foreign key (submitted_by) references auth.users(id) on delete set null;

-- Trigger v2: on INSERT the ownership check runs FIRST (so field validation can
-- never act as an oracle for non-owners), the submitter identity and review
-- state are forced server-side (no spoofed submitted_email, no pre-'applied'
-- rows, no forged reviewed_by), and the '|' public-search facet delimiter is
-- rejected inside colors/abilities items.
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
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      if not exists (select 1 from public.directory_listings dl
                     where dl.id = new.listing_id and dl.owner_id = auth.uid()) then
        raise exception 'new row violates row-level security policy for table "listing_edits"';
      end if;
      new.submitted_by := auth.uid();
    end if;
    new.status := 'pending';
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.created_at := now();
    new.submitted_email := (select u.email::text from auth.users u where u.id = new.submitted_by);
  end if;
  if jsonb_typeof(new.proposed) is distinct from 'object' then
    raise exception 'proposed must be a JSON object';
  end if;
  if new.proposed = '{}'::jsonb and (new.note is null or btrim(new.note) = '') then
    raise exception 'nothing proposed';
  end if;
  if new.note is not null and length(new.note) > 4000 then
    raise exception 'note too long';
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
        if position('|' in (el #>> '{}')) > 0 then
          raise exception 'field % items must not contain the | character', k;
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
