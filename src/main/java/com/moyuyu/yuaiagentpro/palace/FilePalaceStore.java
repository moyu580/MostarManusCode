package com.moyuyu.yuaiagentpro.palace;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

@Slf4j
@Component
public class FilePalaceStore implements PalaceStore {

    private static final Pattern SAFE_CHAT_ID = Pattern.compile("^[a-zA-Z0-9_-]+$");

    private final ObjectMapper objectMapper;
    private final Path drawersDir;
    private final Path indexDir;
    private final Map<String, Object> chatLocks = new ConcurrentHashMap<>();

    @Autowired
    public FilePalaceStore(ObjectMapper objectMapper) {
        this(objectMapper,
                Path.of(System.getProperty("user.dir"), "tmp", "chat-palace", "drawers"),
                Path.of(System.getProperty("user.dir"), "tmp", "chat-palace", "index"));
    }

    FilePalaceStore(ObjectMapper objectMapper, Path drawersDir, Path indexDir) {
        this.objectMapper = objectMapper;
        this.drawersDir = drawersDir;
        this.indexDir = indexDir;
        try {
            Files.createDirectories(drawersDir);
            Files.createDirectories(indexDir);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to initialize palace storage", e);
        }
    }

    @Override
    public boolean saveTurn(PalaceTurnDrawer drawer, PalaceIndexRecord index) {
        validateChatId(drawer.getChatId());
        Object lock = chatLocks.computeIfAbsent(drawer.getChatId(), key -> new Object());
        synchronized (lock) {
            List<PalaceIndexRecord> indices = loadIndices(drawer.getChatId());
            boolean exists = indices.stream().anyMatch(item -> item.getContentHash().equals(index.getContentHash()));
            if (exists) {
                return false;
            }

            try {
                Files.writeString(
                        drawerPath(drawer.getChatId()),
                        objectMapper.writeValueAsString(drawer) + System.lineSeparator(),
                        StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE,
                        StandardOpenOption.APPEND);
                indices.add(index);
                writeIndices(drawer.getChatId(), indices);
                return true;
            } catch (IOException e) {
                throw new IllegalStateException("Failed to save palace turn, chatId=" + drawer.getChatId(), e);
            }
        }
    }

    @Override
    public List<PalaceIndexRecord> loadIndices(String chatId) {
        validateChatId(chatId);
        Path path = indexPath(chatId);
        if (!Files.exists(path)) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>(objectMapper.readValue(path.toFile(), new TypeReference<List<PalaceIndexRecord>>() {
            }));
        } catch (IOException e) {
            log.warn("Failed to read palace index, chatId={}", chatId, e);
            return new ArrayList<>();
        }
    }

    @Override
    public List<PalaceTurnDrawer> loadDrawers(String chatId, Collection<String> drawerIds) {
        validateChatId(chatId);
        if (drawerIds == null || drawerIds.isEmpty()) {
            return List.of();
        }
        Map<String, Integer> order = new LinkedHashMap<>();
        int index = 0;
        for (String drawerId : drawerIds) {
            order.put(drawerId, index++);
        }

        List<PalaceTurnDrawer> drawers = new ArrayList<>();
        Path path = drawerPath(chatId);
        if (!Files.exists(path)) {
            return drawers;
        }
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                if (line.isBlank()) {
                    continue;
                }
                PalaceTurnDrawer drawer = objectMapper.readValue(line, PalaceTurnDrawer.class);
                if (order.containsKey(drawer.getId())) {
                    drawers.add(drawer);
                }
            }
        } catch (IOException e) {
            log.warn("Failed to read palace drawers, chatId={}", chatId, e);
            return List.of();
        }
        Collections.sort(drawers, (left, right) ->
                Integer.compare(order.getOrDefault(left.getId(), Integer.MAX_VALUE),
                        order.getOrDefault(right.getId(), Integer.MAX_VALUE)));
        return drawers;
    }

    private void writeIndices(String chatId, List<PalaceIndexRecord> indices) throws IOException {
        Path path = indexPath(chatId);
        Path tempPath = path.resolveSibling(path.getFileName() + ".tmp");
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(tempPath.toFile(), indices);
        Files.move(tempPath, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    private Path drawerPath(String chatId) {
        return drawersDir.resolve(chatId + ".jsonl");
    }

    private Path indexPath(String chatId) {
        return indexDir.resolve(chatId + ".json");
    }

    private void validateChatId(String chatId) {
        if (chatId == null || chatId.isBlank()) {
            throw new IllegalArgumentException("chatId must not be blank");
        }
        if (!SAFE_CHAT_ID.matcher(chatId).matches()) {
            throw new IllegalArgumentException("chatId may only contain letters, digits, underscore, and hyphen");
        }
    }
}
