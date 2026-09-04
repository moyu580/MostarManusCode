package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@ConfigurationProperties(prefix = "app.knowledge")
@Component
@Data
public class KnowledgeProperties {
    private boolean enabled = false;
    private String source = "local";
    private Local local = new Local();
    private Chunk chunk = new Chunk();
    private Search search = new Search();
    private Ingestion ingestion = new Ingestion();
    private boolean reindexOnStartup = false;

    @Data
    public static class Local {
        private String rootPath = "data/knowledge";
    }

    @Data
    public static class Chunk {
        private int targetChars = 320;
        private int maxChars = 420;
        private int minChars = 120;
        private int overlapChars = 60;
        private int embeddingMaxChars = 420;
        private boolean skipTemplateFiles = true;
        private Ai ai = new Ai();
    }

    @Data
    public static class Ai {
        private boolean enabled = false;
        private String baseUrl = "https://api.siliconflow.cn";
        private String apiKey = "";
        private String model = "Qwen/Qwen3-8B";
        private int maxInputChars = 12000;
        private int maxOutputTokens = 1200;
        private int timeoutSeconds = 20;
    }

    @Data
    public static class Search {
        private int topK = 5;
        private double similarityThreshold = 0.65;
    }

    @Data
    public static class Ingestion {
        private int vectorAddBatchSize = 25;
    }
}
