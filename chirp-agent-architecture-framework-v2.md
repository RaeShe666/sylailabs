# Chirp 多 Agent 架构框架 v2（以终为始）

> 目的：在动手抠细节之前，先把「要做什么、为什么、各部分怎么咬合」想清楚。
> 输入：chirp 现有设计（PRD、动物体系 v7、关系理论底座）+ 对三套开源/竞品 agent 框架的研究（Bloome、OpenClaw、Hermes-Agent）。详见同目录 `bloome-research-personas-and-groupchat.md`。
> 原则：本文是**思考脚手架**，不是实现规格。每个支柱给「要解决什么 / 参考范式 / 关键开放决策」，不写代码、不定 schema。
> 场景范围：**现阶段只聚焦亲密关系（恋爱 / 暧昧）**；家庭 / 职场为后期泛化，不在当前设计内。
> Persona 阵容：群里的 3 个 persona = **诞总（类李诞，重点先 build）、Barry（恋爱脑，占位）、duck（军师，占位）**。注意：PRD / 旧 chirp 代码里的 persona（达芬奇 / Luna / 苏格拉底 / 5 年后的你…）已**作废**，本文不再引用。
> v2 变化：persona / Bird 升级为「结构化人格文件」；①补 reply 触发与会话并发（含 @all 并行 fan-out + debounce）；③补「召回 3bis-R（常驻注入 + 最近窗口 + 模型自取 recall 工具，方案 B）+ 读写拆分」与写入纪律；明确选型纪律（现阶段不引入重型框架）。
> **v2.1 更新（2026-06-10）**：支柱②（persona）已由同目录《chirp-persona-技术路线-v2》细化并取代——persona 拆为 **template（公开人格资产）+ instance（每用户私有关系副本）+ 锁死的系统层**；记忆读写链路、recall 形态、知识库均以该文档为准，本文与其冲突处以 persona-v2 为准。开发优先级同步改为：**先把诞总这一个官方 persona 做到任何用户都能用且好用**（persona-v2 §0）；群聊与唤醒矩阵维持已建成形态、整体切到新底座，Barry/duck 落为官方占位 template、内容后续打磨。
> 日期：2026-05-30

---

## 0. 先定终点（North Star）

chirp 不是「陪聊 app」，也不是「人格测试」。一句话终点：

> **让用户在零散的倾诉与对话里，被一个始终在场、真正记得、有立场的智能体看见，从而看清完整的自己。**

它有两个可感知的「魔法时刻」，整套架构都服务于这两个：

1. **日常价值（高频）**：在群里 @ 某个 persona，得到一段「像那个人会说的、记得我、有观点」的对话。
2. **顿悟价值（低频但决定留存）**：bird 把跨时间、跨场景的零碎记录连成一条用户自己没意识到的线（"你这周第 3 次说'算了'，上次'算了'之后你失眠了"），并在对的时刻递出来。

**判断任何功能要不要做、做到什么程度，都回到这两个时刻。**

---

## 1. 倒推：要兑现终点，必须有哪几层能力

```
        顿悟价值（bird 的洞察）            日常价值（persona 群聊）
                │                                │
        ┌───────┴────────┐              ┌────────┴────────┐
        │  ④ 洞察/深度链接 │              │  ② 分身（人格）  │
        └───────┬────────┘              └────────┬────────┘
                │   都依赖 ↓                       │   都依赖 ↓
        ┌───────┴──────────────────────────────────┴────────┐
        │              ③ 记忆（懂用户的底座）                  │
        └───────────────────────┬───────────────────────────┘
                                │  谁在什么时候说话 ↓
        ┌───────────────────────┴───────────────────────────┐
        │            ① 编排层 / Gateway（控制平面）           │
        └───────────────────────┬───────────────────────────┘
                                │  全程的前提约束 ↕
        ┌───────────────────────┴───────────────────────────┐
        │          ⑤ 信任与安全（横切，覆盖所有层）            │
        └────────────────────────────────────────────────────┘
```

**你列的 3 件事（群聊协作 / 分身 build / 记忆）只覆盖了 ①②③。** 我建议补两根你提到过、但没单独立项的支柱：

- **④ 洞察 / 深度链接**：它不是「记忆」，记忆是存与取，洞察是**合成与主动递出**。这是 chirp 的终点引擎，必须单独成层，否则会被当成「记忆的副产品」而做不深。
- **⑤ 信任与安全**：chirp 处理的是恋爱/情绪等高敏数据，而且 bird **全知、却几乎不在群里主动出声**——这天然有「被监视」的观感。关系理论底座里已经写了明确的安全原则（不诊断、洞察可改可删、危机转向）。这层不立项，前面四层越强，反噬越大。

---

## 2. 整体技术架构（总览）

一句话：**chirp 是一个 Web 应用（React/Vite + Node + Supabase），后端自管一套「消息路由 → agent 运行 → 模型调用」的薄运行时；不引入 ACP / 重型 agent 框架。** 下一节的五大支柱是这张图的纵切面，这里先给横切的总览。

### 2.1 分层组件图

```
┌──────────────────────────────────────────────────────┐
│  客户端（React / Vite）                                  │
│  · 聊天：微信式会话列表 → bird-DM / planet 群 / persona-DM  │
│  · 非聊天：Home / About-me / planet 等                   │
└───────────────┬──────────────────────────────────────┘
                │  HTTP + SSE/WebSocket（流式）
┌───────────────┴──────────────────────────────────────┐
│  Node 后端（薄运行时）                                    │
│                                                        │
│  ① Activation Router（控制层）                            │
│     解析 @/reply → 定会话类型 & planet → 决定唤醒谁/无人      │
│        │  生成一次 run {run_id, conv, planet, agent, scope} │
│        ▼                                               │
│  ② Agent Runtime（Bird Runtime / Persona Runtime）        │
│     载档案 → 载允许记忆(scope) → 拼 prompt → 调模型 → 后处理 → 落库 │
│        │                                    ▲           │
│        ▼                                    │           │
│     ModelProvider（薄接口，默认 Claude）         │           │
│                                             │           │
│  ③ Memory：active-memory 召回 ───────────────┘           │
│            写入（pipeline 抽取 + scope 标记）              │
│  ④ Insight Engine（异步：pattern → 候选 → About-me）       │
│  ⑤ Trust/Privacy（横切：scope 过滤 + 不可覆盖的安全地基）     │
└───────────────┬──────────────────────────────────────┘
                │
        Supabase（Postgres + pgvector）   +   Anthropic API
```

### 2.2 主运行流（一条消息的一生）

```
用户发消息
 → Activation Router：判 @/reply、会话类型、planet → 决定唤醒 谁/无人
 → 无人 = 个人记录 → 只落库（bird 全量可见、在场 persona 按成员资格可见）
 → 有人 → 生成 run（带 memory_scope）
     → Agent Runtime：载 persona/bird 档案 → 常驻注入 + 最近窗口（按 scope）→ 模型可按需 recall（见 3bis-R）
       → 拼 prompt（安全地基在外、人设在内）→ 调 ModelProvider(Claude) 流式
       → 后处理 → 流式回前端 + 落 messages
 → 异步：记忆写入候选；Insight Engine 视情况合成洞察 → About-me
```

### 2.3 核心数据实体（高层，非 schema）

- `user` — 用户；其**用户画像**（动物人格 + 关系状态）全量广播给所有 persona。
- `planet` — 主题/角色**容器**（成员名册 + 记忆 scope + 洞察 scope）。
- `persona_template` / `persona_instance` — persona 拆为两层（v2.1，细节见 persona-v2 §2）：**template = 公开人格资产**（展示 catalog / 构建资产 / 常驻短卡 runtime_card，不含任何用户隐私），**instance = 每个用户的私有关系副本**（偏好 patch / 用户记忆 / 互动技能 / 情绪-关系态）。persona 在哪个 planet 由成员名册承载，不在 template 上存。
- `conversation` — 会话（`type`: group / persona-DM / bird-DM；带 `planet_id`，bird-DM 为 null = 全局）。
- `conversation_members` — 谁是哪个会话的成员（**成员资格 = 可见性判据**）。
- `messages` — **单一消息真相表**（所有会话的消息；带 `conversation_id` + 个人记录标记）。
- `insight` — bird 洞察（`content/planet_id/source_message_ids/confidence/status/visibility…`）。
- `interaction_event` — 每轮留痕（无 LLM 的轻量账本），给写入侧蒸馏当锚点（persona-v2 §2.3）。
- 派生记忆 — daily_notes / persona 关系笔记 / user_profile（加速理解，**不决定可见性**）。

