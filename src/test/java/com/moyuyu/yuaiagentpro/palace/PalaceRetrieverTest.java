package com.moyuyu.yuaiagentpro.palace;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PalaceRetrieverTest {

    @TempDir
    Path tempDir;

    @Test
    void shouldRetrieveRelevantDrawersBeyondRecentWindow() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        FilePalaceStore store = new FilePalaceStore(objectMapper, tempDir.resolve("drawers"), tempDir.resolve("index"));

        JdbcPalaceStore jdbcPalaceStore = new JdbcPalaceStore(emptyProvider(), emptyProvider());
        PalaceRetriever retriever = new PalaceRetriever(store, jdbcPalaceStore, new PalaceProperties());

        saveTurn(store, "drawer-1", "career", "career-java", "我准备 Java 后端秋招", List.of("用户目标：我准备 Java 后端秋招"), 5);
        saveTurn(store, "drawer-2", "project", "project-spring", "我项目里用了 Spring Boot", List.of("项目背景：我项目里用了 Spring Boot"), 4);
        saveTurn(store, "drawer-3", "learning", "learning-algo", "我最近在刷算法题", List.of("用户目标：我最近在刷算法题"), 3);

        PalaceRecallResult result = retriever.retrieve("test-001", "你还记得我准备什么秋招方向吗", 4, 6);

        assertFalse(result.getAnchors().isEmpty());
        assertFalse(result.getDrawers().isEmpty());
        assertTrue(result.getDrawers().stream().anyMatch(drawer -> drawer.getRawText().contains("Java 后端秋招")));
    }

    @Test
    void shouldLoadDrawersFromDatabaseWhenDatabaseIsPrimary() {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        FilePalaceStore fileStore = new FilePalaceStore(objectMapper, tempDir.resolve("drawers-db"), tempDir.resolve("index-db"));
        JdbcPalaceStore jdbcStore = mock(JdbcPalaceStore.class);
        PalaceRetriever retriever = new PalaceRetriever(fileStore, jdbcStore, new PalaceProperties());

        Instant now = Instant.now();
        PalaceTurnDrawer drawer = drawer("drawer-db", "career", "career-java", "我准备 Java 后端秋招", now);
        PalaceIndexRecord index = index("drawer-db", "career", "career-java", "我准备 Java 后端秋招", now);
        when(jdbcStore.isAvailable()).thenReturn(true);
        when(jdbcStore.findByChatId(eq("test-db"), anyInt())).thenReturn(List.of(index));
        when(jdbcStore.semanticSearchDrawerIds(eq("test-db"), eq("秋招"), anyInt())).thenReturn(List.of());
        when(jdbcStore.loadDrawers(eq("test-db"), anyCollection())).thenReturn(List.of(drawer));

        PalaceRecallResult result = retriever.retrieve("test-db", "我准备什么秋招方向", 4, 6);

        assertTrue(result.getDrawers().stream().anyMatch(item -> item.getId().equals("drawer-db")));
    }

    @Test
    void shouldSkipSemanticSearchWhenVectorRecallIsDisabled() {
        JdbcPalaceStore jdbcStore = mock(JdbcPalaceStore.class);
        PalaceProperties properties = new PalaceProperties();
        properties.getPalace().setVectorEnabled(false);
        PalaceRetriever retriever = new PalaceRetriever(
                mock(FilePalaceStore.class), jdbcStore, properties);

        when(jdbcStore.isAvailable()).thenReturn(true);
        when(jdbcStore.findByChatId(eq("chat"), anyInt())).thenReturn(List.of(
                PalaceIndexRecord.builder()
                        .drawerId("drawer")
                        .chatId("chat")
                        .wingKey("general")
                        .roomKey("general")
                        .summary("问题")
                        .keywords(List.of("问题"))
                        .anchors(List.of("问题"))
                        .importance(1)
                        .occurredAt(Instant.now())
                        .build()));

        retriever.retrieve("chat", "问题", 2, 2);

        org.mockito.Mockito.verify(jdbcStore, org.mockito.Mockito.never())
                .semanticSearchDrawerIds(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.anyString(), anyInt());
    }

    private void saveTurn(FilePalaceStore store,
                          String drawerId,
                          String wingKey,
                          String roomKey,
                          String userText,
                          List<String> anchors,
                          int importance) {
        Instant now = Instant.now();
        PalaceTurnDrawer drawer = PalaceTurnDrawer.builder()
                .id(drawerId)
                .chatId("test-001")
                .wingKey(wingKey)
                .roomKey(roomKey)
                .userText(userText)
                .assistantText("收到")
                .rawText("User: " + userText + "\nAssistant: 收到")
                .contentHash(drawerId)
                .occurredAt(now)
                .build();
        PalaceIndexRecord index = PalaceIndexRecord.builder()
                .drawerId(drawerId)
                .chatId("test-001")
                .wingKey(wingKey)
                .roomKey(roomKey)
                .summary(userText)
                .keywords(List.of("java", "秋招", "项目", "算法"))
                .anchors(anchors)
                .importance(importance)
                .contentHash(drawerId)
                .occurredAt(now)
                .build();
        store.saveTurn(drawer, index);
    }

    private PalaceTurnDrawer drawer(String id, String wingKey, String roomKey, String userText, Instant occurredAt) {
        return PalaceTurnDrawer.builder()
                .id(id)
                .chatId("test-db")
                .wingKey(wingKey)
                .roomKey(roomKey)
                .userText(userText)
                .assistantText("收到")
                .rawText("User: " + userText + "\nAssistant: 收到")
                .contentHash(id)
                .occurredAt(occurredAt)
                .build();
    }

    private PalaceIndexRecord index(String id, String wingKey, String roomKey, String summary, Instant occurredAt) {
        return PalaceIndexRecord.builder()
                .drawerId(id)
                .chatId("test-db")
                .wingKey(wingKey)
                .roomKey(roomKey)
                .summary(summary)
                .keywords(List.of("java", "秋招"))
                .anchors(List.of("用户目标：" + summary))
                .importance(5)
                .contentHash(id)
                .occurredAt(occurredAt)
                .build();
    }

    private <T> ObjectProvider<T> emptyProvider() {
        return new ObjectProvider<>() {
            @Override
            public T getObject(Object... args) {
                return null;
            }

            @Override
            public T getIfAvailable() {
                return null;
            }

            @Override
            public T getIfUnique() {
                return null;
            }

            @Override
            public T getObject() {
                return null;
            }
        };
    }
}
