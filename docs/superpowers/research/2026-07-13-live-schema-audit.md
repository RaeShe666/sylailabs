# 线上 Supabase Schema 审计（Task 0）

- 日期：2026-07-13
- 范围：`.superpowers/sdd/task-0-brief.md` 六个问题
- 方法：本机无 DB 密码，`psql`/`supabase db dump` 会卡密码提示，**禁止使用**。改用 service role key 走 PostgREST（`backend/.env` 的 `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`），临时 node 脚本跑在 `backend/` 目录下（借用其 `node_modules`）后已删除，未提交仓库。
- 安全边界：全程未打印 service key / JWT；`chirp_planets` 探针 insert 后已立即 delete 并做了删除后校验（见问题 2）。

---

## 问题 1：`chirp_planet_members` 是否存在？结构？

**存在。** service role `select('*').limit(3)` 返回 3 行，无报错。

列（从样本行 + PostgREST OpenAPI `definitions.chirp_planet_members` 交叉确认一致）：

| 列 | 类型 | 备注 |
|---|---|---|
| id | uuid, pk, default `gen_random_uuid()` | required |
| planet_id | uuid, FK -> `chirp_planets.id` | required |
| persona_id | uuid, FK -> `chirp_personas.id` | 样本中全部为 `null`（实际用 `persona_key` 存值） |
| member_type | text, default `'persona'` | 样本全部是 `'persona'` |
| position | integer, default `0` | 排序用 |
| created_at | timestamptz, default `now()` | |
| persona_key | text | 实际承载 persona 标识（如 `'danzong'`/`'barry'`/`'duck'`） |

样本原始输出（截断到 3 行）：
```json
[
  {
    "id": "28d5d0a0-2528-4afe-8cae-58066131fade",
    "planet_id": "f7bd5e9b-79e8-473b-904d-3a1a04165eb4",
    "persona_id": null,
    "member_type": "persona",
    "position": 0,
    "created_at": "2026-06-15T08:08:35.865657+00:00",
    "persona_key": "danzong"
  },
  { "...": "同结构，persona_key='barry', position=1" },
  { "...": "同结构，persona_key='duck', position=2" }
]
```

OpenAPI `required`: `["id", "planet_id"]`（即 `member_type`/`position` 虽有 default 但非 NOT NULL 强制列，`persona_id`/`persona_key`/`created_at` 均可为空或有 default）。

前端 `src/pages/chirpSupabase.js:622-678`（`loadPlanetMemberPersonas`/`savePlanetMemberPersonas`）的读写字段（`planet_id`, `member_type`, `persona_key`, `persona_id`, `position`）与线上列完全对齐，无悬空引用。

**结论：表存在且结构与前端读写假设一致，Task 1/2/4 可以放心引用此表，无需新建或改名。**

---

## 问题 2：`chirp_planets` 全部列 + `type` 列 check 约束

**全部列**（样本行 + OpenAPI 交叉确认）：

| 列 | 类型 | 备注 |
|---|---|---|
| id | uuid, pk | required |
| owner_id | uuid | required |
| name | text | required |
| type | text, default `'custom'` | 现有值样本：`'love'`, `'work'` |
| tone | text | nullable |
| background | text, default `'#FAFAF7'` | |
| avatar_key | text | nullable |
| created_at | timestamptz, default `now()` | |
| updated_at | timestamptz, default `now()` | |

**`type` check 约束探针**（问题描述中的经验探测法）：

- 探针行：`{ owner_id: '53ab8b2f-7397-44b6-86bb-781bfffc22dd' (借用已有 planet 的 owner_id), type: 'couple', name: 'audit-probe-DELETE-ME' }`
- 结果：**INSERT 成功**，返回新行 `id=ff6baa62-8e64-4de1-9422-65ef46daed6a`。
- 清理：立即 `delete().eq('id', 'ff6baa62-8e64-4de1-9422-65ef46daed6a')`，随后 `select('id').eq('id', ...)` 校验，返回空数组 `[]`，**确认已删干净**。

