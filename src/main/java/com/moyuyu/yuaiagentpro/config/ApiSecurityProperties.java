package com.moyuyu.yuaiagentpro.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "app.security")
public class ApiSecurityProperties {

    private String adminToken = "";
    private boolean adminTokenRequired = false;
    private boolean chatTokenRequired = false;
    private int chatRequestsPerMinute = 20;
    private int maxChatMessageChars = 12_000;
    private int maxChatImageBytes = 4 * 1024 * 1024;
}
