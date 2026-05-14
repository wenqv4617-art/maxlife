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
  console.log("🎨 bubble-theme 模块加载");

  const STORE_NAME = "bubbleThemes";
  const STYLE_PREFIX = "bt-style-";
  const PREVIEW_STYLE_ID = "bt-preview-style";

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

  // ---- 安全作用域：简单可靠版本 ----
  function scopeCss(cssText, scopeSelector) {
    if (!cssText || !cssText.trim()) return "";

    // 去掉注释，降低解析复杂度
    const text = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

    // 按规则块切分（不处理复杂嵌套语法，够用）
    const chunks = text.split("}");
    let out = "";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i].trim();
      if (!chunk) continue;
      const idx = chunk.indexOf("{");
      if (idx === -1) continue;

      const selectorPart = chunk.slice(0, idx).trim();
      const bodyPart = chunk.slice(idx + 1);

      // @ 规则直接保留（避免错误）
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

      '<div class="chat-messages" style="height:260px;overflow:auto;">',
      '  <div class="group-system-msg">— 系统消息：今天气氛不错 —</div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">A</div><div class="bubble">这是对方文字气泡</div></div>',
      '  <div class="message-row self"><div class="bubble">这是我的文字气泡</div><div class="message-avatar" style="background:#c88;">我</div></div>',
      '  <div class="message-row other"><div class="message-avatar" style="background:#7aa;">A</div><div class="bubble image-bubble">🖼️<br><span class="image-hint">图片气泡</span></div></div>',
      '  <div class="message-row self"><div class="bubble voice-bubble">🎤 语音气泡</div><div class="message-avatar" style="background:#c88;">我</div></div>',
      '  <div class="group-message-row" style="margin-top:10px;"><div class="message-avatar" style="background:#5cb85c;">群</div><div class="group-message-content"><div class="group-sender-name">群成员</div><div class="group-bubble">群聊文字气泡</div></div></div>',
      '</div>',

      '<div class="chat-input-area">',
      '  <div class="mini-btn">➕</div>',
      '  <div class="input-wrapper"><input type="text" placeholder="输入框预览"></div>',
      '  <div class="mini-btn">⬆️</div>',
      '</div>'
    ].join("");
  }

  async function getAllThemes() {
    const list = await window.DB.getAll(STORE_NAME);
    return (list || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
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
      return '<div class="bubble-theme-row" data-id="' + t.id + '">' +
        '<div class="bubble-theme-row-main">' +
        '<div class="bubble-theme-row-name">📁 ' + esc(t.name) + '</div>' +
        '<div class="bubble-theme-row-time">' + new Date(t.updatedAt || Date.now()).toLocaleString("zh-CN") + '</div>' +
        '</div>' +
        '<div class="bubble-theme-row-actions">' +
        '<button class="small-btn bt-load">载入</button>' +
        '<button class="small-btn bt-edit">重命名</button>' +
        '<button class="small-btn bt-del" style="color:#c0392b;">删除</button>' +
        '</div></div>';
    }).join("");
  }

  async function renderMountThemeSelect() {
    const sel = document.getElementById("bubbleThemeMountSelect");
    if (!sel) return;
    const list = await getAllThemes();

    if (!list.length) {
      sel.innerHTML = '<option value="">暂无存档</option>';
      return;
    }

    sel.innerHTML =
      '<option value="">请选择一个样式存档</option>' +
      list.map(t => '<option value="' + t.id + '">' + esc(t.name) + '</option>').join("");
  }

  async function renderMountTargetList() {
    const box = document.getElementById("bubbleThemeTargetList");
    if (!box) return;

    const convs = await window.DB.getAll("conversations");
    const groups = await window.DB.getAll("groupChats");

    let html = '<div class="bubble-theme-target-title">单聊会话</div>';
    if (!convs.length) {
      html += '<div class="bubble-theme-empty">暂无单聊</div>';
    } else {
      for (let i = 0; i < convs.length; i++) {
        const c = convs[i];
        const ch = await window.DB.get("characters", c.charId);
        const cd = await window.DB.get("convDetails", c.id);
        const name = (cd && cd.charName) || (ch && ch.name) || ("会话#" + c.id);
        html += '<div class="bubble-theme-target-row">' +
          '<span>💬 ' + esc(name) + '</span>' +
          '<button class="small-btn bt-mount-conv" data-conv-id="' + c.id + '">挂载</button>' +
          '</div>';
      }
    }

    html += '<div class="bubble-theme-target-title" style="margin-top:10px;">群聊会话</div>';
    if (!groups.length) {
      html += '<div class="bubble-theme-empty">暂无群聊</div>';
    } else {
      groups.forEach(g => {
        html += '<div class="bubble-theme-target-row">' +
          '<span>👥 ' + esc(g.name || ("群聊#" + g.id)) + '</span>' +
          '<button class="small-btn bt-mount-group" data-group-id="' + g.id + '">挂载</button>' +
          '</div>';
      });
    }

    box.innerHTML = html;
  }

  function initPreviewBox() {
    const root = document.getElementById("bubbleThemePreviewRoot");
    if (!root) return;
    root.setAttribute("data-bubble-scope", "preview");
    root.innerHTML = buildPreviewHtml();
  }

  function runPreview() {
    const input = document.getElementById("bubbleCssInput");
    if (!input) return;
    const cssText = input.value || "";
    const scoped = scopeCss(cssText, '[data-bubble-scope="preview"]');
    getStyleEl(PREVIEW_STYLE_ID).textContent = scoped;
    toast("👀 预览已更新", "success");
  }

  function clearPreview() {
    removeStyleEl(PREVIEW_STYLE_ID);
    toast("↩️ 预览已清除", "info");
  }

  async function saveSnapshot() {
    const input = document.getElementById("bubbleCssInput");
    const cssText = (input && input.value ? input.value : "").trim();
    if (!cssText) {
      toast("请输入 CSS 后再保存", "error");
      return;
    }
    const name = prompt("请输入存档名称：", "我的气泡样式");
    if (!name || !name.trim()) return;

    const item = {
      id: uid(),
      name: name.trim(),
      cssText: cssText,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await window.DB.put(STORE_NAME, item);
    await renderArchiveList();
    await renderMountThemeSelect();
    toast("💾 存档已保存", "success");
  }

  async function applyBubbleThemeForConversation(convId) {
    const page = document.getElementById("page-conversation");
    if (!page || !convId) return;
    const scope = "conv_" + convId;
    page.setAttribute("data-bubble-scope", scope);

    const cd = await window.DB.get("convDetails", convId);
    const themeId = cd && cd.bubbleThemeId ? cd.bubbleThemeId : "";
    const styleId = STYLE_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme || !theme.cssText) {
      removeStyleEl(styleId);
      return;
    }

    getStyleEl(styleId).textContent = scopeCss(theme.cssText, '[data-bubble-scope="' + scope + '"]');
  }

  async function applyBubbleThemeForGroup(groupId) {
    const page = document.getElementById("page-group-conversation");
    if (!page || !groupId) return;
    const scope = "group_" + groupId;
    page.setAttribute("data-bubble-scope", scope);

    const g = await window.DB.get("groupChats", groupId);
    const themeId = g && g.bubbleThemeId ? g.bubbleThemeId : "";
    const styleId = STYLE_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme || !theme.cssText) {
      removeStyleEl(styleId);
      return;
    }

    getStyleEl(styleId).textContent = scopeCss(theme.cssText, '[data-bubble-scope="' + scope + '"]');
  }

  // 事件委托（防止按钮重绘后丢监听）
  function bindDelegatedEventsOnce() {
    if (window.__btDelegatedBound) return;
    window.__btDelegatedBound = true;

    document.addEventListener("click", async function (e) {
      const t = e.target;

      if (t && t.id === "bubblePreviewBtn") {
        runPreview();
        return;
      }
      if (t && t.id === "bubbleClearPreviewBtn") {
        clearPreview();
        return;
      }
      if (t && t.id === "bubbleSaveSnapshotBtn") {
        await saveSnapshot();
        return;
      }

      const row = t.closest && t.closest(".bubble-theme-row");
      if (row && t.classList.contains("bt-load")) {
        const id = row.getAttribute("data-id");
        const theme = await window.DB.get(STORE_NAME, id);
        const input = document.getElementById("bubbleCssInput");
        if (input) input.value = (theme && theme.cssText) || "";
        toast("✅ 已载入存档", "success");
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
        toast("✅ 已重命名", "success");
        return;
      }
      if (row && t.classList.contains("bt-del")) {
        const id = row.getAttribute("data-id");
        if (!confirm("确定删除这个样式存档吗？")) return;
        await window.DB.delete(STORE_NAME, id);

        // 清理挂载引用：单聊
        const cds = await window.DB.getAll("convDetails");
        for (let i = 0; i < cds.length; i++) {
          const d = cds[i];
          if (d.bubbleThemeId === id) {
            d.bubbleThemeId = "";
            await window.DB.put("convDetails", d);
          }
        }
        // 清理挂载引用：群聊
        const groups = await window.DB.getAll("groupChats");
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          if (g.bubbleThemeId === id) {
            g.bubbleThemeId = "";
            await window.DB.put("groupChats", g);
          }
        }

        await renderArchiveList();
        await renderMountThemeSelect();
        await renderMountTargetList();
        toast("🗑️ 已删除并解除挂载", "success");
        return;
      }

      if (t.classList.contains("bt-mount-conv")) {
        const themeId = (document.getElementById("bubbleThemeMountSelect") || {}).value || "";
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
        const themeId = (document.getElementById("bubbleThemeMountSelect") || {}).value || "";
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
    });
  }

  async function initBubbleThemePanel() {
    await ensureStore();
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