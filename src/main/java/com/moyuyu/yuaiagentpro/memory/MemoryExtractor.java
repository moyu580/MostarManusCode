package com.moyuyu.yuaiagentpro.memory;

import java.util.List;

public interface MemoryExtractor {
    List<MemoryItem> extract(String chatId, String userMessage, String assistantMessage);
}
