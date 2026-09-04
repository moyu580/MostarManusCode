package com.moyuyu.yuaiagentpro.controller;

import com.moyuyu.yuaiagentpro.app.ChatImageInput;
import com.moyuyu.yuaiagentpro.app.MostarManus;
import com.moyuyu.yuaiagentpro.config.ApiSecurityProperties;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/chat")
public class ChatController {

    @Resource
    private MostarManus mostarManus;

    @Resource
    private ApiSecurityProperties securityProperties;

    @PostMapping
    public ChatResponse chat(@RequestBody ChatRequest request) {
        validateRequest(request);
        String chatId = resolveChatId(request);
        String answer = mostarManus.dochat(
                request.message(),
                chatId,
                request.memoryMode(),
                request.responseStyle(),
                request.images());
        return new ChatResponse(chatId, answer);
    }

    @PostMapping(value = "/text", produces = MediaType.TEXT_PLAIN_VALUE)
    public String chatText(@RequestBody ChatRequest request) {
        validateRequest(request);
        String chatId = resolveChatId(request);
        return mostarManus.dochat(
                request.message(),
                chatId,
                request.memoryMode(),
                request.responseStyle(),
                request.images());
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chatStream(@RequestBody ChatRequest request) {
        validateRequest(request);
        String chatId = resolveChatId(request);

        Flux<ServerSentEvent<String>> chatIdEvent = Flux.just(ServerSentEvent.<String>builder()
                .event("chatId")
                .data(chatId)
                .build());

        Flux<ServerSentEvent<String>> messageEvents = mostarManus.doChatStream(
                        request.message(),
                        chatId,
                        request.memoryMode(),
                        request.responseStyle(),
                        request.images())
                .map(content -> ServerSentEvent.<String>builder()
                        .event("message")
                        .data(content)
                        .build())
                .concatWith(Flux.just(ServerSentEvent.<String>builder()
                        .event("done")
                        .data("[DONE]")
                        .build()))
                .onErrorResume(e -> {
                    log.error("Chat stream failed, chatId={}", chatId, e);
                    return Flux.just(ServerSentEvent.<String>builder()
                            .event("error")
                            .data(ErrorMessageResolver.resolve(e))
                            .build());
                });

        return chatIdEvent.concatWith(messageEvents);
    }

    private String resolveChatId(ChatRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("请求体不能为空");
        }
        boolean hasMessage = StringUtils.hasText(request.message());
        boolean hasImages = request.images() != null && !request.images().isEmpty();
        if (!hasMessage && !hasImages) {
            throw new IllegalArgumentException("message 或 images 不能为空");
        }
        return StringUtils.hasText(request.chatId())
                ? request.chatId()
                : UUID.randomUUID().toString();
    }

    private void validateRequest(ChatRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("请求体不能为空");
        }
        String message = request.message();
        if (message != null && message.length() > securityProperties.getMaxChatMessageChars()) {
            throw new IllegalArgumentException("message 不能超过 " + securityProperties.getMaxChatMessageChars() + " 个字符");
        }
        List<ChatImageInput> images = request.images();
        if (images == null || images.isEmpty()) {
            return;
        }
        long encodedBytes = 0;
        for (ChatImageInput image : images) {
            if (image == null) {
                throw new IllegalArgumentException("images 不能包含空项");
            }
            if (image.size() != null && image.size() > securityProperties.getMaxChatImageBytes()) {
                throw new IllegalArgumentException("单张图片不能超过 "
                        + securityProperties.getMaxChatImageBytes() / (1024 * 1024) + "MB");
            }
            if (image.dataUrl() != null) {
                encodedBytes += image.dataUrl().length();
            }
            if (image.base64() != null) {
                encodedBytes += image.base64().length();
            }
        }
        long maxEncodedBytes = (long) securityProperties.getMaxChatImageBytes() * 4;
        if (encodedBytes > maxEncodedBytes) {
            throw new IllegalArgumentException("图片请求体过大，请减少图片数量或尺寸");
        }
    }

    public record ChatRequest(
            String message,
            String chatId,
            String memoryMode,
            String responseStyle,
            List<ChatImageInput> images) {
    }

    public record ChatResponse(String chatId, String answer) {
    }
}
