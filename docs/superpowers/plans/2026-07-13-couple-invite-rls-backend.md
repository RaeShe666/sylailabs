# Couple 邀请钥匙 + RLS Membership 后端 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让第二个真人 B 能凭邀请码加入 A 的 couple planet 群聊会话，双方消息互相可见（RLS membership），后端全链路可用（不含前端 UI 与 Bird 群聊模式）。

**Architecture:** 三层推进——①线上 schema 审计消除仓库外盲区；②两个 migration（`chirp_invites` 表+原子 redeem RPC；唯一键改造+membership RLS 策略，全部经 SECURITY DEFINER 辅助函数避免策略递归）；③后端 `inviteStore` 模块 + 三个邀请端点 + `prepareTurn`/`ensureConversation` 的 membership 适配（couple 群本切片不激活任何 agent）。

**Tech Stack:** Supabase Postgres (RLS/RPC) · Node Express (`backend/routes/chirp.js`) · `node --test` 单测（注入假 client，不打真 DB）

## Global Constraints

- 全 JS（无 TS）；后端公共函数 JSDoc 标注。
- 测试跑法：`cd backend && npm test`（node --test；测试不连真模型/真 DB，用注入的假 client）。
- API 错误统一 `{ error: { code, message } }`；所有"点两下会出事"的写操作幂等。
- 前端 anon client 只读+Realtime；**校验性写一律走后端 service role**（`backend/lib/supabaseAdmin.js` 的 `supabaseAdmin`）。
- Migration 纪律：文件**无 UTF-8 BOM**；`db push` 走 pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`，user=`postgres.ptmjnccknvuqekaywvib`，密码含 `@` 需 URL 编码。
- 新 RLS policy 名一律 `chirp_<table>_<intent>` 前缀且不与线上既有 policy 重名（Task 0 审计后确认）；**不 drop 任何仓库外的既有 policy**（membership 策略是 OR 扩展）。
- agent 记忆边界规则（spec §2）：本计划不给任何 agent 增加可见范围；couple 群在本切片不激活 agent。
- 提交风格：`feat(chirp): ...` / `fix(chirp): ...`，每个 Task 至少一个 commit。
- 影响追踪调查结论（2026-07-13 探索报告）是本计划的事实基础；行号引用以它为准，动手前先重读对应文件段落。

---

### Task 0: 线上 schema 审计（消除仓库外盲区）

`chirp_planets`、`chirp_messages` 的建表与基础 policy 不在仓库 migrations 里（早于 `202605300001`）。改 RLS 前必须先拿到线上事实。

**Files:**
- Create: `docs/superpowers/research/2026-07-13-live-schema-audit.md`（审计结果记录）

**Interfaces:**
- Produces: 审计文档回答下列问题，Task 1/2/4 的 SQL 定稿依赖它：
  1. `chirp_planet_members` 表在线上是否存在？结构？（前端 `chirpSupabase.js:626/653/671` 在读写它，migrations 里却没有）
  2. `chirp_planets` 全部列 + `type` 列上有无 check 约束？允许哪些值？（couple planet 需要 `type='couple'`）
  3. `chirp_messages` 线上全部 policy（尤其 INSERT policy 的条件——前端 anon insert 现在能工作，必有一条仓库外 policy）
  4. `chirp_planets` 线上全部 policy
  5. 用户消息的 `sender_id` 取值形态（是否= `auth.uid()` 文本？决定 Task 2 INSERT policy 是否加 `sender_id = auth.uid()::text` 强校验）
  6. `chirp_conversations` 中是否存在同一 `planet_id` 多条 `type='group'` 的行（Task 2 唯一键改造的前置检查）

- [ ] **Step 1: 导出线上 policy 与表结构**

用已 link 的 supabase CLI（需要 DB 密码，找 Rae 要或读本地已存的连接串）：

```powershell
npx supabase db dump --linked -f scratch-schema-dump.sql
```

若 CLI dump 失败，用 psql 直查（密码 URL 编码后替换）：

```powershell
psql "postgresql://postgres.ptmjnccknvuqekaywvib:<PW>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres" -c "select tablename, policyname, cmd, qual, with_check from pg_policies where tablename like 'chirp%' order by tablename, policyname;"
psql "..." -c "\d public.chirp_planets"
psql "..." -c "\d public.chirp_planet_members"
psql "..." -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.chirp_planets'::regclass;"
psql "..." -c "select planet_id, count(*) from public.chirp_conversations where type='group' group by planet_id having count(*)>1;"
psql "..." -c "select distinct sender_type, left(sender_id,40) from public.chirp_messages limit 30;"
```

- [ ] **Step 2: 把 6 个问题的答案写进审计文档**

`docs/superpowers/research/2026-07-13-live-schema-audit.md`，每个问题一节，贴原始输出。`scratch-schema-dump.sql` 不入库（加入 .gitignore 或用后删除）。

- [ ] **Step 3: 按审计结果修订本计划**

明确写出：Task 1/2 SQL 里的 policy 名是否撞名、`type='couple'` 是否需要放开 check 约束（若需要，在 Task 2 migration 里加 `alter table ... drop constraint ...; add constraint ... check (type in (..., 'couple'))`）、INSERT policy 用宽松版还是强校验版。修订处在计划文档中用 `> AUDIT:` 引用块标注。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-07-13-live-schema-audit.md docs/superpowers/plans/2026-07-13-couple-invite-rls-backend.md
git commit -m "docs(chirp): 线上schema审计——RLS改造前置事实"
```

