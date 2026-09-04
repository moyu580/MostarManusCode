package com.moyuyu.yuaiagentpro.palace;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FilePalaceStoreTest {

    @TempDir
    Path tempDir;

    @Test
    void shouldSaveAndDeduplicateTurns() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        FilePalaceStore store = new FilePalaceStore(objectMapper, tempDir.resolve("drawers"), tempDir.resolve("index"));

        PalaceTurnDrawer drawer = PalaceTurnDrawer.builder()
                .id("drawer-1")
                .chatId("test-001")
                .wingKey("career")
                .roomKey("career-java")
                .userText("我准备秋招")
                .assistantText("好的")
                .rawText("User: 我准备秋招\nAssistant: 好的")
                .contentHash("hash-1")
                .occurredAt(Instant.now())
                .build();
        PalaceIndexRecord index = PalaceIndexRecord.builder()
                .drawerId("drawer-1")
                .chatId("test-001")
                .wingKey("career")
                .roomKey("career-java")
                .summary("我准备秋招 | 好的")
                .keywords(List.of("秋招", "java"))
                .anchors(List.of("用户目标：我准备秋招"))
                .importance(4)
                .contentHash("hash-1")
                .occurredAt(Instant.now())
                .build();

        assertTrue(store.saveTurn(drawer, index));
        assertFalse(store.saveTurn(drawer, index));
        assertEquals(1, store.loadIndices("test-001").size());
        assertEquals(1, store.loadDrawers("test-001", List.of("drawer-1")).size());
    }
}
