# 切片1（couple 邀请 + membership RLS）后端运行手册

- 日期：2026-07-13 ｜ 关联：Task 0-4（`.superpowers/sdd/task-0..4-report.md`）、`docs/superpowers/research/2026-07-13-live-schema-audit.md`
- 本机现状：**没有数据库密码**，所以 Task 5 没有跑 `supabase db push`、没有实际起后端、没有实际跑验收脚本。以下是 Rae 回来后按顺序执行的清单。

## 为什么 push 被推迟

`npx supabase db push` 走的是 Postgres 直连（session/transaction pooler），需要数据库密码（不是 `SUPABASE_SERVICE_KEY`，那是 PostgREST/Auth 的 API key，两码事）。本机只有 `backend/.env` 里的 service role key，没有 DB 密码，`psql`/`supabase db push`/`supabase db dump` 都会卡在密码提示上——Task 0 审计时已经确认过这条路走不通，改用 service role 经 PostgREST 做只读探测（见审计文档）。Task 5 延续同一约束：只产出脚本和手册，不执行任何需要 DB 密码的命令。

## 待执行清单

### a) push 三个 migration

```powershell
npx supabase db push
```

完整 pooler 连接参数（host `aws-1-ap-southeast-1.pooler.supabase.com:5432`、user `postgres.ptmjnccknvuqekaywvib`、psql fallback 命令）见 `docs/superpowers/plans/2026-07-13-couple-invite-rls-backend.md` 的 Global Constraints 一节。

会应用：

- `202607130001_chirp_invites.sql`（`chirp_invites` 表 + `redeem_chirp_invite` RPC）
- `202607130002_chirp_membership_rls.sql`（owner-only → owner OR member 的 RLS 扩展；**开头有前置断言**：如果线上已经存在同一 `planet_id` 下多条 `type='group'` 的会话，这个断言会 `raise exception 'DUPLICATE_GROUP_CONVERSATIONS_FOR_PLANET %'` 并中止整个 migration）
- `202607130003_chirp_couple_planet_uniq.sql`（每 owner 最多一个 `type='couple'` 的 planet；**开头也有前置断言**：如果某个 owner 已经有多个 couple planet，会 `raise exception 'DUPLICATE_COUPLE_PLANETS_FOR_OWNER %'` 并中止）

**密码含 `@` 时要 URL 编码**（例如 `p@ss` 写成连接串要变成 `p%40ss`），否则连接串会在 `@` 处被错误切分导致连不上。

**这两个前置断言的报错是安全失败，不是 bug**：说明线上数据当前不满足即将建立的唯一约束，migration 主动挡住了自己而不是静默建出一个约束不了的索引。Task 0 审计时用 service role 抽样过（结论见审计文档"问题 6"），当时样本里没有违规，但那是免密探测、非全量强保证。如果 push 时真的触发了这两个断言之一：

1. 把完整报错文本（含 `%` 后面打印出来的 `planet_id` / `owner_id`）发给 Claude。
2. 不要自己手动删数据或改 migration 里的断言逻辑——先让 Claude 看到具体是哪一行数据冲突，判断是脏数据要清理，还是这两条 migration 的前提假设本身有问题。

### b) 补跑审计遗留的 `pg_policies` 查询

`db push` 成功后，数据库密码就在手上了，顺手把 Task 0 审计里因为没密码而搁置的两条 SQL 跑掉（`docs/superpowers/research/2026-07-13-live-schema-audit.md` 文末 "PENDING 汇总" 一节，SQL 原文在那）：

```sql
-- chirp_messages 全部 policy
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_messages'
order by policyname;

-- chirp_planets 全部 policy
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where tablename = 'chirp_planets'
order by policyname;

-- chirp_planets.type 的 check 约束原文（如果存在的话）
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.chirp_planets'::regclass;
```

把三条查询的结果贴回 `2026-07-13-live-schema-audit.md`，替换掉"PENDING —— 需要 DB 密码"那几段占位文字（问题 3、问题 4 两节 + 文末 PENDING 汇总）。这一步纯粹是把审计文档补完整，不影响验收脚本能否跑通。

### c) 起后端

