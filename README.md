# MostarManusCode

MostarManus 是一个“个人博客 + AI Agent”联合项目：博客负责公开内容、项目档案和学习笔记，Agent 负责对话、知识库检索、长期记忆和工具调用。两者通过同域 `/api` 反向代理连接，博客页面可以直接调用 Agent 能力。

## 仓库内容

- **博客本体 (`blog/`)**：基于 Node.js 的 Markdown 静态站点生成器，包含文章、项目页、分类筛选、RSS、Sitemap、SEO 元数据和响应式主题。
- **Agent 后端 (`src/`)**：基于 Spring Boot / Spring AI 的对话、RAG、记忆、记忆宫殿和工具服务。
- **Agent 工作台 (`frontend/`)**：React/Vite 交互界面，支持流式聊天、记忆模式、知识库检索和管理操作。
- **部署配置 (`deploy/`)**：服务器 Docker Compose 和反向代理配置。

## 功能概览

- **Agent 对话**：支持普通 JSON、纯文本和 SSE 流式响应。
- **多模态输入**：聊天请求可以附带图片，交给视觉模型分析。
- **三种记忆模式**：`DEFAULT`、`PALACE`、`STRUCTURED`，可按请求切换。
- **长期记忆**：从对话中提取可复用的信息，并支持按会话查看、搜索和删除。
- **记忆宫殿**：按抽屉、锚点和语义向量组织长期上下文，支持文件或 PostgreSQL 存储。
- **知识库 / RAG**：读取 Markdown，分片、生成向量并写入 pgvector，支持同步、重建、搜索和统计。
- **工具调用**：内置计算器、日期时间、天气、学习计划、任务和知识库工具。
- **安全控制**：管理员令牌、可选聊天令牌、按客户端地址限流、消息和图片大小限制。
- **双前端形态**：独立 React/Vite 工作台，以及 Spring Boot 静态资源前端。

## 博客前端架构

博客保持静态发布，但首页和文章卡片已经使用 React 19 + `react-dom/server` 做服务端静态渲染：

- React 只参与构建阶段，浏览器端不加载 React runtime，不改变静态站点的 SEO 和首屏策略。
- 首页包含可复用的 Hero、个人状态卡、项目架构层、文章卡片和分类卡片组件。
- 个人卡片会在生产环境探测 `/api/health`，移动端提供方向与技能折叠。
- `/terms/` 与 `/jobs/` 使用 React 客户端 island（术语浏览器、求职专栏的拨杆开关切换与分页），纯逻辑与组件分离并有构建测试覆盖。
- 板块间通过轻量软导航切换，配合 View Transitions 入场过渡与主题安全画布；`Ctrl/Cmd + K` 提供全站聚合搜索。
- `/agent-widget.js` 是零依赖的博客悬浮助手，使用同域 `/api/chat/stream`，不在前端保存模型密钥。
- 构建测试会检查 AI 助手脚本、头像资源和入口引用，避免发布时漏掉聊天入口。

## 架构

```text
浏览器
  │
  ├─ Caddy/Nginx ──► blog/ 静态博客页面
  │        │
  │        └────────► /api ──► Spring Boot REST API
  │                                  ├─ Agent 编排与工具调用
  │                                  ├─ 对话记忆与记忆宫殿
  │                                  ├─ Markdown 知识库与 RAG
  │                                  └─ 访问控制与限流
  │
  └─ frontend/ React 工作台（开发时代理到 /api）
                                       │
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                         LLM API   PostgreSQL  可选 MinIO
                        (OpenAI-   + pgvector  原始文档备份
                        compatible)
```

## 技术栈

- Java 21
- Spring Boot 3.5.x
- Spring AI OpenAI-compatible Chat / Embedding
- PostgreSQL + pgvector
- Maven Wrapper
- React 19 + Vite + TypeScript
- Node.js 18+ + Markdown 静态生成
- Docker Compose

## 快速开始

### 1. 准备环境变量

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，至少填写：

```dotenv
DASHSCOPE_API_KEY=你的聊天模型密钥
POSTGRES_PASSWORD=数据库强密码
MOSTAR_ADMIN_TOKEN=管理员接口令牌
```

真实密钥、数据库密码、SSH 私钥和本地配置文件不要提交到 Git。

仓库中的 `.env.example`、配置模板和部署文档只包含变量名或占位符；生产密钥应通过服务器环境变量或未提交的 `.env` 注入。

### 2. Docker 启动（推荐）

根目录 Compose 会同时启动 PostgreSQL/pgvector 和 Agent 后端：

```powershell
docker compose --env-file .env up -d --build
docker compose logs -f app
```

后端默认监听 `127.0.0.1:8123`，API 前缀为 `/api`。

### 3. 本地开发启动

确保本机已有可连接的 PostgreSQL + pgvector，然后设置模型环境变量：

```powershell
$env:SPRING_PROFILES_ACTIVE="local"
$env:OPENAI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
$env:OPENAI_MODEL="qwen3.7-flash"
$env:OPENAI_API_KEY="你的聊天模型密钥"
$env:SILICONFLOW_API_KEY="你的向量模型密钥"
.\mvnw.cmd spring-boot:run
```

### 4. 启动独立前端

```powershell
cd frontend
npm install
npm run dev
```

Vite 开发服务器会将 `/api` 代理到本地后端 `http://localhost:8123`。

### 5. 构建博客静态站点

```powershell
cd blog
npm install
npm run test
npm run build
```

生成结果位于 `blog/dist-build/`，可由 Caddy/Nginx 直接托管。博客源码、文章和主题样式分别位于 `blog/src/` 与 `blog/public/`。

