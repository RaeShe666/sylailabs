# Chirp 开发交接备忘（for Codex）

> 这份文件是给接手开发的 agent（Codex）的**自包含上下文**。读完它 + 下面两个源文档，就能开始写 M1，不需要更多背景。
> 写于 2026-05-30。
>
> **必读源文档（同目录）**：
> - `chirp-agent-architecture-framework-v2.md` —— 完整架构框架（本备忘是它的开发向浓缩，遇到细节以框架文档为准）。
> - `claude-chirp-prd.md` —— 产品/页面/视觉 PRD（注意：其中 persona 阵容、moments 模块、个人记录 UI **已作废**，以本备忘为准）。
> - `chirp-animal-system-v7.md` —— 动物人格体系（onboarding 测评 → 14 动物 5 维）。
> - `chirp-relationship-theory-research.md` —— 关系理论底座 + 安全原则。
>
> **代码仓库不在本目录**：实际 chirp 应用代码在 `C:\Users\lenovo\Desktop\side project\chirp`（React + Vite + Supabase + Node 后端，package.json 名仍叫 "brand-studio"）。本目录是设计文档区。
>
> ⚠️ **重要：旧 chirp 代码里的 persona 是临时占位，全部忽略、重新设计。**

---

## 1. 产品一句话 + 两个价值时刻

Chirp = **让用户在持续的亲密关系对话里，被一组有边界、有记忆、有不同视角的智能体看见，并逐渐看清自己。**

一切优先级回到两个价值时刻：
1. **日常价值（高频）**：用户在群里 @ 某 persona → 得到一段"像那个人、记得我、有立场"的回应。
2. **顿悟价值（低频但决定留存）**：bird 把跨时间/跨场景的碎片连成一条用户没意识到的线（"你这周第 3 次说'算了'，上次'算了'之后失眠了"），在对的时刻递出来。

---

## 2. 现阶段范围

- **只聚焦亲密关系（恋爱 / 暧昧）**这一个 planet。家庭/职场等是后期泛化，不在当前设计内。
- **3 个 persona**：**诞总**（类李诞，重点先 build，是产品口吻标杆）、**Barry**（恋爱脑，占位）、**duck**（军师，占位）。
- **先做 M1**（见 §10）。

---

## 3. 整体技术架构

```
客户端(React/Vite，微信式会话列表)
   ⇅ HTTP + SSE/WebSocket(流式)
Node 后端(薄运行时):
   ① Activation Router(控制层)：解析 @/reply → 定会话类型&planet → 决定唤醒谁/无人
        → 生成一次 run { run_id, conversation_id, planet_id, agent_id, memory_scope }
   ② Agent Runtime(Bird / Persona)：载档案 → 载允许记忆(scope) → 拼 prompt → 调模型 → 后处理 → 落库
        → ModelProvider(薄接口，默认 Claude)
   ③ Memory：常驻注入 + 最近窗口 + 模型自取 recall 工具(方案 B) + 写入(写时蒸馏 + scope 标记)
   ④ Insight Engine(异步：pattern → 候选 → About-me)
   ⑤ Trust/Privacy(横切：scope 过滤 + 不可覆盖的安全地基)
   ⇅
Supabase(Postgres + pgvector) + Anthropic API
```

**每轮回复 = 一次 chirp 自管的 run**，就是后端一次带上下文的模型调用。**不用 ACP、不用 LangGraph/Letta 等重型框架**（见 §11）。

---

## 4. 数据模型（高层实体 + 不变量）

