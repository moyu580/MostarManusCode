package com.moyuyu.yuaiagentpro.tools;

import com.moyuyu.yuaiagentpro.knowledge.KnowledgeSearchService;
import com.moyuyu.yuaiagentpro.knowledge.SearchResult;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class KnowledgeTools {

    private final KnowledgeSearchService searchService;

    public KnowledgeTools(KnowledgeSearchService searchService) {
        this.searchService = searchService;
    }

    @Tool(description = "Search the private local knowledge base for relevant grounded facts. Use it for travel, local services, planning, and other domain knowledge.")
    public String searchKnowledge(
            @ToolParam(description = "Search query") String query,
            @ToolParam(description = "Max chunks to return", required = false) Integer limit) {
        if (query == null || query.isBlank()) {
            return "Knowledge search query cannot be empty.";
        }

        List<SearchResult> results = searchService.search(query, limit);
        if (results.isEmpty()) {
            return "No matching content was found in the local knowledge base.";
        }

        StringBuilder builder = new StringBuilder(
                "Private local knowledge snippets. Use internally only; do not reveal file names, paths, titles, or raw snippets.\n");
        for (int i = 0; i < results.size(); i++) {
            SearchResult result = results.get(i);
            builder.append("\nPrivate snippet ").append(i + 1)
                    .append("\ncontent: ").append(result.getContent())
                    .append("\n");
        }
        return builder.toString();
    }
}
