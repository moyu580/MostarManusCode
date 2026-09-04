package com.moyuyu.yuaiagentpro.knowledge;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;
import java.util.IntSummaryStatistics;
import java.util.List;

class KnowledgeChunkPreviewTest {

    @Test
    void previewNewKnowledgeChunks() {
        KnowledgeProperties properties = new KnowledgeProperties();
        properties.getLocal().setRootPath("D:/NewKnowledge");
        properties.getChunk().setTargetChars(320);
        properties.getChunk().setMaxChars(420);
        properties.getChunk().setMinChars(120);
        properties.getChunk().setOverlapChars(60);

        MarkdownKnowledgeReader reader = new MarkdownKnowledgeReader(properties);
        KnowledgeChunker chunker = new KnowledgeChunker();

        List<KnowledgeDocument> documents = reader.readAll();
        System.out.println("documents=" + documents.size());

        int totalChunks = 0;
        for (KnowledgeDocument document : documents) {
            List<KnowledgeChunk> chunks = chunker.chunk(
                    document,
                    properties.getChunk().getTargetChars(),
                    properties.getChunk().getMaxChars(),
                    properties.getChunk().getMinChars(),
                    properties.getChunk().getOverlapChars());
            totalChunks += chunks.size();
            IntSummaryStatistics stats = chunks.stream()
                    .mapToInt(chunk -> chunk.getChunkText().length())
                    .summaryStatistics();
            System.out.printf("%s chunks=%d min=%d avg=%.0f max=%d%n",
                    Path.of(document.getSourcePath()).getFileName(),
                    chunks.size(),
                    stats.getMin(),
                    stats.getAverage(),
                    stats.getMax());
        }
        System.out.println("totalChunks=" + totalChunks);
    }
}
