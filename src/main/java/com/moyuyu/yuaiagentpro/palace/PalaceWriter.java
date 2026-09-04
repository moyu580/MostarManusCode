package com.moyuyu.yuaiagentpro.palace;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.util.concurrent.Executor;

@Slf4j
@Component
public class PalaceWriter {

    private final PalaceClassifier palaceClassifier;
    private final FilePalaceStore filePalaceStore;
    private final JdbcPalaceStore jdbcPalaceStore;
    private final Executor memoryTaskExecutor;
    private final PalaceProperties palaceProperties;

    public PalaceWriter(PalaceClassifier palaceClassifier,
                        FilePalaceStore filePalaceStore,
                        JdbcPalaceStore jdbcPalaceStore,
                        @Qualifier("memoryTaskExecutor") Executor memoryTaskExecutor,
                        PalaceProperties palaceProperties) {
        this.palaceClassifier = palaceClassifier;
        this.filePalaceStore = filePalaceStore;
        this.jdbcPalaceStore = jdbcPalaceStore;
        this.memoryTaskExecutor = memoryTaskExecutor;
        this.palaceProperties = palaceProperties;
    }

    public void writeTurn(String chatId, String userText, String assistantText) {
        if (!palaceProperties.getPalace().isEnabled()) {
            return;
        }
        PalacePreparedTurn preparedTurn = palaceClassifier.classify(chatId, userText, assistantText);

        boolean databaseSaved = false;
        if (jdbcPalaceStore.isAvailable()) {
            try {
                jdbcPalaceStore.saveTurn(preparedTurn.getDrawer(), preparedTurn.getIndex());
                databaseSaved = true;
            } catch (Exception e) {
                log.warn("Palace database write skipped, chatId={}", chatId, e);
            }
        }

        if (databaseSaved && palaceProperties.getPalace().isWriteAsync()) {
            try {
                memoryTaskExecutor.execute(() -> persistSecondaryData(preparedTurn));
            } catch (Exception e) {
                log.warn("Palace file backup task rejected, chatId={}", chatId, e);
            }
            return;
        }

        if (databaseSaved) {
            persistSecondaryData(preparedTurn);
        } else {
            persistFileBackup(preparedTurn);
        }
    }

    private void persistSecondaryData(PalacePreparedTurn preparedTurn) {
        if (palaceProperties.getPalace().isVectorEnabled()) {
            jdbcPalaceStore.saveVectorDocument(preparedTurn.getDrawer(), preparedTurn.getIndex());
        }
        persistFileBackup(preparedTurn);
    }

    private void persistFileBackup(PalacePreparedTurn preparedTurn) {
        try {
            filePalaceStore.saveTurn(preparedTurn.getDrawer(), preparedTurn.getIndex());
        } catch (Exception e) {
            log.warn("Palace file backup skipped, chatId={}", preparedTurn.getDrawer().getChatId(), e);
        }
    }
}