## 配置说明

| 变量 | 用途 | 必需 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` / `OPENAI_API_KEY` | 聊天模型 API Key | 是 |
| `OPENAI_BASE_URL` | OpenAI-compatible 服务地址 | 否 |
| `OPENAI_MODEL` | 聊天模型名称 | 否 |
| `SILICONFLOW_API_KEY` | 知识库 Embedding API Key | 使用 RAG 时需要 |
| `EMBEDDING_MODEL` | 向量模型名称 | 否 |
| `POSTGRES_DB` | 数据库名称 | 否 |
| `POSTGRES_USER` | 数据库用户 | 否 |
| `POSTGRES_PASSWORD` | 数据库密码 | 是 |
| `PG_HOST` | Agent 连接的 PostgreSQL 主机名 | 否 |
| `MOSTAR_ADMIN_TOKEN` | 管理/诊断接口令牌 | 生产环境建议设置 |
| `MOSTAR_ADMIN_TOKEN_REQUIRED` | 是否强制管理员令牌 | 生产环境建议为 `true` |
| `MOSTAR_CHAT_TOKEN_REQUIRED` | 是否强制聊天接口令牌 | 按需设置 |
| `MOSTAR_CHAT_REQUESTS_PER_MINUTE` | 单客户端每分钟聊天请求上限 | 否 |
| `KNOWLEDGE_ROOT_PATH` | Markdown 知识库目录 | 否 |

完整变量模板见 `.env.example`。脚本 `scripts/import_knowledge.py` 还支持 `PGHOST`、`PGDATABASE`、`PGUSER`、`PGPASSWORD` 和可选的 MinIO 环境变量。

## 记忆模式

在聊天请求中通过 `memoryMode` 选择：

| 模式 | 说明 |
| --- | --- |
| `DEFAULT` | 使用默认对话上下文策略 |
| `PALACE` | 使用记忆宫殿抽屉、锚点和语义召回 |
| `STRUCTURED` | 使用结构化记忆抽取与检索 |

`responseStyle` 支持 `BRIEF`、`BALANCED`、`DEEP` 三种回答风格。

## API 速查

### 聊天

`POST /api/chat`：返回 JSON。

```json
{
  "message": "帮我总结这篇文章",
  "chatId": "optional-chat-id",
  "memoryMode": "PALACE",
  "responseStyle": "BALANCED",
  "images": []
}
```

`POST /api/chat/text`：返回纯文本。

`POST /api/chat/stream`：返回 SSE，事件包括 `chatId`、`message`、`done` 和 `error`。

### 知识库

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/knowledge/sync` | 增量同步 Markdown |
| `POST` | `/api/knowledge/reindex` | 全量重建向量索引 |
| `GET` | `/api/knowledge/search?query=...&limit=5` | 搜索知识片段 |
| `GET` | `/api/knowledge/stats` | 查看知识库统计 |

### 记忆与健康检查

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/memory?chatId=...` | 查看会话记忆 |
| `GET` | `/api/memory/search?chatId=...&query=...` | 搜索会话记忆 |
| `DELETE` | `/api/memory/{id}` | 删除单条记忆 |
| `DELETE` | `/api/memory?chatId=...` | 清空会话记忆 |
| `GET` | `/api/health` | 基础健康检查 |
| `GET` | `/api/health/pgvector` | 检查数据库和 pgvector |
| `POST` | `/api/vision/test` | 受保护的视觉能力诊断接口 |

管理接口默认使用以下任一请求头：

```text
X-Mostar-Access-Token: <MOSTAR_ADMIN_TOKEN>
Authorization: Bearer <MOSTAR_ADMIN_TOKEN>
```

## 项目结构

```text
.
├── blog/                       Markdown 博客源码、静态生成器和文章
├── src/main/java/              Spring Boot 后端、Agent、记忆、RAG 与工具
├── src/main/resources/         application.yml、生产配置与静态前端
├── src/test/                   后端单元测试
├── frontend/                   React/Vite 独立前端
├── deploy/                     服务器部署 Compose 与 Nginx 配置
├── scripts/                    知识库导入、数据库备份和网络工具脚本
├── docs/                       部署、pgvector、工具调用和评估文档
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 测试与构建

```powershell
# 后端编译
.\mvnw.cmd -DskipTests compile

# 后端测试
.\mvnw.cmd test

# 独立前端构建
cd frontend
npm run build
```

## 生产部署

服务器部署建议使用：

```text
docs/deploy-server.md
deploy/docker-compose.server.yml
```

生产配置默认使用环境变量连接 PostgreSQL/pgvector，并将 Agent 只绑定到回环地址，由现有 Caddy/Nginx 反向代理暴露。数据库端口不应直接开放到公网。
博客生产发布流程是先构建 `blog/dist-build/`，再由 Caddy 原子切换静态站点；同一域名下的 `/api/*` 转发到 Agent 后端。

## 相关文档

- [服务器部署指南](docs/deploy-server.md)
- [本地 pgvector 接入](docs/pgvector-local.md)
- [工具调用说明](docs/function-calling.md)
- [评估用例](docs/eval-cases.md)
- [博客静态站点说明](blog/README.md)

## 安全提醒

- 不要提交 `.env`、`application-local.yml`、`application-secrets.yml`、数据库备份或 SSH 私钥。
- 生产环境请使用随机生成的数据库密码和 `MOSTAR_ADMIN_TOKEN`。
- 如果凭据曾经进入 Git 历史，应立即轮换凭据，并清理对应历史记录。