原始输出：
```
Probe row to insert: {"owner_id":"53ab8b2f-7397-44b6-86bb-781bfffc22dd","type":"couple","name":"audit-probe-DELETE-ME"}
INSERT SUCCEEDED. Row: [{ "id": "ff6baa62-8e64-4de1-9422-65ef46daed6a", "owner_id": "53ab8b2f-7397-44b6-86bb-781bfffc22dd", "name": "audit-probe-DELETE-ME", "type": "couple", "tone": null, "background": "#FAFAF7", "avatar_key": null, "created_at": "2026-07-12T15:27:19.069795+00:00", "updated_at": "2026-07-12T15:27:19.069795+00:00" }]
Cleanup DELETE confirmed for probe row id= ff6baa62-8e64-4de1-9422-65ef46daed6a
Post-delete verification (should be empty array): []
```

**结论：线上 `chirp_planets.type` 要么没有 check 约束，要么已经允许 `'couple'` 值——两种情况下 `type='couple'` 都能直接写入，不需要在 Task 2 migration 里 alter/放开约束。**（等拿到 DB 密码后可用 `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.chirp_planets'::regclass;` 二次确认是否真的存在约束及其定义，见文末 PENDING。）

---

## 问题 3：`chirp_messages` 线上全部 policy

**PENDING —— 需要 DB 密码才能查 `pg_policies`，PostgREST 没有暴露这个系统表。**

待补 SQL（拿到密码后直接跑）：
```sql
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_messages'
order by policyname;
```

已确认的旁证：全部列清单（样本行 + OpenAPI `definitions.chirp_messages` 交叉确认）：

| 列 | 类型 |
|---|---|
| id | uuid pk |
| planet_id | uuid FK -> chirp_planets.id |
| sender_type | text |
| sender_id | text |
| text | text |
| tapbacks | jsonb |
| created_at | timestamptz |
| conversation_id | uuid FK -> chirp_conversations.id |
| run_id | uuid FK -> chirp_runs.id |
| reply_to_message_id | uuid FK -> chirp_messages.id |
| is_personal_record | boolean, default false |
| sender_role | text |
| metadata | jsonb |
| search_vector | tsvector |
| message_embedding | extensions.vector(1536) |
| reply_to | jsonb |

OpenAPI `required`: `["id", "sender_type", "is_personal_record", "metadata"]`（`sender_id`/`conversation_id`/`planet_id` 都不是 NOT NULL）。

---

## 问题 4：`chirp_planets` 线上全部 policy

**PENDING —— 同问题 3，需要 DB 密码。**

待补 SQL：
```sql
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_planets'
order by policyname;
```

（如果一并要确认 check 约束定义原文，附带跑：）
```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.chirp_planets'::regclass;
```

---

## 问题 5：用户消息 `sender_id` 取值形态

Service role 查询 `sender_type='user'` 的 20 条消息（跨 2 个 conversation）：

```json
[
  { "sender_type": "user", "sender_id": "user", "conversation_id": "29d88c3d-b91c-48f4-aeab-5acbe32f0277" },
  "... 共 14 条，同 conversation_id，sender_id 全部是字面量 \"user\" ...",
  { "sender_type": "user", "sender_id": "user", "conversation_id": "ac7286a1-06c8-49b3-948f-d1dfbd38cdbf" },
  "... 共 6 条，同上，sender_id 全部是字面量 \"user\" ..."
]
```

对比：取 `conversation_id=29d88c3d-...` 的 conversation 行，`owner_id = 53ab8b2f-7397-44b6-86bb-781bfffc22dd`（一个 uuid）。

```
Resolved ownerId: 53ab8b2f-7397-44b6-86bb-781bfffc22dd
sender_id from message: user
MATCH (sender_id === ownerId): false
```

**结论：`sender_id` 对用户消息不是 `auth.uid()` 的文本形式，而是固定字面量字符串 `"user"`。20/20 采样一致，无例外。**

---

## 问题 6：同一 `planet_id` 是否存在多条 `type='group'` 会话

全量拉取 `chirp_conversations`（`type='group'`），JS 按 `planet_id` 分组计数：

```
Total group conversations: 2
Planets with >1 group conversation count: 0
Full grouping (planet_id -> count): {
  "14ae7154-66d8-453e-a598-8eedb6edb3c0": 1,
  "f7bd5e9b-79e8-473b-904d-3a1a04165eb4": 1
}
```

**结论：线上数据里没有任何 planet 存在 >1 条 group 会话，当前数据对"每 planet 唯一 group conversation"的唯一约束改造没有阻塞。**（注：只有 2 条 group 会话，样本极小，属真实线上现状而非统计意义上的强保证；Task 2 加唯一约束前建议仍在 migration 里跑一次同款去重检查作为保险。）

