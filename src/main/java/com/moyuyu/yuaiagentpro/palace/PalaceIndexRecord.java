package com.moyuyu.yuaiagentpro.palace;

import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.time.Instant;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PalaceIndexRecord {
    private String drawerId;
    private String chatId;
    private String wingKey;
    private String roomKey;
    private String summary;
    private List<String> keywords;
    private List<String> anchors;
    private int importance;
    private String contentHash;
    private Instant occurredAt;
}