### 2.4 贯穿全局的不变量（红线）

1. **可见性 = 单一 `messages` 表 + 成员资格/planet 过滤**算出，绝不物理分库复制。
2. **planet 是容器不是群**；`planet_id → group` 不写死一对一。
3. **bird 全知；persona 按「成员资格 + 所在 planet」分桶**；bird 私聊原文 persona 永不可见。
4. **洞察按 planet 隔离分发；用户画像全量广播**。
5. **安全地基是系统强制层，凌驾于用户 persona 内容**，不可覆盖。
6. **每轮回复 = 一次 chirp 自管 run**；现阶段不用 ACP（理由见支柱① / §7.5）。

### 2.5 技术栈映射

| 层 | 选型 |
|---|---|
| 客户端 | React + Vite（现有），微信式会话 UI |
| 流式 | SSE / WebSocket |
| 后端 | Node —— Router / Runtime / Memory / Insight 都是普通模块，非重型框架 |
| 存储 | Supabase（Postgres）；召回用 pgvector + 全文检索 |
| 模型 | Anthropic SDK，默认 Claude（经 ModelProvider 薄接口） |

---

## 3. 五大支柱（框架级）

### 支柱 ① 编排层 / Gateway —「谁在什么时候说话」

**要解决**：一条用户消息进来，决定（a）它是不是「个人记录」（无人回应）、（b）该唤醒哪个/哪些 persona、(c) bird 是否在背后消费它。这是 chirp 的控制平面，等价于 Bloome/OpenClaw 的 gateway。

**参考范式**：
- OpenClaw：Gateway 是 local-first 控制平面，管 sessions / channels / tools / events；多 agent 路由到「隔离的 workspace + per-agent session」。
- Bloome：`member.listenMode`（passive/active）+ 消息 `mentions` 数组驱动唤醒；`passive 且未被 @ → 不唤醒`；session key = `conversationId:thread:threadRootId`。

**Onboarding 后的初始会话拓扑（落地即生成）**：
onboarding 完成后，用户落地即拥有两个窗口（同构于 Bloome `create-team` → 落进 `group_conversation_id`）：
1. **与 bird 的 1:1 对话窗口**（`/chirp-chat`）。
2. **一个群聊窗口**：成员 = **你 + 3 个 persona**（诞总 / Barry / duck）。**Bird 不在群里（2026-06-15 改）**，只作为独立 DM 存在；群头像是成员合集(你 + personas)。
3. 之外，用户可与**任一 persona 单独私聊**（1:1）。

**「主题 / planet」是核心组织单位 —— 它是容器，不是会话**：一个 planet = 一个主题 = 用户的一个**身份/角色面**（恋人、职场人、妈妈、女儿、内心的小孩…）。**用户每创建一个 planet 就是新增一个主题**（有意留的结构口子 + UI）。`主题/planet` 是**成员名册 + 记忆 scope + 洞察分发**的 scope 单位（见 §3bis）。现阶段只有「亲密关系（恋爱/暧昧）」一个 planet；其余主题后期由用户自己长出来。

**planet ≠ group（关键：别把 planet 写死成"一个群"）**：分三层——
- `planet` = 主题/角色的**容器**（有成员名册、记忆 scope、洞察 scope）。
- `conversation` = **交互界面**（一条会话线）。
- `group_conversation` = planet 下的**一种** conversation。

**数据模型不要写死 `planet_id → group_id` 一对一**：一个 planet 下应允许**多个 conversation**（一个 group + 该 planet 内 persona 的各个私聊；未来还可能有子话题群等）。M1 可以"一个 planet 默认配一个 group"，但表结构要留多对一的余地。

会话归属：
- `group_conversation`、`persona-DM` 都挂在某个 `planet` 下（带 `planet_id`）——persona 属于 planet，它的群和私聊都在该 planet 的 scope 内。
- `bird-DM` 是**全局**会话（`planet_id = null`），因为 bird 跨所有 planet。

所以**会话类型**有：`group_conversation`（planet 下）、`persona-DM`（planet 下）、`bird-DM`（全局）。三者都进同一张 `messages` 表，靠 `conversation_id` + `conversation_members`（+ 会话自带的 `planet_id`）区分（见 §3bis 单表+成员过滤）。私聊任一 agent（bird/persona）**不需要打 @**，本来就是定向对话。

**聊天层的呈现形态（仅指聊天部分，非 chirp 整体 IA）**：这几个会话在聊天层像微信一样是**各自独立的会话线**——bird 单聊、planet 群聊各一条；**persona 单聊按需创建**（用户第一次私聊某 persona 才新增该会话）。chirp 的 Home / About-me / planet 等非聊天部分是另一套，不在此列。

**什么算「个人记录」**：它是一个**语义分类**（用户的"自我表达池"，bird 拿来做自我发现/洞察的原料），**不是一种特殊 UI、也不等于"没人回"**。判定：

| 来源 | 是否个人记录 | 实时回应 | 记忆可见范围 |
|---|---|---|---|
| 群里**不 @ 任何 AI** 的发言 | ✅ 是 | 感知漏斗：先跑共享情绪感知，每个 persona 各自过义务闸/动机闸决定回不回（✅ 2026-06-14，详见 persona-v2 §5.3） | bird（全知）+ 在场 persona（按成员资格） |
| 群里 @persona / @all / @bird | ❌ 否（定向对话） | 被 @ 者回 | 同上 |
| **bird 私聊**（全部聊天记录） | ✅ 是 | bird **直接回**（不过漏斗） | 仅 bird（persona 非成员，看不到） |
| **persona 私聊**（全部聊天记录） | ❌ 否（定向对话） | 该 persona **直接回**（不过漏斗） | 仅该 persona + bird |

要点：
- **私聊 = 群聊回应链去掉"参与漏斗"那一层（2026-06-15）**：1v1 没有"要不要参与"的问题,那个 persona/bird 永远直接回。实时情绪感知仍跑、仍注入语气,但 DM 用**轻量版感知**——只算情绪(emotion/intent/hidden_insight),**不再算结构信号**(指向谁/续谁话题/是否问句/情绪求接,这些只服务群聊漏斗)。回复引擎与群聊完全一致。即:**私聊 = 群聊 − 过闸 −（感知的）结构信号**。详见 persona-v2 §5.3④。
- 个人记录 = 「群里不 @ 的发言」 **+** 「与 bird 的全部私聊」。**bird 私聊里 bird 照常回话**——可见「个人记录」是分类而非"静音"。
- **不做特殊 UI**：用户就是正常发消息，不要做"居中淡灰气泡"那类区别设计。分类只在后台用（记忆/洞察），用户无感。
- 旧 PRD「个人记录 AI 看不到」属于已删除的 moments 模块，不再成立——群里的个人记录，**在场 persona 能看到**（只是不实时回应）。

**唤醒真值表**（覆盖群聊 + 两类私聊；reply = @ 该消息作者）：

| 用户行为 | Bird | Persona | 备注 |
|---|---|---|---|
| 群聊 **无 @** 发言 | 不回（落库供理解） | **ambient：≤2 个系统选定候选自判（可沉默），全沉默时主候选兜底轻接**（✅ 2026-06-11） | 仍 = 个人记录（分类只在后台）；候选=诞总固定+第二位轮换；无用户开关、系统内控；Router 兜底而非 Bird。ambient 发言出发点=读懂用户意图与情绪、用自己的立场/知识/特点服务用户；可对同伴观点有真实看法，但不为反驳而反驳、不表演 AI 互聊 |
| 群聊 **@persona** | 不回 | 被 @ 的 persona 回 | |
| 群聊 **@all** | 不回 | 3 个 persona **并行生成、先完成先展示** | 同一次编排 run；并行调用（✅ 2026-06-11 已定：完成顺序展示，不按成员顺序缓冲） |
| 群聊 **@两个及以上 persona** | 不回 | 被 @ 的全部**并行生成、先完成先展示** | 与 @all 同一条 fan-out 路（✅ 2026-06-11 新增） |
| 群聊 **@bird** | **不回(2026-06-15起)** | 不回 | Bird 不进群;@bird 在群里无效,该消息落 ambient |
| **reply Bird 消息(群内)** | **不回** | 不回 | 同上,Bird 群内不响应 |
| **reply persona 消息** | 不回 | 原 persona 回 | 等价 @该persona |
| **Bird DM** 发言 | 回（且为个人记录） | 不参与 | 私聊不用 @ |
| **Persona DM** 发言 | 不参与 | 该 persona 回 | 私聊不用 @ |

