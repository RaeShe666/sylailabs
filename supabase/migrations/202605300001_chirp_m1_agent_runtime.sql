-- Chirp M1 agent runtime foundation.
-- This migration keeps existing chirp_* tables compatible while adding the
-- conversation/run boundaries required by the v2 architecture.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.chirp_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  planet_id uuid references public.chirp_planets(id) on delete cascade,
  type text not null check (type in ('group', 'persona_dm', 'bird_dm')),
  title text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chirp_conversations_owner_idx
  on public.chirp_conversations(owner_id);

create index if not exists chirp_conversations_planet_idx
  on public.chirp_conversations(planet_id);

create table if not exists public.chirp_conversation_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chirp_conversations(id) on delete cascade,
  member_type text not null check (member_type in ('user', 'bird', 'persona')),
  member_id text not null,
  persona_id uuid references public.chirp_personas(id) on delete set null,
  agent_role text,
  listen_mode text not null default 'passive' check (listen_mode in ('active', 'passive', 'mention_only')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (conversation_id, member_type, member_id)
);

create index if not exists chirp_conversation_members_conversation_idx
  on public.chirp_conversation_members(conversation_id);

create index if not exists chirp_conversation_members_lookup_idx
  on public.chirp_conversation_members(member_type, member_id);

create table if not exists public.chirp_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.chirp_conversations(id) on delete set null,
  planet_id uuid references public.chirp_planets(id) on delete set null,
  agent_id text not null,
  agent_role text not null check (agent_role in ('bird', 'persona')),
  trigger_type text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  memory_scope jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists chirp_runs_owner_idx
  on public.chirp_runs(owner_id);

create index if not exists chirp_runs_conversation_idx
  on public.chirp_runs(conversation_id);

create table if not exists public.chirp_insights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  planet_id uuid references public.chirp_planets(id) on delete cascade,
  topic text,
  content text not null,
  source_message_ids uuid[] not null default '{}',
  confidence numeric(4,3),
  status text not null default 'candidate' check (status in ('candidate', 'pending_confirmation', 'confirmed', 'hidden', 'deleted')),
  visibility text not null default 'planet' check (visibility in ('private', 'planet', 'global')),
  user_feedback jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chirp_insights_owner_idx
  on public.chirp_insights(owner_id);

create index if not exists chirp_insights_planet_idx
  on public.chirp_insights(planet_id);

alter table public.chirp_messages
  add column if not exists conversation_id uuid references public.chirp_conversations(id) on delete cascade,
  add column if not exists run_id uuid references public.chirp_runs(id) on delete set null,
  add column if not exists reply_to_message_id uuid references public.chirp_messages(id) on delete set null,
  add column if not exists is_personal_record boolean not null default false,
  add column if not exists sender_role text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists chirp_messages_conversation_idx
  on public.chirp_messages(conversation_id, created_at);

create index if not exists chirp_messages_run_idx
  on public.chirp_messages(run_id);

alter table public.chirp_personas
  add column if not exists identity jsonb not null default '{}'::jsonb,
  add column if not exists relationship jsonb not null default '{}'::jsonb,
  add column if not exists voice_style jsonb not null default '{}'::jsonb,
  add column if not exists boundaries jsonb not null default '{}'::jsonb,
  add column if not exists reply_policy jsonb not null default '{}'::jsonb,
  add column if not exists memory_policy jsonb not null default '{}'::jsonb,
  add column if not exists examples jsonb not null default '[]'::jsonb,
  add column if not exists lane_contract jsonb not null default '{}'::jsonb,
  add column if not exists agent_role text not null default 'persona',
  add column if not exists listen_mode text not null default 'passive';

alter table public.chirp_personas
  drop constraint if exists chirp_personas_agent_role_check;

alter table public.chirp_personas
  add constraint chirp_personas_agent_role_check
  check (agent_role in ('persona', 'bird'));

alter table public.chirp_personas
  drop constraint if exists chirp_personas_listen_mode_check;

alter table public.chirp_personas
  add constraint chirp_personas_listen_mode_check
  check (listen_mode in ('active', 'passive', 'mention_only'));
