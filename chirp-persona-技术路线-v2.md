# Chirp Persona / 分身技术设计 v2

> 目的：把「persona / 分身在技术上怎么搭」设计清楚，**作为 dev（Claude Code / Codex）开发用的专门文档**。它细化「chirp 架构框架 v2」的支柱②（persona）；架构框架仍是总纲，persona 这块独立在本文档。
> 两条贯穿原则：**① 少搭脚手架、多用模型本身能力；② 价值排序：功能感/价值感（多样有价值的视角）＞ 陪伴感；陪伴感来自记忆 + 产品设计，不靠情感模拟脚手架。**
> **不做（重机器，dev 别建）：** 独立 tone 模型 / 每轮单独生成 delivery / 热路径情绪 pipeline；系统级独立 query 合成模块；Eve 式 128 槽训练选槽/监控模型；按 persona 微调 / 参数化分身。（对标 → A10；Eve 飞轮取舍 → A7）
> 阅读方式：**§2 是单一事实来源**（所有字段在此定义）；§3–§8 只引用 §2 的对象、讲行为与流程，不再重列字段；论证、对照、未来项收在文末附录 A/B/C。
> 日期：2026-06-07
> **2026-06-12 更新（开发中拍定，已实现）**：① **ambient 主动发言**——群里无 @ 消息由系统选 ≤2 候选（诞总固定+第二位轮换）自判可沉默（`[SILENCE]` 标记+括号兜底），全沉默时 Router 重询诞总兜底；无用户开关。② **多气泡输出**——一次回复可拆 ≤6 条气泡（`|||` 分隔、各自落库、流式实时拆条）。③ **回复时机=输入静默触发**（2026-06-14 定，替代一度试过的 HOLD）——不在发消息时立刻回，等用户连续 2s 不动输入框（无打字/emoji/中文 composition）且框空才触发；连发同 @ 合并、不同 @ 入队、回复中再发不报错走队列。模型侧不判"说完没"（HOLD 已废，理由：语义题不准+多一次调用），只管回应整批。④ **L1 片段蒸馏上线**（distiller.js，旋钮初值见 §8）。⑤ 行为地基已单独成文（repo 根目录 chirp-行为地基-v2.md）并删除代码中重复的 REPLY_RULES 层。⑥ @多个 persona = 与 @all 同路并行 fan-out，先完成先展示。
> **2026-06-11 更新（与 builder 拍定）**：① runtime_card 优化——`voice_rules` 内嵌 2–3 条微型口吻对照例（计入硬上限），**删除独立 `reply_rules` 字段**（回复倾向并入 voice_rules，通用纪律在系统层，避免同一件事三处写）；② instance 的 `bird_insight_digest` **移除、暂不建**——Bird 洞察 / 全局长期记忆的下发形态未定，M3 前重新设计（届时倾向读时按 planet 过滤 insights，不按 instance 物化副本）；③ 群聊「车道」**不做运行时规则**——@all 并行在架构上天然互不可见，persona 差异靠人格本身（建造期设计原则），系统层保留"不复述其他 persona 刚说的"即可。

---

## 0. 开发优先级

> 先把诞总这一个官方 persona 做到"creator 和所有用户都能用"，**且带来个性化体验（personal instance + 记忆这套必须有）**。

**初期版本（先做 —— 诞总可用，我能用、别人也能用）：**
1. **数据底座（§2）**：`persona_template` / `persona_instance` / `messages` + `conversation_members` + scope / 系统层（`safety_privacy_base` + `behavior_base`）。四条可见性隔离边界第一天焊死。
2. **Runtime 组装（§4）**：stable/context/volatile 三层 → 主模型一遍写回复。
3. **recall（§5.1）**：多 query + rank merge；scope 在 DB 层强制。
4. **记忆**：L0 留痕（`interaction_event`）+ 常驻注入（基础用户画像）+ L1 片段蒸馏（写 instance 的 `user_memory` / `interaction_skill` / `affective_context`）。
5. **诞总 = 官方 template**：`catalog` + `runtime_card` + `examples` + 落 `chirp-行为地基-v2`（repo 根目录，已定稿，为系统层单一事实来源）+ **知识库（§2.1.1）+ 知识 recall**（build 诞总时一起做）。类真人护栏在系统层（§2.5），不在 persona 上写。
6. **别人能用 = §6.2 托管引用**：任意用户建 instance 引用官方 template 运行（诞总是官方 persona，**不走 §6.1 发布/审核**）。

**后面再做（不在 P0；设计已在文中，做的时候再实现）：**
- **用户创建 persona**：§6.3 调试/保存/发布、**面向用户的** Persona Asset 建造管线（诞总自己的 build 用到蒸馏，属 P0）。
- **发布到社区共享**：§6.1 社区发布 + 自动审核。
- **社区打分 / 使用统计**：§6.1 评分 / 使用量。
- **多模型路由**：§7（P0 默认 Claude）。
- **Bird 全局整理 / 洞察**：§5.4 L2、dreaming。
- **附录 C 全部**：版本 pinning / Fork / 推荐 / 付费 / 编辑历史。

---

## 1. 总览

一句话心智模型：

> **一个 persona = 一份公开的「人格资产」（template）+ 每个用户各自长出来的「关系副本」（instance）+ 一层所有 persona 共享、锁死的系统地基。** 每次回复，运行时把"稳定的资产 + 这个用户的关系副本 + 当前会话"临时组装成一个小包，交给主模型写出回复。

```
                          系统层（共享、锁死）
                    安全/隐私地基  +  行为地基
                              │（最高优先级，谁都不能覆盖）
   persona_template（公开资产）│            persona_instance（私有副本，per user×template）
   ┌──────────────────────────────┐│        ┌──────────────────────────────┐
   │ catalog      [不注入]         ││        │ user_personal_patch（滑条）   │
   │   展示/选择/路由 metadata      ││        │ persona_user_memory（陈述）   │
   │ build_asset  [不注入]         ││        │ persona_interaction_skill(程序)│
   │   source/蒸馏/examples/知识库  ││        │ affective_context（情绪-关系） │
   │ runtime_card [每轮注入]→稳定层 ││        │ relationship_stage            │
   │   常驻短卡（从 build_asset 编译）││        │（Bird 洞察下发形态 M3 前定）   │
   └──────────────────────────────┘│        └──────────────────────────────┘
                              ▼
        每轮 runtime 组装：稳定层(系统地基+runtime_card) + 上下文层(画像+洞察+instance) + 易变层(最近窗口+recall+实时信号)
                              ▼
                          主模型一遍写出回复
```

