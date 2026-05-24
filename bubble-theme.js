/* ================================================================
 * bubble-theme.js - 对话气泡与全局样式系统
 * 功能：
 * 1) CSS 输入 + 预览（模拟对话框）
 * 2) CSS 存档：保存/命名/编辑/删除
 * 3) 挂载：单聊 conversation / 群聊 group 分别挂载
 * 4) 全局样式管理：可同时自定义首页第一/第二页、聊天室 UI 并持久化
 * 依赖：
 * window.DB, window.escapeHtml, window.showStatus
 * ================================================================ */

(function () {
  "use strict";
  console.log("🎨 bubble-theme & global-theme 联合模块加载");

  const STORE_NAME = "bubbleThemes";
  const STYLE_PREFIX = "bt-style-";
  const PREVIEW_STYLE_ID = "bt-preview-style";

  const ICON_SCHEMA = [
    { key: "expandMenuBtn", label: "" },
    { key: "convSendBtn", label: "" },
    { key: "convFetchBtn", label: "" },
    { key: "userImage", label: "" },
    { key: "userVoice", label: "" },
    { key: "emoticon", label: "" },
    { key: "innerVoice", label: "" },
    { key: "voiceCall", label: "" },
    { key: "sendDiary", label: "" },
    { key: "toggleMode", label: "" },
    { key: "transfer", label: "" },
    { key: "sendRedPacket", label: "" },
    { key: "openSummary", label: "" },
    { key: "openDetail", label: "" },
    { key: "checkPhone", label: "" },
    { key: "focus", label: "" },
    { key: "coupleSpace", label: "" }
  ];

  const DEFAULT_ICON_MAP = {
    expandMenuBtn: { type: "svg", value: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' },
    convSendBtn: { type: "svg", value: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>' },
    convFetchBtn: { type: "svg", value: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>' },
    userImage: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>' },
    userVoice: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>' },
    emoticon: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>' },
    innerVoice: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' },
    voiceCall: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>' },
    sendDiary: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' },
    toggleMode: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' },
    transfer: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
    sendRedPacket: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="18" height="20" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="10" r="3"/></svg>' },
    openSummary: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' },
    openDetail: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' },
    checkPhone: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>' },
    focus: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' },
    coupleSpace: { type: "svg", value: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' }
  };

  let currentEditingIconMap = JSON.parse(JSON.stringify(DEFAULT_ICON_MAP));

  function esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  }

  function toast(msg, type) {
    if (window.showStatus) window.showStatus(msg, type || "info");
    else console.log(msg);
  }

  function uid() {
    return "bt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  function getStyleEl(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    return el;
  }

  function removeStyleEl(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  async function ensureStore() {
    try {
      await window.DB.getAll(STORE_NAME);
    } catch (e) {
      console.error("bubbleThemes store 不可用", e);
      toast("❌ bubbleThemes 存储不可用，请检查 DB 升级", "error");
    }
  }

  function normalizeIconMap(raw) {
    const map = JSON.parse(JSON.stringify(DEFAULT_ICON_MAP));
    if (!raw) return map;

    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (!v) return;
      if (typeof v === "string") {
        map[k] = { type: "text", value: v };
      } else if (typeof v === "object" && v.value) {
        map[k] = { type: v.type || "text", value: v.value };
      }
    });
    return map;
  }

  function isImageValue(v) {
    if (!v) return false;
    const s = String(v).trim().toLowerCase();
    return s.startsWith("data:image/") ||
      s.includes(".svg") || s.includes(".png") || s.includes(".jpg") || s.includes(".jpeg") || s.includes(".webp") || s.includes(".gif");
  }

  function isSvgMarkup(v) {
    if (!v) return false;
    return String(v).trim().startsWith("<svg");
  }

  function scopeCss(cssText, scopeSelector) {
    if (!cssText || !cssText.trim()) return "";

    let text = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const preserved = [];

    text = text.replace(/@keyframes\s+[^{]+\{[\s\S]*?\n\}/g, function (match) {
      const token = "__BT_KEYFRAMES_" + preserved.length + "__";
      preserved.push(match);
      return token;
    });

    text = text.replace(/@keyframes\s+[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, function (match) {
      const token = "__BT_KEYFRAMES_" + preserved.length + "__";
      preserved.push(match);
      return token;
    });

    const chunks = text.split("}");
    let out = "";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (!chunk) continue;

      if (chunk.startsWith("__BT_KEYFRAMES_")) {
        out += chunk;
        continue;
      }

      const idx = chunk.indexOf("{");
      if (idx === -1) continue;

      const selectorPart = chunk.slice(0, idx).trim();
      const bodyPart = chunk.slice(idx + 1);

      if (selectorPart.startsWith("@")) {
        out += selectorPart + "{" + bodyPart + "}";
        continue;
      }

      const scopedSel = selectorPart
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          if (s.startsWith(scopeSelector)) return s;
          return scopeSelector + " " + s;
        })
        .join(", ");

      out += scopedSel + "{" + bodyPart + "}";
    }

    preserved.forEach((block, i) => {
      out = out.replace("__BT_KEYFRAMES_" + i + "__", block);
    });

    return out;
  }

  function buildPreviewHtml() {
    const imageSvg = DEFAULT_ICON_MAP.userImage.value;
    const micSvg = DEFAULT_ICON_MAP.userVoice.value;
    const phoneSvg = DEFAULT_ICON_MAP.voiceCall.value;
    const quoteSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11H6a2 2 0 0 0-2 2v5h6v-7z"/><path d="M20 11h-4a2 2 0 0 0-2 2v5h6v-7z"/><path d="M6 11V8a4 4 0 0 1 4-4"/><path d="M16 11V8a4 4 0 0 1 4-4"/></svg>';

    return [
      '<div class="chat-header">',
      '  <div class="chat-header-left"><button class="back-btn">←</button><h2 style="font-size:18px;">预览会话</h2></div>',
      '  <div class="header-actions"><button class="header-btn">···</button></div>',
      '</div>',
      '<div class="expand-menu active" id="previewExpandMenu" style="display:flex;">',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="userImage"></span><span class="expand-menu-label">图片</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="userVoice"></span><span class="expand-menu-label">语音</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="emoticon"></span><span class="expand-menu-label">表情</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="innerVoice"></span><span class="expand-menu-label">心声</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="voiceCall"></span><span class="expand-menu-label">通话</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="sendDiary"></span><span class="expand-menu-label">日记</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="toggleMode"></span><span class="expand-menu-label">见面</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="transfer"></span><span class="expand-menu-label">转账</span></div>',
      '</div>',
      '<div class="chat-messages" style="height:260px;overflow:auto;">',
      '  <div class="group-system-msg">— 系统消息：示例系统提示 —</div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">C</div><div class="bubble">这是对方文字气泡</div></div>',
      '  <div class="message-row self"><div class="bubble">这是我的文字气泡</div><div class="message-avatar" style="background:#c88;">U</div></div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">C</div><div class="bubble image-bubble"><span class="image-icon">' + imageSvg + '</span></div></div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">C</div><div class="bubble voice-bubble"><div class="voice-bubble-header"><span class="voice-icon">' + micSvg + '</span><span class="voice-duration">7"</span></div></div></div>',
      '  <div class="message-row self"><div class="bubble voice-bubble"><div class="voice-bubble-header"><span class="voice-icon">' + micSvg + '</span><span class="voice-duration">7"</span></div></div><div class="message-avatar" style="background:#c88;">U</div></div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">C</div><div class="bubble call-record-bubble"><span class="call-record-icon">' + phoneSvg + '</span><span>语音通话已结束1分20秒</span></div></div>',
      '  <div class="message-row self"><div class="bubble quoted-bubble"><div>这是带引用的回复正文</div><div class="quote-ref-footer"><div class="quote-ref-footer-title"><span>' + quoteSvg + '</span><span>引用</span></div><div class="quote-ref-footer-content">对方：这是被引用的那条消息</div></div></div><div class="message-avatar" style="background:#c88;">U</div></div>',
      '</div>',
      '<div class="chat-input-area">',
      '  <div class="mini-btn"><span data-icon-key="expandMenuBtn"></span></div>',
      '  <div class="input-wrapper"><input type="text" placeholder="输入框预览"></div>',
      '  <div class="mini-btn"><span data-icon-key="convSendBtn"></span></div>',
      '  <div class="mini-btn"><span data-icon-key="convFetchBtn"></span></div>',
      '</div>'
    ].join("");
  }

  function setIconNode(el, iconDef) {
    if (!el || !iconDef) return;
    const value = iconDef.value || "";
    const type = iconDef.type || "text";

    if (type === "svg" || isSvgMarkup(value)) {
      el.innerHTML = value;
    } else if (type === "image" || isImageValue(value)) {
      el.innerHTML = `<img src="${value}" style="width:2em;height:2em;object-fit:contain;vertical-align:middle;" alt="">`;
    } else {
      el.textContent = value || "";
    }
  }

  function applyIconMapToPreview() {
    const root = document.getElementById("bubbleThemePreviewRoot");
    if (!root) return;
    root.querySelectorAll("[data-icon-key]").forEach(el => {
      const key = el.getAttribute("data-icon-key");
      const def = currentEditingIconMap[key] || DEFAULT_ICON_MAP[key];
      setIconNode(el, def);
    });
  }

  function applyIconMapToConversationDOM(iconMap) {
    const plus = document.querySelector("#expandMenuBtn");
    const send = document.querySelector("#convSendBtn");
    const fetch = document.querySelector("#convFetchBtn");

    if (plus) plus.innerHTML = "";
    if (send) send.innerHTML = "";
    if (fetch) fetch.innerHTML = "";

    if (plus) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.expandMenuBtn);
      plus.appendChild(span);
    }
    if (send) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.convSendBtn);
      send.appendChild(span);
    }
    if (fetch) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.convFetchBtn);
      fetch.appendChild(span);
    }

    document.querySelectorAll("#expandMenu .expand-menu-item").forEach(item => {
      const action = item.getAttribute("data-action");
      const iconEl = item.querySelector(".expand-menu-icon");
      if (!iconEl) return;

      const mapKey = {
        userImage: "userImage",
        userVoice: "userVoice",
        emoticon: "emoticon",
        innerVoice: "innerVoice",
        voiceCall: "voiceCall",
        sendDiary: "sendDiary",
        toggleMode: "toggleMode",
        transfer: "transfer",
        sendRedPacket: "sendRedPacket",
        openSummary: "openSummary",
        openDetail: "openDetail",
        checkPhone: "checkPhone",
        focus: "focus",
        coupleSpace: "coupleSpace"
      }[action];

      if (!mapKey) return;
      setIconNode(iconEl, iconMap[mapKey] || DEFAULT_ICON_MAP[mapKey]);
    });
  }

  function applyIconMapToGroupDOM(iconMap) {
    const plus = document.querySelector("#groupExpandMenuBtn");
    const send = document.querySelector("#groupSendBtn");
    const fetch = document.querySelector("#groupFetchBtn");

    if (plus) plus.innerHTML = "";
    if (send) send.innerHTML = "";
    if (fetch) fetch.innerHTML = "";

    if (plus) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.expandMenuBtn);
      plus.appendChild(span);
    }
    if (send) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.convSendBtn);
      send.appendChild(span);
    }
    if (fetch) {
      const span = document.createElement("span");
      setIconNode(span, iconMap.convFetchBtn);
      fetch.appendChild(span);
    }

    document.querySelectorAll("#groupExpandMenu .expand-menu-item").forEach(item => {
      const action = item.getAttribute("data-action");
      const iconEl = item.querySelector(".expand-menu-icon");
      if (!iconEl) return;

      const mapKey = {
        groupImage: "userImage",
        groupVoice: "userVoice",
        groupEmoticon: "emoticon",
        groupToggleMode: "toggleMode",
        groupTransfer: "transfer",
        groupRedPacket: "sendRedPacket",
        groupSummary: "openSummary",
        groupOpenDetail: "openDetail",
        focus: "focus"
      }[action];

      if (!mapKey) return;
      setIconNode(iconEl, iconMap[mapKey] || DEFAULT_ICON_MAP[mapKey]);
    });
  }

  async function getAllThemes(type = "bubble") {
    const list = await window.DB.getAll(STORE_NAME);
    return (list || []).filter(t => {
      if (type === "global") return t.type === "global";
      return !t.type || t.type === "bubble";
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function renderArchiveList() {
    const box = document.getElementById("bubbleThemeArchiveList");
    if (!box) return;
    const list = await getAllThemes("bubble");

    if (!list.length) {
      box.innerHTML = '<div class="bubble-theme-empty">暂无样式存档</div>';
      return;
    }

    box.innerHTML = list.map(t => {
      return `<div class="bubble-theme-row" data-id="${t.id}">
        <div class="bubble-theme-row-main">
          <div class="bubble-theme-row-name">${esc(t.name)}</div>
          <div class="bubble-theme-row-time">${new Date(t.updatedAt || Date.now()).toLocaleString("zh-CN")}</div>
        </div>
        <div class="bubble-theme-row-actions">
          <button class="small-btn bt-load">载入</button>
          <button class="small-btn bt-edit">重命名</button>
          <button class="small-btn bt-del" style="color:#c0392b;">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  async function renderMountThemeSelect() {
    const sel = document.getElementById("bubbleThemeMountSelect");
    if (!sel) return;
    const list = await getAllThemes("bubble");

    if (!list.length) {
      sel.innerHTML = `<option value="">暂无存档</option>`;
      return;
    }
    sel.innerHTML = `<option value="">请选择一个样式存档</option>` +
      list.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  }

  async function renderMountTargetList() {
    const box = document.getElementById("bubbleThemeTargetList");
    if (!box) return;

    const convs = await window.DB.getAll("conversations");
    const groups = await window.DB.getAll("groupChats");

    let html = `<div class="bubble-theme-target-title">单聊会话</div>`;
    if (!convs.length) {
      html += `<div class="bubble-theme-empty">暂无单聊</div>`;
    } else {
      for (const c of convs) {
        const ch = await window.DB.get("characters", c.charId);
        const cd = await window.DB.get("convDetails", c.id);
        const name = cd?.charName || ch?.name || ("会话#" + c.id);
        html += `<div class="bubble-theme-target-row">
          <span>${esc(name)}</span>
          <button class="small-btn bt-mount-conv" data-conv-id="${c.id}">挂载</button>
        </div>`;
      }
    }

    html += `<div class="bubble-theme-target-title" style="margin-top:10px;">群聊会话</div>`;
    if (!groups.length) {
      html += `<div class="bubble-theme-empty">暂无群聊</div>`;
    } else {
      groups.forEach(g => {
        html += `<div class="bubble-theme-target-row">
          <span>${esc(g.name || ("群聊#" + g.id))}</span>
          <button class="small-btn bt-mount-group" data-group-id="${g.id}">挂载</button>
        </div>`;
      });
    }

    box.innerHTML = html;
  }

  function renderIconEditor() {
    const box = document.getElementById("bubbleIconEditorList");
    if (!box) return;
    box.innerHTML = ICON_SCHEMA.map(item => {
      const def = currentEditingIconMap[item.key] || DEFAULT_ICON_MAP[item.key];
      let preview;
      if (def.type === "svg" || isSvgMarkup(def.value)) {
        preview = `<span style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;">${def.value}</span>`;
      } else if (def.type === "image" || isImageValue(def.value)) {
        preview = `<img src="${esc(def.value)}" style="width:20px;height:20px;object-fit:contain;">`;
      } else {
        preview = `<span>${esc(def.value)}</span>`;
      }
      return `<div class="theme-icon-edit-row" data-icon-key="${item.key}" style="padding:10px 8px;margin-bottom:6px;">
        <div class="theme-icon-preview" style="width:40px;height:40px;border-radius:10px;background:#f8f8f8;">${preview}</div>
        <div class="theme-icon-info">
          <div class="theme-icon-name">${esc(item.label)}</div>
        </div>
        <div class="theme-icon-actions">
          <button class="theme-icon-action-btn bt-icon-text">文本/URL</button>
          <button class="theme-icon-action-btn bt-icon-upload">上传</button>
          <button class="theme-icon-action-btn reset-btn bt-icon-reset">重置</button>
          <input type="file" class="bt-icon-file" accept=".svg,image/*" style="display:none;">
        </div>
      </div>`;
    }).join("");
  }

  function initPreviewBox() {
    const root = document.getElementById("bubbleThemePreviewRoot");
    if (!root) return;
    root.setAttribute("data-bubble-scope", "preview");
    root.innerHTML = buildPreviewHtml();
    applyIconMapToPreview();
  }

  function runPreview() {
    const input = document.getElementById("bubbleCssInput");
    if (!input) return;
    const cssText = input.value || "";
    const scoped = scopeCss(cssText, '[data-bubble-scope="preview"]');
    getStyleEl(PREVIEW_STYLE_ID).textContent = scoped;
    applyIconMapToPreview();
    toast("预览已更新", "success");
  }

  function clearPreview() {
    removeStyleEl(PREVIEW_STYLE_ID);
    currentEditingIconMap = JSON.parse(JSON.stringify(DEFAULT_ICON_MAP));
    renderIconEditor();
    initPreviewBox();
    toast("预览已清除", "info");
  }

  async function saveSnapshot() {
    const input = document.getElementById("bubbleCssInput");
    const cssText = (input?.value || "").trim();
    if (!cssText) {
      toast("请输入 CSS 后再保存", "error");
      return;
    }
    const name = prompt("请输入存档名称：", "我的气泡样式");
    if (!name || !name.trim()) return;

    const theme = {
      id: uid(),
      name: name.trim(),
      cssText,
      iconMap: currentEditingIconMap,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await window.DB.put(STORE_NAME, theme);
    await renderArchiveList();
    await renderMountThemeSelect();
    toast("存档已保存", "success");
  }

  async function applyBubbleThemeForConversation(convId) {
    const page = document.getElementById("page-conversation");
    if (!page || !convId) return;
    const scope = "conv_" + convId;
    page.setAttribute("data-bubble-scope", scope);

    const convDetail = await window.DB.get("convDetails", convId);
    const themeId = convDetail?.bubbleThemeId || "";
    const styleId = STYLE_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      applyIconMapToConversationDOM(DEFAULT_ICON_MAP);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme) {
      removeStyleEl(styleId);
      applyIconMapToConversationDOM(DEFAULT_ICON_MAP);
      return;
    }

    getStyleEl(styleId).textContent = scopeCss(theme.cssText || "", `[data-bubble-scope="${scope}"]`);
    applyIconMapToConversationDOM(normalizeIconMap(theme.iconMap));
  }

  async function applyBubbleThemeForGroup(groupId) {
    const page = document.getElementById("page-group-conversation");
    if (!page || !groupId) return;
    const scope = "group_" + groupId;
    page.setAttribute("data-bubble-scope", scope);

    const g = await window.DB.get("groupChats", groupId);
    const themeId = g?.bubbleThemeId || "";
    const styleId = STYLE_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      applyIconMapToGroupDOM(DEFAULT_ICON_MAP);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme) {
      removeStyleEl(styleId);
      applyIconMapToGroupDOM(DEFAULT_ICON_MAP);
      return;
    }

    getStyleEl(styleId).textContent = scopeCss(theme.cssText || "", `[data-bubble-scope="${scope}"]`);
    applyIconMapToGroupDOM(normalizeIconMap(theme.iconMap));
  }

  // ================================================================
  // 全局样式系统
  // ================================================================
  const GLOBAL_APPLIED_STYLE_ID = "gt-style-applied";

  function initGlobalThemePanel() {
    renderGlobalArchiveList();
  }

  async function saveGlobalSnapshot() {
    const input = document.getElementById("globalCssInput");
    const cssText = (input?.value || "").trim();

    if (!cssText) {
      toast("请输入 CSS 后再保存", "error");
      return;
    }

    const name = prompt("请输入全局样式存档名称：", "我的全局样式");
    if (!name || !name.trim()) return;

    const theme = {
      id: uid(),
      name: name.trim(),
      cssText,
      type: "global",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await window.DB.put(STORE_NAME, theme);
    await renderGlobalArchiveList();
    toast("全局样式存档已保存", "success");
  }

  async function applyGlobalTheme(themeId) {
    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme) return;

    await window.DB.setSetting("activeGlobalThemeId", themeId);

    const styleEl = getStyleEl(GLOBAL_APPLIED_STYLE_ID);
    styleEl.textContent = theme.cssText || "";

    toast("已应用全局样式：" + theme.name, "success");
    await renderGlobalArchiveList();
  }

  async function removeActiveGlobalTheme() {
    await window.DB.setSetting("activeGlobalThemeId", "");
    removeStyleEl(GLOBAL_APPLIED_STYLE_ID);
    toast("已卸载全局样式", "info");
    await renderGlobalArchiveList();
  }

  async function restoreGlobalDefault() {
    if (!confirm("确定恢复默认全局样式吗？当前已应用的全局样式会被卸载。")) return;

    await window.DB.setSetting("activeGlobalThemeId", "");
    removeStyleEl(GLOBAL_APPLIED_STYLE_ID);

    const input = document.getElementById("globalCssInput");
    if (input) input.value = "";

    await renderGlobalArchiveList();
    toast("已恢复默认", "success");
  }

  async function renderGlobalArchiveList() {
  const box = document.getElementById("globalThemeArchiveList");
  if (!box) return;

  const list = await getAllThemes("global");
  const activeId = await window.DB.getSetting("activeGlobalThemeId", "");

  if (!list.length) {
    box.innerHTML = '<div class="bubble-theme-empty">暂无样式存档</div>';
    return;
  }

  box.innerHTML = list.map(theme => {
    const isActive = theme.id === activeId;

    return `
      <div class="bubble-theme-row global-theme-row ${isActive ? 'active' : ''}" data-id="${theme.id}">
        <div class="bubble-theme-row-main">
          <div class="bubble-theme-row-name">
            ${esc(theme.name)}
            ${isActive ? '<span class="global-theme-active-tag">应用中</span>' : ''}
          </div>
          <div class="bubble-theme-row-time">
            ${new Date(theme.updatedAt || Date.now()).toLocaleString("zh-CN")}
          </div>
        </div>

        <div class="bubble-theme-row-actions">
          <button class="small-btn gt-apply ${isActive ? 'is-active' : ''}" ${isActive ? 'disabled' : ''}>
            ${isActive ? '已应用' : '应用'}
          </button>
          <button class="small-btn gt-load">载入</button>
          <button class="small-btn gt-del">删除</button>
        </div>
      </div>
    `;
  }).join("");
}

  async function applyActiveGlobalThemeOnStartup() {
    try {
      const activeThemeId = await window.DB.getSetting("activeGlobalThemeId", "");
      if (!activeThemeId) return;

      const theme = await window.DB.get(STORE_NAME, activeThemeId);
      if (!theme || !theme.cssText) return;

      getStyleEl(GLOBAL_APPLIED_STYLE_ID).textContent = theme.cssText;
    } catch (e) {
      console.error("加载全局主题失败:", e);
    }
  }

  function bindDelegatedEventsOnce() {
    if (window.__btDelegatedBound) return;
    window.__btDelegatedBound = true;

    document.addEventListener("click", async (e) => {
      const t = e.target;

      // 气泡预览
      if (t.id === "bubblePreviewBtn") return runPreview();
      if (t.id === "bubbleClearPreviewBtn") return clearPreview();
      if (t.id === "bubbleSaveSnapshotBtn") return saveSnapshot();

      // 全局样式
      if (t.id === "globalSaveSnapshotBtn") return saveGlobalSnapshot();
      if (t.id === "globalRestoreDefaultBtn") return restoreGlobalDefault();

      // 全局样式存档点击代理：应用 / 载入 / 删除
const gtRow = t.closest(".global-theme-row");

if (gtRow) {
  const id = gtRow.getAttribute("data-id");
  if (!id) return;

  if (t.classList.contains("gt-apply")) {
    if (t.disabled || t.classList.contains("is-active")) return;

    await applyGlobalTheme(id);
    return;
  }

  if (t.classList.contains("gt-load")) {
    const theme = await window.DB.get(STORE_NAME, id);
    if (!theme) return;

    const input = document.getElementById("globalCssInput");
    if (input) {
      input.value = theme.cssText || "";
      input.scrollTop = 0;
    }

    toast("已载入存档到输入框", "success");
    return;
  }

  if (t.classList.contains("gt-del")) {
    if (!confirm("确定删除这个全局样式存档吗？")) return;

    const activeId = await window.DB.getSetting("activeGlobalThemeId", "");

    if (id === activeId) {
      await window.DB.setSetting("activeGlobalThemeId", "");
      removeStyleEl(GLOBAL_APPLIED_STYLE_ID);
    }

    await window.DB.delete(STORE_NAME, id);
    await renderGlobalArchiveList();

    toast("已删除存档", "success");
    return;
  }
}

      const row = t.closest(".bubble-theme-row");
      if (row && t.classList.contains("bt-load")) {
        const id = row.getAttribute("data-id");
        const theme = await window.DB.get(STORE_NAME, id);
        if (!theme) return;
        document.getElementById("bubbleCssInput").value = theme.cssText || "";
        currentEditingIconMap = normalizeIconMap(theme.iconMap);
        renderIconEditor();
        initPreviewBox();
        toast("已载入存档", "success");
        return;
      }

      if (row && t.classList.contains("bt-edit")) {
        const id = row.getAttribute("data-id");
        const theme = await window.DB.get(STORE_NAME, id);
        if (!theme) return;
        const name = prompt("新名称：", theme.name || "");
        if (!name || !name.trim()) return;
        theme.name = name.trim();
        theme.updatedAt = Date.now();
        await window.DB.put(STORE_NAME, theme);
        await renderArchiveList();
        await renderMountThemeSelect();
        toast("已重命名", "success");
        return;
      }

      if (row && t.classList.contains("bt-del")) {
        const id = row.getAttribute("data-id");
        if (!confirm("确定删除这个样式存档吗？")) return;
        await window.DB.delete(STORE_NAME, id);

        const cds = await window.DB.getAll("convDetails");
        for (const d of cds) {
          if (d.bubbleThemeId === id) {
            d.bubbleThemeId = "";
            await window.DB.put("convDetails", d);
          }
        }

        const gs = await window.DB.getAll("groupChats");
        for (const g of gs) {
          if (g.bubbleThemeId === id) {
            g.bubbleThemeId = "";
            await window.DB.put("groupChats", g);
          }
        }

        await renderArchiveList();
        await renderMountThemeSelect();
        await renderMountTargetList();
        toast("已删除并解除挂载", "success");
        return;
      }

      if (t.classList.contains("bt-mount-conv")) {
        const themeId = document.getElementById("bubbleThemeMountSelect")?.value || "";
        if (!themeId) return toast("请先选择样式存档", "error");
        const convId = parseInt(t.getAttribute("data-conv-id"));
        if (!convId) return;

        let cd = await window.DB.get("convDetails", convId);
        if (!cd) cd = { conversationId: convId, worldbookIds: [] };
        cd.bubbleThemeId = themeId;
        await window.DB.put("convDetails", cd);

        if (window.currentConversationId === convId) {
          await applyBubbleThemeForConversation(convId);
        }
        toast("✅ 已挂载到单聊", "success");
        return;
      }

      if (t.classList.contains("bt-mount-group")) {
        const themeId = document.getElementById("bubbleThemeMountSelect")?.value || "";
        if (!themeId) return toast("请先选择样式存档", "error");
        const groupId = parseInt(t.getAttribute("data-group-id"));
        if (!groupId) return;

        const g = await window.DB.get("groupChats", groupId);
        if (!g) return;
        g.bubbleThemeId = themeId;
        await window.DB.put("groupChats", g);

        if (window.currentGroupId === groupId) {
          await applyBubbleThemeForGroup(groupId);
        }
        toast("✅ 已挂载到群聊", "success");
        return;
      }

      const iconRow = t.closest("[data-icon-key]");
      if (iconRow && t.classList.contains("bt-icon-text")) {
        const key = iconRow.getAttribute("data-icon-key");
        const old = currentEditingIconMap[key]?.value || "";
        const v = prompt("输入 emoji / 文本 / URL(svg也可)：", old);
        if (v === null) return;
        const value = v.trim();
        if (!value) return;
        currentEditingIconMap[key] = { type: isImageValue(value) ? "image" : "text", value };
        renderIconEditor();
        initPreviewBox();
        return;
      }

      if (iconRow && t.classList.contains("bt-icon-upload")) {
        const fileInput = iconRow.querySelector(".bt-icon-file");
        if (fileInput) fileInput.click();
        return;
      }

      if (iconRow && t.classList.contains("bt-icon-reset")) {
        const key = iconRow.getAttribute("data-icon-key");
        currentEditingIconMap[key] = JSON.parse(JSON.stringify(DEFAULT_ICON_MAP[key]));
        renderIconEditor();
        initPreviewBox();
        return;
      }
    });

    document.addEventListener("change", async (e) => {
      const t = e.target;
      if (!t.classList.contains("bt-icon-file")) return;
      const file = t.files && t.files[0];
      if (!file) return;

      const row = t.closest("[data-icon-key]");
      const key = row?.getAttribute("data-icon-key");
      if (!key) return;

      const reader = new FileReader();
      reader.onload = function (ev) {
        const dataUrl = ev.target.result;
        currentEditingIconMap[key] = { type: "image", value: dataUrl };
        renderIconEditor();
        initPreviewBox();
      };
      reader.readAsDataURL(file);

      t.value = "";
    });
  }

  async function initBubbleThemePanel() {
    await ensureStore();
    currentEditingIconMap = JSON.parse(JSON.stringify(DEFAULT_ICON_MAP));
    renderIconEditor();
    initPreviewBox();
    await renderArchiveList();
    await renderMountThemeSelect();
    await renderMountTargetList();
  }

  window.bubbleThemeModule = {
    initBubbleThemePanel,
    applyBubbleThemeForConversation,
    applyBubbleThemeForGroup,
    scopeCss
  };

  window.globalThemeModule = {
    initGlobalThemePanel,
    applyActiveGlobalThemeOnStartup
  };

  bindDelegatedEventsOnce();
})();

