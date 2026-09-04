# 项目经历

2026.03 ~ 2026.04  “MostarManus” AI Agent 智能学习与任务协作助手

能力表述：熟悉 Spring AI / LangChain4j 等 Agent 开发框架的核心思想，理解 Plan-and-Execute、RAG、Function Calling 与多轮记忆等设计范式，具备从对话接口、提示词约束、工具调用到向量检索和长期记忆管理的 Agent 后端架构落地能力。

项目描述：基于 Spring Boot 3、Spring AI 和 OpenAI-compatible 模型服务构建的 AI Agent 后端系统，面向学习规划、任务协作和知识问答场景。项目支持普通对话与 SSE 流式输出，接入本地知识库 RAG；并通过 Function Calling 扩展时间查询、计算器、模拟天气、任务管理、学习计划保存和长期记忆检索等工具能力；同时使用 PostgreSQL + pgvector 实现向量存储与语义检索，使用 Kryo 实现本地多轮会话记忆。

职责描述：负责核心 Agent 链路设计与后端功能开发，包括 ChatClient 构建、系统提示词约束、RAG Advisor 接入、工具调用注册、会话记忆持久化、违禁词短路拦截、异常提示封装和健康检查接口开发。围绕 RAG 未命中、多轮记忆、空输入、非法 chatId、工具调用和安全拦截等场景编写自动化测试与手动评测用例，提升系统稳定性和可验证性。

项目亮点：

- 设计 `/chat` 与 `/chat/stream` 两套接口，支持同步问答和 SSE 流式响应，提升前端接入体验。
- 基于 Spring AI Advisor 机制接入 RAG、会话记忆、日志和违禁词拦截，实现可组合的模型调用链路。
- 通过 `@Tool` 注解接入任务、学习计划、长期记忆等工具，使 Agent 能够从“回答问题”扩展到“执行操作”。
- 使用 pgvector 保存长期记忆并支持相似度检索，为个性化问答和跨轮偏好记忆提供基础能力。
- 对会话文件名做白名单校验，避免非法 `chatId` 导致路径穿越风险。

2026.04 ~ 2026.04  AI Agent 本地 pgvector 与评测体系完善

项目描述：围绕 MostarManus 的本地知识增强与质量验证能力进行补强，新增 local profile 下的 PostgreSQL / pgvector 配置、健康检查文档和最小评测集，降低本地调试和回归验证成本。

职责描述：负责整理本地启动方式、pgvector 健康检查、业务数据检查和评测流程，补充普通 Chat、SSE 流式接口、RAG 未命中、多轮记忆、安全拦截和参数校验等验证用例，并将工具调用说明沉淀为项目文档，方便后续扩展新工具与排查问题。