三对象的硬边界：**template 绝不含用户隐私；instance 是隐私所在；系统层凌驾两者。**

---

## 2. 数据模型（单一事实来源 · 字段级设计；SQL 类型/索引/约束由实现定）

> 本节是全文唯一定义字段的地方；后面各节只引用这些对象名，不再重列字段。
> **§2 是完整目标数据模型；P0 只实现初期需要的对象/字段（见 §0），后面才做的字段（发布/评分/saved-published 版本等）随对应功能再加，P0 不预建。**

### 2.1 `persona_template`（公开资产，无任何用户隐私）

```
persona_template

  # ── catalog：仅供展示 / 选择 / 路由 —— [不注入] 回复 context ──
  catalog:
    template_id               # persona 唯一 id
    name                      # 名字（如"诞总"）
    short_intro               # 一句话公开简介：它是谁、擅长什么、适用什么场景（适用场景写在这句里，不另设字段）
    avatar                    # 头像
    creator_id                # 创建者
    creator_type              # 谁建的：official | user | community
    persona_kind              # 类别：real_person_inspired(类真人) | expert(专家型) | original_companion(原创陪伴)；决定护栏与素材路线
    model_preference          # 默认走哪个模型，给 model router 用，不进 prompt（§7）
    visibility                # private | public
    publish_status            # draft | submitted | published | rejected（社区发布态，§6.1）
    published_version         # 当前社区运行的版本号（递增、只保留当前一份，§6.3）
    rating_avg                # 社区评分均值（§6.1）
    usage_count               # 使用量：用户首次使用即 +1（§6.1）
    # 注：persona 在哪个 planet = 成员关系，由 planet 成员名册承载（§2.4），不在 template 上存 planet_id

  # ── build_asset：构建 / 编辑 / 蒸馏 / 评测用 —— [不注入] 回复 context；服务端 / creator 私有，不随社区使用分发（§6.2）──
  build_asset:                # = creator 的"已保存"内容；调试模式编辑这里（§6.3）
    saved_version             # 已保存版本（creator 私有可用，§6.3）

    source_pack               # 素材出处（identity / domain 两路）；记录存 persona_source 表（§2.1.1），template 不内嵌大正文

    distilled_profile:        # 从 source 蒸馏、creator 审校；每条挂 {source_refs, confidence, coverage_gap}
      identity_core           # 是谁 / 不是谁
      worldview               # 怎么看人、关系、痛苦、选择、失败
      value_lens              # 判断事情的底层标准
      voice                   # 词 / 句式 / 节奏 / 幽默方式 / 禁用表达
      signature_moves         # 招牌动作 / 套路
      anti_patterns           # 什么会让它变 generic
      domain_model            # "懂"的结构：概念 / 框架 / 案例模式 / 常见误区 / 干预手法 / 建议边界
      examples[]              # 好 / 坏对照 few-shot（尽量取自真实素材）

    knowledge_base_id         # 指向该 persona 知识库（独立存储，§2.1.1）；template 不内嵌 chunk/embedding

  # ── runtime_card：从 build_asset.distilled_profile 编译出的"常驻短版" —— [每轮注入] §4 稳定层 ──
  runtime_card:
    identity_summary          # 它是谁（一句话）
    value_lens_summary        # 它判断事情的底层标准（短版）
    voice_rules               # 怎么说话：句式 / 节奏 / 幽默 / 禁用表达 / 回复倾向 + 内嵌 2–3 条微型对照例（口吻锚点，计入硬上限）
    core_framework            # 这个领域"怎么想"的核心判断框架（常驻，不靠 recall）
    knows                     # 它懂什么
    not_knows                 # 它明确不懂什么（超纲承认用）
    memory_usage_rules        # 怎么用 instance 记忆
    # 2026-06-11：原 reply_rules 字段删除——回复倾向并入 voice_rules；通用纪律在系统层（同一件事不三处写）
```

**runtime_card 编译纪律：** 从 `build_asset.distilled_profile` 编译生成，**有硬 token 上限（短、稳定、可缓存；初值建议 ~800 token，可调）**；带一个 **compile hash**（供 §4 hash-gate 判断缓存是否失效；系统内部值，非 creator 字段）。**只含上面列出的字段；不含 `catalog` / `source_pack` / `distilled_profile` 全文 / `examples` 全集（仅 voice_rules 内嵌的 2–3 条微型例除外）/ 知识库 / 社区统计** —— 防每轮注入越写越长。

### 2.1.1 persona 知识库（`build_asset.knowledge_base_id` 指向；独立存储，不内嵌 template）

> 知识库会很大、要单独检索/更新/软删，所以外置成表，template 只引用 id。raw 片段与蒸馏知识都存。

```
persona_knowledge_base
  knowledge_base_id
  template_id

persona_source              # 素材出处：元数据 + 指针，不存大正文
  source_id
  knowledge_base_id
  source_kind               # identity | domain
  type                      # interview | transcript | book | methodology | case | paper | course | …
  title
  origin
  url_or_file
  copyright_scope           # 版权/公开权限（商业化字段不在当前范围，附录 C）
  reliability
  is_active

persona_knowledge_chunk     # 切分 + 蒸馏后的可检索单元（raw 与 distilled 都存）
  chunk_id
  knowledge_base_id
  source_id
  chunk_type                # raw_excerpt | distilled_claim | framework | case_pattern | example_dialogue
  content                   # 短片段
  tags[]
  source_refs[]             # 可追溯
  embedding                 # pgvector（HNSW 索引）
  search_text               # 全文 / tsvector（GIN 索引；命中人名 / 书名 / 概念名）
  is_active
```

