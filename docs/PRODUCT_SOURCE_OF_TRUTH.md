# Chirp 当前产品真相

更新日期：2026-07-15  
状态：当前开发的最高优先级产品约束

## 一句话

Chirp 是一个 iPhone 优先的情侣关系空间：每个人有一位私人的 AI 军师，两个人连接后拥有一个共同群聊，Bird 只在共同空间中被邀请时协助双方。

## 用户状态与入口

### 单人期

用户完成轻量 onboarding 后可以使用：

- 私人军师 DM
- 我的日记
- About Me（onboarding 信息、重要日期、邀请入口）

单人期不创建情侣群，也没有 Bird 入口。

### 连接伴侣后

伴侣接受邀请码并完成 onboarding 后，双方获得：

- 情侣群：两位用户 + 共同 Bird
- 共享日记本“我们的故事”
- 后续的调解卡片、共同日期和提醒

邀请码 redeem 必须幂等；伴侣加入后可以看到该情侣群已有历史消息。

## 三个 AI 身份

| 身份 | 服务对象 | 可读取 | 不可读取 |
|---|---|---|---|
| A 的军师 | A | A 的军师 DM、A 的 About Me、A 明确开启 AI 模式的日记本 | B 的私密内容、未授权日记、调解私密提交 |
| B 的军师 | B | 与 A 对称 | 与 A 对称 |
| Bird | 情侣双方 | 情侣群、双方明确提交到同一调解卡片的内容 | 军师 DM、About Me 私密内容、日记原文 |

总原则：`agent 的可见范围 <= 主人的可见范围`。新增任何数据源前必须重新检查这条规则，并在数据库/服务端实施 scope，不能只靠 prompt。

军师始终以自己的身份说话，是忠于主人的朋友/顾问，不冒充主人，也不是主人的数字分身。

Bird 没有 DM。群聊中只有 `@bird` 或回复 Bird 才触发回复；普通情侣聊天只落库，不触发 AI。

## MVP 页面

底部主导航采用四个产品域，而不是照搬旧 Web：

1. `军师`：私人 DM，单人期默认首页。
2. `我们`：未连接时展示邀请状态；连接后进入情侣群。
3. `日记`：我的日记、我们的故事和后续自定义日记本。
4. `我`：About Me、onboarding 信息、重要日期、邀请码和设置。

首个可用竖切依次为：

1. Auth 与 onboarding
2. 军师 DM
3. About Me 与邀请
4. 情侣群、Realtime、Bird `@` 响应
5. 调解卡片与重要日期
6. 日记本及按用户授权的 AI 模式

## App 技术方向

- 客户端：`mobile/` 内独立 Expo + React Native + TypeScript 工程。
- 服务端：复用 `backend/` 的 Node API 和 agent runtime，不在客户端保存模型密钥或 service-role 密钥。
- 数据：复用 Supabase Auth/Postgres/RLS/Realtime；移动端只持有公开的 Supabase URL 与 anon key。
- Windows 可以完成日常开发、Expo Go 真机调试和 EAS 云构建；需要本地 Xcode 调试原生代码或最终 iOS 原生排障时使用 Mac。
- `src/` 旧 Web 保留为参考与临时调试入口，不再作为新产品 UI 的主线。

## 当前不做

- Bird DM
- 单人期 Bird 群或虚拟伴侣
- 旧 planet、多 persona、诞总/Barry/duck 阵容
- persona 创建、市场、收费或派遣
- Moments 旧模块
- 直接把 Web 页面包成 App
- AI 默认读取全部日记
- 仅靠 prompt 实施隐私边界

## 文档关系

本文对当前产品行为拥有最高优先级。详细交互与数据增量见 `docs/superpowers/specs/2026-07-12-couples-mvp-v2-design.md`。该文档明确沿用的邀请、RLS、Realtime 与消息约定可继续参考 2026-07-03 spec；更早的 persona/planet/Bird DM 方案均降级为历史研究材料。
