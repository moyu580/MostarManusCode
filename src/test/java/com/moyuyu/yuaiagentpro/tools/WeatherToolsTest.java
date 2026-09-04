package com.moyuyu.yuaiagentpro.tools;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class WeatherToolsTest {

    private final WeatherTools weatherTools = new WeatherTools();

    @Test
    void shouldReturnMockWeather() {
        String result = weatherTools.getMockWeather("上海", "celsius");

        assertTrue(result.contains("上海"));
        assertTrue(result.contains("演示数据"));
    }
}