**检索（走 §5.1 统一 recall，不另起工具、不要 intent）：** 先按 `knowledge_base_id + is_active` 缩到这个 persona 的库（DB 层 scope），再 hybrid —— 多 query → 向量 + 全文 → rank merge（RRF）→ 去重 → 返回 3–5 个短片段。规则照 §5.1：模型自取（领域知识/具体方法论才查、情绪陪伴不查）、每轮至多一次、token 有硬上限、召回不到用人格口吻承认不懂、不编造。
**索引：** `embedding` 建 HNSW；`search_text` 建 GIN；`(knowledge_base_id, is_active, chunk_type)` 建 btree 先缩 scope。当前用 Supabase + pgvector，不上独立向量库。
**中文：** 先向量为主，全文检索只用于命中人名/书名/概念名、tags 辅助；不一开始钻中文分词，量大了再加 tokenizer / 外部搜索。

### 2.2 `persona_instance`（私有副本，主键 = user_id × template_id）

> 用户隐私与"这个 persona 怎么陪这个用户"全在这层。**`user_personal_patch` 就是这里的一个字段。**

```
persona_instance
  instance_id
  user_id
  template_id
  # 不存 planet_id：scope 由 conversation_members 算（§2.4）

  user_personal_patch         # 用户拖滑条的偏好（显式、可见、可随时改；只由用户改）
    directness                # 直接 ↔ 委婉
    warmth                    # 冷 ↔ 暖
    humor                     # 幽默/讽刺 强 ↔ 弱
    reply_length              # 短 ↔ 长
    avoid_topics[]
    address_style             # 称呼/语气

  persona_user_memory[]       # 陈述性：用户事实/反复模式；{text, source_message_ids, confidence}
  persona_interaction_skill[] # 程序性：怎么陪这个用户（模型从对话沉淀）；{text, source_message_ids, confidence}

  affective_context           # 情绪-关系态（NL 为主 + 少量结构化；会衰减）
    summary
    response_need
    sensitivity
    confidence
    evidence_message_ids[]
    expires_at

  relationship_stage          # 关系阶段（M4 演化用，先留口子）
  # 2026-06-11：原 bird_insight_digest[] 移除、暂不建——Bird 洞察/全局长期记忆下发形态未定（M3 前重新设计）；
  #   届时倾向读时按 planet 过滤 insights 表（对齐框架"可见性由过滤算出、不复制"红线），除非性能需要才物化

  # 注：私聊/群聊原文不复制存这里——统一走 messages 表 + scope 过滤（见 2.4）
```

### 2.3 轻量记录：`interaction_event` / `persona_rating` / `publish_review`

```
interaction_event
  event_id
  user_id
  planet_id
  conversation_id
  conversation_type             # dm_bird | dm_persona | group
  speaker_id
  message_ids[]
  created_at
  # 可见性从 conversation_members 派生、不在事件上快照（避免漂移）
```

```
persona_rating          # 社区评分：每用户对一个 persona 一条、可更新
  user_id
  template_id
  score
  updated_at

publish_review          # 只存最近一次自动审核结果
  template_id
  status                  # passed | failed
  reason
  created_at
```

### 2.4 `messages` / `conversation` / scope（沿用架构框架 v2，不变）

- 所有消息进**单一 `messages` 表**（`conversation_id + sender_id + sender_type`）；`conversation_members` 决定成员资格 = 可见性。
- 某 persona 可见记忆 = `WHERE conversation_id IN (它是成员的会话) ＋ 它的 DM ＋ 它所在 planet 的洞察 ＋ 用户画像`；bird 全量。
- scope 在 **DB 层 WHERE 强制**，不靠 prompt 自觉。recall（§5.1）按此 scope 检索。

### 2.5 系统层（不属 template/instance；所有 persona 共享、锁死）

```
safety_privacy_base   # 不诊断 / 危机转向 / scope 可见性 / 隐私 / 类真人护栏（不冒充真人本人·不编造其私人经历·不声称代表其观点；对所有 real_person_inspired persona 生效）
behavior_base         # chirp 版 PRE_SEND_SCAN：短 / 有观点不谄媚 / 静默记忆 / act-don't-narrate /
                      #   脆弱时收锋芒 / 连发短句当一段读 / 不刻意补台合唱 …（✅ 已单独成文：repo 根目录 chirp-行为地基-v2.md，三档标注 🔒/🔧/💡，该文档为单一事实来源）
```

用户与用户 persona 内容**都不能覆盖**这层；`behavior_base` 由 builder 维护、低频更新。

### 2.6 Bird 侧产物（全局合成，按 scope 下发）

```
planet_daily_diary
relationship_weather
about_me_insights
global_user_profile_update
persona_visible_digest        # 唯一过给 persona 的（摘要，非 Bird DM 原文）
```

### 2.7 总表：谁存什么 / 谁能改 / 运行时注入到哪层

| 对象 / 字段 | 存哪 | 谁写 | 运行时注入层（§4） |
|---|---|---|---|
| safety_privacy_base / behavior_base | 系统层 | builder（锁死，用户/persona 不可改） | 稳定层 |
| template.runtime_card（core_framework/voice/边界…） | template | creator + 蒸馏管线编译 | **稳定层（每轮注入）** |
| template.build_asset（source_pack/distilled_profile/examples）+ 知识库（§2.1.1，外置、id 引用） | template | creator + 蒸馏管线 | 不注入（知识库可按需 recall） |
| 基础用户画像（动物人格+关系状态） | 用户级（onboarding/bird 维护） | bird/系统 | 上下文层（所有 persona 可见） |
| Bird 洞察（下发形态待定，暂无 instance 字段） | 倾向：读时按 planet 过滤 insights 表（M3 前定） | bird | 上下文层（M3 设计时定） |
| user_personal_patch | **instance** | **用户（拖滑条）** | 上下文层 |
| persona_user_memory / persona_interaction_skill | **instance** | 模型（片段蒸馏，§5.2） | 上下文层 |
| affective_context | **instance** | 模型（片段蒸馏，§5.2） | 上下文层 |
| messages（原文） | 单一 messages 表 | 各方发言 | 易变层（最近窗口）+ 按需 recall |
| interaction_event | 留痕表 | 系统（每轮，无 LLM） | 不注入（给蒸馏当锚点） |
| template.catalog（name/intro/creator/kind/model_preference/visibility/publish_status/rating/usage…）+ persona_rating | template / 评分表 | creator + 系统审核 + 用户评分·使用 | 不注入（展示/选择/路由，见 §6.1） |

