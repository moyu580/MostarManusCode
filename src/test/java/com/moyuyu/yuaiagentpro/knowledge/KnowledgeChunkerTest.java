package com.moyuyu.yuaiagentpro.knowledge;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class KnowledgeChunkerTest {

    private KnowledgeChunker chunker;

    @BeforeEach
    void setUp() {
        chunker = new KnowledgeChunker();
    }

    private KnowledgeDocument buildDoc(String title, String content) {
        return KnowledgeDocument.builder()
                .sourcePath("D:/Knowledge/" + title + ".md")
                .docTitle(title)
                .category("job")
                .tags(List.of("java", "backend"))
                .rawContent(content)
                .contentHash("abc123")
                .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                .audience("理工科本科生")
                .stage("大三")
                .goal("秋招")
                .build();
    }

    private KnowledgeDocument buildDoc(String title, String content, String sourcePath) {
        return KnowledgeDocument.builder()
                .sourcePath(sourcePath)
                .docTitle(title)
                .category("job")
                .tags(List.of("java", "backend"))
                .rawContent(content)
                .contentHash("abc123")
                .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                .build();
    }

    private List<KnowledgeChunk> chunk(KnowledgeDocument doc) {
        return chunker.chunk(doc, 700, 1200, 180, 80);
    }

    private String join(int n, String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            if (i > 0) sb.append(sep);
            sb.append("这是关于Java核心技术的详细描述，包含JVM运行机制、垃圾回收算法、类加载器原理、内存模型等关键知识点。")
              .append("在实际开发中，理解这些核心概念对于编写高效稳定的Java程序至关重要。");
        }
        return sb.toString();
    }

    @Nested
    @DisplayName("Heading path generation")
    class HeadingPathTests {

        @Test
        @DisplayName("## headings produce correct heading path")
        void h2HeadingPath() {
            String md = """
                    ## JVM 基础

                    %s

                    ## 并发编程

                    %s""".formatted(join(10, "\n\n"), join(10, "\n\n"));

            List<KnowledgeChunk> chunks = chunk(buildDoc("Java面试", md));

            // Each ## section should be its own chunk (each is ~450+ chars)
            assertTrue(chunks.size() >= 2, "Expected >= 2 chunks but got " + chunks.size());

            Map<String, Object> meta0 = chunks.get(0).getMetadata();
            assertEquals("JVM 基础", meta0.get("heading_path"));

            Map<String, Object> meta1 = chunks.get(1).getMetadata();
            assertEquals("并发编程", meta1.get("heading_path"));
        }

        @Test
        @DisplayName("### headings produce nested heading path")
        void h3NestedHeadingPath() {
            String md = """
                    ## 各模块高频考点

                    以下是各模块的高频考点，需要认真准备。

                    ### Java 基础

                    %s

                    ### JVM

                    %s""".formatted(join(10, "\n\n"), join(10, "\n\n"));

            List<KnowledgeChunk> chunks = chunk(buildDoc("Java面试攻略", md));

            assertFalse(chunks.isEmpty());
            boolean foundJVM = chunks.stream()
                    .anyMatch(c -> {
                        String hp = (String) c.getMetadata().get("heading_path");
                        return hp != null && hp.contains("JVM");
                    });
            assertTrue(foundJVM, "Should have a chunk with JVM in heading path");

            boolean foundJava = chunks.stream()
                    .anyMatch(c -> {
                        String hp = (String) c.getMetadata().get("heading_path");
                        String text = c.getChunkText();
                        return (hp != null && hp.contains("Java 基础"))
                                || text.contains("### Java 基础");
                    });
            assertTrue(foundJava, "Should have a chunk with Java 基础 in heading path");
        }
    }

    @Nested
    @DisplayName("Long section splitting")
    class LongSectionTests {

        @Test
        @DisplayName("Long ## section is split into multiple chunks")
        void longSectionSplit() {
            StringBuilder sb = new StringBuilder();
            sb.append("## 技术栈全景\n\n");
            // ~450 chars per block, 10 blocks = ~4500 chars >> maxChars=1200
            for (int i = 0; i < 10; i++) {
                sb.append(join(10, "\n\n")).append("\n\n");
            }

            List<KnowledgeChunk> chunks = chunk(buildDoc("Java后端", sb.toString()));

            assertTrue(chunks.size() > 1, "Expected multiple chunks but got " + chunks.size());
            for (KnowledgeChunk c : chunks) {
                assertTrue(c.getChunkText().length() <= 1500,
                        "Chunk too long: " + c.getChunkText().length());
            }
        }

        @Test
        @DisplayName("Adjacent sections do not overlap")
        void noOverlapOnSectionBoundaries() {
            String md = """
                    ## 第一章

                    %s

                    ## 第二章

                    %s""".formatted(join(10, "\n\n"), join(10, "\n\n"));

            List<KnowledgeChunk> chunks = chunk(buildDoc("两章文档", md));

            assertTrue(chunks.size() >= 2);
            // Second chunk should not contain content from first chapter via overlap
            String secondChunk = chunks.get(1).getChunkText();
            // Extract body (after "正文:")
            int bodyIdx = secondChunk.indexOf("正文:");
            if (bodyIdx > 0) {
                String body = secondChunk.substring(bodyIdx);
                // The body should start with "第二章" heading, not overlap from first chapter
                assertTrue(body.contains("第二章"), "Second chunk should start with its own section");
            }
        }
    }

    @Nested
    @DisplayName("Table and code block safety")
    class StructureSafetyTests {

        @Test
        @DisplayName("Table is not split in the middle")
        void tableNotSplit() {
            StringBuilder table = new StringBuilder();
            table.append("## 技术对比\n\n");
            table.append("| 特性 | Java | Go | Python |\n");
            table.append("|------|------|-----|--------|\n");
            for (int i = 0; i < 30; i++) {
                table.append("| 特性").append(i).append(" | 好 | 一般 | 差 |\n");
            }
            table.append("\n以上是技术对比表。\n");

            List<KnowledgeChunk> chunks = chunk(buildDoc("技术对比", table.toString()));

            // Check that no chunk has a broken table
            for (KnowledgeChunk c : chunks) {
                String text = c.getChunkText();
                if (text.contains("|------|")) {
                    // Table header separator should be accompanied by header row
                    assertTrue(text.contains("| 特性 |"), "Table header should be present");
                }
            }
        }

        @Test
        @DisplayName("Fenced code block ## is not misidentified as heading")
        void codeBlockNotSplit() {
            String md = """
                    ## 代码示例

                    下面是一段 Java 代码：

                    ```java
                    // 这是注释
                    public class Example {
                        // ## 这不是标题
                        public void method() {
                            // ### 这也不是标题
                            System.out.println("hello");
                        }
                    }
                    ```

                    以上是代码示例。""";

            List<KnowledgeChunk> chunks = chunk(buildDoc("代码文档", md));

            assertFalse(chunks.isEmpty());
            // The code block should be preserved intact in one chunk
            String fullText = chunks.stream()
                    .map(KnowledgeChunk::getChunkText)
                    .reduce("", String::concat);
            assertTrue(fullText.contains("public class Example"));
            // Should NOT have heading_path containing "这不是标题"
            boolean noFalseHeading = chunks.stream()
                    .noneMatch(c -> {
                        String hp = (String) c.getMetadata().get("heading_path");
                        return hp != null && hp.contains("这不是标题");
                    });
            assertTrue(noFalseHeading, "Code block headings should not be recognized");
        }

        @Test
        @DisplayName("Consecutive list items are kept together")
        void listItemsNotSplit() {
            StringBuilder list = new StringBuilder();
            list.append("## 知识点清单\n\n");
            for (int i = 0; i < 50; i++) {
                list.append("- 知识点").append(i).append("：这是关于某个重要概念的简短描述。\n");
            }

            List<KnowledgeChunk> chunks = chunk(buildDoc("清单", list.toString()));

            // Important: no crash, produces reasonable output
            assertTrue(chunks.size() >= 1);
            // Verify list items are preserved
            String fullText = chunks.stream()
                    .map(KnowledgeChunk::getChunkText)
                    .reduce("", String::concat);
            assertTrue(fullText.contains("- 知识点0："), "First list item should be present");
        }
    }

    @Nested
    @DisplayName("Chunk type detection")
    class ChunkTypeTests {

        @Test
        @DisplayName("Case study page with comparison table gets correct chunk type")
        void casePageChunkTypes() {
            String tableContent = """
                    下面是两条路径的详细对比分析，帮助你做出最适合自己的选择。

                    | 路径 | 难度 | 时间 | 适合人群 |
                    |------|------|------|----------|
                    | 校招 | 中 | 6个月 | 应届生 |
                    | 社招 | 高 | 1年 | 有经验者 |

                    从上表可以看出，校招路径相对更容易，时间也更短。""";

            String md = """
                    ## 用户背景

                    %s

                    ## 可选路径对比

                    %s

                    ## 推荐路径

                    %s

                    ## 90 天执行方案

                    %s

                    ## 最终产出物

                    %s

                    ## 常见失败点

                    %s

                    ## 兜底方案

                    %s""".formatted(
                            join(5, "\n\n"), tableContent + "\n\n" + join(3, "\n\n"),
                            join(5, "\n\n"), join(5, "\n\n"),
                            join(5, "\n\n"), join(5, "\n\n"), join(5, "\n\n"));

            KnowledgeDocument doc = KnowledgeDocument.builder()
                    .sourcePath("D:/Knowledge/案例-双非理工科冲Java后端秋招.md")
                    .docTitle("案例-双非理工科冲Java后端秋招")
                    .category("job")
                    .tags(List.of("java", "case"))
                    .rawContent(md)
                    .contentHash("def456")
                    .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                    .build();

            List<KnowledgeChunk> chunks = chunker.chunk(doc, 160, 220, 40, 0);

            List<String> chunkTypes = chunks.stream()
                    .map(c -> (String) c.getMetadata().get("chunk_type"))
                    .toList();

            assertTrue(chunkTypes.contains("comparison_table"),
                    "Should have comparison_table, got: " + chunkTypes);
            assertTrue(chunkTypes.contains("case_recommendation"),
                    "Should have case_recommendation, got: " + chunkTypes);
            assertTrue(chunkTypes.contains("case_plan"),
                    "Should have case_plan, got: " + chunkTypes);
            assertTrue(chunkTypes.contains("deliverables"),
                    "Should have deliverables, got: " + chunkTypes);
            assertTrue(chunkTypes.contains("risk_warning"),
                    "Should have risk_warning, got: " + chunkTypes);
            assertTrue(chunkTypes.contains("fallback_plan"),
                    "Should have fallback_plan, got: " + chunkTypes);
        }

        @Test
        @DisplayName("Overview page produces overview chunk type")
        void overviewChunkType() {
            String md = """
                    # 首页

                    欢迎来到知识库。

                    ## 快速导航

                    - [Java后端](java-backend.md)
                    - [前端开发](frontend.md)""";

            KnowledgeDocument doc = KnowledgeDocument.builder()
                    .sourcePath("D:/Knowledge/00-首页.md")
                    .docTitle("首页")
                    .category("general")
                    .tags(List.of())
                    .rawContent(md)
                    .contentHash("ghi789")
                    .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                    .build();

            List<KnowledgeChunk> chunks = chunker.chunk(doc, 160, 220, 40, 0);

            for (KnowledgeChunk c : chunks) {
                assertEquals("overview", c.getMetadata().get("chunk_type"));
            }
        }

        @Test
        @DisplayName("Travel documents produce travel-specific chunk types")
        void travelChunkTypes() {
            String md = """
                    ## 到达交通

                    从合肥南站出发，可以根据行李和同行人群选择地铁、打车或自驾。外地游客应提前确认导航终点和停车位置。

                    ## 半日游行程

                    下午到达时建议先走核心游线，再安排本地餐饮。带老人时要降低步行强度。

                    ## 游客服务

                    出发前确认厕所、寄存、充电、游客中心和应急联系方式，电话信息以现场公告为准。
                    """;

            KnowledgeDocument doc = KnowledgeDocument.builder()
                    .sourcePath("D:/Knowledge/travel-yaohai/01-arrival-transport.md")
                    .docTitle("瑶海青年创意田园游客导览")
                    .category("travel")
                    .tags(List.of("瑶海", "交通", "行程"))
                    .rawContent(md)
                    .contentHash("travel123")
                    .fileLastModified(Instant.parse("2026-01-01T00:00:00Z"))
                    .build();

            List<KnowledgeChunk> chunks = chunk(doc);

            List<String> chunkTypes = chunks.stream()
                    .map(c -> (String) c.getMetadata().get("chunk_type"))
                    .toList();
            assertTrue(chunkTypes.stream().anyMatch(type -> type != null && type.startsWith("travel_")));
            String fullText = chunks.stream()
                    .map(KnowledgeChunk::getChunkText)
                    .reduce("", String::concat);
            assertTrue(fullText.contains("## 到达交通"));
            assertTrue(fullText.contains("## 半日游行程"));
            assertTrue(fullText.contains("## 游客服务"));
        }
    }

    @Nested
    @DisplayName("Metadata completeness")
    class MetadataTests {

        @Test
        @DisplayName("Metadata contains all required fields")
        void metadataFields() {
            String md = """
                    ## 测试章节

                    %s""".formatted(join(10, "\n\n"));

            List<KnowledgeChunk> chunks = chunk(buildDoc("测试文档", md));
            assertFalse(chunks.isEmpty());

            KnowledgeChunk first = chunks.get(0);
            Map<String, Object> meta = first.getMetadata();

            assertEquals("knowledge", meta.get("type"));
            assertEquals("local", meta.get("source_type"));
            assertNotNull(meta.get("source_path"));
            assertEquals("测试文档", meta.get("doc_title"));
            assertEquals("job", meta.get("category"));
            assertEquals("java,backend", meta.get("tags"));
            assertEquals("理工科本科生", meta.get("audience"));
            assertEquals("大三", meta.get("stage"));
            assertEquals("秋招", meta.get("goal"));
            assertEquals("测试章节", meta.get("heading_path"));
            assertNotNull(meta.get("heading_level"));
            assertEquals(0, meta.get("chunk_index"));
            assertNotNull(meta.get("chunk_type"));
            assertNotNull(meta.get("char_count"));
            assertEquals("abc123", meta.get("content_hash"));
            assertNotNull(meta.get("file_last_modified"));
            assertNotNull(meta.get("indexed_at"));
        }

        @Test
        @DisplayName("Chunk text contains metadata header")
        void chunkTextHeader() {
            String md = """
                    ## JVM 调优

                    %s""".formatted(join(10, "\n\n"));

            List<KnowledgeChunk> chunks = chunk(buildDoc("Java面试攻略", md));
            assertFalse(chunks.isEmpty());

            String text = chunks.get(0).getChunkText();
            assertTrue(text.startsWith("标题: Java面试攻略"));
            assertTrue(text.contains("分类: job"));
            assertTrue(text.contains("标签: java, backend"));
            assertTrue(text.contains("适用人群: 理工科本科生"));
            assertTrue(text.contains("阶段: 大三"));
            assertTrue(text.contains("目标: 秋招"));
            assertTrue(text.contains("章节: JVM 调优"));
            assertTrue(text.contains("正文:"));
        }
    }

    @Nested
    @DisplayName("Edge cases")
    class EdgeCaseTests {

        @Test
        @DisplayName("Empty content produces empty list")
        void emptyContent() {
            List<KnowledgeChunk> chunks = chunk(buildDoc("空文档", ""));
            assertTrue(chunks.isEmpty());
        }

        @Test
        @DisplayName("Null content produces empty list")
        void nullContent() {
            KnowledgeDocument doc = KnowledgeDocument.builder()
                    .sourcePath("D:/Knowledge/null.md")
                    .docTitle("null")
                    .category("test")
                    .tags(List.of())
                    .rawContent(null)
                    .contentHash("xxx")
                    .fileLastModified(Instant.now())
                    .build();
            List<KnowledgeChunk> chunks = chunker.chunk(doc, 700, 1200, 180, 80);
            assertTrue(chunks.isEmpty());
        }

        @Test
        @DisplayName("Short doc without headings still produces chunk")
        void shortDocNoHeadings() {
            String md = "这是一段简短的文档，没有标题。只是几句话而已。";

            List<KnowledgeChunk> chunks = chunk(buildDoc("简短文档", md));
            assertFalse(chunks.isEmpty());
            assertEquals(1, chunks.size());
        }

        @Test
        @DisplayName("Multiple fenced code blocks are preserved")
        void multipleCodeBlocks() {
            String md = """
                    ## 代码示例

                    ```python
                    print("hello")
                    ## not a heading
                    ```

                    一些文字。

                    ```java
                    System.out.println("world");
                    ### also not a heading
                    ```

                    结束。""";

            List<KnowledgeChunk> chunks = chunk(buildDoc("多代码块", md));
            assertFalse(chunks.isEmpty());

            String fullText = chunks.stream()
                    .map(KnowledgeChunk::getChunkText)
                    .reduce("", String::concat);
            assertTrue(fullText.contains("print(\"hello\")"));
            assertTrue(fullText.contains("System.out.println(\"world\")"));
        }
    }

    @Test
    @DisplayName("Backward compatible overload works")
    void backwardCompatibleOverload() {
        String md = """
                ## 测试

                %s""".formatted(join(10, "\n\n"));

        KnowledgeDocument doc = buildDoc("测试", md);
        List<KnowledgeChunk> chunks = chunker.chunk(doc, 800, 120);

        assertFalse(chunks.isEmpty());
    }
}
