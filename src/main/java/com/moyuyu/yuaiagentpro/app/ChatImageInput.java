package com.moyuyu.yuaiagentpro.app;

import org.springframework.ai.model.Media;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.util.MimeType;
import org.springframework.util.MimeTypeUtils;
import org.springframework.util.StringUtils;

import java.util.Base64;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public record ChatImageInput(
        String name,
        String contentType,
        String dataUrl,
        String base64,
        Long size) {

    private static final int MAX_IMAGES = 3;
    private static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    private static final Pattern DATA_URL_PATTERN = Pattern.compile("^data:([^;]+);base64,(.+)$", Pattern.DOTALL);

    public static List<Media> toMediaList(List<ChatImageInput> images) {
        if (images == null || images.isEmpty()) {
            return List.of();
        }
        if (images.size() > MAX_IMAGES) {
            throw new IllegalArgumentException("每轮最多上传 " + MAX_IMAGES + " 张图片");
        }
        return images.stream()
                .map(ChatImageInput::toMedia)
                .toList();
    }

    public static String summarize(List<ChatImageInput> images) {
        if (images == null || images.isEmpty()) {
            return "";
        }
        return "用户本轮上传了 " + images.size() + " 张图片："
                + String.join(", ", images.stream().map(ChatImageInput::safeName).toList());
    }

    private Media toMedia() {
        DecodedImage decoded = decode();
        return new Media(decoded.mimeType(), new NamedByteArrayResource(decoded.bytes(), safeName()));
    }

    private DecodedImage decode() {
        String finalContentType = contentType;
        String rawBase64 = base64;

        if (StringUtils.hasText(dataUrl)) {
            Matcher matcher = DATA_URL_PATTERN.matcher(dataUrl.trim());
            if (!matcher.matches()) {
                throw new IllegalArgumentException("图片 dataUrl 格式不正确");
            }
            finalContentType = matcher.group(1);
            rawBase64 = matcher.group(2);
        }

        if (!StringUtils.hasText(finalContentType) || !finalContentType.startsWith("image/")) {
            throw new IllegalArgumentException("图片 contentType 必须以 image/ 开头");
        }
        if (!StringUtils.hasText(rawBase64)) {
            throw new IllegalArgumentException("图片 base64 不能为空");
        }

        byte[] bytes = Base64.getDecoder().decode(rawBase64.replaceAll("\\s+", ""));
        if (bytes.length > MAX_IMAGE_BYTES) {
            throw new IllegalArgumentException("单张图片不能超过 4MB");
        }
        MimeType mimeType = MimeTypeUtils.parseMimeType(finalContentType);
        return new DecodedImage(mimeType, bytes);
    }

    private String safeName() {
        return StringUtils.hasText(name) ? name : "uploaded-image";
    }

    private record DecodedImage(MimeType mimeType, byte[] bytes) {
    }

    private static class NamedByteArrayResource extends ByteArrayResource {

        private final String filename;

        NamedByteArrayResource(byte[] byteArray, String filename) {
            super(byteArray);
            this.filename = filename;
        }

        @Override
        public String getFilename() {
            return filename;
        }
    }
}
