-- RLS policies for Chirp M1 runtime tables.
-- These policies allow authenticated users to access only their own Chirp data.

alter table public.chirp_conversations enable row level security;
alter table public.chirp_conversation_members enable row level security;
alter table public.chirp_runs enable row level security;
alter table public.chirp_insights enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_conversations'
      and policyname = 'Users can manage their own Chirp conversations'
  ) then
    create policy "Users can manage their own Chirp conversations"
      on public.chirp_conversations
      for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_conversation_members'
      and policyname = 'Users can manage members of their own Chirp conversations'
  ) then
    create policy "Users can manage members of their own Chirp conversations"
      on public.chirp_conversation_members
      for all
      using (
        exists (
          select 1
          from public.chirp_conversations c
          where c.id = conversation_id
            and c.owner_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.chirp_conversations c
          where c.id = conversation_id
            and c.owner_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_runs'
      and policyname = 'Users can manage their own Chirp runs'
  ) then
    create policy "Users can manage their own Chirp runs"
      on public.chirp_runs
      for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chirp_insights'
      and policyname = 'Users can manage their own Chirp insights'
  ) then
    create policy "Users can manage their own Chirp insights"
      on public.chirp_insights
      for all
      using (auth.uid() = owner_id)
      with check (auth.uid() = owner_id);
  end if;
end $$;

