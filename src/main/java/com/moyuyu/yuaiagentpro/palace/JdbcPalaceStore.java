package com.moyuyu.yuaiagentpro.palace;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Component
public class JdbcPalaceStore {

    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;
    private final ObjectProvider<VectorStore> vectorStoreProvider;
    private volatile boolean schemaInitialized;

    public JdbcPalaceStore(ObjectProvider<JdbcTemplate> jdbcTemplateProvider,
                           ObjectProvider<VectorStore> vectorStoreProvider) {
        this.jdbcTemplateProvider = jdbcTemplateProvider;
        this.vectorStoreProvider = vectorStoreProvider;
    }

    public boolean isAvailable() {
        return jdbcTemplateProvider.getIfAvailable() != null;
    }

    public void saveTurn(PalaceTurnDrawer drawer, PalaceIndexRecord index) {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            return;
        }
        ensureSchema(jdbcTemplate);
        jdbcTemplate.update("""
                        insert into agent_palace_drawers (
                            id, chat_id, wing_key, room_key, user_text, assistant_text, raw_text, content_hash, occurred_at, created_at
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                        on conflict (chat_id, content_hash) do nothing
                        """,
                drawer.getId(),
                drawer.getChatId(),
                drawer.getWingKey(),
                drawer.getRoomKey(),
                drawer.getUserText(),
                drawer.getAssistantText(),
                drawer.getRawText(),
                drawer.getContentHash(),
                Timestamp.from(drawer.getOccurredAt()));

