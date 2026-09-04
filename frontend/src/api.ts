export type MemoryMode = "DEFAULT" | "PALACE" | "STRUCTURED" | "";
export type ResponseStyle = "BRIEF" | "BALANCED" | "DEEP";

export type ChatImagePayload = {
  name: string;
  contentType: string;
  dataUrl: string;
  size: number;
};

export type ChatResponse = {
  chatId: string;
  answer: string;
};

export type KnowledgeStats = {
  indexedFiles?: number;
  indexedChunks?: number;
  topK?: number;
  similarityThreshold?: number;
  [key: string]: unknown;
};

export type KnowledgeSearchResult = {
  rank?: number;
  matched?: boolean;
  label?: string;
};

export type KnowledgeSearchResponse = {
  success: boolean;
  query: string;
  count: number;
  redacted?: boolean;
  message?: string;
  results: KnowledgeSearchResult[];
};

export type ReindexResponse = {
  scannedFiles?: number;
  indexedChunks?: number;
  skippedFiles?: number;
  [key: string]: unknown;
};

type JsonOptions = RequestInit & {
  body?: BodyInit | null;
};

function apiHeaders(headers?: HeadersInit) {
  const token = import.meta.env.VITE_MOSTAR_API_TOKEN || localStorage.getItem("mostar.apiToken") || "";
  return {
    ...(token ? { "X-Mostar-Access-Token": token } : {}),
    ...(headers ?? {})
  };
}

export async function apiJson<T>(path: string, options: JsonOptions = {}): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...apiHeaders(options.headers)
    },
    ...options
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function getHealth(): Promise<string> {
  const response = await fetch("/api/health");
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function chat(
  message: string,
  chatId: string,
  memoryMode: MemoryMode,
  responseStyle: ResponseStyle,
  images: ChatImagePayload[] = []
) {
  return apiJson<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      chatId,
      memoryMode: memoryMode || null,
      responseStyle,
      images
    })
  });
}

export function getKnowledgeStats() {
  return apiJson<KnowledgeStats>("/api/knowledge/stats");
}

export function searchKnowledge(query: string, limit = 3) {
  return apiJson<KnowledgeSearchResponse>(
    `/api/knowledge/search?query=${encodeURIComponent(query)}&limit=${limit}`
  );
}

export function reindexKnowledge() {
  return apiJson<ReindexResponse>("/api/knowledge/reindex", {
    method: "POST"
  });
}

export type StreamEvent =
  | { event: "chatId"; data: string }
  | { event: "message"; data: string }
  | { event: "done"; data: string }
  | { event: "error"; data: string };

export async function streamChat(
  message: string,
  chatId: string,
  memoryMode: MemoryMode,
  responseStyle: ResponseStyle,
  images: ChatImagePayload[],
  onEvent: (event: StreamEvent) => void
) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...apiHeaders()
    },
    body: JSON.stringify({
      message,
      chatId,
      memoryMode: memoryMode || null,
      responseStyle,
      images
    })
  });

  if (!response.ok || !response.body) {
    throw new Error(await response.text());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      const parsed = parseSse(raw);
      onEvent(parsed);
    }
  }

  if (buffer.trim()) {
    onEvent(parseSse(buffer));
  }
}

function parseSse(raw: string): StreamEvent {
  const parsed = { event: "message", data: "" };
  const dataLines: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      parsed.event = line.slice(6).trim();
    }

    if (line.startsWith("data:")) {
      const data = line.slice(5);
      dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
    }
  }

  parsed.data = dataLines.join("\n");

  if (parsed.event === "chatId" || parsed.event === "done" || parsed.event === "error") {
    return parsed as StreamEvent;
  }

  return { event: "message", data: parsed.data };
}
