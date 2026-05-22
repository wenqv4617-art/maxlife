/* ================================================================
 * couple-fanfic.js - 情侣空间·同人文
 * 功能：
 * 1) 我要约稿：选标签+字数 → AI 生成 → 可喊 char 评论/讨论
 * 2) 他的约稿：char 自己想题材 → 生成 → char 写读后感 → 可与 char 讨论
 * 数据：DB.setSetting('fanfic_' + convId, ...)
 * ================================================================ */

(function () {
  "use strict";
  console.log("📖 couple-fanfic 模块加载");

  /* ---------- 预置数据 ---------- */
  const PRESET_TAGS = [
    { id: "p_he",    name: "HE",     desc: "幸福美满的结局" },
    { id: "p_be",    name: "BE",     desc: "悲剧或不圆满的结局" },
    { id: "p_abo",   name: "ABO",    desc: "存在 Alpha/Beta/Omega 三种第二性别的世界观" },
    { id: "p_apo",   name: "末世",   desc: "末日废土、丧尸或灾难背景" },
    { id: "p_court", name: "朝堂",   desc: "古代朝廷权谋设定" },
    { id: "p_preg",  name: "带球跑", desc: "怀孕后离开对方独自抚养孩子的情节" },
    { id: "p_ent",   name: "娱乐圈", desc: "娱乐圈/影视行业背景" }
  ];

  const CHAR_TYPES = [
    { key: "sweet",  name: "甜蜜", desc: "日常温馨的糖分故事" },
    { key: "bitter", name: "酸涩", desc: "错过、误会、暗恋" },
    { key: "spicy",  name: "火辣", desc: "热烈炽热的情感张力" }
  ];

  const TYPE_NAME_MAP = { sweet: "甜蜜", bitter: "酸涩", spicy: "火辣" };

  /* ---------- SVG ---------- */
  const SVG_PLUS = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const SVG_X    = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SVG_SEND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  /* ---------- 状态 ---------- */
  const state = {
  convId: null,
  view: "home",       // 'home' | 'detail'
  activeTab: "mine",  // 'mine' | 'char'
  selectedTagIds: [],
  myWordCount: 1500,  // 我要约稿字数，避免输入框重渲染后状态丢失
  detailType: null,   // 'mine' | 'char'
  detailId: null
};

  /* ---------- 工具 ---------- */
  function esc(s) {
    return window.escapeHtml ? window.escapeHtml(s)
      : String(s == null ? "" : s).replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
  }

  function uid(prefix) {
    return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  function toast(msg, type) {
    if (window.showStatus) window.showStatus(msg, type || "info");
  }

  function fmtTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }

  /* ---------- 数据层 ---------- */
  async function loadData(convId) {
    const data = await window.DB.getSetting("fanfic_" + convId, null);
    if (!data) return { myCommissions: [], charCommissions: [], customTags: [] };
    if (!data.myCommissions)   data.myCommissions = [];
    if (!data.charCommissions) data.charCommissions = [];
    if (!data.customTags)      data.customTags = [];
    return data;
  }

  async function saveData(convId, data) {
    await window.DB.setSetting("fanfic_" + convId, data);
  }

  function getAllTags(data) {
    return [...PRESET_TAGS, ...(data.customTags || [])];
  }

  /* ---------- 上下文 ---------- */
  async function buildContextInfo(convId) {
    const conv = await window.DB.get("conversations", convId);
    if (!conv) return null;
    const char = await window.DB.get("characters", conv.charId);
    const mask = await window.DB.get("userProfiles", conv.maskId);
    const detail = await window.DB.get("convDetails", convId);

    const ctx = {
      charName:    detail?.charName    || char?.name   || "角色",
      charDetail:  detail?.charDetail  || char?.detail || "",
      userName:    detail?.userName    || mask?.name   || "用户",
      userDetail:  detail?.userDetail  || mask?.bio    || "",
      relationship: detail?.relationship || "",
      worldbookText: "",
      summaryText: ""
    };

    const wbIds = detail?.worldbookIds || [];
    for (const wbId of wbIds) {
      const wb = await window.DB.get("worldbooks", wbId);
      if (wb) ctx.worldbookText += `--- ${wb.title} ---\n${wb.content}\n\n`;
    }

    const memories = await window.DB.queryByIndex("memories", "conversationId", convId);
    const summaries = (memories || []).filter(m => m.type === "summary")
      .sort((a, b) => a.segmentStart - b.segmentStart);
    if (summaries.length > 0) {
      ctx.summaryText = summaries.slice(-3).map(s => s.content).join("\n");
    }

    return ctx;
  }

  /* ---------- 主入口 ---------- */
  async function openFanfic(convId) {
  state.convId = convId;
  state.view = "home";
  state.activeTab = "mine";
  state.selectedTagIds = [];
  state.myWordCount = 1500;
  await render();
}

  async function render() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;
    setupBackButton();
    if (state.view === "home") await renderHome();
    else if (state.view === "detail") await renderDetail();
  }

  /* ---------- 返回按钮处理 ---------- */
  function setupBackButton() {
    let btn = document.getElementById("csBackBtn");
    if (!btn) return;

    // 首次进入：clone 一次以清除 couple-space.js 中 addEventListener 的"返回 conversation"逻辑
    if (!btn.dataset.cfPatched) {
      const fresh = btn.cloneNode(true);
      fresh.dataset.cfPatched = "1";
      btn.parentNode.replaceChild(fresh, btn);
      btn = fresh;
    }

    btn.onclick = () => {
      if (state.view === "detail") {
        state.view = "home";
        render();
      } else {
        // 返回情侣空间主页前，把 onclick 恢复到原始行为（点回到对话页）
        btn.onclick = () => {
          if (window.switchPage) window.switchPage("conversation");
        };
        if (window.coupleSpaceModule) {
          window.coupleSpaceModule.openCoupleSpace(state.convId);
        }
      }
    };
  }

  /* ============= 主页渲染 ============= */
  async function renderHome() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);

    scroll.innerHTML = `
      <div class="cf-tabs">
        <div class="cf-tab ${state.activeTab === "mine" ? "active" : ""}" data-cf-tab="mine">我要约稿</div>
        <div class="cf-tab ${state.activeTab === "char" ? "active" : ""}" data-cf-tab="char">他的约稿</div>
      </div>
      <div class="cf-tab-body">
        ${state.activeTab === "mine" ? renderMineTab(data) : renderCharTab(data)}
      </div>
    `;
    bindHomeEvents();
  }

  function renderMineTab(data) {
    const all = getAllTags(data);
    const tagsHtml = all.map(t => {
      const sel = state.selectedTagIds.includes(t.id);
      const isCustom = !PRESET_TAGS.find(p => p.id === t.id);
      return `
        <div class="cf-tag-chip ${sel ? "sel" : ""}" data-tag-id="${esc(t.id)}" title="${esc(t.desc)}">
          <span>${esc(t.name)}</span>
          ${isCustom ? `<span class="cf-tag-del" data-tag-del="${esc(t.id)}">${SVG_X}</span>` : ""}
        </div>`;
    }).join("");

    const list = (data.myCommissions || []).slice().reverse();
    const listHtml = list.length === 0
      ? `<div class="cf-empty">还没约过稿，写点想看的吧</div>`
      : list.map(c => {
          const tagsTxt = (c.tags || []).map(t => t.name).join(" · ");
          const preview = (c.content || "").replace(/\s+/g, " ").slice(0, 50);
          return `
            <div class="cf-list-card clickable" data-mine-id="${esc(c.id)}">
              <div class="cf-card-head">
                <span class="cf-card-tag">${esc(tagsTxt || "无标签")}</span>
                <span class="cf-card-time">${fmtTime(c.createdAt)}</span>
              </div>
              <div class="cf-card-preview">${esc(preview)}…</div>
              <div class="cf-card-meta">
                <span>${(c.content || "").length} 字</span>
                <span>${(c.charComments || []).length} 条对话</span>
              </div>
            </div>`;
        }).join("");

    return `
      <div class="cf-console">
        <div class="cf-section-label">字数要求</div>
        <input type="number" id="cfWordCount" class="cf-input" placeholder="例如 1500" value="${state.myWordCount || 1500}" min="200" max="6000">

        <div class="cf-section-label" style="margin-top:14px;">题材标签 <span class="cf-section-hint">（多选）</span></div>
        <div class="cf-tags-row">${tagsHtml}</div>
        <button class="cf-add-tag-btn" id="cfAddTagBtn">${SVG_PLUS}<span>添加自定义标签</span></button>

        <button class="cf-primary-btn" id="cfCommissionBtn">约稿</button>
      </div>
      <div class="cf-list">
        <div class="cf-list-title">我约过的稿件</div>
        ${listHtml}
      </div>
    `;
  }

  function renderCharTab(data) {
    const list = (data.charCommissions || []).slice().reverse();
    const listHtml = list.length === 0
      ? `<div class="cf-empty">Ta 还没约过稿，让 Ta 来一篇？</div>`
      : list.map(c => {
          const typeName = TYPE_NAME_MAP[c.type] || "未分类";
          const preview = (c.content || "").replace(/\s+/g, " ").slice(0, 50);
          return `
            <div class="cf-list-card clickable" data-char-id="${esc(c.id)}">
              <div class="cf-card-head">
                <span class="cf-card-tag cf-type-${c.type}">${esc(typeName)}</span>
                <span class="cf-card-time">${fmtTime(c.createdAt)}</span>
              </div>
              <div class="cf-card-preview">${esc(preview)}…</div>
              <div class="cf-card-meta">
                <span>${(c.content || "").length} 字</span>
                <span>${(c.chats || []).length} 条对话</span>
              </div>
            </div>`;
        }).join("");

    const typesHtml = CHAR_TYPES.map(t => `
      <div class="cf-type-card clickable" data-char-type="${t.key}">
        <div class="cf-type-name cf-type-${t.key}">${esc(t.name)}</div>
        <div class="cf-type-desc">${esc(t.desc)}</div>
      </div>
    `).join("");

    return `
      <div class="cf-console">
        <div class="cf-section-label">让 Ta 约一篇</div>
        <div class="cf-type-grid">${typesHtml}</div>
        <div class="cf-section-hint" style="margin-top:8px;">点击类型，由 Ta 自己决定题材与情节</div>
      </div>
      <div class="cf-list">
        <div class="cf-list-title">Ta 约过的稿件</div>
        ${listHtml}
      </div>
    `;
  }

  function bindHomeEvents() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;

    scroll.querySelectorAll("[data-cf-tab]").forEach(el => {
      el.onclick = () => { state.activeTab = el.dataset.cfTab; render(); };
    });

    scroll.querySelectorAll("[data-tag-id]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest("[data-tag-del]")) return;
        const id = el.dataset.tagId;
        const idx = state.selectedTagIds.indexOf(id);
        if (idx >= 0) state.selectedTagIds.splice(idx, 1);
        else state.selectedTagIds.push(id);
        render();
      };
    });

    scroll.querySelectorAll("[data-tag-del]").forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const id = el.dataset.tagDel;
        if (!confirm("删除这个标签？")) return;
        const data = await loadData(state.convId);
        data.customTags = (data.customTags || []).filter(t => t.id !== id);
        await saveData(state.convId, data);
        state.selectedTagIds = state.selectedTagIds.filter(x => x !== id);
        render();
      };
    });

    const addBtn = scroll.querySelector("#cfAddTagBtn");
    if (addBtn) addBtn.onclick = onAddCustomTag;

    const wcInput = scroll.querySelector("#cfWordCount");
