package com.moyuyu.yuaiagentpro.knowledge;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class KnowledgeIngestionServiceTest {

    @Test
    void syncAddsKnowledgeDocumentsInProviderSizedBatches() {
        VectorStore vectorStore = mock(VectorStore.class);
        JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);
        KnowledgeSyncRecordRepository syncRecordRepo = mock(KnowledgeSyncRecordRepository.class);
        Environment environment = mock(Environment.class);
        KnowledgeProperties properties = new KnowledgeProperties();
        properties.setEnabled(true);
        properties.getChunk().setMinChars(20);
        KnowledgeSource source = () -> documents(30);

        when(syncRecordRepo.isAvailable()).thenReturn(true);
        when(syncRecordRepo.findBySourcePath(eq("local_markdown"), anyString())).thenReturn(null);
        when(syncRecordRepo.findAllPaths("local_markdown")).thenReturn(List.of());
        when(environment.getProperty("app.pgvector.table-name", "vector_store")).thenReturn("vector_store");

        KnowledgeIngestionService service = new KnowledgeIngestionService(
                provider(vectorStore),
                provider(jdbcTemplate),
                properties,
                source,
                new KnowledgeChunker(),
                new AiKnowledgeSectionPlanner(properties, provider(null)),
                syncRecordRepo,
                environment);

        KnowledgeIngestionService.SyncResult result = service.sync();

        ArgumentCaptor<List<Document>> captor = ArgumentCaptor.forClass(List.class);
        verify(vectorStore, times(2)).add(captor.capture());
        assertEquals(25, captor.getAllValues().get(0).size());
        assertEquals(5, captor.getAllValues().get(1).size());
        Document firstDocument = captor.getAllValues().get(0).get(0);
        assertNotNull(UUID.fromString(firstDocument.getId()));
        assertNotNull(firstDocument.getMetadata().get("chunk_id"));
        verify(syncRecordRepo, times(30)).upsert(eq("local_markdown"), anyString(), anyString(), any(), anyInt(), anyString());
        assertEquals(30, result.getIndexedFiles());
        assertEquals(30, result.getIndexedChunks());
    }

    private static <T> ObjectProvider<T> provider(T value) {
        return new ObjectProvider<>() {
            @Override
            public T getObject(Object... args) {
                return value;
            }

            @Override
            public T getIfAvailable() {
                return value;
            }

            @Override
            public T getObject() {
                return value;
            }
        };
    }

    private static List<KnowledgeDocument> documents(int count) {
        List<KnowledgeDocument> documents = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            documents.add(KnowledgeDocument.builder()
                    .sourcePath("D:/Knowledge/doc-" + i + ".md")
                    .docTitle("doc-" + i)
                    .category("job")
                    .tags(List.of("career"))
                    .rawContent("## Section\n\nThis is enough content for one useful knowledge chunk " + i + ".")
                    .contentHash("hash-" + i)
                    .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                    .frontMatter(Map.of())
                    .build());
        }
        return documents;
    }
}
