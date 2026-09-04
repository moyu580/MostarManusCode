import {
  Activity,
  BookOpenText,
  BrainCircuit,
  DatabaseZap,
  ImagePlus,
  Layers3,
  Loader2,
  MessageSquarePlus,
  Orbit,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  TerminalSquare,
  X
} from "lucide-react";
import katex from "katex";
import { ChangeEvent, FormEvent, Fragment, ReactNode, useEffect, useRef, useState } from "react";
import {
  chat,
  ChatImagePayload,
  getHealth,
  getKnowledgeStats,
  KnowledgeStats,
  MemoryMode,
  ResponseStyle,
  reindexKnowledge,
  streamChat
} from "./api";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta?: string;
  images?: ChatImagePayload[];
};

type Thread = {
  id: string;
  title: string;
  time: string;
  tone: string;
};

const starterThreads: Thread[] = [
  { id: "kb-debug", title: "知识库调用链排查", time: "刚刚", tone: "RAG" },
  { id: "frontend-plan", title: "DeerFlow 风格前端", time: "今天", tone: "UI" },
  { id: "agent-core", title: "MostarManus Agent 能力", time: "本周", tone: "Agent" }
];

const workflowSteps = [
  { label: "Plan", value: "拆解目标与上下文", status: "ready" },
  { label: "Retrieve", value: "记忆 + 知识库", status: "live" },
  { label: "Act", value: "工具 / 后端执行", status: "ready" },
  { label: "Deliver", value: "流式生成回复", status: "idle" }
];

const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function createId() {
  return crypto.randomUUID();
}

function createChatId() {
  return localStorage.getItem("mostar.frontend.chatId") || createId();
}