**Activation Router（不可见的控制层）**：上面这张表不该散落在各 agent 的 prompt 里，而应由一个独立的系统层 **Activation Router** 统一裁决。它的职责：
- 解析 mentions（@bird / @persona / @all）。
- 判断当前会话类型（group / bird-DM / persona-DM）与当前 planet。
- 判断 reply 指向谁。
- 决定触发 Bird、还是某个/某些 persona、还是无人（个人记录）。
- 决定是否进入记忆写入、是否进入 Bird 洞察管线。
- 控制 @all 的**并行 fan-out、稳定展示顺序与去重**。

口诀：**Bird 是角色，Router 是控制层**。不要让 Bird 自己承担"该不该说话/派给谁"的路由职责——那是 Router 的活，混在一起会让 Bird 既当裁判又当选手。

**并发与时序（避免"AI 抢话/乱序"）**：
- 同一群在同一时刻只允许**一次可见的回复 run**。用户连发多条时，用「收集后再回（collect）」或「打断重定向（steer）」，不要每条都并发触发一轮。
  - **✅ 2026-06-14 改为「输入静默触发」（HOLD 协议已废弃，理由见下）**：不在发消息时立刻回，而是**等用户停止动输入框**再回。前端规则：一条消息发出后累积进 batch，当**连续 IDLE_MS(2s) 无输入活动（打字/emoji/中文 composition）且输入框为空且无回复在流式**时才触发；这 2s 内任何输入活动都重置。连发同一 @ 的消息合并成一批；发不同 @ 则把前一批封存入队。**回复进行中再发不报错**——新消息进队列，当前回复结束后按序 drain（一次只跑一个可见 run，对齐后端单 run 锁）。模型侧不再判断"说完没"，只管回应给到的整批（行为地基要求把连续几条当一段读）。
  - **为什么废 HOLD**：HOLD 让模型判"用户说完没"——语义题、DeepSeek 上不准、还多一次调用；"输入框还在不在动"是确定的行为信号，准、零模型成本。`[SILENCE]`（ambient"没话想说"）保留，与时机无关。
- **@all / 多@ / ambient 的并行 fan-out**：同一次编排 run 内并行调用，**先完成先展示**（✅ 2026-06-11 拆掉按序缓冲）。并行回复彼此不读取同轮其它 persona 的未完成输出；"不重复、不互相表演"靠行为地基 + persona 人格本身的车道差异（lane_contract 已删，见支柱②）。
- 参考 OpenClaw 的 session queue（一个 session 一次一个 run，支持 steer/followup/collect/interrupt）。

**每轮回复 = 一次 chirp 自管的 run（借 ACP 的"会话隔离"思想，但不用 ACP 本身）**：Router 触发一次回复时，生成一个带隔离字段的 run：
```
run = { run_id, conversation_id, planet_id, agent_id, memory_scope }
```
- `run_id`：这一轮的唯一 id——@all 编排、并行子调用归并、队列去重、记忆/洞察写入的追溯都挂在它上面。
- `memory_scope`：这一轮该 agent 被允许读的范围（由 §3bis 成员资格 + planet 算出），作为 `recall` 工具检索的 **DB 层 scope 过滤**条件。
- 这是 chirp **自己管理的 run**，不需要 ACP/进程/协议——一次 run 内可能含**一轮 `recall` 工具往返**（方案 B，见 3bis-R / 支柱②「persona 运行流程」），但仍是 chirp 后端自管的轻量模型调用，不引入 ACP/进程隔离。

**bird / persona 的发言约束**：
- **bird 不进群（2026-06-15 改）**：它不是任何 planet 群的成员,群里 @bird/引用bird 都不触发它。它仍**全知可读**(为洞察/提醒在后台读全量),只是**不在群里发言**。出口只剩**两个**:① 与用户 1:1 私聊(bird DM,主要对话场所,不用 @);② 异步产出洞察/提醒(About-me)。
- persona 默认 passive：被 @ 才说。
- 交互上用输入框弱提示引导用户「群里 @ 才会有人回」（私聊不用 @）。个人记录不做特殊 UI——正常发消息即可。

**关键开放决策**：
- bird「群里几乎不出声、但全知」如何让用户**有感**而不**惊悚**？（见 ⑤）是否需要一个可见的「bird 在听」的弱信号？@bird 是用户主动唤起 bird 的入口，可作为「它确实在、且听得懂」的证明点。
- @all 与多 @ 均为**同一编排 run 内并行生成、先完成先展示**（✅ 2026-06-11 已定，落库与展示都按完成顺序）。待解的是：并行回复彼此看不到同轮其它 persona 的输出，怎么让它们「不重复、不互相捧场」？这条靠人格本身差异 + 行为地基约束（Bloome 铁律：主频道不表演 AI-to-AI；lane_contract 已删，见支柱②）。

---

### 支柱 ② 分身 / Personas —「怎么 build，且不出戏」

> 🔁 v2.1：本支柱已按《chirp-persona-技术路线-v2》重写同步；字段级定义与流程细节以该文档为准，本节只保留结构与方向。

**要解决**：如何低成本地定义一个 persona（诞总 / Barry / duck），让它**有辨识度、不重复、不掉人设、且记得用户**。现阶段重点先把**诞总（类李诞）**build 出来，作为整个产品口吻的标杆；Barry、duck 先占位。

**参考范式（三家高度一致，可直接抄）**：
- 「**工作区即人格**」：persona = 一组文件，而非一个模型。OpenClaw 注入 `AGENTS.md / SOUL.md / TOOLS.md` + `skills/<skill>/SKILL.md`；Bloome 用 `IDENTITY.md`(呈现) + `SOUL.md`(人格/判断) + `MEMORY.md/OWNER.md`(记忆)；Hermes 用 `SOUL.md + USER.md + MEMORY.md`（注：Hermes 自述 SOUL.md「legacy from OpenClaw」，三家同源）。
- **质量来自行为地基，不是人设文案**：Bloome 的 `bloome-playbook`（PRE_SEND_SCAN + anti-patterns）才是让对话「会聊」的关键。chirp 现在缺这一层。

**chirp 的具体形态（与 persona-v2 §1/§2 同步）**：

一个 persona = 三层对象，**不是模型里的一段散文，也不是一份手写 prompt，而是从素材蒸馏出来的资产**：

| 对象 | 是什么 | 要点 |
|---|---|---|
| `persona_template` | **公开人格资产**（无任何用户隐私） | catalog（展示/选择，不注入）；build_asset（素材、蒸馏产物、examples、知识库——不注入，知识库可按需 recall）；runtime_card（每轮注入的常驻短卡，硬 token 上限） |
| `persona_instance` | **每个用户的私有关系副本**（隐私所在，user × template 一条） | 用户滑条 patch、用户记忆（陈述性）、互动技能（程序性）、情绪-关系态；随对话由模型异步蒸馏长出来 |
| 系统层 | 所有 persona 共享、锁死 | `safety_privacy_base` + `behavior_base`，凌驾于 template/instance，谁都不能覆盖 |

