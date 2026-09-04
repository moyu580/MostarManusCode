package com.moyuyu.yuaiagentpro.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiSecurityConfigTest {

    @Test
    void shouldRequireAdminTokenForManagementEndpoint() throws Exception {
        ApiSecurityProperties properties = new ApiSecurityProperties();
        properties.setAdminToken("secret-token");
        properties.setAdminTokenRequired(true);
        ApiSecurityConfig.ApiAccessInterceptor interceptor = interceptor(properties);

        MockHttpServletResponse missing = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request("/api/knowledge/reindex"), missing, new Object()));
        assertEquals(401, missing.getStatus());

        MockHttpServletRequest validRequest = request("/api/knowledge/reindex");
        validRequest.addHeader("X-Mostar-Access-Token", "secret-token");
        assertTrue(interceptor.preHandle(validRequest, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void shouldRateLimitChatByClientAddress() throws Exception {
        ApiSecurityProperties properties = new ApiSecurityProperties();
        properties.setChatRequestsPerMinute(2);
        ApiSecurityConfig.ApiAccessInterceptor interceptor = interceptor(properties);

        for (int i = 0; i < 2; i++) {
            assertTrue(interceptor.preHandle(request("/api/chat"), new MockHttpServletResponse(), new Object()));
        }
        MockHttpServletResponse limited = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request("/api/chat"), limited, new Object()));
        assertEquals(429, limited.getStatus());
    }

    private ApiSecurityConfig.ApiAccessInterceptor interceptor(ApiSecurityProperties properties) {
        return new ApiSecurityConfig.ApiAccessInterceptor(
                properties,
                Clock.fixed(Instant.parse("2026-09-03T11:00:00Z"), ZoneOffset.UTC));
    }

    private MockHttpServletRequest request(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        request.setRemoteAddr("203.0.113.10");
        return request;
    }
}
