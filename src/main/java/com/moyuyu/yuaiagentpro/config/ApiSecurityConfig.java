package com.moyuyu.yuaiagentpro.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Configuration
@RequiredArgsConstructor
public class ApiSecurityConfig implements WebMvcConfigurer {

    private final ApiSecurityProperties properties;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new ApiAccessInterceptor(properties)).addPathPatterns("/**");
    }

    static final class ApiAccessInterceptor implements HandlerInterceptor {

        private static final String TOKEN_HEADER = "X-Mostar-Access-Token";
        private static final String AUTHORIZATION_PREFIX = "Bearer ";
        private static final long WINDOW_SECONDS = 60;

        private final ApiSecurityProperties properties;
        private final Clock clock;
        private final Map<String, RateWindow> windows = new ConcurrentHashMap<>();

        ApiAccessInterceptor(ApiSecurityProperties properties) {
            this(properties, Clock.systemUTC());
        }

        ApiAccessInterceptor(ApiSecurityProperties properties, Clock clock) {
            this.properties = properties;
            this.clock = clock;
        }

        @Override
        public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
                throws IOException {
            if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
                return true;
            }

            String path = request.getRequestURI();
            String contextPath = request.getContextPath();
            if (StringUtils.hasText(contextPath) && path.startsWith(contextPath)) {
                path = path.substring(contextPath.length());
            } else if (StringUtils.hasText(path) && ("/api".equals(path) || path.startsWith("/api/"))) {
                path = path.substring("/api".length());
            }

            if (isAdminPath(path) && !hasValidAdminToken(request)) {
                writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "需要管理员访问令牌");
                return false;
            }

            if (isChatPath(path)) {
                if (properties.isChatTokenRequired() && !hasValidAdminToken(request)) {
                    writeError(response, HttpServletResponse.SC_UNAUTHORIZED, "需要访问令牌");
                    return false;
                }
                if (!allow(clientAddress(request))) {
                    response.setHeader("Retry-After", String.valueOf(WINDOW_SECONDS));
                    writeError(response, HttpStatus.TOO_MANY_REQUESTS.value(), "请求过于频繁，请稍后再试");
                    return false;
                }
            }
            return true;
        }

        private boolean isAdminPath(String path) {
            return "/knowledge/reindex".equals(path)
                    || "/knowledge/sync".equals(path)
                    || path.startsWith("/memory")
                    || "/vision/test".equals(path)
                    || "/health/mcp".equals(path)
                    || "/health/amap".equals(path)
                    || path.startsWith("/health/pgvector");
        }

        private boolean isChatPath(String path) {
            return "/chat".equals(path) || "/chat/text".equals(path) || "/chat/stream".equals(path);
        }

        private boolean hasValidAdminToken(HttpServletRequest request) {
            if (!StringUtils.hasText(properties.getAdminToken())) {
                return !properties.isAdminTokenRequired();
            }
            String supplied = request.getHeader(TOKEN_HEADER);
            if (!StringUtils.hasText(supplied)) {
                String authorization = request.getHeader("Authorization");
                if (authorization != null && authorization.startsWith(AUTHORIZATION_PREFIX)) {
                    supplied = authorization.substring(AUTHORIZATION_PREFIX.length());
                }
            }
            if (!StringUtils.hasText(supplied)) {
                return false;
            }
            return MessageDigest.isEqual(
                    properties.getAdminToken().getBytes(StandardCharsets.UTF_8),
                    supplied.trim().getBytes(StandardCharsets.UTF_8));
        }

        private boolean allow(String key) {
            int limit = Math.max(1, properties.getChatRequestsPerMinute());
            long now = Instant.now(clock).getEpochSecond();
            RateWindow window = windows.compute(key, (ignored, current) -> {
                if (current == null || now - current.startedAt >= WINDOW_SECONDS) {
                    return new RateWindow(now, 1);
                }
                return new RateWindow(current.startedAt, current.count + 1);
            });
            if (window.count <= limit) {
                return true;
            }
            if (now - window.startedAt >= WINDOW_SECONDS) {
                windows.remove(key, window);
            }
            return false;
        }

        private String clientAddress(HttpServletRequest request) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (StringUtils.hasText(forwarded)) {
                return forwarded.split(",", 2)[0].trim();
            }
            String realIp = request.getHeader("X-Real-IP");
            return StringUtils.hasText(realIp) ? realIp : request.getRemoteAddr();
        }

        private void writeError(HttpServletResponse response, int status, String message) throws IOException {
            response.setStatus(status);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"message\":\"" + message.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}");
        }

        private record RateWindow(long startedAt, int count) {
        }
    }
}
