package com.moyuyu.yuaiagentpro.tools;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;

abstract class PersistentToolSupport {

    private final ObjectProvider<JdbcTemplate> jdbcTemplateProvider;

    protected PersistentToolSupport(ObjectProvider<JdbcTemplate> jdbcTemplateProvider) {
        this.jdbcTemplateProvider = jdbcTemplateProvider;
    }

    protected JdbcTemplate jdbcTemplate() {
        JdbcTemplate jdbcTemplate = jdbcTemplateProvider.getIfAvailable();
        if (jdbcTemplate == null) {
            throw new IllegalStateException("PostgreSQL tools are disabled. Start with local profile and app.pgvector.enabled=true.");
        }
        return jdbcTemplate;
    }

    protected String requireText(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " is required");
        }
        return value.trim();
    }

    protected int normalizeLimit(Integer limit) {
        if (limit == null) {
            return 10;
        }
        return Math.max(1, Math.min(limit, 50));
    }

    protected String normalizeChatId(String chatId) {
        return chatId == null || chatId.isBlank() ? "default" : chatId.trim();
    }
}