/* ================================================================
 * API 悬浮窗开关
 * 追加在 bubble-theme.js 末尾即可
 * ================================================================ */

(function () {
  "use strict";

  const SETTING_KEY = "apiFloatEnabled";
  let panelInjected = false;
  let entryInjected = false;
  let eventsBound = false;

  function svgIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
  }

  function toast(msg, type) {
    if (window.showStatus) {
      window.showStatus(msg, type || "info");
    } else {
      console.log(msg);
    }
  }

  function normalizeEnabled(value) {
    return value !== false && value !== "false" && value !== 0 && value !== "0";
  }

  async function getEnabled() {
    if (!window.DB || !window.DB.getSetting) return true;
    const value = await window.DB.getSetting(SETTING_KEY, true);
    return normalizeEnabled(value);
  }

  async function setEnabled(enabled) {
    if (window.DB && window.DB.setSetting) {
      await window.DB.setSetting(SETTING_KEY, !!enabled);
    }
    applyApiFloatVisibility(enabled);
  }

  function applyApiFloatVisibility(enabled) {
    document.body.classList.toggle("api-float-disabled", !enabled);

    const card = document.getElementById("apiStatusCard");
    if (!enabled && card) {
      card.classList.remove("show");
    }

    const sw = document.getElementById("apiFloatEnabledSwitch");
    if (sw) {
      sw.classList.toggle("on", !!enabled);
    }
  }

  function injectEntry() {
    if (entryInjected) return;

    const homeView = document.getElementById("themeHomeView");
    if (!homeView) return;

    if (homeView.querySelector('[data-theme-page="apiFloat"]')) {
      entryInjected = true;
      return;
    }

    const card = document.createElement("div");
    card.className = "theme-entry-card clickable";
    card.setAttribute("data-theme-page", "apiFloat");
    card.style.cssText = [
      "background:white",
      "border-radius:16px",
      "padding:20px",
      "margin-bottom:12px",
      "display:flex",
      "align-items:center",
      "border:1px solid #d4cdc2",
      "cursor:pointer"
    ].join(";");

    card.innerHTML = '<div style="font-size:17px;font-weight:600;color:#4a5568;">API 悬浮窗</div>';

    homeView.appendChild(card);
    entryInjected = true;
  }

  function injectPanel() {
    if (panelInjected) return;

    const detailView = document.getElementById("themeDetailView");
    if (!detailView) return;

    if (document.getElementById("themePanelApiFloat")) {
      panelInjected = true;
      return;
    }

    const panel = document.createElement("div");
    panel.id = "themePanelApiFloat";
    panel.style.display = "none";

    panel.innerHTML = `
      <div class="api-float-theme-section">
        <div class="api-float-theme-title">API 悬浮窗</div>
        <div class="api-float-theme-desc">
          控制右下角 API 状态悬浮窗是否显示。关闭后，悬浮按钮和状态卡片都会隐藏。
        </div>

        <div class="api-float-toggle-row">
          <div class="api-float-toggle-label">
            ${svgIcon()}
            <span>显示 API 悬浮窗</span>
          </div>
          <div class="api-float-switch on" id="apiFloatEnabledSwitch"></div>
        </div>

        <div class="api-float-note">
          此设置会自动保存。重新打开应用后仍会保持当前状态。
        </div>
      </div>
    `;

    detailView.appendChild(panel);
    panelInjected = true;
  }

  function hideAllThemePanels() {
    const ids = [
      "themePanelWallpaper",
      "themePanelIcon",
      "themePanelBubble",
      "themePanelLockscreen",
      "themePanelGlobal",
      "themePanelApiFloat"
    ];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  async function openApiFloatPanel() {
    injectEntry();
    injectPanel();

    const homeView = document.getElementById("themeHomeView");
    const detailView = document.getElementById("themeDetailView");
    const titleEl = document.getElementById("themeDetailTitle");
    const panel = document.getElementById("themePanelApiFloat");

    if (homeView) homeView.style.display = "none";
    if (detailView) detailView.style.display = "block";
    if (titleEl) titleEl.textContent = "API 悬浮窗";

    hideAllThemePanels();

    if (panel) panel.style.display = "";

    const enabled = await getEnabled();
    applyApiFloatVisibility(enabled);
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    document.addEventListener("click", async function (e) {
      const apiEntry = e.target.closest('[data-theme-page="apiFloat"]');

      if (apiEntry) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        await openApiFloatPanel();
        return;
      }

      const otherThemeEntry = e.target.closest(".theme-entry-card[data-theme-page]");
      if (otherThemeEntry && otherThemeEntry.getAttribute("data-theme-page") !== "apiFloat") {
        const panel = document.getElementById("themePanelApiFloat");
        if (panel) panel.style.display = "none";
      }

      const sw = e.target.closest("#apiFloatEnabledSwitch");
      if (sw) {
        const next = !sw.classList.contains("on");
        await setEnabled(next);
        toast(next ? "API 悬浮窗已开启" : "API 悬浮窗已关闭", "success");
      }
    }, true);
  }

  async function initApiFloatToggle() {
    injectEntry();
    injectPanel();
    bindEvents();

    const enabled = await getEnabled();
    applyApiFloatVisibility(enabled);
  }

  function boot() {
    initApiFloatToggle().catch(err => {
      console.warn("API 悬浮窗开关初始化失败", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.apiFloatToggleModule = {
    init: initApiFloatToggle,
    apply: applyApiFloatVisibility,
    getEnabled,
    setEnabled
  };
})();
/* ================================================================
 * 手机外壳模式开关
 * 追加在 bubble-theme.js 末尾
 * 功能：
 * 1) 在 美化 首页注入“手机外壳模式”开关卡片
 * 2) 保存到 DB settings：phoneFrameEnabled
 * 3) 给 html 添加/移除 .phone-frame-enabled
 * 4) iOS / 安卓 / 桌面都可用，但默认关闭，不影响原效果
 * ================================================================ */

(function () {
  "use strict";

  const SETTING_KEY = "phoneFrameEnabled";

  let entryInjected = false;
  let eventsBound = false;
  let booted = false;

  function toast(msg, type) {
    if (window.showStatus) {
      window.showStatus(msg, type || "info");
    } else {
      console.log(msg);
    }
  }

  function normalizeEnabled(value) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  async function waitForReady() {
    const max = 80;
    let count = 0;

    return new Promise(resolve => {
      const timer = setInterval(() => {
        count++;

        const ready =
          window.DB &&
          typeof window.DB.getSetting === "function" &&
          typeof window.DB.setSetting === "function" &&
          document.getElementById("themeHomeView");

        if (ready || count >= max) {
          clearInterval(timer);
          resolve(!!ready);
        }
      }, 100);
    });
  }

  async function getEnabled() {
    if (!window.DB || !window.DB.getSetting) return false;

    const value = await window.DB.getSetting(SETTING_KEY, false);
    return normalizeEnabled(value);
  }

  async function setEnabled(enabled) {
    enabled = !!enabled;

    if (window.DB && window.DB.setSetting) {
      await window.DB.setSetting(SETTING_KEY, enabled);
    }

    applyPhoneFrameMode(enabled);
    updateSwitch(enabled);
  }

  function applyPhoneFrameMode(enabled) {
    document.documentElement.classList.toggle("phone-frame-enabled", !!enabled);

    // 切换后触发一次 resize，让你现有的 --app-height / --ios-app-height 逻辑重新跑一遍
    setTimeout(() => {
      try {
        window.dispatchEvent(new Event("resize"));
      } catch (e) {}
    }, 80);
  }

  function updateSwitch(enabled) {
    const sw = document.getElementById("phoneFrameEnabledSwitch");
    if (sw) {
      sw.classList.toggle("on", !!enabled);
    }
  }

  function injectEntry() {
    if (entryInjected) return;

    const homeView = document.getElementById("themeHomeView");
    if (!homeView) return;

    if (document.getElementById("phoneFrameToggleCard")) {
      entryInjected = true;
      return;
    }

    const card = document.createElement("div");
    card.id = "phoneFrameToggleCard";
    card.className = "theme-entry-card";
    card.style.cssText = [
      "background:white",
      "border-radius:16px",
      "padding:20px",
      "margin-bottom:12px",
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "border:1px solid #d4cdc2",
      "cursor:pointer",
      "gap:12px"
    ].join(";");

    card.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div style="font-size:17px;font-weight:600;color:#4a5568;">手机外壳模式</div>
        <div style="font-size:12px;color:#8ba3c7;margin-top:4px;line-height:1.45;">
          打开后，应用会在更小的手机壳里运行，避开刘海、底部白边和边缘误差
        </div>
      </div>
      <div class="phone-frame-switch" id="phoneFrameEnabledSwitch"></div>
    `;

    // 放到“API 悬浮窗”前面或最后都可以；这里直接追加到美化首页末尾
    homeView.appendChild(card);

    entryInjected = true;
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    document.addEventListener("click", async function (e) {
      const card = e.target.closest("#phoneFrameToggleCard");
      if (!card) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const current = await getEnabled();
      const next = !current;

      await setEnabled(next);
      toast(next ? "手机外壳模式已开启" : "手机外壳模式已关闭", "success");
    }, true);
  }

  async function initPhoneFrameToggle() {
    if (booted) return;
    booted = true;

    const ready = await waitForReady();
    if (!ready) {
      console.warn("手机外壳模式初始化失败：DB 或 themeHomeView 未就绪");
      return;
    }

    injectEntry();
    bindEvents();

    const enabled = await getEnabled();
    applyPhoneFrameMode(enabled);
    updateSwitch(enabled);
  }

  function boot() {
    initPhoneFrameToggle().catch(err => {
      console.warn("手机外壳模式初始化失败", err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.phoneFrameToggleModule = {
    init: initPhoneFrameToggle,
    getEnabled,
    setEnabled,
    apply: applyPhoneFrameMode
  };
})();