# chirp persona 架构评估（对照 5 条需求 + 外部调研）

> 日期：2026-06-14
> 输入：Rae 的 5 条 persona 需求 + 外部调研（Character.AI / SillyTavern 角色卡标准 / Letta·MemGPT 记忆块 / Stanford Generative Agents）。
> 结论一句话：**现有「template（公开资产）/ instance（每用户私有副本）/ 系统层」架构在需求 1–4 上正确且与业界主流一致（在"记忆"上比 Character.AI 更激进）；唯一真正的结构缺口是需求 5（多用户同群），但缺口在会话/归属层，不在 persona 架构本身。不建议推翻重做。**

---

## 一、外部调研：别人怎么做的

| 系统 | persona 定义 | 每用户记忆 | 社区共享 | 对 chirp 的启示 |
|---|---|---|---|---|
| **Character.AI** | Character = 共享定义，可见性 public/unlisted/private；定义越细行为越稳 | **几乎没有**——滑动窗口即记忆，跨会话默认不记（在其规模下刻意放弃的工程取舍） | ✅ 海量用户共用一个 Character | chirp 的"真实跨会话记忆"正是 C.AI 放弃的、也是 chirp 的差异化护城河；template/instance 拆分与 C.AI 的 Character/chat 拆分同构，但 chirp 走得更远 |
| **SillyTavern 角色卡 V2/V3** | 自包含 JSON：name/description/personality/scenario/first_mes/mes_example/system_prompt/post_history_instructions，是开源事实标准 | **卡里没有**——记忆是 client/per-chat 的 | ✅ 一个 PNG 拖到任意客户端即用 | 印证"template = 自包含人格资产、记忆不进 template"这条边界划对了；未来若想做导入/导出互通，template 字段可对齐这套标准 |
| **Letta / MemGPT** | agent 配置 | **记忆块（memory blocks）可共享或隔离**；三层：core(在上下文)/recall(可搜历史)/archival(工具查) | 块级共享 | 直接给了 chirp 一个干净心智模型：**template = 共享只读块，instance = 每(用户×template)隔离块**；三层记忆 ≈ chirp 的 runtime_card / 最近窗口+recall / 知识库 |
| **Stanford Generative Agents** | persona 写进记忆 | memory stream + 周期性 reflection 合成高层结论 | — | chirp 的 L1 片段蒸馏 = reflection 的轻量版，方向对 |

**两条最重要的外部结论**：
1. **Character.AI 用规模证明了"深度每用户记忆很难、他们放弃了"**——chirp 押注记忆做差异化，架构支持，但要认清这是最难、最贵的一块（见第四节 scale 注意）。
2. **template/instance 的拆分不是 chirp 独创、是被反复验证的正确边界**：人格/知识 = 共享（Character、角色卡、Letta 共享块），关系记忆 = 每用户隔离（Letta 隔离块）。

---

## 二、逐条对照 5 条需求

| # | 需求 | 现架构怎么承载 | 判定 |
|---|---|---|---|
| 1 | 每个 persona 有自己的人格 | `template.runtime_card` + `build_asset`（= Character 定义 / 角色卡 / Letta 共享块） | ✅ **稳**，业界主流做法 |
| 2 | 有与用户相关的记忆 | `instance`（user_memory / interaction_skill / affective_context），主键 = user×template，L1 蒸馏写入 | ✅ **稳**，且比 Character.AI 强 |
| 3 | 群聊 + 私聊 | 同一 template，挂在不同 conversation 上；可见性由会话成员资格算（架构框架 §3bis） | ✅ **稳**，已实现 |
| 4 | 社区发布、他人可用、**builder 记忆不共享** | template 公开共享（只读）；每个使用者各自一条 instance（按 user_id 隔离）。builder 与他人记忆天然不互通 | ✅ **架构正确**，但有一个实现纪律要焊死（见下） |
| 5 | 未来：用户 A + 用户 B + B 的 persona 同群 | ❌ 现有一切都是**单 owner**：conversation.owner_id、消息按 owner 圈定、RLS = auth.uid()=owner_id、memory_scope 按单用户算 | ⚠️ **结构缺口**，但在会话/归属层，不在 persona 架构 |

