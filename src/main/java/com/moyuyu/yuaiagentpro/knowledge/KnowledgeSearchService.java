package com.moyuyu.yuaiagentpro.knowledge;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeSearchService {

    private final ObjectProvider<VectorStore> vectorStoreProvider;
    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;
    private final KnowledgeProperties properties;
    private final KnowledgeSyncRecordRepository syncRecordRepo;
    private final Environment environment;

    public List<SearchResult> search(String query, Integer limit) {
        if (!properties.isEnabled() || query == null || query.isBlank()) {
            return List.of();
        }

        VectorStore vectorStore = vectorStoreProvider.getIfAvailable();
        if (vectorStore == null) {
            log.warn("Knowledge search skipped because pgvector is not available");
            return List.of();
        }

        int topK = limit != null ? Math.max(1, limit) : properties.getSearch().getTopK();
        int candidateK = Math.min(Math.max(topK * 4, topK), 40);
        double threshold = properties.getSearch().getSimilarityThreshold();

        List<Document> documents = vectorStore.similaritySearch(SearchRequest.builder()
                .query(query.trim())
                .topK(candidateK)
                .similarityThreshold(threshold)
                .build());

        List<SearchResult> results = new ArrayList<>();
        for (Document document : documents) {
            Map<String, Object> metadata = document.getMetadata();
            if (metadata == null || !"knowledge".equals(metadata.get("type"))) {
                continue;
            }

            SearchResult result = new SearchResult();
            result.setTitle(Objects.toString(metadata.get("doc_title"), "Unknown"));
            result.setSourcePath(Objects.toString(metadata.get("source_path"), ""));
            result.setCategory(Objects.toString(metadata.get("category"), ""));
            result.setChunkIndex(metadata.get("chunk_index") instanceof Number number ? number.intValue() : -1);
            result.setContent(document.getText());
            result.setScore(Objects.toString(metadata.get("distance"), null));
            results.add(result);

            if (results.size() >= topK) {
                break;
            }
        }
        return results;
    }

    public Map<String, Object> stats() {
        return Map.ofEntries(
                Map.entry("enabled", properties.isEnabled()),
                Map.entry("source", properties.getSource()),
                Map.entry("rootPath", properties.getLocal().getRootPath()),
                Map.entry("targetChars", properties.getChunk().getTargetChars()),
                Map.entry("maxChars", properties.getChunk().getMaxChars()),
                Map.entry("minChars", properties.getChunk().getMinChars()),
                Map.entry("overlapChars", properties.getChunk().getOverlapChars()),
                Map.entry("topK", properties.getSearch().getTopK()),
                Map.entry("similarityThreshold", properties.getSearch().getSimilarityThreshold()),
                Map.entry("indexedFiles", syncRecordRepo.count()),
                Map.entry("indexedChunks", countIndexedChunks())
        );
    }

    private int countIndexedChunks() {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            return 0;
        }
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + vectorTableName() + " WHERE metadata->>'type' = 'knowledge'",
                Integer.class);
        return count != null ? count : 0;
    }

    private String vectorTableName() {
        String tableName = environment.getProperty("app.pgvector.table-name", "vector_store");
        if (!tableName.matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?")) {
            throw new IllegalArgumentException("Invalid pgvector table name: " + tableName);
        }
        return tableName;
    }
}
