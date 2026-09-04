package com.moyuyu.yuaiagentpro.palace;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PalaceClassifierTest {

    private final PalaceClassifier classifier = new PalaceClassifier();

    @Test
    void shouldClassifyCareerTurnAndExtractAnchors() {
        PalacePreparedTurn preparedTurn = classifier.classify(
                "test-001",
                "我叫小明，我准备 Java 后端秋招，想去中大厂。",
                "可以优先补项目和八股。");

        assertEquals("career", preparedTurn.getDrawer().getWingKey());
        assertTrue(preparedTurn.getIndex().getRoomKey().startsWith("career-"));
        assertFalse(preparedTurn.getIndex().getAnchors().isEmpty());
        assertTrue(preparedTurn.getIndex().getImportance() >= 3);
    }
}
