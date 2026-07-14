# 待删代码清单（等 Rae 确认后再删，当前全部保留且可运行）

日期：2026-07-14。背景：前端重构后，新入口 = `#/chirp`（onboarding → 单窗口 bird 对话 + 抽屉 Space/Journal/About me）。以下旧物暂时隐藏未删，深链仍可达。

## A. 旧方向页面（多 persona 星球产品，已被 couple 方向取代）

| 项 | 位置 | 现状 | 删除影响 |
|---|---|---|---|
| 旧首页（planet 卡片/小鸟日报/Moments） | `ChirpHomePage.jsx` 主体 | `#/chirp/home` 可达 | 无新功能依赖，但 **ChirpOnboarding/HomeBird/readOnboardingProfile/OnboardingAnimalAvatar 等仍从此文件导出**，删前需把这几个先搬到独立文件 |
| persona 广场/persona 详情/persona 测试 | `ChirpHomePage.jsx` + `PersonaProfilePage.jsx` + `PersonaTestPage.jsx` | `#/chirp/persona` 等可达 | persona 社区在"后面做"清单里——删 UI 不删后端链路的话，将来重做 UI 即可 |
| persona DM / bird DM 入口与页面分支 | `ChirpHomePage.jsx`(SideDrawer) + `ChirpPage.jsx` dm 分支 | `#/chirp/dm/bird`、`#/chirp/persona-dm/:id` 可达 | ChirpPage 的 DM 模式代码与群聊模式交织，拆除要小心；bird DM 已被产品裁定"不再有" |
| 旧 planet 群聊（love/work） | `#/chirp/planet/:id` | 可达 | 数据（Rae 的历史会话）在 DB 不受删代码影响 |
| SideDrawer（微信式会话列表） | `ChirpHomePage.jsx` | 只在旧页面出现 | Rae 明确不要此形态 |

## B. 前端孤儿/重复

| 项 | 位置 | 说明 |
|---|---|---|
| `.moments-m-invite` 等死 CSS | `ChirpHomePage.css` | JSX 无引用（切片1调查确认） |
| `src/utils/navigation.js` 的 useNavigate | 全仓引用极少 | 与新壳的 navigateTo 重复 |
| Moments 相关残余（loadChirpMomentEntries 等） | `chirpSupabase.js` | Moments UI 已删（2026-06-11），数据函数残留 |
| BrandStudio / landing 打字机 | `BrandStudioPage.jsx` 等 | 非 chirp 产品，属 SYL.AILABS 个人站——**大概率保留**，列出仅供知悉 |

## C. 后端（多 persona 链路——建议全部保留）

turnTargeting / turnPlanner / participation / personaRuntime / recall / distiller 等：persona 社区在"后面做"，且 spec 一直是"隐藏不删"。**不建议本轮删。**

## 建议的确认方式

逐行回复 A 表编号即可（例：A1 删、A2 留…）。删除动作会做成独立 commit 并跑全量测试+两条冒烟（新壳 + 保留的旧深链）。
