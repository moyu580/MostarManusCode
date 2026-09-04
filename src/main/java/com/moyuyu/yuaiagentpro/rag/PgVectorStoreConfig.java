package com.moyuyu.yuaiagentpro.rag;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.ai.document.MetadataMode;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiEmbeddingModel;
import org.springframework.ai.openai.OpenAiEmbeddingOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.ai.vectorstore.pgvector.PgVectorStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

import javax.sql.DataSource;

@Configuration
@Profile({"local", "prod"})
@ConditionalOnProperty(prefix = "app.pgvector", name = "enabled", havingValue = "true")
public class PgVectorStoreConfig {

    @Bean
    public DataSource pgVectorDataSource(
            @Value("${spring.datasource.url}") String url,
            @Value("${spring.datasource.username}") String username,
            @Value("${spring.datasource.password}") String password,
            @Value("${spring.datasource.driver-class-name:org.postgresql.Driver}") String driverClassName) {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(url);
        dataSource.setUsername(username);
        dataSource.setPassword(password);
        dataSource.setDriverClassName(driverClassName);
        return dataSource;
    }

    @Bean
    public JdbcTemplate pgVectorJdbcTemplate(DataSource pgVectorDataSource) {
        return new JdbcTemplate(pgVectorDataSource);
    }

    @Bean
    public EmbeddingModel pgVectorEmbeddingModel(
            @Value("${app.embedding.openai.base-url:${spring.ai.openai.base-url}}") String openAiBaseUrl,
            @Value("${app.embedding.openai.api-key:${spring.ai.openai.api-key}}") String openAiApiKey,
            @Value("${app.embedding.openai.model:text-embedding-3-small}") String embeddingModel,
            @Value("${app.embedding.openai.dimensions:}") String embeddingDimensions,
            ObjectProvider<RestClient.Builder> restClientBuilderProvider) {
        OpenAiApi.Builder apiBuilder = OpenAiApi.builder()
                .baseUrl(openAiBaseUrl)
                .apiKey(openAiApiKey);

        RestClient.Builder restClientBuilder = restClientBuilderProvider.getIfAvailable();
        if (restClientBuilder != null) {
            apiBuilder.restClientBuilder(restClientBuilder);
        }

        OpenAiEmbeddingOptions.Builder optionsBuilder = OpenAiEmbeddingOptions.builder()
                .model(embeddingModel);
        if (StringUtils.hasText(embeddingDimensions)) {
            optionsBuilder.dimensions(Integer.parseInt(embeddingDimensions.trim()));
        }

        return new OpenAiEmbeddingModel(apiBuilder.build(), MetadataMode.EMBED, optionsBuilder.build());
    }

    @Bean
    public VectorStore pgVectorStore(
            @Qualifier("pgVectorJdbcTemplate") JdbcTemplate pgVectorJdbcTemplate,
            @Qualifier("pgVectorEmbeddingModel") EmbeddingModel pgVectorEmbeddingModel,
            @Value("${app.pgvector.schema-name:public}") String schemaName,
            @Value("${app.pgvector.table-name:vector_store}") String tableName,
            @Value("${app.pgvector.dimensions:1536}") int dimensions,
            @Value("${app.pgvector.initialize-schema:true}") boolean initializeSchema) {
        return PgVectorStore.builder(pgVectorJdbcTemplate, pgVectorEmbeddingModel)
                .schemaName(schemaName)
                .vectorTableName(tableName)
                .dimensions(dimensions)
                .initializeSchema(initializeSchema)
                .build();
    }
}
