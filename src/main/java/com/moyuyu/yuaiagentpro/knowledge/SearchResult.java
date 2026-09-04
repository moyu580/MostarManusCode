package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Data;

@Data
public class SearchResult {
    private String title;
    private String sourcePath;
    private String category;
    private int chunkIndex;
    private String content;
    private String score;
}
