-- FMS (flow monitoring): a separate section, apart from tasks and checklists.
-- First flow: ERP sales orders. Steps and ETAs (from the moment the step starts):
--   approval  2 h   (order punched -> approved)          Tukeshwar
--   dispatch  24 h  (approved -> fully dispatched)       Gulshan
--   invoice   3 h   (dispatch posted -> invoice added)   Gulshan
--   transport 24 h  (invoice added -> bilty + receiving) Pravesh
-- The ERP is the source of truth: /api/whatsapp/alerts pulls its fms-feed every minute into fms_items.
-- Doers and ETAs are changed on the FMS page. Only orders punched after live_from are tracked.

create table if not exists public.fms_processes(
  code text primary key,
  name text not null,
  live_from timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists public.fms_steps(
  process text not null references public.fms_processes(code) on delete cascade,
  code text not null,
  name text not null,
  seq int not null,
  eta_minutes int not null check (eta_minutes between 5 and 43200),
  doer_id uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  primary key (process, code)
);

-- One row per step instance, keyed by the ERP ('approval:<order id>', 'invoice:<dispatch id>', ...).
-- due = started_at + the step's current ETA, so an ETA change applies to open work too.
create table if not exists public.fms_items(
  key text primary key,
  process text not null,
  step text not null,
  order_id uuid not null,
  order_no text not null,
  customer text,
  ref text,
  started_at timestamptz not null,
  done_at timestamptz,
  cancelled boolean not null default false,
  synced_at timestamptz not null default now(),
  foreign key (process, step) references public.fms_steps(process, code) on delete cascade
);
create index if not exists fms_items_open_idx on public.fms_items(process, started_at) where done_at is null and not cancelled;
create index if not exists fms_items_done_idx on public.fms_items(done_at desc) where done_at is not null;
create index if not exists fms_items_order_idx on public.fms_items(order_id);

-- Inserting first is how a run claims an alert, so none goes out twice (same pattern as wa_task_alerts).
create table if not exists public.fms_alerts(
  item_key text not null references public.fms_items(key) on delete cascade,
  stage text not null check (stage in ('assigned', 'due_soon', 'overdue', 'escalated')),
  anchor timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (item_key, stage, anchor)
);

-- The FMS page and the scheduler use the service role after their own role checks. A doer reads only
-- the items of steps they are doer on, for their dashboard; nobody writes from the browser.
alter table public.fms_processes enable row level security;
alter table public.fms_steps enable row level security;
alter table public.fms_items enable row level security;
alter table public.fms_alerts enable row level security;
revoke all on public.fms_processes, public.fms_steps, public.fms_items, public.fms_alerts from anon, authenticated;
grant select on public.fms_steps, public.fms_items to authenticated;

drop policy if exists "fms steps read" on public.fms_steps;
create policy "fms steps read" on public.fms_steps for select to authenticated using (true);

drop policy if exists "fms items read own" on public.fms_items;
create policy "fms items read own" on public.fms_items for select to authenticated using (
  public.is_manager() or exists (
    select 1 from public.fms_steps s join public.employees e on e.id = s.doer_id
    where s.process = fms_items.process and s.code = fms_items.step and e.auth_user_id = (select auth.uid())
  )
);

insert into public.fms_processes(code, name) values ('sales_order', 'Sales order') on conflict (code) do nothing;

insert into public.fms_steps(process, code, name, seq, eta_minutes, doer_id)
select 'sales_order', s.code, s.name, s.seq, s.eta, (
  select e.id from public.employees e where e.active and e.name ilike s.doer || '%' order by e.created_at limit 1
)
from (values
  ('approval', 'Order approval', 1, 120, 'Tukeshwar'),
  ('dispatch', 'Dispatch', 2, 1440, 'Gulshan'),
  ('invoice', 'Invoice', 3, 180, 'Gulshan'),
  ('transport', 'Sales transport', 4, 1440, 'Pravesh')
) as s(code, name, seq, eta, doer)
on conflict (process, code) do nothing;

-- Rollback:
-- drop table if exists public.fms_alerts, public.fms_items, public.fms_steps, public.fms_processes;