---

## 结论（决策问题）

### (a) Task 2 migration 是否需要放开 `chirp_planets.type` 的 check 约束？

**不需要。** 问题 2 的探针直接证明：service role 用 `type='couple'` 插入 `chirp_planets` 一次性成功（随后已清理），说明线上要么根本没有对 `type` 设 check 约束，要么约束本身已经放行 `'couple'`。两种情况下 Task 2 都不必再写 `alter table ... drop constraint ...` / `add constraint ...`。

唯一遗留的不确定性：无法在没有 DB 密码的情况下区分"没有约束"和"约束已允许 couple"这两种情况，也无法看到约束的完整定义（比如是否还允许其他非预期值）。这不影响 Task 2 的可执行性，但建议拿到密码后跑一次 `pg_constraint` 查询存档（SQL 见问题 4 节）。

### (b) Task 2 的 messages INSERT policy 能否保留 `sender_id = auth.uid()::text` 强校验？

**不能。** 问题 5 实测：线上现有全部用户消息的 `sender_id` 都是字面量字符串 `"user"`，不等于对应 conversation/planet 的 `owner_id`（更不等于 `auth.uid()` 的 uuid 文本）。如果 Task 2 给 INSERT policy 加上 `sender_id = auth.uid()::text` 的强校验，会直接拒绝前端现有的写入方式（前端目前就是写死 `sender_id: 'user'`），造成线上功能中断。

Task 2 应采用**宽松版** policy：按 `sender_type='user'` + 对应 conversation/planet 的所有权关系（如 `conversation.owner_id = auth.uid()` 或 planet 的 owner 校验）来约束写入权限，不对 `sender_id` 字段本身做强绑定。若未来想收紧到 `sender_id = auth.uid()::text`，需要同时改前端写入逻辑（把 `sender_id` 从字面量 `'user'` 换成真实 `auth.uid()`），属于另一个改动面，不在本次 Task 2 范围内。

---

## PENDING 汇总（等 DB 密码后执行）

```sql
-- 问题 3：chirp_messages 全部 policy
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_messages'
order by policyname;

-- 问题 4：chirp_planets 全部 policy
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_planets'
order by policyname;

-- 问题 2 补充确认：chirp_planets.type 的 check 约束原文（若存在）
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.chirp_planets'::regclass;
```

## 附：探测方法与清理记录

- 临时脚本：`backend/audit-probe-tmp.mjs`（Q1/Q2/Q3/Q5/Q6，走 supabase-js service role）+ `backend/audit-openapi-tmp.mjs`（拉取 PostgREST OpenAPI `definitions`，交叉确认列清单）。两个脚本运行后已用 `rm` 删除，未提交仓库；输出的 `audit-openapi-full-tmp.json` 中间文件也已删除。
- `.superpowers/sdd/probe.mjs` 曾作为脚本存放位置（该目录有独立 `.gitignore` 排除全部内容），后续为保持目录整洁也已删除，不影响审计结论。
- `chirp_planets` 探针 insert 的清理已在问题 2 节内联展示（insert -> delete -> 删除后 select 验证为空）。除此之外，全程只做只读 `select`，未修改任何既有数据行。

---

## PENDING 补跑结果（2026-07-13，db push 后经 pooler 直查 pg_policies）

**问题 3（chirp_messages 线上 policy）已解决**，共 7 条，全部 PERMISSIVE：
- 仓库外旧策略 4 条（planet-ownership）：`Users can read/insert/update/delete messages of own planets`（qual/with_check 均为 `planet_id IN (select id from chirp_planets where owner_id = auth.uid())`）
- 202606150003 的 `Users can read messages of own conversations`（conversation owner SELECT）
- 202607130002 新增：`chirp_messages_member_select`、`chirp_messages_member_insert`（含 sender_id = auth.uid() 强校验）

**问题 4（chirp_planets 线上 policy）已解决**，共 2 条，全部 PERMISSIVE：
- 仓库外旧策略：`Users can manage own planets`（FOR ALL, owner）
- 202607130002 新增：`chirp_planets_member_select`

**结论**：无任何 RESTRICTIVE policy → "membership 策略是纯 OR 扩展、不会收紧旧路径"由推断升级为已验证事实。另：migration 历史对账发现 2026-06-14~16 的 6 个 migration 当时系手动应用未记历史，本次 push 已补录（幂等跳过），历史与文件从此一致。
