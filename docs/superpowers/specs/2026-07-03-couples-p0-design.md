# Chirp 新方向 P0 设计：三方群聊 + Bird DM + 内容隔离

日期：2026-07-03
状态：已与 Rae 对齐（假设 1-6 全部确认）
来源：飞书 wiki「New version」章节（doc KCNjdo5IsoP41GxgcTpcHqmFn0c）

## 1. 背景与目标

Chirp 产品方向调整：从「单人暧昧期 + 多 persona 星球群聊」转向**情侣关系 AI**。Bird 作为关系中的中立第三方（AI 调解员），核心场景是真人 A + Bird + 真人 B 的三方群聊，辅以各自与 Bird 的私聊（DM）。

本 P0 只做骨干：**三方群聊 + Bird DM + 内容隔离**。在现有代码上改造（方案 A），不清零重做。

**成功标准**：
- A 能生成邀请「钥匙」，B 凭钥匙注册并加入同一个情侣空间的群聊。
- 群里 A、B 互发消息实时可见；@bird 必回；无 @ 时 Bird 自判是否插话。
- A、B 各自有独立的 Bird DM；Bird 在群里绝不引用任何一方 DM 内容。
- B 未加入时，A + Bird 的"单人期"群聊照常可用。

## 2. 已确认的决策（2026-07-03 Rae 确认）

1. **P0 范围 = 完整三方**：含邀请钥匙 + 多用户权限（RLS）改造，不做单人过渡形态。
2. **群里只有 Bird 一个 AI**：多 persona turn-taking 链（turnTargeting / turnPlanner / participation 两道闸）在情侣群不使用；Bird 从 DM-only 回归群聊，立场为中立调解员。
3. **内容隔离为单向**：DM → 群 严格禁止（Bird 群聊发言不得引用任何一方 DM；A 的 DM 对 B 完全不可见）；群 → DM 允许（Bird 在 A 的 DM 里知道群聊内容，才能聊策略）。
4. **旧功能隐藏不删**：planet 列表、persona 广场、persona DM、动物人格移除 UI 入口，代码与表保留（persona 社区 = 模块 4 后面做）。
5. **B 是完整用户**：凭邀请码注册/登录为正式账号，有自己的 Bird DM 和自己的画像，不是匿名访客。
6. **本 P0 不含**：日记本、月度信件、恋爱人格测试、quick question onboarding、语音输入、agent 进微信。

## 3. 架构总览

一对情侣 = 一个 planet（`type='couple'`）+ 一个 `group` conversation（沿用「一 planet 一群」唯一键）。复用现有消息流、SSE 流式、历史缓存、蒸馏画像、情绪感知链路；新增的是**多用户成员/权限**与**Bird 群聊模式**。

```
真人A ─┐                        ┌─ bird_dm(A)   ← 仅 A 与 Bird 可见
       ├─ couple planet ─ group │
真人B ─┘        │               └─ bird_dm(B)   ← 仅 B 与 Bird 可见
                └─ Bird（群成员，调解员）
读范围：Bird@群 = 仅群；Bird@A的DM = A的DM + 群；永远读不到另一人的DM
```

## 4. 数据层

### 4.1 新增 `chirp_invites`
字段：`id`、`code`（随机短码，唯一）、`planet_id`、`inviter_id`、`status`（`pending/redeemed/expired/revoked`）、`redeemed_by`、`expires_at`、`created_at`。
- 一个 planet 同时只允许一张有效钥匙（partial unique index on `planet_id where status='pending'`）。
- RLS：inviter 可管理自己的邀请；redeem 走后端 service role 完成（校验码 + 过期 + 状态），前端不直接写。

### 4.2 成员关系
- `chirp_conversation_members` 已支持 `member_type='user'`：B redeem 后为群 conversation 插入第二行 user 成员；planet 级成员沿用/补齐 `chirp_planet_members`（以实际表结构为准，实施前先核）。
- B redeem 时自动创建自己的 `bird_dm` conversation（现有唯一键 `(owner_id, type=bird_dm)` 天然 per-user，B 的 DM `owner_id = B`）。

### 4.3 RLS 从 owner-only 改为 membership-based ⚠️ 影响面最大
按「改动影响追踪纪律」，实施计划里必须先列全所有读写点再动手。方向：
- `chirp_conversations`：读 = owner **或** 群成员（经 `chirp_conversation_members` 关联 user id）。
- `chirp_messages`：读 = 所属 conversation 的成员；写（insert）= 成员本人发言。DM 类会话成员只有 owner 本人 → 天然隔离，B 查不到 A 的 DM。
- `chirp_planets`：读 = owner 或 planet 成员。
- 每-user 表（`chirp_persona_instances`、`chirp_emotion_state`、`chirp_profiles` 等）保持 owner-only 不动。
- 后端走 service role 不受 RLS 影响，但 `ensureConversation` 等"按 owner 查"的逻辑要适配"成员也能进入同一会话"。

### 4.4 消息归属
沿用现约定：群消息双写 `planet_id` + `conversation_id`；DM 消息 `planet_id=null`、严格按 `conversation_id`。`sender_id` 区分 A/B（原本群里只有一个真人，前端渲染按 `sender_id === 当前用户` 区分左右气泡）。

## 5. 后端

