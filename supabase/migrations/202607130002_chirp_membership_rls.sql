-- 202607130002_chirp_membership_rls.sql
-- owner-only → owner OR member。全部为"或"扩展：不动任何既有 policy。

-- 0) 前置断言：不存在同 planet 多个 group 会话（有则中止，人工处理后再 push）
do $$
declare v_planet uuid;
begin
  select planet_id into v_planet from public.chirp_conversations
    where type = 'group' and planet_id is not null
    group by planet_id having count(*) > 1 limit 1;
  if v_planet is not null then
    raise exception 'DUPLICATE_GROUP_CONVERSATIONS_FOR_PLANET %', v_planet;
  end if;
end $$;

-- 1) 一 planet 一群：唯一键从 (owner_id, planet_id) 改为 (planet_id)
drop index if exists public.chirp_conv_group_uniq;
create unique index if not exists chirp_conv_group_by_planet_uniq
  on public.chirp_conversations (planet_id) where (type = 'group');

-- 2) type='couple'
-- > AUDIT (2026-07-13): 探针证明线上可直接插入 type='couple'，无 check 约束需要放开。本段无 SQL。

-- 3) conversations：成员可读
create policy chirp_conversations_member_select on public.chirp_conversations
  for select using (public.is_chirp_conversation_member(id, auth.uid()));

-- 4) conversation_members：成员可读同会话成员表
create policy chirp_conversation_members_member_select on public.chirp_conversation_members
  for select using (public.is_chirp_conversation_member(conversation_id, auth.uid()));

-- 5) messages：成员可读；成员可写自己的用户消息
create policy chirp_messages_member_select on public.chirp_messages
  for select using (
    conversation_id is not null
    and public.is_chirp_conversation_member(conversation_id, auth.uid())
  );

-- > AUDIT (2026-07-13): 线上用户消息 sender_id 是字面量 'user'（20/20 采样），不是 uuid。
-- > 决策：member INSERT policy **保留** sender_id = auth.uid()::text 强校验——理由：
-- > 该 policy 只服务新的成员路径（B 的前端直写，未来 couple UI 我们控制写什么），
-- > 旧前端 'user' 写法走仓库外的既有 owner policy，不经过这条；强校验防成员冒充对方。
-- > 配套：Task 4 要求 couple 会话的后端 insertMessage 把 sender_id 写成请求者 uuid（见 Task 4 Step 4b）。
create policy chirp_messages_member_insert on public.chirp_messages
  for insert with check (
    conversation_id is not null
    and public.is_chirp_conversation_member(conversation_id, auth.uid())
    and sender_type = 'user'
    and sender_id = auth.uid()::text
  );

-- 6) planets：群成员可读所属 planet
create policy chirp_planets_member_select on public.chirp_planets
  for select using (
    exists (
      select 1 from public.chirp_conversations c
      where c.planet_id = chirp_planets.id
        and c.type = 'group'
        and public.is_chirp_conversation_member(c.id, auth.uid())
    )
  );
