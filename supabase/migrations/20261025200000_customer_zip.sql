-- "Pricing in your area": sign-up asks for a ZIP code. It travels in the auth user's
-- metadata like name and phone, lands on the customers row when the account is confirmed,
-- and is copied over later for accounts that add it after they already exist (a Google
-- sign-in answers the one-last-thing card after its row was created). Leads keep it too,
-- for the shop's list. The app uses it to start a new account on the shop taking orders
-- nearest that ZIP.

alter table public.customers add column if not exists zip text;
alter table public.leads add column if not exists zip text;

-- The confirmed-user trigger carries the ZIP; an existing row keeps what it has and only
-- fills in what it lacks.
create or replace function public.handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is null then return new; end if;
  insert into public.customers (id, email, name, phone, zip)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'zip', ''))
  on conflict (id) do update
    set phone = coalesce(nullif(public.customers.phone, ''), excluded.phone),
        zip = coalesce(nullif(public.customers.zip, ''), excluded.zip);
  return new;
end;
$$;

-- Details added after the account exists (the Google one-last-thing card writes phone and
-- ZIP to the user's metadata) reach the customers row the same way.
create or replace function public.sync_customer_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customers c
     set phone = coalesce(nullif(c.phone, ''), new.raw_user_meta_data->>'phone'),
         zip = coalesce(nullif(c.zip, ''), nullif(new.raw_user_meta_data->>'zip', ''))
   where c.id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_details on auth.users;
create trigger on_auth_user_details
  after update of raw_user_meta_data on auth.users
  for each row execute function public.sync_customer_details();
