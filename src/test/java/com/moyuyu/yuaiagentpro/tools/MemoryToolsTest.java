package com.moyuyu.yuaiagentpro.tools;

import com.moyuyu.yuaiagentpro.memory.MemoryItem;
import com.moyuyu.yuaiagentpro.memory.MemoryRepository;
import com.moyuyu.yuaiagentpro.memory.MemoryRetriever;
import org.junit.jupiter.api.Test;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MemoryToolsTest {

    @Test
    void shouldSaveMemoryWithConversationMetadataAndLengthLimit() {
        VectorStore vectorStore = mock(VectorStore.class);
        MemoryTools tools = new MemoryTools(provider(vectorStore), emptyProvider(), emptyProvider());
        String memory = "x".repeat(1200);

        String result = tools.saveUserMemory("chat-a", memory, "goal");

        var documents = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(vectorStore).add(documents.capture());
        Document document = (Document) documents.getValue().get(0);
        assertEquals(1000, document.getText().length());
        assertEquals("user_memory", document.getMetadata().get("type"));
        assertEquals("chat-a", document.getMetadata().get("chat_id"));
        assertTrue(result.startsWith("长期记忆已保存：id="));
    }

    @Test
    void shouldSearchOnlyMemoriesFromRequestedConversation() {
        VectorStore vectorStore = mock(VectorStore.class);
        MemoryTools tools = new MemoryTools(provider(vectorStore), emptyProvider(), emptyProvider());
        when(vectorStore.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(
                document("其他会话", "user_memory", "chat-b"),
                document("知识库内容", "knowledge", "chat-a"),
                document("当前会话记忆", "user_memory", "chat-a")
        ));

        String result = tools.searchUserMemory("目标", "chat-a", 5);

        assertTrue(result.contains("当前会话记忆"));
        assertFalse(result.contains("其他会话"));
        assertFalse(result.contains("知识库内容"));
    }

    @Test
    void shouldRejectUnsafeConversationId() {
        VectorStore vectorStore = mock(VectorStore.class);
        MemoryTools tools = new MemoryTools(provider(vectorStore), emptyProvider(), emptyProvider());

        assertThrows(IllegalArgumentException.class, () -> tools.saveUserMemory("../other", "memory", null));
        assertThrows(IllegalArgumentException.class, () -> tools.searchUserMemory("query", "中文", 5));
    }

    @Test
    void shouldUseStructuredRepositoryInsteadOfVectorStoreWhenEnabled() {
        VectorStore vectorStore = mock(VectorStore.class);
        MemoryRepository repository = mock(MemoryRepository.class);
        MemoryRetriever retriever = mock(MemoryRetriever.class);
        when(repository.isAvailable()).thenReturn(true);
        when(retriever.retrieve("chat-a", "目标", 5)).thenReturn(List.of(MemoryItem.builder()
                .title("用户目标")
                .content("准备后端求职")
                .build()));
        MemoryTools tools = new MemoryTools(provider(vectorStore), provider(repository), provider(retriever));

        tools.saveUserMemory("chat-a", "准备后端求职", "goal");
        String result = tools.searchUserMemory("目标", "chat-a", 5);

        verify(repository).saveAll(any());
        verify(vectorStore, org.mockito.Mockito.never()).add(any());
        assertTrue(result.contains("准备后端求职"));
    }

    private Document document(String text, String type, String chatId) {
        return Document.builder()
                .text(text)
                .metadata(java.util.Map.of("type", type, "chat_id", chatId))
                .build();
    }

    private <T> ObjectProvider<T> provider(T value) {
        return new ObjectProvider<>() {
            @Override
            public T getObject(Object... args) {
                return value;
            }

            @Override
            public T getIfAvailable() {
                return value;
            }

            @Override
            public T getIfUnique() {
                return value;
            }

            @Override
            public T getObject() {
                return value;
            }
        };
    }

    private <T> ObjectProvider<T> emptyProvider() {
        return provider(null);
    }
}
