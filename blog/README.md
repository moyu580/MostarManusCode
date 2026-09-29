# MostarManus Blog

这是 MostarManus 的博客本体：一个轻量的 Markdown 静态站点生成器。它与仓库根目录的 Spring Boot Agent 后端一起部署，生产环境通过同一个域名提供页面和 `/api` 接口。

## 功能

- Markdown 文章与项目页
- 博客分类、标签筛选和分页
- 响应式深色主题与主题切换
- RSS、Sitemap、Robots 和 Open Graph 元数据
- 文章目录、上一篇/下一篇导航和安全的内部链接处理
- Caddy/Nginx 静态托管友好，生成结果不依赖运行时 Node.js
- React 19 SSR 组件化首页与文章卡片，不向浏览器发送 React runtime
- 全站 `Ctrl/Cmd + K` 命令搜索（页面、文章、项目、术语聚合索引）
- 专业术语板块：可搜索、可筛选、带紧凑分页的术语浏览器 React island
- 求职专栏板块：QQ 式布局的 React island，“经典拨杆开关”在技术栈需求排名与岗位 JD 间切换，各自独立分页并支持 URL 深链接
- 板块间软导航（无刷新切换 + 入场过渡 + 主题安全画布），浏览器前进后退与深链接可用
- 同域 AI 悬浮助手，连接 `/api/chat/stream`，支持移动端全屏对话；头像与气泡顶部对齐（QQ 式）
- 首页 Agent 健康状态、移动端个人卡片折叠和 reduced-motion 兼容

## 本地开发

```powershell
npm install
npm run test
npm run build
npm run serve
```

默认预览地址为 `http://localhost:4321`。文章位于 `src/content/blog/`，项目页位于 `src/content/projects/`，公共资源位于 `public/`。

React 组件位于 `src/ui/`，通过 `react-dom/server` 输出静态 HTML。`public/agent-widget.js` 和 `public/agent-avatar.png` 是博客助手的公开前端资源；它们不包含模型密钥。

## 与 Agent 联调

博客本身是静态站点，不直接保存模型密钥。需要 Agent 能力时，前端通过同域 `/api` 请求 Spring Boot 服务；开发环境可在 `frontend/` 中使用 Vite 代理，生产环境由 Caddy/Nginx 反向代理。

## 发布

```powershell
npm run build
```

将 `dist-build/` 作为静态站点根目录部署即可。完整服务器流程见 [`../docs/deploy-server.md`](../docs/deploy-server.md)。

发布前建议执行：

```powershell
npm ci
npm run check
```

`npm run check` 会运行 83 项构建与内容测试，并确认 AI 助手脚本和头像资源进入构建产物。
