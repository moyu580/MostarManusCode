package com.moyuyu.yuaiagentpro.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;

@Component
public class DateTimeTools {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss z");

    @Tool(description = "Get the current date and time for a specified IANA time zone. Use this when users ask about the current time or date.")
    public String getCurrentDateTime(
            @ToolParam(description = "IANA time zone id, for example Asia/Shanghai or UTC") String zoneId) {
        ZoneId zone = ZoneId.of(zoneId == null || zoneId.isBlank() ? "Asia/Shanghai" : zoneId);
        return ZonedDateTime.now(zone).format(FORMATTER);
    }
}
