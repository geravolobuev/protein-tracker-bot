create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  calories_target integer,
  protein_min integer not null,
  protein_max integer not null,
  timezone text not null default 'Europe/Moscow',
  pending_meal_text text,
  pending_meal_created_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  telegram_user_id bigint not null,
  meal_description text not null,
  calories numeric not null default 0,
  protein_grams numeric not null default 0,
  fat_grams numeric not null default 0,
  carb_grams numeric not null default 0,
  fiber_grams numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists meals_user_time_idx
  on meals (telegram_user_id, created_at desc);
