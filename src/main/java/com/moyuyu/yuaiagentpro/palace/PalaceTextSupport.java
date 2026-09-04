package com.moyuyu.yuaiagentpro.palace;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class PalaceTextSupport {

    private static final Pattern LATIN_TOKEN = Pattern.compile("[A-Za-z0-9_-]{2,}");
    private static final Pattern HAN_SEGMENT = Pattern.compile("[\\p{IsHan}]{2,16}");

    private PalaceTextSupport() {
    }

    static Set<String> tokenize(String text) {
        if (text == null || text.isBlank()) {
            return Set.of();
        }
        LinkedHashSet<String> terms = new LinkedHashSet<>();
        Matcher latinMatcher = LATIN_TOKEN.matcher(text);
        while (latinMatcher.find() && terms.size() < 60) {
            terms.add(latinMatcher.group().toLowerCase(Locale.ROOT));
        }
        Matcher hanMatcher = HAN_SEGMENT.matcher(text);
        while (hanMatcher.find() && terms.size() < 60) {
            String chunk = hanMatcher.group();
            for (int size = 4; size >= 2; size--) {
                for (int i = 0; i + size <= chunk.length() && terms.size() < 60; i++) {
                    terms.add(chunk.substring(i, i + size));
                }
            }
        }
        return terms;
    }

    static String summarize(String userText, String assistantText, int maxChars) {
        String source = (userText == null ? "" : userText.trim()) +
                ((assistantText == null || assistantText.isBlank()) ? "" : " | " + assistantText.trim());
        return limit(source, maxChars);
    }

    static String limit(String text, int maxChars) {
        if (text == null || maxChars <= 0 || text.length() <= maxChars) {
            return text == null ? "" : text;
        }
        return text.substring(0, maxChars);
    }

    static String slug(String input) {
        if (input == null || input.isBlank()) {
            return "general";
        }
        String normalized = Normalizer.normalize(input, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return normalized.isBlank() ? "general" : normalized;
    }

    static String buildRoomKey(String wingKey, Set<String> terms) {
        List<String> parts = new ArrayList<>();
        for (String term : terms) {
            if (term.matches("[a-z0-9_-]{3,}") && parts.size() < 2) {
                parts.add(slug(term));
            }
        }
        if (parts.isEmpty()) {
            return wingKey + "-general";
        }
        return wingKey + "-" + String.join("-", parts);
    }
}
