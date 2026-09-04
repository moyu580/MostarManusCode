package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Data
@Builder
public class KnowledgeDocument {
    private String sourcePath;
    private String docTitle;
    private String category;
    private List<String> tags;
    private String rawContent;
    private String contentHash;
    private Instant fileLastModified;
    private String audience;
    private String stage;
    private String goal;
    @Builder.Default
    private Map<String, Object> frontMatter = Map.of();
}
