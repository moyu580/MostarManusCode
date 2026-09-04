package com.moyuyu.yuaiagentpro.memory;

import cn.hutool.crypto.digest.DigestUtil;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
@ConditionalOnProperty(prefix = "app.memory.structured", name = "extractor", havingValue = "rule")
public class RuleBasedMemoryExtractor implements MemoryExtractor {

    private static final Pattern NAME_PATTERN = Pattern.compile("(?:我叫|我的名字(?:是|叫)?)([\\p{IsHan}A-Za-z0-9_\\-]{2,20})");

    @Override
    public List<MemoryItem> extract(String chatId, String userMessage, String assistantMessage) {
        if (chatId == null || chatId.isBlank() || userMessage == null || userMessage.isBlank()) {
            return List.of();
        }

        String text = userMessage.trim();
        List<MemoryItem> items = new ArrayList<>();
        extractName(chatId, text, items);

        if (containsAny(text, "请记住", "帮我记住", "以后你要记住")) {
            items.add(item(chatId, "fact", "用户明确要求记住的信息", cleanupRememberText(text), 5, "explicit,remember", text));
        }
        if (containsAny(text, "目标", "打算", "想要", "想准备", "准备", "规划")) {
            items.add(item(chatId, "goal", "用户目标或规划", text, 4, "goal,plan", text));
        }
        if (containsAny(text, "喜欢", "不喜欢", "偏好", "更希望", "不要", "别")) {
            items.add(item(chatId, "preference", "用户偏好", text, 4, "preference", text));
        }
        if (containsAny(text, "项目", "系统", "仓库", "开源", "产品")) {
            items.add(item(chatId, "project", "用户项目背景", text, 4, "project", text));
        }
        if (containsAny(text, "我是", "目前", "现在", "专业", "大一", "大二", "大三", "大四", "研究生", "工作")) {
            items.add(item(chatId, "profile", "用户背景", text, 3, "profile,background", text));
        }

        return items;
    }

    private void extractName(String chatId, String text, List<MemoryItem> items) {
        Matcher matcher = NAME_PATTERN.matcher(text);
        if (matcher.find()) {
            String name = matcher.group(1).trim();
            items.add(item(chatId, "profile", "用户姓名", "用户姓名是" + name, 5, "identity,name", text));
        }
    }

    private MemoryItem item(String chatId, String type, String title, String content, int importance, String tags, String source) {
        String normalizedContent = content.length() > 500 ? content.substring(0, 500) : content;
        String hash = DigestUtil.sha256Hex(type + "|" + title + "|" + normalizedContent);
        return MemoryItem.builder()
                .id(UUID.randomUUID().toString())
                .chatId(chatId)
                .type(type)
                .title(title)
                .content(normalizedContent)
                .importance(importance)
                .confidence(0.85)
                .tags(tags)
                .source(source)
                .contentHash(hash)
                .build();
    }

    private boolean containsAny(String text, String... keywords) {
        for (String keyword : keywords) {
            if (text.contains(keyword)) {
                return true;
            }
        }
        return false;
    }

    private String cleanupRememberText(String text) {
        return text.replace("请记住", "")
                .replace("帮我记住", "")
                .replace("以后你要记住", "")
                .trim();
    }
}