具体人设（诞总）落在 template 的资产里：口吻、价值观、招牌动作来自素材蒸馏成的 runtime_card 常驻注入，领域细节走知识库按需 recall、用人格口吻消化后说、超纲承认不懂。地基才决定它会不会变成"谄媚的搜索引擎"。三人「车道不同」由**人格本身**保证（诞总=解构/松弛/反鸡汤，Barry=共情陪伴，duck=策略军师——世界观和声音真的不同，回复自然不同）：这是**建造期设计原则**，✅ 已定（2026-06-10）**不做运行时"不抢戏"规则、lane_contract 机制删除**；系统层 behavior_base 保留"不复述其他 persona 刚说的话"防复读即可。few-shot examples 存 build_asset；✅ 已定（2026-06-11）：runtime_card 的 voice_rules 内嵌 2–3 条微型口吻锚点例（计入硬上限），并删除独立 reply_rules 字段（回复倾向并入 voice_rules，通用纪律在 behavior_base）。

**chirp 行为地基 v0（= 系统层 `behavior_base` 的内容；所有 persona 共享，相当于 chirp 版 playbook；这层比人设文案更重要，建议单独成文 chirp-行为地基-v0.md）**：
- 短，不绕。
- 有立场，但不替用户做决定。
- 不复述用户长段原话；不复述其他 persona 刚说过的话。
- 不解释自己是 AI；不暴露内部路由 / 记忆检索 / 洞察生成过程。
- 不用心理咨询套话；不过度安慰。
- 不把用户的问题升格成宏大人生诊断。
- 可以幽默，但**幽默要服务理解，不要逃避真实问题**。
- **用户脆弱时，少讽刺、多轻一点**。
- **私聊不外溢到群聊**：在私聊里得知的私密 / 脆弱内容，不在群聊里主动带出来——即便你（同一 persona）两边都看得见。私密的事留在私密会话（借 Bloome「private facts stay in private conversations」）。这是行为约束、不靠代码闸：可见性归 scope，"该不该说出来"归这条地基。

（诞总/Barry/duck 的人设叠在这层地基之上。这版是 v0，后续随真实对话迭代。）

**Bird 的文件结构与 persona 不同**（它的活不是"陪聊"，是"全局观察 + 洞察"，所以结构也不同）：

| 文件块 | 作用 |
|---|---|
| `bird_identity` | Bird 是谁（app 的人格化，不是宠物、不假装是人） |
| `privacy_boundary` | 全知但不监控：什么能说、什么只存不说、怎么避免监视感 |
| `global_memory_policy` | 作为唯一全局读者，怎么读全量、写什么 |
| `insight_policy` | 何时把碎片合成洞察、洞察的「待确认」语气 |
| `reminder_policy` | 何时提醒、频率与克制（一天上限、深夜静默） |
| `about_me_policy` | 什么进 About-me、什么太敏感不进 |

**诞总（类李诞）的特别护栏**（类真人护栏写在**系统层 `safety_privacy_base`**，对所有 real_person_inspired 类 persona 生效，不写在单个 persona 记录上）：
- **不冒充真人李诞**，不编造其经历，不声称代表其观点——定位是"受公开脱口秀表达启发的、松弛 / 反鸡汤 / 轻轻拆穿式的朋友"，不是本人。
- 不只会抖机灵；**用户脆弱时少讽刺、多轻一点**（与关系理论底座的安全原则一致）。

**persona 运行流程（每次回复 = 一次 run，见支柱①；人格稳定、信息包每轮重建）**：
```
Router 触发 → 三层组装（按该 run 的 memory_scope）：
  [稳定层]   safety_privacy_base + behavior_base + template.runtime_card（byte 稳定，可 prompt-cache）
  [上下文层] 用户画像 + planet 洞察 + instance（patch / 用户记忆 / 互动技能 / 情绪态）（预蒸馏免费注入，hash-gate 缓存）
  [易变层]   当前会话最近 N 条 + 模型自取 recall（对话记忆 + persona 知识库）+ 实时信号
→ 主模型一遍写出回复（允许一轮 recall 工具往返，scope 在 DB 层强制）
→ 后处理 → 落库消息 + 异步留痕/蒸馏（重活全在写入侧，回复路径只读）
```
ModelProvider 是个**薄抽象**：业务逻辑不直接写死 SDK 调用，留一个换/加模型的接缝即可——但**现阶段只默认 Claude，不真去铺多家 provider**（选型纪律，见 §6）。Bird 与 persona 各自一套 runtime，但走同一条流程。

**persona 是数据驱动的资产，任何用户都能用（托管引用，persona-v2 §6.2）**：
- 用户「使用」某 persona = 系统为他建一条 **instance 引用 template**（不复制资产）；服务端读 runtime_card + 按需 recall 其知识库生成回复，用户记忆写进他**自己的 instance**。**P0 的诞总就按此跑**（官方 template，不走发布/审核）；建造态改 template、使用态只改自己的 instance，互不影响。
- 用户**自建** persona（对话式调教 / 保存 / 发布社区 / 自动审核 / 评分与使用量）——设计已定（persona-v2 §6.1/6.3），**P0 后再做**。资产不出平台：source/chunk/embedding/完整蒸馏产物为服务端私有。
- 🔴 **行为地基 + 安全边界是系统强制层，凌驾于用户写的 persona 内容之上，不可被覆盖**：用户内容只能定"口吻 / 身份 / 领域"，**不能改"安全 / 不诊断 / 隐私 / 记忆可见性 scope"**。用户写的 persona 文本视为**不可信内容**——要防它越权（套别人数据、越出自己的 memory_scope、诱导有害输出、prompt 注入）。类比 Bloome 的 playbook 凌驾于人设：地基在外、人设在内。

**关键开放决策**：
- ✅ persona 预设 vs 用户自创 → 已定：**P0 = 官方诞总 template + 托管引用**（任何用户可用）；Barry/duck 为官方占位 template；用户自建/发布/审核后置（persona-v2 §6）。
- 是否需要一类**依赖用户画像/记忆动态生成的 persona**（区别于固定人设）？现阶段不做，先记着这个口子。
- persona 的记忆与 bird 的记忆是**共享一个底座按权限读**，还是**各存各的**？（见 ③，已定：单表 + 成员过滤）
- ✅ 车道约束 → 已定（2026-06-10）：不做运行时规则、lane_contract 删除；差异靠人格本身（建造期设计原则）。
- ✅ runtime_card 形态 → 已定（2026-06-11）：voice_rules 内嵌 2–3 条微型口吻例（计入硬上限，初值 ~800 token 可调）、删除独立 reply_rules。
- ⏳ 待定：Bird 洞察 / 全局长期记忆的下发形态（bird_insight_digest 不建字段，M3 前重新设计）。

---

### 支柱 ③ 记忆 / Memory —「懂用户的底座」

**要解决**：让 bird 和 persona 都能「记得」，且随用量越用越懂。这是 ②④ 共同的地基。

**参考范式（这里三家差异最大，值得借鉴 Hermes）**：
- Bloome/OpenClaw：分层的 markdown 记忆——`OWNER.md`（主人画像）/ `MEMORY.md`（要点）/ `memory/users/*.md`（个人档案）/ `memory/projects/*.md`；agent 自己读写、定期更新。
- **Hermes 多了「检索」层**：`FTS5 全文 session 检索 + LLM 摘要做跨会话召回` + Honcho 用户建模 + 「agent 自管理记忆 + 周期性 nudge」。这正好对应 chirp「跨场景把零碎连起来」的需求。

**chirp 的分层建议（框架级）**：
1. **原始层**：所有消息落库（个人记录 / @对话 / 1:1 / 笔记），全部归一个 `user_id`。你 PRD 的 `messages` 表已经是这个思路。
2. **画像层**：动物人格（v7 五维 + 14 动物）+ 关系状态（关系理论底座的「当前关系天气」）+ 用户档案。**注意区分特质与状态**：动物=可变的关系反应画像，关系天气=随对象/阶段变化，不可固化成人格。
3. **召回层（分三层，按成本递增）**：当 bird/persona 要回应或出洞察时，怎么从海量原始层取回相关片段——这是 chirp 现在完全没有、却决定「懂不懂」的一层。**核心纪律：绝大多数轮次不该为召回再调一个模型。** 见下「3bis-R 分层召回」。
4. **派生记忆层（curated notes）**：每个 persona 可以有一份"对用户的关系笔记"、bird 有一份"全局画像笔记"——这是模型沉淀下来的**结论**，短、可覆盖、可校正。**这一层正是下面 Tier 0 的料**：它在写入时/异步被蒸馏好，回复时直接免费注入、不在热路径现算（对标 Bloome 的 `OWNER.md`/`<sender_profile>`、Claude Code 的 `CLAUDE.md`）。**注意：派生记忆只是加速理解，不承担"谁能看见"的职责**；可见性永远由原始层 + 成员资格过滤决定（见 §3bis），不要把它做成"每个 persona 各存一份记忆"的物理分库。

