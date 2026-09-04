package com.moyuyu.yuaiagentpro.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.util.MimeType;
import org.springframework.util.MimeTypeUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/vision")
public class VisionTestController {

    private static final Duration VISION_TIMEOUT = Duration.ofSeconds(90);

    private final ChatClient chatClient;

    public VisionTestController(OpenAiChatModel openAiChatModel) {
        this.chatClient = ChatClient.builder(openAiChatModel)
                .defaultSystem("""
                        You are a vision capability diagnostic assistant.
                        Answer in Chinese.
                        Describe only what is visible in the image.
                        If you cannot inspect the image, say so directly.
                        """)
                .build();
    }

    @PostMapping(value = "/test", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> testVision(
            @RequestParam("image") MultipartFile image,
            @RequestParam(value = "prompt", required = false) String prompt) throws IOException {
        if (image == null || image.isEmpty()) {
            throw new IllegalArgumentException("image 不能为空");
        }

        String contentType = StringUtils.hasText(image.getContentType())
                ? image.getContentType()
                : MediaType.APPLICATION_OCTET_STREAM_VALUE;
        if (!contentType.startsWith("image/")) {
            throw new IllegalArgumentException("image 必须是图片文件，当前 contentType=" + contentType);
        }

        String finalPrompt = StringUtils.hasText(prompt)
                ? prompt
                : "请用一句话说明这张图片里最主要的内容，并判断你是否真的看到了图片。";
        ByteArrayResource imageResource = new NamedByteArrayResource(image.getBytes(), image.getOriginalFilename());
        MimeType mimeType = MimeTypeUtils.parseMimeType(contentType);

        String answer = chatClient
                .prompt()
                .user(user -> user
                        .text(finalPrompt)
                        .media(mimeType, imageResource))
                // Use stream because the current relay rejects non-stream chat completions.
                .stream()
                .content()
                .collectList()
                .map(parts -> String.join("", parts))
                .block(VISION_TIMEOUT);

        log.info("Vision test completed, fileName={}, contentType={}, size={}",
                image.getOriginalFilename(), contentType, image.getSize());
        return Map.of(
                "success", true,
                "fileName", image.getOriginalFilename() == null ? "" : image.getOriginalFilename(),
                "contentType", contentType,
                "size", image.getSize(),
                "answer", answer == null ? "" : answer
        );
    }

    private static class NamedByteArrayResource extends ByteArrayResource {

        private final String filename;

        NamedByteArrayResource(byte[] byteArray, String filename) {
            super(byteArray);
            this.filename = StringUtils.hasText(filename) ? filename : "upload-image";
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }
}
