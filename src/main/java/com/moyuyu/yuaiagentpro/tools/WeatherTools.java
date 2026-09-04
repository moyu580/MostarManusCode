package com.moyuyu.yuaiagentpro.tools;

import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.stereotype.Component;

import java.util.Locale;

@Component
public class WeatherTools {

    @Tool(description = "Get mock current weather for a city. This is demo data for validating function calling, not real-time weather.")
    public String getMockWeather(
            @ToolParam(description = "City name, for example Shanghai, Beijing, Guangzhou, or Shenzhen") String city,
            @ToolParam(description = "Temperature unit: celsius or fahrenheit") String unit) {
        String normalizedCity = city == null || city.isBlank() ? "未知城市" : city.trim();
        String normalizedUnit = unit == null || unit.isBlank() ? "celsius" : unit.trim().toLowerCase(Locale.ROOT);
        boolean fahrenheit = "fahrenheit".equals(normalizedUnit);

        int temperatureCelsius = switch (normalizedCity.toLowerCase(Locale.ROOT)) {
            case "beijing", "北京" -> 18;
            case "shanghai", "上海" -> 22;
            case "guangzhou", "广州" -> 27;
            case "shenzhen", "深圳" -> 28;
            case "hefei", "合肥", "yaohai", "瑶海" -> 24;
            default -> 24;
        };
        int temperature = fahrenheit ? temperatureCelsius * 9 / 5 + 32 : temperatureCelsius;
        String unitLabel = fahrenheit ? "F" : "C";

        return "%s 当前模拟天气：多云，气温 %d%s，湿度 62%%，微风。注意：这是 Function Calling 演示数据，不是实时天气。"
                .formatted(normalizedCity, temperature, unitLabel);
    }
}
