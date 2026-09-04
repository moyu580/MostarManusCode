package com.moyuyu.yuaiagentpro.palace;

public enum MemoryMode {
    DEFAULT,
    PALACE,
    STRUCTURED;

    public static MemoryMode from(String value, MemoryMode fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        for (MemoryMode mode : values()) {
            if (mode.name().equalsIgnoreCase(value.trim())) {
                return mode;
            }
        }
        throw new IllegalArgumentException("memoryMode must be DEFAULT, PALACE, or STRUCTURED");
    }
}
