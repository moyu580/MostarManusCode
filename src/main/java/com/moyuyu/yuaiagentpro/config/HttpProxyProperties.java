package com.moyuyu.yuaiagentpro.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Data
@Component
@ConfigurationProperties(prefix = "app.proxy")
public class HttpProxyProperties {

    private boolean enabled;

    private String host = "127.0.0.1";

    private int port = 7890;

    private int connectTimeoutSeconds = 30;

    private int readTimeoutSeconds = 120;
}
