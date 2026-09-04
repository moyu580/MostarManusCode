# 本地 pgvector 接入

当前项目在 `local` profile 下启用 PostgreSQL + pgvector。默认 profile 不创建数据库连接，避免影响普通测试和启动。

## 当前本地配置

配置文件：`src/main/resources/application-local.yml`

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${PGHOST:localhost}:${PGPORT:5432}/${PGDATABASE:mostar}
    username: ${PGUSER:mostar}
    password: ${PGPASSWORD}
    driver-class-name: org.postgresql.Driver

app:
  embedding:
    openai:
      base-url: https://api.siliconflow.cn
      api-key: ${SILICONFLOW_API_KEY}
      model: netease-youdao/bce-embedding-base_v1
      dimensions:
  pgvector:
    enabled: true
    schema-name: public
    table-name: knowledge_vector_store_bce
    dimensions: 768
    initialize-schema: true
```

`application-local.yml` 仅用于本机覆盖配置，已在 `.gitignore` 中；请通过环境变量提供真实数据库密码，不要把本地配置文件提交到 Git。

## 启动方式

```powershell
$env:SPRING_PROFILES_ACTIVE="local"
$env:OPENAI_API_KEY="你的聊天模型 OpenAI-compatible API Key"
$env:SILICONFLOW_API_KEY="你的 SiliconFlow API Key"
.\mvnw.cmd spring-boot:run
```

## 健康检查

启动后访问：

```text
GET http://localhost:8123/api/health/pgvector
```

预期返回：

```json
{
  "database": "UP",
  "pgvectorInstalled": true
}
```

如果 `pgvectorInstalled` 是 `false`，需要在数据库中安装扩展：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 相关代码

- `PgVectorStoreConfig`: local profile 下创建 `DataSource`、`JdbcTemplate`、`EmbeddingModel`、`VectorStore`
- `PgVectorHealthController`: 验证数据库连接和 pgvector 扩展状态

## 注意事项

- 当前 `VectorStore` 使用 SiliconFlow 的 OpenAI-compatible embedding API，默认 `netease-youdao/bce-embedding-base_v1`。
- Spring AI 的 `base-url` 配置为 `https://api.siliconflow.cn`，不要带 `/v1`，代码会自动请求 `/v1/embeddings`。
- `app.embedding.openai.dimensions` 是传给 embedding 接口的可选参数；BCE 模型不支持该参数，保持为空。
- `app.pgvector.dimensions` 当前配置为 `768`，并使用新表 `knowledge_vector_store_bce`，避免和旧的 1536 维表冲突。
- BCE 模型单条输入最大 512 tokens，当前本地知识库分片已调小到 `target-chars=120`、`max-chars=180`，并将向量写入批次设为 `1`。