        jdbcTemplate.update("""
                        insert into agent_palace_index (
                            drawer_id, chat_id, wing_key, room_key, summary, keywords, anchors, importance, content_hash, occurred_at, updated_at
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                        on conflict (drawer_id) do update set
                            wing_key = excluded.wing_key,
                            room_key = excluded.room_key,
                            summary = excluded.summary,
                            keywords = excluded.keywords,
                            anchors = excluded.anchors,
                            importance = excluded.importance,
                            updated_at = now()
                        """,
                index.getDrawerId(),
                index.getChatId(),
                index.getWingKey(),
                index.getRoomKey(),
                index.getSummary(),
                String.join(",", index.getKeywords()),
                String.join("\n", index.getAnchors()),
                index.getImportance(),
                index.getContentHash(),
                Timestamp.from(index.getOccurredAt()));

    }

    public List<PalaceIndexRecord> findByChatId(String chatId, int limit) {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            return List.of();
        }
        ensureSchema(jdbcTemplate);
        return jdbcTemplate.query("""
                        select drawer_id, chat_id, wing_key, room_key, summary, keywords, anchors, importance, content_hash, occurred_at
                        from agent_palace_index
                        where chat_id = ?
                        order by occurred_at desc
                        limit ?
                        """,
                this::mapIndex,
                chatId,
                Math.max(1, Math.min(limit, 200)));
    }

    public List<PalaceTurnDrawer> loadDrawers(String chatId, Collection<String> drawerIds) {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null || chatId == null || chatId.isBlank() || drawerIds == null || drawerIds.isEmpty()) {
            return List.of();
        }

        List<String> ids = drawerIds.stream()
                .filter(id -> id != null && !id.isBlank())
                .distinct()
                .toList();
        if (ids.isEmpty()) {
            return List.of();
        }

        ensureSchema(jdbcTemplate);
        String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
        List<Object> args = new ArrayList<>();
        args.add(chatId);
        args.addAll(ids);
        List<PalaceTurnDrawer> drawers = jdbcTemplate.query("""
                        select id, chat_id, wing_key, room_key, user_text, assistant_text, raw_text, content_hash, occurred_at
                        from agent_palace_drawers
                        where chat_id = ? and id in (PLACEHOLDERS)
                        """.replace("PLACEHOLDERS", placeholders),
                this::mapDrawer,
                args.toArray());

        Map<String, Integer> order = new LinkedHashMap<>();
        for (int i = 0; i < ids.size(); i++) {
            order.put(ids.get(i), i);
        }
        drawers.sort((left, right) -> Integer.compare(
                order.getOrDefault(left.getId(), Integer.MAX_VALUE),
                order.getOrDefault(right.getId(), Integer.MAX_VALUE)));
        return drawers;
    }

    public List<String> semanticSearchDrawerIds(String chatId, String query, int limit) {
        VectorStore vectorStore = vectorStoreProvider.getIfAvailable();
        if (vectorStore == null || query == null || query.isBlank()) {
            return List.of();
        }
        List<Document> documents = vectorStore.similaritySearch(SearchRequest.builder()
                .query(query.trim())
                .topK(Math.max(limit * 2, limit))
                .similarityThresholdAll()
                .build());
        if (documents == null || documents.isEmpty()) {
            return List.of();
        }
        return documents.stream()
                .filter(document -> "palace_drawer".equals(document.getMetadata().get("type")))
                .filter(document -> chatId.equals(document.getMetadata().get("chat_id")))
                .map(Document::getId)
                .distinct()
                .limit(limit)
                .toList();
    }

    public void saveVectorDocument(PalaceTurnDrawer drawer, PalaceIndexRecord index) {
        VectorStore vectorStore = vectorStoreProvider.getIfAvailable();
        if (vectorStore == null) {
            return;
        }
        try {
            Document document = Document.builder()
                    .id(drawer.getId())
                    .text(index.getSummary() + "\n" + drawer.getRawText())
                    .metadata(Map.of(
                            "type", "palace_drawer",
                            "chat_id", drawer.getChatId(),
                            "wing_key", drawer.getWingKey(),
                            "room_key", drawer.getRoomKey(),
                            "importance", index.getImportance(),
                            "keywords", String.join(",", index.getKeywords())
                    ))
                    .build();
            vectorStore.add(List.of(document));
        } catch (Exception e) {
            log.warn("Failed to write palace vector document, chatId={}, drawerId={}", drawer.getChatId(), drawer.getId(), e);
        }
    }

    private void ensureSchema(JdbcTemplate jdbcTemplate) {
        if (schemaInitialized) {
            return;
        }
        jdbcTemplate.execute("""
                create table if not exists agent_palace_drawers (
                    id varchar(64) primary key,
                    chat_id varchar(128) not null,
                    wing_key varchar(64) not null,
                    room_key varchar(128) not null,
                    user_text text not null,
                    assistant_text text not null,
                    raw_text text not null,
                    content_hash varchar(128) not null,
                    occurred_at timestamp not null,
                    created_at timestamp not null,
                    unique (chat_id, content_hash)
                )
                """);
        jdbcTemplate.execute("""
                create table if not exists agent_palace_index (
                    drawer_id varchar(64) primary key,
                    chat_id varchar(128) not null,
                    wing_key varchar(64) not null,
                    room_key varchar(128) not null,
                    summary text not null,
                    keywords text,
                    anchors text,
                    importance integer not null default 3,
                    content_hash varchar(128) not null,
                    occurred_at timestamp not null,
                    updated_at timestamp not null
                )
                """);
        jdbcTemplate.execute("""
                create index if not exists idx_agent_palace_index_chat_id
                on agent_palace_index(chat_id)
                """);
        schemaInitialized = true;
    }

    private PalaceIndexRecord mapIndex(ResultSet rs, int rowNum) throws SQLException {
        String anchors = rs.getString("anchors");
        String keywords = rs.getString("keywords");
        return PalaceIndexRecord.builder()
                .drawerId(rs.getString("drawer_id"))
                .chatId(rs.getString("chat_id"))
                .wingKey(rs.getString("wing_key"))
                .roomKey(rs.getString("room_key"))
                .summary(rs.getString("summary"))
                .keywords(keywords == null || keywords.isBlank() ? List.of() : List.of(keywords.split(",")))
                .anchors(anchors == null || anchors.isBlank() ? List.of() : List.of(anchors.split("\\R")))
                .importance(rs.getInt("importance"))
                .contentHash(rs.getString("content_hash"))
                .occurredAt(toInstant(rs.getTimestamp("occurred_at")))
                .build();
    }

    private PalaceTurnDrawer mapDrawer(ResultSet rs, int rowNum) throws SQLException {
        return PalaceTurnDrawer.builder()
                .id(rs.getString("id"))
                .chatId(rs.getString("chat_id"))
                .wingKey(rs.getString("wing_key"))
                .roomKey(rs.getString("room_key"))
                .userText(rs.getString("user_text"))
                .assistantText(rs.getString("assistant_text"))
                .rawText(rs.getString("raw_text"))
                .contentHash(rs.getString("content_hash"))
                .occurredAt(toInstant(rs.getTimestamp("occurred_at")))
                .build();
    }

    private Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
