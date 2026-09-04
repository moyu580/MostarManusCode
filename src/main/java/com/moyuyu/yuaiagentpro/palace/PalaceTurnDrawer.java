package com.moyuyu.yuaiagentpro.palace;

import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.time.Instant;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PalaceTurnDrawer {
    private String id;
    private String chatId;
    private String wingKey;
    private String roomKey;
    private String userText;
    private String assistantText;
    private String rawText;
    private String contentHash;
    private Instant occurredAt;
}