### 需求 4 的实现纪律（必须焊死，否则隐私出事）
- **"建造态"改 template，"使用态"写 instance**——这两条流程必须严格分开。
- builder 在调教 persona 时和它聊天，这些聊天**必须落进 builder 自己的 instance**（与普通使用者同机制），**绝不能进 template、也绝不能被蒸馏进 template**。
- 一旦某条蒸馏/写入把 builder 的对话内容写到了 template 层，所有使用该 persona 的人都会看到——这是最严重的隐私事故。
- **建议**：在蒸馏器（distiller.js）和任何写 template 的路径上加显式断言："写 instance 的链路永远不碰 template；template 只由建造态的显式编辑改"。现在 P0 只有官方 persona、还没自建发布流程，但这条要在做发布流程前先立。

---

## 三、需求 5（多用户同群）：缺口在哪、要动什么

这是唯一现架构没准备好的需求。但**结论是好的：template/instance 本身能活下来，要改的是它下面的会话/归属/scope 层。**

现假设（单租户）会在多用户共享房间下全部破裂：
1. **会话归属**：`conversation.owner_id` 假设一个房间属于一个用户。共享房间需要"房间有多个成员"的归属模型（conversation_members 已有雏形，但 owner_id / RLS 还是单人）。
2. **RLS / 可见性**：现在 `auth.uid() = owner_id` 才能读。共享房间要"我是这个房间成员就能读"，且消息可见性要重新定义（A 能看到 B 在共享房间说的话，但看不到 B 与 persona 的私聊）。
3. **persona 用谁的记忆**：B 的 persona 在共享房间里同时面对 A 和 B。它对 B 的关系记忆（instance B×template）不能在回应 A 时泄露给 A；理想是**按"当前在对谁说话"选 instance**，共享房间里还可能需要一条"房间级共享记忆"。这是 Letta"共享块 vs 隔离块"要正面解决的问题。
4. **§3bis 分桶模型**：现在的"bird 全知 / persona 按成员"是按单用户数据设计的，多用户要重新定义谁能看谁的什么。

**建议**：
- **现在不预建**（你说产品没想好，对——多租户预建是典型过度设计）。
- 但**避免把单 owner 假设焊得更深**：新写涉及 conversation 归属/可见性的代码，尽量走 `conversation_members` 判定，少直接用 `owner_id`，给将来留路。
- 真做时，这是一个**会话层的多租户改造项**（owner → 多成员房间 + 成员级可见性 + persona 按对话对象选 instance），不是 persona 架构推翻。可单独立项。

---

## 四、其它两点（不阻塞，记着）

1. **Scale**：instance 数 = 用户数 × 使用的 persona 数，蒸馏 job 随之乘性增长。P0（一个官方 persona、少量用户）无压力；到 marketplace 规模（多 persona × 多用户）要关注 instance 膨胀与蒸馏负载。Character.AI 正是在这点上放弃了深度记忆——chirp 要么用量上控（只给活跃关系蒸馏）、要么接受成本作为差异化代价。
2. **字段对齐（可选）**：若将来想和角色卡生态互通（导入/导出），template 的人格字段可逐步对齐 SillyTavern V2/V3 命名。非必须，记个口子。

---

## 五、最终建议

1. **不推翻**。template / instance / 系统层是正确且被业界验证的边界，需求 1–4 直接满足。
2. **焊死需求 4 的实现纪律**：建造态改 template、使用态写 instance，二者隔离；做自建发布流程前先立"写链路不碰 template"的断言。
3. **需求 5 当作独立的"会话层多租户改造"**，现在不预建、但别把单 owner 假设挖更深；新代码优先走 membership 判定。
4. Scale 与字段对齐记口子，非 P0。

---

## 附：调研来源
- Character.AI 记忆/架构：[KinthAI 解析](https://blog.kinthai.ai/why-character-ai-forgets-you-persistent-memory-architecture) · [Flowith FAQ](https://flowith.io/blog/character-ai-faq-memory-content-filters-safety-explained/)
- 角色卡标准：[character-card-spec-v2](https://github.com/malfoyslastname/character-card-spec-v2/blob/main/spec_v2.md)
- Letta 记忆块：[Shared memory blocks 文档](https://docs.letta.com/tutorials/shared-memory-blocks/) · [Memory Blocks 博客](https://www.letta.com/blog/memory-blocks)
- Generative Agents：[arXiv 2304.03442](https://arxiv.org/pdf/2304.03442)