---

## 3. 人格分层 = 进化分层（3 组 6 层 + 优先级）

各层更新方式 / 权限 / 运行时位置不同（字段定义见 §2）：

| 组 | 层 | 对应 §2 对象 | 谁改 / 多久 | runtime 位置 |
|---|---|---|---|---|
| **系统地基**（共享、锁死） | 安全/隐私地基 | `safety_privacy_base` | builder，锁死、谁都不可覆盖 | 稳定层 |
| | 行为地基 | `behavior_base` | builder 维护，低频；用户不可改 | 稳定层 |
| **人格底座**（Template） | 人格底座 | `runtime_card`（编译自 `distilled_profile`） | creator + 蒸馏，低频 + 评测 | 稳定层（distilled_profile 本身不注入） |
| **针对该用户**（Instance） | 用户 patch | `user_personal_patch` | 用户手动（滑条） | 上下文层 |
| | 互动技能 | `persona_interaction_skill` | 模型异步蒸馏 | 上下文层 |
| | 用户记忆 | `persona_user_memory` | 模型持续写 | 上下文层 |

**优先级（组装/冲突时，dev 照此）：** 安全/隐私地基 ＞ 行为地基 ＞ 人格底座 ＞ 用户 patch ＞ 互动技能。前两层锁死、不可突破；Instance 三层只在人格底座**之上**做"针对这个用户"的调校，不改写底座。同维度冲突 **patch（用户显式）＞ interaction_skill（模型推断）**。

两条提醒：
- "今天用户崩了所以收敛"不是改任何一层，是主模型当轮的**表达调整**（§4 / §5.3），不单独成层。
- `affective_context` 是 instance 的运行状态、注入上下文层，**不是人格层**，故不在上表。

---

## 4. Runtime：每轮怎么组装（stable / context / volatile 三层）

人格稳定，**信息包每轮重建**。三层（字段都来自 §2）：

```
[稳定层 · 可 prompt-cache]
  safety_privacy_base + behavior_base + template.runtime_card

[上下文层 · 预蒸馏免费注入，hash-gate 缓存]
  基础用户画像（onboarding；所有 persona 可见）
  Bird 洞察（M3；下发形态待定，倾向读时按 planet 过滤，暂无 instance 字段）
  instance.user_personal_patch
  instance.persona_user_memory + persona_interaction_skill + affective_context

[易变层 · 每轮新]
  当前会话最近 N 条（messages）
  模型自取 recall(query) 拉回的片段（记忆 + persona 知识，见 §5.1 / §6）
  实时信号（如：是否深夜）
```

**表达不单独成层：** 不预先生成 delivery/语气指令。主模型据上面的 affective_context + 实时信号 + behavior_base **一遍写出带合适表达的回复**；脆弱→收敛、深夜→更轻这类安全关键适配由 behavior_base 硬规则强制，不改底座。

**persona 到底能拿到什么（防"全量广播"误读）：** ① 基础用户画像——所有 persona 可见（唯一"广播"的一份）；② bird 洞察——按 planet/visibility 下发、跨 planet 隔离；③ Bird DM 原文——永不下发。

> 实现纪律：稳定层 byte 稳定以命中 prefix cache（patch/记忆变化只动上下文层，hash-gate 决定是否重注入）；重活（蒸馏/compression）全在写入侧/异步，回复路径只读（取舍 → A2）。

---

## 5. 记忆设计（读 / 写 / 情绪）

骨架 = 方案 B「模型自取」；贯穿原则 **最小充分**（context 尽可能小、尽可能够）。

### 5.1 读：常驻注入 + 模型自取 recall

- **常驻（主动记忆，不靠 query）**：上下文层那几样预蒸馏短 digest，每轮免费带。不训练 Eve 的「128 槽 + 选槽小模型」，用预蒸馏达到同样"主动带背景"的效果。
- **recall（被动召回，模型自取）**：`recall(query)` = 多路向量 + 全文 → rank merge（如 MRR）→ 返回原文片段；scope 在 DB 层强制。
  - **规则：生成回复时模型自己判断"这轮要不要翻旧账"——要才调、不要就不调，不是每轮自动召回。** 大多数轮次靠常驻 digest + 最近窗口就够。
  - 隐晦表达（"又来了"）由模型在 loop 里**自己合成 2-3 个补充 query**，不另起 query 合成模型。
  - 同一个 recall 工具也用于 persona 知识库（§6），只多一个"来源=persona 知识"维度。

### 5.2 写：每轮留痕 + 按片段异步蒸馏（三层链路）

**原则：回复先走、记忆后写；每轮只留痕，不每轮复盘。** 写永远后台异步、不挡回复。会话内连贯靠最近窗口免费拿，长期记忆只为跨会话——攒一段蒸馏一次。

- **L0 · 留痕（每轮，无 LLM）**：存 `messages` + `interaction_event`（§2.3）。账本不是记忆，给蒸馏当锚点。
- **热路径只做**：最近窗口 + 短 digest +（模型判断要翻才调的）少量 recall → 回复 → 存 raw + event → 入队。
  **不做**：LLM 复盘 / 长期写 / Bird compression / 读 scope 外原文 / @all 串行等其它 persona。
- **L1 · persona 片段蒸馏（per instance，异步，低频）**：
  - 触发 = **停顿（idle 几分钟）或 轮数封顶，谁先到算谁**；不做"强信号即时触发"。
  - **轮数封顶 ≤ 最近窗口**：保证任何一条消息滚出窗口前已先被蒸馏进长期记忆，否则掉进"窗口没有、记忆也没有"的缝（例：窗口 30 则封顶设 ≤20）。
  - 只读自上次以来的新段落，写**短 delta**进：`persona_user_memory` / `persona_interaction_skill` / `affective_context` / `bird_insight_candidate`（推给 Bird）。`user_personal_patch` 不在此列（用户手动）。
