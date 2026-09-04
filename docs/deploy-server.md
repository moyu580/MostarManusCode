# mostarmanus.ink 服务器部署指南

目标机器：2C2G 云服务器（公网 IP 使用部署时的 `$SERVER_IP`，博客已在同机运行）。
拓扑：`Caddy(静态博客 + /api 反代) → Java 后端(容器, 127.0.0.1:8123) → 现有 pgvector(容器, 仅内网)`。

## 内存预算（2G 机器）

| 组件 | 上限 |
|------|------|
| PostgreSQL（shared_buffers=128MB） | 384m（compose 已限） |
| Java 后端（-Xmx512m） | 896m（compose 已限） |
| 系统 + Nginx + 页缓存 | 剩余 ~700m |

上线后用 `free -h`、`docker stats` 观察几天，余量不足先把 `JAVA_OPTS` 的 `-Xmx` 降到 `384m`。

## 部署步骤

### 1. 服务器装 Docker（如未装）

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. 上传代码与知识库

```bash
# 按实际服务器填写，不要把真实地址写进仓库
SERVER_IP="<SERVER_IP>"
# 本地：把博客 Markdown 放进知识库目录（后端从 /data/knowledge 读取）
scp -r 项目/data/knowledge/* "root@${SERVER_IP}:/opt/mostarmanus/data/knowledge/"
```

### 3. 配置环境变量

```bash
cd /opt/mostarmanus
cp .env.example .env
vi .env   # 填 DASHSCOPE_API_KEY、MOSTAR_ADMIN_TOKEN 等
chmod 600 .env
```

### 4. 启动 Agent 后端

服务器已经有 `/opt/postgres` 中的 pgvector 容器（数据库默认是 `app`），不要再启动根目录 `docker-compose.yml` 里的第二个数据库。

```bash
docker compose --env-file .env --env-file /opt/postgres/.env \\
  -f deploy/docker-compose.server.yml up -d --build
docker compose -f deploy/docker-compose.server.yml logs -f app  # 看到 Started YuAiAgentProApplication 即成功
curl http://127.0.0.1:8123/api/health
```

三张表自动创建：`agent_memory_items`（长期记忆）、`agent_palace_drawers`/`agent_palace_index`（记忆宫殿）、`knowledge_vector_store_bce`（RAG 向量）。

### 5. 首次建向量索引

```bash
curl -X POST http://127.0.0.1:8123/api/knowledge/reindex
curl http://127.0.0.1:8123/api/knowledge/stats
```

重建接口需要管理员令牌：

```bash
curl -H "X-Mostar-Access-Token: $MOSTAR_ADMIN_TOKEN" \\
  -X POST http://127.0.0.1:8123/api/knowledge/reindex
```

### 6. Caddy 反代

现有 `/opt/blog/Caddyfile` 已包含 `/api/*` 到 `mostar-app:8123` 的反代和 SSE `flush_interval -1` 配置。Agent 容器加入 `blog_default` 后无需额外改 Caddy。
同域反代后前端直接用相对路径 `/api/...`，无需 CORS。

### 7. 安全组 / 防火墙

只放行 `22 / 80 / 443`。确认 5432、8123 均未对公网开放：

```bash
ss -tlnp | grep -E '5432|8123'   # 5432 不应出现；8123 应为 127.0.0.1:8123
```

### 8. 每日备份

```bash
chmod +x scripts/backup_db.sh
crontab -e   # 加一行：0 3 * * * /opt/mostarmanus/scripts/backup_db.sh >> /opt/mostarmanus/data/backup.log 2>&1
```

注意：从 Windows 拷贝到服务器后如报 `\r` 错误，执行 `sed -i 's/\r$//' scripts/backup_db.sh`。

## 日常运维

```bash
docker compose logs -f app          # 看日志
docker compose up -d --build app    # 改代码后重建后端
docker compose down                 # 停止（pgdata 卷保留，记忆不丢）
docker exec -it mostar-db psql -U mostar -d mostar
```

## 遗留事项（上线前必须处理）

- `/api/chat` 默认公开，但按 IP 限流；如需完全私有化，可将 `MOSTAR_CHAT_TOKEN_REQUIRED=true`。
- `/api/knowledge/reindex`、`/api/knowledge/sync`、`/api/memory/**`、`/api/vision/test` 和详细健康检查默认要求 `MOSTAR_ADMIN_TOKEN`。
- `MostarManus.java` 的人设提示词仍是“出行助手”，需改写为博客助手。
- `MostarManus.java:68` 的 DEFAULT_IMAGE_MESSAGE 为乱码，需修复。