核心实体：
- `user` —— 含**用户画像**（动物人格 + 关系状态）。
- `planet` —— 主题/角色**容器**（成员名册 + 记忆 scope + 洞察 scope）。**planet ≠ group**。
- `persona` —— **用户可创建的人格记录**（见 §6 文件结构），属于某 planet。
- `conversation` —— `type`: `group` / `persona_dm` / `bird_dm`；带 `planet_id`（`bird_dm` 为 `null` = 全局）。
- `conversation_members` —— 谁是哪个会话的成员（**成员资格 = 可见性的唯一判据**）。
- `messages` —— **单一消息真相表**（所有会话的消息；带 `conversation_id` + 个人记录标记）。
- `insight` —— `content / planet_id / topic / source_message_ids / confidence / status / visibility / created_at / updated_at / user_feedback`。
- 派生记忆 —— `daily_notes` / persona 关系笔记 / `user_profile`（加速理解，**不决定可见性**）。

**6 条全局不变量（红线，写代码时别破坏）**：
1. **可见性 = 单一 `messages` 表 + 成员资格/planet 过滤**算出。**绝不**给每个 persona 物理分库复制记忆。
2. **planet 是容器不是群**；**不要写死 `planet_id → group_id` 一对一**，一个 planet 可有多个 conversation。
3. **bird 全知**；**persona 按「成员资格 + 所在 planet」分桶**；**bird 私聊原文 persona 永不可见**。
4. **洞察按 planet 隔离分发**（恋爱 planet 洞察不给职场 planet persona）；**用户画像全量广播**给所有 persona。
5. **安全地基是系统强制层，凌驾于用户 persona 内容之上，不可被覆盖**。
6. **每轮回复 = 一次 chirp 自管 run**；现阶段不用 ACP。

---

## 5. 会话与唤醒

### 5.1 拓扑（onboarding 后落地）
- 一个 **bird 单聊**窗口（全局，`planet_id=null`）。
- 一个 **planet 群聊**窗口（成员 = bird + 诞总/Barry/duck）。
- 用户可与**任一 persona 私聊**（按需创建，第一次私聊才新增该会话）。
- 聊天层呈现像**微信会话列表**（各自独立会话线）。Home / About-me / planet 等非聊天界面是另一套。

### 5.2 唤醒真值表（由 Activation Router 统一裁决，别散在各 agent prompt 里）

| 用户行为 | Bird | Persona |
|---|---|---|
| 群聊 **无 @** 发言 | 不回（落库供理解） | 不回（在场 persona 可见为上下文） |
| 群聊 **@persona** | 不回 | 被 @ 的 persona 回 |
| 群聊 **@all** | 不回 | 3 个 persona **并行**回（同一编排 run 内并发 fan-out，稳定顺序展示） |
| 群聊 **@bird** | 回 | 不回 |
| **reply Bird 消息** | 回（=@bird） | 不回 |
| **reply persona 消息** | 不回 | 原 persona 回（=@该persona） |
| **Bird DM** 发言 | 回（且为个人记录） | 不参与 |
| **Persona DM** 发言 | 不参与 | 该 persona 回 |

- **bird 在群里只在被 @bird / reply Bird 时发言**；@all 不参与。私聊不用打 @。
- **Activation Router 职责**：解析 mentions / 判会话类型 & planet / 判 reply 指向 / 决定触发谁 / 决定是否写记忆与进洞察管线 / 控 @all 顺序去重。**口诀：Bird 是角色，Router 是控制层**。
- **并发**：一群同一时刻只允许一次可见 run；@all 是**同一次编排 run 内的并行 fan-out**——3 个 persona 并发生成、**彼此看不到同轮其他 persona 的输出**，靠 `lane_contract` / 行为地基避免重复（不演 AI 互相接话），对用户的展示/落库顺序按成员顺序稳定。用户连发用 collect（短 debounce 合并，建议 ~400ms、可调不写死）合成一轮，不要每条触发一轮。

### 5.3 「个人记录」（语义分类，不是特殊 UI，也不等于"没人回"）
- 定义 = **群里不 @ 任何 AI 的发言** + **bird 私聊的全部聊天记录**。
- @定向消息、persona 私聊 = 非个人记录。
- **不做特殊 UI**：用户正常发消息即可，分类只在后台用（喂 bird 理解/洞察）。
- 群里的个人记录：在场 persona 可见（仅存不答）；bird 私聊的个人记录：仅 bird 可见。