---

### Task 1: Migration — `chirp_invites` 表 + 原子 redeem RPC

**Files:**
- Create: `supabase/migrations/202607130001_chirp_invites.sql`

**Interfaces:**
- Produces（Task 3 依赖）:
  - 表 `public.chirp_invites(id, code unique, planet_id, inviter_id, status, redeemed_by, redeemed_at, expires_at, created_at)`；partial unique：一个 planet 同时只有一张 pending 钥匙。
  - RPC `public.redeem_chirp_invite(p_code text, p_user uuid) returns jsonb`——原子完成：校验 → 找/建群会话 → 插成员 → 标记 redeemed。返回 `{"planet_id": ..., "conversation_id": ...}`；失败 `raise exception` 且 `errcode` 用自定义文本（见下），JS 层按 message 前缀映射错误码。
  - 辅助函数 `public.is_chirp_conversation_member(p_conversation uuid, p_user uuid) returns boolean`（SECURITY DEFINER，Task 2 的 policy 也用它）。

- [ ] **Step 1: 写 migration 文件**（无 BOM；若 Task 0 发现撞名/约束问题按 `> AUDIT:` 修订）

```sql
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

-- inviter 可读可撤销自己的邀请；redeem 不走客户端
create policy chirp_invites_inviter_all on public.chirp_invites
  for all using (auth.uid() = inviter_id) with check (auth.uid() = inviter_id);

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

  -- 幂等：同一用户重复 redeem 直接返回结果
  if v_invite.status = 'redeemed' and v_invite.redeemed_by = p_user then
    select id into v_conversation_id from public.chirp_conversations
      where planet_id = v_invite.planet_id and type = 'group'
      order by created_at asc limit 1;
    return jsonb_build_object('planet_id', v_invite.planet_id,
                              'conversation_id', v_conversation_id,
                              'already_redeemed', true);
  end if;

  if v_invite.status = 'revoked' then raise exception 'INVITE_REVOKED'; end if;
  if v_invite.status = 'redeemed' then raise exception 'INVITE_ALREADY_REDEEMED'; end if;
  if v_invite.expires_at <= now() then
    update public.chirp_invites set status = 'expired' where id = v_invite.id;
    raise exception 'INVITE_EXPIRED';
  end if;
  if v_invite.inviter_id = p_user then raise exception 'INVITE_SELF_REDEEM'; end if;

  -- 找/建该 planet 的群会话（spec：群聊在邀请被接受后创建）
  select id into v_conversation_id from public.chirp_conversations
    where planet_id = v_invite.planet_id and type = 'group'
    order by created_at asc limit 1;

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
```

- [ ] **Step 2: 本地静态检查**

确认文件无 BOM（PowerShell：`(Get-Content supabase\migrations\202607130001_chirp_invites.sql -Encoding Byte -TotalCount 3) -join ','` 不是 `239,187,191`）。SQL 引号内无中文全角引号。

- [ ] **Step 3: Commit**（push 统一放在 Task 5，先攒齐两个 migration）

```bash
git add supabase/migrations/202607130001_chirp_invites.sql
git commit -m "feat(chirp): chirp_invites 表 + 原子 redeem RPC (migration)"
```

---

