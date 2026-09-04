package com.moyuyu.yuaiagentpro.knowledge;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

@Slf4j
@Repository
public class KnowledgeSyncRecordRepository {

    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;

    public KnowledgeSyncRecordRepository(ObjectProvider<JdbcTemplate> jdbcTemplateProvider) {
        this.jdbcTemplateProvider = jdbcTemplateProvider;
    }

    public void initializeTable() {
        jdbcTemplate().execute("""
                CREATE TABLE IF NOT EXISTS knowledge_sync_record (
                    id BIGSERIAL PRIMARY KEY,
                    source_type VARCHAR(32) NOT NULL,
                    source_path TEXT NOT NULL,
                    content_hash VARCHAR(128) NOT NULL,
                    file_last_modified TIMESTAMP,
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    chunk_ids TEXT,
                    indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (source_type, source_path)
                )
                """);
        log.info("knowledge_sync_record table ready");
    }

    public SyncRecord findBySourcePath(String sourceType, String sourcePath) {
        if (!isAvailable()) {
            return null;
        }
        initializeTable();
        List<SyncRecord> results = jdbcTemplate().query(
                "SELECT id, source_type, source_path, content_hash, file_last_modified, chunk_count, chunk_ids, indexed_at FROM knowledge_sync_record WHERE source_type = ? AND source_path = ?",
                (rs, rowNum) -> mapRecord(rs),
                sourceType, sourcePath);
        return results.isEmpty() ? null : results.get(0);
    }

    public void upsert(String sourceType, String sourcePath, String contentHash, Instant fileLastModified, int chunkCount, String chunkIds) {
        if (!isAvailable()) {
            return;
        }
        initializeTable();
        jdbcTemplate().update(
                "INSERT INTO knowledge_sync_record (source_type, source_path, content_hash, file_last_modified, chunk_count, chunk_ids, indexed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT (source_type, source_path) DO UPDATE SET content_hash = EXCLUDED.content_hash, file_last_modified = EXCLUDED.file_last_modified, chunk_count = EXCLUDED.chunk_count, chunk_ids = EXCLUDED.chunk_ids, indexed_at = CURRENT_TIMESTAMP",
                sourceType,
                sourcePath,
                contentHash,
                fileLastModified != null ? Timestamp.from(fileLastModified) : null,
                chunkCount,
                chunkIds);
    }

    public void deleteBySourcePath(String sourceType, String sourcePath) {
        if (!isAvailable()) {
            return;
        }
        initializeTable();
        jdbcTemplate().update(
                "DELETE FROM knowledge_sync_record WHERE source_type = ? AND source_path = ?",
                sourceType,
                sourcePath);
    }

    public List<String> findAllPaths(String sourceType) {
        if (!isAvailable()) {
            return List.of();
        }
        initializeTable();
        return jdbcTemplate().queryForList(
                "SELECT source_path FROM knowledge_sync_record WHERE source_type = ?",
                String.class,
                sourceType);
    }

    public int count() {
        if (!isAvailable()) {
            return 0;
        }
        initializeTable();
        Integer result = jdbcTemplate().queryForObject("SELECT COUNT(*) FROM knowledge_sync_record", Integer.class);
        return result != null ? result : 0;
    }

    public void deleteAll() {
        if (!isAvailable()) {
            return;
        }
        initializeTable();
        jdbcTemplate().execute("DELETE FROM knowledge_sync_record");
    }

    public boolean isAvailable() {
        return jdbcTemplateProvider.getIfAvailable() != null;
    }

    private SyncRecord mapRecord(java.sql.ResultSet rs) throws java.sql.SQLException {
        SyncRecord record = new SyncRecord();
        record.setId(rs.getLong("id"));
        record.setSourceType(rs.getString("source_type"));
        record.setSourcePath(rs.getString("source_path"));
        record.setContentHash(rs.getString("content_hash"));
        Timestamp modified = rs.getTimestamp("file_last_modified");
        record.setFileLastModified(modified != null ? modified.toInstant() : null);
        record.setChunkCount(rs.getInt("chunk_count"));
        record.setChunkIds(rs.getString("chunk_ids"));
        Timestamp indexed = rs.getTimestamp("indexed_at");
        record.setIndexedAt(indexed != null ? indexed.toInstant() : null);
        return record;
    }

    private JdbcTemplate jdbcTemplate() {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            throw new IllegalStateException("pgvector JDBC template is not available.");
        }
        return jdbcTemplate;
    }
}