- **L2 · Bird 全局整理** → §5.4。
- 写入纪律：durable/specific/future-leverageable 三关、distill 不 transcribe、相对时间转绝对日期、**静默写静默召回**。

> `persona_user_memory`（陈述性，关于用户）vs `persona_interaction_skill`（程序性，怎么陪）是两类、分开存；后者把"用户的风格纠正/不满"沉淀成可复用陪法（为什么叫"技能"→ A4）。

### 5.3 情绪 = 实时感知并行系统 + 参与漏斗（✅ 2026-06-14 重构）

调研（Tolan 把情绪做成实时并行信号；Inner Thoughts 的内在动机；多方轮替的毗邻对义务）后，把情绪从"滞后异步底色"升级为**实时并行系统**，并用它驱动"谁该回"。代码：`perceptionLayer.js` / `participation.js` / `emotionStore.js` / `chirp_emotion_state` 表。

**① 共享情绪感知（每轮一次，不带人格，便宜模型 DeepSeek）** — `perceiveTurn`
读"用户这一轮的状态"——情绪是**用户的客观事实**，一轮算一次、所有 persona 共用。输出结构化：`{emotion_summary, valence, intensity, vulnerability, intent, hidden_insight(用户自己看不到的、情绪之下的洞察), addressed_to, is_question, continues_thread_of, emotional_bid}`。读最近窗口 + 上一轮情绪状态（`chirp_emotion_state` 按 user×conversation 存）做轨迹推理，写回该表（常驻、每轮刷新）。在前端 2s 输入静默窗内并行预跑 → 近零延迟。**取代旧的滞后 affective_context**（distiller 仍写该字段但运行时不再读，属待清理死数据）。`hidden_insight` 是 **persona-facing**（喂回应、不给用户看），和 Bird 的 user-facing 洞察分开。

**② 参与漏斗（无 @ 时；每 persona 各自判，分散式）** — `participation.js`
拿共享情绪 + 自己的人格卡，依次过两闸（过了就必回，不存在"可回"）：
- **义务闸**（任一成立→必回，跳过动机闸）：①续聊（接我的话/继续我正持有的话题，结构化命中 `continues_thread_of==我`）②指向（没@但冲我来）③提问（问句且我最该答）④情绪求接（emotional_bid 且我是该接住的那个）。①②由代码结构化判定（零模型调用）；③④由便宜模型带本人卡判。
- **动机闸**（义务闸沉默才走，**一个整体判断**）：以本人人格读这条+共享情绪，**是否真的想回 / 觉得值得回**（少架构、靠模型）。
- **让位**：消息明显在续/指向别的 persona 时，非本人默认不抢，只在动机真有才说。**砍掉旧的"硬挤一句"兜底**——义务闸保证单人房实质消息至少落到话题持有者；纯噪音则全沉默（正确）。

**③ 表达** = 活下来的 persona 跑完整回复（贵模型），共享情绪 + hidden_insight 注入上下文层调"怎么说"；安全适配仍由 behavior_base 强制。

**④ 私聊（DM）= 这一整套去掉"过闸"那一层（2026-06-15）。** 私聊是 1v1，不存在"要不要参与"的问题，所以 **persona_dm / bird_dm 跳过参与漏斗，那个 persona/bird 永远直接回**。① 情绪感知仍跑、仍注入回复调语气；但因为不过闸，**DM 的感知是"轻量版"**——只要情绪那半边（`emotion_summary / valence / intensity / vulnerability / intent / hidden_insight`），**不再算结构信号**（`addressed_to / is_question / continues_thread_of / emotional_bid`，这些只服务群聊漏斗）。代码：`perceiveTurn({includeStructural:false})`，由 `chirp.js` 按 `isDM` 传入。③ 表达引擎与群聊完全一致。一句话：**私聊 = 群聊 − 过闸 −（感知里的）结构信号**。

**回复时机**（何时触发这一整套）= 前端输入静默：连续 4s 无输入活动且输入框空才触发（§见行为地基"回复时机"），模型不判"说完没"，HOLD 协议已废弃。

### 5.4 L2 · Bird 全局整理（compression / dreaming）

全局压缩（删低价值/去重/解矛盾/抽跨会话跨场景模式）**归 Bird**（唯一全局读者），**idle/阈值触发（不写死"每日"）**，产出 §2.6 那几样；**只有 `persona_visible_digest` 过给 persona，原文永不下发**。
**边界：** 只有"全局压缩 + 跨场景洞察"归 Bird；persona 自己那条 §5.2 片段蒸馏（user_memory/interaction_skill）仍按 instance 自跑（时序/对应物 → A6）。

---

## 6. Persona Asset：怎么从素材"建厚" + 用户建造流程

**核心：persona 是从素材蒸馏的资产，不是手写 prompt（依据 → A8）。** 各部分字段已在 §2.1（含 §2.1.1 知识库）定义，这里讲怎么生产它们。

**生产管线（官方走全程，用户轻量起步）：**

```
Source Pack（素材：身份两路 + 领域两路）
  → 蒸馏管线（chunk → LLM 抽取 distilled_profile，每条挂 source_refs/confidence/coverage_gap；creator 审校）
  → 产出 runtime_card（常驻短版） + 知识库（persona_knowledge_chunk，建 embedding/索引，§2.1.1）
  → 评测（官方内部 / 用户靠社区，见下）
```

- **"懂"的运行机制（不是代码规则）**：常驻 `runtime_card.core_framework` 扛大多数对话；需要细节时**模型自己判断**去**知识库**（§2.1.1）recall（同 §5.1 工具），**用 value_lens + voice 消化后说，绝不引用式报告；超纲用人格口吻承认不懂、不编造**。
- **两类 persona 都装得下（同一套资产、不同厚度）**：类真人 = 厚身份语料 + 真人护栏；原创专家 = 薄身份 + 厚领域知识库。
- **不做按 persona 微调**：走"丰富素材 + 检索接地"（理由 → A8）；旗舰官方远期可选试。

