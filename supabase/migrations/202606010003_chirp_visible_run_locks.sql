-- One visible turn at a time per conversation.
-- @all may fan out to several agent runs inside the same turn, so the lock sits
-- above chirp_runs at conversation level.

create table if not exists public.chirp_visible_run_locks (
  conversation_id uuid primary key references public.chirp_conversations(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 minutes'
);

create index if not exists chirp_visible_run_locks_owner_idx
  on public.chirp_visible_run_locks(owner_id);

create or replace function public.acquire_chirp_visible_run_lock(
  p_owner_id uuid,
  p_conversation_id uuid,
  p_lock_token uuid,
  p_ttl_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  did_acquire boolean;
begin
  insert into public.chirp_visible_run_locks (
    conversation_id,
    owner_id,
    lock_token,
    locked_at,
    expires_at
  )
  values (
    p_conversation_id,
    p_owner_id,
    p_lock_token,
    now(),
    now() + make_interval(secs => greatest(p_ttl_seconds, 1))
  )
  on conflict (conversation_id)
  do update set
    owner_id = excluded.owner_id,
    lock_token = excluded.lock_token,
    locked_at = excluded.locked_at,
    expires_at = excluded.expires_at
  where public.chirp_visible_run_locks.expires_at < now()
  returning true into did_acquire;

  return coalesce(did_acquire, false);
end;
$$;
