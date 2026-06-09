create extension if not exists pgcrypto;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  match_id text unique not null,
  game_creation bigint,
  game_duration integer,
  game_version text,
  queue_id integer,
  platform_id text,
  raw_json jsonb,
  created_at timestamptz default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(match_id) on delete cascade,
  puuid text,
  summoner_name text,
  riot_id_game_name text,
  riot_id_tagline text,
  champion_id integer,
  champion_name text,
  team_position text,
  individual_position text,
  lane text,
  role text,
  win boolean,
  kills integer,
  deaths integer,
  assists integer,
  total_minions_killed integer,
  neutral_minions_killed integer,
  gold_earned integer,
  total_damage_dealt_to_champions integer,
  vision_score integer,
  item0 integer,
  item1 integer,
  item2 integer,
  item3 integer,
  item4 integer,
  item5 integer,
  item6 integer,
  game_duration integer,
  created_at timestamptz default now(),
  unique(match_id, puuid)
);

create table if not exists public.champion_stats_cache (
  id uuid primary key default gen_random_uuid(),
  position text not null,
  champion_id integer not null,
  champion_name text not null,
  total_games integer default 0,
  wins integer default 0,
  losses integer default 0,
  win_rate numeric,
  pick_rate numeric,
  avg_kda numeric,
  avg_cs numeric,
  tier_score numeric,
  tier_grade text,
  low_sample boolean default false,
  patch_version text,
  calculated_at timestamptz default now(),
  unique(position, champion_id, patch_version)
);

create index if not exists participants_match_id_idx on public.participants(match_id);
create index if not exists participants_team_position_idx on public.participants(team_position);
create index if not exists participants_champion_id_idx on public.participants(champion_id);
create index if not exists champion_stats_cache_position_idx on public.champion_stats_cache(position);
create index if not exists champion_stats_cache_tier_grade_idx on public.champion_stats_cache(tier_grade);

alter table public.matches enable row level security;
alter table public.participants enable row level security;
alter table public.champion_stats_cache enable row level security;

-- No public policies are created. The backend uses the service role key, which
-- bypasses RLS. Never expose SUPABASE_SERVICE_ROLE_KEY to browser code.