**用户建 persona 的流程（低门槛、靠对话；后面再做，不在 P0）：**

1. **建初版**：给意图 + 丢点素材 → 蒸馏出初版，立刻能聊。
2. **调试调教**：进调试模式跟它聊、用自然语言说想怎么调；模型生成 preview 改动，保存后写入 `saved_version`（creator 自己即用；机制与约束见 §6.3）。
3. **发布社区**：把 `saved_version` 提交发布 → 自动安全审核 → 通过即公开（§6.1 / §6.3）。
4. **社区反馈**：范围 = 评分 + 使用量（文字评价/付费/推荐为未来，见附录 C）。
5. **持续优化**：builder 看反馈，回去接着对话调教。（动力、为何不卡发布前测试 → A8）

**质量怎么判**：官方靠上线前内部人评（不对外做成徽章/认证标识）；用户靠社区评分/使用量，平台不盖章。

> **建造态 vs 使用态分开**：creator 调教改的是 **template**（它是谁、懂什么）；别的用户日常聊只改**自己的 instance**（怎么陪他），不影响别人用的版本。

### 6.1 社区发布与自动审核（后面再做，不在 P0）

creator 可把自建 persona 发布到社区。**这块做时**范围 = 最小发布链路 + 一次自动安全审核 + 评分 + 使用量。**前台不提供"官方认证 / 官方背书"类标签。**

**发布链路：** creator 把 persona 从私有提交发布 → 系统跑一次自动安全审核；通过 → 公开可见，失败 → 保持私有、creator 改后可重新提交。

**字段（`persona_template`，见 §2.1）：**
```yaml
visibility: private | public
publish_status: draft | submitted | published | rejected
published_version          # 当前社区运行版本（§6.3）
rating_avg
usage_count
```
状态流转（固定）：
```
draft → submitted → published
              └────→ rejected → submitted
published → draft          # creator 主动取消发布
```

**评分 / 使用量：**
- 评分：每用户对一个 persona 一条、可更新 —— `persona_rating { user_id, template_id, score, updated_at }`；聚合写回 template 的 `rating_avg`。
- 使用量：用户首次使用某 persona（生成 instance）时 `usage_count += 1`。
- 评分与使用量公开展示（简单展示/排序即可）。

**自动安全审核（只判断能否公开分发，不判断好不好用）** —— 查：欺诈/诱导转账·站外交易；涉黄·性剥削·未成年人风险；仇恨·暴力·自伤诱导；医疗/法律/金融确定性高风险建议；冒充真人本人/伪装真人授权；使用未授权私聊·隐私·他人个资；明显诱导过度情感依赖；prompt injection·诱导越权读其它用户/persona 记忆。结果只存最近一次（`publish_review`，见 §2.3）。

**管理员权限：** 管理员**只能把已发布 persona 改回不公开**（`publish_status → draft`），**无删除权限**。

（不做项 / 申诉 / 未来社区能力 → 附录 C）

### 6.2 社区使用 = 托管引用（不是 template 全量分享）

> **托管引用机制（instance 引用官方 template）属 P0**——诞总等官方 persona 的使用方式；**"社区共享用户自建 persona" 属后面**，但走同一套机制。

用户点"使用"某 persona = 系统为他建一条 `persona_instance` 引用原 `template_id`（**不复制 template**）。运行时由平台**服务端**读该 template 的 `runtime_card` + 按需 recall 其知识库生成回复；用户记忆写进他**自己的 instance**。

- **能用到：** persona 完整运行能力（行为 / 口吻 / 知识）。
- **资产不出平台：** `source_pack`、原文 chunk、embedding、完整 `distilled_profile`（含 examples）、`publish_review`（审核记录）都是服务端 / creator 私有，前台不展示、不可下载 / 复制。
- **片段不以数据形式下发：** 知识库片段不会以原始 chunk / source / embedding 的形式返回客户端；模型只输出最终回复，且**回复不得大段复述受限素材**（接 §6「用口吻消化、绝不引用式报告」）。
- **当前只做 Use（托管引用）；Fork（复制可公开部分另起 template）是未来（附录 C）。**

**素材使用权限**因此退化为 build / 发布期的轻量检查（creator 上传时确认有权用于构建；§6.1 发布审核已含"使用未授权素材"项），**不做细粒度权限枚举、不建 `usage_rights` 类字段**。

### 6.3 调试 / 保存 / 发布 + 版本（用户自建 persona；后面再做，不在 P0）

**两个持久版本：**
- `saved_version`：creator 保存的版本，**creator 自己可用**（私有，不进社区）。
- `published_version`：发布（过审）后社区运行的版本；**编号递增、只保留当前一份**（其他用户 instance 托管运行，§6.2）。

**调教（仅 creator / owner；用户侧只做对话）：**
- 试聊 + 用自然语言说想怎么调；模型生成**未保存的 preview 改动**，临时编译 preview `runtime_card` 供继续试聊。
- **保存**：preview → 合并进 `saved_version`，重编译 saved `runtime_card`；creator 自己即用。**不审核、不进社区。**

**模型改动约束（系统强制，不靠模型自觉）：**
- **受限编辑面 + 可写白名单**：模型只能写 `distilled_profile` 的 `identity_core` / `worldview` / `value_lens` / `voice` / `signature_moves` / `anti_patterns` / `domain_model` 描述 + `examples`；编辑操作 schema 只暴露这些字段，**白名单外的写入在写入层丢弃**。
- **不可达字段**（不在编辑面内，模型无法触达）：`catalog` / `publish_status` / `creator_id` / 版本号 / `source_pack` 来源元数据 / `runtime_card` / 系统安全层（§2.5）。
- `runtime_card` 只由编译器生成，无模型写入路径。
- **来源强制**：新增 knowledge chunk 必须带 `source_ref`，**无来源写入被拒绝**；`source_pack` 来源对模型只读、不可伪造。
- 系统安全层锁死不可改。
- `catalog`（名字/简介/头像）等只通过**明确设置动作**改，不走对话调教。

