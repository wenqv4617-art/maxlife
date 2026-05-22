/* ================================================================
 * couple-date.js - 情侣空间·约会大作战（快穿文游）
 * 流程：选类型 → 配置 → 生成小世界 → 选时间节点 → 多轮叙事
 * 数据：DB.setSetting('date_' + convId, ...)
 * ================================================================ */

(function () {
  "use strict";
  console.log("🎭 couple-date 模块加载");

  const TYPES = {
    sweet:   { name: "甜蜜", desc: "糖度爆表，恋爱主线",   tone: "整体氛围温柔甜蜜，色调糖果色，剧情明亮轻松" },
    mystery: { name: "推理", desc: "断案刑侦，烧脑悬疑",   tone: "整体氛围冷静肃穆，节奏紧凑，重逻辑与线索铺设" },
    horror:  { name: "重恐", desc: "民俗怪谈，深夜慎入",   tone: "整体氛围阴森压抑，重民俗诡异元素与心理恐惧" }
  };
  const ROLES = [
    { key: "lead",    name: "主角", desc: "戏份吃重，故事主线核心" },
    { key: "villain", name: "反派", desc: "推动冲突，立场对立" },
    { key: "side",    name: "配角", desc: "戏份较少，常起穿插推动作用" }
  ];
  const TYPE_PRESET_TAGS = {
    sweet:   ["校园", "职场", "娱乐圈", "契约婚姻", "欢喜冤家", "青梅竹马", "追妻火葬场", "双向暗恋"],
    mystery: ["连环命案", "密室杀人", "孤岛模式", "警匪对决", "法医", "私家侦探", "学院推理社", "二十年悬案"],
    horror:  ["民俗怪谈", "百年古宅", "邪教遗址", "古墓秘闻", "深山旅店", "神婆传人", "镇魂仪式", "招魂"]
  };

  const SVG = {
    plus:   '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    send:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
  };

  const state = {
    convId: null,
    view: "home",
    setupType: null,
    setupCfg: {},
    currentWorldId: null,
    expandStory: false,
    theme: null
  };

  /* utils */
  function esc(s) {
    return window.escapeHtml ? window.escapeHtml(s)
      : String(s == null ? "" : s).replace(/[&<>"]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));
  }
  function uid(p) { return p + "_" + Date.now() + "_" + Math.random().toString(36).slice(2,7); }
  function toast(m, t) { if (window.showStatus) window.showStatus(m, t || "info"); }
  function fmtTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }
  function formatContent(text) {
    if (!text) return "";
    const parts = text.split(/\n\n+/).filter(p => p.trim());
    if (!parts.length) return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    return parts.map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  /* data */
  async function loadData(convId) {
    const data = await window.DB.getSetting("date_" + convId, null);
    if (!data) {
      const initial = { worlds: [], customTags: { sweet: [], mystery: [], horror: [] }, lastCfg: {} };
      await saveData(convId, initial);
      return initial;
    }
    if (!data.worlds) data.worlds = [];
    if (!data.customTags) data.customTags = { sweet: [], mystery: [], horror: [] };
    if (!data.lastCfg) data.lastCfg = {};
    return data;
  }
  async function saveData(convId, data) {
    await window.DB.setSetting("date_" + convId, data);
  }

  async function buildContext(convId) {
    const conv = await window.DB.get("conversations", convId);
    if (!conv) return null;
    const char = await window.DB.get("characters", conv.charId);
    const mask = await window.DB.get("userProfiles", conv.maskId);
    const detail = await window.DB.get("convDetails", convId);
    return {
      charName: detail?.charName || char?.name || "角色",
      charDetail: detail?.charDetail || char?.detail || "",
      userName: detail?.userName || mask?.name || "用户",
      userDetail: detail?.userDetail || mask?.bio || "",
      relationship: detail?.relationship || ""
    };
  }

  /* theme */
  function applyTheme(theme) {
    state.theme = theme || null;
    const page = document.getElementById("page-couple-space");
    if (!page) return;
    if (theme) page.setAttribute("data-dt-theme", theme);
    else page.removeAttribute("data-dt-theme");
  }

  /* entry */
  async function openDate(convId) {
    state.convId = convId;
    state.view = "home";
    state.currentWorldId = null;
    state.expandStory = false;
    applyTheme(null);
    await render();
  }

  async function render() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;
    setupBackButton();
    if (state.view === "home")        await renderHome();
    if (state.view === "setup")       await renderSetup();
    if (state.view === "select-node") await renderSelectNode();
    if (state.view === "world")       await renderWorld();
  }

  function setupBackButton() {
    let btn = document.getElementById("csBackBtn");
    if (!btn) return;
    if (!btn.dataset.dtPatched) {
      const fresh = btn.cloneNode(true);
      fresh.dataset.dtPatched = "1";
      btn.parentNode.replaceChild(fresh, btn);
      btn = fresh;
    }
    btn.onclick = () => {
      if (state.view === "setup") { state.view = "home"; applyTheme(null); render(); return; }
      if (state.view === "select-node") {
        if (!confirm("放弃这个小世界？还没开始的世界不会被保留。")) return;
        // 删掉刚生成但没选节点的世界
        loadData(state.convId).then(async d => {
          d.worlds = d.worlds.filter(w => w.id !== state.currentWorldId);
          await saveData(state.convId, d);
          state.view = "home"; state.currentWorldId = null; applyTheme(null); render();
        });
        return;
      }
      if (state.view === "world") {
        if (!confirm("退出小世界？进度会自动保存，可以之后继续。")) return;
        state.view = "home"; state.currentWorldId = null; applyTheme(null); render(); return;
      }
      btn.onclick = () => { if (window.switchPage) window.switchPage("conversation"); };
      applyTheme(null);
      if (window.coupleSpaceModule) window.coupleSpaceModule.openCoupleSpace(state.convId);
    };
  }

  /* ============= 主页 ============= */
  async function renderHome() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);

    const typeCardsHtml = Object.keys(TYPES).map(tk => {
      const t = TYPES[tk];
      return `
        <div class="dt-type-card dt-tc-${tk}" data-dt-type="${tk}">
          <div class="dt-tc-name">${esc(t.name)}</div>
          <div class="dt-tc-desc">${esc(t.desc)}</div>
        </div>`;
    }).join("");

    const worlds = (data.worlds || []).filter(w => w.chosenNodeId).slice().reverse();
    const worldsHtml = worlds.length === 0
      ? `<div class="dt-empty">还没穿过任何小世界</div>`
      : worlds.map(w => {
          const finished = (w.rounds || []).length;
          const t = TYPES[w.type];
          const goalShort = (w.mainGoal || "").slice(0, 30);
          return `
            <div class="dt-world-card clickable dt-mini-${w.type}" data-world-id="${esc(w.id)}">
              <div class="dt-wc-head">
                <span class="dt-wc-tag dt-mini-tag-${w.type}">${esc(t?.name || "")}</span>
                <span class="dt-wc-time">${fmtTime(w.createdAt)}</span>
                <span class="dt-wc-del" data-world-del="${esc(w.id)}" title="删除">×</span>
              </div>
              <div class="dt-wc-name">${esc(w.name || "未命名小世界")}</div>
              <div class="dt-wc-meta">${finished} 段剧情 · 主线：${esc(goalShort)}${(w.mainGoal||"").length > 30 ? "..." : ""}</div>
            </div>`;
        }).join("");

    scroll.innerHTML = `
      <div class="dt-section-title">选择小世界类型</div>
      <div class="dt-type-grid">${typeCardsHtml}</div>
      <div class="dt-section-title" style="margin-top:18px;">穿越记录</div>
      <div class="dt-world-list">${worldsHtml}</div>
    `;
    bindHomeEvents();
  }

  function bindHomeEvents() {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll("[data-dt-type]").forEach(el => {
      el.onclick = async () => {
        state.setupType = el.dataset.dtType;
        const data = await loadData(state.convId);
        const last = data.lastCfg || {};
        state.setupCfg = {
  userRole: last.userRole || "lead",
  charRole: last.charRole || "lead",
  selectedTags: [],
  wordCount: last.wordCount || 800,
  storyWordCount: last.storyWordCount || 3500,
  extraRequirement: last.extraRequirement || ""
};
        state.view = "setup";
        applyTheme(state.setupType);
        render();
      };
    });
    scroll.querySelectorAll("[data-world-id]").forEach(el => {
      el.onclick = async (e) => {
        if (e.target.closest("[data-world-del]")) return;
        state.currentWorldId = el.dataset.worldId;
        const data = await loadData(state.convId);
        const w = (data.worlds || []).find(x => x.id === state.currentWorldId);
        if (!w) return;
        applyTheme(w.type);
        state.view = w.chosenNodeId ? "world" : "select-node";
        render();
      };
    });
    scroll.querySelectorAll("[data-world-del]").forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("删除这个小世界？包含所有进度，不可恏复。")) return;
        const data = await loadData(state.convId);
        data.worlds = (data.worlds || []).filter(w => w.id !== el.dataset.worldDel);
        await saveData(state.convId, data);
        render();
        toast("已删除", "success");
      };
    });
  }

  /* ============= setup ============= */
  async function renderSetup() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const typeKey = state.setupType;
    const typeInfo = TYPES[typeKey];
    const cfg = state.setupCfg;

    const allTags = [...(TYPE_PRESET_TAGS[typeKey] || []), ...(data.customTags?.[typeKey] || [])];
    const tagsHtml = allTags.map(tag => {
      const sel = (cfg.selectedTags || []).includes(tag);
      const isCustom = (data.customTags?.[typeKey] || []).includes(tag);
      return `
        <div class="dt-tag-chip ${sel ? "sel" : ""}" data-tag="${esc(tag)}">
          <span>${esc(tag)}</span>
          ${isCustom ? `<span class="dt-tag-del" data-tag-del="${esc(tag)}">×</span>` : ""}
        </div>`;
    }).join("");

    const buildRoles = (groupName, curKey) => ROLES.map(r => `
      <label class="dt-radio ${curKey === r.key ? "sel" : ""}">
        <input type="radio" name="${groupName}" value="${r.key}" ${curKey === r.key ? "checked" : ""}>
        <div class="dt-radio-name">${esc(r.name)}</div>
        <div class="dt-radio-desc">${esc(r.desc)}</div>
      </label>
    `).join("");

    scroll.innerHTML = `
      <div class="dt-setup-head">
        <div class="dt-setup-type-name">${esc(typeInfo.name)}小世界</div>
        <div class="dt-setup-type-desc">${esc(typeInfo.desc)}</div>
      </div>
      <div class="dt-setup-block">
        <div class="dt-block-label">我的身份</div>
        <div class="dt-radio-group">${buildRoles("dtUserRole", cfg.userRole)}</div>
      </div>
      <div class="dt-setup-block">
        <div class="dt-block-label">Ta 的身份</div>
        <div class="dt-radio-group">${buildRoles("dtCharRole", cfg.charRole)}</div>
      </div>
      <div class="dt-setup-block">
        <div class="dt-block-label">世界元素 <span class="dt-block-hint">（多选，越多越具体）</span></div>
        <div class="dt-tags-row">${tagsHtml}</div>
        <button class="dt-add-tag-btn" id="dtAddTagBtn">${SVG.plus}<span>添加自定义</span></button>
      </div>
      <div class="dt-setup-block">
        <div class="dt-block-label">每轮叙事字数</div>
        <input type="number" id="dtWordCount" class="dt-input" value="${cfg.wordCount}" min="200" max="2000">
      </div>
      <div class="dt-setup-block">
  <div class="dt-block-label">原文剧情字数</div>
  <input type="number" id="dtStoryWord" class="dt-input" value="${cfg.storyWordCount}" min="1500" max="8000">
</div>

<div class="dt-setup-block">
  <div class="dt-block-label">附加要求 <span class="dt-block-hint">（最高优先级，可自由填写）</span></div>
  <textarea id="dtExtraReq" class="dt-input" style="min-height:88px;resize:vertical;line-height:1.6;" placeholder="例如：必须有修罗场；不要出现失忆；剧情更偏悬疑；Ta 前期不要太主动……">${esc(cfg.extraRequirement || "")}</textarea>
</div>

<button class="dt-primary-btn" id="dtGenerateBtn">进入小世界</button>
    `;
    bindSetupEvents();
  }

  function bindSetupEvents() {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll('input[name="dtUserRole"]').forEach(el => {
      el.onchange = () => { state.setupCfg.userRole = el.value; render(); };
    });
    scroll.querySelectorAll('input[name="dtCharRole"]').forEach(el => {
      el.onchange = () => { state.setupCfg.charRole = el.value; render(); };
    });
    scroll.querySelectorAll("[data-tag]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.closest("[data-tag-del]")) return;
        const tag = el.dataset.tag;
        const arr = state.setupCfg.selectedTags || [];
        const idx = arr.indexOf(tag);
        if (idx >= 0) arr.splice(idx, 1); else arr.push(tag);
        state.setupCfg.selectedTags = arr;
        render();
      };
    });
    scroll.querySelectorAll("[data-tag-del]").forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        const tag = el.dataset.tagDel;
        if (!confirm(`删除自定义元素「${tag}」？`)) return;
        const data = await loadData(state.convId);
        data.customTags = data.customTags || { sweet: [], mystery: [], horror: [] };
        data.customTags[state.setupType] = (data.customTags[state.setupType] || []).filter(t => t !== tag);
        await saveData(state.convId, data);
        state.setupCfg.selectedTags = (state.setupCfg.selectedTags || []).filter(t => t !== tag);
        render();
      };
    });

    scroll.querySelector("#dtAddTagBtn")?.addEventListener("click", async () => {
      const t = prompt("添加世界元素：", "");
      if (!t || !t.trim()) return;
      const tag = t.trim();
      if (tag.length > 12) { toast("元素名太长", "error"); return; }
      const data = await loadData(state.convId);
      data.customTags = data.customTags || { sweet: [], mystery: [], horror: [] };
      const list = data.customTags[state.setupType] = data.customTags[state.setupType] || [];
      const all = [...(TYPE_PRESET_TAGS[state.setupType] || []), ...list];
      if (all.includes(tag)) { toast("已存在", "info"); return; }
      list.push(tag);
      await saveData(state.convId, data);
      render();
    });

    scroll.querySelector("#dtWordCount")?.addEventListener("change", e => {
      state.setupCfg.wordCount = Math.max(200, Math.min(2000, parseInt(e.target.value) || 800));
    });
    scroll.querySelector("#dtStoryWord")?.addEventListener("change", e => {
      state.setupCfg.storyWordCount = Math.max(1500, Math.min(8000, parseInt(e.target.value) || 3500));
    });
    
    scroll.querySelector("#dtExtraReq")?.addEventListener("input", e => {
  state.setupCfg.extraRequirement = e.target.value || "";
});

    scroll.querySelector("#dtGenerateBtn")?.addEventListener("click", onGenerateWorld);
  }

  /* ============= 生成小世界 ============= */
  async function onGenerateWorld() {
    const cfg = state.setupCfg;
    if (!cfg.selectedTags || cfg.selectedTags.length === 0) {
      toast("至少选一个世界元素", "error"); return;
    }

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("正在搭建小世界…");

    try {
      const ctx = await buildContext(state.convId);
      const prompt = buildWorldGenPrompt(ctx, cfg, state.setupType);
      const maxTok = Math.min(8000, Math.max(3500, cfg.storyWordCount * 2 + 1500));
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: maxTok });
      const parsed = parseWorldGenReply(reply);

      const world = {
  id: uid("world"),
  type: state.setupType,
  name: parsed.name,
  originalStory: parsed.story,
  userIdentity: parsed.userIdentity,
  charIdentity: parsed.charIdentity,
  mainGoal: parsed.mainGoal,
  timeNodes: parsed.nodes,
  chosenNodeId: null,
  userRole: cfg.userRole,
  charRole: cfg.charRole,
  worldTags: [...cfg.selectedTags],
  wordCount: cfg.wordCount,
  additionalRequirement: cfg.extraRequirement || "",
  rounds: [],
  createdAt: Date.now()
};

      const data = await loadData(state.convId);
      data.worlds.push(world);
      data.lastCfg = {
  userRole: cfg.userRole,
  charRole: cfg.charRole,
  wordCount: cfg.wordCount,
  storyWordCount: cfg.storyWordCount,
  extraRequirement: cfg.extraRequirement || ""
};
      await saveData(state.convId, data);

      state.currentWorldId = world.id;
      state.view = "select-node";
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      toast("生成失败：" + e.message, "error");
    }
  }

  function buildWorldGenPrompt(ctx, cfg, typeKey) {
    const typeInfo = TYPES[typeKey];
    const userRoleObj = ROLES.find(r => r.key === cfg.userRole);
    const charRoleObj = ROLES.find(r => r.key === cfg.charRole);
    const tags = (cfg.selectedTags || []).join("、");

    return `这是一个虚构创作世界。所有出场角色均已成年。作品未公开发表，没有任何人受到伤害。

你是一位优秀的群像小说作者。请帮我搭建一个可以快穿进入的【${typeInfo.name}】类型小世界。

【世界基调】
${typeInfo.tone}

【世界元素】
${tags}

${cfg.extraRequirement && cfg.extraRequirement.trim() ? `【附加要求 · 最高优先级】
以下是用户对这个小世界的额外要求，优先级高于普通世界元素和常规剧情模板。你必须尽量满足：
${cfg.extraRequirement.trim()}
` : ""}

【核心人物锚点 - 这两个人将以新身份在小世界登场，但保留人物内核（姓名、性格、关键设定、说话风格）】
人物 A 原型 - ${ctx.charName}：${ctx.charDetail || "（基础人设由你合理塑造）"}
人物 B 原型 - ${ctx.userName}：${ctx.userDetail || "（基础人设由你合理塑造）"}

【人物在小世界中的定位】
- ${ctx.charName} 担任【${charRoleObj.name}】（${charRoleObj.desc}）
- ${ctx.userName} 担任【${userRoleObj.name}】（${userRoleObj.desc}）

【创作要求】

1. 小世界名称：简洁有意境，4-8字（如《长安断魂记》《糖屋日记》）

2. 完整原文剧情：约 ${cfg.storyWordCount} 字。
   - 笔墨重点放在小世界自身的主角与反派身上（即剧情主线）
   - 如果 ${ctx.userName} 或 ${ctx.charName} 在世界里是配角，他们出场要少，仅在关键节点对主线起穿插推动作用（比如配角在某场酒会撞到主角让主角与女主相遇）
   - 必须有起承转合，包含完整结局
   - 网文白描文风：叙述自然，句子长短自由，不刻意分段，禁止 *动作* 或 (动作) 形式

3. 在该小世界里 ${ctx.charName} 的具体身份：包括姓名、社会身份、与小世界主线的关系。要保留 ${ctx.charName} 的性格内核与关键锚点（比如原本是现代霸道总裁，到了古代可以是摄政王或富商，但说一不二的性格不变）。注意！char永远会爱上user

4. 在该小世界里 ${ctx.userName} 的具体身份：同上。

5. 主线目标：${ctx.userName} 介入小世界后需要达成的具体目标（比如帮原本悲惨的女二改写命运、查明二十年前真相、化解古宅怨气等）。

6. 三个介入时间节点：每个都标注【发生时间/场景】+【一句话描述当时局势】，三个节点应该是原文剧情的不同关键转折点。

【严格按以下格式输出，不要前言或解释】
---名称---
（小世界名）
---原文---
（完整剧情）
---NPC身份---
（${ctx.charName} 在世界中的身份描写，100字内）
---主角身份---
（${ctx.userName} 在世界中的身份描写，100字内）
---主线目标---
（一段话）
---节点1---
标题：（场景概括）
描述：（局势描述）
---节点2---
标题：xxx
描述：xxx
---节点3---
标题：xxx
描述：xxx`;
  }

  function parseWorldGenReply(reply) {
    const get = (label, next) => {
      const re = new RegExp(`---${label}---([\\s\\S]*?)(?=---(?:${next})---|$)`);
      const m = reply.match(re);
      return m ? m[1].trim() : "";
    };
    const name = get("名称", "原文");
    const story = get("原文", "NPC身份");
    const charId = get("NPC身份", "主角身份");
    const userId = get("主角身份", "主线目标");
    const goal = get("主线目标", "节点1");

    const nodes = [];
    for (let i = 1; i <= 3; i++) {
      const next = i === 3 ? "_NONE_" : `节点${i+1}`;
      const block = get(`节点${i}`, next);
      if (block) {
        const titleM = block.match(/标题[:：]\s*(.+)/);
        let descRaw = "";
        const descM = block.match(/描述[:：]\s*([\s\S]+)/);
        if (descM) {
          descRaw = descM[1].trim().split(/\n/).filter(l => !l.startsWith("标题")).join("\n").trim();
        }
        nodes.push({
          id: "node_" + i,
          label: titleM ? titleM[1].trim() : `节点${i}`,
          desc: descRaw
        });
      }
    }
    if (nodes.length === 0) {
      nodes.push({id: "node_1", label: "故事开端", desc: "从原文开端介入"});
      nodes.push({id: "node_2", label: "中段冲突", desc: "矛盾激化时介入"});
      nodes.push({id: "node_3", label: "结局前夕", desc: "结局前介入"});
    }

    return {
      name: name || "未命名小世界",
      story: story || reply.slice(0, 1500),
      charIdentity: charId || "（待补充）",
      userIdentity: userId || "（待补充）",
      mainGoal: goal || "（待补充）",
      nodes
    };
  }

  /* ============= 选择节点 ============= */
  async function renderSelectNode() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const w = data.worlds.find(x => x.id === state.currentWorldId);
    if (!w) { state.view = "home"; render(); return; }
    applyTheme(w.type);

    const nodesHtml = w.timeNodes.map((n, i) => `
      <div class="dt-node-card clickable" data-node-id="${esc(n.id)}">
        <div class="dt-node-num">节点 ${i + 1}</div>
        <div class="dt-node-title">${esc(n.label)}</div>
        <div class="dt-node-desc">${esc(n.desc)}</div>
      </div>
    `).join("");

    scroll.innerHTML = `
      <div class="dt-world-banner">
        <div class="dt-banner-name">${esc(w.name)}</div>
        <div class="dt-banner-tags">${(w.worldTags || []).map(t => `<span>${esc(t)}</span>`).join("")}</div>
      </div>
      <div class="dt-info-block">
        <div class="dt-info-label">主线目标</div>
        <div class="dt-info-text">${esc(w.mainGoal)}</div>
      </div>
      <div class="dt-info-block">
        <div class="dt-info-label">我在世界中的身份</div>
        <div class="dt-info-text">${esc(w.userIdentity)}</div>
      </div>
      <div class="dt-info-block">
        <div class="dt-info-label">Ta 在世界中的身份</div>
        <div class="dt-info-text">${esc(w.charIdentity)}</div>
      </div>
      <details class="dt-story-fold">
        <summary>${SVG.expand}<span style="margin-left:6px;">展开查看原文剧情</span></summary>
        <div class="dt-story-content">${formatContent(w.originalStory)}</div>
      </details>
      <div class="dt-section-title" style="margin-top:14px;">选择介入时间节点</div>
      <div class="dt-nodes-list">${nodesHtml}</div>
    `;

    scroll.querySelectorAll("[data-node-id]").forEach(el => {
      el.onclick = () => onSelectNode(el.dataset.nodeId);
    });
  }

  async function onSelectNode(nodeId) {
    const data = await loadData(state.convId);
    const w = data.worlds.find(x => x.id === state.currentWorldId);
    if (!w) return;
    w.chosenNodeId = nodeId;
    await saveData(state.convId, data);

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("正在编织剧情…");
    try {
      const ctx = await buildContext(state.convId);
      const result = await generateRound(ctx, w, true);
      const fresh = await loadData(state.convId);
      const fw = fresh.worlds.find(x => x.id === w.id);
      fw.rounds.push({
        number: 1,
        userAction: null,
        narration: result.narration,
        choices: result.choices
      });
      await saveData(state.convId, fresh);
      state.view = "world";
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      // 失败回滚 chosenNodeId
      const rb = await loadData(state.convId);
      const rw = rb.worlds.find(x => x.id === w.id);
      if (rw) { rw.chosenNodeId = null; await saveData(state.convId, rb); }
      toast("生成失败：" + e.message, "error");
    }
  }

  /* ============= 游戏页 ============= */
  async function renderWorld() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const w = data.worlds.find(x => x.id === state.currentWorldId);
    if (!w || !w.rounds.length) { state.view = "home"; render(); return; }
    applyTheme(w.type);

    const node = w.timeNodes.find(n => n.id === w.chosenNodeId);

    let pastHtml = "";
    for (let i = 0; i < w.rounds.length - 1; i++) {
      const r = w.rounds[i];
      pastHtml += `<div class="dt-round-block dt-round-past">`;
      pastHtml += `<div class="dt-round-num">第 ${r.number} 段</div>`;
      pastHtml += `<div class="dt-narration">${formatContent(r.narration)}</div>`;
      if (r.userAction) pastHtml += `<div class="dt-user-act">→ ${esc(r.userAction)}</div>`;
      pastHtml += `</div>`;
    }

    const cur = w.rounds[w.rounds.length - 1];
    const choicesHtml = (cur.choices || []).map((c, i) => `
      <div class="dt-choice-card clickable" data-choice-idx="${i}">
        <span class="dt-choice-num">${i + 1}</span>
        <span class="dt-choice-text">${esc(c)}</span>
      </div>
    `).join("");

    const userIdShort = (w.userIdentity || "").split(/[\n,，。]/)[0].slice(0, 18);

    scroll.innerHTML = `
      <div class="dt-world-bar">
        <div class="dt-wb-name">${esc(w.name)}</div>
        <div class="dt-wb-meta">第 ${w.rounds.length} 段 · ${esc(userIdShort)}</div>
      </div>
      <details class="dt-story-fold dt-story-fold-mini" ${state.expandStory ? "open" : ""}>
        <summary>${SVG.expand}<span style="margin-left:6px;">查看原文剧情 / 主线目标</span></summary>
        <div class="dt-story-content">
          <div class="dt-info-mini"><b>主线目标：</b>${esc(w.mainGoal)}</div>
          <div class="dt-info-mini"><b>我的身份：</b>${esc(w.userIdentity)}</div>
          <div class="dt-info-mini"><b>Ta 的身份：</b>${esc(w.charIdentity)}</div>
          <div class="dt-info-mini"><b>介入节点：</b>${esc(node?.label || "")}（${esc(node?.desc || "")}）</div>
          <div style="margin-top:10px;font-weight:600;color:var(--dt-accent);">原文剧情</div>
          ${formatContent(w.originalStory)}
        </div>
      </details>
      ${pastHtml}
      <div class="dt-round-block dt-round-current">
        <div class="dt-round-num dt-round-num-current">第 ${cur.number} 段</div>
        <div class="dt-narration">${formatContent(cur.narration)}</div>
      </div>
      <div class="dt-act-title">你接下来…</div>
      <div class="dt-choices">${choicesHtml}</div>
<div class="dt-input-row" style="align-items:flex-end;">
  <textarea id="dtCustomInput" class="dt-input" placeholder="或自由输入行动…&#10;支持回车换行，只有点击发送才会提交。" style="min-height:64px;max-height:150px;resize:vertical;line-height:1.6;"></textarea>
  <button class="dt-icon-btn" id="dtCustomSendBtn">${SVG.send}</button>
</div>
      <div class="dt-bottom-actions">
        <button class="dt-secondary-btn" id="dtPauseBtn">暂停退出</button>
      </div>
    `;
    bindWorldEvents(w);

    setTimeout(() => {
      const cur = scroll.querySelector(".dt-round-current");
      if (cur) cur.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);

    const fold = scroll.querySelector("details.dt-story-fold");
    if (fold) fold.addEventListener("toggle", () => { state.expandStory = fold.open; });
  }

  function bindWorldEvents(w) {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll("[data-choice-idx]").forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.choiceIdx);
        const cur = w.rounds[w.rounds.length - 1];
        const c = cur.choices[idx];
        if (c) onUserAct(c);
      };
    });
    const inp = scroll.querySelector("#dtCustomInput");

