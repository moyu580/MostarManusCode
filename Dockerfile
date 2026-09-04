# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# 先单独拷 pom 下载依赖，充分利用镜像层缓存
COPY pom.xml .
RUN mvn -B -q dependency:go-offline || true

COPY src ./src
RUN mvn -B -q -DskipTests package

# ---------- 运行阶段 ----------
FROM eclipse-temurin:21-jre-jammy

# curl 供容器健康检查使用
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 1001 mostar

ENV TZ=Asia/Shanghai \
    JAVA_OPTS="-Xms128m -Xmx512m -XX:MaxDirectMemorySize=64m -XX:+ExitOnOutOfMemoryError"

WORKDIR /app
COPY --from=build /build/target/MostarManus-ai-agent-pro-0.0.1-SNAPSHOT.jar app.jar

# 运行期可写目录（聊天记忆 / 记忆宫殿的文件兜底存储）
RUN mkdir -p /app/tmp /data/knowledge && chown -R mostar:mostar /app /data
USER mostar

EXPOSE 8123
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD curl -fsS http://localhost:8123/api/health || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
