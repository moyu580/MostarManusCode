package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Data;

import java.time.Instant;

@Data
public class SyncRecord {
    private Long id;
    private String sourceType;
    private String sourcePath;
    private String contentHash;
    private Instant fileLastModified;
    private int chunkCount;
    private String chunkIds;
    private Instant indexedAt;
}