### Task 2: Migration — 群会话唯一键改造 + membership RLS

**Files:**
- Create: `supabase/migrations/202607130002_chirp_membership_rls.sql`

**Interfaces:**
- Consumes: Task 1 的 `is_chirp_conversation_member`；Task 0 审计答案（policy 撞名 / `type='couple'` 约束 / INSERT 校验强度 / group 重复行）。
- Produces: B（authenticated anon client）能 select 自己是成员的 conversation/messages/planet，能向成员会话 insert 自己的消息。"一 planet 一群"改为 planet 维度约束。

- [ ] **Step 1: 写 migration 文件**

```sql
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

-- 2) type='couple'（> AUDIT: 若 chirp_planets.type 有 check 约束，在此放开；无则删除本段注释）
-- alter table public.chirp_planets drop constraint <约束名>;
-- alter table public.chirp_planets add constraint <约束名>
--   check (type in (<原值们>, 'couple'));

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

-- > AUDIT: 若审计确认用户消息 sender_id = auth.uid() 文本，保留 sender_id 强校验；
-- > 否则去掉 sender_id 一行（membership + sender_type 仍然兜底）。
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
```

- [ ] **Step 2: 无 BOM 检查（同 Task 1 Step 2）**

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607130002_chirp_membership_rls.sql
git commit -m "feat(chirp): membership RLS + 一planet一群唯一键改造 (migration)"
```

---

### Task 3: `inviteStore` 模块（TDD）

**Files:**
- Create: `backend/lib/couple/inviteStore.js`
- Test: `backend/tests/inviteStore.test.js`

**Interfaces:**
- Consumes: 注入的 supabase client（生产用 `supabaseAdmin`，测试用假 client）。
- Produces（Task 4 路由依赖，签名精确如下）:
  - `generateInviteCode()` → 10 位大写字母+数字（去掉易混 `0O1IL`）的字符串。
  - `createInvite({ db, planetId, inviterId, ttlDays = 7 })` → `{ code, planetId, expiresAt, reused }`；该 planet 已有 pending 邀请时返回已有那张（`reused: true`），幂等。
  - `getInviteByCode({ db, code })` → `{ code, status, planetId, inviterId, expiresAt } | null`。
  - `redeemInvite({ db, code, userId })` → `{ planetId, conversationId, alreadyRedeemed }`；失败 throw `InviteError`，`error.code ∈ {INVITE_NOT_FOUND, INVITE_EXPIRED, INVITE_REVOKED, INVITE_ALREADY_REDEEMED, INVITE_SELF_REDEEM}`。
  - `class InviteError extends Error { constructor(code, message) }`。

- [ ] **Step 1: 写失败测试**

```js
// backend/tests/inviteStore.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateInviteCode, createInvite, getInviteByCode, redeemInvite, InviteError
} from '../lib/couple/inviteStore.js'

const CODE_ALPHABET = /^[A-HJ-NP-Z2-9]{10}$/

test('generateInviteCode: 10位、无易混字符、可多次生成不同值', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const code = generateInviteCode()
    assert.match(code, CODE_ALPHABET)
    seen.add(code)
  }
  assert.ok(seen.size > 190)
})

// 最小假 client：只实现被 store 用到的链式方法
function fakeDb({ pendingInvite = null, insertResult = null, rpcResult = null, rpcError = null } = {}) {
  const calls = { inserts: [], rpcs: [] }
  return {
    calls,
    from(table) {
      return {
        select() { return this },
        eq() { return this },
        maybeSingle: async () => ({ data: pendingInvite, error: null }),
        insert(payload) {
          calls.inserts.push({ table, payload })
          return {
            select() { return this },
            single: async () => ({ data: insertResult ?? { ...payload, id: 'inv-1' }, error: null })
          }
        }
      }
    },
    rpc: async (fn, args) => {
      calls.rpcs.push({ fn, args })
      if (rpcError) return { data: null, error: rpcError }
      return { data: rpcResult, error: null }
    }
  }
}

test('createInvite: 已有 pending 时复用（幂等）', async () => {
  const db = fakeDb({ pendingInvite: { code: 'ABCDEFGH23', planet_id: 'p1', expires_at: '2099-01-01T00:00:00Z', status: 'pending' } })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a' })
  assert.equal(result.code, 'ABCDEFGH23')
  assert.equal(result.reused, true)
  assert.equal(db.calls.inserts.length, 0)
})