#### 3bis-R. 分层召回（回复前怎么拿记忆，决定快慢与"懂不懂"）

> 🔁 **v2.1**：recall 的实现细则（多 query + rank merge、知识库来源维度、写入侧 L0 留痕 + L1 片段蒸馏）以《persona-技术路线-v2》§5 为准；本节保留选型论证与「读写拆分」纪律，方向不变。

「回复前怎么把相关记忆拿到」是召回层的落地。这里直接定一套**分层**方案——它同时解决两个相反的诉求：既要"用户讲过很多次、agent 却像第一次认识他"不再发生，又不能让每轮回复都背一个额外的模型调用而变慢。

**先看四套系统怎么做的（实证，不是臆想）**：

| 系统 | 回复前怎么拿记忆 | 热路径有没有额外模型调用 |
|---|---|---|
| **Claude Code** | `CLAUDE.md` 常驻注入；其余靠 agent 循环里按需 grep/read 文件 | **无**（要查才查，没有自动向量召回） |
| **Bloome** | `OWNER.md` + `<sender_profile>` 每轮免费注入（**hash-gated**：内容没变不重复注入）；只有出现"上次/那个/remember"信号才去读 `MEMORY.md` 索引 → 日记文件 | **无**（"文件即记忆"，蒸馏在**写入时**做） |
| **Hermes** | `SOUL/USER/MEMORY.md` 注入 + FTS5 全文检索 + **LLM 摘要**做跨会话召回 | **有**（摘要那步，最重的一家） |
| **OpenClaw active-memory** | 回复前跑一个**阻塞的 memory 子 agent**（单独模型调用） | **有**，且官方明说"**直接增加用户可见延迟，因为它在 reply path 上**"；对策是 timeout / circuit breaker / 缓存 / **群聊默认关**（`allowedChatTypes:["direct"]`） |

> 两条要记死的实证：**①** OpenClaw 亲口承认"回复前同步 LLM 召回会加延迟"，并且**在群聊默认关掉它**——而群聊（尤其 @all 多 persona 并行）正是 chirp 的高频面。**②** Bloome / Claude Code 干脆**回复前不做 LLM 召回**：把"蒸馏成短档案"这件重活挪到**写入时**，读时只免费注入。这就是 chirp 要抄的范式。

**chirp 的召回结构（已选「模型自取」方案 B——少架构、把"挖多深"还给模型，不用代码门控）**：

分三块：前两块免费预拼，第三块交给模型自己判断。

- **① 常驻层（预蒸馏免费注入，扛掉大多数"记得我"）**
  把**已经预算好的短档案**直接拼进 prompt，不搜索、不调模型、零延迟。chirp 这层**现成就有三样**：① 用户画像（动物人格 + 关系状态，本就全量广播）；② 该 planet 的 bird 洞察（本就异步预算好）；③ **该 persona 自己的关系笔记**（§3 第 4 层派生记忆）。
  对标 Bloome 的 `OWNER.md`/`<sender_profile>`、CC 的 `CLAUDE.md`。**优化**：像 Bloome 一样给这几份档案做 **hash-gate / 版本号**，内容没变就用缓存的注入串，别每轮重拼。光这一层，persona 每轮就带着"画像 + planet 洞察 + 我和 ta 的历史结论"，**大部分对话已经显得记得**。

- **② 最近窗口（永远带，免费）**
  当前会话**最近 N 条**直接进 context。不搜索、不调模型。

- **③ 召回工具 `recall(query)`（模型自取，取代"自动检索 + 门控摘要"）**
  给 bird 和 persona **同一个工具**：模型在回复过程中**自己判断**"这里要不要翻旧账"，要就调、不要就不调（对标 Bloome 的 agent 自调 `read`/`history`、CC 的按需 grep）。工具做 **scoped 便宜检索（pgvector + 全文），返回原文片段**，模型读了在**同一轮里**继续写。
  - **没有单独的摘要模型调用**：原来 Tier 2 那个"阻塞 LLM 摘要"**溶解掉了**——"把片段读懂、压成话"由主模型在 loop 里顺手做，不再额外起一个模型。于是 timeout/circuit-breaker 那套也基本不需要（就一次便宜检索）。
  - **没有按场景强度、没有代码门控**：私聊/群聊、bird/persona 都用同一个工具。深浅差异只来自两处——**scope**（工具能检索的范围不同）+ **模型判断**（私聊深聊它自然多调，群里快问快答它自然少调）。这就是把"该挖多深"还给模型（Bloome 的 per-signal 决策），而不是用矩阵替它定。
  - **群聊不再需要"默认关"的闸**：群里模型本就很少主动调 recall；@all 并行时各 persona 各自判断，工具是便宜检索（原文片段、非摘要），并行也快。真出现滥用再看遥测加约束，**别预先建闸**。
  - **代价（接受）**：chirp 的回复从"单次预拼调用"升级成"**允许工具往返的小 loop**"。工程上比纯单次稍重，但换来 Bloome 式干净的模型自决——按"少架构多靠模型 + 重 UX"，这条值得（重点不是省工程量）。
  - **scope 仍是 DB 层硬边界**：`recall` 只能在 `memory_scope` 允许的范围里检索（WHERE 条件，不靠 prompt 自觉），见下。

> **为什么是 B 不是 A**：方案 A（后端预拼 + 代码门控决定要不要深召回）要在调模型**前**猜"这轮需不需要翻旧账"，还得为 bird/persona、私聊/群聊各定强度——是更重的架构、且把判断从模型手里夺走。方案 B 让模型像 Bloome 那样**当场判断、想挖才挖**，差异全靠 scope 自然产生，bird 和 persona 用同一套、私聊和群聊用同一套。更贴原则，UX 上也不会让普通闲聊白背一次阻塞调用。

**读 / 写拆分（核心纪律，不变）**：
- **写入时 / 异步**做重活：把对话蒸馏成 persona 关系笔记、bird daily_notes / 洞察（对标 Bloome 的 silent distilled write + chirp 已有的洞察管线 §4）→ 这是 ① 常驻层的料。
- **回复时**：① 免费注入 + ② 最近窗口免费带 + ③ 模型按需 `recall`（便宜检索原文，无独立摘要模型）。重活在写时，读时轻。
- 一句话：**Hermes 在读时做的 LLM 摘要，chirp 大部分前置到写时；读时模型只在需要时拉原文片段、自己读懂。** 考前把笔记备好，开考想翻才翻。

**scope 过滤（安全红线，不可省）**：`recall` 必须带成员过滤（§3bis）——persona A 只在「A 的私聊 + A 在场的群 + A 所在 planet 的洞察 + 用户画像」里检索；**绝不碰 bird 私聊原文、A 不在场的群、其它 planet 的洞察**。scope 由该 run 的 `memory_scope`（支柱①）算定后，作为 `recall` 检索的 **DB 层 WHERE 条件**强制，不靠 prompt 约束。`top-k` 设上界控制 token 预算。

**落到里程碑**：**三块都在 M1 做齐**（① 常驻注入 + ② 最近 N 条 + ③ `recall` 工具，含回复 loop 支持一轮工具往返）。`recall` 在 M1 先**直接在 `messages` 表上做 pgvector + 全文检索**（不依赖成熟的蒸馏笔记也能跑）；常驻层 M1 先用现成的用户画像 + 最简 persona 笔记。scope 过滤从第一天就焊死。M2 只是**把写入侧蒸馏做厚**（persona 关系笔记 / daily_notes 越来越准）让召回质量更高，**不是到 M2 才有召回**。

**写入纪律**（借 Hermes / OpenClaw）
- 不是所有内容都进长期记忆；日志可以多，长期 profile 要克制、要短、可覆盖。
- 每条写入的记忆/洞察带 `source_message_id` + `confidence`，对齐 PRD 的 `related_message_ids` 与「待确认」原则，方便回溯与让用户校正。

