package com.moyuyu.yuaiagentpro.app;

import cn.hutool.core.lang.UUID;
import jakarta.annotation.Resource;
import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@EnabledIfEnvironmentVariable(named = "RUN_AI_INTEGRATION_TESTS", matches = "true")
@SpringBootTest
class MostarManusTest {

    @Resource
    private MostarManus mostarManus;

    @Test
    void testChat() {
        String chatId = UUID.randomUUID().toString();

        String message = "教会我如何判断公司前景";
        String answer = mostarManus.dochat(message, chatId);
        Assertions.assertNotNull(answer);
    }

}
