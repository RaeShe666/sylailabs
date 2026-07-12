-- 202607130001_chirp_invites.sql
-- couple 邀请钥匙：A 生成 code，B 凭 code 加入 planet 的群会话。
-- redeem 走 SECURITY DEFINER RPC（仅 service_role 可执行），保证原子+幂等。

create table if not exists public.chirp_invites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  planet_id uuid not null references public.chirp_planets(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','redeemed','expired','revoked')),
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists chirp_invites_one_pending_per_planet
  on public.chirp_invites (planet_id) where (status = 'pending');

alter table public.chirp_invites enable row level security;

-- inviter 可读自己的邀请
create policy chirp_invites_inviter_select on public.chirp_invites
  for select using (auth.uid() = inviter_id);

-- inviter 仅可把自己 pending 的邀请撤销为 revoked（不开 INSERT/DELETE，创建走后端 service role）
create policy chirp_invites_inviter_revoke on public.chirp_invites
  for update using (auth.uid() = inviter_id and status = 'pending')
  with check (auth.uid() = inviter_id and status = 'revoked');

-- 成员判定辅助（SECURITY DEFINER：policy 内用它避免自引用递归）
create or replace function public.is_chirp_conversation_member(p_conversation uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.chirp_conversation_members
    where conversation_id = p_conversation
      and member_type = 'user'
      and member_id = p_user::text
  );
$$;

create or replace function public.redeem_chirp_invite(p_code text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_invite public.chirp_invites%rowtype;
  v_conversation_id uuid;
begin
  select * into v_invite from public.chirp_invites
    where code = p_code for update;

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  -- 该 planet 的群会话（幂等分支和主分支共用；spec：群聊在邀请被接受后创建）
  select id into v_conversation_id from public.chirp_conversations
    where planet_id = v_invite.planet_id and type = 'group'
    order by created_at asc limit 1;

  -- 幂等：同一用户重复 redeem 直接返回结果
  if v_invite.status = 'redeemed' and v_invite.redeemed_by = p_user then
    return jsonb_build_object('planet_id', v_invite.planet_id,
                              'conversation_id', v_conversation_id,
                              'already_redeemed', true);
  end if;

  if v_invite.status = 'revoked' then raise exception 'INVITE_REVOKED'; end if;
  if v_invite.status = 'redeemed' then raise exception 'INVITE_ALREADY_REDEEMED'; end if;
  if v_invite.inviter_id = p_user then raise exception 'INVITE_SELF_REDEEM'; end if;
  if v_invite.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  if v_conversation_id is null then
    insert into public.chirp_conversations (owner_id, planet_id, type, title)
      values (v_invite.inviter_id, v_invite.planet_id, 'group', null)
      returning id into v_conversation_id;
  end if;

  insert into public.chirp_conversation_members (conversation_id, member_type, member_id)
    values (v_conversation_id, 'user', p_user::text)
    on conflict (conversation_id, member_type, member_id) do nothing;

  update public.chirp_invites
    set status = 'redeemed', redeemed_by = p_user, redeemed_at = now()
    where id = v_invite.id;

  return jsonb_build_object('planet_id', v_invite.planet_id,
                            'conversation_id', v_conversation_id,
                            'already_redeemed', false);
end;
$$;

-- 仅 service_role 可执行 redeem
revoke execute on function public.redeem_chirp_invite(text, uuid) from public, anon, authenticated;
grant execute on function public.redeem_chirp_invite(text, uuid) to service_role;
