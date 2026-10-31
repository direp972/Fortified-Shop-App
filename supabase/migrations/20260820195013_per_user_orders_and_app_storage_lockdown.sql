-- Orders move out of the shared app_storage blob into a per-user table.
create table public.orders (
  id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.orders enable row level security;
create policy "own or staff read" on public.orders for select
  using (user_id = auth.uid() or exists (select 1 from staff where staff.id = auth.uid()));
create policy "own insert" on public.orders for insert
  with check (user_id = auth.uid());
create policy "staff update" on public.orders for update
  using (exists (select 1 from staff where staff.id = auth.uid()))
  with check (exists (select 1 from staff where staff.id = auth.uid()));
create policy "staff delete" on public.orders for delete
  using (exists (select 1 from staff where staff.id = auth.uid()));
create index orders_user_idx on public.orders (user_id);

-- Global PO counter: customers can no longer see each other's orders, so PO numbers
-- must come from the server to stay unique. Existing orders end at PO-1002.
create sequence public.po_number_seq start 1003;
create or replace function public.next_po_number() returns text
language sql security definer set search_path = public as
$$ select 'PO-' || nextval('public.po_number_seq')::text $$;
revoke all on function public.next_po_number() from public;
grant execute on function public.next_po_number() to authenticated;

-- Migrate the legacy blob; unknown owners stay staff-visible only (user_id null).
insert into public.orders (id, user_id, data, created_at)
select o->>'id', null, o, coalesce((o->>'createdAt')::timestamptz, now())
from public.app_storage, jsonb_array_elements(value::jsonb) as o
where key = 'shop-orders';
delete from public.app_storage where key = 'shop-orders';

-- app_storage lockdown: drop ALL anon access; pricing/cost keys become staff-only writes.
drop policy "Allow anon delete" on public.app_storage;
drop policy "Allow anon read" on public.app_storage;
drop policy "Allow anon update" on public.app_storage;
drop policy "Allow anon write" on public.app_storage;
drop policy "Authenticated delete app_storage" on public.app_storage;
drop policy "Authenticated read app_storage" on public.app_storage;
drop policy "Authenticated update app_storage" on public.app_storage;
drop policy "Authenticated write app_storage" on public.app_storage;
create policy "auth read app_storage" on public.app_storage for select
  using (auth.role() = 'authenticated');
create policy "auth insert app_storage" on public.app_storage for insert
  with check (auth.role() = 'authenticated' and (
    key not in ('shop-price-list','shop-material-costs','shop-production-costs','shop-coil-width-scale','shop-orders')
    or exists (select 1 from staff where staff.id = auth.uid())));
create policy "auth update app_storage" on public.app_storage for update
  using (auth.role() = 'authenticated' and (
    key not in ('shop-price-list','shop-material-costs','shop-production-costs','shop-coil-width-scale','shop-orders')
    or exists (select 1 from staff where staff.id = auth.uid())))
  with check (auth.role() = 'authenticated' and (
    key not in ('shop-price-list','shop-material-costs','shop-production-costs','shop-coil-width-scale','shop-orders')
    or exists (select 1 from staff where staff.id = auth.uid())));
create policy "auth delete app_storage" on public.app_storage for delete
  using (auth.role() = 'authenticated' and (
    key not in ('shop-price-list','shop-material-costs','shop-production-costs','shop-coil-width-scale','shop-orders')
    or exists (select 1 from staff where staff.id = auth.uid())));
