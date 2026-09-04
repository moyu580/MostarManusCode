package com.moyuyu.yuaiagentpro.knowledge;

import cn.hutool.crypto.digest.DigestUtil;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

@Slf4j
@Component
@RequiredArgsConstructor
public class MarkdownKnowledgeReader {

    private static final Pattern FRONT_MATTER_PATTERN = Pattern.compile("^---\\s*\\R(.*?)\\R---\\s*(?:\\R|$)", Pattern.DOTALL);
    private static final Pattern H1_PATTERN = Pattern.compile("^#\\s+(.+)$", Pattern.MULTILINE);

    private final KnowledgeProperties properties;

    public List<KnowledgeDocument> readAll() {
        String rootPath = properties.getLocal().getRootPath();
        Path root = Paths.get(rootPath);
        if (!Files.exists(root) || !Files.isDirectory(root)) {
            log.warn("Knowledge root path does not exist or is not a directory: {}", rootPath);
            return List.of();
        }

        List<KnowledgeDocument> documents = new ArrayList<>();
        try (Stream<Path> stream = Files.walk(root)) {
            stream.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".md"))
                    .filter(path -> !shouldSkip(path))
                    .sorted()
                    .forEach(path -> {
                        try {
                            KnowledgeDocument doc = readDocument(path);
                            documents.add(doc);
                        } catch (Exception e) {
                            log.error("Failed to read document: {}", path, e);
                        }
                    });
        } catch (IOException e) {
            log.error("Failed to walk knowledge directory: {}", rootPath, e);
        }

        log.info("Scanned {} Markdown files from {}", documents.size(), rootPath);
        return documents;
    }

    private boolean shouldSkip(Path path) {
        if (!properties.getChunk().isSkipTemplateFiles()) {
            return false;
        }
        String rootPath = properties.getLocal().getRootPath();
        Path root = Paths.get(rootPath);
        // Check if the path is under a "99-模板" directory
        Path relative = root.relativize(path);
        for (int i = 0; i < relative.getNameCount(); i++) {
            String name = relative.getName(i).toString();
            if (name.contains("99-模板") || name.contains("99-template") || name.contains("99-template")) {
                log.debug("Skipping template file: {}", path);
                return true;
            }
        }
        return false;
    }

    KnowledgeDocument readDocument(Path filePath) throws IOException {
        String rawContent = Files.readString(filePath, StandardCharsets.UTF_8);
        String contentHash = DigestUtil.sha256Hex(rawContent);
        Instant lastModified = Files.getLastModifiedTime(filePath).toInstant();

        String bodyContent = rawContent;
        Map<String, Object> frontMatter = Map.of();
        Matcher fmMatcher = FRONT_MATTER_PATTERN.matcher(rawContent);
        if (fmMatcher.find()) {
            String fmText = fmMatcher.group(1);
            bodyContent = rawContent.substring(fmMatcher.end());
            frontMatter = parseYamlSafe(fmText);
        }

        String docTitle = extractTitle(frontMatter, bodyContent, filePath);
        String category = extractCategory(frontMatter, filePath, root());
        List<String> tags = extractTags(frontMatter);
        String audience = extractString(frontMatter, "audience");
        String stage = extractString(frontMatter, "stage");
        String goal = extractString(frontMatter, "goal");

        return KnowledgeDocument.builder()
                .sourcePath(filePath.toAbsolutePath().toString())
                .docTitle(docTitle)
                .category(category)
                .tags(tags)
                .rawContent(bodyContent.strip())
                .contentHash(contentHash)
                .fileLastModified(lastModified)
                .audience(audience)
                .stage(stage)
                .goal(goal)
                .frontMatter(frontMatter)
                .build();
    }

    private Path root() {
        return Paths.get(properties.getLocal().getRootPath());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseYamlSafe(String yamlText) {
        try {
            Yaml yaml = new Yaml();
            Object parsed = yaml.load(yamlText);
            if (parsed instanceof Map) {
                return (Map<String, Object>) parsed;
            }
        } catch (Exception e) {
            log.debug("Failed to parse YAML front matter: {}", e.getMessage());
        }
        return Map.of();
    }

    private String extractTitle(Map<String, Object> frontMatter, String bodyContent, Path filePath) {
        if (frontMatter.containsKey("title")) {
            Object t = frontMatter.get("title");
            if (t != null && !t.toString().isBlank()) {
                return t.toString().trim();
            }
        }
        Matcher h1m = H1_PATTERN.matcher(bodyContent);
        if (h1m.find()) {
            return h1m.group(1).trim();
        }
        String fileName = filePath.getFileName().toString();
        return fileName.replaceAll("\\.md$", "");
    }

    private String extractCategory(Map<String, Object> frontMatter, Path filePath, Path root) {
        if (frontMatter.containsKey("category")) {
            Object c = frontMatter.get("category");
            if (c != null && !c.toString().isBlank()) {
                return c.toString().trim();
            }
        }
        Path parent = filePath.getParent();
        if (parent != null && !parent.equals(root)) {
            return parent.getFileName().toString();
        }
        return "general";
    }

    @SuppressWarnings("unchecked")
    private List<String> extractTags(Map<String, Object> frontMatter) {
        if (frontMatter.containsKey("tags")) {
            Object t = frontMatter.get("tags");
            if (t instanceof List) {
                return ((List<?>) t).stream()
                        .map(Object::toString)
                        .filter(s -> !s.isBlank())
                        .toList();
            }
            if (t instanceof String) {
                return Arrays.stream(((String) t).split("[,\\s]+"))
                        .filter(s -> !s.isBlank())
                        .toList();
            }
        }
        return List.of();
    }

    private String extractString(Map<String, Object> frontMatter, String key) {
        if (frontMatter.containsKey(key)) {
            Object val = frontMatter.get(key);
            if (val != null && !val.toString().isBlank()) {
                return val.toString().trim();
            }
        }
        return null;
    }
}
