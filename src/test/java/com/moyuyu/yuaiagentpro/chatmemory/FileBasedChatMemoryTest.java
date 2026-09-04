package com.moyuyu.yuaiagentpro.chatmemory;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FileBasedChatMemoryTest {

    @TempDir
    Path tempDir;

    @Test
    void shouldAcceptSafeConversationId() {
        FileBasedChatMemory chatMemory = new FileBasedChatMemory(tempDir.toString());

        assertDoesNotThrow(() -> chatMemory.get("test-001", 10));
        assertDoesNotThrow(() -> chatMemory.get("user_001", 10));
        assertDoesNotThrow(() -> chatMemory.get("550e8400-e29b-41d4-a716-446655440000", 10));
    }

    @Test
    void shouldRejectUnsafeConversationId() {
        FileBasedChatMemory chatMemory = new FileBasedChatMemory(tempDir.toString());

        assertThrows(IllegalArgumentException.class, () -> chatMemory.get("../abc", 10));
        assertThrows(IllegalArgumentException.class, () -> chatMemory.get("a/b", 10));
        assertThrows(IllegalArgumentException.class, () -> chatMemory.get("a\\b", 10));
        assertThrows(IllegalArgumentException.class, () -> chatMemory.get("中文会话", 10));
    }

    @Test
    void shouldBuildRecentConversationContext() {
        FileBasedChatMemory chatMemory = new FileBasedChatMemory(tempDir.toString());

        chatMemory.appendUserMessage("test-001", "你好");
        chatMemory.appendAssistantMessage("test-001", "你好，我在。");

        String context = chatMemory.buildRecentConversationContext("test-001", 10);

        assertTrue(context.contains("User: 你好"));
        assertTrue(context.contains("Assistant: 你好，我在。"));
    }

    @Test
    void shouldBuildUserProfileContextFromUserMessages() {
        FileBasedChatMemory chatMemory = new FileBasedChatMemory(tempDir.toString());

        chatMemory.appendUserMessage("test-001", "我叫张三，是大三学生。");
        chatMemory.appendAssistantMessage("test-001", "收到。");
        chatMemory.appendUserMessage("test-001", "我想准备 Java 后端秋招。");

        String context = chatMemory.buildUserProfileContext("test-001", 500);

        assertTrue(context.contains("- 我叫张三，是大三学生。"));
        assertTrue(context.contains("- 我想准备 Java 后端秋招。"));
    }

    @Test
    void shouldPreserveMessagesWhenSameConversationIsWrittenConcurrently() throws Exception {
        FileBasedChatMemory chatMemory = new FileBasedChatMemory(tempDir.toString());
        ExecutorService executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<Void>> tasks = java.util.stream.IntStream.range(0, 24)
                    .mapToObj(index -> (Callable<Void>) () -> {
                        chatMemory.appendUserMessage("concurrent-chat", "消息-" + index);
                        return null;
                    })
                    .toList();
            executor.invokeAll(tasks);
        } finally {
            executor.shutdownNow();
        }

        List<org.springframework.ai.chat.messages.Message> messages = chatMemory.get("concurrent-chat", 100);
        assertEquals(24, messages.size());
        assertEquals(24, messages.stream().map(org.springframework.ai.chat.messages.Message::getText).distinct().count());
    }
}