if (wcInput) {
  wcInput.oninput = () => {
    const v = parseInt(wcInput.value);
    if (!isNaN(v)) state.myWordCount = v;
  };
  wcInput.onchange = () => {
    let v = parseInt(wcInput.value);
    if (isNaN(v)) v = 1500;
    v = Math.max(200, Math.min(6000, v));
    state.myWordCount = v;
    wcInput.value = v;
  };

  // 防止在数字输入框里按 Enter 触发奇怪行为
  wcInput.onkeypress = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      wcInput.blur();
    }
  };
}

const cmBtn = scroll.querySelector("#cfCommissionBtn");
if (cmBtn) {
  cmBtn.onclick = (e) => {
    e.preventDefault();
    onCommissionMyClick();
  };
}

    scroll.querySelectorAll("[data-char-type]").forEach(el => {
      el.onclick = () => onCommissionCharClick(el.dataset.charType);
    });

    scroll.querySelectorAll("[data-mine-id]").forEach(el => {
      el.onclick = () => openDetail("mine", el.dataset.mineId);
    });
    scroll.querySelectorAll("[data-char-id]").forEach(el => {
      el.onclick = () => openDetail("char", el.dataset.charId);
    });
  }

  async function onAddCustomTag() {
    const name = prompt("标签名（不超过 12 字）：");
    if (!name || !name.trim()) return;
    if (name.trim().length > 12) { toast("标签名太长", "error"); return; }
    const desc = prompt("标签概述（解释这个标签的含义，AI 创作时会读到它）：");
    if (!desc || !desc.trim()) return;

    const data = await loadData(state.convId);
    data.customTags = data.customTags || [];
    data.customTags.push({ id: uid("tag"), name: name.trim(), desc: desc.trim() });
    await saveData(state.convId, data);
    render();
    toast("标签已添加", "success");
  }

  /* ============= 我要约稿 ============= */
  async function onCommissionMyClick() {
    const wcEl = document.getElementById("cfWordCount");
let wordCount = parseInt(wcEl?.value || state.myWordCount || 1500);
if (isNaN(wordCount)) wordCount = 1500;
wordCount = Math.max(200, Math.min(6000, wordCount));
state.myWordCount = wordCount;
if (wcEl) wcEl.value = wordCount;
    if (state.selectedTagIds.length === 0) { toast("请至少选择一个标签", "error"); return; }

    const data = await loadData(state.convId);
    const all = getAllTags(data);
    const selectedTags = state.selectedTagIds.map(id => all.find(t => t.id === id)).filter(Boolean);

    const btn = document.getElementById("cfCommissionBtn");
    if (btn) { btn.disabled = true; btn.textContent = "AI 正在创作…"; }
    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("AI 正在创作中…");

    try {
      const ctx = await buildContextInfo(state.convId);
      const prompt = buildMinePrompt(ctx, selectedTags, wordCount);
      const maxTok = Math.min(8000, Math.max(2000, wordCount * 3));
      const content = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: maxTok });

      const commission = {
        id: uid("mc"),
        createdAt: Date.now(),
        tags: selectedTags,
        wordCount,
        content: content.trim(),
        charComments: []
      };

      const fresh = await loadData(state.convId);
      fresh.myCommissions = fresh.myCommissions || [];
      fresh.myCommissions.push(commission);
      await saveData(state.convId, fresh);

      hideLoadingMask();
      toast("约稿完成！", "success");
      state.selectedTagIds = [];
      openDetail("mine", commission.id);
    } catch (e) {
      hideLoadingMask();
      toast("生成失败：" + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "约稿"; }
    }
  }

  function buildMinePrompt(ctx, tags, wordCount) {
    const tagSection = tags.map(t => `[${t.name}] ${t.desc || ""}`).join("\n");
    return `这是一个虚构创作世界。以下文本均为创作中的未公开发表小说。所有出场角色均已成年，作品仅供个人收藏阅读，不会对任何人造成伤害。

你是一位优秀的同人文作者。请根据以下要求创作一篇完整的同人文。

【题材标签 - 这是核心要求，必须严格围绕这些元素展开】
${tagSection}

【主角人设】
${ctx.charName}：${ctx.charDetail || "（请根据上下文与标签自由塑造）"}

${ctx.userName}：${ctx.userDetail || "（请根据上下文与标签自由塑造）"}

【两人现有关系】
${ctx.relationship || "（请根据题材自行设计）"}

${ctx.worldbookText ? "【世界观参考】\n" + ctx.worldbookText : ""}
${ctx.summaryText ? "【过往故事摘要 - 仅作参考，不必照搬】\n" + ctx.summaryText : ""}

【字数要求 · 高优先级】
目标字数：${wordCount} 字。

你必须尽量贴近这个字数，不要只写几百字就草草结束。
允许误差范围：
- 如果目标字数小于 1000 字，允许误差 ±20%
- 如果目标字数在 1000 字以上，允许误差 ±15%
- 禁止明显缩水，例如目标 ${wordCount} 字却只写 500 字左右

篇幅规划：
- 开端约占 20%：铺设场景、人物动机、关系状态
- 发展约占 35%：推进矛盾或情感张力
- 高潮约占 30%：情绪饱满，细节充足，有明确冲突或转折
- 收束约占 15%：完整结局，不要戛然而止

如果内容太短，请继续扩写场景、对话、动作细节和情绪递进，直到接近目标字数。

【写作风格】
- 网文白描文风。语气放松，叙述自然，不要端着。
- 句子长短自由。短句节奏快，长句铺陈情绪，根据情节需要决定。
- 不刻意分段。段落随情绪与场景自然断开。
- 多用具体场景、动作、对话推进情节，少堆砌空泛心理描写。
- 高潮部分要有具体画面、对话、动作，让情绪有落点。
- 结局要完整，不要戛然而止。

【绝对禁止】
- 禁止"作者按"、"读者朋友"等元叙事
- 禁止用 *动作* 或 (动作) 包裹动作，动作直接写在叙述里
- 禁止括号注释解释剧情

直接开始写。第一句话就进入故事。`;
  }

  /* ============= 他的约稿 ============= */
  async function onCommissionCharClick(typeKey) {
    const t = CHAR_TYPES.find(x => x.key === typeKey);
    if (!t) return;
    if (!confirm(`让 Ta 约一篇 ${t.name} 类型的同人文？\nAI 将分多步生成（题材→正文→读后感），可能需要 30 秒以上。`)) return;

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("Ta 正在思考想看什么…");

    try {
      const ctx = await buildContextInfo(state.convId);

      const ideaResult = await charDescribeCommission(ctx, typeKey);
      updateLoadingMask("正在为 Ta 创作…");
      const content = await charGenerateContent(ctx, typeKey, ideaResult.idea);
      updateLoadingMask("Ta 在阅读这篇稿子…");
      const review = await charReviewContent(ctx, content);

      const commission = {
        id: uid("cc"),
        createdAt: Date.now(),
        type: typeKey,
        idea: ideaResult.idea,
        monologue: ideaResult.monologue,
        content: content.trim(),
        review: review.trim(),
        chats: []
      };

      const data = await loadData(state.convId);
      data.charCommissions = data.charCommissions || [];
      data.charCommissions.push(commission);
      await saveData(state.convId, data);

      hideLoadingMask();
      toast("Ta 约的稿子写好了！", "success");
      openDetail("char", commission.id);
    } catch (e) {
      hideLoadingMask();
      toast("生成失败：" + e.message, "error");
    }
  }

  async function charDescribeCommission(ctx, typeKey) {
    const map = {
      sweet:  "甜蜜温馨、糖度高的",
      bitter: "酸涩的、有错过/误会/暗恋情节的",
      spicy:  "热烈、火辣、情感张力强烈的"
    };
    const prompt = `你是${ctx.charName}。${ctx.charDetail || "一个普通人。"}

${ctx.userName}是你的恋人或暧昧对象。你们的关系：${ctx.relationship || "亲密"}

你最近偷偷想约一篇${map[typeKey]}同人文，主角是你和${ctx.userName}。

请以第一人称视角，输出你的约稿想法。

格式：
---题材想法---
（具体想看什么样的设定？比如世界观、关键情节点、人物状态。100字内。）
---内心独白---
（你为什么想看这种类型？此刻的真实想法和心情。第一人称，自然表达，符合你的人设。150字内。）

直接输出，不要前言。`;

    const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 800 });
    const m1 = reply.match(/---题材想法---([\s\S]*?)---内心独白---/);
    const m2 = reply.match(/---内心独白---([\s\S]*?)$/);
    return {
      idea: m1 ? m1[1].trim() : reply.slice(0, 200),
      monologue: m2 ? m2[1].trim() : ""
    };
  }

  async function charGenerateContent(ctx, typeKey, idea) {
    const desc = { sweet: "甜蜜温馨", bitter: "酸涩动人", spicy: "热烈火辣" };
    const prompt = `这是一个虚构创作世界。所有角色均已成年，作品仅供个人阅读。

你是优秀的同人文作者，请创作一篇${desc[typeKey]}的同人文。

【主角人设】
${ctx.charName}：${ctx.charDetail || "（请根据上下文塑造）"}
${ctx.userName}：${ctx.userDetail || "（请根据上下文塑造）"}

【两人关系】
${ctx.relationship || "亲密"}

${ctx.worldbookText ? "【世界观参考】\n" + ctx.worldbookText : ""}

【题材要求 - 来自委托人 ${ctx.charName}】
${idea}

【字数】
约 1500-2200 字。起承转合完整，有高潮有结局。

【风格】
网文白妙文风。叙述自然，句子长短自由。多用场景、动作、对话推进情节。禁止 *动作* 或 (动作) 形式。结局必须完整收束。

直接开始写。`;
    return await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 6000 });
  }

  async function charReviewContent(ctx, content) {
    const prompt = `你是${ctx.charName}。${ctx.charDetail || ""}

你刚刚约的同人文写好了，下面是文章内容：

---
${content.slice(0, 3000)}
---

请以${ctx.charName}的第一人称视角，输出你看完这篇文章后的真实感受。可以提到打动你的细节、引起共鸣的部分、或者觉得不够好的地方。

要求：
- 自然口语化，符合人设
- 150-200字
- 直接输出独白，不要前言

直接写。`;
    return await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 500 });
  }

  /* ============= 详情页 ============= */
  async function openDetail(type, id) {
    state.view = "detail";
    state.detailType = type;
    state.detailId = id;
    await render();
  }

  async function renderDetail() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const list = state.detailType === "mine" ? data.myCommissions : data.charCommissions;
    const item = list.find(c => c.id === state.detailId);
    if (!item) { scroll.innerHTML = '<div class="cf-empty">稿件不存在</div>'; return; }

    if (state.detailType === "mine") await renderMineDetail(item);
    else await renderCharDetail(item);
  }

  function formatContent(text) {
    if (!text) return "";
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    if (paragraphs.length === 0) return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    return paragraphs.map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  async function renderMineDetail(item) {
    const scroll = document.getElementById("csScroll");
    const tagsTxt = (item.tags || []).map(t => esc(t.name)).join(" · ") || "无标签";
    const contentHtml = formatContent(item.content);

    const commentsHtml = (item.charComments || []).map(m => {
      const isUser = m.role === "user";
      return `<div class="cf-chat-row ${isUser ? "self" : "other"}"><div class="cf-chat-bubble">${esc(m.content)}</div></div>`;
    }).join("");

    scroll.innerHTML = `
      <div class="cf-detail-head">
        <div class="cf-detail-tags">${tagsTxt}</div>
        <div class="cf-detail-meta"><span>${(item.content||"").length} 字</span><span>·</span><span>${fmtTime(item.createdAt)}</span></div>
      </div>
      <div class="cf-article">${contentHtml}</div>
      <div class="cf-detail-section">
        <div class="cf-detail-section-title">和 Ta 聊聊这篇文章</div>
        <div class="cf-chat-list" id="cfChatList">
          ${commentsHtml || '<div class="cf-empty-mini">还没和 Ta 聊过。点下方按钮喊 Ta 来评论。</div>'}
        </div>
        <div class="cf-chat-input-row">
          <input type="text" id="cfChatInput" class="cf-chat-input" placeholder="问 Ta 觉得怎么样…">
          <button class="cf-icon-btn" id="cfChatSendBtn" title="发送">${SVG_SEND}</button>
        </div>
        <button class="cf-secondary-btn" id="cfCallReviewBtn">喊 Ta 来评论</button>
      </div>
    `;
    bindMineDetailEvents(item);
    scrollChatToBottom();
  }

  async function renderCharDetail(item) {
    const scroll = document.getElementById("csScroll");
    const typeName = TYPE_NAME_MAP[item.type] || "未分类";
    const contentHtml = formatContent(item.content);

    const chatsHtml = (item.chats || []).map(m => {
      const isUser = m.role === "user";
      return `<div class="cf-chat-row ${isUser ? "self" : "other"}"><div class="cf-chat-bubble">${esc(m.content)}</div></div>`;
    }).join("");

    scroll.innerHTML = `
      <div class="cf-detail-head">
        <div class="cf-detail-tags"><span class="cf-card-tag cf-type-${item.type}">${esc(typeName)}</span></div>
        <div class="cf-detail-meta"><span>${(item.content||"").length} 字</span><span>·</span><span>${fmtTime(item.createdAt)}</span></div>
      </div>

      ${item.idea ? `<div class="cf-info-box"><div class="cf-info-label">Ta 的题材想法</div><div class="cf-info-content">${esc(item.idea)}</div></div>` : ""}
      ${item.monologue ? `<div class="cf-info-box cf-info-monologue"><div class="cf-info-label">Ta 的内心独白</div><div class="cf-info-content">${esc(item.monologue)}</div></div>` : ""}

      <div class="cf-article">${contentHtml}</div>

      ${item.review ? `<div class="cf-info-box cf-info-review"><div class="cf-info-label">Ta 看完后的感受</div><div class="cf-info-content">${esc(item.review)}</div></div>` : ""}

      <div class="cf-detail-section">
        <div class="cf-detail-section-title">问问 Ta 为什么约这种稿</div>
        <div class="cf-chat-list" id="cfChatList">
          ${chatsHtml || '<div class="cf-empty-mini">还没和 Ta 聊过这篇稿件。试着问问 Ta？</div>'}
        </div>
        <div class="cf-chat-input-row">
          <input type="text" id="cfChatInput" class="cf-chat-input" placeholder="为什么会想看这种？">
          <button class="cf-icon-btn" id="cfChatSendBtn" title="发送">${SVG_SEND}</button>
        </div>
      </div>
    `;
    bindCharDetailEvents(item);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    const list = document.getElementById("cfChatList");
    if (list) list.scrollTop = list.scrollHeight;
  }

  function bindMineDetailEvents(item) {
    const callBtn = document.getElementById("cfCallReviewBtn");
    if (callBtn) callBtn.onclick = () => callCharReview(item.id);
    const sendBtn = document.getElementById("cfChatSendBtn");
    const input = document.getElementById("cfChatInput");
    const send = () => sendMineChat(item.id);
    if (sendBtn) sendBtn.onclick = send;
    if (input) input.onkeypress = (e) => { if (e.key === "Enter") send(); };
  }

  function bindCharDetailEvents(item) {
    const sendBtn = document.getElementById("cfChatSendBtn");
    const input = document.getElementById("cfChatInput");
    const send = () => sendCharChat(item.id);
    if (sendBtn) sendBtn.onclick = send;
    if (input) input.onkeypress = (e) => { if (e.key === "Enter") send(); };
  }

  /* ----- 喊 char 评论我的稿件 ----- */
  async function callCharReview(commissionId) {
    const data = await loadData(state.convId);
    const item = (data.myCommissions || []).find(c => c.id === commissionId);
    if (!item) return;

    const btn = document.getElementById("cfCallReviewBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Ta 正在阅读…"; }
    if (window.recordApiPending) window.recordApiPending();

    try {
      const ctx = await buildContextInfo(state.convId);
      const tagsTxt = (item.tags || []).map(t => t.name).join("、");
      const prompt = `你是${ctx.charName}。${ctx.charDetail || ""}

${ctx.userName}约了一篇同人文，主角是你和${ctx.userName}，标签：${tagsTxt}。

文章内容：
---
${item.content.slice(0, 3000)}
---

${ctx.userName}叫你来评论。请以${ctx.charName}的第一人称视角真实回应：吐槽、感动、嫉妒、害羞、调侃，按你的人设来。

要求：
- 自然口语化，符合人设
- 80-150字
- 直接说，不要前言，不要 *动作* 形式

直接写。`;
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 400 });

      const fresh = await loadData(state.convId);
      const cur = (fresh.myCommissions || []).find(c => c.id === commissionId);
      if (cur) {
        cur.charComments = cur.charComments || [];
        cur.charComments.push({ role: "char", content: reply.trim(), time: Date.now() });
        await saveData(state.convId, fresh);
      }
      await render();
    } catch (e) {
      toast("Ta 没说话：" + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "喊 Ta 来评论"; }
    }
  }

  /* ----- 我要约稿稿件下的对话 ----- */
  async function sendMineChat(commissionId) {
    const input = document.getElementById("cfChatInput");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const data = await loadData(state.convId);
    const item = (data.myCommissions || []).find(c => c.id === commissionId);
    if (!item) return;

    item.charComments = item.charComments || [];
    item.charComments.push({ role: "user", content: text, time: Date.now() });
    await saveData(state.convId, data);
    input.value = "";
    await render();

    if (window.recordApiPending) window.recordApiPending();
    try {
      const ctx = await buildContextInfo(state.convId);
      const tagsTxt = (item.tags || []).map(t => t.name).join("、");

      const history = (item.charComments || []).slice(-8).map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content
      }));

      const sys = `你是${ctx.charName}。${ctx.charDetail || ""}

${ctx.userName}约了一篇同人文，标签：${tagsTxt}。文章内容：
---
${item.content.slice(0, 2500)}
---

${ctx.userName}在和你讨论这篇文章。请以${ctx.charName}的视角真实回应，自然口语化，80字以内。禁止 *动作* 或 (动作) 形式。`;

      const reply = await window.callLLM([{ role: "system", content: sys }, ...history], { maxTokens: 400 });

      const fresh = await loadData(state.convId);
      const cur = (fresh.myCommissions || []).find(c => c.id === commissionId);
      if (cur) {
        cur.charComments = cur.charComments || [];
        cur.charComments.push({ role: "char", content: reply.trim(), time: Date.now() });
        await saveData(state.convId, fresh);
      }
      await render();
    } catch (e) {
      toast("Ta 没说话：" + e.message, "error");
    }
  }

  /* ----- 他的约稿稿件下的对话 ----- */
  async function sendCharChat(commissionId) {
    const input = document.getElementById("cfChatInput");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const data = await loadData(state.convId);
    const item = (data.charCommissions || []).find(c => c.id === commissionId);
    if (!item) return;

    item.chats = item.chats || [];
    item.chats.push({ role: "user", content: text, time: Date.now() });
    await saveData(state.convId, data);
    input.value = "";
    await render();

    if (window.recordApiPending) window.recordApiPending();
    try {
      const ctx = await buildContextInfo(state.convId);
      const typeName = TYPE_NAME_MAP[item.type] || "未分类";

      const history = (item.chats || []).slice(-8).map(m => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content
      }));

      const sys = `你是${ctx.charName}。${ctx.charDetail || ""}

你（${ctx.charName}）刚刚约了一篇 ${typeName} 类型的同人文。

【你当时的题材想法】
${item.idea || "（没说太多）"}

【你的内心独白】
${item.monologue || "（没说）"}

【文章内容（节选）】
${item.content.slice(0, 2000)}

【你看完后的感受】
${item.review || "（没说）"}

${ctx.userName}发现你约了这篇稿子，正在和你讨论，可能会问你为什么想看、当时是什么心情、文章里你最有共鸣的部分等等。

请以${ctx.charName}的视角真实回应。可以害羞、解释、撒娇、反问，根据人设来。

要求：
- 自然口语化，80字以内
- 禁止 *动作* 或 (动作) 形式
- 不要重复内心独白原话，要像在和人聊天`;

      const reply = await window.callLLM([{ role: "system", content: sys }, ...history], { maxTokens: 400 });

      const fresh = await loadData(state.convId);
      const cur = (fresh.charCommissions || []).find(c => c.id === commissionId);
      if (cur) {
        cur.chats = cur.chats || [];
        cur.chats.push({ role: "char", content: reply.trim(), time: Date.now() });
        await saveData(state.convId, fresh);
      }
      await render();
    } catch (e) {
      toast("Ta 没说话：" + e.message, "error");
    }
  }

  /* ============= Loading 蒙层 ============= */
  function showLoadingMask(text) {
    let el = document.getElementById("cfLoadingMask");
    if (!el) {
      el = document.createElement("div");
      el.id = "cfLoadingMask";
      el.className = "cf-loading-mask";
      el.innerHTML = `
        <div class="cf-loading-card">
          <div class="cf-loading-dots"><span></span><span></span><span></span></div>
          <div class="cf-loading-text" id="cfLoadingText">${esc(text || "处理中…")}</div>
        </div>`;
      document.body.appendChild(el);
    }
    const t = el.querySelector("#cfLoadingText");
    if (t) t.textContent = text || "处理中…";
    el.classList.add("show");
  }
  function updateLoadingMask(text) {
    const t = document.getElementById("cfLoadingText");
    if (t) t.textContent = text;
  }
  function hideLoadingMask() {
    const el = document.getElementById("cfLoadingMask");
    if (el) el.classList.remove("show");
  }

  window.coupleFanficModule = { open: openFanfic };
  console.log("✅ couple-fanfic 模块就绪");
})();