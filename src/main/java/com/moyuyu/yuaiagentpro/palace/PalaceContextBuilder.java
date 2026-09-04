package com.moyuyu.yuaiagentpro.palace;

import org.springframework.stereotype.Component;

@Component
public class PalaceContextBuilder {

    private final PalaceRetriever palaceRetriever;
    private final PalaceProperties palaceProperties;

    public PalaceContextBuilder(PalaceRetriever palaceRetriever, PalaceProperties palaceProperties) {
        this.palaceRetriever = palaceRetriever;
        this.palaceProperties = palaceProperties;
    }

    public PalaceRecallResult build(String chatId, String message) {
        return palaceRetriever.retrieve(
                chatId,
                message,
                palaceProperties.getPalace().getAnchorLimit(),
                palaceProperties.getPalace().getDrawerLimit());
    }

    public String renderAnchors(PalaceRecallResult result) {
        if (result == null || result.getAnchors() == null || result.getAnchors().isEmpty()) {
            return "(none)";
        }
        return String.join("\n", result.getAnchors().stream().map(anchor -> "- " + anchor).toList());
    }

    public String renderDrawers(PalaceRecallResult result, int maxChars) {
        if (result == null || result.getDrawers() == null || result.getDrawers().isEmpty()) {
            return "(none)";
        }
        String text = String.join("\n\n", result.getDrawers().stream()
                .map(drawer -> "[%s/%s]\n%s".formatted(drawer.getWingKey(), drawer.getRoomKey(), drawer.getRawText()))
                .toList());
        return PalaceTextSupport.limit(text, maxChars);
    }
}