test('createInvite: 无 pending 时新建并带过期时间', async () => {
  const db = fakeDb({ pendingInvite: null })
  const result = await createInvite({ db, planetId: 'p1', inviterId: 'u-a', ttlDays: 7 })
  assert.match(result.code, CODE_ALPHABET)
  assert.equal(result.reused, false)
  assert.equal(db.calls.inserts.length, 1)
  const payload = db.calls.inserts[0].payload
  assert.equal(payload.planet_id, 'p1')
  assert.equal(payload.inviter_id, 'u-a')
  assert.equal(payload.status, 'pending')
  assert.ok(new Date(payload.expires_at) > new Date())
})

test('redeemInvite: RPC 成功返回归属', async () => {
  const db = fakeDb({ rpcResult: { planet_id: 'p1', conversation_id: 'c1', already_redeemed: false } })
  const result = await redeemInvite({ db, code: 'ABCDEFGH23', userId: 'u-b' })
  assert.deepEqual(result, { planetId: 'p1', conversationId: 'c1', alreadyRedeemed: false })
  assert.deepEqual(db.calls.rpcs[0], { fn: 'redeem_chirp_invite', args: { p_code: 'ABCDEFGH23', p_user: 'u-b' } })
})

test('redeemInvite: RPC 异常映射为 InviteError', async () => {
  const db = fakeDb({ rpcError: { message: 'INVITE_EXPIRED' } })
  await assert.rejects(
    () => redeemInvite({ db, code: 'X', userId: 'u-b' }),
    (err) => err instanceof InviteError && err.code === 'INVITE_EXPIRED'
  )
})

