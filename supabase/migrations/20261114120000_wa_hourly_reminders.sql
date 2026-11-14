-- Hourly pending task reminders (10 AM - 7 PM India time).
-- Directors and EAs receive reminders for open tasks every hour.
create table if not exists public.wa_hourly_reminders(
  task_id uuid not null references public.tasks(id) on delete cascade,
  chat_id text not null,
  hour_anchor timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (task_id, chat_id, hour_anchor)
);
alter table public.wa_hourly_reminders enable row level security;

-- Index for cleanup of old reminders
create index if not exists wa_hourly_reminders_sent_at_idx on public.wa_hourly_reminders(sent_at);