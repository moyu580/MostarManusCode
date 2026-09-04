package com.moyuyu.yuaiagentpro.tools;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Slf4j
@Component
public class TaskTools extends PersistentToolSupport {

    public TaskTools(ObjectProvider<JdbcTemplate> jdbcTemplateProvider) {
        super(jdbcTemplateProvider);
    }

    @Tool(description = "Create and persist a task for the current learning or collaboration session.")
    public String createTask(
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Task title") String title,
            @ToolParam(description = "Task description", required = false) String description,
            @ToolParam(description = "Priority: low, medium, or high", required = false) String priority,
            @ToolParam(description = "Due date in yyyy-MM-dd format", required = false) String dueDate) {
        ensureSchema();
        String id = UUID.randomUUID().toString();
        String normalizedChatId = normalizeChatId(chatId);
        String normalizedTitle = requireText(title, "title");
        String normalizedPriority = priority == null || priority.isBlank() ? "medium" : priority.trim().toLowerCase();
        LocalDate normalizedDueDate = dueDate == null || dueDate.isBlank() ? null : LocalDate.parse(dueDate.trim());

        jdbcTemplate().update("""
                        insert into agent_tasks(id, chat_id, title, description, status, priority, due_date, created_at, updated_at)
                        values (?, ?, ?, ?, 'pending', ?, ?, now(), now())
                        """,
                id, normalizedChatId, normalizedTitle, description, normalizedPriority, normalizedDueDate);
        log.info("Tool called: createTask, id={}, chatId={}, title={}", id, normalizedChatId, normalizedTitle);
        return "任务已创建：id=%s, title=%s, status=pending".formatted(id, normalizedTitle);
    }

    @Tool(description = "List persisted tasks for a conversation.")
    public String listTasks(
            @ToolParam(description = "Conversation id. Use default if not provided.", required = false) String chatId,
            @ToolParam(description = "Task status filter: pending, completed, cancelled, or all", required = false) String status,
            @ToolParam(description = "Maximum number of tasks to return", required = false) Integer limit) {
        ensureSchema();
        String normalizedChatId = normalizeChatId(chatId);
        String normalizedStatus = status == null || status.isBlank() ? "all" : status.trim().toLowerCase();
        int normalizedLimit = normalizeLimit(limit);

        List<TaskRow> rows;
        if ("all".equals(normalizedStatus)) {
            rows = jdbcTemplate().query("""
                            select id, title, status, priority, due_date
                            from agent_tasks
                            where chat_id = ?
                            order by created_at desc
                            limit ?
                            """,
                    this::mapTaskRow, normalizedChatId, normalizedLimit);
        } else {
            rows = jdbcTemplate().query("""
                            select id, title, status, priority, due_date
                            from agent_tasks
                            where chat_id = ? and status = ?
                            order by created_at desc
                            limit ?
                            """,
                    this::mapTaskRow, normalizedChatId, normalizedStatus, normalizedLimit);
        }

        if (rows.isEmpty()) {
            return "没有找到任务。";
        }
        StringBuilder result = new StringBuilder("任务列表：");
        for (TaskRow row : rows) {
            result.append("\n- [%s] %s | id=%s | priority=%s | due=%s"
                    .formatted(row.status(), row.title(), row.id(), row.priority(), row.dueDate()));
        }
        return result.toString();
    }

    @Tool(description = "Mark a persisted task as completed.")
    public String completeTask(@ToolParam(description = "Task id") String taskId) {
        ensureSchema();
        String normalizedTaskId = requireText(taskId, "taskId");
        int updated = jdbcTemplate().update("""
                        update agent_tasks
                        set status = 'completed', updated_at = now()
                        where id = ?
                        """,
                normalizedTaskId);
        if (updated == 0) {
            return "未找到任务：" + normalizedTaskId;
        }
        log.info("Tool called: completeTask, id={}", normalizedTaskId);
        return "任务已完成：" + normalizedTaskId;
    }

    private void ensureSchema() {
        jdbcTemplate().execute("""
                create table if not exists agent_tasks (
                    id varchar(64) primary key,
                    chat_id varchar(128) not null,
                    title text not null,
                    description text,
                    status varchar(32) not null,
                    priority varchar(32),
                    due_date date,
                    created_at timestamp not null,
                    updated_at timestamp not null
                )
                """);
    }

    private TaskRow mapTaskRow(ResultSet rs, int rowNum) throws SQLException {
        return new TaskRow(
                rs.getString("id"),
                rs.getString("title"),
                rs.getString("status"),
                rs.getString("priority"),
                rs.getObject("due_date") == null ? "-" : rs.getString("due_date")
        );
    }

    private record TaskRow(String id, String title, String status, String priority, String dueDate) {
    }
}