---

## 6. Persona（怎么 build）

### 6.1 persona = 结构化人格文件（用户可创建的数据记录，存 Supabase）
文件块：`identity` / `relationship` / `voice_style` / `boundaries` / `reply_policy` / `memory_policy` / `examples` / `lane_contract`。
- `lane_contract` 保证三人不抢戏：**诞总 = 解构/松弛/反鸡汤的视角；Barry = 共情陪伴；duck = 策略军师**。
- `examples`（few-shot）至少覆盖：普通吐槽 / 用户情绪低落 / 问关系判断 / 纠结要不要发消息 / "你怎么看我" / 让它更直接。

### 6.2 Bird 的文件结构不同（它是全局观察 + 洞察，不是陪聊）
`bird_identity` / `privacy_boundary` / `global_memory_policy` / `insight_policy` / `reminder_policy` / `about_me_policy`。

### 6.3 诞总的特别护栏（写进 `boundaries`）
- **不冒充真人李诞**、不编造其经历、不声称代表其观点——定位是"受公开脱口秀表达启发的、松弛/反鸡汤/轻轻拆穿式的朋友"。
- 不只会抖机灵；**用户脆弱时少讽刺、多轻一点**。

### 6.4 chirp 行为地基 v0（所有 persona 共享的系统强制层，比人设文案更重要）
短不绕 / 有立场但不替用户做决定 / 不复述用户长段原话 / 不复述别的 persona 刚说的 / 不解释自己是 AI / 不暴露内部路由·记忆·洞察过程 / 不用心理咨询套话 / 不过度安慰 / 不把问题升格成人生诊断 / 幽默服务理解不逃避真问题 / 脆弱时少讽刺多轻一点 / **私聊不外溢到群聊**（私聊里得知的私密·脆弱内容，同一 persona 不在群里主动带出来——可见性归 scope，"该不该说"归这条地基；借 Bloome "private facts stay in private conversations"）。

### 6.5 🔴 安全地基凌驾于用户 persona 内容
用户写的 persona 只能定**口吻/身份/车道**，**不能改安全/不诊断/隐私/记忆 scope**。用户 persona 文本视为**不可信内容**——防越权（套别人数据、越出 memory_scope、诱导有害输出、prompt 注入）。拼 prompt 时：**安全地基在外、人设在内**。

### 6.6 persona 运行流程
`Router 触发 → 载入 persona 档案 → 拼 prompt(常驻注入 + 最近窗口，按 memory_scope) → 调 ModelProvider(默认 Claude，流式) → 后处理 → 落库消息/记忆`。
**含一轮工具往返（方案 B）**：模型在本轮可按需调 `recall(query)`（scoped 便宜检索 pgvector/全文，返回原文片段，scope 在 **DB 层强制**）→ 读片段后继续写。所以 runtime 是"允许一轮工具往返的小 loop"，不是纯单次调用——但仍是 chirp 自管的轻量调用，**不引入 ACP**。

---

## 7. 记忆与可见性（§4 不变量的展开）

persona A 能看到：① A 的私聊 ＋ ② A 在场群聊的全部对话（含别人发言 + 群里个人记录）＋ ③ **该 planet 的全部洞察**（跨 planet 隔离）＋ ④ **用户画像**（全量）。
persona A 看不到：用户与别的 persona 的私聊、A 不在场的群、**用户与 bird 的私聊原文**、其它 planet 的洞察。
bird：全量（所有群、所有私聊含 bird 私聊、个人记录、画像）。

