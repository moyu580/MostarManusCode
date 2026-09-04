# Function Calling 模块

当前项目通过 Spring AI 的 `@Tool` 注解接入 Function Calling。工具已绑定到 `MostarManus` 的默认 `ChatClient`，复用现有 `/chat` 和 `/chat/stream` 接口。

## 已支持工具

| 工具类 | 方法 | 说明 |
| --- | --- | --- |
| `DateTimeTools` | `getCurrentDateTime` | 查询指定时区的当前日期和时间 |
| `CalculatorTools` | `calculate` | 执行两个数字之间的基础四则运算 |
| `WeatherTools` | `getMockWeather` | 返回模拟天气，用于验证工具调用链路 |
| `TaskTools` | `createTask` / `listTasks` / `completeTask` | 使用 PostgreSQL 持久化任务 |
| `LearningPlanTools` | `saveLearningPlan` / `listLearningPlans` | 使用 PostgreSQL 保存和查询学习计划 |
| `MemoryTools` | `saveUserMemory` / `searchUserMemory` | 使用 pgvector 保存和语义检索长期记忆 |

## 示例问题

```text
现在上海时间是几点？
```

```text
帮我计算 12345 * 678
```

```text
查一下上海今天的天气
```

```text
帮我创建一个任务：明天完成 Spring AI Tool Calling 文档整理，优先级 high
```

```text
查看我的待办任务
```

```text
记住：我更喜欢用 Java 和 Spring Boot 做后端项目
```

```text
回忆一下我偏好的技术栈
```

## 新增工具方式

1. 在 `com.moyuyu.yuaiagentpro.tools` 包下新增 `@Component` 类。
2. 给可调用方法添加 `@Tool(description = "...")`。
3. 给参数添加 `@ToolParam(description = "...")`。
4. 将工具 Bean 注入 `MostarManus` 构造器，并添加到 `.defaultTools(...)`。

示例：

```java
@Component
public class ExampleTools {

    @Tool(description = "Echo a text message")
    public String echo(@ToolParam(description = "Text to echo") String text) {
        return text;
    }
}
```

## 注意事项

- `pom.xml` 已开启 Maven compiler 的 `parameters`，用于保留 Java 方法参数名。
- 工具入参仍需在 Java 方法内做校验，不能完全信任模型生成的参数。
- `WeatherTools` 当前是 Mock 数据，不是真实天气 API。
- `TaskTools` 和 `LearningPlanTools` 依赖 PostgreSQL，需要使用 `local` profile 启动。
- `MemoryTools` 依赖 pgvector 和 OpenAI-compatible embedding，需要使用 `local` profile 启动，并确保 `/api/health/pgvector` 返回正常。
- 写操作类工具后续需要增加权限、确认和审计日志。
