# Chirp Mobile

Chirp 的 iPhone-first 客户端。技术栈为 Expo、React Native、Expo Router 和 TypeScript。

## 本地运行

```powershell
npm install
npm run start
```

在 iPhone 上安装 Expo Go，并让手机和电脑处于同一网络，然后扫描终端二维码。Windows 不能启动 iOS Simulator；真机调试和 EAS 云构建不受影响。

## 检查

```powershell
npm run typecheck
npm run export:web
```

## 当前状态

当前已完成：

- Supabase 邮箱注册/登录与 SQLite session 持久化
- onboarding 页面骨架与私人军师 DM UI
- About Me、真实邀请码创建/兑换与情侣空间识别
- 情侣群历史读取、Realtime 订阅、真实消息发送与 Bird `@` 路由
- 私人/共享日记入口与 AI 授权开关外观

仍未接入：军师正式 persona 记录与 prompt、onboarding/About Me 持久化、日记数据表、调解卡片和通知。情侣群预览页仍使用演示数据，真实群从“我们”页进入。

产品与隐私边界以仓库根目录的 `docs/PRODUCT_SOURCE_OF_TRUTH.md` 为准。
