package com.moyuyu.yuaiagentpro.palace;

import lombok.Builder;
import lombok.Data;

import java.util.List;

@Data
@Builder
public class PalaceRecallResult {
    private List<String> anchors;
    private List<PalaceTurnDrawer> drawers;
}
