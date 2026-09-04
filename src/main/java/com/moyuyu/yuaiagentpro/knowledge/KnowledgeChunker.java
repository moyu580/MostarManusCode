package com.moyuyu.yuaiagentpro.knowledge;

import cn.hutool.crypto.digest.DigestUtil;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class KnowledgeChunker {

    private static final Pattern HEADING_PATTERN = Pattern.compile("^(#{1,6})\\s+(.+)$");
    private static final Pattern FENCE_OPEN = Pattern.compile("^(`{3,}|~{3,})");
    private static final Pattern TABLE_ROW = Pattern.compile("^\\s*\\|.*\\|\\s*$");
    private static final Pattern LIST_ITEM = Pattern.compile("^\\s*[-*+]\\s|^\\s*\\d+[.)]\\s");
    private static final Pattern BLOCKQUOTE = Pattern.compile("^\\s*>");

    // Chunk type detection patterns
    private static final Pattern CASE_KEYWORDS = Pattern.compile("案例|case", Pattern.CASE_INSENSITIVE);
    private static final Pattern GUIDE_KEYWORDS = Pattern.compile("攻略|全攻略|指南|guide", Pattern.CASE_INSENSITIVE);
    private static final Pattern COMPARE_KEYWORDS = Pattern.compile("对比|比较|横向", Pattern.CASE_INSENSITIVE);
    private static final Pattern OVERVIEW_FILENAME = Pattern.compile("(?:^|[/\\\\])(?:00-|1[01]-).*");
    private static final Pattern PLAN_KEYWORDS = Pattern.compile("\\d+\\s*天|执行[计方]|时间[线表]|步骤|阶段");
    private static final Pattern DELIVERABLES_KEYWORDS = Pattern.compile("产出[物件清单]|最终|提交[物件]");
    private static final Pattern RISK_KEYWORDS = Pattern.compile("常见[失踩]误|失败|风险|坑|注意事项");
    private static final Pattern FALLBACK_KEYWORDS = Pattern.compile("兜底|备选|替代[方策]|plan\\s*b", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUDIENCE_KEYWORDS = Pattern.compile("适合[谁哪]|适用人群|适用对象|目标[用读]者");
    private static final Pattern ROADMAP_KEYWORDS = Pattern.compile("全景|路线图|roadmap|技术栈|知识体系", Pattern.CASE_INSENSITIVE);
    private static final Pattern CHECKLIST_KEYWORDS = Pattern.compile("考点|面试题|八股|高频[问问]|知识点|必[背考会]");
    private static final Pattern TRAVEL_KEYWORDS = Pattern.compile("旅游|游客|游玩|景点|导览|行程|路线|交通|停车|门票|预约|开放时间|餐饮|美食|厕所|寄存|亲子|老人|雨天|应急|瑶海|田园|travel|tour|itinerary|transport|poi", Pattern.CASE_INSENSITIVE);
    private static final Pattern TRANSPORT_KEYWORDS = Pattern.compile("交通|路线|到达|高铁|机场|地铁|公交|打车|自驾|停车|导航|transport|route", Pattern.CASE_INSENSITIVE);
    private static final Pattern ITINERARY_KEYWORDS = Pattern.compile("行程|游线|游玩|半日|一日|两日|小时|路线|itinerary|plan", Pattern.CASE_INSENSITIVE);
    private static final Pattern SERVICE_KEYWORDS = Pattern.compile("厕所|寄存|充电|游客中心|医院|药店|派出所|应急|电话|服务|service|emergency", Pattern.CASE_INSENSITIVE);
    private static final Pattern FOOD_KEYWORDS = Pattern.compile("餐饮|美食|本地菜|小吃|饭店|人均|吃什么|food|restaurant", Pattern.CASE_INSENSITIVE);

    public List<KnowledgeChunk> chunk(KnowledgeDocument document, int targetChars, int maxChars,
                                      int minChars, int overlapChars) {
        return chunk(document, targetChars, maxChars, minChars, overlapChars, List.of());
    }

    public List<KnowledgeChunk> chunk(KnowledgeDocument document, int targetChars, int maxChars,
                                      int minChars, int overlapChars, List<SemanticSection> semanticSections) {
        String text = document.getRawContent();
        if (text == null || text.isBlank()) {
            return List.of();
        }

        String docType = detectDocType(document);

        List<Section> refined = semanticSections == null || semanticSections.isEmpty()
                ? buildRuleBasedSections(text, maxChars)
                : buildAiPlannedSections(semanticSections);

        // Build final chunks while keeping section metadata attached.
        // Overlap is only applied inside a hard-split section, never between normal sections.
        List<ChunkCandidate> candidates = buildCandidates(refined, targetChars, maxChars, minChars, overlapChars);

        // Step 5: Build KnowledgeChunk objects with metadata
        List<KnowledgeChunk> chunks = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            ChunkCandidate candidate = candidates.get(i);
            String headingPath = candidate.headingPath;
            String chunkType = determineChunkTypeFromText(candidate.text, docType,
                    document.getSourcePath(), headingPath);

            chunks.add(KnowledgeChunk.builder()
                    .chunkId("knowledge:" + hashPath(document.getSourcePath()) + ":" + i)
                    .chunkText(buildChunkText(document, headingPath, candidate.text))
                    .chunkIndex(i)
                    .metadata(buildMetadata(document, i, headingPath, chunkType,
                            candidate.text.length()))
                    .build());
        }
        return chunks;
    }

    private List<Section> buildRuleBasedSections(String text, int maxChars) {
        // Step 1: Parse into structural blocks, respecting fenced code blocks
        List<MarkdownBlock> blocks = parseBlocks(text);

        // Step 2: Split by ## headings into sections
        List<Section> sections = splitByH2(blocks);

        // Step 3: Further split sections that are too long
        List<Section> refined = new ArrayList<>();
        for (Section section : sections) {
            if (section.charCount <= maxChars) {
                refined.add(section);
            } else {
                refined.addAll(splitByH3(section, maxChars));
            }
        }
        return refined;
    }

    private List<Section> buildAiPlannedSections(List<SemanticSection> semanticSections) {
        List<Section> sections = new ArrayList<>();
        int line = 0;
        for (SemanticSection semanticSection : semanticSections) {
            String text = semanticSection.text().strip();
            if (text.isBlank()) {
                continue;
            }
            String title = semanticSection.title().strip();
            List<MarkdownBlock> blocks = new ArrayList<>();
            if (!title.isBlank()) {
                blocks.add(new MarkdownBlock(BlockType.HEADING, "## " + title, line, line, 2, title));
                line++;
            }
            List<MarkdownBlock> parsedBlocks = parseBlocks(text);
            blocks.addAll(parsedBlocks);
            int charCount = blocks.stream().mapToInt(b -> b.content.length() + 1).sum();
            sections.add(new Section(blocks, title.isBlank() ? List.of() : List.of(2),
                    title.isBlank() ? List.of() : List.of(title), charCount));
            line += Math.max(1, text.split("\\R", -1).length);
        }
        return sections;
    }

    // Legacy overload for backward compatibility
    public List<KnowledgeChunk> chunk(KnowledgeDocument document, int maxChars, int overlapChars) {
        return chunk(document, 700, maxChars, 180, overlapChars);
    }

    // ===== Block parsing =====

    private List<MarkdownBlock> parseBlocks(String text) {
        String[] lines = text.split("\\n", -1);
        List<MarkdownBlock> blocks = new ArrayList<>();
        boolean inCodeBlock = false;
        String fenceMarker = null;
        StringBuilder codeContent = null;
        int codeStartLine = 0;

        int paragraphStart = -1;
        StringBuilder paragraphBuffer = null;

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.stripLeading();

            // Handle code block state
            if (!inCodeBlock) {
                Matcher fenceM = FENCE_OPEN.matcher(trimmed);
                if (fenceM.find()) {
                    // Flush any pending paragraph
                    paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                    paragraphBuffer = null;

                    inCodeBlock = true;
                    fenceMarker = fenceM.group(1);
                    codeContent = new StringBuilder(line);
                    codeStartLine = i;
                    continue;
                }
            } else {
                if (codeContent != null) {
                    codeContent.append("\n").append(line);
                }
                // Check if this line closes the fence
                if (trimmed.startsWith(fenceMarker) && trimmed.strip().length() >= fenceMarker.length()) {
                    inCodeBlock = false;
                    blocks.add(new MarkdownBlock(BlockType.CODE, codeContent.toString(),
                            codeStartLine, i));
                    codeContent = null;
                    fenceMarker = null;
                }
                continue;
            }

            // Heading
            Matcher headingM = HEADING_PATTERN.matcher(trimmed);
            if (headingM.find()) {
                paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                paragraphBuffer = null;

                int level = headingM.group(1).length();
                String headingText = headingM.group(2).trim();
                blocks.add(new MarkdownBlock(BlockType.HEADING, trimmed, i, i, level, headingText));
                continue;
            }

            // Table row
            if (TABLE_ROW.matcher(line).matches()) {
                paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                paragraphBuffer = null;

                // Collect consecutive table rows
                StringBuilder tableContent = new StringBuilder(line);
                int tableStart = i;
                while (i + 1 < lines.length && TABLE_ROW.matcher(lines[i + 1]).matches()) {
                    i++;
                    tableContent.append("\n").append(lines[i]);
                }
                blocks.add(new MarkdownBlock(BlockType.TABLE, tableContent.toString(), tableStart, i));
                continue;
            }

            // List item
            if (LIST_ITEM.matcher(line).matches()) {
                paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                paragraphBuffer = null;

                StringBuilder listContent = new StringBuilder(line);
                int listStart = i;
                while (i + 1 < lines.length) {
                    String nextLine = lines[i + 1];
                    if (nextLine.isBlank() || LIST_ITEM.matcher(nextLine).matches()
                            || BLOCKQUOTE.matcher(nextLine).find()) {
                        if (nextLine.isBlank()) {
                            // Check if line after blank is also a list item
                            if (i + 2 < lines.length && LIST_ITEM.matcher(lines[i + 2]).matches()) {
                                i++;
                                listContent.append("\n").append(lines[i]);
                                continue;
                            }
                            break;
                        }
                        i++;
                        listContent.append("\n").append(lines[i]);
                    } else if (nextLine.startsWith("  ") || nextLine.startsWith("\t")) {
                        // Continuation of list item
                        i++;
                        listContent.append("\n").append(lines[i]);
                    } else {
                        break;
                    }
                }
                blocks.add(new MarkdownBlock(BlockType.LIST, listContent.toString(), listStart, i));
                continue;
            }

            // Blockquote
            if (BLOCKQUOTE.matcher(line).matches()) {
                paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                paragraphBuffer = null;

                StringBuilder bqContent = new StringBuilder(line);
                int bqStart = i;
                while (i + 1 < lines.length && (BLOCKQUOTE.matcher(lines[i + 1]).find()
                        || lines[i + 1].isBlank() && i + 2 < lines.length && BLOCKQUOTE.matcher(lines[i + 2]).find())) {
                    i++;
                    bqContent.append("\n").append(lines[i]);
                }
                blocks.add(new MarkdownBlock(BlockType.BLOCKQUOTE, bqContent.toString(), bqStart, i));
                continue;
            }

            // Blank line - only flush on double blank (paragraph boundary)
            if (line.isBlank()) {
                if (paragraphStart != -1 && i + 1 < lines.length && lines[i + 1].isBlank()) {
                    // Double blank = paragraph boundary
                    paragraphStart = flushParagraph(blocks, lines, paragraphStart, i, paragraphBuffer);
                    paragraphBuffer = null;
                } else if (paragraphStart != -1) {
                    // Single blank = soft line break within paragraph
                    paragraphBuffer.append("\n");
                }
                continue;
            }

            // Regular text - accumulate into paragraph
            if (paragraphStart == -1) {
                paragraphStart = i;
                paragraphBuffer = new StringBuilder(line);
            } else {
                paragraphBuffer.append("\n").append(line);
            }
        }

        // Flush remaining
        if (inCodeBlock && codeContent != null) {
            blocks.add(new MarkdownBlock(BlockType.CODE, codeContent.toString(),
                    codeStartLine, lines.length - 1));
        }
        if (paragraphStart != -1) {
            flushParagraph(blocks, lines, paragraphStart, lines.length, paragraphBuffer);
        }

        return blocks;
    }

    private int flushParagraph(List<MarkdownBlock> blocks, String[] lines,
                               int start, int end, StringBuilder buffer) {
        if (start == -1) return -1;
        String text = (buffer != null) ? buffer.toString().strip() : "";
        if (!text.isBlank()) {
            blocks.add(new MarkdownBlock(BlockType.PARAGRAPH, text, start, end - 1));
        }
        return -1;
    }

    // ===== Section splitting =====

    private List<Section> splitByH2(List<MarkdownBlock> blocks) {
        List<Section> sections = new ArrayList<>();
        List<MarkdownBlock> currentBlocks = new ArrayList<>();
        List<Integer> headingLevels = new ArrayList<>();
        List<String> headingTexts = new ArrayList<>();
        int currentCharCount = 0;

        for (MarkdownBlock block : blocks) {
            if (block.type == BlockType.HEADING && block.level == 2) {
                // Start a new section
                if (!currentBlocks.isEmpty()) {
                    sections.add(new Section(currentBlocks, headingLevels, headingTexts, currentCharCount));
                }
                currentBlocks = new ArrayList<>();
                headingLevels = new ArrayList<>(List.of(block.level));
                headingTexts = new ArrayList<>(List.of(block.headingText));
                currentBlocks.add(block);
                currentCharCount = block.content.length() + 1;
            } else {
                if (block.type == BlockType.HEADING) {
                    headingLevels.add(block.level);
                    headingTexts.add(block.headingText);
                }
                currentBlocks.add(block);
                currentCharCount += block.content.length() + 1;
            }
        }
        if (!currentBlocks.isEmpty()) {
            sections.add(new Section(currentBlocks, headingLevels, headingTexts, currentCharCount));
        }

        if (sections.isEmpty() && !blocks.isEmpty()) {
            // No ## headings found, treat entire doc as one section
            sections.add(new Section(blocks, List.of(), List.of(),
                    blocks.stream().mapToInt(b -> b.content.length() + 1).sum()));
        }
        return sections;
    }

    private List<Section> splitByH3(Section section, int maxChars) {
        // Check if there are ### headings to split by
        boolean hasH3 = section.headingLevels.stream().anyMatch(l -> l == 3);
        if (!hasH3) {
            // No ### headings, split by blocks
            return splitByBlocks(section, maxChars);
        }

        List<Section> result = new ArrayList<>();
        List<MarkdownBlock> currentBlocks = new ArrayList<>();
        List<Integer> parentHeadingLevels = new ArrayList<>(section.headingLevels.isEmpty()
                ? List.of() : List.of(section.headingLevels.get(0)));
        List<String> parentHeadingTexts = new ArrayList<>(section.headingTexts.isEmpty()
                ? List.of() : List.of(section.headingTexts.get(0)));
        List<Integer> headingLevels = new ArrayList<>(parentHeadingLevels);
        List<String> headingTexts = new ArrayList<>(parentHeadingTexts);
        int currentCharCount = 0;

        for (MarkdownBlock block : section.blocks) {
            if (block.type == BlockType.HEADING && block.level == 3) {
                // Flush previous section (content before this H3)
                if (!currentBlocks.isEmpty()) {
                    Section h3Section = new Section(currentBlocks, headingLevels, headingTexts, currentCharCount);
                    if (h3Section.charCount > maxChars) {
                        result.addAll(splitByBlocks(h3Section, maxChars));
                    } else {
                        result.add(h3Section);
                    }
                }
                // Start new section with this H3 heading
                headingLevels = new ArrayList<>(parentHeadingLevels);
                headingTexts = new ArrayList<>(parentHeadingTexts);
                currentBlocks = new ArrayList<>();
                currentCharCount = 0;
                // Add the H3 block to the new section
                headingLevels.add(block.level);
                headingTexts.add(block.headingText);
                currentBlocks.add(block);
                currentCharCount += block.content.length() + 1;
            } else {
                if (block.type == BlockType.HEADING) {
                    boolean parentHeadingAlreadyTracked = !parentHeadingLevels.isEmpty()
                            && block.level == parentHeadingLevels.get(0)
                            && !parentHeadingTexts.isEmpty()
                            && block.headingText.equals(parentHeadingTexts.get(0));
                    if (!parentHeadingAlreadyTracked) {
                        headingLevels.add(block.level);
                        headingTexts.add(block.headingText);
                    }
                }
                currentBlocks.add(block);
                currentCharCount += block.content.length() + 1;
            }
        }

        if (!currentBlocks.isEmpty()) {
            Section h3Section = new Section(currentBlocks, headingLevels, headingTexts, currentCharCount);
            if (h3Section.charCount > maxChars) {
                result.addAll(splitByBlocks(h3Section, maxChars));
            } else {
                result.add(h3Section);
            }
        }
        return result;
    }

    private List<Section> splitByBlocks(Section section, int maxChars) {
        List<Section> result = new ArrayList<>();
        List<MarkdownBlock> currentBlocks = new ArrayList<>();
        int currentCharCount = 0;

        // Base heading info from parent section
        List<Integer> baseHeadingLevels = new ArrayList<>(section.headingLevels);
        List<String> baseHeadingTexts = new ArrayList<>(section.headingTexts);

        for (MarkdownBlock block : section.blocks) {
            if (currentCharCount + block.content.length() > maxChars && !currentBlocks.isEmpty()) {
                result.add(new Section(currentBlocks, baseHeadingLevels, baseHeadingTexts, currentCharCount));
                currentBlocks = new ArrayList<>();
                currentCharCount = 0;
            }
            currentBlocks.add(block);
            currentCharCount += block.content.length() + 1;
        }

        if (!currentBlocks.isEmpty()) {
            result.add(new Section(currentBlocks, baseHeadingLevels, baseHeadingTexts, currentCharCount));
        }
        return result;
    }

    // ===== Chunk assembly =====

    private List<ChunkCandidate> buildCandidates(List<Section> sections, int targetChars, int maxChars,
                                                 int minChars, int overlapChars) {
        List<ChunkCandidate> rawCandidates = new ArrayList<>();
        for (Section section : sections) {
            String text = section.toText().strip();
            if (text.isBlank()) continue;
            if (isHeadingOnly(text)) continue;

            String headingPath = buildHeadingPath(section);
            if (text.length() <= maxChars) {
                rawCandidates.add(new ChunkCandidate(text, headingPath));
            } else {
                List<String> parts = hardSplit(text, maxChars);
                for (int i = 0; i < parts.size(); i++) {
                    String part = parts.get(i);
                    if (i > 0 && overlapChars > 0) {
                        String previous = parts.get(i - 1);
                        int start = Math.max(0, previous.length() - overlapChars);
                        String overlap = previous.substring(start).strip();
                        if (!overlap.isBlank()) {
                            part = overlap + "\n\n" + part;
                        }
                    }
                    rawCandidates.add(new ChunkCandidate(part, headingPath));
                }
            }
        }
        return mergeSmallCandidates(rawCandidates, targetChars, maxChars, minChars);
    }

    private List<ChunkCandidate> mergeSmallCandidates(List<ChunkCandidate> candidates, int targetChars,
                                                      int maxChars, int minChars) {
        if (candidates.size() <= 1 || minChars <= 0) {
            return candidates;
        }

        List<ChunkCandidate> merged = new ArrayList<>();
        ChunkCandidate pending = null;

        for (ChunkCandidate current : candidates) {
            if (pending == null) {
                pending = current;
                continue;
            }

            boolean pendingTooSmall = pending.text.length() < minChars;
            boolean currentTooSmall = current.text.length() < minChars;
            int mergedLength = pending.text.length() + 2 + current.text.length();
            boolean bothComfortablySmall = pending.text.length() < targetChars && current.text.length() < targetChars;
            boolean compatible = bothComfortablySmall
                    || sameHeading(pending.headingPath, current.headingPath)
                    || sameTopHeading(pending.headingPath, current.headingPath)
                    || pending.headingPath.isBlank()
                    || current.headingPath.isBlank();

            if (compatible && (pendingTooSmall || currentTooSmall || bothComfortablySmall)
                    && mergedLength <= Math.min(maxChars, Math.max(targetChars, minChars * 3))) {
                pending = new ChunkCandidate(
                        pending.text + "\n\n" + current.text,
                        mergeHeadingPath(pending.headingPath, current.headingPath));
            } else {
                merged.add(pending);
                pending = current;
            }
        }

        if (pending != null) {
            if (!merged.isEmpty() && pending.text.length() < minChars) {
                ChunkCandidate previous = merged.get(merged.size() - 1);
                int mergedLength = previous.text.length() + 2 + pending.text.length();
                if (sameTopHeading(previous.headingPath, pending.headingPath) && mergedLength <= maxChars) {
                    merged.set(merged.size() - 1, new ChunkCandidate(
                            previous.text + "\n\n" + pending.text,
                            mergeHeadingPath(previous.headingPath, pending.headingPath)));
                    return merged;
                }
            }
            merged.add(pending);
        }

        return merged;
    }

    private boolean sameHeading(String left, String right) {
        if (left == null || right == null || left.isBlank() || right.isBlank()) {
            return false;
        }
        return left.equals(right);
    }

    private boolean sameTopHeading(String left, String right) {
        if (left == null || right == null || left.isBlank() || right.isBlank()) {
            return false;
        }
        return topHeading(left).equals(topHeading(right));
    }

    private String topHeading(String headingPath) {
        int idx = headingPath.indexOf(" > ");
        return idx >= 0 ? headingPath.substring(0, idx) : headingPath;
    }

    private String mergeHeadingPath(String left, String right) {
        if (left == null || left.isBlank()) return nullSafe(right);
        if (right == null || right.isBlank() || left.equals(right)) return left;
        if (sameTopHeading(left, right)) return topHeading(left);
        return left + " + " + right;
    }

    private boolean isHeadingOnly(String text) {
        StringBuilder nonHeadingText = new StringBuilder();
        for (String line : text.split("\\R", -1)) {
            String trimmed = line.trim();
            if (trimmed.isBlank()) {
                continue;
            }
            if (HEADING_PATTERN.matcher(trimmed).matches()) {
                continue;
            }
            nonHeadingText.append(trimmed);
        }
        return nonHeadingText.isEmpty();
    }

    private List<String> hardSplit(String text, int maxChars) {
        List<String> result = new ArrayList<>();
        String[] lines = text.split("\\n", -1);
        StringBuilder buffer = new StringBuilder();
        boolean inCodeBlock = false;
        String fenceMarker = null;

        for (String line : lines) {
            String trimmed = line.stripLeading();

            // Track code block state
            if (!inCodeBlock) {
                Matcher fenceM = FENCE_OPEN.matcher(trimmed);
                if (fenceM.find()) {
                    inCodeBlock = true;
                    fenceMarker = fenceM.group(1);
                }
            } else {
                if (trimmed.startsWith(fenceMarker) && trimmed.strip().length() >= fenceMarker.length()) {
                    inCodeBlock = false;
                }
                // Never split inside a code block
                if (buffer.length() + line.length() + 1 > maxChars && !buffer.isEmpty() && !inCodeBlock) {
                    result.add(buffer.toString().strip());
                    buffer.setLength(0);
                }
                if (!buffer.isEmpty()) buffer.append("\n");
                buffer.append(line);
                continue;
            }

            // Keep normal tables together, but split very large tables by row so short-context
            // embedding models are not fed oversized chunks.
            if (TABLE_ROW.matcher(line).matches()) {
                if (buffer.length() + line.length() + 1 > maxChars && !buffer.isEmpty()) {
                    result.add(buffer.toString().strip());
                    buffer.setLength(0);
                }
                if (!buffer.isEmpty()) buffer.append("\n");
                buffer.append(line);
                continue;
            }

            /*
                if (buffer.length() + line.length() + 1 > maxChars && !buffer.isEmpty()) {
                    // Check if buffer ends with a table row
                    if (!endsWithTableRow(buffer)) {
                        result.add(buffer.toString().strip());
                        buffer.setLength(0);
                    }
                }
                if (!buffer.isEmpty()) buffer.append("\n");
                buffer.append(line);
                continue;
            }
            */

            // Normal line
            if (buffer.length() + line.length() + 1 > maxChars && !buffer.isEmpty()) {
                // Find a good break point
                String bufStr = buffer.toString();
                int breakPoint = findBreakPoint(bufStr, maxChars);
                if (breakPoint > 0) {
                    result.add(bufStr.substring(0, breakPoint).strip());
                    String remainder = bufStr.substring(breakPoint).strip();
                    buffer.setLength(0);
                    if (!remainder.isEmpty()) {
                        buffer.append(remainder).append("\n");
                    }
                } else {
                    result.add(bufStr.strip());
                    buffer.setLength(0);
                }
            }
            if (!buffer.isEmpty()) buffer.append("\n");
            buffer.append(line);
        }

        if (!buffer.isEmpty()) {
            String remaining = buffer.toString().strip();
            if (!remaining.isEmpty()) {
                result.add(remaining);
            }
        }

        return result;
    }

    private int findBreakPoint(String text, int maxChars) {
        // Try to break at sentence end, paragraph end, or list boundary
        int searchEnd = Math.min(text.length(), maxChars);
        int bestBreak = -1;

        for (int i = searchEnd - 1; i > maxChars / 2; i--) {
            char c = text.charAt(i);
            if (c == '\n') {
                // Prefer breaking at blank lines (paragraph boundary)
                if (i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    return i + 2;
                }
                if (i > 0 && text.charAt(i - 1) == '\n') {
                    return i + 1;
                }
                bestBreak = i + 1;
            } else if (c == '.' || c == '!' || c == '?' || c == ';'
                    || c == '。' || c == '！' || c == '？' || c == '；') {
                if (bestBreak < 0) {
                    bestBreak = i + 1;
                }
            }
        }
        return bestBreak > 0 ? bestBreak : -1;
    }

    private boolean endsWithTableRow(StringBuilder sb) {
        if (sb.isEmpty()) return false;
        String s = sb.toString();
        int lastNewline = s.lastIndexOf('\n');
        String lastLine = (lastNewline >= 0) ? s.substring(lastNewline + 1) : s;
        return TABLE_ROW.matcher(lastLine).matches();
    }

    // ===== Chunk text and metadata =====

    private String buildChunkText(KnowledgeDocument document, String headingPath, String bodyText) {
        StringBuilder sb = new StringBuilder();

        sb.append("标题: ").append(nullSafe(document.getDocTitle())).append("\n");
        sb.append("分类: ").append(nullSafe(document.getCategory())).append("\n");
        if (document.getTags() != null && !document.getTags().isEmpty()) {
            sb.append("标签: ").append(String.join(", ", document.getTags())).append("\n");
        }
        if (document.getAudience() != null && !document.getAudience().isBlank()) {
            sb.append("适用人群: ").append(document.getAudience().trim()).append("\n");
        }
        if (document.getStage() != null && !document.getStage().isBlank()) {
            sb.append("阶段: ").append(document.getStage().trim()).append("\n");
        }
        if (document.getGoal() != null && !document.getGoal().isBlank()) {
            sb.append("目标: ").append(document.getGoal().trim()).append("\n");
        }
        if (!headingPath.isBlank()) {
            sb.append("章节: ").append(headingPath).append("\n");
        }
        sb.append("\n正文:\n").append(bodyText);

        return sb.toString();
    }

    private Map<String, Object> buildMetadata(KnowledgeDocument document, int chunkIndex,
                                               String headingPath, String chunkType, int charCount) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        metadata.put("type", "knowledge");
        metadata.put("source_type", "local");
        metadata.put("source_path", document.getSourcePath());
        metadata.put("doc_title", document.getDocTitle());
        metadata.put("category", document.getCategory());
        metadata.put("tags", document.getTags() == null ? "" : String.join(",", document.getTags()));
        metadata.put("audience", nullSafe(document.getAudience()));
        metadata.put("stage", nullSafe(document.getStage()));
        metadata.put("goal", nullSafe(document.getGoal()));
        metadata.put("heading_path", headingPath);
        metadata.put("heading_level", headingPath.isBlank() ? 0
                : headingPath.split(" > ").length);
        metadata.put("chunk_index", chunkIndex);
        metadata.put("chunk_type", chunkType);
        metadata.put("char_count", charCount);
        metadata.put("content_hash", document.getContentHash());
        metadata.put("file_last_modified",
                document.getFileLastModified() == null ? "" : document.getFileLastModified().toString());
        metadata.put("indexed_at", Instant.now().toString());
        return metadata;
    }

    private String buildHeadingPath(Section section) {
        if (section.headingTexts.isEmpty()) return "";
        return String.join(" > ", section.headingTexts);
    }

    // ===== Chunk type detection =====

    private String detectDocType(KnowledgeDocument document) {
        String path = document.getSourcePath() != null ? document.getSourcePath() : "";
        String title = document.getDocTitle() != null ? document.getDocTitle() : "";
        String lowerPath = path.toLowerCase(Locale.ROOT);

        if (OVERVIEW_FILENAME.matcher(lowerPath).find()) return "overview";
        if (TRAVEL_KEYWORDS.matcher(lowerPath).find()
                || TRAVEL_KEYWORDS.matcher(title).find()
                || TRAVEL_KEYWORDS.matcher(nullSafe(document.getCategory())).find()) return "travel";
        if (CASE_KEYWORDS.matcher(title).find()) return "case";
        if (GUIDE_KEYWORDS.matcher(title).find()) return "guide";
        if (COMPARE_KEYWORDS.matcher(title).find()) return "comparison";
        return "general";
    }

    private String determineChunkType(Section section, String docType, String sourcePath) {
        String combinedText = section.toText();
        String headingPath = String.join(" ", section.headingTexts).toLowerCase(Locale.ROOT);
        String lowerText = combinedText.toLowerCase(Locale.ROOT);

        if ("overview".equals(docType)) return "overview";
        if ("travel".equals(docType)) return determineTravelChunkType(headingPath, lowerText);
        if ("comparison".equals(docType)) {
            if (TABLE_ROW.matcher(combinedText.split("\\n", -1)[0]).matches()
                    || section.blocks.stream().anyMatch(b -> b.type == BlockType.TABLE)) {
                return "comparison_table";
            }
            return "country_detail";
        }

        // Case study types
        if ("case".equals(docType)) {
            if (COMPARE_KEYWORDS.matcher(headingPath).find()
                    || COMPARE_KEYWORDS.matcher(lowerText).find()) return "comparison_table";
            if (PLAN_KEYWORDS.matcher(headingPath).find()) return "case_plan";
            if (DELIVERABLES_KEYWORDS.matcher(headingPath).find()) return "deliverables";
            if (RISK_KEYWORDS.matcher(headingPath).find()) return "risk_warning";
            if (FALLBACK_KEYWORDS.matcher(headingPath).find()) return "fallback_plan";
            // First section of case study = background
            if (section.headingTexts.isEmpty() || section.headingTexts.size() <= 1) return "case_background";
            return "case_recommendation";
        }

        // Guide types
        if ("guide".equals(docType)) {
            if (AUDIENCE_KEYWORDS.matcher(headingPath).find()
                    || AUDIENCE_KEYWORDS.matcher(lowerText).find()) return "audience";
            if (ROADMAP_KEYWORDS.matcher(headingPath).find()) return "roadmap";
            if (CHECKLIST_KEYWORDS.matcher(headingPath).find()) return "technical_checklist";
            return "guide_section";
        }

        return "general";
    }

    private String determineChunkTypeFromText(String text, String docType,
                                               String sourcePath, String headingPath) {
        String lowerText = text.toLowerCase(Locale.ROOT);
        String lowerHeading = headingPath.toLowerCase(Locale.ROOT);

        if ("overview".equals(docType)) return "overview";
        if ("travel".equals(docType)) return determineTravelChunkType(lowerHeading, lowerText);
        if ("comparison".equals(docType)) {
            String[] lines = text.split("\\n", -1);
            for (String line : lines) {
                if (TABLE_ROW.matcher(line).matches()) return "comparison_table";
            }
            return "country_detail";
        }

        // Case study types - check heading path AND text content for keywords
        if ("case".equals(docType)) {
            // Check for tables in text content
            boolean hasTable = text.contains("|------|") || text.contains("|---");
            if (COMPARE_KEYWORDS.matcher(lowerHeading).find()
                    || COMPARE_KEYWORDS.matcher(lowerText).find()
                    || hasTable) return "comparison_table";
            if (PLAN_KEYWORDS.matcher(lowerHeading).find()
                    || PLAN_KEYWORDS.matcher(lowerText).find()) return "case_plan";
            if (DELIVERABLES_KEYWORDS.matcher(lowerHeading).find()
                    || DELIVERABLES_KEYWORDS.matcher(lowerText).find()) return "deliverables";
            if (RISK_KEYWORDS.matcher(lowerHeading).find()
                    || RISK_KEYWORDS.matcher(lowerText).find()) return "risk_warning";
            if (FALLBACK_KEYWORDS.matcher(lowerHeading).find()
                    || FALLBACK_KEYWORDS.matcher(lowerText).find()) return "fallback_plan";
            if (lowerHeading.contains("推荐路径") || lowerText.contains("推荐路径")
                    || lowerText.contains("建议")) return "case_recommendation";
            if (lowerHeading.contains("用户背景") || lowerHeading.contains("核心矛盾")
                    || lowerText.contains("用户背景")) return "case_background";
            return "case_background";
        }

        // Guide types
        if ("guide".equals(docType)) {
            if (AUDIENCE_KEYWORDS.matcher(lowerHeading).find()
                    || AUDIENCE_KEYWORDS.matcher(lowerText).find()) return "audience";
            if (ROADMAP_KEYWORDS.matcher(lowerHeading).find()
                    || ROADMAP_KEYWORDS.matcher(lowerText).find()) return "roadmap";
            if (CHECKLIST_KEYWORDS.matcher(lowerHeading).find()
                    || CHECKLIST_KEYWORDS.matcher(lowerText).find()) return "technical_checklist";
            return "guide_section";
        }

        return "general";
    }

    private String determineTravelChunkType(String lowerHeading, String lowerText) {
        if (ITINERARY_KEYWORDS.matcher(lowerHeading).find()
                || ITINERARY_KEYWORDS.matcher(lowerText).find()) return "travel_itinerary";
        if (TRANSPORT_KEYWORDS.matcher(lowerHeading).find()
                || TRANSPORT_KEYWORDS.matcher(lowerText).find()) return "travel_transport";
        if (FOOD_KEYWORDS.matcher(lowerHeading).find()
                || FOOD_KEYWORDS.matcher(lowerText).find()) return "travel_food";
        if (SERVICE_KEYWORDS.matcher(lowerHeading).find()
                || SERVICE_KEYWORDS.matcher(lowerText).find()) return "travel_service";
        if (RISK_KEYWORDS.matcher(lowerHeading).find()
                || RISK_KEYWORDS.matcher(lowerText).find()
                || FALLBACK_KEYWORDS.matcher(lowerHeading).find()
                || FALLBACK_KEYWORDS.matcher(lowerText).find()) return "travel_caution";
        return "travel_guide";
    }

    // ===== Utility =====

    private String hashPath(String path) {
        return DigestUtil.sha256Hex(path);
    }

    private String nullSafe(String s) {
        return s == null ? "" : s;
    }

    // ===== Inner classes =====

    enum BlockType {
        HEADING, CODE, TABLE, LIST, BLOCKQUOTE, PARAGRAPH
    }

    static class MarkdownBlock {
        final BlockType type;
        final String content;
        final int startLine;
        final int endLine;
        final int level;          // Only for HEADING
        final String headingText; // Only for HEADING

        MarkdownBlock(BlockType type, String content, int startLine, int endLine) {
            this(type, content, startLine, endLine, 0, "");
        }

        MarkdownBlock(BlockType type, String content, int startLine, int endLine,
                      int level, String headingText) {
            this.type = type;
            this.content = content;
            this.startLine = startLine;
            this.endLine = endLine;
            this.level = level;
            this.headingText = headingText;
        }
    }

    static class Section {
        final List<MarkdownBlock> blocks;
        final List<Integer> headingLevels;
        final List<String> headingTexts;
        final int charCount;

        Section(List<MarkdownBlock> blocks, List<Integer> headingLevels,
                List<String> headingTexts, int charCount) {
            this.blocks = blocks;
            this.headingLevels = headingLevels;
            this.headingTexts = headingTexts;
            this.charCount = charCount;
        }

        String toText() {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < blocks.size(); i++) {
                if (i > 0) sb.append("\n");
                sb.append(blocks.get(i).content);
            }
            return sb.toString();
        }
    }

    static class ChunkCandidate {
        final String text;
        final String headingPath;

        ChunkCandidate(String text, String headingPath) {
            this.text = text;
            this.headingPath = headingPath;
        }
    }

    public record SemanticSection(String title, String text) {
    }
}
