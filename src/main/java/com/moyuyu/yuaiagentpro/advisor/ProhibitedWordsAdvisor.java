package com.moyuyu.yuaiagentpro.advisor;

import org.springframework.ai.chat.client.advisor.api.AdvisedRequest;
import org.springframework.ai.chat.client.advisor.api.AdvisedResponse;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisor;
import org.springframework.ai.chat.client.advisor.api.CallAroundAdvisorChain;
import org.springframework.ai.chat.client.advisor.api.StreamAroundAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAroundAdvisorChain;
import reactor.core.publisher.Flux;

import java.util.Locale;
import java.util.Set;

public class ProhibitedWordsAdvisor implements CallAroundAdvisor, StreamAroundAdvisor {

    private static final String FORCED_REPLY = "我们换个话题聊聊吧";
    private static final String FORCED_SYSTEM_PROMPT =
            "如果用户输入包含违禁词，你必须只输出固定短语：我们换个话题聊聊吧。"
                    + "不要输出任何其他文字、标点或解释。";

    private final Set<String> prohibitedWords;

    public ProhibitedWordsAdvisor() {
        this(Set.of(
                "赌博",
                "色情",
                "嫖娼",
                "卖淫",
                "毒品",
                "枪支",
                "弹药",
                "爆炸",
                "剧毒",
                "农药",
                "洗钱",
                "诈骗",
                "伪造",
                "假币",
                "身份证",
                "护照",
                "签证"
        ));
    }

    public ProhibitedWordsAdvisor(Set<String> prohibitedWords) {
        this.prohibitedWords = prohibitedWords == null ? Set.of() : prohibitedWords;
    }

    @Override
    public String getName() {
        return this.getClass().getSimpleName();
    }

    @Override
    public int getOrder() {
        return -100;
    }

    public String getForcedReply() {
        return FORCED_REPLY;
    }

    public boolean containsProhibitedWord(String userText) {
        if (userText == null || userText.isBlank()) {
            return false;
        }

        for (String word : prohibitedWords) {
            if (word == null || word.isBlank()) {
                continue;
            }
            String w = word;
            String t = userText;
            boolean isLikelyEnglish = word.chars().allMatch(ch -> ch < 128);
            if (isLikelyEnglish) {
                w = word.toLowerCase(Locale.ROOT);
                t = userText.toLowerCase(Locale.ROOT);
            }
            if (t.contains(w)) {
                return true;
            }
        }
        return false;
    }

    private AdvisedRequest before(AdvisedRequest request) {
        if (!containsProhibitedWord(request.userText())) {
            return request;
        }

        var builder = AdvisedRequest.from(request).userText(FORCED_REPLY);
        try {
            var m = builder.getClass().getMethod("systemText", String.class);
            m.invoke(builder, FORCED_SYSTEM_PROMPT);
        } catch (ReflectiveOperationException ignored) {
            // Older Spring AI builders may not expose systemText.
        }
        return builder.build();
    }

    @Override
    public AdvisedResponse aroundCall(AdvisedRequest advisedRequest, CallAroundAdvisorChain chain) {
        return chain.nextAroundCall(before(advisedRequest));
    }

    @Override
    public Flux<AdvisedResponse> aroundStream(AdvisedRequest advisedRequest, StreamAroundAdvisorChain chain) {
        return chain.nextAroundStream(before(advisedRequest));
    }
}
