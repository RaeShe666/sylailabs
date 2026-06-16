-- Emotion trajectory log (persona-v2 §5.3). Append-only history of the per-turn
-- perception read, so we can analyze how the user's emotion moves over time
-- ("情绪记忆分析"). chirp_emotion_state keeps only the latest slice (fast prior
-- read); this table keeps every turn's slice. Written best-effort in the
-- background after the reply — never on the reply critical path.

create table if not exists public.chirp_emotion_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.chirp_conversations(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chirp_emotion_log_conv_idx
  on public.chirp_emotion_log(user_id, conversation_id, created_at desc);

alter table public.chirp_emotion_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_emotion_log'
      and policyname = 'Users can read their own emotion log'
  ) then
    create policy "Users can read their own emotion log"
      on public.chirp_emotion_log
      for select
      using (auth.uid() = user_id);
  end if;
end $$;
