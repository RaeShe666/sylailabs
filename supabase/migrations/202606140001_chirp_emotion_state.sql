-- Real-time emotion state (persona-v2 §5.3). The perception layer maintains a
-- live, user-level (per conversation) emotional read that refreshes every turn,
-- replacing the slow per-instance affective_context distillation. One row per
-- (user, conversation); the next turn's perception builds on the prior read.

create table if not exists public.chirp_emotion_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.chirp_conversations(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, conversation_id)
);

create index if not exists chirp_emotion_state_user_idx
  on public.chirp_emotion_state(user_id, conversation_id);

alter table public.chirp_emotion_state enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_emotion_state'
      and policyname = 'Users can read their own emotion state'
  ) then
    create policy "Users can read their own emotion state"
      on public.chirp_emotion_state
      for select
      using (auth.uid() = user_id);
  end if;
end $$;