test('redeemInvite: 未知 RPC 错误归为 INVITE_NOT_FOUND 之外的透传', async () => {
  const db = fakeDb({ rpcError: { message: 'connection reset' } })
  await assert.rejects(
    () => redeemInvite({ db, code: 'X', userId: 'u-b' }),
    (err) => err instanceof InviteError && err.code === 'INVITE_REDEEM_FAILED'
  )
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
cd backend; npm test -- --test-name-pattern="Invite" 2>&1 | Select-Object -Last 10
```
Expected: FAIL（模块不存在）。若 npm test 不支持 pattern 参数，直接 `node --test tests/inviteStore.test.js`。

- [ ] **Step 3: 实现 `backend/lib/couple/inviteStore.js`**

```js
// backend/lib/couple/inviteStore.js
// couple 邀请钥匙：生成/查询走注入的 db（生产=supabaseAdmin），redeem 走 SQL RPC 保原子。
import crypto from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 去易混 0O1IL
const CODE_LENGTH = 10
const KNOWN_REDEEM_ERRORS = new Set([
  'INVITE_NOT_FOUND', 'INVITE_EXPIRED', 'INVITE_REVOKED',
  'INVITE_ALREADY_REDEEMED', 'INVITE_SELF_REDEEM'
])

export class InviteError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

export function generateInviteCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

/** 该 planet 已有 pending 邀请则复用（幂等）；否则新建。 */
export async function createInvite({ db, planetId, inviterId, ttlDays = 7 }) {
  const { data: existing, error: findError } = await db
    .from('chirp_invites')
    .select('code, planet_id, expires_at, status')
    .eq('planet_id', planetId)
    .eq('status', 'pending')
    .maybeSingle()
  if (findError) throw new InviteError('INVITE_CREATE_FAILED', findError.message)
  if (existing) {
    return { code: existing.code, planetId: existing.planet_id, expiresAt: existing.expires_at, reused: true }
  }

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
  const payload = {
    code: generateInviteCode(),
    planet_id: planetId,
    inviter_id: inviterId,
    status: 'pending',
    expires_at: expiresAt
  }
  const { data, error } = await db.from('chirp_invites').insert(payload).select().single()
  if (error) throw new InviteError('INVITE_CREATE_FAILED', error.message)
  return { code: data.code, planetId: data.planet_id, expiresAt: data.expires_at, reused: false }
}

export async function getInviteByCode({ db, code }) {
  const { data, error } = await db
    .from('chirp_invites')
    .select('code, status, planet_id, inviter_id, expires_at')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new InviteError('INVITE_LOOKUP_FAILED', error.message)
  if (!data) return null
  return {
    code: data.code, status: data.status, planetId: data.planet_id,
    inviterId: data.inviter_id, expiresAt: data.expires_at
  }
}

export async function redeemInvite({ db, code, userId }) {
  const { data, error } = await db.rpc('redeem_chirp_invite', { p_code: code, p_user: userId })
  if (error) {
    const known = [...KNOWN_REDEEM_ERRORS].find(c => (error.message || '').includes(c))
    throw new InviteError(known || 'INVITE_REDEEM_FAILED', error.message)
  }
  return {
    planetId: data.planet_id,
    conversationId: data.conversation_id,
    alreadyRedeemed: Boolean(data.already_redeemed)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```powershell
cd backend; node --test tests/inviteStore.test.js 2>&1 | Select-Object -Last 5
```
Expected: 全 PASS。再跑全量 `npm test` 确认无回归。

- [ ] **Step 5: Commit**

```bash
git add backend/lib/couple/inviteStore.js backend/tests/inviteStore.test.js
git commit -m "feat(chirp): inviteStore 模块 (创建/查询/redeem, TDD)"
```

---

### Task 4: 邀请路由 + couple planet ensure + prepareTurn membership 适配

**Files:**
- Modify: `backend/routes/chirp.js`（新增 3 个路由；`ensureConversation` group 分支与 `prepareTurn` 会话定位改造；couple 群跳过 agent 激活）

**Interfaces:**
- Consumes: Task 3 的 `createInvite/getInviteByCode/redeemInvite/InviteError`；现有 `ensurePlanet(ownerId, type)`（`chirp.js:43-65`）、`authenticateUser`、`supabaseAdmin`。
- Produces（验收脚本与前端后续依赖）:
  - `POST /api/chirp/couple/invite` → `{ code, expiresAt, planetId, reused }`（自动 ensure 请求者的 couple planet）
  - `GET /api/chirp/couple/invite/:code` → `{ status, planetId, inviterId, expiresAt }` 或 404 envelope
  - `POST /api/chirp/couple/invite/:code/redeem` → `{ planetId, conversationId, alreadyRedeemed }`
  - `prepareTurn`：请求带 `conversationId` 时按"owner 或成员"授权；couple 群 turn 不触发任何 agent，仅落消息。

- [ ] **Step 1: 重读将修改的段落**

读 `backend/routes/chirp.js` 的 `ensurePlanet`(43-65)、`ensureConversation`(84-124)、`prepareTurn`(345-443)、两个 turn handler(571-, 673-)。确认 `prepareTurn` 里 conversationId 的来源与 owner 假设的具体行。

- [ ] **Step 2: 新增邀请路由**（文件顶部 import store；路由加在 `/chirp/conversations/ensure` 附近）

```js
import { createInvite, getInviteByCode, redeemInvite, InviteError } from '../lib/couple/inviteStore.js'

const inviteErrorStatus = {
  INVITE_NOT_FOUND: 404, INVITE_EXPIRED: 410, INVITE_REVOKED: 410,
  INVITE_ALREADY_REDEEMED: 409, INVITE_SELF_REDEEM: 400
}

router.post('/chirp/couple/invite', authenticateUser, async (req, res) => {
  try {
    const planet = await ensurePlanet(req.user.id, 'couple')
    const invite = await createInvite({ db: supabaseAdmin, planetId: planet.id, inviterId: req.user.id })
    res.json(invite)
  } catch (err) {
    const code = err instanceof InviteError ? err.code : 'INVITE_CREATE_FAILED'
    res.status(500).json({ error: { code, message: err.message } })
  }
})

router.get('/chirp/couple/invite/:code', authenticateUser, async (req, res) => {
  try {
    const invite = await getInviteByCode({ db: supabaseAdmin, code: req.params.code })
    if (!invite) return res.status(404).json({ error: { code: 'INVITE_NOT_FOUND', message: 'invite not found' } })
    res.json(invite)
  } catch (err) {
    res.status(500).json({ error: { code: 'INVITE_LOOKUP_FAILED', message: err.message } })
  }
})

router.post('/chirp/couple/invite/:code/redeem', authenticateUser, async (req, res) => {
  try {
    const result = await redeemInvite({ db: supabaseAdmin, code: req.params.code, userId: req.user.id })
    res.json(result)
  } catch (err) {
    if (err instanceof InviteError) {
      const status = inviteErrorStatus[err.code] || 500
      return res.status(status).json({ error: { code: err.code, message: err.message } })
    }
    res.status(500).json({ error: { code: 'INVITE_REDEEM_FAILED', message: err.message } })
  }
})
```

注意：`ensurePlanet(req.user.id, 'couple')` 依赖现有函数签名（Step 1 确认实际参数形态，若还接收 title/config 参数则补默认值；couple planet 默认 title 用 `'us'`，后续产品定稿再改）。

- [ ] **Step 3: `ensureConversation` group 分支按 planet 定位 + 访问检查函数**

`findExisting`（chirp.js:84-97）中 `type === 'group'` 的查询把 `.eq('owner_id', ownerId)` 改为 `.eq('planet_id', planetId)`（planet 维度唯一，配合 Task 2 的新唯一键）；非 group 类型保持 owner 查询不变。并新增：

```js
/** 会话访问检查：owner 或 user 成员。返回 conversation 行，否则 null。 */
async function loadConversationForUser(conversationId, userId) {
  const { data: conversation, error } = await supabaseAdmin
    .from('chirp_conversations')
    .select('id, owner_id, planet_id, type, title, metadata')
    .eq('id', conversationId)
    .maybeSingle()
  if (error || !conversation) return null
  if (conversation.owner_id === userId) return conversation
  const { data: member } = await supabaseAdmin
    .from('chirp_conversation_members')
    .select('member_id')
    .eq('conversation_id', conversationId)
    .eq('member_type', 'user')
    .eq('member_id', userId)
    .maybeSingle()
  return member ? conversation : null
}
```

`prepareTurn`：请求带 `conversationId` 时改走 `loadConversationForUser(conversationId, req.user.id)`，取不到返回 403 envelope `{ error: { code: 'CONVERSATION_FORBIDDEN', ... } }`；后续 planet 信息从 conversation.planet_id 反查而不是从 owner ensure（B 不是 planet owner，不能触发 ensurePlanet 的 insert 分支）。

- [ ] **Step 4: couple 群不激活 agent**

在两个 turn handler 中，`prepareTurn` 之后、激活/路由逻辑之前，取 planet 类型（`prepareTurn` 返回值里已有 planet 或补查一次），加：

```js
if (planet?.type === 'couple') {
  // MVP 本切片：couple 群只落消息，Bird 群聊模式在下一切片接入
  return res.json({ message: savedMessage, runs: [] })   // stream 端点：直接 end SSE
}
```

stream 端点用与现有"无 agent 响应"一致的收尾方式（Step 1 时确认现有空响应的 SSE 收尾写法并复用）。

- [ ] **Step 5: 全量测试 + 手工冒烟**

```powershell
cd backend; npm test 2>&1 | Select-Object -Last 5
```
Expected: 全 PASS（既有 22+ 条 + inviteStore 6 条）。

- [ ] **Step 6: Commit**

```bash
git add backend/routes/chirp.js
git commit -m "feat(chirp): 邀请路由 + conversationId membership 授权 + couple群不激活agent"
```

---

### Task 5: db push + 端到端验收脚本

**Files:**
- Create: `backend/scripts/verifyCoupleInvite.mjs`（真实两账号端到端验证，手动运行，不进 npm test）

**Interfaces:**
- Consumes: Task 1/2 migration 已 push；Task 4 路由已起（`node backend/server.js`）；两个测试账号凭据经环境变量传入。

- [ ] **Step 1: push migrations**

```powershell
npx supabase db push
```
（走 pooler；失败时按 Global Constraints 的连接参数排查。）Expected: 两个 migration applied。

- [ ] **Step 2: 写验收脚本**

```js
// backend/scripts/verifyCoupleInvite.mjs
// 用法: node scripts/verifyCoupleInvite.mjs
// 环境变量: SUPABASE_URL SUPABASE_ANON_KEY API_BASE(默认 http://localhost:3001/api)
//           TEST_A_EMAIL TEST_A_PASSWORD TEST_B_EMAIL TEST_B_PASSWORD [TEST_C_EMAIL TEST_C_PASSWORD]
import { createClient } from '@supabase/supabase-js'

const API = process.env.API_BASE || 'http://localhost:3001/api'
const url = process.env.SUPABASE_URL
const anon = process.env.SUPABASE_ANON_KEY

async function login(email, password) {
  const client = createClient(url, anon)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login ${email}: ${error.message}`)
  return { client, token: data.session.access_token, userId: data.user.id }
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

function assert(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ← ' + JSON.stringify(detail)}`)
  if (!cond) process.exitCode = 1
}

const A = await login(process.env.TEST_A_EMAIL, process.env.TEST_A_PASSWORD)
const B = await login(process.env.TEST_B_EMAIL, process.env.TEST_B_PASSWORD)

// 1. A 创建邀请（重复创建应复用）
const inv1 = await api(A.token, 'POST', '/chirp/couple/invite')
assert('A 创建邀请', inv1.status === 200 && inv1.json.code, inv1)
const inv2 = await api(A.token, 'POST', '/chirp/couple/invite')
assert('重复创建复用 pending', inv2.json.code === inv1.json.code && inv2.json.reused === true, inv2)

// 2. B peek + redeem（重复 redeem 幂等）
const peek = await api(B.token, 'GET', `/chirp/couple/invite/${inv1.json.code}`)
assert('B peek 邀请', peek.status === 200 && peek.json.status === 'pending', peek)
const redeem1 = await api(B.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
assert('B redeem 成功', redeem1.status === 200 && redeem1.json.conversationId, redeem1)
const redeem2 = await api(B.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
assert('重复 redeem 幂等', redeem2.status === 200 && redeem2.json.alreadyRedeemed === true, redeem2)
const conversationId = redeem1.json.conversationId

// 3. A 自 redeem 自己的邀请应被拒（新邀请验证 SELF_REDEEM 分支需要新码，此处验证已 redeemed 分支）
const selfRedeem = await api(A.token, 'POST', `/chirp/couple/invite/${inv1.json.code}/redeem`)
assert('A redeem 已用邀请被拒', selfRedeem.status === 409 || selfRedeem.status === 400, selfRedeem)

// 4. B 通过 turn 端点向群发消息（couple 群应只落消息不触发 agent）
const turn = await api(B.token, 'POST', '/chirp/turn', {
  conversationId,
  text: `hello from B ${Date.now()}`
})
assert('B turn 发消息', turn.status === 200, turn)
assert('couple 群无 agent 响应', Array.isArray(turn.json.runs) && turn.json.runs.length === 0, turn)

// 5. RLS：A、B 都能通过 anon client 读到群消息；C 不能
const readAs = async (who) => who.client
  .from('chirp_messages').select('id, sender_id, content')
  .eq('conversation_id', conversationId).limit(50)
const aRead = await readAs(A)
assert('A 可读群消息(RLS)', !aRead.error && aRead.data.length > 0, aRead.error)
const bRead = await readAs(B)
assert('B 可读群消息(RLS)', !bRead.error && bRead.data.length > 0, bRead.error)

if (process.env.TEST_C_EMAIL) {
  const C = await login(process.env.TEST_C_EMAIL, process.env.TEST_C_PASSWORD)
  const cRead = await readAs(C)
  assert('C 读不到群消息(RLS负例)', !cRead.error && cRead.data.length === 0, cRead)
}

console.log('done.')
```

注意：`/chirp/turn` 的请求体字段名以 Task 4 Step 1 读到的实际 handler 为准（若是 `message`/`planetId` 等结构则相应调整脚本）。

- [ ] **Step 3: 起后端并运行验收**

```powershell
cd backend; node server.js   # 另一窗口
cd backend; node scripts/verifyCoupleInvite.mjs
```
Expected: 全部 PASS。B 的测试账号如无现成的，用 A 的注册流程再开一个（或 supabase dashboard 手动建）。

- [ ] **Step 4: Commit + 收尾**

```bash
git add backend/scripts/verifyCoupleInvite.mjs
git commit -m "feat(chirp): couple 邀请端到端验收脚本"
```
更新 spec `2026-07-12-couples-mvp-v2-design.md` §6 切片1 的后端部分标注"后端已完成（commit hash）"，一并提交。

---

## 明确不在本计划内（防蔓延）

前端邀请 UI 与 redeem 落地页、Supabase Realtime 订阅（前端目前完全没有 Realtime 用法，属前端切片）、Bird 群聊模式（@bird / 四入口 / 直接说 prompt）、军师 DM 换皮、`chirp_planet_members` 悬空引用的清理（审计后单独决定）、memoryScope/distiller 的 owner 假设改造（Bird 群聊模式切片一起做，那时才有 agent 读群的需求）。