**发布：** 取 `saved_version` → §6.1 自动安全审核 → 通过 → 替换 `published_version`（重编译，编号 +1）→ 在用 instance 用新版（§6.2）+ "已更新"提示。审核期间旧 `published_version` 保持 live。

**build vs use：** 调教仅 creator；end-user 反馈只改自己 instance（滑条 / `interaction_skill`，§2.2），不改 template。

---

## 7. 多模型路由（后面再做；P0 默认 Claude）

`persona_template.model_preference` 指定默认模型（如 诞总→Claude，仅示例）；统一 model router 运行时按偏好选模型，prompt/context 各自独立组装、底层调用共用。**现阶段默认 Claude、不真铺多家**——只留 ModelProvider 薄接缝 + `model_preference` 字段。

---

## 8. 里程碑与未定项

**已定（按此实现）：** Template/Instance/系统层三对象（§2）；affective_context 不每轮单独生成 delivery（§5.3）；多 query 召回放 M1（§5.1）；persona 知识 recall 复用 §5.1 同一 recall 工具（加"来源=persona 知识"维度）；user_patch（instance 字段）与 interaction_skill 为两条独立机制、冲突时用户滑条优先。

**里程碑 / 优先级：** 见 §0（初期 / 后面再做）。

**实现细节未定（TBD，需补、勿猜）：**
- `runtime_card` 的编译方式（`distilled_profile` → `runtime_card`）。
- 蒸馏管线细节（source → `distilled_profile` + knowledge chunk 的切分 / 抽取 / 校验）。
- 自动安全审核的实现方式（§6.1）。
- 基础用户画像（动物人格 + 关系状态）：定义在 动物系统 v7 / 架构框架，本文档只引用。
- ✅ 数值旋钮已定初值（2026-06-12，全部可调）：runtime_card 上限 ~800 token；最近窗口 16 条；L1 触发 = idle 5 分钟或 5 轮封顶（先到算谁，<3 条新消息跳过）；user_memory 封顶 30 条、interaction_skill 20 条；affective_context ttl 2–72h（默认 24）；recall top 5（多 query ≤3 + RRF 合并）；前端收集窗口 1.2s/悬句 2.6s/打字顺延上限 8s。
- 实现状态注（2026-06-12）：recall 的向量路径留插口（embedding 选型后接入），P0 以全文检索 + 多 query RRF 跑通；L1 已上线写 instance 三字段；L2/Bird 洞察未动。

---

## 附录 A · 设计依据与取舍

**A1. 与架构框架 v2 的衔接.** 框架 v2 §2.3「persona — 用户可创建的人格记录」拆成 template + instance；§3bis 成员资格/scope 过滤照旧，scope 锚在 instance。

**A2. runtime 三层、虚拟 workspace 的取舍.** 稳定层 + 上下文层 = Bloome/Claude Code 式「文件即记忆、免费注入」，零延迟可缓存；affective_context 与召回素材的重活挪到写入/异步（"考前备好笔记，开考想翻才翻"）。不做物理 workspace：用户会建很多 persona，目录/生命周期会爆炸；多 persona 各自真 runtime 调度复杂；多模型用 router 解决；chirp persona 是对话人格、不需工具账号与文件系统。

**A3. 召回与原版差异.** Tolan 系统每轮自动 embed + 合成问题多路检索；chirp 把"合成 query"放进主模型 loop（省一层模块）、"主动背景"放进常驻层（省训练选槽）。洞察照搬、重机器不搬。

**A4. 为什么是「技能」不是「记忆」（Hermes 源码确认）.** Hermes background review 两条独立复盘：`_MEMORY_REVIEW` 写陈述性记忆（who the user is），`_SKILL_REVIEW` 写程序性技能（how to do this class of task for this user）。**用户的风格纠正/不满是 first-class skill 信号**，落进"怎么陪"的技能、下次开局就已改好。机制：每轮后 fork daemon、继承缓存 system prompt 命中同一 prefix cache（约省 26%）、只放开 memory/skill 工具、主对话与 cache 不碰、按轮 cadence（默认每 10 轮）；另有 curator 闲时做技能库合并/归档（只归档不删）。

**A5. 情绪轻方案为什么够.** 拿到 Tolan「情绪可跨轮、表达随情绪收放」的核心，又不训练情绪模型、不每轮单跑 delivery：chirp 功能感>陪伴感，每轮情绪微调非核心卖点（那是 Tolan 语音实时的命门）；安全关键适配已由 behavior_base 硬规则强制。

**A6. compression 归 Bird 的时序/对应物.** Bird 全局 compression 是慢活、M2+ 再上；§5.2 per-instance 复盘从早期就有。对应：Tolan nightly compression / Claude dream / Eve Echo / Second-Me L1。

**A7. Eve 飞轮留口子.** "监控哪些记忆真被用到 → 越选越准"很值，现阶段做成**离线评测**（看召回命中/被引用率优化常驻层与召回），不做运行时训练模型。

**A8. Persona Asset 为什么这么定.** ① 丰富素材 >> 抽象人设：Stanford《Generative Agent Simulations of 1000 People》用 2 小时访谈逐字稿注入做行为分身，归一到人类自身 test-retest 一致性约 85%（注意是归一值、非绝对"像真人 85%"），访谈式显著优于属性式；Character-LLM 用"经历重构"验证"素材→人格"但走微调（重，chirp 不走）。② 有知识 ≠ 会用知识：Memory-Driven Role-Playing / MREval 评 Anchoring/Recalling/Bounding(不乱编)/Enacting(用人格演出来)——故"核心框架常驻 + 细节按需 recall + 用口吻消化 + 超纲承认"，而非把知识列进 template。③ 产品反证：Bloome 名人分身是服务器端手写薄人格 + 行为引擎、没有"语料→知识"层，只能像口吻、达不到"真的懂"；Second-Me 才把语料加工成样本（厚）。④ 不微调：丰富素材注入即可高保真，微调无法 scale 到用户自建。⑤ 用户激励：创作者经济（被用、口碑、收费），故调教必须低门槛（对话式），质量交给市场而非合成测试。

