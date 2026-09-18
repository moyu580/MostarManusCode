/*!
 * MostarManus 悬浮助手 v6 — 博客嵌入式聊天组件(移动端优先)
 * 零依赖;对接 POST /api/chat/stream (SSE: chatId/message/done/error)
 * 配色取自站点 CSS 变量,自动适配明暗主题;≤640px 全屏对话页。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "mostar.frontend.chatId";
  var API_STREAM = "/api/chat/stream";
  var RESPONSE_STYLE = "BALANCED";
  var SUGGESTIONS = [
    "什么是力封闭?",
    "莫拉维克悖论讲的是什么?",
    "具身智能该怎么入门?",
    "SLAM 为什么在长走廊里翻车?"
  ];
  var AVATAR_URL = "/agent-avatar.png";
  var TYPING_HTML = '<span class="mmw-typing"><i></i><i></i><i></i></span>';

  function createId() {
    return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function getChatId() {
    try { return localStorage.getItem(STORAGE_KEY) || createId(); }
    catch (e) { return createId(); }
  }
  function saveChatId(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* ---------- 轻量 Markdown(先转义再替换,防注入) ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function renderInline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code class=\"mmw-code\">$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>");
  }
  function renderMarkdown(src) {
    var escaped = escapeHtml(src == null ? "" : String(src));
    var out = [];
    var inCode = false, codeBuf = [];
    var listBuf = null;

    function closeList() {
      if (listBuf) { out.push("</" + listBuf + ">"); listBuf = null; }
    }
    function listOpen(type, items) {
      if (listBuf !== type) { closeList(); listBuf = type; out.push("<" + type + ">"); }
      out.push("<li>" + renderInline(items) + "</li>");
    }

    var lines = escaped.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        if (inCode) {
          out.push("<pre class=\"mmw-pre\"><code>" + codeBuf.join("\n") + "</code></pre>");
          inCode = false; codeBuf = [];
        } else {
          closeList(); inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out.push("<div class=\"mmw-h\">" + renderInline(h[2]) + "</div>"); continue; }

      var ul = line.match(/^\s*[-*]\s+(.*)$/);
      if (ul) { listOpen("ul", ul[1]); continue; }
      var ol = line.match(/^\s*\d+[.、]\s+(.*)$/);
      if (ol) { listOpen("ol", ol[1]); continue; }

      if (/^\s*$/.test(line)) { closeList(); continue; }
      closeList();
      out.push("<p>" + renderInline(line) + "</p>");
    }
    if (inCode && codeBuf.length) {
      out.push("<pre class=\"mmw-pre\"><code>" + codeBuf.join("\n") + "</code></pre>");
    }
    closeList();
    return out.join("");
  }

  /* ---------- 样式(站点变量 + 回退;移动端全屏对话页) ---------- */
  var CSS = [
    "#mmw-root{position:fixed;right:18px;bottom:18px;z-index:9999;font-family:inherit}",
    ":where(#mmw-root,#mmw-root *){box-sizing:border-box;margin:0;padding:0}",
    "#mmw-root button{font-family:inherit}",

    /* 气泡按钮 */
    ".mmw-bubble{width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "background:linear-gradient(135deg,var(--accent,#b23a26),var(--accent-hover,#d14a2c));color:#fff;",
      "box-shadow:0 8px 26px var(--accent-glow,rgba(178,58,38,.4)),0 2px 6px rgba(0,0,0,.15);transition:transform .18s ease,box-shadow .18s ease}",
    ".mmw-bubble:active{transform:scale(.94)}",
    "@media (hover:hover){.mmw-bubble:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 10px 30px var(--accent-glow,rgba(178,58,38,.45))}}",
    ".mmw-bubble svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",
    ".mmw-bubble .mmw-close-ic{display:none}",
    "#mmw-root.open .mmw-bubble .mmw-chat-ic{display:none}",
    "#mmw-root.open .mmw-bubble .mmw-close-ic{display:block}",

    /* 面板(桌面:右下角卡片) */
    ".mmw-panel{position:absolute;right:0;bottom:76px;width:min(400px,calc(100vw - 32px));height:min(640px,calc(100dvh - 120px));",
      "display:flex;flex-direction:column;overflow:hidden;border-radius:20px;",
      "background:var(--bg-elev,#fff);color:var(--text,#2c2825);",
      "border:1px solid var(--border,rgba(0,0,0,.08));",
      "box-shadow:0 30px 70px rgba(0,0,0,.28),0 4px 16px rgba(0,0,0,.10);",
      "opacity:0;visibility:hidden;transform:translateY(12px) scale(.98);pointer-events:none;",
      "transition:opacity .2s ease,transform .2s ease,visibility .2s}",
    "#mmw-root.open .mmw-panel{opacity:1;visibility:visible;transform:none;pointer-events:auto}",

    /* 头部 */
    ".mmw-head{display:flex;align-items:center;gap:11px;padding:14px 16px;border-bottom:1px solid var(--border,rgba(0,0,0,.07));",
      "background:var(--bg-soft,#fff);flex:none}",
    ".mmw-head .mmw-avatar{width:36px;height:36px;border:1px solid var(--border,rgba(0,0,0,.08))}",
    ".mmw-head-title{font-size:15.5px;font-weight:650;flex:1;min-width:0;letter-spacing:.2px}",
    ".mmw-head-sub{display:block;font-size:11px;color:var(--text-mute,#7a7068);font-weight:400;margin-top:2px}",
    ".mmw-close{background:none;border:none;cursor:pointer;color:var(--text-mute,#7a7068);padding:7px;border-radius:10px;line-height:0;flex:none}",
    ".mmw-close:hover{color:var(--text,#2c2825);background:var(--bg-hover,#f5f2ed)}",

    /* 消息行:头像 + 气泡 */
    ".mmw-row{display:flex;gap:9px;align-items:flex-end}",
    ".mmw-row.mmw-user{flex-direction:row-reverse}",
    ".mmw-avatar{width:30px;height:30px;border-radius:50%;flex:none;box-shadow:0 1px 3px rgba(0,0,0,.12)}",
    ".mmw-av-bot{background-color:var(--bg-elev,#fff);background-image:url(" + AVATAR_URL + ");background-size:cover;background-position:center}",
    ".mmw-head-av{width:36px;height:36px}",
    ".mmw-av-user{background:var(--bg-hover,#f5f2ed);border:1px solid var(--border,rgba(0,0,0,.08));display:flex;align-items:center;justify-content:center;color:var(--text-mute,#7a7068)}",
    ".mmw-av-user svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}",

    /* 消息区 */
    ".mmw-msgs{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;",
      "padding:16px 14px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:var(--border,rgba(0,0,0,.15)) transparent}",
    ".mmw-msgs::-webkit-scrollbar{width:5px}",
    ".mmw-msgs::-webkit-scrollbar-thumb{background:var(--border,rgba(0,0,0,.15));border-radius:4px}",
    ".mmw-msg{max-width:80%;padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.7;word-break:break-word;overflow-wrap:anywhere;min-width:0}",
    ".mmw-msg p{margin:0 0 7px}.mmw-msg p:last-child{margin-bottom:0}",
    ".mmw-msg .mmw-h{font-weight:650;margin:8px 0 4px}",
    ".mmw-msg ul,.mmw-msg ol{margin:4px 0 6px;padding-left:20px}",
    ".mmw-msg li{margin:3px 0}",
    ".mmw-msg .mmw-code{background:var(--bg-code,#1a1a2e);color:#e8e6f0;border-radius:5px;padding:1px 6px;font-size:.85em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".mmw-msg .mmw-pre{background:var(--bg-code,#1a1a2e);color:#e8e6f0;border-radius:12px;padding:12px 14px;overflow-x:auto;margin:7px 0;font-size:12.5px;line-height:1.6}",
    ".mmw-msg .mmw-pre code{background:none;padding:0;color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".mmw-msg a{color:var(--accent,#b23a26);text-underline-offset:2px}",
    ".mmw-row.mmw-user .mmw-msg{align-self:flex-end;background:linear-gradient(135deg,var(--accent,#b23a26),var(--accent-hover,#d14a2c));color:#fff;border-bottom-right-radius:5px;box-shadow:0 2px 8px var(--accent-glow,rgba(178,58,38,.25))}",
    ".mmw-row.mmw-user .mmw-msg .mmw-code{background:rgba(255,255,255,.18);color:#fff}",
    ".mmw-row.mmw-user .mmw-msg a{color:#fff}",
    ".mmw-row.mmw-bot .mmw-msg{align-self:flex-start;",
      "background:linear-gradient(rgba(255,255,255,.06),rgba(255,255,255,.06)),var(--bg-hover,#f5f2ed);",
      "border:1px solid rgba(128,128,128,.28);border-bottom-left-radius:5px;box-shadow:0 1px 4px rgba(0,0,0,.08)}",
    ".mmw-row.mmw-bot .mmw-msg.streaming::after{content:'▍';opacity:.6;animation:mmw-blink 1s steps(2) infinite;margin-left:1px}",

    /* 打字动画(三连点) */
    ".mmw-typing{display:inline-flex;gap:4px;padding:3px 2px}",
    ".mmw-typing i{width:6px;height:6px;border-radius:50%;background:var(--text-mute,#7a7068);animation:mmw-bounce 1.2s infinite}",
    ".mmw-typing i:nth-child(2){animation-delay:.15s}",
    ".mmw-typing i:nth-child(3){animation-delay:.3s}",
    "@keyframes mmw-bounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}",

    /* 建议问题:单行横滑 */
    ".mmw-chips{display:flex;gap:8px;padding:2px 14px 12px;overflow-x:auto;flex:none;scrollbar-width:none;scroll-padding-left:14px}",
    ".mmw-chips::-webkit-scrollbar{display:none}",
    ".mmw-chip{flex:none;font-size:12.5px;padding:7px 13px;border-radius:999px;cursor:pointer;white-space:nowrap;",
      "background:var(--accent-soft,rgba(178,58,38,.08));color:var(--accent,#b23a26);border:1px solid var(--border,rgba(0,0,0,.05));transition:background .15s}",
    ".mmw-chip:active{background:var(--accent-glow,rgba(178,58,38,.18))}",

    /* 输入区 */
    ".mmw-form{display:flex;align-items:flex-end;gap:9px;padding:11px 13px 13px;border-top:1px solid var(--border,rgba(0,0,0,.07));",
      "background:var(--bg-soft,#fff);flex:none}",
    ".mmw-input{flex:1;resize:none;border:1px solid var(--border,rgba(0,0,0,.12));border-radius:15px;padding:12px 15px;min-height:50px;",
      "font-size:15px;font-family:inherit;line-height:1.5;background:var(--bg,#faf8f5);color:var(--text,#2c2825);max-height:140px;outline:none}",
    ".mmw-input::placeholder{color:var(--text-mute,#7a7068)}",
    ".mmw-input:focus{border-color:var(--accent,#b23a26);box-shadow:0 0 0 3px var(--accent-soft,rgba(178,58,38,.10))}",
    ".mmw-send{width:44px;height:44px;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;",
      "background:linear-gradient(135deg,var(--accent,#b23a26),var(--accent-hover,#d14a2c));color:#fff;flex:none;transition:opacity .15s,transform .15s;box-shadow:0 2px 8px var(--accent-glow,rgba(178,58,38,.3))}",
    ".mmw-send:disabled{opacity:.4;cursor:default}",
    ".mmw-send svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}",

    /* 移动端:全屏对话页 */
    "@media (max-width:640px){",
      "#mmw-root{right:0;bottom:0}",
      ".mmw-panel{position:fixed;inset:0;width:100%;height:100dvh;border-radius:0;border:none;transform:translateY(100%)}",
      "#mmw-root.open .mmw-panel{transform:none}",
      "#mmw-root.open .mmw-bubble{display:none}",
      ".mmw-head{padding:12px 14px;padding-top:calc(12px + env(safe-area-inset-top,0px))}",
      ".mmw-msgs{padding:14px 13px 8px}",
      ".mmw-msg{max-width:87%;font-size:15px}",
      ".mmw-avatar{width:28px;height:28px}",
      ".mmw-head-av{width:26px;height:26px}",
      ".mmw-chips{padding:2px 13px 10px}",
      ".mmw-form{padding:10px 12px;padding-bottom:calc(10px + env(safe-area-inset-bottom,0px))}",
      ".mmw-input{font-size:16px;min-height:54px;padding:13px 15px;border-radius:16px}",
      ".mmw-send{width:48px;height:48px}",
    "}",
    "@media print{#mmw-root{display:none}}"
  ].join("");

  var ICON_CHAT = '<svg viewBox="0 0 24 24" class="mmw-chat-ic"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" class="mmw-close-ic" style="width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
  var ICON_USER = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-3.6 3.9-5.4 7-5.4s5.8 1.8 7 5.4"/></svg>';

  /* ---------- 组件状态 ---------- */
  var state = { open: false, busy: false, chatId: getChatId(), controller: null, started: false };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function msgsEl() { return panel.querySelector(".mmw-msgs"); }
  function scrollBottom() {
    var m = msgsEl(); m.scrollTop = m.scrollHeight;
  }
  function addMsg(cls, markdown) {
    var row = el("div", "mmw-row " + cls);
    var av;
    if (cls.indexOf("user") !== -1) {
      av = el("div", "mmw-avatar mmw-av-user", ICON_USER);
      av.setAttribute("aria-label", "用户");
    } else {
      av = el("div", "mmw-avatar mmw-av-bot");
      av.setAttribute("aria-label", "助手");
    }
    var m = el("div", "mmw-msg", markdown ? renderMarkdown(markdown) : "");
    row.appendChild(av); row.appendChild(m);
    msgsEl().appendChild(row); scrollBottom();
    return m;
  }
  function setChipsVisible(v) {
    var c = panel.querySelector(".mmw-chips");
    c.style.display = v ? "flex" : "none";
  }

  function greet() {
    addMsg("mmw-bot", "你好,我是本站的 AI 助手。站内的具身智能知识库已经装进了我的脑子,可以问我概念、原理或排查思路;闲聊也没问题。");
  }

  function openPanel() {
    state.open = true;
    root.classList.add("open");
    if (!state.started) { state.started = true; greet(); setChipsVisible(true); }
    setTimeout(function () { panel.querySelector(".mmw-input").focus(); }, 120);
  }
  function closePanel() {
    state.open = false;
    root.classList.remove("open");
    if (state.controller) { try { state.controller.abort(); } catch (e) {} }
  }

  /* ---------- 流式请求 ---------- */
  function parseSse(raw) {
    var ev = { event: "message", data: "" }, dataLines = [];
    raw.split(/\r?\n/).forEach(function (line) {
      if (line.indexOf("event:") === 0) ev.event = line.slice(6).trim();
      if (line.indexOf("data:") === 0) {
        var d = line.slice(5);
        dataLines.push(d.charAt(0) === " " ? d.slice(1) : d);
      }
    });
    ev.data = dataLines.join("\n");
    return ev;
  }

  function send(text) {
    if (state.busy || !text) return;
    state.busy = true;
    setChipsVisible(false);
    addMsg("mmw-user", text);
    var bot = addMsg("mmw-bot", "");
    bot.innerHTML = TYPING_HTML; /* 等首个 token:三连点 */
    var input = panel.querySelector(".mmw-input");
    var sendButton = panel.querySelector(".mmw-send");
    input.value = ""; input.style.height = "auto"; input.disabled = true; sendButton.disabled = true;

    state.controller = new AbortController();
    var acc = "";

    fetch(API_STREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      signal: state.controller.signal,
      body: JSON.stringify({
        message: text,
        chatId: state.chatId,
        memoryMode: "DEFAULT",
        responseStyle: RESPONSE_STYLE,
        images: []
      })
    }).then(function (res) {
      if (!res.ok || !res.body) return res.text().then(function (t) { throw new Error(t || (res.status + " " + res.statusText)); });
      var reader = res.body.getReader(), decoder = new TextDecoder(), buf = "";
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(); return; }
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split("\n\n");
          buf = parts.pop() || "";
          parts.forEach(function (raw) { handle(parseSse(raw)); });
          return pump();
        });
      }
      return pump();
    }).catch(function (err) {
      if (err && err.name === "AbortError") { finish(); return; }
      bot.classList.remove("streaming");
      bot.innerHTML = renderMarkdown("抱歉,连接助手服务时出错了,请稍后再试。");
      var detail = el("div", "mmw-err", String(err && err.message || err).slice(0, 140));
      bot.appendChild(detail);
      state.busy = false;
      input.disabled = false; sendButton.disabled = false;
      state.controller = null;
    });

    function handle(ev) {
      if (ev.event === "chatId" && ev.data) { state.chatId = ev.data; saveChatId(state.chatId); return; }
      if (ev.event === "error") {
        bot.classList.remove("streaming");
        bot.innerHTML = renderMarkdown("**出错了:** " + (ev.data || "服务暂时不可用"));
        return;
      }
      if (ev.event === "message" && ev.data) {
        acc += ev.data;
        bot.innerHTML = renderMarkdown(acc);
        scrollBottom();
      }
    }
    function finish() {
      bot.classList.remove("streaming");
      if (!acc.trim() && !bot.innerHTML.trim()) bot.innerHTML = renderMarkdown("(空回复)");
      state.busy = false;
      input.disabled = false; sendButton.disabled = false;
      state.controller = null;
      if (state.open) input.focus();
    }
  }

  /* ---------- DOM 装配 ---------- */
  var root, panel;
  function mount() {
    if (document.getElementById("mmw-root")) return;

    var style = document.createElement("style");
    style.id = "mmw-style";
    style.textContent = CSS;
    document.head.appendChild(style);

    root = el("div");
    root.id = "mmw-root";

    panel = el("div", "mmw-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "AI 助手对话");

    var head = el("div", "mmw-head");
    var headAv = el("span", "mmw-avatar mmw-av-bot mmw-head-av");
    headAv.setAttribute("aria-hidden", "true");
    head.appendChild(headAv);
    var title = el("div", "mmw-head-title", "MostarManus 助手<span class=\"mmw-head-sub\">具身智能知识库驱动</span>");
    head.appendChild(title);
    var closeBtn = el("button", "mmw-close", ICON_CLOSE.replace("<svg", "<svg width=\"18\" height=\"18\""));
    closeBtn.setAttribute("aria-label", "关闭助手");
    closeBtn.addEventListener("click", closePanel);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    var msgs = el("div", "mmw-msgs");
    panel.appendChild(msgs);

    var chips = el("div", "mmw-chips");
    SUGGESTIONS.forEach(function (s) {
      var chip = el("button", "mmw-chip");
      chip.type = "button";
      chip.textContent = s;
      chip.addEventListener("click", function () { send(s); });
      chips.appendChild(chip);
    });
    panel.appendChild(chips);

    var form = el("div", "mmw-form");
    var input = el("textarea", "mmw-input");
    input.rows = 1;
    input.placeholder = "问点什么…";
    var sendButton = el("button", "mmw-send", ICON_SEND);
    sendButton.type = "button";
    sendButton.setAttribute("aria-label", "发送");
    form.appendChild(input); form.appendChild(sendButton);
    panel.appendChild(form);

    var bubble = el("button", "mmw-bubble", ICON_CHAT + ICON_CLOSE);
    bubble.type = "button";
    bubble.setAttribute("aria-label", "打开 AI 助手");

    root.appendChild(panel);
    root.appendChild(bubble);
    document.body.appendChild(root);

    bubble.addEventListener("click", function () { state.open ? closePanel() : openPanel(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) closePanel();
    });
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value.trim()); }
    });
    sendButton.addEventListener("click", function () { send(input.value.trim()); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