```powershell
cd backend
node server.js
```

默认监听 `backend/.env` 的 `PORT`（当前是 `8080`）。留这个窗口开着，另开一个窗口做下一步。

### d) 跑验收脚本

```powershell
cd backend
node scripts/verifyCoupleInvite.mjs
```

脚本会自动完成，不需要预先准备任何测试账号：

1. 用 `SUPABASE_SERVICE_KEY`（`backend/.env` 里已有）经 `supabase.auth.admin.createUser({ email, password, email_confirm: true })` 建 3 个一次性账号 A/B/C（邮箱形如 `couple-e2e-a-<timestamp>-<random>@test.local`，密码随机生成，`email_confirm: true` 跳过邮箱验证）。
2. A 建邀请（含重复创建复用 pending 的检查）、B peek + redeem（含重复 redeem 幂等检查）、A 对已兑现邀请再 redeem 应被拒。
3. B 经 `POST /chirp/turn` 往 couple 群发一条消息，断言响应里没有 agent 类型的消息（couple 群这个切片只落用户消息，不激活任何 persona/Bird —— 见 Task 4）。
4. 用 anon key 分别以 A/B/C 三个身份的会话去读 `chirp_messages`，验证 RLS：A（owner）和 B（member）都能读到，C 什么都读不到；并核实 B 发的消息 `sender_id` 是 B 的真实 uuid（couple 群的用户消息不再写死字面量 `'user'`）。
5. **`finally` 块里做 cleanup**（无论前面断言是否失败都会执行）：按创建顺序倒着删——`chirp_messages`（按本次的 `conversation_id` 过滤）→ `chirp_conversation_members`（同 `conversation_id`）→ `chirp_conversations`（该 id）→ `chirp_invites`（该 code）→ `chirp_planets`（该 id，即 A 的 couple planet），全部用 service role 直接 delete、按本次运行记录下来的 id/code 精确过滤，不做任何范围删除；再 `admin.deleteUser` 掉 A/B/C 三个账号。全程只碰这一次运行自己造出来的行，不会动线上其他真实数据。

想在失败时保留现场排查，加 `--keep` 跳过 cleanup：

```powershell
node scripts/verifyCoupleInvite.mjs --keep
```

（用了 `--keep` 之后，A/B/C 三个测试账号和这条 couple 群的数据都会留在库里，之后要手动清或者重跑一次不带 `--keep` 的——但注意不带 `--keep` 的重跑只会清它自己这次跑出来的 id，不会去找上一次 `--keep` 留下的旧数据，那些需要手动删。）

脚本全部 `PASS`（终端最后一行打印 `done.`）即代表切片1后端验收通过。任何一行 `FAIL` 都会把该行的 `status`/`json` 一并打印出来，把完整输出发给 Claude 定位。

## 环境变量来源（脚本怎么读的，供排查用）

- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`：脚本用 `dotenv/config`（等价于 `backend/lib/supabaseAdmin.js` 的读法），从当前工作目录的 `.env` 读——所以必须 `cd backend` 再跑脚本，否则读不到。
- `SUPABASE_ANON_KEY`（anon key，用来模拟真实登录用户过 RLS）：`backend/.env` 里故意不放这个（那份文件的注释写着"千万不要用 anon key"），脚本改为直接读仓库根目录 `.env` 里前端用的 `VITE_SUPABASE_ANON_KEY`。想覆盖就设置环境变量 `SUPABASE_ANON_KEY`。
- `API_BASE`：默认 `http://localhost:<backend/.env 的 PORT，缺省 8080>/api`，可用环境变量 `API_BASE` 覆盖（比如后端跑在别的端口/远程环境时）。

## 关联文件

- 脚本：`backend/scripts/verifyCoupleInvite.mjs`
- 迁移：`supabase/migrations/202607130001_chirp_invites.sql`、`202607130002_chirp_membership_rls.sql`、`202607130003_chirp_couple_planet_uniq.sql`
- 路由：`backend/routes/chirp.js`（`POST/GET /chirp/couple/invite*`、`POST /chirp/turn`）
- 审计底稿：`docs/superpowers/research/2026-07-13-live-schema-audit.md`
