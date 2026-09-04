package com.moyuyu.yuaiagentpro.app;

public enum ResponseStyle {
    BRIEF("""
            Response style: brief.
            - Start with a one-sentence direct answer.
            - Use at most 3 bullets unless the user explicitly asks for more.
            - Keep the whole answer within about 180 Chinese characters when possible.
            """),

    BALANCED("""
            Response style: balanced.
            - Start with a 1-2 sentence summary.
            - Then use short sections or bullets only when they improve readability.
            - Prefer 3-6 bullets. Avoid long paragraphs.
            """),

    DEEP("""
            Response style: deep.
            - Give a structured answer with clear headings.
            - Still keep paragraphs short and scannable.
            - Put the most actionable conclusion before detailed explanation.
            """);

    private final String instruction;

    ResponseStyle(String instruction) {
        this.instruction = instruction;
    }

    public String instruction() {
        return instruction;
    }

    public static ResponseStyle from(String value, ResponseStyle fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        for (ResponseStyle style : values()) {
            if (style.name().equalsIgnoreCase(value.trim())) {
                return style;
            }
        }
        throw new IllegalArgumentException("responseStyle must be BRIEF, BALANCED, or DEEP");
    }
}
