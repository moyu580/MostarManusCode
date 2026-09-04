package com.moyuyu.yuaiagentpro.knowledge;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/knowledge")
@RequiredArgsConstructor
public class KnowledgeController {

    private final KnowledgeIngestionService ingestionService;
    private final KnowledgeSearchService searchService;

    @PostMapping("/sync")
    public ResponseEntity<Map<String, Object>> sync() {
        KnowledgeIngestionService.SyncResult result = ingestionService.sync();
        return ResponseEntity.ok(result.toResponseMap());
    }

    @PostMapping("/reindex")
    public ResponseEntity<Map<String, Object>> reindex() {
        KnowledgeIngestionService.SyncResult result = ingestionService.reindex();
        return ResponseEntity.ok(result.toResponseMap());
    }

    @GetMapping("/search")
    public ResponseEntity<Map<String, Object>> search(
            @RequestParam("query") String query,
            @RequestParam(value = "limit", required = false) Integer limit) {
        List<SearchResult> results = searchService.search(query, limit);
        List<Map<String, Object>> redactedResults = new ArrayList<>();
        for (int i = 0; i < results.size(); i++) {
            redactedResults.add(Map.of(
                    "rank", i + 1,
                    "matched", true,
                    "label", "知识片段 " + (i + 1)
            ));
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", true);
        response.put("query", query);
        response.put("count", results.size());
        response.put("redacted", true);
        response.put("message", results.isEmpty()
                ? "没有命中知识库片段。"
                : "已命中知识库片段，具体内容和来源路径已隐藏。");
        response.put("results", redactedResults);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> stats() {
        Map<String, Object> stats = new LinkedHashMap<>(searchService.stats());
        stats.remove("rootPath");
        stats.remove("source");
        stats.put("redacted", true);
        return ResponseEntity.ok(stats);
    }
}
