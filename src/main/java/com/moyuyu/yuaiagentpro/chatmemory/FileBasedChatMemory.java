package com.moyuyu.yuaiagentpro.chatmemory;

import com.esotericsoftware.kryo.Kryo;
import com.esotericsoftware.kryo.io.Input;
import com.esotericsoftware.kryo.io.Output;
import lombok.extern.slf4j.Slf4j;
import org.objenesis.strategy.StdInstantiatorStrategy;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.UserMessage;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.regex.Pattern;

@Slf4j
public class FileBasedChatMemory implements ChatMemory {

    private static final int LOCK_STRIPE_COUNT = 64;
    private static final ThreadLocal<Kryo> KRYO = ThreadLocal.withInitial(FileBasedChatMemory::newKryo);
    private static final Pattern SAFE_CONVERSATION_ID = Pattern.compile("^[a-zA-Z0-9_-]+$");
    private static final int DEFAULT_CONTEXT_CHAR_LIMIT = 1200;

    private final String baseDir;
    private final Object[] conversationLocks = new Object[LOCK_STRIPE_COUNT];

    public FileBasedChatMemory(String dir) {
        this.baseDir = dir;
        File dirFile = new File(dir);
        if (!dirFile.exists() && !dirFile.mkdirs()) {
            log.error("Failed to create chat memory directory, dir={}", dir);
        }
        for (int i = 0; i < conversationLocks.length; i++) {
            conversationLocks[i] = new Object();
        }
    }

    @Override
    public void add(String conversationId, List<Message> messages) {
        Object lock = lockFor(conversationId);
        synchronized (lock) {
            List<Message> conversationMessages = readConversation(conversationId);
            conversationMessages.addAll(messages);
            saveConversation(conversationId, conversationMessages);
        }
    }

    @Override
    public List<Message> get(String conversationId, int lastN) {
        Object lock = lockFor(conversationId);
        synchronized (lock) {
            List<Message> allMessages = readConversation(conversationId);
            return allMessages.stream()
                    .skip(Math.max(0, allMessages.size() - lastN))
                    .toList();
        }
    }

    @Override
    public void clear(String conversationId) {
        Object lock = lockFor(conversationId);
        synchronized (lock) {
            File file = getConversationFile(conversationId);
            try {
                Files.deleteIfExists(file.toPath());
            } catch (IOException e) {
                log.error("Failed to delete chat memory file, conversationId={}, file={}", conversationId, file.getAbsolutePath(), e);
            }
        }
    }

    public void appendUserMessage(String conversationId, String text) {
        append(conversationId, new UserMessage(text));
    }

    public void appendAssistantMessage(String conversationId, String text) {
        append(conversationId, new AssistantMessage(text));
    }

    public String buildRecentConversationContext(String conversationId, int lastN) {
        return buildRecentConversationContext(conversationId, lastN, DEFAULT_CONTEXT_CHAR_LIMIT);
    }

    public String buildRecentConversationContext(String conversationId, int lastN, int maxChars) {
        List<Message> messages = get(conversationId, lastN);
        if (messages.isEmpty()) {
            return "";
        }

        StringBuilder context = new StringBuilder();
        for (Message message : messages) {
            String text = message.getText();
            if (text == null || text.isBlank()) {
                continue;
            }

            String role = toRoleLabel(message.getMessageType());
            if (role == null) {
                continue;
            }

            if (!context.isEmpty()) {
                context.append("\n");
            }
            context.append(role).append(": ").append(text.trim());
        }
        return trimToLimit(context.toString(), maxChars);
    }

    public String buildUserProfileContext(String conversationId, int maxChars) {
        List<Message> messages = getAll(conversationId);
        if (messages.isEmpty()) {
            return "";
        }

        StringBuilder profile = new StringBuilder();
        for (Message message : messages) {
            if (message.getMessageType() != MessageType.USER) {
                continue;
            }

            String text = message.getText();
            if (text == null || text.isBlank()) {
                continue;
            }

            if (!profile.isEmpty()) {
                profile.append("\n");
            }
            profile.append("- ").append(text.trim());
        }
        return trimToLimit(profile.toString(), maxChars);
    }

    private void append(String conversationId, Message message) {
        Object lock = lockFor(conversationId);
        synchronized (lock) {
            List<Message> messages = readConversation(conversationId);
            messages.add(message);
            saveConversation(conversationId, messages);
        }
    }

    private List<Message> getAll(String conversationId) {
        Object lock = lockFor(conversationId);
        synchronized (lock) {
            return readConversation(conversationId);
        }
    }

    private List<Message> readConversation(String conversationId) {
        File file = getConversationFile(conversationId);
        List<Message> messages = new ArrayList<>();
        if (!file.exists()) {
            return messages;
        }

        try (Input input = new Input(new FileInputStream(file))) {
            return KRYO.get().readObject(input, ArrayList.class);
        } catch (IOException | RuntimeException e) {
            log.error("Failed to read chat memory, conversationId={}, file={}", conversationId, file.getAbsolutePath(), e);
            return messages;
        }
    }

    private void saveConversation(String conversationId, List<Message> messages) {
        File file = getConversationFile(conversationId);
        Path target = file.toPath();
        Path temp = target.resolveSibling(target.getFileName() + ".tmp-" + ThreadLocalRandom.current().nextInt());
        try (Output output = new Output(new FileOutputStream(temp.toFile()))) {
            KRYO.get().writeObject(output, messages);
        } catch (IOException | RuntimeException e) {
            log.error("Failed to save chat memory, conversationId={}, file={}", conversationId, file.getAbsolutePath(), e);
            deleteTempFile(temp);
            return;
        }

        try {
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.error("Failed to replace chat memory file, conversationId={}, file={}", conversationId, file.getAbsolutePath(), e);
            deleteTempFile(temp);
        }
    }

    private Object lockFor(String conversationId) {
        validateConversationId(conversationId);
        return conversationLocks[Math.floorMod(conversationId.hashCode(), conversationLocks.length)];
    }

    private static Kryo newKryo() {
        Kryo kryo = new Kryo();
        kryo.setRegistrationRequired(false);
        kryo.setInstantiatorStrategy(new StdInstantiatorStrategy());
        return kryo;
    }

    private void deleteTempFile(Path temp) {
        try {
            Files.deleteIfExists(temp);
        } catch (IOException cleanupException) {
            log.warn("Failed to clean temporary chat memory file, file={}", temp, cleanupException);
        }
    }

    private File getConversationFile(String conversationId) {
        validateConversationId(conversationId);
        return new File(baseDir, conversationId + ".kryo");
    }

    private void validateConversationId(String conversationId) {
        if (conversationId == null || conversationId.isBlank()) {
            throw new IllegalArgumentException("conversationId must not be blank");
        }
        if (!SAFE_CONVERSATION_ID.matcher(conversationId).matches()) {
            throw new IllegalArgumentException("conversationId may only contain letters, digits, underscore, and hyphen");
        }
    }

    private String toRoleLabel(MessageType messageType) {
        if (messageType == MessageType.USER) {
            return "User";
        }
        if (messageType == MessageType.ASSISTANT) {
            return "Assistant";
        }
        return null;
    }

    private String trimToLimit(String text, int maxChars) {
        if (text == null || text.length() <= maxChars || maxChars <= 0) {
            return text;
        }

        int start = text.length() - maxChars;
        int newline = text.indexOf('\n', start);
        if (newline >= 0 && newline + 1 < text.length()) {
            return text.substring(newline + 1);
        }
        return text.substring(start);
    }
}
