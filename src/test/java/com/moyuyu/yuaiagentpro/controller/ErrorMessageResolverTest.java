package com.moyuyu.yuaiagentpro.controller;

import org.junit.jupiter.api.Test;

import java.net.SocketTimeoutException;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ErrorMessageResolverTest {

    @Test
    void shouldResolveInvalidApiKeyError() {
        String message = ErrorMessageResolver.resolve(new RuntimeException("401 - InvalidApiKey"));

        assertEquals("模型服务认证失败，请检查 OpenAI API Key。", message);
    }

    @Test
    void shouldResolveRagError() {
        String message = ErrorMessageResolver.resolve(new RuntimeException("DocumentRetriever failed"));

        assertEquals("知识库检索失败，请检查知识库配置。", message);
    }

    @Test
    void shouldResolveResponseExtractionError() {
        String message = ErrorMessageResolver.resolve(new RuntimeException("Error while extracting response for type"));

        assertEquals("模型服务响应解析失败，可能是中转接口返回了非标准响应或超时。", message);
    }

    @Test
    void shouldResolveStreamRequiredError() {
        String message = ErrorMessageResolver.resolve(new RuntimeException("400 - Stream must be set to true"));

        assertEquals("模型服务要求使用流式调用，请重启后端并使用最新代码。", message);
    }

    @Test
    void shouldResolveTimeoutError() {
        assertEquals("模型服务响应超时，请稍后重试。", ErrorMessageResolver.resolve(new TimeoutException()));
        assertEquals("模型服务响应超时，请稍后重试。", ErrorMessageResolver.resolve(new SocketTimeoutException()));
    }

    @Test
    void shouldUnwrapCompletionException() {
        String message = ErrorMessageResolver.resolve(new CompletionException(new RuntimeException("401 - InvalidApiKey")));

        assertEquals("模型服务认证失败，请检查 OpenAI API Key。", message);
    }
}
