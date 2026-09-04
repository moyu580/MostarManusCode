package com.moyuyu.yuaiagentpro.tools;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class DateTimeToolsTest {

    private final DateTimeTools dateTimeTools = new DateTimeTools();

    @Test
    void shouldReturnDateTimeForZone() {
        String result = dateTimeTools.getCurrentDateTime("Asia/Shanghai");

        assertTrue(result.contains("CST") || result.contains("Asia/Shanghai"));
    }
}
