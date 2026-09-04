package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Builder;
import lombok.Data;

import java.util.Map;

@Data
@Builder
public class KnowledgeChunk {
    private String chunkId;
    private String chunkText;
    private int chunkIndex;
    private Map<String, Object> metadata;
}
