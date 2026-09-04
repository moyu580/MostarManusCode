# MostarManus Frontend

这是独立前端项目，视觉方向参考 ByteDance DeerFlow 的深色 Agent Workspace：左侧会话与记忆模式，中间 Agent 对话与执行流，右侧知识库状态、检索与重建操作。

## 运行方式

先启动后端：

```powershell
cd <project-root>
.\mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=local
```

再启动前端：

```powershell
cd <project-root>\frontend
npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

## 联调说明

开发环境下 Vite 会把 `/api` 代理到 `http://localhost:8123`，所以浏览器端不需要额外配置 CORS。

当前已接入的后端接口：

- `GET /api/health`
- `POST /api/chat`
- `POST /api/chat/stream`
- `GET /api/knowledge/stats`
- `GET /api/knowledge/search`
- `POST /api/knowledge/reindex`

## 项目结构

```text
frontend/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── api.ts
    ├── main.tsx
    └── styles.css
```

后续如果要继续贴近 DeerFlow，可以逐步补上 Artifact 面板、工具调用时间线、文件预览、任务拆解卡片和模型/Agent 设置页。
