package com.moyuyu.yuaiagentpro.controller;

import java.net.SocketTimeoutException;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeoutException;

public final class ErrorMessageResolver {

    private ErrorMessageResolver() {
    }

    public static String resolve(Throwable throwable) {
        Throwable root = rootCause(throwable);
        String message = root.getMessage() == null ? "" : root.getMessage();
        String lowerMessage = message.toLowerCase();

        if (message.contains("InvalidApiKey") || message.contains("401")) {
            return "模型服务认证失败，请检查 OpenAI API Key。";
        }
        if (message.contains("DocumentRetriever") || message.contains("RetrievalAugmentationAdvisor")) {
            return "知识库检索失败，请检查知识库配置。";
        }
        if (message.contains("Error while extracting response for type")) {
            return "模型服务响应解析失败，可能是中转接口返回了非标准响应或超时。";
        }
        if (lowerMessage.contains("stream must be set to true")) {
            return "模型服务要求使用流式调用，请重启后端并使用最新代码。";
        }
        if (root instanceof TimeoutException || root instanceof SocketTimeoutException
                || lowerMessage.contains("timed out") || lowerMessage.contains("timeout")) {
            return "模型服务响应超时，请稍后重试。";
        }
        if (message.contains("Connection refused") || message.contains("I/O error")) {
            return "模型服务网络连接失败，请检查网络或服务状态。";
        }

        return "服务内部错误，请查看后端日志。";
    }

    private static Throwable rootCause(Throwable throwable) {
        Throwable current = throwable;
        while (current instanceof CompletionException && current.getCause() != null) {
            current = current.getCause();
        }
        while (current != null && current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current == null ? throwable : current;
    }
}
