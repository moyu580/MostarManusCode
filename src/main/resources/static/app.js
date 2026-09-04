const state = {
  chatId: localStorage.getItem("mostar.chatId") || crypto.randomUUID(),
  busy: false,
};

const els = {
  healthStatus: document.querySelector("#healthStatus"),
  pulse: document.querySelector(".pulse"),
  chatIdInput: document.querySelector("#chatIdInput"),
  memoryModeSelect: document.querySelector("#memoryModeSelect"),
  newChatBtn: document.querySelector("#newChatBtn"),
  refreshStatsBtn: document.querySelector("#refreshStatsBtn"),
  reindexBtn: document.querySelector("#reindexBtn"),
  indexedFiles: document.querySelector("#indexedFiles"),
  indexedChunks: document.querySelector("#indexedChunks"),
  topK: document.querySelector("#topK"),
  threshold: document.querySelector("#threshold"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  messageInput: document.querySelector("#messageInput"),
  streamToggle: document.querySelector("#streamToggle"),
  sendBtn: document.querySelector("#sendBtn"),
  searchInput: document.querySelector("#searchInput"),
  searchBtn: document.querySelector("#searchBtn"),
  searchResults: document.querySelector("#searchResults"),
  messageTemplate: document.querySelector("#messageTemplate"),
};

function setChatId(chatId) {
  state.chatId = chatId;
  els.chatIdInput.value = chatId;
  localStorage.setItem("mostar.chatId", chatId);
}

function setBusy(value) {
  state.busy = value;
  els.sendBtn.disabled = value;
  els.messageInput.disabled = value;
}

function appendMessage(role, text) {
  const node = els.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector("header").textContent = role === "user" ? "你" : "MostarManus";
  node.querySelector("p").textContent = text;
  els.messages.appendChild(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node.querySelector("p");
}

async function apiJson(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function checkHealth() {
  try {
    const text = await fetch("/api/health").then((res) => res.text());
    els.healthStatus.textContent = text === "ok" ? "在线" : text;
    els.pulse.className = "pulse ok";
  } catch {
    els.healthStatus.textContent = "离线";
    els.pulse.className = "pulse bad";
  }
}

async function refreshStats() {
  els.refreshStatsBtn.disabled = true;
  try {
    const stats = await apiJson("/api/knowledge/stats");
    els.indexedFiles.textContent = stats.indexedFiles ?? "-";
    els.indexedChunks.textContent = stats.indexedChunks ?? "-";
    els.topK.textContent = stats.topK ?? "-";
    els.threshold.textContent = stats.similarityThreshold ?? "-";
  } catch (err) {
    appendMessage("assistant", `知识库状态读取失败：${err.message}`);
  } finally {
    els.refreshStatsBtn.disabled = false;
  }
}

async function reindexKnowledge() {
  if (!confirm("确认要重建知识库索引吗？这会重新调用 embedding，可能需要几分钟。")) {
    return;
  }
  els.reindexBtn.disabled = true;
  appendMessage("assistant", "开始重建知识库索引，稍等一下。");
  try {
    const result = await apiJson("/api/knowledge/reindex", { method: "POST" });
    appendMessage("assistant", `索引完成：扫描 ${result.scannedFiles} 个文件，写入 ${result.indexedChunks} 个分片。`);
    await refreshStats();
  } catch (err) {
    appendMessage("assistant", `索引失败：${err.message}`);
  } finally {
    els.reindexBtn.disabled = false;
  }
}

async function searchKnowledge() {
  const query = els.searchInput.value.trim();
  if (!query) return;
  els.searchBtn.disabled = true;
  els.searchResults.innerHTML = "<p class=\"hint\">检索中...</p>";
  try {
    const data = await apiJson(`/api/knowledge/search?query=${encodeURIComponent(query)}&limit=3`);
    els.searchResults.innerHTML = "";
    if (!data.results?.length) {
      els.searchResults.innerHTML = "<p class=\"hint\">没有命中结果。</p>";
      return;
    }
    for (const item of data.results) {
      const card = document.createElement("article");
      card.className = "result-card";
      card.innerHTML = `
        <strong>${escapeHtml(item.label || `知识片段 ${item.rank || ""}`)}</strong>
        <small>已命中，但内容和来源路径不在前端返回。</small>
        <p>检索结果仅用于确认 RAG 命中，不展示知识库明文。</p>
      `;
      els.searchResults.appendChild(card);
    }
  } catch (err) {
    els.searchResults.innerHTML = `<p class="hint">检索失败：${escapeHtml(err.message)}</p>`;
  } finally {
    els.searchBtn.disabled = false;
  }
}

async function sendNormal(message) {
  const data = await apiJson("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      chatId: state.chatId,
      memoryMode: els.memoryModeSelect.value || null,
    }),
  });
  setChatId(data.chatId);
  appendMessage("assistant", data.answer || "(empty)");
}

async function sendStream(message) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message,
      chatId: state.chatId,
      memoryMode: els.memoryModeSelect.value || null,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(await res.text());
  }

  const output = appendMessage("assistant", "");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) {
      const event = parseSse(raw);
      if (event.event === "chatId" && event.data) {
        setChatId(event.data);
      } else if (event.event === "message") {
        output.textContent += event.data || "";
      } else if (event.event === "error") {
        output.textContent += `\n[error] ${event.data || "请求失败"}`;
      }
      els.messages.scrollTop = els.messages.scrollHeight;
    }
  }
}

function parseSse(raw) {
  const event = { event: "message", data: "" };
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event.event = line.slice(6).trim();
    if (line.startsWith("data:")) event.data += line.slice(5).trimStart();
  }
  return event;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = els.messageInput.value.trim();
  if (!message || state.busy) return;
  els.messageInput.value = "";
  appendMessage("user", message);
  setBusy(true);
  try {
    if (els.streamToggle.checked) {
      await sendStream(message);
    } else {
      await sendNormal(message);
    }
  } catch (err) {
    appendMessage("assistant", `请求失败：${err.message}`);
  } finally {
    setBusy(false);
  }
});

els.newChatBtn.addEventListener("click", () => {
  setChatId(crypto.randomUUID());
  els.messages.innerHTML = "";
  appendMessage("assistant", "新会话已创建。");
});

els.chatIdInput.addEventListener("change", () => {
  const value = els.chatIdInput.value.trim();
  if (value) setChatId(value);
});

els.refreshStatsBtn.addEventListener("click", refreshStats);
els.reindexBtn.addEventListener("click", reindexKnowledge);
els.searchBtn.addEventListener("click", searchKnowledge);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchKnowledge();
});

setChatId(state.chatId);
appendMessage("assistant", "控制台已就绪。你可以直接发起聊天，或先在右侧检索知识库。");
checkHealth();
refreshStats();
searchKnowledge();