**关键开放决策**：
- ✅ 召回怎么做、何时深挖 → 已由 **3bis-R 方案 B** 定：常驻注入 + 最近窗口 + **模型自取 `recall` 工具**（全文 + 向量，Supabase pgvector 现成，返回原文片段）；**不做独立 LLM 摘要、不做代码门控、不做按场景强度**——深浅交给模型 + scope 自然产生。
- ✅ 记忆怎么写 → 已定（persona-v2 §5.2）：**模型异步片段蒸馏**——L0 每轮留痕（无 LLM）；L1 按 idle/轮数封顶触发、只写短 delta 进 instance；L2 全局整理归 Bird（后置）。不在回复路径写、不每轮复盘。
- 召回是否要排除某些高敏内容？（注：可见性已由 §3bis 成员资格分桶决定——bird 私聊只有 bird、群里个人记录在场 persona 可见。这里仅指"即便可见、要不要因敏感而不主动召回"，细节后续。）

#### 3bis. 记忆可见性 / 分桶模型（核心约束，决定 chirp 的隐私质感）

chirp 的记忆**不是一个全局池**，而是按「谁能看见」分桶的。这是产品定义级别的规则，不是实现细节：

| 角色 | 记忆范围（能看到的） | 看不到的 | 边界判据 |
|---|---|---|---|
| **persona A** | ① 用户与 A 的私聊 ＋ ② **A 在场的所有群聊**里的全部对话（含别的 persona 与用户的发言、群里的个人记录）＋ ③ bird 下发的**用户洞察**（A 所在 planet 的全部洞察，**跨 planet 隔离**）＋ ④ **用户画像**（动物人格 + 关系状态，全量、不分 planet） | 用户与 persona B 的私聊；A **不在场**的群聊；**用户与 bird 的私聊原文**；**其它 planet 的洞察** | **会话成员资格（membership）**：A 看得到某段对话 ⇔ A 是该会话成员。洞察按 planet 隔离、画像全量，都是 bird 下发的只读派生物 |
| **bird（主 agent）** | 用户在 chirp 的**全部行为数据**：所有群聊、所有私聊（含 bird 私聊）、个人记录、笔记、画像——全量 | 无（全知） | bird 是唯一的全局读者 |

**三条单向流**（important）：
1. **洞察 = bird → persona 的只读广播，按 planet 隔离**：persona 只拿**自己所在 planet 的全部洞察**（不设敏感度闸）；**跨 planet 隔离**——恋爱 planet 的洞察不下发给职场 planet 的 persona。bird 跨所有 planet 全局合成，再按 planet 分发回去。`planet_id` 是真用来过滤的字段。_（现阶段只有恋爱一个 planet，诞总/Barry/duck 同 planet，所以都看到全部洞察——这是"同 planet 共享"，不是"不隔离"。）_
2. **用户画像 = bird → 所有 persona 的全量广播（只读，不分 planet）**。动物人格 + 关系状态对所有 persona 可见，是它们"懂用户"的共享底；persona 不能改写画像（由 bird/系统维护，切换由用户确认）。
3. **persona 之间对话记忆不互通，且都看不到 bird 私聊原文**：A 的私聊对 B 不可见；用户与 bird 的私聊**原文**对所有 persona 不可见。persona 之间唯一的对话记忆交集是「共同在场的群聊」。

**关于 bird 私聊 → 洞察**：bird 私聊的**原文**对所有 persona 永久不可见，但它**是 bird 合成洞察的素材来源**。链路：`bird 私聊原文（只有 bird 读）→ bird 合成洞察 → 按 planet 下发 persona`。洞察本身就是对对话的抽象（不是原文），所以不另做泄露过滤；若日后用户反馈出现问题再收紧。

**这套模型的好处**：
- 隐私质感天然成立——和真人社交一致（你跟朋友 A 的私聊，朋友 B 不会知道；但你们仨的群聊大家都看得到）。
- 直接对齐 Bloome 的 thread/session 隔离（session key 含 conversationId），实现上就是「按 conversation 成员表过滤记忆检索」。
- 召回层③ 因此必须带 **scope 过滤**：检索 persona A 的相关记忆时，先按「A 是成员的 conversation 集合 ＋ A 的私聊 ＋ A 所在 planet 的洞察 ＋ 用户画像」圈定候选，再做全文/向量召回；bird 私聊原文、A 不在场的群、其它 planet 的洞察一律排除。

**已拍定的决策（2026-05-29）**：
- ✅ **洞察按 planet 隔离分发，不设敏感度闸**：persona 只拿自己所在 planet 的**全部**洞察；跨 planet 隔离（恋爱 planet 洞察不给职场 planet persona）。`planet_id` 真用来过滤。现阶段只有恋爱一个 planet，诞总/Barry/duck 同 planet，所以都看到全部洞察——是"同 planet 共享"，非"不隔离"。**多 planet 由用户自建**（UI/产品层口子，由产品设计承载）。用户画像则全量广播、不分 planet。洞察本身是对对话的抽象，不另做 bird 私聊泄露过滤（看反馈再说）。
- ✅ **单表 + 成员资格过滤**（不物理分库）：所有消息存**同一张 `messages` 表**，每条带 `conversation_id`；另有 `conversation_members` 表记录谁是哪个会话的成员。取某 persona 能见的记忆 = `WHERE conversation_id IN (该 persona 是成员的会话集合)` ＋ 它的私聊 ＋ 它的相关洞察。bird = 不加成员过滤、全量读。**数据只存一份，"谁能看见"由过滤条件算出**，避免复制存储与不一致。与 Bloome 的 session-key(含 conversationId) 同构。
- ⏸ **私聊 vs 群聊召回不差异加权**（暂不做）：M1/M2 阶段，persona 的「私聊」与「在场群聊」记忆在召回时**同权**，先不做加权。未来若发现私聊关系信号更强，再引入权重。

---

### 支柱 ④ 洞察 / 深度链接 —「bird 的合成能力」（终点引擎）

**要解决**：把支柱③的全量语料，合成成 bird 的产出——**About-me 用户洞察、自我发现、重要事项提醒**——并在对的时刻、用对的克制度递给用户。这是 chirp 真正的护城河，也是最难的一层。

**参考范式**：
- Bloome 的 `HEARTBEAT.md` + proactive 触发：醒来检查、何时说话/闭嘴（深夜不扰、没新事不说、刚说过别再说）；一天最多主动一次。
- Hermes 的「agent-curated memory with periodic nudges」：周期性回看、主动提醒。
- chirp PRD 里 bird 的定位（观察者、洞察推送者、成长见证人；不解决具体场景、一天最多主动一次）已经是对的方向。

**chirp 的具体形态**：
- bird 的洞察 = `读全量语料 → 找跨场景/跨时间的 pattern → 形成一条待确认洞察 → 在 About-me 沉淀 + 在对的时刻触达`。
- 洞察必须是「**待确认**」语气（"我注意到…，是这样吗？"），不是判决——这既是产品调性，也是安全要求（见 ⑤）。

**洞察生成流程（pipeline 草图）**：
```
raw_messages
  → daily_notes（按天沉淀的观察摘要，避免每次扫全量）
  → pattern detection（找跨时间/跨场景的反复模式）
  → insight candidate
  → safety / privacy check（不诊断、敏感度）
  → dedupe / cooldown（不重复刚说过的、控频）
  → about_me draft
  → 用户确认 或 被动展示
```

**共用一套检索底座（两个入口）**：洞察管线里"读语料 / 找 pattern"用的检索，和 3bis-R 实时 `recall` 工具**共用同一套 scoped 检索底座**（pgvector + 全文 + 同一套 §3bis scope 过滤），只是两个入口：① **实时入口**——回复 loop 里模型按需调 `recall`，要快；② **异步入口**——洞察 job 后台慢扫，可深可慢。底座只写一遍，避免两处 scope 逻辑漂移（bird 洞察 job 走 bird 全量 scope，persona 实时 recall 走各自 scope）。

