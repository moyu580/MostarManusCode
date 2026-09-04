package com.moyuyu.yuaiagentpro.map;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Slf4j
@Service
public class AmapPlaceSearchService {

    private static final String AMAP_PLACE_TEXT_URL = "https://restapi.amap.com/v3/place/text";
    private static final List<String> HEFEI_AREAS = List.of(
            "瑶海区", "庐阳区", "蜀山区", "包河区", "经开区", "高新区", "新站区", "肥东县", "肥西县", "长丰县", "庐江县", "巢湖市");
    private static final List<String> PLACE_INTENT_WORDS = List.of(
            "附近", "周边", "哪里", "哪家", "店", "餐馆", "饭店", "餐厅", "好吃", "美食", "吃饭", "路线", "地址", "怎么去", "景点", "商场", "酒店");

    private final RestClient restClient = RestClient.builder().build();

    @Value("${app.amap.api-key:}")
    private String apiKey;

    @Value("${app.amap.default-city:合肥}")
    private String defaultCity;

    public boolean isAvailable() {
        return StringUtils.hasText(apiKey);
    }

    public boolean shouldSearch(String message) {
        if (!isAvailable() || message == null || message.isBlank()) {
            return false;
        }
        return PLACE_INTENT_WORDS.stream().anyMatch(message::contains);
    }

    public String buildContext(String message, int limit) {
        if (!shouldSearch(message)) {
            return "";
        }

        AmapQuery query = buildQuery(message);
        List<AmapPoi> pois = search(query, limit);
        if (pois.isEmpty()) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        builder.append("External AMap POI results. Use these as live place candidates; do not invent ratings, prices, reviews, opening hours, or crowd levels.\n");
        builder.append("Search query: ").append(query.keywords()).append(" / city: ").append(query.city()).append("\n");
        for (int i = 0; i < pois.size(); i++) {
            AmapPoi poi = pois.get(i);
            builder.append(i + 1).append(". ")
                    .append(poi.name())
                    .append(" | area: ").append(poi.area())
                    .append(" | address: ").append(poi.address());
            if (StringUtils.hasText(poi.type())) {
                builder.append(" | type: ").append(poi.type());
            }
            if (StringUtils.hasText(poi.tel())) {
                builder.append(" | tel: ").append(poi.tel());
            }
            if (StringUtils.hasText(poi.tags())) {
                builder.append(" | tags: ").append(poi.tags());
            }
            builder.append("\n");
        }
        return builder.toString();
    }

    public List<AmapPoi> searchText(String message, int limit) {
        return search(buildQuery(message), limit);
    }

    private List<AmapPoi> search(AmapQuery query, int limit) {
        if (!isAvailable()) {
            return List.of();
        }

        int safeLimit = Math.max(1, Math.min(limit, 10));
        try {
            JsonNode response = restClient.get()
                    .uri(uriBuilder -> uriBuilder
                            .scheme("https")
                            .host("restapi.amap.com")
                            .path("/v3/place/text")
                            .queryParam("key", apiKey)
                            .queryParam("keywords", query.keywords())
                            .queryParam("city", query.city())
                            .queryParam("citylimit", true)
                            .queryParam("offset", Math.max(safeLimit * 2, safeLimit))
                            .queryParam("page", 1)
                            .queryParam("extensions", "base")
                            .build())
                    .retrieve()
                    .body(JsonNode.class);

            if (response == null || !"1".equals(text(response, "status"))) {
                log.warn("AMap place search failed, info={}, infocode={}",
                        response == null ? "" : text(response, "info"),
                        response == null ? "" : text(response, "infocode"));
                return List.of();
            }

            List<AmapPoi> all = new ArrayList<>();
            JsonNode pois = response.path("pois");
            if (pois.isArray()) {
                for (JsonNode poi : pois) {
                    all.add(toPoi(poi));
                }
            }
            return filter(query, all).stream().limit(safeLimit).toList();
        } catch (Exception e) {
            log.warn("AMap place search failed, query={}", query.keywords(), e);
            return List.of();
        }
    }

    private List<AmapPoi> filter(AmapQuery query, List<AmapPoi> pois) {
        if (pois.isEmpty()) {
            return pois;
        }

        List<AmapPoi> filtered = pois.stream()
                .filter(poi -> !poi.name().contains("餐饮管理"))
                .filter(poi -> !query.foodRelated() || poi.type().contains("餐饮服务"))
                .toList();
        if (!filtered.isEmpty()) {
            pois = filtered;
        }

        if (StringUtils.hasText(query.area())) {
            List<AmapPoi> sameArea = pois.stream()
                    .filter(poi -> query.area().equals(poi.area()))
                    .toList();
            if (!sameArea.isEmpty()) {
                return sameArea;
            }
        }
        return pois;
    }

    private AmapQuery buildQuery(String message) {
        String area = HEFEI_AREAS.stream()
                .filter(message::contains)
                .findFirst()
                .orElse("");
        String city = message.contains("合肥") || StringUtils.hasText(area) ? "合肥" : defaultCity;
        String keyword = detectKeyword(message);
        String keywords = StringUtils.hasText(area) ? area + " " + keyword : keyword;
        return new AmapQuery(keywords, city, area, isFoodRelated(keyword));
    }

    private String detectKeyword(String message) {
        String lower = message.toLowerCase(Locale.ROOT);
        if (message.contains("徽菜") || message.contains("安徽菜")) {
            return "徽菜";
        }
        if (message.contains("火锅")) {
            return "火锅";
        }
        if (message.contains("烧烤")) {
            return "烧烤";
        }
        if (message.contains("小吃") || message.contains("快餐")) {
            return "小吃";
        }
        if (message.contains("咖啡") || lower.contains("coffee")) {
            return "咖啡";
        }
        if (message.contains("酒店") || message.contains("住宿")) {
            return "酒店";
        }
        if (message.contains("景点") || message.contains("游玩")) {
            return "景点";
        }
        if (message.contains("商场") || message.contains("购物")) {
            return "商场";
        }
        return isFoodRelated(message) ? "餐饮" : message.strip();
    }

    private boolean isFoodRelated(String text) {
        return List.of("吃", "餐", "饭", "美食", "好吃", "店家", "徽菜", "小吃", "火锅", "烧烤", "咖啡")
                .stream()
                .anyMatch(text::contains);
    }

    private AmapPoi toPoi(JsonNode node) {
        return new AmapPoi(
                text(node, "name"),
                text(node, "adname"),
                text(node, "address"),
                text(node, "type"),
                text(node, "tel"),
                text(node, "atag"),
                text(node, "location")
        );
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (value.isMissingNode() || value.isNull()) {
            return "";
        }
        if (value.isArray()) {
            List<String> values = new ArrayList<>();
            for (JsonNode item : value) {
                String text = item.asText("");
                if (StringUtils.hasText(text)) {
                    values.add(text);
                }
            }
            return String.join(", ", values);
        }
        return Objects.toString(value.asText(""), "").trim();
    }

    private record AmapQuery(String keywords, String city, String area, boolean foodRelated) {
    }

    public record AmapPoi(String name, String area, String address, String type, String tel, String tags, String location) {
    }
}
