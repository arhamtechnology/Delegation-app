-- Hourly pending-work report (10 AM - 6 PM India time): one row per recipient per hour keeps it to one send.
create table if not exists public.wa_hourly_digests(
  chat_id text not null,
  hour_anchor timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (chat_id, hour_anchor)
);
alter table public.wa_hourly_digests enable row level security;
