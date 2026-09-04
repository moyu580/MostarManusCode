package com.moyuyu.yuaiagentpro.palace;

import java.util.Collection;
import java.util.List;

public interface PalaceStore {

    boolean saveTurn(PalaceTurnDrawer drawer, PalaceIndexRecord index);

    List<PalaceIndexRecord> loadIndices(String chatId);

    List<PalaceTurnDrawer> loadDrawers(String chatId, Collection<String> drawerIds);
}