export default function App() {
  const [chatId, setChatIdState] = useState(createChatId);
  const [memoryMode, setMemoryMode] = useState<MemoryMode>("DEFAULT");
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>("BALANCED");
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [reindexBusy, setReindexBusy] = useState(false);
  const [selectedImages, setSelectedImages] = useState<ChatImagePayload[]>([]);
  const [threads, setThreads] = useState<Thread[]>(starterThreads);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: createId(),
      role: "assistant",
      content: "MostarManus Workspace 已就绪。你可以直接发起对话，也可以查看右侧知识库状态。",
      meta: "Agent Console"
    }
  ]);

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    localStorage.setItem("mostar.frontend.chatId", chatId);
  }, [chatId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    checkHealth();
    refreshStats();
  }, []);

  function setChatId(next: string) {
    setChatIdState(next);
    localStorage.setItem("mostar.frontend.chatId", next);
  }

  async function checkHealth() {
    setHealth("checking");
    try {
      const result = await getHealth();
      setHealth(result === "ok" ? "online" : "offline");
    } catch {
      setHealth("offline");
    }
  }

  async function refreshStats() {
    setStatsBusy(true);
    try {
      setStats(await getKnowledgeStats());
    } catch (error) {
      pushSystem(`知识库状态读取失败：${errorMessage(error)}`);
    } finally {
      setStatsBusy(false);
    }
  }

  async function runReindex() {
    const confirmed = window.confirm(
      "确认重建知识库索引吗？这会重新调用 embedding 服务，可能需要几分钟。"
    );
    if (!confirmed) return;

    setReindexBusy(true);
    pushSystem("开始重建知识库索引。完成后我会刷新右侧统计数据。");
    try {
      const result = await reindexKnowledge();
      pushSystem(
        `索引完成：扫描 ${result.scannedFiles ?? "-"} 个文件，写入 ${
          result.indexedChunks ?? "-"
        } 个分片。`
      );
      await refreshStats();
    } catch (error) {
      pushSystem(`索引失败：${errorMessage(error)}`);
    } finally {
      setReindexBusy(false);
    }
  }

  async function submitMessage(event?: FormEvent) {
    event?.preventDefault();
    const typedMessage = input.trim();
    const outgoingImages = selectedImages;
    if ((!typedMessage && outgoingImages.length === 0) || busy) return;
    const message = typedMessage || "请分析这张图片。";

    setInput("");
    setSelectedImages([]);
    setBusy(true);
    appendMessage({
      role: "user",
      content: message,
      meta: outgoingImages.length ? `You · ${outgoingImages.length} image` : "You",
      images: outgoingImages
    });

    const assistantId = createId();
    if (streamEnabled) {
      appendMessage({ id: assistantId, role: "assistant", content: "", meta: "Streaming" });
    }

    try {
      if (streamEnabled) {
        await streamChat(message, chatId, memoryMode, responseStyle, outgoingImages, (event) => {
          if (event.event === "chatId" && event.data) {
            setChatId(event.data);
            return;
          }

          if (event.event === "message") {
            patchMessage(assistantId, (old) => ({
              ...old,
              content: `${old.content}${event.data}`
            }));
            return;
          }

          if (event.event === "error") {
            patchMessage(assistantId, (old) => ({
              ...old,
              content: `${old.content}\n[error] ${event.data || "请求失败"}`,
              meta: "Error"
            }));
          }
        });
      } else {
        const data = await chat(message, chatId, memoryMode, responseStyle, outgoingImages);
        setChatId(data.chatId);
        appendMessage({ role: "assistant", content: data.answer || "(empty)", meta: "MostarManus" });
      }

      setThreads((current) => [
        {
          id: chatId,
          title: message.slice(0, 18) || "新会话",
          time: "刚刚",
          tone: memoryMode || "DEFAULT"
        },
        ...current.filter((thread) => thread.id !== chatId)
      ]);
    } catch (error) {
      if (streamEnabled) {
        patchMessage(assistantId, (old) => ({
          ...old,
          content: old.content || `请求失败：${errorMessage(error)}`,
          meta: "Error"
        }));
      } else {
        appendMessage({ role: "system", content: `请求失败：${errorMessage(error)}`, meta: "Network" });
      }
    } finally {
      setBusy(false);
    }
  }

  function appendMessage(message: Omit<Message, "id"> & { id?: string }) {
    setMessages((current) => [
      ...current,
      {
        id: message.id ?? createId(),
        role: message.role,
        content: message.content,
        meta: message.meta,
        images: message.images
      }
    ]);
  }

  function patchMessage(id: string, updater: (message: Message) => Message) {
    setMessages((current) => current.map((message) => (message.id === id ? updater(message) : message)));
  }

  function pushSystem(content: string) {
    appendMessage({ role: "system", content, meta: "System" });
  }

  function newThread() {
    const nextId = createId();
    setChatId(nextId);
    setMessages([
      {
        id: createId(),
        role: "assistant",
        content: "新会话已创建。记忆模式和知识库面板会继续跟随当前工作台。",
        meta: "Agent Console"
      }
    ]);
  }

  async function handleImageSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const remainingSlots = MAX_IMAGE_COUNT - selectedImages.length;
    if (remainingSlots <= 0) {
      pushSystem(`每轮最多上传 ${MAX_IMAGE_COUNT} 张图片。`);
      return;
    }

    const nextImages: ChatImagePayload[] = [];
    for (const file of files.slice(0, remainingSlots)) {
      if (!file.type.startsWith("image/")) {
        pushSystem(`${file.name} 不是图片文件，已跳过。`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        pushSystem(`${file.name} 超过 4MB，已跳过。`);
        continue;
      }
      nextImages.push({
        name: file.name,
        contentType: file.type || "image/png",
        dataUrl: await readFileAsDataUrl(file),
        size: file.size
      });
    }

    if (files.length > remainingSlots) {
      pushSystem(`已达到图片上限，本轮只添加前 ${remainingSlots} 张。`);
    }

    if (nextImages.length) {
      setSelectedImages((current) => [...current, ...nextImages]);
    }
  }

  function removeSelectedImage(index: number) {
    setSelectedImages((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <main className="workspace-shell">
      <aside className="left-rail glass-panel">
        <div className="brand-card">
          <div className="brand-mark">
            <Orbit size={22} />
          </div>
          <div>
            <p className="eyebrow">MOSTAR MANUS</p>
            <h1>Agent OS</h1>
            <small>Plan · Retrieve · Act</small>
          </div>
        </div>

        <button className="primary-action" onClick={newThread}>
          <MessageSquarePlus size={18} />
          新建任务
        </button>

        <div className="control-surface">
          <label className="control-pill" htmlFor="memoryMode">
            <span>Memory</span>
            <select
              id="memoryMode"
              value={memoryMode}
              onChange={(event) => setMemoryMode(event.target.value as MemoryMode)}
            >
              <option value="DEFAULT">默认</option>
              <option value="PALACE">宫殿</option>
              <option value="STRUCTURED">结构化</option>
            </select>
          </label>

          <label className="control-pill" htmlFor="responseStyle">
            <span>Depth</span>
            <select
              id="responseStyle"
              value={responseStyle}
              onChange={(event) => setResponseStyle(event.target.value as ResponseStyle)}
            >
              <option value="BRIEF">短答</option>
              <option value="BALANCED">均衡</option>
              <option value="DEEP">深度</option>
            </select>
          </label>
        </div>

        <div className="thread-stack">
          <div className="section-title">
            <span>Threads</span>
            <span>{threads.length}</span>
          </div>
          {threads.map((thread) => (
            <button
              className={"thread-card " + (thread.id === chatId ? "active" : "")}
              key={thread.id}
              onClick={() => setChatId(thread.id)}
            >
              <span className="thread-tone">{thread.tone}</span>
              <strong>{thread.title}</strong>
              <small>{thread.time}</small>
            </button>
          ))}
        </div>

        <div className="status-card">
          <span className={"status-dot " + health} />
          <div>
            <strong>{health === "online" ? "后端在线" : health === "checking" ? "检测中" : "后端离线"}</strong>
            <small>localhost:8123 /api</small>
          </div>
          <button aria-label="刷新健康状态" onClick={checkHealth}>
            <RefreshCw size={15} />
          </button>
        </div>
      </aside>

      <section className="center-stage">
        <header className="workspace-hero glass-panel">
          <div>
            <p className="eyebrow">DEERFLOW 2.0 INSPIRED</p>
            <h2>从一句问题到一条清晰执行流</h2>
            <p>页面收敛为对话主线、运行轨迹、知识状态三层；不再把调试细节堆成卡片墙。</p>
          </div>
          <div className="hero-actions">
            <label className="switch">
              <input
                type="checkbox"
                checked={streamEnabled}
                onChange={(event) => setStreamEnabled(event.target.checked)}
              />
              <span>实时回复</span>
            </label>
            <span className={"backend-pill " + health}>
              <Activity size={15} />
              {health === "online" ? "API Ready" : health === "checking" ? "Checking" : "Offline"}
            </span>
          </div>
        </header>

        <div className="workbench-grid">
          <section className="chat-panel glass-panel">
            <div className="chat-toolbar">
              <div>
                <p className="eyebrow">Conversation</p>
                <strong>{shortId(chatId)}</strong>
              </div>
              <span className="chat-mode">{memoryMode || "DEFAULT"} · {responseStyle}</span>
            </div>

            <div className="message-list">
              {messages.map((message) => (
                <article className={"message " + message.role} key={message.id}>
                  <div className="message-avatar">
                    {message.role === "user" ? "你" : message.role === "system" ? "SYS" : "AI"}
                  </div>
                  <div className="message-body">
                    <header>
                      <span>{message.role === "user" ? "You" : message.role === "system" ? "System" : "MostarManus"}</span>
                      <small>{message.meta}</small>
                    </header>
                    {message.images?.length ? <ImagePreviewGrid images={message.images} /> : null}
                    <ReadableMessage
                      content={message.content || (busy && message.role === "assistant" ? "思考中..." : "")}
                      role={message.role}
                    />
                  </div>
                </article>
              ))}
              <div ref={messageEndRef} />
            </div>

            <form className="composer" onSubmit={submitMessage}>
              <div className="composer-stack">
                {selectedImages.length ? (
                  <div className="composer-images">
                    {selectedImages.map((image, index) => (
                      <div className="composer-image" key={image.name + "-" + index}>
                        <img alt={image.name} src={image.dataUrl} />
                        <button type="button" onClick={() => removeSelectedImage(index)} aria-label={"移除 " + image.name}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <textarea
                  value={input}
                  placeholder="交给 MostarManus：提问、规划、分析截图或联调问题..."
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitMessage();
                    }
                  }}
                />
                <div className="composer-tools">
                  <button
                    className="attachment-button"
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={busy || selectedImages.length >= MAX_IMAGE_COUNT}
                  >
                    <ImagePlus size={16} />
                    图片
                  </button>
                  <span>最多 {MAX_IMAGE_COUNT} 张，单张 4MB</span>
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  onChange={handleImageSelect}
                />
              </div>
              <button disabled={busy || (!input.trim() && selectedImages.length === 0)} type="submit">
                {busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
                发送
              </button>
            </form>
          </section>

          <aside className="right-panel glass-panel">
            <section className="panel-section flow-panel">
              <div className="section-title">
                <span>Run Flow</span>
                <Sparkles size={16} />
              </div>
              <div className="flow-strip">
                {workflowSteps.map((step, index) => (
                  <article className={"flow-node " + step.status} key={step.label}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <small>{step.value}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel-section">
              <div className="section-title">
                <span>Knowledge</span>
                <button onClick={refreshStats} disabled={statsBusy}>
                  {statsBusy ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                </button>
              </div>
              <div className="metric-grid">
                <Metric icon={<BookOpenText />} label="Files" value={stats?.indexedFiles ?? "-"} />
                <Metric icon={<Layers3 />} label="Chunks" value={stats?.indexedChunks ?? "-"} />
                <Metric icon={<DatabaseZap />} label="Top K" value={stats?.topK ?? "-"} />
                <Metric icon={<BrainCircuit />} label="Threshold" value={stats?.similarityThreshold ?? "-"} />
              </div>
            </section>

            <section className="panel-section ops-card">
              <div>
                <TerminalSquare size={17} />
                <span>Operations</span>
              </div>
              <button onClick={runReindex} disabled={reindexBusy}>
                {reindexBusy ? <Loader2 className="spin" size={16} /> : <DatabaseZap size={16} />}
                重建知识库索引
              </button>
              <p>调试入口降级到运行面板，只保留必要状态与动作，避免暴露知识库明文和重复卡片。</p>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function ImagePreviewGrid({ images }: { images: ChatImagePayload[] }) {
  return (
    <div className="message-images">
      {images.map((image, index) => (
        <figure key={`${image.name}-${index}`}>
          <img alt={image.name} src={image.dataUrl} />
          <figcaption>{image.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <article className="metric-card">
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ReadableMessage({ content, role }: { content: string; role: Message["role"] }) {
  const text = role === "assistant" ? normalizeAssistantText(content) : content;
  const blocks = toReadableBlocks(text);
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = role === "assistant" && text.length > 1500;
  const visibleBlocks = shouldCollapse && !expanded ? blocks.slice(0, Math.min(5, blocks.length)) : blocks;

  return (
    <div className={`rich-message ${role}`}>
      {visibleBlocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <h3 className={`rich-heading level-${block.level}`} key={`${block.type}-${index}`}>
              {renderInline(block.text)}
            </h3>
          );
        }

        if (block.type === "code") {
          return (
            <div className="code-block" key={`${block.type}-${index}`}>
              <div className="code-block-header">
                <span>{block.language || "code"}</span>
              </div>
              <pre>
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }

        if (block.type === "math") {
          return <MathBlock expression={block.expression} key={`${block.type}-${index}`} />;
        }

        if (block.type === "ul") {
          return (
            <ul key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol key={`${block.type}-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }

        return <p key={`${block.type}-${index}`}>{renderInline(block.text)}</p>;
      })}
      {shouldCollapse ? (
        <button className="read-more-button" type="button" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "收起长回答" : `展开完整回答 · 约 ${Math.ceil(text.length / 500)} 屏`}
        </button>
      ) : null}
    </div>
  );
}

type ReadableBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "math"; expression: string }
  | { type: "paragraph"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function normalizeAssistantText(value: string) {
  let text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  text = text.replace(/([^\n])\s*(#{1,4})(?=\s*\S)/g, "$1\n\n$2");
  text = text.replace(/(#{1,4}\s*[^\n#]+?)(?=#{1,4}\s*\d)/g, "$1\n\n");
  text = text.replace(/(#{1,4}\s*\d+[.．]\s*[^\n#]+?)(?=#{1,4}\s*\d)/g, "$1\n\n");
  text = text.replace(/(#{1,4}\s*[^\n#]{2,36}?)(?=#{1,4}\s*[一二三四五六七八九十]+[、.．])/g, "$1\n\n");
  text = text.replace(/(#{1,4})\s*(?=\S)/g, "$1 ");
  text = text.replace(
    /(#{1,4}\s*[一二三四五六七八九十]+[、.．][^\n#]{2,24}?)(?=(我|这|短期|中期|长期|当前|建议|目标|优势|不足|机会|挑战|核心|如果|可以|需要|进入|保持|明确|完成|提升|为))/g,
    "$1\n\n$2"
  );
  text = text.replace(/(#{2,4}\s*\d+[.．]\s*[^-\n]{1,28})[-－]\s*/g, "$1\n\n- ");
  text = text.replace(/([^\n\d\s])[-－]\s*(?=[\u4e00-\u9fffA-Za-z])/g, "$1\n- ");
  text = text.replace(/([。；;！？!?])\s*(\d+[.．]\s+)/g, "$1\n$2");
  text = text.replace(/([^\n\d])(\d+[.．]\s+)/g, "$1\n$2");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text;
}

function toReadableBlocks(value: string): ReadableBlock[] {
  const blocks: ReadableBlock[] = [];
  const paragraphLines: string[] = [];
  let activeList: Extract<ReadableBlock, { type: "ul" | "ol" }> | null = null;
  let activeCode: { language: string; lines: string[] } | null = null;
  let activeMath: string[] | null = null;

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
    paragraphLines.length = 0;
  }

  function flushList() {
    if (!activeList) return;
    blocks.push(activeList);
    activeList = null;
  }

  for (const rawLine of value.split("\n")) {
    const line = rawLine.trim();

    if (activeMath) {
      if (line === "$$" || line === "\\]") {
        blocks.push({ type: "math", expression: activeMath.join("\n").trim() });
        activeMath = null;
      } else {
        activeMath.push(rawLine);
      }
      continue;
    }

    if (activeCode) {
      if (line.startsWith("```")) {
        const code = activeCode.lines.join("\n").trimEnd();
        blocks.push(isMathFence(activeCode.language, code)
          ? { type: "math", expression: code }
          : { type: "code", language: activeCode.language, code });
        activeCode = null;
      } else {
        activeCode.lines.push(rawLine);
      }
      continue;
    }

    const singleLineFence = line.match(/^```([a-zA-Z0-9_-]+)?\s+(.+?)\s*```$/);
    if (singleLineFence) {
      flushParagraph();
      flushList();
      const language = singleLineFence[1] || "";
      const code = singleLineFence[2].trim();
      blocks.push(isMathFence(language, code)
        ? { type: "math", expression: code }
        : { type: "code", language, code });
      continue;
    }

    const fenceStart = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fenceStart) {
      flushParagraph();
      flushList();
      activeCode = { language: fenceStart[1] || "", lines: [] };
      continue;
    }

    const singleLineBlockMath = line.match(/^\$\$(.+)\$\$$/);
    if (singleLineBlockMath) {
      flushParagraph();
      flushList();
      blocks.push({ type: "math", expression: singleLineBlockMath[1].trim() });
      continue;
    }

    if (line === "$$" || line === "\\[") {
      flushParagraph();
      flushList();
      activeMath = [];
      continue;
    }

    if (line.startsWith("\\[") && line.endsWith("\\]")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "math", expression: line.slice(2, -2).trim() });
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!activeList || activeList.type !== "ul") {
        flushList();
        activeList = { type: "ul", items: [] };
      }
      activeList.items.push(unordered[1].trim());
      continue;
    }

    const ordered = line.match(/^\d+[.．]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!activeList || activeList.type !== "ol") {
        flushList();
        activeList = { type: "ol", items: [] };
      }
      activeList.items.push(ordered[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  if (activeCode) {
    const code = activeCode.lines.join("\n").trimEnd();
    blocks.push(isMathFence(activeCode.language, code)
      ? { type: "math", expression: code }
      : { type: "code", language: activeCode.language, code });
  }
  if (activeMath) {
    blocks.push({ type: "math", expression: activeMath.join("\n").trim() });
  }

  return blocks.length ? blocks : [{ type: "paragraph", text: value }];
}

function renderInline(value: string) {
  return value.split(/(\*\*[^*]+?\*\*|`[^`]+?`|\\\(.+?\\\)|\$[^$\n]+?\$)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return <InlineMath expression={part.slice(2, -2)} key={index} />;
    }

    if (part.startsWith("$") && part.endsWith("$")) {
      return <InlineMath expression={part.slice(1, -1)} key={index} />;
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code className="inline-code" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
}

function MathBlock({ expression }: { expression: string }) {
  const html = renderKatex(expression, true);
  if (!html) {
    return <pre className="math-fallback">{expression}</pre>;
  }
  return <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

function InlineMath({ expression }: { expression: string }) {
  const html = renderKatex(expression, false);
  if (!html) {
    return <code className="inline-code">{expression}</code>;
  }
  return <span className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderKatex(expression: string, displayMode: boolean) {
  try {
    return katex.renderToString(normalizeMathExpression(expression), {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false
    });
  } catch {
    return "";
  }
}

function normalizeMathExpression(expression: string) {
  return expression
    .trim()
    .replace(/^text\s*/i, "")
    .replace(/^latex\s*/i, "")
    .replace(/^math\s*/i, "")
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .replace(/^\$\$/, "")
    .replace(/\$\$$/, "")
    .replace(/\blambda\b/g, "\\lambda")
    .replace(/λ/g, "\\lambda")
    .replace(/=>/g, "\\Rightarrow ")
    .replace(/->/g, "\\to ")
    .replace(/\*/g, "\\cdot ")
    .replace(/Poisson\(([^)]+)\)/gi, "\\operatorname{Poisson}($1)")
    .replace(/\s+/g, " ")
    .replace(/e\^\s*-\s*\\lambda\s*\\cdot\s*\\lambda/g, "e^{-\\lambda}\\lambda")
    .replace(/e\^\s*-\s*\\lambda/g, "e^{-\\lambda}");
}

function isMathFence(language: string, code: string) {
  const lang = language.toLowerCase();
  if (["math", "latex", "tex"].includes(lang)) {
    return true;
  }
  if (!["", "text", "txt"].includes(lang)) {
    return false;
  }
  return /\\lambda|lambda|Poisson|P\s*\(|=>|\\frac|\^|=\s*P\s*\(/i.test(code);
}

function shortId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("图片读取失败")));
    reader.readAsDataURL(file);
  });
}
