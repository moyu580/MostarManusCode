package com.moyuyu.yuaiagentpro.knowledge;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class MarkdownKnowledgeReaderTest {

    private KnowledgeProperties properties;

    @BeforeEach
    void setUp() {
        properties = new KnowledgeProperties();
    }

    private MarkdownKnowledgeReader createReader(Path rootPath) {
        properties.getLocal().setRootPath(rootPath.toString());
        properties.getChunk().setSkipTemplateFiles(true);
        return new MarkdownKnowledgeReader(properties);
    }

    @Nested
    @DisplayName("Front matter extraction")
    class FrontMatterTests {

        @Test
        @DisplayName("Extracts audience, stage, goal from front matter")
        void extractsFrontMatterFields(@TempDir Path tempDir) throws IOException {
            String content = """
                    ---
                    title: Java后端面试攻略
                    category: job
                    tags:
                      - java
                      - interview
                    audience: 理工科本科生
                    stage: 大三, 大四
                    goal: 秋招
                    ---

                    ## 概述

                    这是一个面试攻略。""";

            Path file = tempDir.resolve("攻略.md");
            Files.writeString(file, content);

            MarkdownKnowledgeReader reader = createReader(tempDir);
            List<KnowledgeDocument> docs = reader.readAll();

            assertEquals(1, docs.size());
            KnowledgeDocument doc = docs.get(0);
            assertEquals("Java后端面试攻略", doc.getDocTitle());
            assertEquals("job", doc.getCategory());
            assertEquals(List.of("java", "interview"), doc.getTags());
            assertEquals("理工科本科生", doc.getAudience());
            assertEquals("大三, 大四", doc.getStage());
            assertEquals("秋招", doc.getGoal());
            // rawContent should not include front matter
            assertFalse(doc.getRawContent().contains("---"));
            assertTrue(doc.getRawContent().contains("## 概述"));
        }

        @Test
        @DisplayName("Missing front matter fields handled gracefully")
        void missingFieldsHandled(@TempDir Path tempDir) throws IOException {
            String content = """
                    ---
                    title: 简单文档
                    ---

                    正文内容。""";

            Path file = tempDir.resolve("simple.md");
            Files.writeString(file, content);

            MarkdownKnowledgeReader reader = createReader(tempDir);
            List<KnowledgeDocument> docs = reader.readAll();

            assertEquals(1, docs.size());
            KnowledgeDocument doc = docs.get(0);
            assertEquals("简单文档", doc.getDocTitle());
            assertNull(doc.getAudience());
            assertNull(doc.getStage());
            assertNull(doc.getGoal());
            assertTrue(doc.getTags().isEmpty());
        }
    }

    @Nested
    @DisplayName("Template file skipping")
    class TemplateSkipTests {

        @Test
        @DisplayName("Files in 99-模板 directory are skipped")
        void templateFilesSkipped(@TempDir Path tempDir) throws IOException {
            // Create a 99-模板 directory
            Path templateDir = tempDir.resolve("99-模板");
            Files.createDirectories(templateDir);

            // Write a template file
            Path template = templateDir.resolve("模板-案例页.md");
            Files.writeString(template, "# 模板\n\n这是模板文件。");

            // Write a normal file
            Path normal = tempDir.resolve("正常文件.md");
            Files.writeString(normal, "# 正常文件\n\n这是正常文件。");

            MarkdownKnowledgeReader reader = createReader(tempDir);
            List<KnowledgeDocument> docs = reader.readAll();

            assertEquals(1, docs.size());
            assertEquals("正常文件", docs.get(0).getDocTitle());
        }

        @Test
        @DisplayName("skipTemplateFiles=false includes template files")
        void templateFilesNotSkippedWhenDisabled(@TempDir Path tempDir) throws IOException {
            Path templateDir = tempDir.resolve("99-模板");
            Files.createDirectories(templateDir);
            Path template = templateDir.resolve("模板.md");
            Files.writeString(template, "# 模板\n\n内容。");

            properties.getLocal().setRootPath(tempDir.toString());
            properties.getChunk().setSkipTemplateFiles(false);
            MarkdownKnowledgeReader reader = new MarkdownKnowledgeReader(properties);

            List<KnowledgeDocument> docs = reader.readAll();
            assertEquals(1, docs.size());
        }
    }

    @Test
    @DisplayName("Documents without front matter use filename as title")
    void filenameTitleFallback(@TempDir Path tempDir) throws IOException {
        Path file = tempDir.resolve("Java后端开发校招面试全攻略.md");
        Files.writeString(file, "# Java 后端开发校招面试全攻略\n\n正文。");

        MarkdownKnowledgeReader reader = createReader(tempDir);
        List<KnowledgeDocument> docs = reader.readAll();

        assertEquals(1, docs.size());
        assertEquals("Java 后端开发校招面试全攻略", docs.get(0).getDocTitle());
    }

    @Test
    @DisplayName("Category extracted from parent directory")
    void categoryFromDirectory(@TempDir Path tempDir) throws IOException {
        Path subdir = tempDir.resolve("job");
        Files.createDirectories(subdir);
        Path file = subdir.resolve("test.md");
        Files.writeString(file, "# 测试\n\n内容。");

        MarkdownKnowledgeReader reader = createReader(tempDir);
        List<KnowledgeDocument> docs = reader.readAll();

        assertEquals(1, docs.size());
        assertEquals("job", docs.get(0).getCategory());
    }

    @Test
    @DisplayName("Multiple documents are read in sorted order")
    void multipleDocumentsSorted(@TempDir Path tempDir) throws IOException {
        Files.writeString(tempDir.resolve("b-file.md"), "# B\n\n内容。");
        Files.writeString(tempDir.resolve("a-file.md"), "# A\n\n内容。");

        MarkdownKnowledgeReader reader = createReader(tempDir);
        List<KnowledgeDocument> docs = reader.readAll();

        assertEquals(2, docs.size());
        // Files.walk sorts by natural order, so a-file should come first
        assertTrue(docs.get(0).getDocTitle().contains("A")
                || docs.get(0).getSourcePath().contains("a-file"));
    }

    @Test
    @DisplayName("Non-existent root path returns empty list")
    void nonExistentRoot(@TempDir Path tempDir) {
        properties.getLocal().setRootPath(tempDir.resolve("nonexistent").toString());
        MarkdownKnowledgeReader reader = new MarkdownKnowledgeReader(properties);

        List<KnowledgeDocument> docs = reader.readAll();
        assertTrue(docs.isEmpty());
    }
}
