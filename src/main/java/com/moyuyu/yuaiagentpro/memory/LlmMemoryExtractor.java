package com.moyuyu.yuaiagentpro.memory;

import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "app.memory.structured", name = "extractor", havingValue = "llm")
public class LlmMemoryExtractor implements MemoryExtractor {

    private static final int MAX_CONTENT_LENGTH = 500;
    private static final int MAX_EXTRACT_INPUT_LENGTH = 1200;

    private final OpenAiChatModel chatModel;
    private final ObjectMapper objectMapper;

    @Override
    public List<MemoryItem> extract(String chatId, String userMessage, String assistantMessage) {
        if (chatId == null || chatId.isBlank() || userMessage == null || userMessage.isBlank()) {
            return List.of();
        }

        String response = chatModel.call(buildPrompt(
                limitText(userMessage, MAX_EXTRACT_INPUT_LENGTH),
                limitText(assistantMessage, MAX_EXTRACT_INPUT_LENGTH)));
        String json = extractJsonArray(response);
        if (json.isBlank()) {
            return List.of();
        }

        try {
            List<ExtractedMemory> extracted = objectMapper.readValue(json, new TypeReference<>() {
            });
            return extracted.stream()
                    .filter(memory -> StrUtil.isNotBlank(memory.getContent()))
                    .limit(8)
                    .map(memory -> toMemoryItem(chatId, memory, userMessage))
                    .toList();
        } catch (Exception e) {
            log.warn("Failed to parse LLM memory extraction result: {}", response, e);
            return List.of();
        }
    }

    private String buildPrompt(String userMessage, String assistantMessage) {
        return """
                You are a memory extraction engine for an AI agent.
                Extract only information worth saving as long-term memory.
                Return a JSON array only. Do not include markdown or explanation.

                Memory types:
                - profile: stable user identity/background
                - goal: user goals, plans, intentions
                - preference: user preferences or dislikes
                - project: project/product/codebase facts
                - fact: explicit facts the user wants remembered
                - decision: decisions made in the conversation

                Rules:
                - Save durable facts, not temporary small talk.
                - Do not save sensitive secrets, API keys, passwords, or private credentials.
                - Use Chinese content if the user speaks Chinese.
                - importance is 1-5.
                - confidence is 0.0-1.0.
                - tags is a comma-separated string.
                - If nothing is worth saving, return [].

                Output JSON schema:
                [
                  {
                    "type": "profile|goal|preference|project|fact|decision",
                    "title": "short title",
                    "content": "memory content",
                    "importance": 1,
                    "confidence": 0.9,
                    "tags": "tag1,tag2"
                  }
                ]

                User message:
                %s

                Assistant answer:
                %s
                """.formatted(userMessage, assistantMessage == null ? "" : assistantMessage);
    }

    private MemoryItem toMemoryItem(String chatId, ExtractedMemory memory, String source) {
        String type = normalizeType(memory.getType());
        String title = StrUtil.blankToDefault(memory.getTitle(), defaultTitle(type));
        String content = memory.getContent().trim();
        if (content.length() > MAX_CONTENT_LENGTH) {
            content = content.substring(0, MAX_CONTENT_LENGTH);
        }
        int importance = Math.max(1, Math.min(memory.getImportance(), 5));
        double confidence = Math.max(0.0, Math.min(memory.getConfidence(), 1.0));
        if (confidence == 0.0) {
            confidence = 0.85;
        }
        String hash = DigestUtil.sha256Hex(type + "|" + title + "|" + content);

        return MemoryItem.builder()
                .id(UUID.randomUUID().toString())
                .chatId(chatId)
                .type(type)
                .title(title)
                .content(content)
                .importance(importance)
                .confidence(confidence)
                .tags(StrUtil.blankToDefault(memory.getTags(), type))
                .source(source)
                .contentHash(hash)
                .build();
    }

    private String extractJsonArray(String response) {
        if (response == null) {
            return "";
        }
        int start = response.indexOf('[');
        int end = response.lastIndexOf(']');
        if (start < 0 || end < start) {
            return "";
        }
        return response.substring(start, end + 1);
    }

    private String normalizeType(String type) {
        if (type == null) {
            return "fact";
        }
        return switch (type.trim().toLowerCase()) {
            case "profile", "goal", "preference", "project", "fact", "decision" -> type.trim().toLowerCase();
            default -> "fact";
        };
    }

    private String defaultTitle(String type) {
        return switch (type) {
            case "profile" -> "用户背景";
            case "goal" -> "用户目标";
            case "preference" -> "用户偏好";
            case "project" -> "项目背景";
            case "decision" -> "对话决策";
            default -> "长期记忆";
        };
    }

    private String limitText(String text, int maxChars) {
        if (text == null) {
            return "";
        }
        return text.length() <= maxChars ? text : text.substring(0, maxChars);
    }

    @Data
    private static class ExtractedMemory {
        private String type;
        private String title;
        private String content;
        private int importance = 3;
        private double confidence = 0.85;
        private String tags;
    }
}
