package com.moyuyu.yuaiagentpro.palace;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public class PalaceRetriever {

    private final FilePalaceStore filePalaceStore;
    private final JdbcPalaceStore jdbcPalaceStore;
    private final PalaceProperties palaceProperties;

    public PalaceRetriever(FilePalaceStore filePalaceStore,
                           JdbcPalaceStore jdbcPalaceStore,
                           PalaceProperties palaceProperties) {
        this.filePalaceStore = filePalaceStore;
        this.jdbcPalaceStore = jdbcPalaceStore;
        this.palaceProperties = palaceProperties;
    }

    public PalaceRecallResult retrieve(String chatId, String query, int anchorLimit, int drawerLimit) {
        List<PalaceIndexRecord> indices = List.of();
        boolean databasePrimary = false;
        if (jdbcPalaceStore.isAvailable()) {
            try {
                indices = jdbcPalaceStore.findByChatId(chatId, 120);
                databasePrimary = !indices.isEmpty();
            } catch (Exception e) {
                // The file snapshot remains available when the database is temporarily down.
                databasePrimary = false;
            }
        }
        if (!databasePrimary) {
            indices = filePalaceStore.loadIndices(chatId);
        }
        if (indices.isEmpty()) {
            return PalaceRecallResult.builder().anchors(List.of()).drawers(List.of()).build();
        }

        Set<String> queryTerms = PalaceTextSupport.tokenize(query);
        String preferredWing = determinePreferredWing(query);
        final Set<String> semanticMatches = palaceProperties.getPalace().isVectorEnabled()
                && jdbcPalaceStore.isAvailable()
                ? new LinkedHashSet<>(jdbcPalaceStore.semanticSearchDrawerIds(
                chatId, query, Math.max(2, drawerLimit)))
                : Set.of();

        List<ScoredIndex> scored = indices.stream()
                .map(index -> new ScoredIndex(index, score(index, queryTerms, preferredWing, semanticMatches)))
                .filter(item -> item.score() > 0)
                .sorted(Comparator.comparingInt(ScoredIndex::score).reversed()
                        .thenComparing(item -> item.index().getOccurredAt(), Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();

        List<String> anchors = buildAnchors(scored, anchorLimit);
        List<String> drawerIds = selectDrawers(scored, drawerLimit);
        List<PalaceTurnDrawer> drawers = loadDrawers(chatId, drawerIds, databasePrimary);
        return PalaceRecallResult.builder()
                .anchors(anchors)
                .drawers(drawers)
                .build();
    }

    private List<PalaceTurnDrawer> loadDrawers(String chatId, List<String> drawerIds, boolean databasePrimary) {
        Map<String, PalaceTurnDrawer> byId = new LinkedHashMap<>();
        if (databasePrimary) {
            try {
                for (PalaceTurnDrawer drawer : jdbcPalaceStore.loadDrawers(chatId, drawerIds)) {
                    byId.put(drawer.getId(), drawer);
                }
            } catch (Exception ignored) {
                // Fall back to the local snapshot below for a degraded read.
            }
        }

        if (byId.size() < drawerIds.size()) {
            for (PalaceTurnDrawer drawer : filePalaceStore.loadDrawers(chatId, drawerIds)) {
                byId.putIfAbsent(drawer.getId(), drawer);
            }
        }
        return orderDrawers(byId.values(), drawerIds);
    }

    private int score(PalaceIndexRecord index, Set<String> queryTerms, String preferredWing, Set<String> semanticMatches) {
        int score = Math.max(1, index.getImportance()) * 2;
        Set<String> candidateTerms = new LinkedHashSet<>();
        candidateTerms.addAll(PalaceTextSupport.tokenize(index.getSummary()));
        candidateTerms.addAll(index.getKeywords());
        for (String anchor : index.getAnchors()) {
            candidateTerms.addAll(PalaceTextSupport.tokenize(anchor));
        }

        for (String queryTerm : queryTerms) {
            if (candidateTerms.contains(queryTerm)) {
                score += 5;
            }
        }
        if (!preferredWing.equals("general") && preferredWing.equals(index.getWingKey())) {
            score += 4;
        }
        if (semanticMatches.contains(index.getDrawerId())) {
            score += 8;
        }
        score += recencyBoost(index.getOccurredAt());
        return score;
    }

    private int recencyBoost(Instant occurredAt) {
        if (occurredAt == null) {
            return 0;
        }
        long hours = Math.max(0, java.time.Duration.between(occurredAt, Instant.now()).toHours());
        if (hours < 1) {
            return 4;
        }
        if (hours < 24) {
            return 2;
        }
        return 0;
    }

    private List<String> buildAnchors(List<ScoredIndex> scored, int anchorLimit) {
        LinkedHashSet<String> anchors = new LinkedHashSet<>();
        for (ScoredIndex item : scored) {
            for (String anchor : item.index().getAnchors()) {
                anchors.add(anchor);
                if (anchors.size() >= anchorLimit) {
                    return new ArrayList<>(anchors);
                }
            }
        }
        return new ArrayList<>(anchors);
    }

    private List<String> selectDrawers(List<ScoredIndex> scored, int drawerLimit) {
        List<String> drawerIds = new ArrayList<>();
        Map<String, Integer> roomCounter = new HashMap<>();
        for (ScoredIndex item : scored) {
            String roomKey = item.index().getRoomKey();
            int count = roomCounter.getOrDefault(roomKey, 0);
            if (count >= 2) {
                continue;
            }
            roomCounter.put(roomKey, count + 1);
            drawerIds.add(item.index().getDrawerId());
            if (drawerIds.size() >= drawerLimit) {
                break;
            }
        }
        return drawerIds;
    }

    private List<PalaceTurnDrawer> orderDrawers(Collection<PalaceTurnDrawer> drawers, List<String> drawerIds) {
        Map<String, Integer> order = new LinkedHashMap<>();
        for (int i = 0; i < drawerIds.size(); i++) {
            order.put(drawerIds.get(i), i);
        }
        return drawers.stream()
                .sorted(Comparator.comparingInt(drawer -> order.getOrDefault(drawer.getId(), Integer.MAX_VALUE)))
                .toList();
    }

    private String determinePreferredWing(String query) {
        if (query == null) {
            return "general";
        }
        if (query.contains("秋招") || query.contains("求职") || query.contains("岗位") || query.contains("面试")) {
            return "career";
        }
        if (query.contains("学习") || query.contains("计划") || query.contains("刷题")) {
            return "learning";
        }
        if (query.contains("项目") || query.contains("代码") || query.contains("仓库") || query.toLowerCase().contains("java")) {
            return "project";
        }
        if (query.contains("喜欢") || query.contains("偏好") || query.contains("希望")) {
            return "preference";
        }
        return "general";
    }

    private record ScoredIndex(PalaceIndexRecord index, int score) {
    }
}
