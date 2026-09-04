package com.moyuyu.yuaiagentpro.app;

import com.moyuyu.yuaiagentpro.map.AmapPlaceSearchService;
import com.moyuyu.yuaiagentpro.memory.MemoryContextBuilder;
import com.moyuyu.yuaiagentpro.memory.MemoryExtractor;
import com.moyuyu.yuaiagentpro.memory.MemoryRepository;
import com.moyuyu.yuaiagentpro.palace.MemoryMode;
import com.moyuyu.yuaiagentpro.palace.PalaceContextBuilder;
import com.moyuyu.yuaiagentpro.palace.PalaceProperties;
import com.moyuyu.yuaiagentpro.palace.PalaceRecallResult;
import com.moyuyu.yuaiagentpro.palace.PalaceWriter;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.beans.factory.ObjectProvider;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MostarManusPromptTest {

    @Test
    void systemPromptTargetsMostarManusAssistant() {
        assertTrue(MostarManus.SYSTEM_PROMPT.contains("practical AI assistant for mostarmanus.ink"));
        assertTrue(MostarManus.SYSTEM_PROMPT.contains("Never expose retrieval internals"));
        assertTrue(MostarManus.SYSTEM_PROMPT.contains("uploaded images or screenshots"));
    }

    @Test
    void structuredModeUsesDedicatedMemoryPrompt() throws Exception {
        MemoryContextBuilder memoryContextBuilder = mock(MemoryContextBuilder.class);
        when(memoryContextBuilder.build("chat-1", "当前问题", 8, 1400)).thenReturn("用户长期目标：准备后端求职");

        MostarManus manus = new MostarManus(
                mock(OpenAiChatModel.class),
                new PalaceProperties(),
                mock(PalaceContextBuilder.class),
                mock(PalaceWriter.class),
                provider(memoryContextBuilder),
                emptyProvider(),
                emptyProvider(),
                emptyProvider(),
                emptyProvider(),
                emptyProvider());

        Method method = MostarManus.class.getDeclaredMethod(
                "buildPromptWithContext", String.class, String.class, MemoryMode.class, ResponseStyle.class, List.class);
        method.setAccessible(true);
        String prompt = (String) method.invoke(manus, "当前问题", "chat-1", MemoryMode.STRUCTURED, ResponseStyle.BALANCED, List.of());

        assertTrue(prompt.contains("Structured long-term memory:"));
        assertTrue(prompt.contains("用户长期目标：准备后端求职"));
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
