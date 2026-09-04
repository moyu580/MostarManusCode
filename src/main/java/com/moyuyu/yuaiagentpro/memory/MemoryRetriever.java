package com.moyuyu.yuaiagentpro.memory;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "app.memory.structured", name = "enabled", havingValue = "true")
public class MemoryRetriever {

    private static final Pattern SPLIT_PATTERN = Pattern.compile("[\\s,，。.!！?？:：;；、/\\\\]+");

    private final MemoryRepository repository;

    public List<MemoryItem> retrieve(String chatId, String query, int limit) {
        if (!repository.isAvailable() || chatId == null || chatId.isBlank()) {
            return List.of();
        }

        Set<String> terms = tokenize(query);
        List<ScoredMemory> scored = repository.findByChatId(chatId, 120).stream()
                .map(memory -> new ScoredMemory(memory, score(memory, terms)))
                .filter(scoredMemory -> scoredMemory.score() > 0)
                .sorted(Comparator.comparingInt(ScoredMemory::score).reversed())
                .limit(Math.max(1, limit))
                .toList();

        List<MemoryItem> items = scored.stream()
                .map(ScoredMemory::memory)
                .toList();
        repository.touch(items);
        return items;
    }

    private int score(MemoryItem memory, Set<String> terms) {
        int score = memory.getImportance() * 2;
        String haystack = (memory.getTitle() + " " + memory.getContent() + " " + memory.getTags()).toLowerCase();
        for (String term : terms) {
            if (haystack.contains(term.toLowerCase())) {
                score += 5;
            }
        }
        if ("profile".equals(memory.getType()) || "goal".equals(memory.getType())) {
            score += 2;
        }
        return score;
    }

    private Set<String> tokenize(String query) {
        if (query == null || query.isBlank()) {
            return Set.of();
        }
        return SPLIT_PATTERN.splitAsStream(query)
                .map(String::trim)
                .filter(term -> term.length() >= 2)
                .limit(20)
                .collect(Collectors.toSet());
    }

    private record ScoredMemory(MemoryItem memory, int score) {
    }
}
