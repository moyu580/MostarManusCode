package com.moyuyu.yuaiagentpro.memory;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data
@Builder
public class MemoryItem {
    private String id;
    private String chatId;
    private String type;
    private String title;
    private String content;
    private int importance;
    private double confidence;
    private String tags;
    private String source;
    private String contentHash;
    private Instant createdAt;
    private Instant updatedAt;
    private Instant lastAccessedAt;
}
