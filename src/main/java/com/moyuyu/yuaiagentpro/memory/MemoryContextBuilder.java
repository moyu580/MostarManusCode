package com.moyuyu.yuaiagentpro.memory;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "app.memory.structured", name = "enabled", havingValue = "true")
public class MemoryContextBuilder {

    private final MemoryRetriever retriever;

    public String build(String chatId, String query, int limit, int maxChars) {
        List<MemoryItem> memories = retriever.retrieve(chatId, query, limit);
        if (memories.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        for (MemoryItem memory : memories) {
            if (!context.isEmpty()) {
                context.append("\n");
            }
            context.append("- [")
                    .append(memory.getType())
                    .append("/")
                    .append(memory.getTitle())
                    .append("] ")
                    .append(memory.getContent());
        }
        String text = context.toString();
        return text.length() <= maxChars ? text : text.substring(text.length() - maxChars);
    }
}
