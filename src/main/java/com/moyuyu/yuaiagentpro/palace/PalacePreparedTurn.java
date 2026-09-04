package com.moyuyu.yuaiagentpro.palace;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class PalacePreparedTurn {
    private PalaceTurnDrawer drawer;
    private PalaceIndexRecord index;
}