**一条 insight 的字段（至少）**：`content` / `planet_id`（属哪个 planet，决定分发范围）/ `topic` / `source_message_ids`（可追溯）/ `confidence` / `status`（候选/待确认/已确认/已删）/ `visibility` / `created_at` / `updated_at` / `user_feedback`。`planet_id` + `visibility` 是落地 §3bis「洞察按 planet 分发」的关键字段。

**关键开放决策**：
- 洞察的触发：定时（heartbeat/cron）还是事件驱动（某 pattern 累计到阈值）？还是两者？
- 「重要事项提醒」从哪来——用户显式说的，还是 bird 从对话里推断的待办？后者风险更高。
- 洞察的**频率与克制**怎么控制，避免变成 push 骚扰？（一天上限、深夜静默、用户可关）

---

### 支柱 ⑤ 信任与安全 —「横切约束」

**要解决**：让「bird 全知 + 处理高敏情感数据」这件事不变成「被监视/被诊断」。这层不是功能，是**所有层的前提与红线**。

**参考范式**：
- 关系理论底座已写死的原则（直接采纳）：动物叫「关系反应画像」不叫诊断；结果会随对象/阶段变化；不靠截图断言出轨/操控；涉胁迫/自伤优先转安全支持；**用户可查看/修正/关闭基于聊天生成的洞察，敏感记忆可删**。
- Bloome 的 SOUL.md「Owner & Trust / Safety / Boundaries」+ anti-patterns（surveillance-traps、privacy-probe）：私密的事保持私密、不外泄、不主动监控、群里有第三方默认沉默。
- OpenClaw 的 DM policy（pairing/open + allowlist）、非 main session 进沙箱：权限是显式的。

**chirp 的具体形态（建议立为红线）**：
- **可见的边界**：用户要随时能看到「bird 知道什么、用了哪些记录出这条洞察」（PRD 的 `insights.related_message_ids` 已是雏形），并能删。**呈现方式**：在 About-me 里以「bird 每天为用户写洞察日记」的形式呈现（具体设计 TBD）。
- **隐私靠成员资格隔离**（不是单独的"私人空间页"）：隐私由 §3bis 的分桶保证——用户与 **bird 的私聊是最私密层**（原文只有 bird 看得到，persona 永远看不到）；persona 之间私聊互不可见；跨 planet 洞察隔离。⚠️ **旧 PRD 里"笔记/个人记录是 persona 看不到的私人空间"基于已删除的 moments 模块，不再成立**——群里的个人记录在场 persona 是可见的（仅存不答）。
- **不诊断、待确认**：所有画像与洞察都是「当前倾向/待确认」，动物切换由用户确认。

---

## 4. 三套参考框架的对照（一页速查）

| 维度 | OpenClaw | Hermes-Agent (Nous) | Bloome | 对 chirp 的取舍 |
|---|---|---|---|---|
| 定位 | 自托管个人助理网关 | 自我改进 agent（OpenClaw 同源） | OpenClaw 上的商业 channel + 行为引擎 | chirp 是面向 C 端的「关系自我探索」产品 |
| 控制平面 | Gateway（sessions/channels/tools/events） | 单 gateway 多平台 | 复用 OpenClaw gateway | 借「网关唤醒 + 隔离 session」思想 |
| 人格 | `AGENTS/SOUL/TOOLS.md` + skills | `SOUL/USER/MEMORY.md` + `/personality` | `IDENTITY/SOUL/OWNER/MEMORY` + playbook | **抄「工作区即人格」+ 自建行为地基** |
| 记忆 | 分层 markdown，agent 自管 | **+ FTS5 检索 + LLM 摘要召回 + 用户建模** | 分层 markdown + heartbeat | **抄 Hermes 的召回层** |
| 多 agent | workspace 路由、隔离 session | spawn 子 agent 并行 | leader+specialists、delegate/spawn、listenMode | 用 leader(bird，群里 mention-only)+specialists 模型 |
| 主动性 | cron | agent-curated + periodic nudge | HEARTBEAT + proactive，一天一次 | 用于 bird 的洞察触达，强约束频率 |
| 安全 | DM policy + 沙箱 | — | SOUL 信任/边界 + anti-patterns | **立为红线，叠加关系理论底座** |

> 关键洞察：**三家同源**（SOUL.md 这套约定来自 OpenClaw，Hermes 和 Bloome 都继承）。chirp 不必从零设计 agent 框架，可以直接采用「网关 + 工作区人格 + 分层记忆 + 召回」这套成熟范式，把创新集中在 ④（洞察）和动物/关系画像这两个 chirp 独有的地方。

---

## 5. 建议的推进顺序（以终为始的里程碑）

不按支柱编号推，按「最快摸到两个魔法时刻」推。

> 🔁 **进度与优先级标注（2026-06-10）**：M1 的机器壳已基本建成（schema / Activation Router / run + scope / 可见 run 锁 / recall 接缝 / 单 persona 测试入口）。**当前 P0 = persona-v2 §0**：数据底座迁移（template / instance / 系统层）→ runtime 三层组装 → recall 升级（多 query + rank merge）→ 记忆 L0 留痕 + L1 片段蒸馏 → 诞总资产 + 知识库 → 托管引用（任何用户都能用诞总）。群聊与唤醒矩阵维持已建成形态、整体切换到新底座；Barry/duck 迁为官方占位 template，内容后续打磨。下文 5.0–5.2 保留作原始推演记录。

### 5.0 关键解耦：机器 vs 诞总人设（可并行）

**persona 是一条数据记录（②的 8 文件块）；"跑人设的机器"和"诞总的人设内容"是解耦的。** M1 里几乎所有工程都跟诞总具体内容无关——用一个**占位 persona** 就能把整台机器建好、跑通、测对，诞总打磨好后只是**填进那条记录的槽位**。于是两条线并行、互不阻塞：

- **Track A（机器，先建）**：schema / 路由 / run / runtime / 记忆 scope / UI / 安全——全部与诞总无关。
- **Track B（诞总，并行打磨）**：研究 + 写诞总的 `identity/voice_style/examples/lane_contract/boundaries` 内容 → 填进 persona 记录 → 用 Track A 的闭环对着聊、迭代。
- **配套**：先做一个**单-persona 测试入口**（绕开完整群聊 UI，直接跟某条 persona 记录对话），让 Track B 调味迭代快。

### 5.1 M1 —— 群聊跑通（日常价值雏形），按这个序：

1. **数据模型（最先，改晚要重构）**：planet / conversation(type+planet_id) / conversation_members / messages(含个人记录标记) / persona(记录) / insight。**4 条边界定死**：conversation 类型、membership、persona 记忆边界、bird 读取边界。
2. **persona 记录系统**：persona 表 + 8 文件块 schema + 加载器 + 最简 seed/编辑。这是诞总将来填的槽；先塞**占位 persona** 测试。
3. **核心竖切（证明日常价值在）**：发消息 → Activation Router（先只 @persona）→ Persona Runtime（载占位 persona + scoped 记忆 → 拼 prompt[地基外/人设内] → ModelProvider(Claude) 流式）→ 落库 + 推前端。用占位 persona 把闭环跑对。
4. **完整唤醒矩阵 + run/队列**：@all 同 run 并行 fan-out + 稳定顺序展示、@bird、reply、个人记录、DM、单-run 并发控制（支柱①）。
5. **聊天 UI**：微信式会话列表、三种会话、@ 选择器、流式渲染、输入框弱提示。
6. **召回三块全在 M1（方案 B，见 3bis-R）**：① 常驻注入（用户画像 + 最简 persona 笔记）+ ② 最近 N 条 + ③ `recall` 工具（先直接在 `messages` 上 pgvector/全文，回复 loop 支持一轮工具往返）。**scope 过滤（DB 层 membership/planet）第一天就焊死。** 为什么整套进 M1 而不拖到后面：晚做要把回复从"单次调用"重构成"工具 loop"、且 scope/schema 本就必须第一天对——是"接缝问题"不是"功能问题"。注意 M1 的召回是**"形状齐、质量薄"**：新用户没多少历史可翻，召回质量靠后面养（见 M2），M1 不拿"召回准不准"当验收。

