/* ================================================================
 * bubble-theme.js - 对话气泡样式主题系统
 * 功能：
 * 1) CSS 输入 + 预览（模拟对话框）
 * 2) CSS 存档：保存/命名/编辑/删除
 * 3) 挂载：单聊 conversation / 群聊 group 分别挂载
 * 4) 作用域隔离：仅对目标对话页生效，不污染全局
 * 依赖：
 * window.DB, window.escapeHtml, window.showStatus
 * ================================================================ */

(function () {
  "use strict";
  console.log("🎨 bubble-theme 模块加载（icon+css）");

  const STORE_NAME = "bubbleThemes";
  const STYLE_PREFIX = "bt-style-";
  const PREVIEW_STYLE_ID = "bt-preview-style";

  const ICON_SCHEMA = [
    { key: "expandMenuBtn", label: "输入栏➕" },
    { key: "convSendBtn", label: "发送⬆️" },
    { key: "convFetchBtn", label: "AI⬇️" },

    { key: "userImage", label: "展开栏-图片" },
    { key: "userVoice", label: "展开栏-语音" },
    { key: "emoticon", label: "展开栏-表情" },
    { key: "innerVoice", label: "展开栏-心声" },
    { key: "voiceCall", label: "展开栏-通话" },
    { key: "sendDiary", label: "展开栏-日记" },
    { key: "toggleMode", label: "展开栏-见面" },
    { key: "transfer", label: "展开栏-转账" },
    { key: "sendRedPacket", label: "展开栏-发红包" },
    { key: "openSummary", label: "展开栏-总结" },
    { key: "openDetail", label: "展开栏-详情" },
    { key: "checkPhone", label: "展开栏-查手机" },
    { key: "focus", label: "展开栏-专注" }
  ];

  const DEFAULT_ICON_MAP = {
    expandMenuBtn: { type: "text", value: "➕" },
    convSendBtn: { type: "text", value: "⬆️" },
    convFetchBtn: { type: "text", value: "⬇️" },

    userImage: { type: "text", value: "🖼️" },
    userVoice: { type: "text", value: "🎤" },
    emoticon: { type: "text", value: "😊" },
    innerVoice: { type: "text", value: "💭" },
    voiceCall: { type: "text", value: "📞" },
    sendDiary: { type: "text", value: "📔" },
    toggleMode: { type: "text", value: "🔄" },
    transfer: { type: "text", value: "💸" },
    sendRedPacket: { type: "text", value: "🧧" },
    openSummary: { type: "text", value: "📋" },
    openDetail: { type: "text", value: "📝" },
    checkPhone: { type: "text", value: "📱" },
    focus: { type: "text", value: "🧘" }
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

  function scopeCss(cssText, scopeSelector) {
    if (!cssText || !cssText.trim()) return "";
    const text = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
    const chunks = text.split("}");
    let out = "";
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (!chunk) continue;
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
        .map(s => scopeSelector + " " + s)
        .join(", ");
      out += scopedSel + "{" + bodyPart + "}";
    }
    return out;
  }

  function buildPreviewHtml() {
    return [
      '<div class="chat-header">',
      '  <div class="chat-header-left"><button class="back-btn">←</button><h2 style="font-size:18px;">预览会话</h2></div>',
      '  <div class="header-actions"><button class="header-btn">⋯</button></div>',
      '</div>',

      '<div class="expand-menu active" id="previewExpandMenu" style="display:flex;">',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="userImage">🖼️</span><span class="expand-menu-label">图片</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="userVoice">🎤</span><span class="expand-menu-label">语音</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="emoticon">😊</span><span class="expand-menu-label">表情</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="innerVoice">💭</span><span class="expand-menu-label">心声</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="voiceCall">📞</span><span class="expand-menu-label">通话</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="sendDiary">📔</span><span class="expand-menu-label">日记</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="toggleMode">🔄</span><span class="expand-menu-label">见面</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="transfer">💸</span><span class="expand-menu-label">转账</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="sendRedPacket">🧧</span><span class="expand-menu-label">发红包</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="openSummary">📋</span><span class="expand-menu-label">总结</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="openDetail">📝</span><span class="expand-menu-label">详情</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="checkPhone">📱</span><span class="expand-menu-label">查手机</span></div>',
      '  <div class="expand-menu-item"><span class="expand-menu-icon" data-icon-key="focus">🧘</span><span class="expand-menu-label">专注</span></div>',
      '</div>',

      '<div class="chat-messages" style="height:220px;overflow:auto;">',
      '  <div class="group-system-msg">— 系统消息：今天气氛不错 —</div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">A</div><div class="bubble">这是对方文字气泡</div></div>',
      '  <div class="message-row self"><div class="bubble">这是我的文字气泡</div><div class="message-avatar" style="background:#c88;">我</div></div>',
      '</div>',

      '<div class="chat-input-area">',
      '  <div class="mini-btn"><span data-icon-key="expandMenuBtn">➕</span></div>',
      '  <div class="input-wrapper"><input type="text" placeholder="输入框预览"></div>',
      '  <div class="mini-btn"><span data-icon-key="convSendBtn">⬆️</span></div>',
      '  <div class="mini-btn"><span data-icon-key="convFetchBtn">⬇️</span></div>',
      '</div>'
    ].join("");
  }

  function setIconNode(el, iconDef) {
    if (!el || !iconDef) return;
    const value = iconDef.value || "";
    const isImg = iconDef.type === "image" || isImageValue(value);

    if (isImg) {
      el.innerHTML = `<img src="${value}" style="width:1em;height:1em;object-fit:contain;vertical-align:middle;" alt="">`;
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
    // 输入栏3个
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

    // 展开栏
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
        focus: "focus"
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

    // 群展开栏 action 名称不同
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

  async function getAllThemes() {
    const list = await window.DB.getAll(STORE_NAME);
    return (list || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

  async function renderArchiveList() {
    const box = document.getElementById("bubbleThemeArchiveList");
    if (!box) return;
    const list = await getAllThemes();

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
    const list = await getAllThemes();

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
      const preview = (def.type === "image" || isImageValue(def.value))
        ? `<img src="${esc(def.value)}" style="width:20px;height:20px;object-fit:contain;">`
        : `<span>${esc(def.value)}</span>`;

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

  function bindDelegatedEventsOnce() {
    if (window.__btDelegatedBound) return;
    window.__btDelegatedBound = true;

    document.addEventListener("click", async (e) => {
      const t = e.target;

      if (t.id === "bubblePreviewBtn") return runPreview();
      if (t.id === "bubbleClearPreviewBtn") return clearPreview();
      if (t.id === "bubbleSaveSnapshotBtn") return saveSnapshot();

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

  bindDelegatedEventsOnce();
})();
