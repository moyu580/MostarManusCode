package com.moyuyu.yuaiagentpro.knowledge;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class KnowledgeIngestionService {

    private static final String SOURCE_TYPE = "local_markdown";

    private final ObjectProvider<VectorStore> vectorStoreProvider;
    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;
    private final KnowledgeProperties properties;
    private final KnowledgeSource knowledgeSource;
    private final KnowledgeChunker chunker;
    private final AiKnowledgeSectionPlanner aiSectionPlanner;
    private final KnowledgeSyncRecordRepository syncRecordRepo;
    private final Environment environment;

    @EventListener(ApplicationReadyEvent.class)
    public void maybeReindexOnStartup() {
        if (properties.isEnabled() && properties.isReindexOnStartup() && vectorStoreAvailable() && jdbcAvailable()) {
            log.info("Knowledge reindex-on-startup enabled, starting reindex");
            reindex();
        }
    }

    public SyncResult sync() {
        long start = System.currentTimeMillis();
        SyncResult result = new SyncResult();

        if (!properties.isEnabled()) {
            log.info("Knowledge ingestion is disabled");
            return result.markSkipped("knowledge_disabled",
                    "Knowledge ingestion is disabled. Set app.knowledge.enabled=true to run sync.",
                    start);
        }
        if (!vectorStoreAvailable() || !jdbcAvailable() || !syncRecordRepo.isAvailable()) {
            String message = availabilityMessage("Knowledge ingestion skipped");
            log.warn(message);
            return result.markSkipped("pgvector_unavailable", message, start);
        }

        VectorStore vectorStore = vectorStore();
        List<KnowledgeDocument> documents = knowledgeSource.loadDocuments();
        result.setScannedFiles(documents.size());

        Set<String> scannedPaths = new HashSet<>();
        List<Document> docsToAdd = new ArrayList<>();
        List<PendingSyncRecord> pendingSyncRecords = new ArrayList<>();

        for (KnowledgeDocument document : documents) {
            scannedPaths.add(document.getSourcePath());
            SyncRecord existing = syncRecordRepo.findBySourcePath(SOURCE_TYPE, document.getSourcePath());

            if (existing == null) {
                List<KnowledgeChunk> chunks = chunkDocument(document);
                result.addIndexedFile(chunks.size());
                chunks.forEach(chunk -> docsToAdd.add(toSpringDocument(chunk)));
                pendingSyncRecords.add(PendingSyncRecord.from(document, chunks));
                continue;
            }

            if (!Objects.equals(existing.getContentHash(), document.getContentHash())) {
                deleteChunksForPath(document.getSourcePath());
                List<KnowledgeChunk> chunks = chunkDocument(document);
                result.addIndexedFile(chunks.size());
                chunks.forEach(chunk -> docsToAdd.add(toSpringDocument(chunk)));
                pendingSyncRecords.add(PendingSyncRecord.from(document, chunks));
                continue;
            }

            result.addSkippedFile();
        }

        if (!docsToAdd.isEmpty()) {
            addDocumentsInBatches(vectorStore, docsToAdd);
            pendingSyncRecords.forEach(record -> syncRecordRepo.upsert(
                    SOURCE_TYPE,
                    record.sourcePath(),
                    record.contentHash(),
                    record.fileLastModified(),
                    record.chunkCount(),
                    record.chunkIds()));
            log.info("Added {} knowledge chunks to vector store", docsToAdd.size());
        }

        for (String indexedPath : syncRecordRepo.findAllPaths(SOURCE_TYPE)) {
            if (!scannedPaths.contains(indexedPath)) {
                deleteChunksForPath(indexedPath);
                syncRecordRepo.deleteBySourcePath(SOURCE_TYPE, indexedPath);
                result.addDeletedFile();
            }
        }

        result.markSuccess("Knowledge sync completed", start);
        log.info("Knowledge sync completed: {}", result);
        return result;
    }

    public SyncResult reindex() {
        long start = System.currentTimeMillis();
        SyncResult result = new SyncResult();
        log.info("Starting full knowledge reindex");
        if (!properties.isEnabled()) {
            log.info("Knowledge reindex skipped because knowledge is disabled");
            return result.markSkipped("knowledge_disabled",
                    "Knowledge reindex is disabled. Set app.knowledge.enabled=true before reindex.",
                    start);
        }
        if (!vectorStoreAvailable() || !jdbcAvailable() || !syncRecordRepo.isAvailable()) {
            String message = availabilityMessage("Knowledge reindex skipped");
            log.warn(message);
            return result.markSkipped("pgvector_unavailable", message, start);
        }

        jdbcTemplate().update("DELETE FROM " + vectorTableName() + " WHERE metadata->>'type' = 'knowledge'");
        syncRecordRepo.deleteAll();
        return sync();
    }

    private List<KnowledgeChunk> chunkDocument(KnowledgeDocument document) {
        List<KnowledgeChunker.SemanticSection> semanticSections = aiSectionPlanner.plan(document);
        List<KnowledgeChunk> chunks = chunker.chunk(
                document,
                properties.getChunk().getTargetChars(),
                properties.getChunk().getMaxChars(),
                properties.getChunk().getMinChars(),
                properties.getChunk().getOverlapChars(),
                semanticSections);
        return enforceEmbeddingTextLimit(chunks, properties.getChunk().getEmbeddingMaxChars());
    }

    private List<KnowledgeChunk> enforceEmbeddingTextLimit(List<KnowledgeChunk> chunks, int maxChars) {
        int limit = Math.max(240, maxChars);
        List<KnowledgeChunk> limited = new ArrayList<>();
        for (KnowledgeChunk chunk : chunks) {
            String text = chunk.getChunkText();
            if (text == null || text.length() <= limit) {
                limited.add(chunk);
                continue;
            }

            String prefix = contextPrefix(chunk);
            String body = stripContextPrefix(text);
            int bodyLimit = Math.max(120, limit - prefix.length());
            int partIndex = 0;
            for (int start = 0; start < body.length(); start += bodyLimit) {
                int end = Math.min(body.length(), start + bodyLimit);
                Map<String, Object> metadata = new LinkedHashMap<>(chunk.getMetadata());
                metadata.put("chunk_index", limited.size());
                metadata.put("parent_chunk_id", chunk.getChunkId());
                metadata.put("split_part_index", partIndex);
                String partText = prefix + body.substring(start, end).strip();
                metadata.put("char_count", partText.length());
                limited.add(KnowledgeChunk.builder()
                        .chunkId(chunk.getChunkId() + ":part:" + partIndex)
                        .chunkText(partText)
                        .chunkIndex(limited.size())
                        .metadata(metadata)
                        .build());
                partIndex++;
            }
        }
        return limited;
    }

    private String contextPrefix(KnowledgeChunk chunk) {
        Map<String, Object> metadata = chunk.getMetadata();
        StringBuilder sb = new StringBuilder();
        appendContextLine(sb, "标题", metadata.get("doc_title"));
        appendContextLine(sb, "分类", metadata.get("category"));
        appendContextLine(sb, "标签", metadata.get("tags"));
        appendContextLine(sb, "适用人群", metadata.get("audience"));
        appendContextLine(sb, "阶段", metadata.get("stage"));
        appendContextLine(sb, "目标", metadata.get("goal"));
        appendContextLine(sb, "章节", metadata.get("heading_path"));
        sb.append("\n正文:\n");
        return sb.toString();
    }

    private void appendContextLine(StringBuilder sb, String label, Object value) {
        if (value == null || value.toString().isBlank()) {
            return;
        }
        sb.append(label).append(": ").append(value).append("\n");
    }

    private String stripContextPrefix(String text) {
        int markerIndex = text.indexOf("\n正文:\n");
        if (markerIndex >= 0) {
            return text.substring(markerIndex + "\n正文:\n".length()).strip();
        }
        return text.strip();
    }

    private void deleteChunksForPath(String sourcePath) {
        jdbcTemplate().update(
                "DELETE FROM " + vectorTableName()
                        + " WHERE metadata->>'type' = 'knowledge' AND metadata->>'source_path' = ?",
                sourcePath);
    }

    private Document toSpringDocument(KnowledgeChunk chunk) {
        Map<String, Object> metadata = new LinkedHashMap<>(chunk.getMetadata());
        metadata.put("chunk_id", chunk.getChunkId());
        return Document.builder()
                .id(stableUuid(chunk.getChunkId()))
                .text(chunk.getChunkText())
                .metadata(metadata)
                .build();
    }

    private String joinChunkIds(List<KnowledgeChunk> chunks) {
        return chunks.stream().map(KnowledgeChunk::getChunkId).collect(Collectors.joining(","));
    }

    private String stableUuid(String value) {
        return UUID.nameUUIDFromBytes(value.getBytes(StandardCharsets.UTF_8)).toString();
    }

    private void addDocumentsInBatches(VectorStore vectorStore, List<Document> documents) {
        int batchSize = Math.max(1, properties.getIngestion().getVectorAddBatchSize());
        for (int start = 0; start < documents.size(); start += batchSize) {
            int end = Math.min(start + batchSize, documents.size());
            vectorStore.add(documents.subList(start, end));
        }
    }

    private boolean vectorStoreAvailable() {
        return vectorStoreProvider.getIfAvailable() != null;
    }

    private boolean jdbcAvailable() {
        return jdbcTemplateProvider.getIfAvailable() != null;
    }

    private VectorStore vectorStore() {
        VectorStore vectorStore = vectorStoreProvider.getIfAvailable();
        if (vectorStore == null) {
            throw new IllegalStateException("pgvector vector store is not available.");
        }
        return vectorStore;
    }

    private JdbcTemplate jdbcTemplate() {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            throw new IllegalStateException("pgvector JDBC template is not available.");
        }
        return jdbcTemplate;
    }

    private String vectorTableName() {
        String tableName = environment.getProperty("app.pgvector.table-name", "vector_store");
        if (!tableName.matches("[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)?")) {
            throw new IllegalArgumentException("Invalid pgvector table name: " + tableName);
        }
        return tableName;
    }

    private String availabilityMessage(String prefix) {
        List<String> missing = new ArrayList<>();
        if (!vectorStoreAvailable()) {
            missing.add("VectorStore");
        }
        if (!jdbcAvailable()) {
            missing.add("JdbcTemplate");
        }
        if (!syncRecordRepo.isAvailable()) {
            missing.add("knowledge_sync_record repository");
        }
        return prefix + " because pgvector dependencies are not available: " + String.join(", ", missing)
                + ". Enable local profile, app.pgvector.enabled=true, and a valid embedding model.";
    }

    private record PendingSyncRecord(
            String sourcePath,
            String contentHash,
            java.time.Instant fileLastModified,
            int chunkCount,
            String chunkIds) {

        private static PendingSyncRecord from(KnowledgeDocument document, List<KnowledgeChunk> chunks) {
            return new PendingSyncRecord(
                    document.getSourcePath(),
                    document.getContentHash(),
                    document.getFileLastModified(),
                    chunks.size(),
                    joinChunkIds(chunks));
        }

        private static String joinChunkIds(List<KnowledgeChunk> chunks) {
            return chunks.stream().map(KnowledgeChunk::getChunkId).collect(Collectors.joining(","));
        }
    }

    @Data
    public static class SyncResult {
        private boolean success;
        private boolean skipped;
        private String reason = "";
        private String message = "";
        private int scannedFiles;
        private int indexedFiles;
        private int indexedChunks;
        private int skippedFiles;
        private int deletedFiles;
        private long elapsedMs;

        public SyncResult markSuccess(String message, long startMs) {
            this.success = true;
            this.skipped = false;
            this.reason = "";
            this.message = message;
            this.elapsedMs = System.currentTimeMillis() - startMs;
            return this;
        }

        public SyncResult markSkipped(String reason, String message, long startMs) {
            this.success = false;
            this.skipped = true;
            this.reason = reason;
            this.message = message;
            this.elapsedMs = System.currentTimeMillis() - startMs;
            return this;
        }

        public Map<String, Object> toResponseMap() {
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("success", success);
            response.put("skipped", skipped);
            response.put("reason", reason);
            response.put("message", message);
            response.put("scannedFiles", scannedFiles);
            response.put("indexedFiles", indexedFiles);
            response.put("indexedChunks", indexedChunks);
            response.put("skippedFiles", skippedFiles);
            response.put("deletedFiles", deletedFiles);
            response.put("elapsedMs", elapsedMs);
            return response;
        }

        public void addIndexedFile(int chunkCount) {
            indexedFiles++;
            indexedChunks += chunkCount;
        }

        public void addSkippedFile() {
            skippedFiles++;
        }

        public void addDeletedFile() {
            deletedFiles++;
        }
    }
}
