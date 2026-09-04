package com.moyuyu.yuaiagentpro.palace;

import cn.hutool.crypto.digest.DigestUtil;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class PalaceClassifier {

    private static final Pattern NAME_PATTERN = Pattern.compile("我叫([\\p{IsHan}A-Za-z0-9_-]{2,20})");

    private static final Map<String, List<String>> WING_KEYWORDS = Map.of(
            "career", List.of("秋招", "春招", "求职", "面试", "简历", "offer", "岗位", "后端", "前端", "实习"),
            "learning", List.of("学习", "刷题", "课程", "备考", "复习", "计划", "教程", "训练"),
            "project", List.of("项目", "系统", "仓库", "代码", "接口", "bug", "发布", "功能"),
            "profile", List.of("我叫", "我是", "学校", "专业", "学生", "工作", "毕业"),
            "preference", List.of("喜欢", "不喜欢", "偏好", "希望", "不要", "倾向")
    );

    public PalacePreparedTurn classify(String chatId, String userText, String assistantText) {
        String normalizedUserText = userText == null ? "" : userText.trim();
        String normalizedAssistantText = assistantText == null ? "" : assistantText.trim();
        String rawText = "User: " + normalizedUserText + "\nAssistant: " + normalizedAssistantText;
        Instant occurredAt = Instant.now();
        Set<String> terms = PalaceTextSupport.tokenize(normalizedUserText + "\n" + normalizedAssistantText);
        String wingKey = determineWing(normalizedUserText);
        String roomKey = PalaceTextSupport.buildRoomKey(wingKey, terms);
        List<String> anchors = extractAnchors(normalizedUserText);
        List<String> keywords = new ArrayList<>(terms.stream().limit(12).toList());
        int importance = determineImportance(normalizedUserText, anchors);
        String contentHash = DigestUtil.sha256Hex(chatId + "|" + rawText);
        String drawerId = UUID.randomUUID().toString();

        PalaceTurnDrawer drawer = PalaceTurnDrawer.builder()
                .id(drawerId)
                .chatId(chatId)
                .wingKey(wingKey)
                .roomKey(roomKey)
                .userText(normalizedUserText)
                .assistantText(normalizedAssistantText)
                .rawText(rawText)
                .contentHash(contentHash)
                .occurredAt(occurredAt)
                .build();

        PalaceIndexRecord index = PalaceIndexRecord.builder()
                .drawerId(drawerId)
                .chatId(chatId)
                .wingKey(wingKey)
                .roomKey(roomKey)
                .summary(PalaceTextSupport.summarize(normalizedUserText, normalizedAssistantText, 220))
                .keywords(keywords)
                .anchors(anchors)
                .importance(importance)
                .contentHash(contentHash)
                .occurredAt(occurredAt)
                .build();

        return PalacePreparedTurn.builder()
                .drawer(drawer)
                .index(index)
                .build();
    }

    private String determineWing(String userText) {
        if (containsAny(userText, "秋招", "春招", "求职", "面试", "简历", "offer", "岗位", "后端", "前端", "实习")) {
            return "career";
        }
        for (Map.Entry<String, List<String>> entry : WING_KEYWORDS.entrySet()) {
            for (String keyword : entry.getValue()) {
                if (userText.contains(keyword)) {
                    return entry.getKey();
                }
            }
        }
        String lower = userText.toLowerCase(Locale.ROOT);
        if (lower.contains("java") || lower.contains("python") || lower.contains("spring")) {
            return "project";
        }
        return "general";
    }

    private List<String> extractAnchors(String userText) {
        LinkedHashSet<String> anchors = new LinkedHashSet<>();
        Matcher matcher = NAME_PATTERN.matcher(userText);
        if (matcher.find()) {
            anchors.add("用户姓名：" + matcher.group(1));
        }
        if (containsAny(userText, "我是", "专业", "学生", "工作", "毕业")) {
            anchors.add("用户背景：" + PalaceTextSupport.limit(userText, 60));
        }
        if (containsAny(userText, "目标", "想", "打算", "准备", "计划", "秋招", "求职")) {
            anchors.add("用户目标：" + PalaceTextSupport.limit(userText, 60));
        }
        if (containsAny(userText, "喜欢", "不喜欢", "偏好", "希望", "不要")) {
            anchors.add("用户偏好：" + PalaceTextSupport.limit(userText, 60));
        }
        if (containsAny(userText, "项目", "系统", "仓库", "代码")) {
            anchors.add("项目背景：" + PalaceTextSupport.limit(userText, 60));
        }
        return anchors.stream().limit(4).toList();
    }

    private int determineImportance(String userText, List<String> anchors) {
        int importance = 2;
        if (!anchors.isEmpty()) {
            importance += 2;
        }
        if (containsAny(userText, "记住", "之后", "以后", "一直", "长期")) {
            importance += 1;
        }
        return Math.min(5, importance);
    }

    private boolean containsAny(String text, String... keywords) {
        for (String keyword : keywords) {
            if (text.contains(keyword)) {
                return true;
            }
        }
        return false;
    }
}