**A9. 调试/保存/发布 的取舍.** 不用 builder_patch 表：`saved`（草稿）与 `published`（live）分离本身就是沙箱——改 saved 不影响在用的 published，等于 patch 提案的安全性、但更简单；模型乱改靠**受限编辑面 / 白名单系统强制**（不靠 prompt 自觉）。A（发布即生效）不做版本 pinning：pinning 要保留多版本快照 + per-instance 钉版，是初期不必要的复杂度——故只递增编号、只留当前一份，新版过审后自动替换 + 提示；pinning 留未来（附录 C）。

**A10. 抄思路对标（各家洞察 → chirp 轻实现 / 不抄的重机器）.** 开头原则区只留"不做清单"，对标如下：

| 来源洞察 | 抄（轻实现） | 不抄（重机器） |
|---|---|---|
| Tolan 情绪处理 | affective_context（理解层）+ 主模型一遍写表达 | 独立 tone 模型、每轮单独生成 delivery、热路径情绪 pipeline |
| Tolan 多 query 召回 | 主模型 loop 内合成 query + 工具端 rank merge | 系统级独立 query 合成模块 |
| Eve 主动记忆 | 预蒸馏背景常驻注入 + 最小充分 | 128 槽 + 训练选槽/监控小模型 |
| 记忆整理（dreaming） | 归 Bird、M2+ 轻量做 | M1 不做 |
| Second-Me / Character-LLM | 借"语料加工成场景化样本"做 examples/蒸馏 | 按 persona 微调/参数化分身 |

---

## 附录 B · 相对架构框架 v2 的修正点（dev 对照用）

> 架构框架 v2 是总纲、保持不变；本文档细化其 persona 部分，以下是相对它的改动点（供对照）。

1. `persona` 记录 **拆成 template + instance**；记忆/scope 锚在 instance。
2. **逻辑隔离 + 虚拟 workspace**，写死"不做物理 workspace"的边界与触发条件。
3. **人格分层 = 进化分层（3 组 6 层）**，标优先级、安全/隐私锁死层显式化。
4. runtime = **stable/context/volatile 三层**；表达不单独成层。
5. 写入侧 = **三层记忆链路**（L0 留痕 / L1 片段蒸馏 / L2 Bird 整理）；不每轮复盘、不在回复路径写；封顶 ≤ 窗口。
6. 召回 = **多 query + rank merge**（合成下放主模型）；常驻层 = Eve 式主动记忆 + 最小充分。
7. 新增 **affective_context**；表达不每轮单独生成 delivery。
8. **全局 compression 归 Bird**；`user_personal_patch` 是 instance 字段、用户拖滑条改。
9. **model_preference + model router**（仍默认 Claude）。
10. 新增 **Persona Asset**（源→蒸馏→runtime_card + 知识库→评测）：素材两路、知识库外置（§2.1.1）、可追溯、模型自取知识 recall（hybrid）、超纲承认、不微调；官方内部评测 / 用户社区反馈（无认证徽章）；用户走对话调教 + 发布社区，建造态改 template / 使用态改 instance。
11. 新增 **社区发布与自动审核**（§6.1）：最小发布链路 + 自动安全审核 + 评分/使用量；管理员只能改不公开、无删除权；不做项/申诉/未来见附录 C。
12. 新增 **社区使用 = 托管引用**（§6.2）：用 persona = 建 instance 引用 template、不复制；资产不出平台、片段不以数据形式下发；当前只做 Use、Fork 未来。
13. 新增 **调试 / 保存 / 发布 + 版本**（§6.3）：`saved`（creator 私有可用）/ `published`（社区运行，递增、只留当前一份）；调教仅对话、模型改动系统强制白名单；发布即对所有 instance 生效 + 提示（不做版本 pinning）。

---

## 附录 C · 社区发布：不做项与未来（仅供参考，当前不开发、不预留字段）

> 以下都**不在当前开发范围**；dev 不要为这些建表或写业务逻辑。

**当前明确不做：** 人工审核后台 / 文字评价 / 付费与付费统计 / 推荐排序 / 风险分·质量分·创作者分 / 举报与下架治理后台 / 官方认证标签。不实现 `suspended / removed / review_status / quality_score / recommendation_score / pricing` 等字段。

**申诉入口（后续做）：** 审核失败页放轻量"申诉/反馈"入口，用户提交文字 → 转给管理员（邮箱或 chirp 管理员账号）；不建后台/工单。

**Fork（后续做）：** 复制 persona 可公开的部分另起一个新 template（不复制 source_pack / 知识库私有素材）；当前只做托管式 Use（§6.2），不做 Fork。

**版本与编辑（后续做）：** 版本 pinning（instance 钉在某版本）/ 用户选择是否升级到新版 / 编辑历史 diff。§6.3 选的是发布即对所有 instance 生效（A 方案、不做 pinning）。

**未来社区反馈与推荐（后续重新设计）：** 文字评价 / 付费量 / 推荐排序 / 风险分 / 质量分 / 创作者分 / 举报与下架。做社区发现/推荐时，一起设计 `selection_tags`（给 Bird 稳定匹配）+ Bird 读取范围分组（Bird 只读少数展示字段，不读管理字段）。

**未来 `catalog` 的形状（含 `selection_tags`；仅供参考，当前不建、不预留字段）：**
```yaml
catalog:
  template_id
  name
  short_intro
  avatar
  creator_id
  creator_type
  persona_kind
  model_preference
  visibility
  publish_status
  selection_tags:          # 不注入，仅给 Bird / onboarding / 搜索 / 推荐用
    scenario_tags[]        # intimacy, ambiguous_relationship, breakup, self_blame
    capability_tags[]      # reframe, direct_advice, humor, message_drafting
    tone_tags[]            # sharp, warm, calm, playful
    not_suitable_for[]     # crisis, legal, medical, etc.
```
