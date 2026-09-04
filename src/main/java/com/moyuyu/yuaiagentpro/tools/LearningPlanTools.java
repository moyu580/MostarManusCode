package com.moyuyu.yuaiagentpro.tools;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

@Slf4j
@Component
public class LearningPlanTools extends PersistentToolSupport {

    public LearningPlanTools(ObjectProvider<JdbcTemplate> jdbcTemplateProvider) {
        super(jdbcTemplateProvider);
    }

    @Tool(description = "Persist a structured learning plan.")
    public String saveLearningPlan(
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Learning topic") String topic,
            @ToolParam(description = "Current learner level, for example beginner, intermediate, or advanced", required = false) String level,
            @ToolParam(description = "Number of days in the plan") Integer days,
            @ToolParam(description = "Minutes available per day", required = false) Integer minutesPerDay,
            @ToolParam(description = "Plan content in markdown or plain text") String content) {
        ensureSchema();
        String id = UUID.randomUUID().toString();
        String normalizedChatId = normalizeChatId(chatId);
        String normalizedTopic = requireText(topic, "topic");
        String normalizedContent = requireText(content, "content");
        int normalizedDays = days == null ? 7 : Math.max(1, days);
        int normalizedMinutes = minutesPerDay == null ? 60 : Math.max(1, minutesPerDay);

        jdbcTemplate().update("""
                        insert into learning_plans(id, chat_id, topic, level, days, minutes_per_day, content, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?, now(), now())
                        """,
                id, normalizedChatId, normalizedTopic, level, normalizedDays, normalizedMinutes, normalizedContent);
        log.info("Tool called: saveLearningPlan, id={}, chatId={}, topic={}", id, normalizedChatId, normalizedTopic);
        return "学习计划已保存：id=%s, topic=%s, days=%d".formatted(id, normalizedTopic, normalizedDays);
    }

    @Tool(description = "List saved learning plans for a conversation.")
    public String listLearningPlans(
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Maximum number of plans to return", required = false) Integer limit) {
        ensureSchema();
        String normalizedChatId = normalizeChatId(chatId);
        int normalizedLimit = normalizeLimit(limit);
        List<String> rows = jdbcTemplate().query("""
                        select id, topic, coalesce(level, '-') as level, days, minutes_per_day, created_at
                        from learning_plans
                        where chat_id = ?
                        order by created_at desc
                        limit ?
                        """,
                (rs, rowNum) -> "- %s | id=%s | level=%s | %d days | %d min/day | created=%s".formatted(
                        rs.getString("topic"),
                        rs.getString("id"),
                        rs.getString("level"),
                        rs.getInt("days"),
                        rs.getInt("minutes_per_day"),
                        rs.getTimestamp("created_at")
                ),
                normalizedChatId, normalizedLimit);

        if (rows.isEmpty()) {
            return "没有找到学习计划。";
        }
        return "学习计划列表：\n" + String.join("\n", rows);
    }

    private void ensureSchema() {
        jdbcTemplate().execute("""
                create table if not exists learning_plans (
                    id varchar(64) primary key,
                    chat_id varchar(128) not null,
                    topic text not null,
                    level varchar(64),
                    days integer not null,
                    minutes_per_day integer not null,
                    content text not null,
                    created_at timestamp not null,
                    updated_at timestamp not null
                )
                """);
    }
}
