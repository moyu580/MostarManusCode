package com.moyuyu.yuaiagentpro.controller;

import com.moyuyu.yuaiagentpro.map.AmapPlaceSearchService;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.ai.model.function.FunctionCallback;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/health")
public class HealthController {

    private final ObjectProvider<JdbcTemplate> pgVectorJdbcTemplateProvider;
    private final ObjectProvider<ToolCallbackProvider> toolCallbackProvider;
    private final ObjectProvider<AmapPlaceSearchService> amapPlaceSearchServiceProvider;
    private final Environment environment;

    public HealthController(
            @Qualifier("pgVectorJdbcTemplate") ObjectProvider<JdbcTemplate> pgVectorJdbcTemplateProvider,
            ObjectProvider<ToolCallbackProvider> toolCallbackProvider,
            ObjectProvider<AmapPlaceSearchService> amapPlaceSearchServiceProvider,
            Environment environment) {
        this.pgVectorJdbcTemplateProvider = pgVectorJdbcTemplateProvider;
        this.toolCallbackProvider = toolCallbackProvider;
        this.amapPlaceSearchServiceProvider = amapPlaceSearchServiceProvider;
        this.environment = environment;
    }

    @GetMapping
    public String healthCheck() {
        return "ok";
    }

    @GetMapping("/mcp")
    public Map<String, Object> mcpHealth() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("activeProfiles", List.of(environment.getActiveProfiles()));
        result.put("mcpEnabled", environment.getProperty("spring.ai.mcp.client.enabled", "true"));
        result.put("mcpType", environment.getProperty("spring.ai.mcp.client.type", "SYNC"));
        result.put("amapKeyConfigured", environment.getProperty("app.amap.api-key", "").length() > 0);

        ToolCallbackProvider provider = toolCallbackProvider.getIfAvailable();
        if (provider == null) {
            result.put("toolProvider", "MISSING");
            result.put("toolCount", 0);
            result.put("tools", List.of());
            return result;
        }

        try {
            FunctionCallback[] callbacks = provider.getToolCallbacks();
            result.put("toolProvider", provider.getClass().getName());
            result.put("toolCount", callbacks.length);
            result.put("tools", List.of(callbacks).stream()
                    .map(callback -> Map.of(
                            "name", callback.getName(),
                            "description", callback.getDescription()))
                    .toList());
        } catch (Exception e) {
            result.put("toolProvider", provider.getClass().getName());
            result.put("toolStatus", "ERROR");
            result.put("toolCount", 0);
            result.put("errorType", e.getClass().getName());
            result.put("errorMessage", e.getMessage());
        }
        return result;
    }

    @GetMapping("/amap")
    public Map<String, Object> amapHealth(
            @RequestParam(value = "query", defaultValue = "瑶海区 徽菜") String query) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("amapKeyConfigured", environment.getProperty("app.amap.api-key", "").length() > 0);
        AmapPlaceSearchService service = amapPlaceSearchServiceProvider.getIfAvailable();
        if (service == null) {
            result.put("status", "MISSING");
            result.put("count", 0);
            return result;
        }
        List<Map<String, Object>> pois = service.searchText(query, 3).stream()
                .map(poi -> Map.<String, Object>of(
                        "name", poi.name(),
                        "area", poi.area(),
                        "address", poi.address(),
                        "type", poi.type()))
                .toList();
        result.put("status", service.isAvailable() ? "UP" : "DISABLED");
        result.put("query", query);
        result.put("count", pois.size());
        result.put("pois", pois);
        return result;
    }

    @GetMapping("/pgvector")
    public Map<String, Object> pgVectorHealth() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("activeProfiles", List.of(environment.getActiveProfiles()));
        result.put("pgvectorEnabled", environment.getProperty("app.pgvector.enabled", "false"));

        try {
            JdbcTemplate jdbcTemplate = pgVectorJdbcTemplateProvider.getIfAvailable();
            if (jdbcTemplate == null) {
                result.put("database", "DISABLED");
                result.put("pgvectorInstalled", false);
                result.put("message", "pgVectorJdbcTemplate is not available. Enable local profile and app.pgvector.enabled=true.");
                return result;
            }

            Integer databaseResult = jdbcTemplate.queryForObject("select 1", Integer.class);
            Boolean pgvectorInstalled = jdbcTemplate.queryForObject(
                    "select exists(select 1 from pg_extension where extname = 'vector')",
                    Boolean.class);

            result.put("database", databaseResult != null && databaseResult == 1 ? "UP" : "UNKNOWN");
            result.put("pgvectorInstalled", Boolean.TRUE.equals(pgvectorInstalled));
            return result;
        } catch (Exception e) {
            result.put("database", "DOWN");
            result.put("pgvectorInstalled", false);
            result.put("errorType", e.getClass().getName());
            result.put("errorMessage", e.getMessage());
            return result;
        }
    }

    @GetMapping("/pgvector/business-data")
    public Map<String, Object> pgVectorBusinessData(
            @RequestParam(value = "chatId", defaultValue = "test-pgvector-001") String chatId) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("chatId", chatId);
        try {
            JdbcTemplate jdbcTemplate = pgVectorJdbcTemplateProvider.getIfAvailable();
            if (jdbcTemplate == null) {
                result.put("database", "DISABLED");
                result.put("message", "pgVectorJdbcTemplate is not available.");
                return result;
            }

            Integer taskCount = jdbcTemplate.queryForObject("""
                    select count(*) from agent_tasks where chat_id = ?
                    """, Integer.class, chatId);
            Integer learningPlanCount = jdbcTemplate.queryForObject("""
                    select count(*) from learning_plans where chat_id = ?
                    """, Integer.class, chatId);

            result.put("database", "UP");
            result.put("taskCount", taskCount);
            result.put("learningPlanCount", learningPlanCount);
            result.put("recentTasks", jdbcTemplate.queryForList("""
                    select id, title, status, priority, due_date, created_at
                    from agent_tasks
                    where chat_id = ?
                    order by created_at desc
                    limit 5
                    """, chatId));
            result.put("recentLearningPlans", jdbcTemplate.queryForList("""
                    select id, topic, level, days, minutes_per_day, created_at
                    from learning_plans
                    where chat_id = ?
                    order by created_at desc
                    limit 5
                    """, chatId));
            return result;
        } catch (Exception e) {
            result.put("database", "DOWN");
            result.put("errorType", e.getClass().getName());
            result.put("errorMessage", e.getMessage());
            return result;
        }
    }
}
