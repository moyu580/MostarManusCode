package com.moyuyu.yuaiagentpro.knowledge;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
public class LocalMarkdownKnowledgeSource implements KnowledgeSource {

    private final MarkdownKnowledgeReader reader;

    @Override
    public List<KnowledgeDocument> loadDocuments() {
        return reader.readAll();
    }
}