**目标：群聊跑通、闭环聊着顺；诞总（Track B）就绪后填槽即用。** Barry/duck 先占位。
⚠️ **M1 真正的风险与资源重心是 Track B（persona 声音 + 行为地基），不是召回**。机器（Track A：schema/路由/run/召回接缝/UI）是确定性工程，照着建即可；产品成不成，看 persona 像不像、群聊让不让人觉得被理解——那是要反复调味的不确定项。别把 M1 的劲砸在召回质量上。

### 5.2 后续里程碑

- **M2 — 记忆质量养厚（让"记得"越来越准）**：召回的**整套形状 M1 已就绪**；M2 不是"补召回"，而是把**写入侧蒸馏做厚**——persona 关系笔记 / bird daily_notes 越来越准、常驻层越来越对，于是 `recall` 的召回质量随用量自然上升。这一步靠的是数据积累，急不来，所以排在 M1 之后。
- **M3 — bird 洞察（顿悟价值，下一个大里程碑）**：④ 的第一版——bird 读全量、出 1~3 条待确认洞察、沉淀到 About-me，频率与安全⑤同步上。**为什么不塞进 M1**：① 它依赖数据积累，M1 没几天数据，洞察必然空浅、验证不了；② 它的安全面最大（对用户下判断，"被诊断/被监视"红线全在这），值得在能专心打磨安全时单独做；③ 它是独立的难能力，不是召回的延伸。复用 3bis-R 的检索底座（异步入口，见 §4）。
- **M4 — 关系演化**（见 §7.2）。

### 5.3 横切 —— ⑤ 信任（从第一天焊死，不是某个阶段）

成员资格隔离、bird 私聊只 bird 可见、洞察可删、不诊断、地基在外人设在内——这些从 M1 步骤 1/3 起就在，不要等到最后补。

---

## 6. 给你的几个「想得还不够」的提醒

1. **洞察(④)要单独立项**，别让它躺在「记忆」里——它是终点，最难，也最值钱。
2. **召回(③的召回层)是你 PRD 里完全没有的一块**，但它决定「懂不懂」。按 **3bis-R 方案 B**：常驻预蒸馏免费注入 + 最近窗口免费带 + **模型自取 `recall` 工具**（像 Bloome/CC 那样想翻才翻，scope 在 DB 层强制）。**别照搬 Hermes/OpenClaw 的"回复前阻塞 LLM 摘要"**——那把召回压进热路径、让每轮变慢（OpenClaw 已证此坑）；chirp 把重活前置到写入时，读时只让模型按需拉原文片段、自己读懂。
3. **bird 的"全知 + 群里几乎不出声"是双刃剑**：体验上很强，信任上很险。⑤ 必须从第一天就在。（注意 bird 并非完全沉默——群里 @bird 会应答，且用户可与 bird 私聊；它只是不主动在群里说话。）
4. **行为地基(②)是 Bloome 真正的秘密武器**，不是人设文案。chirp 要把「文案调性指南」升级成一份所有 persona 共享、可执行的行为规则。
5. **特质 vs 状态别混**（关系理论底座的核心警告）：动物=可变画像，关系天气=随对象变化，记忆层要分开存、分开用，别把状态固化成人格。
6. **记忆是分桶的，不是全局池**（见 3bis）：persona 按「会话成员资格」分桶，bird 全知，洞察是 bird→persona 的单向只读广播。召回层必须带 scope 过滤——这条要在 M1 建消息表时就定好，否则后面改数据模型很贵。
7. **选型纪律：现阶段不引入重型框架**。chirp 是 Node + Supabase 栈，验证的是"亲密小群是否让人觉得被理解"。状态编排用普通 Node 代码、记忆用 Postgres + pgvector 自研薄层就够。LangGraph / Letta（Python 优先，与栈不匹配）、Mem0、Zep/Graphiti（知识图谱）这类是**中后期再评估**的选项，别为了"架构完整"过早压上重地基。同理：persona 市场/收费、多渠道 gateway、agent 自装技能、云沙盒——这些**功能**都不是现在的事（见 §7.4/7.5）。**例外**：persona 必须从一开始就做成"**template/instance 双对象 + 托管引用 + 系统强制的安全地基**"（支柱② / persona-v2），因为这是市场化绕不开的地基，补晚了要重构。

---

## 7. 后续探索原则（M3+ / 暂不过度架构化）

### 7.1 总原则：产品层管边界，模型层管判断

后续能力**先不要过度显式编排**。优先让模型基于上下文、记忆和 persona 设定**自然判断**，而不是把每种可能都做成独立流程模块。一句话分工：

> **产品层管「容器、边界、可见性、用户控制」；模型层管「理解、判断、表达、轻量建议」。**

- **暂时别做成独立模块**（M1/M2 不为它们预留重架构）：自动发现新成员、临时建子群、自动引入短期陪伴角色、复杂跨 planet 调度。
- **更适合先交给模型**（靠 prompt + 记忆召回 + 少量规则）：Bird 判断某条对话更像属于哪个 planet（⚠️ 但不能破坏 planet 间洞察隔离）、Bird 感知用户冒出新主题、persona 随长期记忆形成更熟悉的语气、persona 在合适时少解释多接话、Bird 在 About-me 里把用户不同角色组织出来。
- **必须由产品层明确承载的**：planet 如何在 UI 呈现、About-me 如何按 planet 展示用户不同角色、洞察如何沉淀到全局 About-me 或某 planet、用户如何创建/编辑/归档 planet、哪些记忆可由 Bird 跨 planet 连接、哪些只在 planet 内部用。

### 7.2 M4（后续里程碑）— Relationship Evolution

让 persona 与用户的关系**随时间变深**（M1–M3 之后）：relationship stage（关系阶段）、私有梗、persona feedback（用户对它的反馈）、回复策略随关系变化。目标：从"一个有辨识度的 persona"走向"一个越来越熟的老朋友"。

### 7.3 Bird 的后期角色扩展

当前 Bird 是「全局理解者 + 洞察管家 + 群里 mention-only 成员」。后期可探索（不进 M1）：Bird 基于群聊判断是否需要新成员、为用户发现更合适的新 persona、帮用户发现/创建新 planet、建议把某主题交给更合适的成员——即 Bird 从"理解者"长成"**关系管家**"，但始终**不是任务路由 leader**（路由是 Activation Router 的活，见支柱①）。

### 7.4 Persona 市场（产品方向，逐步做）

> v2.1：发布链路 / 自动安全审核 / 评分与使用量 / 托管引用 / 调试-保存-发布版本机制已在 persona-v2 §6 设计完毕，按其执行；本节保留产品方向。

产品方向：persona **由 builder 和普通用户共同创建**，可选公开到社区、免费或收费。这把 persona 从"平台预设"推向"用户生态"。架构上现在就要立住的前提（见支柱②）：persona 是**数据驱动的用户记录**、**行为地基/安全是不可被用户覆盖的系统层**。市场本身要逐步补的（后期）：
- 归属 / 版本 / 编辑历史。
- **上架前安全审查**（防越权 prompt / 注入 / 有害人设）——这条是绕不开的红线。
- 收费 / 分成 / 计量。
- 社区发现、评分、举报、下架。

### 7.5 何时才需要 ACP / 沙箱 / 协议层

现阶段 persona 是"prompt + 配置"，由 chirp 自管的 run 驱动（支柱①），**不需要 ACP、进程隔离或协议层**。注意：3bis-R 方案 B 的 `recall` 工具会让一次 run 含**一轮有界的工具往返**——这仍是 chirp 后端自管的轻量 loop（一个内部检索工具、scope 在 DB 层强制），**不构成需要 ACP 的理由**。只有当出现下面这些时才回到这个话题——而且即便那时，更可能是**自定义 RPC + 沙箱**，未必是 ACP：
- persona 能跑**用户自带的工具 / 代码**（市场化后最可能触发，需按会话沙箱隔离不可信代码）。
- persona 需要**长期独立执行任务**；Bird 要操作外部工具 / 文件 / 日历。
- agent 需要**复杂、多步、不可控的 tool loop**（不是 `recall` 这种单一内部检索工具）；或需要跨端、多渠道、持久 Claude session。

在那之前，留好「薄 ModelProvider 接缝 + run 隔离字段」（支柱①②）就够了。

---

*v2 · 框架级 · 不含实现细节 · 待你 review 后再决定从哪个支柱往下扎*