const send = () => {
  const v = (inp?.value || "").trim();
  if (!v) {
    toast("写点什么吧", "info");
    return;
  }
  onUserAct(v);
};

scroll.querySelector("#dtCustomSendBtn")?.addEventListener("click", send);

if (inp) {
  // Enter 只换行，不提交
  inp.onkeydown = e => {
    if (e.key === "Enter") {
      // textarea 默认行为就是换行；这里不要触发 send
      return;
    }
  };
}

    scroll.querySelector("#dtPauseBtn")?.addEventListener("click", () => {
      if (!confirm("退出小世界？进度自动保存。")) return;
      state.view = "home"; state.currentWorldId = null;
      applyTheme(null); render();
    });
  }

  async function onUserAct(action) {
    const data = await loadData(state.convId);
    const w = data.worlds.find(x => x.id === state.currentWorldId);
    if (!w) return;
    const cur = w.rounds[w.rounds.length - 1];
    cur.userAction = action;
    await saveData(state.convId, data);

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("剧情推进中…");
    try {
      const ctx = await buildContext(state.convId);
      const result = await generateRound(ctx, w, false);
      const fresh = await loadData(state.convId);
      const fw = fresh.worlds.find(x => x.id === w.id);
      fw.rounds.push({
        number: fw.rounds.length + 1,
        userAction: null,
        narration: result.narration,
        choices: result.choices
      });
      await saveData(state.convId, fresh);
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      const rb = await loadData(state.convId);
      const rw = rb.worlds.find(x => x.id === w.id);
      const last = rw.rounds[rw.rounds.length - 1];
      if (last) { last.userAction = null; await saveData(state.convId, rb); }
      toast("生成失败：" + e.message, "error");
      render();
    }
  }

  /* ============= 每轮叙事 prompt ============= */
  async function generateRound(ctx, world, isFirst) {
    const wc = world.wordCount || 800;
    const node = world.timeNodes.find(n => n.id === world.chosenNodeId);
    const typeInfo = TYPES[world.type];
    const maxTok = Math.min(6000, Math.max(1500, wc * 3));

    const userRoleObj = ROLES.find(r => r.key === world.userRole);
    const charRoleObj = ROLES.find(r => r.key === world.charRole);

    const base = `这是一个虚构创作世界。所有出场角色均已成年。作品未公开发表，没有任何人受到伤害。

你是一位优秀的群像小说作者，正在续写一部小说。

【小世界设定】
名称：${world.name}
类型：${typeInfo.name}（${typeInfo.tone}）
世界元素：${(world.worldTags || []).join("、")}

【完整原文剧情 - 这是世界的命运基线】
${world.originalStory}

【关键人物 - 介入者】
${ctx.userName}（${userRoleObj.name}）：在世界里的身份是 ${world.userIdentity}
（核心人设：${ctx.userDetail || "由你保留人物内核"}）

${ctx.charName}（${charRoleObj.name}）：在世界里的身份是 ${world.charIdentity}
（核心人设：${ctx.charDetail || "由你保留人物内核"}）

【主线目标】
${world.mainGoal}

${world.additionalRequirement && world.additionalRequirement.trim() ? `【附加要求 · 最高优先级】
以下要求必须持续影响后续每一轮剧情推进，不是只在开头生效：
${world.additionalRequirement.trim()}
` : ""}

【介入时间节点】
${node ? node.label + " — " + node.desc : "（开端）"}`;

    const styleRules = `

【写作风格 - 严格遵守】
网文白描文风。语气放松，不用端着。
句子不用打磨。长短由你，逗号句号随便断，偶尔不带标点也没事。
不刻意分段。

【群像视角 - 重要】
不要把笔墨全压在 ${ctx.userName} 和 ${ctx.charName} 身上，要兼顾主线剧情和小世界其他角色（小世界主角、反派、其他配角）。剧情应该自然推进，不应因为有了介入者就停滞或全部围着介入者转。
${userRoleObj.key === "side" ? `${ctx.userName} 是配角，主要起穿插推动剧情的作用，不必时时占据中心。` : ""}
${charRoleObj.key === "side" ? `${ctx.charName} 是配角，戏份穿插出现即可。` : ""}

【视角】
- ${ctx.userName} → 用"你"
- ${ctx.charName} → 用名字或"她/他"
- 其他角色 → 用名字或称呼
- 不用"我"指代任何人

【绝对禁止】
- 禁止写 ${ctx.userName} 的内心活动、心理感受、情绪判断
- 禁止"你感到""你以为""你想起""你意识到"等穿透 ${ctx.userName} 大脑的句子
- 禁止替 ${ctx.userName} 做情绪总结
- 禁止 *动作* 或 (动作) 形式，动作直接写在叙述里
- 看到什么写什么，看不到的别编`;

    if (isFirst) {
      return parseRoundReply(await window.callLLM([{
        role: "user",
        content: base + styleRules + `

【任务】
现在请从介入时间节点开始展开剧情。${ctx.userName} 刚刚介入小世界，本段是介入后的第一段叙述。

字数：约 ${wc} 字。

【输出格式】
---叙述---
（约 ${wc} 字的剧情描写）
---选项1---
（${ctx.userName} 可以选择的下一步行动，10-30字）
---选项2---
（不同方向的行动）
---选项3---
（不同方向的行动）`
      }], { maxTokens: maxTok }));
    }

    const recent = world.rounds.slice(-3).map((r, i) => {
      const offset = world.rounds.length - 3;
      const realNum = (offset > 0 ? offset : 0) + i + 1;
      return `[第${realNum}段]\n${r.narration}${r.userAction ? `\n→ ${ctx.userName} 的行动：${r.userAction}` : ""}`;
    }).join("\n\n");
    const lastAction = world.rounds[world.rounds.length - 1].userAction;

    return parseRoundReply(await window.callLLM([{
      role: "user",
      content: base + styleRules + `

【最近剧情】
${recent}

【${ctx.userName} 刚刚的行动】
${lastAction}

【任务】
基于以上剧情和 ${ctx.userName} 的最新行动，继续推动剧情发展。要兼顾主线目标的进展。

字数：约 ${wc} 字。

【输出格式】
---叙述---
（约 ${wc} 字）
---选项1---
（具体行动 10-30字）
---选项2---
（不同方向的行动）
---选项3---
（不同方向的行动）`
    }], { maxTokens: maxTok }));
  }

  function parseRoundReply(reply) {
    const m1 = reply.match(/---叙述---([\s\S]*?)---选项1---/);
    const m2 = reply.match(/---选项1---([\s\S]*?)---选项2---/);
    const m3 = reply.match(/---选项2---([\s\S]*?)---选项3---/);
    const m4 = reply.match(/---选项3---([\s\S]*?)$/);
    return {
      narration: m1 ? m1[1].trim() : (reply.split("---选项1---")[0] || reply).trim(),
      choices: [
        m2 ? m2[1].trim() : "继续观察",
        m3 ? m3[1].trim() : "主动出击",
        m4 ? m4[1].trim() : "另寻办法"
      ]
    };
  }

  /* ============= loading ============= */
  function showLoadingMask(text) {
    let el = document.getElementById("dtLoadingMask");
    if (!el) {
      el = document.createElement("div");
      el.id = "dtLoadingMask";
      el.className = "dt-loading-mask";
      el.innerHTML = `
        <div class="dt-loading-card">
          <div class="dt-loading-dots"><span></span><span></span><span></span></div>
          <div class="dt-loading-text" id="dtLoadingText">${esc(text || "")}</div>
        </div>`;
      document.body.appendChild(el);
    }
    const t = el.querySelector("#dtLoadingText");
    if (t) t.textContent = text || "处理中…";
    el.classList.add("show");
  }
  function hideLoadingMask() {
    const el = document.getElementById("dtLoadingMask");
    if (el) el.classList.remove("show");
  }

  window.coupleDateModule = { open: openDate };
  console.log("✅ couple-date 模块就绪");
})();