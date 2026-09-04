package com.moyuyu.yuaiagentpro.knowledge;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.concurrent.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Component
@RequiredArgsConstructor
public class AiKnowledgeSectionPlanner {

    private static final Pattern SECTION_PATTERN = Pattern.compile(
            "<section>\\s*<title>(.*?)</title>\\s*<text>(.*?)</text>\\s*</section>",
            Pattern.DOTALL);

    private final KnowledgeProperties properties;
    private final ObjectProvider<RestClient.Builder> restClientBuilderProvider;
    private final ExecutorService executorService = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "ai-knowledge-section-planner");
        thread.setDaemon(true);
        return thread;
    });

    public List<KnowledgeChunker.SemanticSection> plan(KnowledgeDocument document) {
        KnowledgeProperties.Ai ai = properties.getChunk().getAi();
        if (!ai.isEnabled()) {
            return List.of();
        }
        if (!StringUtils.hasText(ai.getApiKey())) {
            log.warn("AI knowledge chunk planner is enabled but app.knowledge.chunk.ai.api-key is empty");
            return List.of();
        }

        String raw = document.getRawContent();
        if (!StringUtils.hasText(raw) || raw.length() > Math.max(2000, ai.getMaxInputChars())) {
            return List.of();
        }

        try {
            String output = callSiliconFlowWithTimeout(document, raw, ai);
            List<KnowledgeChunker.SemanticSection> sections = parseSections(output);
            if (sections.isEmpty()) {
                log.warn("AI knowledge chunk planner returned no parseable sections for {}", document.getSourcePath());
            }
            return sections;
        } catch (Exception e) {
            log.warn("AI knowledge chunk planner failed for {}, falling back to rule chunker: {}",
                    document.getSourcePath(), e.getMessage());
            return List.of();
        }
    }

    private String callSiliconFlowWithTimeout(KnowledgeDocument document, String raw, KnowledgeProperties.Ai ai)
            throws Exception {
        Future<String> future = executorService.submit(() -> callSiliconFlow(document, raw, ai));
        try {
            return future.get(Math.max(1, ai.getTimeoutSeconds()), TimeUnit.SECONDS);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new IllegalStateException("AI planner timed out after " + ai.getTimeoutSeconds() + "s", e);
        }
    }

    private String callSiliconFlow(KnowledgeDocument document, String raw, KnowledgeProperties.Ai ai) {
        String baseUrl = ai.getBaseUrl().replaceAll("/+$", "");
        RestClient.Builder builder = restClientBuilderProvider.getIfAvailable(RestClient::builder);
        RestClient client = builder.clone()
                .baseUrl(baseUrl)
                .defaultHeader("Authorization", "Bearer " + ai.getApiKey())
                .build();

        Map<String, Object> request = Map.of(
                "model", ai.getModel(),
                "temperature", 0,
                "max_tokens", ai.getMaxOutputTokens(),
                "messages", List.of(
                        Map.of(
                                "role", "system",
                                "content", """
                                        你是知识库切片助手。请把 Markdown 文档切成适合 RAG 检索的语义片段。
                                        规则：
                                        1. 不要总结、改写、翻译或补充事实，只能使用原文内容。
                                        2. 尽量保持原文标题、列表和表格结构完整。
                                        3. 每个片段应围绕一个明确问题或主题，避免切得过碎。
                                        4. 片段长度优先保持在 700-1800 个中文字符之间；短章节可以与相邻同主题内容合并。
                                        5. 输出必须只包含 XML-like 片段，不要解释。
                                        格式：
                                        <section>
                                        <title>片段标题</title>
                                        <text>原文片段</text>
                                        </section>
                                        """),
                        Map.of(
                                "role", "user",
                                "content", "文档标题：" + nullSafe(document.getDocTitle()) + "\n\nMarkdown 原文：\n" + raw)
                )
        );

        Map<?, ?> response = client.post()
                .uri("/v1/chat/completions")
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(Map.class);

        if (response == null) {
            return "";
        }
        Object choicesObj = response.get("choices");
        if (!(choicesObj instanceof List<?> choices) || choices.isEmpty()) {
            return "";
        }
        Object first = choices.get(0);
        if (!(first instanceof Map<?, ?> choice)) {
            return "";
        }
        Object messageObj = choice.get("message");
        if (!(messageObj instanceof Map<?, ?> message)) {
            return "";
        }
        Object content = message.get("content");
        return content == null ? "" : content.toString();
    }

    private List<KnowledgeChunker.SemanticSection> parseSections(String output) {
        if (!StringUtils.hasText(output)) {
            return List.of();
        }
        List<KnowledgeChunker.SemanticSection> sections = new ArrayList<>();
        Matcher matcher = SECTION_PATTERN.matcher(output);
        while (matcher.find()) {
            String title = cleanup(matcher.group(1));
            String text = cleanup(matcher.group(2));
            if (StringUtils.hasText(text)) {
                sections.add(new KnowledgeChunker.SemanticSection(title, text));
            }
        }
        return sections;
    }

    private String cleanup(String value) {
        return Objects.toString(value, "")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
                .strip();
    }

    private String nullSafe(String value) {
        return value == null ? "" : value;
    }
}
