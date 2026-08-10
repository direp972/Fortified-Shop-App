-- Run this once in your Supabase project's SQL Editor (left sidebar > SQL Editor > New query).
-- Creates every table the app needs: shared app data, customer accounts, and staff access.

create table if not exists app_storage (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- One row per registered customer, created automatically the moment someone signs up.
-- `tier` controls which price list they see: 'tier1' (preferred), 'greenleaf', or
-- 'tier2' (retail/off-the-street — the default for everyone until you upgrade them).
create table if not exists customers (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text default '',
  tier text not null default 'tier2' check (tier in ('tier1', 'greenleaf', 'tier2')),
  created_at timestamptz not null default now()
);

-- Anyone whose user id appears in this table gets staff access: Shop Floor, Backend
-- Pricing, and the ability to assign customer tiers. Nobody is added here through the
-- app itself — you add your first staff member by hand (see the bottom of this file),
-- and staff can't be added by customers, only by you running SQL directly.
create table if not exists staff (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table app_storage enable row level security;
alter table customers enable row level security;
alter table staff enable row level security;

-- app_storage: shared shop data (orders, price list, material costs). Anyone signed in
-- — staff or customer — can read and write it, same as how the app worked before login
-- existed. If you want customers to only ever submit orders and never see the raw
-- shared price list data directly, that would need a further RLS tightening later.
create policy "Authenticated read app_storage" on app_storage for select using (auth.role() = 'authenticated');
create policy "Authenticated write app_storage" on app_storage for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update app_storage" on app_storage for update using (auth.role() = 'authenticated');
create policy "Authenticated delete app_storage" on app_storage for delete using (auth.role() = 'authenticated');

-- customers: you can always see your own record. Staff can see everyone's (needed for
-- the Customer Pricing Tiers admin panel).
create policy "See own record or staff sees all" on customers
  for select using (
    auth.uid() = id
    or exists (select 1 from staff where staff.id = auth.uid())
  );

-- customers: you can create your own record the moment you sign up.
create policy "Insert own record on signup" on customers
  for insert with check (auth.uid() = id);

-- customers: ONLY staff can change a tier assignment. This is deliberate — a customer
-- should never be able to upgrade their own pricing tier by editing their own record.
create policy "Only staff can update tiers" on customers
  for update using (
    exists (select 1 from staff where staff.id = auth.uid())
  );

-- staff: you can check whether YOUR OWN account is staff (this is how the app decides
-- whether to show you the staff-only tabs). There's deliberately no insert/update/delete
-- policy here — nobody can add themselves as staff through the app, only through SQL
-- you run yourself in the Supabase dashboard.
create policy "Check own staff membership" on staff
  for select using (auth.uid() = id);


-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-TIME MANUAL STEP: make yourself (or your first employee) a staff member.
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sign up for a normal account through the app first (this creates your auth user
--    and a `customers` row automatically).
-- 2. Come back here, replace the email below with the one you signed up with, and run
--    just this one statement on its own:
--
-- insert into staff (id)
-- select id from auth.users where email = 'you@example.com';
--
-- After that, sign out and back in on the app — you'll now see Shop Floor and Backend
-- Pricing, and the Customer Pricing Tiers panel to assign pricing to everyone else.
