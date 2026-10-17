-- Run once in Supabase > SQL Editor. This app ONLY accesses tables using
-- the service-role key on its own server. Never put that key in public JS.
create table if not exists relay_users (
  id uuid primary key, name text not null check (char_length(name) between 2 and 25),
  token_hash text not null unique, created_at timestamptz not null default now()
);
create table if not exists relay_rooms (
  id uuid primary key, name text not null, code text not null unique,
  owner_id uuid not null references relay_users(id), created_at timestamptz not null default now()
);
create table if not exists relay_members (
  room_id uuid not null references relay_rooms(id) on delete cascade,
  user_id uuid not null references relay_users(id) on delete cascade,
  joined_at timestamptz not null default now(), last_read_at timestamptz,
  primary key (room_id,user_id)
);
create table if not exists relay_messages (
  id uuid primary key, room_id uuid not null references relay_rooms(id) on delete cascade,
  user_id uuid not null references relay_users(id), author_name text not null,
  body text not null default '', image_key text,
  created_at timestamptz not null default now(), edited_at timestamptz,
  deleted_at timestamptz, reactions jsonb not null default '{}'::jsonb
);
create index if not exists relay_messages_room_time_idx on relay_messages (room_id, created_at desc);
create index if not exists relay_members_user_idx on relay_members (user_id);
create table if not exists relay_push_subscriptions (
  endpoint text primary key, user_id uuid not null references relay_users(id) on delete cascade,
  subscription jsonb not null, created_at timestamptz not null default now()
);
create index if not exists relay_push_user_idx on relay_push_subscriptions (user_id);
-- Keep direct anonymous/authenticated Supabase API access denied.
alter table relay_users enable row level security;
alter table relay_rooms enable row level security;
alter table relay_members enable row level security;
alter table relay_messages enable row level security;
alter table relay_push_subscriptions enable row level security;
-- No anon policies: only the trusted service role can access the data.
-- In Supabase Storage create a PRIVATE bucket named 'relay-images'.
-- Do not make this bucket public. The backend proxies authorized image downloads.