### 5.1 activationRouter：couple 群分支
- `@bird` / 引用 Bird → 硬目标，必回（恢复群内 Bird 唤起；旧「群里 @bird 无效」规则仅适用旧多 persona 群）。
- 无 @ → Bird 走**轻量参与自判**（单决策者版 participation：便宜模型判断"此刻调解员该不该说话"，A/B 互聊正常时倾向沉默）。
- 旧 turnTargeting / turnPlanner 多 persona 链在 couple 群不调用（代码保留）。

### 5.2 birdRuntime：新增群聊模式
- 调解员 system prompt：中立立场、帮双方把话说清楚、分析问题给建议、不站队。
- context 注入 A、B 各自画像（instance 记忆），并显式声明边界：「你在群聊中的发言不得引用/暗示任何一方与你的私聊内容」——prompt 约束 + 数据层兜底（5.3）双保险。
- DM 模式沿用现有 bird_dm 链路，context 可含群聊近况（群 → DM 方向放行）。

### 5.3 memoryScope：隔离的硬保证（数据层兜底）
现状 bird 无条件全知（`global_bird` 全部放行），收紧为**按 run 所在会话**给范围：
- Bird 在**群聊 run**：allowed = 该群 conversation（排除所有 DM）。
- Bird 在**A 的 DM run**：allowed = A 的 bird_dm + 群 conversation；**永远不含 B 的 DM**。
- persona 相关 scope 规则原样保留（旧功能还在）。

### 5.4 感知/情绪与蒸馏
- 现有链路按 user×conversation 维度成立，A、B 各自独立跑，基本不改；群聊里对"当前发言的真人"跑感知。
- 蒸馏画像 per user：要求 Bird 对 A、B 各自维护一份画像。载体待实施前核对——`chirp_persona_instances` 是 `(user_id, template_id)` 维度、面向 persona，Bird 当前是否有自己的画像行需先查 distiller/birdRuntime 现状，没有则补 Bird 专用载体（见 §10）。「关系层洞察」不在本 P0。

### 5.5 turn 接口
`POST /api/chirp/turn(/stream)` 复用；`prepareTurn` 里"按 owner ensure 会话"改为"按成员身份定位会话"（B 发消息时不能重复建群）。visibleRunLock 维持 per-conversation，防 A、B 同时触发 Bird 重复回复。

## 6. 前端

- **入口收敛**：首页 = 情侣群聊入口 + Bird DM + 邀请入口；planet 列表 / persona 广场 / persona DM 移除入口（路由代码保留）。
- **实时消息（最大新点）**：接入 Supabase Realtime，订阅群 conversation 的 `chirp_messages` INSERT——B 的消息实时推给 A（现在的消息全是"自己发 + AI 流式回"，没有第三方来源）。与现有历史缓存（LRU + 分页）合并去重（按消息 id）。
- **气泡渲染**：按 `sender_id === 当前用户` 分左右；对方真人有独立头像/名字；Bird 气泡沿用。
- **邀请流程 UI**：A 生成钥匙（短码/链接）→ 分享出去；B 打开链接 → 登录/注册 → redeem → 落进群聊。B 首次进入的引导（quick question）不在本 P0，先直接进群。

## 7. 错误处理

- 邀请码：过期 / 已使用 / 被撤销 → 明确报错文案；redeem 幂等（重复点击不重复入群）。
- 单人期：B 未加入时，群 = A + Bird 照常可用；B 加入后历史对 B 可见（成员可读整个会话历史）。
- Bird 群聊回复失败（模型超时/错误）：不阻塞 A/B 互聊，静默降级（本轮不说话），错误记日志；DeepSeek 参与闸失败 → 默认沉默（与现有"闸失败不回"一致）。
- Realtime 断连：重连后按最新消息 id 补拉增量（复用分页 loader）。

## 8. 测试

- 后端（`cd backend && npm test`，node --test，注入假 chat 不打真模型/DB）：
  - memoryScope：Bird@群 排除 DM；Bird@A-DM 不含 B-DM；persona 规则不回归。
  - activationRouter：couple 群 @bird 必回 / 无 @ 走自判 / 旧多 persona 分支不受影响。
  - 邀请 redeem：过期/重复/撤销/幂等。
- 前端：realtime 合并去重逻辑补一个 `node --test` 单测（仿 chirpHistoryCache.test.js 风格）。
- 手工验收：两个真实账号跑通邀请 → 三方群聊 → 各自 DM → 隔离验证（在 DM 说秘密，群里诱导 Bird 引用，确认不泄）。

## 9. 非目标（本 P0 明确不做）

日记本、规划本、月度总结信件、恋爱人格测试、About me 新版、quick question onboarding、语音输入、persona 社区/广场恢复、agent 进微信、关系层共同洞察、备忘录粒度权限（钥匙即全群权限，细粒度权限随日记本模块再做）。

## 10. 遗留与风险

- **RLS 改造回归风险**：旧单人功能（隐藏但保留）依赖 owner-only 假设，策略改宽后需确认旧路径不因策略变化而漏数据（membership 策略是"或"扩展，理论上只增不减，仍需过一遍读写点清单）。
- `chirp_planet_members` 实际表结构不在迁移里（早期 dashboard 建表），实施前先从线上 schema 导出确认。
- **Bird 画像载体待核**：Bird 对每个用户的蒸馏画像目前存在哪里（是否复用 instance 表）需实施前确认，缺则补专用载体（§5.4）。
- Bird 群聊的"何时说话"手感需真实使用调参（参与闸 prompt 属可调项，不属结构风险）。