- **bird 私聊原文 persona 永不可见，但它喂 bird 洞察**；洞察本身是对对话的抽象，下发不另做泄露过滤（看反馈再说）。
- **用户画像 = 全量广播**（不分 planet）；persona 不能改写画像（切换由用户确认）。
- **召回必须带 scope 过滤**：检索 persona A 时只在「A 的私聊 + A 在场的群 + A 所在 planet 的洞察 + 用户画像」里找；bird 私聊原文、A 不在场的群、其它 planet 洞察一律排除。
- **召回方案（方案 B，M1 就做）**：三块——① **常驻注入**（用户画像 + planet 洞察 + 该 persona 关系笔记，预蒸馏免费拼）+ ② **最近 N 条** + ③ **模型自取 `recall` 工具**（Supabase pgvector + 全文，返回**原文片段、不做独立 LLM 摘要**，模型在回复 loop 里想翻才调）。**不做代码门控、不做按场景强度、群聊不特殊关**——深浅靠 scope + 模型判断自然产生（**bird-DM 与 persona-DM 召回相同**，差异只来自 scope）。重活（蒸馏成关系笔记/daily_notes）放写入时/异步；与 §8 洞察共用同一套 scoped 检索底座（实时入口 / 异步入口）。

---

## 8. 洞察引擎（M3，bird 的终点能力）

- 生成流程：`raw_messages → daily_notes → pattern detection → insight candidate → safety/privacy check(不诊断/敏感度) → dedupe/cooldown → about_me draft → 用户确认 或 被动展示`。
- 字段见 §4 的 `insight`；`planet_id` + `visibility` 是落地"按 planet 分发"的关键。
- 触达克制：低频、深夜静默、不重复刚说过的、**待确认语气**（"我注意到一个可能的模式，是这样吗？"），用户可删/改/隐藏。
- About-me 呈现方向：**bird 每天给用户写洞察日记**（细节 TBD）。

---

## 9. 信任与安全红线（关系数据，第一天就要在）

- **不诊断**：所有画像/洞察都是"当前倾向/待确认"，动物切换由用户确认。
- **可追溯/可删**：用户能看到 bird 凭哪些记录得出洞察（`source_message_ids`），并能删/改。
- **隐私靠成员资格隔离**（不是单独的私人空间页）；bird 私聊是最私密层。
- **低监控感**：bird 不在群里主动插话、不突然引用私密原文、用"我注意到一个可能的模式"而非"你总是这样"。
- 涉胁迫/自伤/暴力 → 优先转安全支持，不继续做浪漫分析。
- ⚠️ 旧 PRD 的 **moments 模块已删除**，"个人记录 AI 看不到"那条不再成立。

---

## 10. M1 开发范围 + 优先级（先做这些）

### 10.0 关键解耦：机器 vs 诞总人设（可并行，诞总不是前置依赖）
persona 是一条数据记录（§6 的 8 文件块）。"跑人设的机器"和"诞总的人设内容"是**解耦**的——用一个**占位 persona** 就能把整台机器建好、跑通、测对；诞总（由 builder 另行打磨）就绪后只是**填进 persona 记录的槽位**。**所以别等诞总，先建机器。**
- 配套：先做一个**单-persona 测试入口**（绕开完整群聊 UI，直接跟某条 persona 记录对话），让诞总调味迭代快。

