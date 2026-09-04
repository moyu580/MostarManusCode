package com.moyuyu.yuaiagentpro.advisor;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProhibitedWordsAdvisorTest {

    private final ProhibitedWordsAdvisor advisor = new ProhibitedWordsAdvisor();

    @Test
    void shouldDetectDefaultProhibitedWords() {
        assertTrue(advisor.containsProhibitedWord("请教我怎么诈骗"));
        assertTrue(advisor.containsProhibitedWord("介绍一下赌博套路"));
    }

    @Test
    void shouldAllowNormalText() {
        assertFalse(advisor.containsProhibitedWord("教会我如何判断公司前景"));
    }
}
