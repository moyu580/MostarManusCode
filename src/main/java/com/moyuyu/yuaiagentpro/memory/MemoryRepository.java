package com.moyuyu.yuaiagentpro.memory;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;

@Slf4j
@Repository
@ConditionalOnProperty(prefix = "app.memory.structured", name = "enabled", havingValue = "true")
public class MemoryRepository {

    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;

    public MemoryRepository(ObjectProvider<JdbcTemplate> jdbcTemplateProvider) {
        this.jdbcTemplateProvider = jdbcTemplateProvider;
    }

    public boolean isAvailable() {
        return jdbcTemplateProvider.getIfAvailable() != null;
    }

    public void saveAll(List<MemoryItem> items) {
        if (!isAvailable() || items == null || items.isEmpty()) {
            return;
        }
        ensureSchema();
        for (MemoryItem item : items) {
            save(item);
        }
    }

    public List<MemoryItem> findByChatId(String chatId, int limit) {
        if (!isAvailable()) {
            return List.of();
        }
        ensureSchema();
        return jdbcTemplate().query("""
                        select id, chat_id, type, title, content, importance, confidence, tags, source,
                               content_hash, created_at, updated_at, last_accessed_at
                        from agent_memory_items
                        where chat_id = ?
                        order by importance desc, updated_at desc
                        limit ?
                        """,
                this::mapRow,
                chatId,
                Math.max(1, Math.min(limit, 200)));
    }

    public void touch(List<MemoryItem> items) {
        if (!isAvailable() || items == null || items.isEmpty()) {
            return;
        }
        for (MemoryItem item : items) {
            jdbcTemplate().update("update agent_memory_items set last_accessed_at = now() where id = ?", item.getId());
        }
    }

    public boolean deleteById(String id) {
        if (!isAvailable()) {
            return false;
        }
        return jdbcTemplate().update("delete from agent_memory_items where id = ?", id) > 0;
    }

    public int deleteByChatId(String chatId) {
        if (!isAvailable()) {
            return 0;
        }
        return jdbcTemplate().update("delete from agent_memory_items where chat_id = ?", chatId);
    }

    private void save(MemoryItem item) {
        jdbcTemplate().update("""
                        insert into agent_memory_items (
                            id, chat_id, type, title, content, importance, confidence, tags, source,
                            content_hash, created_at, updated_at
                        )
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
                        on conflict (chat_id, content_hash) do update set
                            type = excluded.type,
                            title = excluded.title,
                            content = excluded.content,
                            importance = greatest(agent_memory_items.importance, excluded.importance),
                            confidence = greatest(agent_memory_items.confidence, excluded.confidence),
                            tags = excluded.tags,
                            source = excluded.source,
                            updated_at = now()
                        """,
                item.getId(),
                item.getChatId(),
                item.getType(),
                item.getTitle(),
                item.getContent(),
                item.getImportance(),
                item.getConfidence(),
                item.getTags(),
                item.getSource(),
                item.getContentHash());
    }

    private void ensureSchema() {
        jdbcTemplate().execute("""
                create table if not exists agent_memory_items (
                    id varchar(64) primary key,
                    chat_id varchar(128) not null,
                    type varchar(32) not null,
                    title varchar(255) not null,
                    content text not null,
                    importance integer not null default 3,
                    confidence double precision not null default 1.0,
                    tags text,
                    source text,
                    content_hash varchar(128) not null,
                    created_at timestamp not null,
                    updated_at timestamp not null,
                    last_accessed_at timestamp,
                    unique (chat_id, content_hash)
                )
                """);
        jdbcTemplate().execute("""
                create index if not exists idx_agent_memory_items_chat_id
                on agent_memory_items(chat_id)
                """);
    }

    private MemoryItem mapRow(ResultSet rs, int rowNum) throws SQLException {
        return MemoryItem.builder()
                .id(rs.getString("id"))
                .chatId(rs.getString("chat_id"))
                .type(rs.getString("type"))
                .title(rs.getString("title"))
                .content(rs.getString("content"))
                .importance(rs.getInt("importance"))
                .confidence(rs.getDouble("confidence"))
                .tags(rs.getString("tags"))
                .source(rs.getString("source"))
                .contentHash(rs.getString("content_hash"))
                .createdAt(toInstant(rs.getTimestamp("created_at")))
                .updatedAt(toInstant(rs.getTimestamp("updated_at")))
                .lastAccessedAt(toInstant(rs.getTimestamp("last_accessed_at")))
                .build();
    }

    private java.time.Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private JdbcTemplate jdbcTemplate() {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            throw new IllegalStateException("PostgreSQL memory repository is not available.");
        }
        return jdbcTemplate;
    }
}