### 10.1 M1 按这个序做
1. **数据模型（最先，改晚要重构）**：`planet` / `conversation`(type + planet_id) / `conversation_members` / `messages`(含个人记录标记) / `persona`(可创建记录) / `insight`；字段 `agent_role` / `listen_mode` / `memory_scope` / `reply_policy`。**4 条边界定死**：conversation 类型、membership、persona 记忆边界、bird 读取边界（改晚了要重构）。
2. **persona 记录系统**：persona 表 + 8 文件块 schema + 加载器 + 最简 seed/编辑。先塞**占位 persona** 测试（诞总将来填这个槽）。
3. **核心竖切（先证明日常价值在）**：发消息 → Activation Router（先只 @persona）→ Persona Runtime（载占位 persona + scoped 记忆 → 拼 prompt[地基外/人设内] → ModelProvider(Claude) 流式）→ 落库 + 推前端。用占位 persona 把闭环跑对。
4. **完整唤醒矩阵 + run**：严格执行 §5.2 真值表（@persona / **@all 并行 fan-out**（彼此不可见、靠 lane_contract 去重、稳定顺序展示）/ @bird / reply / DM / 群里无 @=个人记录，bird 不参与 @all）；一群一次一个可见 run；连发用 collect（短 debounce ~400ms、可调）合并；每轮回复 = 一次 run（带 run_id + scope）。
5. **聊天 UI**：微信式会话列表、三种会话、@ 选择器、流式渲染、输入框弱提示。
6. **召回三块全在 M1（方案 B，§7）**：① 常驻注入（用户画像 + 最简 persona 笔记）+ ② 最近 N 条 + ③ `recall` 工具（先直接在 `messages` 上 pgvector/全文，回复 loop 支持一轮工具往返）。**scope 过滤（DB 层 membership/planet）第一天就焊死。** 整套进 M1 是因为晚做要把回复从单次调用重构成工具 loop、且 scope/schema 本就必须第一天对（接缝问题，非功能问题）。M1 召回"形状齐、质量薄"（新用户没多少历史可翻），质量靠 M2 养——不拿"召回准不准"当 M1 验收。**M1 的资源重心是 persona 声音（诞总 / 行为地基），不是召回。**

横切：**chirp 行为地基**作为系统层（§6.4），拼 prompt 时在用户 persona 之外；**ModelProvider 薄接口**（默认 Claude，别真铺多家）；安全红线（§9）从步骤 1/3 起焊死。

### 10.2 后续里程碑
- **M2** = 记忆质量养厚（召回形状 M1 已就绪；M2 把写入侧蒸馏做厚——persona 关系笔记 / daily_notes 越来越准 → recall 质量随用量上升。不是"到 M2 才有召回"）。
- **M3** = bird 洞察引擎（**刻意不进 M1**：依赖数据积累、安全面最大、是独立难能力；复用 §7 召回底座的异步入口）。
- **M4** = 关系演化（关系阶段/私有梗/feedback）。

诞总（并行）：研究 + 写人设内容 → 填进步骤 2 的 persona 记录 → 用步骤 3 闭环对着聊迭代。**一个很好的诞总 + 干净闭环，胜过三个平庸 persona + 半成品记忆。**

---

## 11. 明确不做（选型纪律）

- **不用 ACP**：persona 是 prompt+配置不是独立进程；Web 栈用不上 stdio 协议；ACP 也不帮你做核心控制逻辑。只有将来 persona 要跑**用户自带工具/代码**（需沙箱）或要持久跨端 session 时才回到这话题，且更可能是自定义 RPC+沙箱。
- **不引入重型框架**：LangGraph/Letta（Python 优先，与 Node 栈不匹配）、Mem0、Zep/Graphiti——中后期再评估。状态编排用普通 Node 代码，记忆用 Postgres+pgvector 自研薄层。
- **功能后置**：persona 市场/收费、多渠道 gateway、agent 自装技能、云沙盒。
- **例外（现在就要建好）**：persona 必须从一开始做成"数据驱动的用户可创建记录 + 系统强制安全地基"——这是市场化绕不开的地基，补晚要重构。

---

## 12. 待定 / 开放（不阻塞 M1，记着别忘）

- bird"全知却几乎不出声"如何让用户**有感而不惊悚**（弱信号？）。
- planet 的 UI / 创建流程 / 每个主题配哪些 persona。
- About-me 如何按 planet 展示用户不同角色、洞察如何沉淀。
- 洞察触发：定时（heartbeat/cron）vs 事件驱动 vs 两者。
- 召回是否对某些高敏内容"即便可见也不主动召回"。

---

*以上为开发交接浓缩版；任何细节冲突，以 `chirp-agent-architecture-framework-v2.md` 为准。*
