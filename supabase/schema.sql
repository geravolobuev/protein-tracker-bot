create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  protein_min integer not null,
  protein_max integer not null,
  created_at timestamptz not null default now()
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  telegram_user_id bigint not null,
  meal_description text not null,
  protein_grams numeric not null,
  created_at timestamptz not null default now()
);

create index if not exists meals_user_time_idx
  on meals (telegram_user_id, created_at desc);
