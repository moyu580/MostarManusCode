package com.moyuyu.yuaiagentpro.tools;

import cn.hutool.crypto.digest.DigestUtil;
import com.moyuyu.yuaiagentpro.memory.MemoryItem;
import com.moyuyu.yuaiagentpro.memory.MemoryRepository;
import com.moyuyu.yuaiagentpro.memory.MemoryRetriever;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

@Slf4j
@Component
public class MemoryTools {

    private static final int MAX_MEMORY_LENGTH = 1000;
    private static final Pattern SAFE_CHAT_ID = Pattern.compile("^[a-zA-Z0-9_-]{1,128}$");

    private final ObjectProvider<VectorStore> vectorStoreProvider;
    private final ObjectProvider<MemoryRepository> memoryRepositoryProvider;
    private final ObjectProvider<MemoryRetriever> memoryRetrieverProvider;

    public MemoryTools(ObjectProvider<VectorStore> vectorStoreProvider,
                       ObjectProvider<MemoryRepository> memoryRepositoryProvider,
                       ObjectProvider<MemoryRetriever> memoryRetrieverProvider) {
        this.vectorStoreProvider = vectorStoreProvider;
        this.memoryRepositoryProvider = memoryRepositoryProvider;
        this.memoryRetrieverProvider = memoryRetrieverProvider;
    }

    @Tool(description = "Save a long-term user memory. Uses structured PostgreSQL memory when enabled, with pgvector fallback for legacy/local mode.")
    public String saveUserMemory(
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Memory text to remember") String memory,
            @ToolParam(description = "Optional memory category", required = false) String category) {
        VectorStore vectorStore = vectorStore();
        String normalizedChatId = chatId == null || chatId.isBlank() ? "default" : chatId.trim();
        if (memory == null || memory.isBlank()) {
            throw new IllegalArgumentException("memory is required");
        }
        validateChatId(normalizedChatId);
        String normalizedMemory = memory.trim();
        if (normalizedMemory.length() > MAX_MEMORY_LENGTH) {
            normalizedMemory = normalizedMemory.substring(0, MAX_MEMORY_LENGTH);
        }
        String id = UUID.randomUUID().toString();

        MemoryRepository memoryRepository = structuredMemoryRepository();
        if (memoryRepository != null) {
            String type = normalizeType(category);
            MemoryItem item = MemoryItem.builder()
                    .id(id)
                    .chatId(normalizedChatId)
                    .type(type)
                    .title(titleForType(type))
                    .content(normalizedMemory)
                    .importance(5)
                    .confidence(1.0)
                    .tags(category == null || category.isBlank() ? type : category.trim())
                    .source("tool")
                    .contentHash(DigestUtil.sha256Hex(type + "|" + normalizedMemory))
                    .build();
            memoryRepository.saveAll(List.of(item));
            log.info("Tool called: saveUserMemory, structured=true, id={}, chatId={}", id, normalizedChatId);
            return "长期记忆已保存：id=" + id;
        }

        Document document = Document.builder()
                .id(id)
                .text(normalizedMemory)
                .metadata(Map.of(
                        "type", "user_memory",
                        "chat_id", normalizedChatId,
                        "category", category == null || category.isBlank() ? "general" : category.trim()
                ))
                .build();
        vectorStore.add(List.of(document));
        log.info("Tool called: saveUserMemory, id={}, chatId={}", id, normalizedChatId);
        return "长期记忆已保存：id=" + id;
    }

    @Tool(description = "Search long-term user memories for one conversation. Uses structured PostgreSQL memory when enabled, with pgvector fallback for legacy/local mode.")
    public String searchUserMemory(
            @ToolParam(description = "Search query") String query,
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Maximum number of memories to return", required = false) Integer limit) {
        if (query == null || query.isBlank()) {
            throw new IllegalArgumentException("query is required");
        }
        String normalizedChatId = chatId == null || chatId.isBlank() ? "default" : chatId.trim();
        validateChatId(normalizedChatId);
        int topK = limit == null ? 5 : Math.max(1, Math.min(limit, 20));

        MemoryRepository memoryRepository = structuredMemoryRepository();
        MemoryRetriever memoryRetriever = memoryRetrieverProvider.getIfAvailable();
        if (memoryRepository != null && memoryRetriever != null) {
            return formatStructuredMemories(memoryRetriever.retrieve(normalizedChatId, query.trim(), topK));
        }

        VectorStore vectorStore = vectorStore();
        List<Document> documents = vectorStore.similaritySearch(SearchRequest.builder()
                .query(query.trim())
                .topK(Math.min(Math.max(topK * 8, 20), 100))
                .similarityThresholdAll()
                .build());
        List<Document> matchingDocuments = documents == null ? List.of() : documents.stream()
                .filter(document -> document.getMetadata() != null)
                .filter(document -> "user_memory".equals(document.getMetadata().get("type")))
                .filter(document -> normalizedChatId.equals(String.valueOf(document.getMetadata().get("chat_id"))))
                .limit(topK)
                .toList();
        if (matchingDocuments.isEmpty()) {
            return "没有找到相关长期记忆。";
        }
        StringBuilder result = new StringBuilder("相关长期记忆：");
        for (Document document : matchingDocuments) {
            result.append("\n- ").append(document.getText());
        }
        return result.toString();
    }

    private String formatStructuredMemories(List<MemoryItem> memories) {
        if (memories == null || memories.isEmpty()) {
            return "没有找到相关长期记忆。";
        }
        StringBuilder result = new StringBuilder("相关长期记忆：");
        for (MemoryItem memory : memories) {
            result.append("\n- ")
                    .append(memory.getTitle())
                    .append("：")
                    .append(memory.getContent());
        }
        return result.toString();
    }

    private MemoryRepository structuredMemoryRepository() {
        MemoryRepository repository = memoryRepositoryProvider.getIfAvailable();
        return repository != null && repository.isAvailable() ? repository : null;
    }

    private String normalizeType(String category) {
        if (category == null || category.isBlank()) {
            return "fact";
        }
        return switch (category.trim().toLowerCase()) {
            case "profile", "goal", "preference", "project", "fact", "decision" -> category.trim().toLowerCase();
            default -> "fact";
        };
    }

    private String titleForType(String type) {
        return switch (type) {
            case "profile" -> "用户背景";
            case "goal" -> "用户目标";
            case "preference" -> "用户偏好";
            case "project" -> "项目背景";
            case "decision" -> "对话决策";
            default -> "长期事实";
        };
    }

    private void validateChatId(String chatId) {
        if (!SAFE_CHAT_ID.matcher(chatId).matches()) {
            throw new IllegalArgumentException("chatId may only contain letters, digits, underscore, and hyphen");
        }
    }

    private VectorStore vectorStore() {
        VectorStore vectorStore = vectorStoreProvider.getIfAvailable();
        if (vectorStore == null) {
            throw new IllegalStateException("pgvector memory tools are disabled. Start with local profile and app.pgvector.enabled=true.");
        }
        return vectorStore;
    }
}
