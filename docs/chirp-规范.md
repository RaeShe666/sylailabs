# Chirp UI 与系统架构规范

日期：2026-07-12 ｜ 状态：生效
适用：MVP v2 起的所有新代码（spec 见 `docs/superpowers/specs/2026-07-12-couples-mvp-v2-design.md`）

每条规范写"出发点"，知道为什么才知道什么时候可以破例。

## 一、UI 规范

### 1. 图标：lucide-react（唯一图标源）

- 所有图标来自 [lucide.dev](https://lucide.dev/icons/)，`import { X } from 'lucide-react'`；**不混用其他图标库、不用 emoji 当功能图标**（装饰性 emoji 除外，如 Bird 的气泡内容）。
- 尺寸只用三档：`size={16}`（行内/输入框）、`size={20}`（按钮/列表项，默认）、`size={24}`（页头/空态）。`strokeWidth` 用默认 2，不逐处调。
- 出发点：图标是最容易碎片化的资产，一个来源+三档尺寸=永远不用讨论。

### 2. 样式：Tailwind CSS v4

- **新组件/新页面只写 Tailwind 工具类**，不再新建 `XxxPage.css`。
- 设计 token 统一在 `src/index.css` 的 `:root` + `@theme inline`（shadcn 约定：`bg-background`、`text-muted-foreground`、`rounded-lg` 等语义类）。改视觉=只改 token，不扫荡组件。
- 现状注意：**preflight 未开启**（旧页面依赖手写 reset）。旧的每页 CSS 冻结维护——改到哪个页面，顺手把它迁成 Tailwind；全部迁完后开 preflight、删旧工具类。
- 类名排序交给 `prettier-plugin-tailwindcss`，不手排。
- 出发点：一处 token、utility-first，是 AI 辅助开发下最不容易发散的样式体系。

### 3. 组件：shadcn/ui（JS 模式）

- 需要通用组件（Button/Dialog/Sheet/Drawer/Toast/Input…）时先 `npx shadcn@latest add <name>`，落在 `src/components/ui/`，可随意改源码（它是复制进仓库的代码，不是依赖）。
- 配置在 `components.json`（`tsx: false`、new-york 风格、neutral 基色）；`cn()` 帮助函数在 `src/lib/utils.js`。
- 业务组件放 `src/features/<域>/components/`，**不放** `components/ui/`（那里只放通用原子件）。
- 出发点：不重复造 Dialog 这类轮子，但保留完全的改造自由。

### 4. 移动优先

- 所有新 UI 按 **390px 宽先做**，桌面是自适应结果而不是反过来；Tailwind 断点天然 mobile-first（裸类=手机，`md:` 起是放大）。
- 触控目标 ≥ 44px；聊天输入区注意 iOS 安全区（`env(safe-area-inset-bottom)`）。
- 出发点：这是手机上用的情侣产品，桌面是次要场景。

### 5. 语言与文件

- **全 JS/JSX，不引入 TS**；后端公共模块用 JSDoc 标注参数类型。
- 组件文件 PascalCase（`InviteCard.jsx`），hooks 用 `useXxx.js`，其余 camelCase。
- 路径别名 `@/` = `src/`（vite + jsconfig 已配）。

## 二、前端架构规范

### 6. 目录结构

```
src/
  pages/            # 路由级页面（薄，组装 features）
  features/<域>/    # couple / diary / mediation / advisor / aboutme
    components/     # 该域业务组件
    hooks/          # 该域 hooks
    api.js          # 该域的数据访问（fetch/supabase 调用集中处）
  components/ui/    # shadcn 通用原子件
  contexts/         # 全局 context（Auth 等，现有）
  lib/              # supabase client、utils、fetch 封装
```

- 出发点：按域切而不是按类型切，一个功能的代码在一个文件夹里，AI 和人都好找。

### 7. 路由：react-router v7（library 模式）

- `BrowserRouter` + `Routes`；页面间跳转一律路由，不再用 state 切页。
- 邀请深链是一等公民：`/invite/:code` 未登录先走注册再回跳。

### 8. 服务端数据

- **聊天/SSE 流**：沿用现有自研链路（流式端点 + chirpHistoryCache LRU + 分页），不迁 Query。
- **新的 CRUD 面**（日记/about me/邀请/调解卡片）：用 `@tanstack/react-query`（缓存、loading、失效重取不手写）。
- **读写边界**：前端 Supabase client 只做 RLS 下的读 + Realtime 订阅；**一切需要校验的写走后端**（redeem、调解提交、日期表写入等，service role 执行）。
- 出发点：流式聊天是特化管线不折腾；其余数据别再手写缓存；写路径集中在后端才守得住权限。

## 三、后端架构规范

### 9. 分层

`backend/routes` → `backend/lib/<域模块>` → store（Supabase）。新域（invite / diary / mediation / dates）各建独立模块，**不塞进旧 chirp 文件**；模型调用统一走 `modelProvider.js`。

### 10. API 约定

- REST 资源命名；错误统一 `{ error: { code, message } }`；流式一律 SSE（沿用 `/api/chirp/turn/stream` 模式）。
- 幂等要求：所有"点两下会出事"的写（redeem、提交调解卡片）必须幂等。

### 11. 测试

- `node --test`，注入假 chat、不打真模型/DB（沿用现有 22 条单测模式）；新域模块随切片配测，跑法 `cd backend && npm test`。

### 12. Supabase / Migration 纪律（踩坑成文）

- migration 文件**去 UTF-8 BOM**；SQL 字符串内引号注意转义。
- `db push` 直连被墙：走 pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432`，user=`postgres.<project-ref>`，密码含 `@` 需 URL 编码。
- RLS 改动前，按「改动影响追踪纪律」先列全该表所有读写点（前后端+测试+文档），一次改全。

### 13. Agent 记忆边界（产品级架构规则）

- **agent 的可见范围 ≤ 它主人的可见范围**；Bird 无 DM，只见群聊+调解提交。任何给 agent 加数据源的改动，用这一条判，不逐次讨论。
- 详见 spec §2。

## 四、流程规范

- lint/format：`npm run lint` / `npm run format`；提交前跑 lint。
- 提交信息沿用现有风格：`feat(chirp): ...` / `fix(chirp): ...` / `docs(chirp): ...`。
- 产品单一事实来源 = 飞书 wiki「New version/MVP」章节；技术定稿 = repo 内 spec。两边冲突时先问 Rae。
