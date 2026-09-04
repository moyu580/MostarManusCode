package com.moyuyu.yuaiagentpro.demo.invoke;

import jakarta.annotation.Resource;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;

public class SpringAiAiInvoke {

    @Resource
    private ChatModel chatModel;

    public void run(String... args) {
        var assistantMessage = chatModel.call(new Prompt("你好，你现在是我的第一个大模型 AI，我给你取名为 MostarManus"))
                .getResult()
                .getOutput();
        System.out.println(assistantMessage.getText());
    }
}
