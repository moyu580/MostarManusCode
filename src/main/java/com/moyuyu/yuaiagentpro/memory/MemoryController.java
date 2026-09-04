package com.moyuyu.yuaiagentpro.memory;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/memory")
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "app.memory.structured", name = "enabled", havingValue = "true")
public class MemoryController {

    private final MemoryRepository repository;
    private final MemoryRetriever retriever;

    @GetMapping
    public ResponseEntity<Map<String, Object>> list(
            @RequestParam("chatId") String chatId,
            @RequestParam(value = "limit", defaultValue = "50") int limit) {
        List<MemoryItem> memories = repository.findByChatId(chatId, limit);
        return ResponseEntity.ok(Map.of(
                "available", repository.isAvailable(),
                "chatId", chatId,
                "count", memories.size(),
                "memories", memories
        ));
    }

    @GetMapping("/search")
    public ResponseEntity<Map<String, Object>> search(
            @RequestParam("chatId") String chatId,
            @RequestParam("query") String query,
            @RequestParam(value = "limit", defaultValue = "10") int limit) {
        List<MemoryItem> memories = retriever.retrieve(chatId, query, limit);
        return ResponseEntity.ok(Map.of(
                "available", repository.isAvailable(),
                "chatId", chatId,
                "query", query,
                "count", memories.size(),
                "memories", memories
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, Object>> delete(@PathVariable("id") String id) {
        return ResponseEntity.ok(Map.of(
                "deleted", repository.deleteById(id)
        ));
    }

    @DeleteMapping
    public ResponseEntity<Map<String, Object>> clear(@RequestParam("chatId") String chatId) {
        int deleted = repository.deleteByChatId(chatId);
        return ResponseEntity.ok(Map.of(
                "chatId", chatId,
                "deleted", deleted
        ));
    }
}
