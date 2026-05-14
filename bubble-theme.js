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

(function initBubbleThemeModule() {
  "use strict";
  console.log("🎨 bubble-theme 模块初始化");

  const STORE_NAME = "bubbleThemes";
  const STYLE_ID_PREFIX = "bubble-theme-style-";
  const PREVIEW_STYLE_ID = "bubble-theme-preview-style";

  /* -----------------------------
   * 工具
   * ----------------------------- */
  function esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s || "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  }

  function toast(msg, type = "info") {
    if (window.showStatus) window.showStatus(msg, type);
    else console.log(`[${type}] ${msg}`);
  }

  async function ensureStore() {
    // 这里不主动升级版本（你主 DB 版本已固定），直接靠 DB.put/getAll 访问即可。
    // 若 store 不存在会报错，故这里用一次探测 + 友好提示。
    try {
      await window.DB.getAll(STORE_NAME);
    } catch (e) {
      console.error("bubbleThemes store 不存在，请按 index 修改指南升级 DB_VERSION 与 onupgradeneeded");
      toast("❌ bubbleThemes 存储未创建，请先按指南修改 index 数据库升级逻辑", "error");
    }
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

  // 简单作用域化：按 { 分块，给每个 selector 前加 scope
  // 支持 @media 块递归处理；@keyframes 不处理 selector 前缀
  function scopeCss(cssText, scopeSelector) {
    if (!cssText || !cssText.trim()) return "";

    function scopeBlock(block) {
      let out = "";
      let i = 0;

      while (i < block.length) {
        const atMedia = block.slice(i).match(/^(\s*@media[^{]+\{)/);
        const atSupports = block.slice(i).match(/^(\s*@supports[^{]+\{)/);
        const atKeyframes = block.slice(i).match(/^(\s*@(-webkit-)?keyframes[^{]+\{)/);

        if (atMedia || atSupports) {
          const m = atMedia || atSupports;
          const start = i + m[1].length;
          let depth = 1, j = start;
          while (j < block.length && depth > 0) {
            if (block[j] === "{") depth++;
            else if (block[j] === "}") depth--;
            j++;
          }
          const inner = block.slice(start, j - 1);
          out += m[1] + scopeBlock(inner) + "}";
          i = j;
          continue;
        }

        if (atKeyframes) {
          const m = atKeyframes;
          const start = i + m[1].length;
          let depth = 1, j = start;
          while (j < block.length && depth > 0) {
            if (block[j] === "{") depth++;
            else if (block[j] === "}") depth--;
            j++;
          }
          out += block.slice(i, j); // keyframes 原样保留
          i = j;
          continue;
        }

        // 普通规则 selector { body }
        const selMatch = block.slice(i).match(/^\s*([^@][^{]+)\{/);
        if (!selMatch) {
          i++;
          continue;
        }

        const rawSelectors = selMatch[1].trim();
        const ruleStart = i + selMatch[0].length;
        let depth = 1, k = ruleStart;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const body = block.slice(ruleStart, k - 1);

        const scopedSelectors = rawSelectors
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => {
            // 已带 :root / html / body 的情况也强制挂到 scope 下
            return `${scopeSelector} ${s}`;
          })
          .join(", ");

        out += `${scopedSelectors}{${body}}`;
        i = k;
      }

      return out;
    }

    return scopeBlock(cssText);
  }

  function buildPreviewMockHtml() {
  return `
<div class="chat-header">
  <div class="chat-header-left">
    <button class="back-btn">←</button>
    <h2 style="font-size:18px;">预览会话</h2>
  </div>
  <div class="header-actions"><button class="header-btn">⋯</button></div>
</div>

<div class="chat-messages" style="height:260px;overflow:auto;">
  <div class="group-system-msg">— 系统消息：今天气氛不错 —</div>

  <div class="message-row other">
    <div class="message-avatar" style="background:#7aa;">A</div>
    <div class="bubble">这是对方文字气泡</div>
  </div>

  <div class="message-row self">
    <div class="bubble">这是我的文字气泡</div>
    <div class="message-avatar" style="background:#c88;">我</div>
  </div>

  <div class="message-row other">
    <div class="message-avatar" style="background:#7aa;">A</div>
    <div class="bubble image-bubble">🖼️<br><span class="image-hint">图片气泡</span></div>
  </div>

  <div class="message-row self">
    <div class="bubble voice-bubble">🎤 语音气泡</div>
    <div class="message-avatar" style="background:#c88;">我</div>
  </div>

  <div class="group-message-row" style="margin-top:10px;">
    <div class="message-avatar" style="background:#5cb85c;">群</div>
    <div class="group-message-content">
      <div class="group-sender-name">群成员</div>
      <div class="group-bubble">群聊文字气泡</div>
    </div>
  </div>
</div>

<div class="chat-input-area">
  <div class="mini-btn">➕</div>
  <div class="input-wrapper"><input type="text" placeholder="输入框预览"></div>
  <div class="mini-btn">⬆️</div>
</div>
`;
}
  /* -----------------------------
   * 数据访问
   * ----------------------------- */
  async function getAllThemes() {
    const list = await window.DB.getAll(STORE_NAME);
    return (list || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  }

  async function putTheme(theme) {
    await window.DB.put(STORE_NAME, theme);
  }

  async function deleteTheme(id) {
    await window.DB.delete(STORE_NAME, id);
  }

  /* -----------------------------
   * 实时应用：单聊/群聊
   * ----------------------------- */
  async function applyBubbleThemeForConversation(convId) {
    const page = document.getElementById("page-conversation");
    if (!page || !convId) return;

    const scope = `conv_${convId}`;
    page.setAttribute("data-bubble-scope", scope);

    const convDetail = await window.DB.get("convDetails", convId);
    const themeId = convDetail?.bubbleThemeId || "";
    const styleId = STYLE_ID_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme || !theme.cssText) {
      removeStyleEl(styleId);
      return;
    }

    const scoped = scopeCss(theme.cssText, `[data-bubble-scope="${scope}"]`);
    getStyleEl(styleId).textContent = scoped;
  }

  async function applyBubbleThemeForGroup(groupId) {
    const page = document.getElementById("page-group-conversation");
    if (!page || !groupId) return;

    const scope = `group_${groupId}`;
    page.setAttribute("data-bubble-scope", scope);

    const group = await window.DB.get("groupChats", groupId);
    const themeId = group?.bubbleThemeId || "";
    const styleId = STYLE_ID_PREFIX + scope;

    if (!themeId) {
      removeStyleEl(styleId);
      return;
    }

    const theme = await window.DB.get(STORE_NAME, themeId);
    if (!theme || !theme.cssText) {
      removeStyleEl(styleId);
      return;
    }

    const scoped = scopeCss(theme.cssText, `[data-bubble-scope="${scope}"]`);
    getStyleEl(styleId).textContent = scoped;
  }

  /* -----------------------------
   * 预览
   * ----------------------------- */
  function initPreview() {
    const root = document.getElementById("bubbleThemePreviewRoot");
    if (!root) return;
    root.setAttribute("data-bubble-scope", "preview");
    root.innerHTML = buildPreviewMockHtml();
  }

  function runPreview() {
    const input = document.getElementById("bubbleCssInput");
    if (!input) return;
    const cssText = input.value || "";
    const scoped = scopeCss(cssText, `[data-bubble-scope="preview"]`);
    getStyleEl(PREVIEW_STYLE_ID).textContent = scoped;
    toast("👀 预览已更新", "success");
  }

  function clearPreview() {
    removeStyleEl(PREVIEW_STYLE_ID);
    toast("↩️ 预览已清除", "info");
  }

  /* -----------------------------
   * 存档区
   * ----------------------------- */
  async function renderArchiveList() {
    const box = document.getElementById("bubbleThemeArchiveList");
    if (!box) return;

    const list = await getAllThemes();
    if (!list.length) {
      box.innerHTML = `<div class="bubble-theme-empty">暂无样式存档</div>`;
      return;
    }

    box.innerHTML = list.map(t => `
      <div class="bubble-theme-row" data-id="${t.id}">
        <div class="bubble-theme-row-main">
          <div class="bubble-theme-row-name">📁 ${esc(t.name)}</div>
          <div class="bubble-theme-row-time">${new Date(t.updatedAt || Date.now()).toLocaleString("zh-CN")}</div>
        </div>
        <div class="bubble-theme-row-actions">
          <button class="small-btn bt-load">载入</button>
          <button class="small-btn bt-edit">重命名</button>
          <button class="small-btn bt-del" style="color:#c0392b;">删除</button>
        </div>
      </div>
    `).join("");

    box.querySelectorAll(".bubble-theme-row").forEach(row => {
      const id = row.getAttribute("data-id");

      row.querySelector(".bt-load")?.addEventListener("click", async () => {
        const theme = await window.DB.get(STORE_NAME, id);
        if (!theme) return;
        const input = document.getElementById("bubbleCssInput");
        if (input) input.value = theme.cssText || "";
        toast("✅ 已载入存档：" + theme.name, "success");
      });

      row.querySelector(".bt-edit")?.addEventListener("click", async () => {
        const theme = await window.DB.get(STORE_NAME, id);
        if (!theme) return;
        const name = prompt("新名称：", theme.name || "");
        if (!name || !name.trim()) return;
        theme.name = name.trim();
        theme.updatedAt = Date.now();
        await putTheme(theme);
        await renderArchiveList();
        await renderMountThemeSelect();
        toast("✅ 已重命名", "success");
      });

      row.querySelector(".bt-del")?.addEventListener("click", async () => {
        if (!confirm("确定删除这个样式存档吗？")) return;
        await deleteTheme(id);

        // 清理已挂载引用（单聊）
        const convDetails = await window.DB.getAll("convDetails");
        for (const d of convDetails) {
          if (d.bubbleThemeId === id) {
            d.bubbleThemeId = "";
            await window.DB.put("convDetails", d);
          }
        }

        // 清理已挂载引用（群聊）
        const groups = await window.DB.getAll("groupChats");
        for (const g of groups) {
          if (g.bubbleThemeId === id) {
            g.bubbleThemeId = "";
            await window.DB.put("groupChats", g);
          }
        }

        await renderArchiveList();
        await renderMountThemeSelect();
        await renderMountTargetList();
        toast("🗑️ 已删除并解除相关挂载", "success");
      });
    });
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
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await putTheme(theme);
    await renderArchiveList();
    await renderMountThemeSelect();
    toast("💾 存档已保存", "success");
  }

  /* -----------------------------
   * 挂载区
   * ----------------------------- */
  async function renderMountThemeSelect() {
    const sel = document.getElementById("bubbleThemeMountSelect");
    if (!sel) return;
    const list = await getAllThemes();

    if (!list.length) {
      sel.innerHTML = `<option value="">暂无存档</option>`;
      return;
    }

    sel.innerHTML = `<option value="">请选择一个样式存档</option>` + list.map(t =>
      `<option value="${t.id}">${esc(t.name)}</option>`
    ).join("");
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
        html += `
          <div class="bubble-theme-target-row">
            <span>💬 ${esc(name)}</span>
            <button class="small-btn bt-mount-conv" data-conv-id="${c.id}">挂载</button>
          </div>
        `;
      }
    }

    html += `<div class="bubble-theme-target-title" style="margin-top:10px;">群聊会话</div>`;
    if (!groups.length) {
      html += `<div class="bubble-theme-empty">暂无群聊</div>`;
    } else {
      groups.forEach(g => {
        html += `
          <div class="bubble-theme-target-row">
            <span>👥 ${esc(g.name || ("群聊#" + g.id))}</span>
            <button class="small-btn bt-mount-group" data-group-id="${g.id}">挂载</button>
          </div>
        `;
      });
    }

    box.innerHTML = html;

    box.querySelectorAll(".bt-mount-conv").forEach(btn => {
      btn.addEventListener("click", async () => {
        const themeId = document.getElementById("bubbleThemeMountSelect")?.value || "";
        if (!themeId) {
          toast("请先在上方选择样式存档", "error");
          return;
        }
        const convId = parseInt(btn.getAttribute("data-conv-id"));
        if (!convId) return;

        let cd = await window.DB.get("convDetails", convId);
        if (!cd) cd = { conversationId: convId, worldbookIds: [] };
        cd.bubbleThemeId = themeId;
        await window.DB.put("convDetails", cd);

        // 若当前正在这个单聊页面，立即生效
        if (window.currentConversationId === convId) {
          await applyBubbleThemeForConversation(convId);
        }
        toast("✅ 已挂载到单聊会话", "success");
      });
    });

    box.querySelectorAll(".bt-mount-group").forEach(btn => {
      btn.addEventListener("click", async () => {
        const themeId = document.getElementById("bubbleThemeMountSelect")?.value || "";
        if (!themeId) {
          toast("请先在上方选择样式存档", "error");
          return;
        }
        const groupId = parseInt(btn.getAttribute("data-group-id"));
        if (!groupId) return;

        const g = await window.DB.get("groupChats", groupId);
        if (!g) return;
        g.bubbleThemeId = themeId;
        await window.DB.put("groupChats", g);

        // 若当前正在这个群聊页面，立即生效
        if (window.currentGroupId === groupId) {
          await applyBubbleThemeForGroup(groupId);
        }
        toast("✅ 已挂载到群聊会话", "success");
      });
    });
  }

  /* -----------------------------
   * 初始化 / 绑定
   * ----------------------------- */
  async function initBubbleThemePanel() {
  await ensureStore();
  initPreview();
  bindPanelEvents();
  await renderArchiveList();
  await renderMountThemeSelect();
  await renderMountTargetList();
}

  function bindPanelEvents() {
    document.getElementById("bubblePreviewBtn")?.addEventListener("click", runPreview);
    document.getElementById("bubbleClearPreviewBtn")?.addEventListener("click", clearPreview);
    document.getElementById("bubbleSaveSnapshotBtn")?.addEventListener("click", saveSnapshot);
  }

  // 暴露给 index/group-chat 调用
  window.bubbleThemeModule = {
    initBubbleThemePanel,
    applyBubbleThemeForConversation,
    applyBubbleThemeForGroup,
    scopeCss
  };

  // 面板按钮绑定（页面加载后）
  bindPanelEvents();
})();