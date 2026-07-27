# Chirp 开发规则（当前生效）

更新日期：2026-07-15

## 1. 开始开发前先读

按以下优先级理解产品，发生冲突时以前者为准：

1. `docs/PRODUCT_SOURCE_OF_TRUTH.md`：当前产品边界、移动端方向和实施顺序。
2. `docs/superpowers/specs/2026-07-12-couples-mvp-v2-design.md`：情侣 MVP v2 详细设计。
3. `docs/superpowers/specs/2026-07-03-couples-p0-design.md`：仅保留邀请、RLS、Realtime、消息双列等被 v2 明确沿用的数据/基建设计。
4. `docs/chirp-规范.md`：仍适用于后端和旧 Web；移动端规则以本文件为准。

旧的 planet、多 persona、诞总、Bird DM、Moments 方案仅供研究，不得作为新功能依据。

## 2. 当前产品红线

- Chirp 是 iPhone 优先的情侣产品；新客户端放在独立的 `mobile/` Expo 工程。
- 每个用户只有一个私人军师。军师是朋友/顾问，不是用户分身。
- 单人期只有军师 DM、我的日记和 About Me；伴侣接受邀请后才创建情侣群。
- Bird 只存在于情侣群，没有 DM；仅在被 `@bird` 或回复 Bird 时发言。
- 军师最多读取主人本来可见且明确授权的数据；Bird 只读取情侣群和明确提交的调解内容。
- Bird 不读取日记。日记的 AI 模式按“用户 × 日记本”控制，默认关闭。
- 不恢复旧多 persona 星球，不开发 persona 市场，不把旧 Web 页面直接搬进 App。

## 3. 仓库边界

- `mobile/`：新的 Expo + React Native + TypeScript iPhone 客户端，是新 UI 的主线。
- `backend/`：继续复用并扩展现有 Node 后端；模型调用、权限校验和敏感写入留在服务端。
- `supabase/`：数据库迁移和 RLS；隐私边界必须在数据库/服务端强制执行，不能只靠 UI。
- `src/`：旧 React/Vite Web 客户端，进入维护/参考状态；除明确要求外不继续扩建。

不要在 `mobile/` 中复用 Web DOM 组件、Tailwind 类或 `lucide-react`。移动端使用 React Native 组件和 Expo 兼容库。

## 4. 当前实施顺序

1. 建立 `mobile/` 工程和可在 Expo Go/开发构建中运行的导航壳。
2. 完成 onboarding、军师 DM、About Me/邀请、情侣群的移动端骨架。
3. 接入现有 Supabase Auth、邀请/RLS/Realtime 和后端聊天接口。
4. 再做调解卡片、重要日期与提醒、日记本。

每一步先跑类型检查/测试并确认边界，再进入下一步。不要为了迁移而删除旧 Web；清理必须单独评估。

## 5. 工程纪律

- 保留工作区中已有的用户改动，不覆盖、不擅自回滚。
- 修改前先看 `git status` 和相关 diff；只改当前任务涉及的文件。
- 本地文件用 UTF-8；数据库 migration 不带 BOM。
- 新的敏感写入走后端，错误格式保持 `{ error: { code, message } }`。
- 后端测试使用 `node --test`，不调用真实模型或数据库。
- 未经明确要求，不提交、不推送、不部署、不执行生产 migration。
