package com.moyuyu.yuaiagentpro.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.client.reactive.JdkClientHttpConnector;
import org.springframework.web.client.RestClient;
import org.springframework.web.reactive.function.client.WebClient;

import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ProxySelector;
import java.net.http.HttpClient;
import java.time.Duration;

@Slf4j
@Configuration
@RequiredArgsConstructor
@ConditionalOnProperty(prefix = "app.proxy", name = "enabled", havingValue = "true")
public class OpenAiHttpClientConfig {

    private final HttpProxyProperties proxyProperties;

    @Bean
    @Primary
    public RestClient.Builder proxiedRestClientBuilder() {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setProxy(new Proxy(
                Proxy.Type.HTTP,
                new InetSocketAddress(proxyProperties.getHost(), proxyProperties.getPort())));
        requestFactory.setConnectTimeout(Duration.ofSeconds(proxyProperties.getConnectTimeoutSeconds()));
        requestFactory.setReadTimeout(Duration.ofSeconds(proxyProperties.getReadTimeoutSeconds()));

        log.info("OpenAI HTTP client proxy enabled: {}:{}", proxyProperties.getHost(), proxyProperties.getPort());
        return RestClient.builder().requestFactory(requestFactory);
    }

    @Bean
    @Primary
    public WebClient.Builder proxiedWebClientBuilder() {
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(proxyProperties.getConnectTimeoutSeconds()))
                .proxy(ProxySelector.of(new InetSocketAddress(proxyProperties.getHost(), proxyProperties.getPort())))
                .build();

        log.info("OpenAI WebClient proxy enabled: {}:{}", proxyProperties.getHost(), proxyProperties.getPort());
        return WebClient.builder().clientConnector(new JdkClientHttpConnector(httpClient));
    }
}
