/* ================================================================
 * couple-checkin.js - 情侣空间·查岗
 * 多轮交互式叙事：
 *   第一轮 → AI 描写 char 当下场景 + 给 3 个身份选项（透明人/物品/物品）
 *   后续轮 → 用户选/写身份或行动 → AI 续写 + 给 3 个行动选项
 *   退出后保留为可查看记录，可继续
 * 数据：DB.setSetting('checkin_' + convId, ...)
 * ================================================================ */

(function () {
  "use strict";
  console.log("👁 couple-checkin 模块加载");

  const TYPES = [
    { key: "sweet",  name: "甜蜜", desc: "温柔糖分" },
    { key: "bitter", name: "酸涩", desc: "怅然失落" },
    { key: "spicy",  name: "火辣", desc: "炽烈悸动" }
  ];
  const TYPE_NAME_MAP = { sweet: "甜蜜", bitter: "酸涩", spicy: "火辣" };
  const TYPE_TONE_MAP = {
    sweet:  "甜蜜温馨、糖度高的氛围",
    bitter: "酸涩、惆怅、有距离感的氛围",
    spicy:  "热烈、心跳加速、有暧昧张力的氛围"
  };

  const SVG_SEND = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  const state = {
    convId: null,
    view: "home",       // 'home' | 'session' | 'detail'
    sessionId: null,
    detailId: null,
    cfg: { wordCount: 800, type: "sweet" }
  };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return window.escapeHtml ? window.escapeHtml(s)
      : String(s == null ? "" : s).replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
  }
  function uid(p) { return p + "_" + Date.now() + "_" + Math.random().toString(36).slice(2,7); }
  function toast(m, t) { if (window.showStatus) window.showStatus(m, t || "info"); }
  function fmtTime(t) {
    if (!t) return "";
    const d = new Date(t);
    return `${d.getMonth()+1}月${d.getDate()}日 ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  }
  function formatContent(text) {
    if (!text) return "";
    const parts = text.split(/\n\n+/).filter(p => p.trim());
    if (parts.length === 0) return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    return parts.map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  /* ---------- 数据 ---------- */
  async function loadData(convId) {
    const data = await window.DB.getSetting("checkin_" + convId, null);
    if (!data) return { sessions: [] };
    if (!data.sessions) data.sessions = [];
    return data;
  }
  async function saveData(convId, data) {
    await window.DB.setSetting("checkin_" + convId, data);
  }

  /* ---------- 上下文 ---------- */
  async function buildContext(convId) {
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
  async function openCheckin(convId) {
    state.convId = convId;
    state.view = "home";
    state.sessionId = null;
    state.detailId = null;
    await render();
  }

  async function render() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;
    setupBackButton();
    if (state.view === "home")    await renderHome();
    if (state.view === "session") await renderSession();
    if (state.view === "detail")  await renderDetail();
  }

  /* ---------- 返回按钮 ---------- */
  function setupBackButton() {
    let btn = document.getElementById("csBackBtn");
    if (!btn) return;
    if (!btn.dataset.ckPatched) {
      const fresh = btn.cloneNode(true);
      fresh.dataset.ckPatched = "1";
      btn.parentNode.replaceChild(fresh, btn);
      btn = fresh;
    }
    btn.onclick = () => {
      if (state.view === "session") {
        state.view = "home"; render();
      } else if (state.view === "detail") {
        state.view = "home"; render();
      } else {
        btn.onclick = () => { if (window.switchPage) window.switchPage("conversation"); };
        if (window.coupleSpaceModule) window.coupleSpaceModule.openCoupleSpace(state.convId);
      }
    };
  }

  /* ============= 主页 ============= */
  async function renderHome() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const list = (data.sessions || []).slice().reverse();

    const typesHtml = TYPES.map(t => `
      <div class="ck-type-pill ${state.cfg.type === t.key ? "sel" : ""}" data-type="${t.key}">
        <div class="ck-type-pill-name ck-type-${t.key}">${esc(t.name)}</div>
        <div class="ck-type-pill-desc">${esc(t.desc)}</div>
      </div>
    `).join("");

    const listHtml = list.length === 0
      ? `<div class="ck-empty">还没查过岗，去看看 Ta 在干嘛？</div>`
      : list.map(s => {
          const last = s.rounds[s.rounds.length - 1];
          const preview = (last?.narration || "").replace(/\s+/g, " ").slice(0, 50);
          return `
            <div class="ck-list-card clickable" data-session-id="${esc(s.id)}">
              <div class="ck-card-head">
                <span class="ck-card-tag ck-type-${s.type}">${esc(TYPE_NAME_MAP[s.type] || "")}</span>
                <span class="ck-card-time">${fmtTime(s.createdAt)}</span>
              </div>
              ${s.identity ? `<div class="ck-card-identity">身份：${esc(s.identity)}</div>` : ""}
              <div class="ck-card-preview">${esc(preview)}…</div>
              <div class="ck-card-meta">
                <span>${s.rounds.length} 幕</span>
                <span>${s.totalLen || 0} 字</span>
              </div>
            </div>`;
        }).join("");

    scroll.innerHTML = `
      <div class="ck-console">
        <div class="ck-section-label">单段字数</div>
        <input type="number" id="ckWord" class="ck-input" value="${state.cfg.wordCount}" min="200" max="2000">
        <div class="ck-section-label" style="margin-top:14px;">情绪基调</div>
        <div class="ck-types-row">${typesHtml}</div>
        <button class="ck-primary-btn" id="ckStartBtn">开始查岗</button>
        <div class="ck-tip">每一幕生成后，你将选择以什么身份继续靠近 Ta</div>
      </div>
      <div class="ck-list">
        <div class="ck-list-title">查岗记录</div>
        ${listHtml}
      </div>
    `;
    bindHomeEvents();
  }

  function bindHomeEvents() {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll("[data-type]").forEach(el => {
      el.onclick = () => { state.cfg.type = el.dataset.type; render(); };
    });
    const startBtn = scroll.querySelector("#ckStartBtn");
    if (startBtn) startBtn.onclick = onStartCheckin;
    scroll.querySelectorAll("[data-session-id]").forEach(el => {
      el.onclick = () => { state.detailId = el.dataset.sessionId; state.view = "detail"; render(); };
    });
  }

  async function onStartCheckin() {
    const wcEl = document.getElementById("ckWord");
    const wc = parseInt(wcEl?.value) || 800;
    if (wc < 200 || wc > 2000) { toast("字数请在 200~2000 之间", "error"); return; }
    state.cfg.wordCount = wc;

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("正在偷偷靠近 Ta…");

    try {
      const ctx = await buildContext(state.convId);
      const result = await generateRound(ctx, null, null, true);

      const session = {
        id: uid("ck"),
        createdAt: Date.now(),
        type: state.cfg.type,
        wordCount: wc,
        identity: "",
        rounds: [{ narration: result.narration, choices: result.choices, userChoice: "" }],
        totalLen: result.narration.length
      };

      const data = await loadData(state.convId);
      data.sessions = data.sessions || [];
      data.sessions.push(session);
      await saveData(state.convId, data);

      state.sessionId = session.id;
      state.view = "session";
      hideLoadingMask();
      await render();
    } catch (e) {
      hideLoadingMask();
      toast("查岗失败：" + e.message, "error");
    }
  }

  /* ============= 会话页 ============= */
  async function renderSession() {
    const data = await loadData(state.convId);
    const session = (data.sessions || []).find(s => s.id === state.sessionId);
    if (!session) { state.view = "home"; render(); return; }

    const scroll = document.getElementById("csScroll");

    // 已完成的轮次（除最后一轮）
    let pastHtml = "";
    for (let i = 0; i < session.rounds.length - 1; i++) {
      const r = session.rounds[i];
      pastHtml += `
        <div class="ck-act-block ck-act-past">
          <div class="ck-act-num">第 ${i + 1} 幕</div>
          <div class="ck-narration">${formatContent(r.narration)}</div>
          ${r.userChoice ? `<div class="ck-user-choice">→ ${esc(r.userChoice)}</div>` : ""}
        </div>`;
    }

    const cur = session.rounds[session.rounds.length - 1];
    const isFirst = session.rounds.length === 1;

    const choicesHtml = (cur.choices || []).map((c, idx) => `
      <div class="ck-choice-card clickable" data-choice-idx="${idx}">
        <span class="ck-choice-num">${idx + 1}</span>
        <span class="ck-choice-text">${esc(c)}</span>
      </div>
    `).join("");

    scroll.innerHTML = `
      <div class="ck-session-head">
        <span class="ck-card-tag ck-type-${session.type}">${esc(TYPE_NAME_MAP[session.type])}</span>
        <span class="ck-session-act">第 ${session.rounds.length} 幕</span>
        ${session.identity ? `<span class="ck-session-identity">身份：${esc(session.identity)}</span>` : ""}
      </div>
      ${pastHtml}
      <div class="ck-act-block ck-act-current">
        <div class="ck-act-num ck-act-num-current">第 ${session.rounds.length} 幕</div>
        <div class="ck-narration">${formatContent(cur.narration)}</div>
      </div>
      <div class="ck-choices-title">${isFirst ? "选择你的身份" : "你接下来想…"}</div>
      <div class="ck-choices">${choicesHtml}</div>
      <div class="ck-custom-row">
        <input type="text" id="ckCustomInput" class="ck-input" placeholder="${isFirst ? "或自定义身份（如：他左手的戒指）" : "或自定义你的行动…"}">
        <button class="ck-icon-btn" id="ckCustomSendBtn" title="提交">${SVG_SEND}</button>
      </div>
      <div class="ck-bottom-actions">
        <button class="ck-secondary-btn" id="ckEndBtn">结束查岗</button>
      </div>
    `;
    bindSessionEvents(session);

    // 滚到当前幕
    setTimeout(() => {
      const cur = scroll.querySelector(".ck-act-current");
      if (cur) cur.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function bindSessionEvents(session) {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll("[data-choice-idx]").forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.choiceIdx);
        const cur = session.rounds[session.rounds.length - 1];
        const choice = cur.choices[idx];
        if (choice) onUserChoose(choice);
      };
    });
    const customBtn = scroll.querySelector("#ckCustomSendBtn");
    const customInput = scroll.querySelector("#ckCustomInput");
    const sendCustom = () => {
      const text = (customInput?.value || "").trim();
      if (!text) { toast("说点什么呢", "info"); return; }
      onUserChoose(text);
    };
    if (customBtn) customBtn.onclick = sendCustom;
    if (customInput) customInput.onkeypress = (e) => { if (e.key === "Enter") sendCustom(); };

    const endBtn = scroll.querySelector("#ckEndBtn");
    if (endBtn) endBtn.onclick = () => {
      if (!confirm("结束这次查岗？记录会保留，可以之后继续。")) return;
      state.view = "home"; render();
    };
  }

  async function onUserChoose(choice) {
    const data = await loadData(state.convId);
    const session = (data.sessions || []).find(s => s.id === state.sessionId);
    if (!session) return;

    const cur = session.rounds[session.rounds.length - 1];
    cur.userChoice = choice;
    const isFirst = session.rounds.length === 1;
    if (isFirst) session.identity = choice;
    await saveData(state.convId, data);

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask(isFirst ? "正在以你的视角靠近 Ta…" : "继续观察 Ta…");

    try {
      const ctx = await buildContext(state.convId);
      const result = await generateRound(ctx, session, choice, false);
      session.rounds.push({ narration: result.narration, choices: result.choices, userChoice: "" });
      session.totalLen = (session.totalLen || 0) + result.narration.length;
      await saveData(state.convId, data);
      hideLoadingMask();
      await render();
    } catch (e) {
      hideLoadingMask();
      toast("生成失败：" + e.message, "error");
    }
  }

  /* ============= 生成 ============= */
  async function generateRound(ctx, session, lastUserChoice, isFirst) {
    const wc = state.cfg.wordCount;
    const tone = TYPE_TONE_MAP[state.cfg.type] || "";
    const maxTok = Math.min(6000, Math.max(1500, wc * 3));

    let prompt;
    if (isFirst) {
      prompt = `这是一个虚构创作世界。所有出场角色均已成年。

你是优秀的小说作者。整体基调：${tone}。请用第三人称描写${ctx.charName}此刻正在做什么。

【主角人设】
${ctx.charName}：${ctx.charDetail || "（请合理塑造）"}

【相关人物 - 仅作背景参考，此刻不在场】
${ctx.userName}：${ctx.userDetail || "（不必展开）"}

【两人关系】
${ctx.relationship || "（自然展开即可）"}

${ctx.worldbookText ? "【世界观参考】\n" + ctx.worldbookText : ""}
${ctx.summaryText ? "【过往故事摘要】\n" + ctx.summaryText : ""}

【写作要求】
- 字数约 ${wc} 字
- 第三人称，全知视角
- 着重 ${ctx.charName} 的动作、神态、心理活动；可以适当带过周围环境与其他人
- ${ctx.userName} 此刻不在场，不要让 ${ctx.userName} 出现
- 网文白妙文风：叙述自然，句子长短自由，不刻意分段，不用 *动作* 或 (动作) 形式
- 直接进入场景，不要前言

【三个选项 - 让 ${ctx.userName} 选择以什么身份继续观察 ${ctx.charName}】
- 选项1 必须固定为：作为透明人，靠近 Ta
- 选项2：变成 Ta 身边的一件具体物品（请你根据当前场景，给出一件具体存在的物品，不要写"一件物品"这种空话。比如"变成他书桌上那支用了很久的钢笔"）
- 选项3：变成 Ta 身边的另一件具体物品（与选项2不同）

【严格按以下格式输出】
---叙述---
（约 ${wc} 字的描写）
---选项1---
作为透明人，靠近 Ta
---选项2---
（具体物品）
---选项3---
（具体物品）`;
    } else {
      const recent = session.rounds.slice(-3).map((r, i) => {
        const num = session.rounds.length - 3 + i + 1;
        return `[第${num > 0 ? num : i + 1}幕]\n${r.narration}${r.userChoice ? "\n→ " + ctx.userName + "的行动：" + r.userChoice : ""}`;
      }).join("\n\n");

      prompt = `这是一个虚构创作世界。所有出场角色均已成年。

你是优秀的小说作者。整体基调：${tone}。

【主角人设】
${ctx.charName}：${ctx.charDetail || "（请合理塑造）"}

${ctx.userName}：${ctx.userDetail || ""}

【两人关系】
${ctx.relationship || ""}

${ctx.worldbookText ? "【世界观参考】\n" + ctx.worldbookText : ""}

【${ctx.userName} 当前的身份】
${session.identity}

【最近几幕剧情】
${recent}

【${ctx.userName} 刚刚的行动】
${lastUserChoice}

【任务】
把 ${ctx.userName} 的行动作为剧情中真实发生的物理事件融入叙述（比如笔没水了、钥匙掉地上、戒指硌到手、领带被风吹起），然后描写 ${ctx.charName} 对此的反应与场景推进。

【写作要求】
- 字数约 ${wc} 字
- 第三人称，全知视角
- 着重 ${ctx.charName} 的动作、神态、心理活动
- ${ctx.userName} 始终以"${session.identity}"这个身份在场，本人不会突然出现
- 网文白妙文风，叙述自然，禁止 *动作* 或 (动作) 形式
- 不要前言，直接续写

【三个选项】
基于 ${ctx.userName} 的身份"${session.identity}"，给出三个具体可执行的"行动"。每条 10-25 字，符合该身份能做的事。

【严格按以下格式输出】
---叙述---
（约 ${wc} 字）
---选项1---
（具体行动）
---选项2---
（具体行动）
---选项3---
（具体行动）`;
    }

    const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: maxTok });
    return parseRound(reply, isFirst);
  }

  function parseRound(reply, isFirst) {
    const m1 = reply.match(/---叙述---([\s\S]*?)---选项1---/);
    const m2 = reply.match(/---选项1---([\s\S]*?)---选项2---/);
    const m3 = reply.match(/---选项2---([\s\S]*?)---选项3---/);
    const m4 = reply.match(/---选项3---([\s\S]*?)$/);

    const narration = m1 ? m1[1].trim()
      : (reply.split("---选项1---")[0] || reply).trim();

    const c1 = m2 ? m2[1].trim() : (isFirst ? "作为透明人，靠近 Ta" : "继续静静观察");
    const c2 = m3 ? m3[1].trim() : (isFirst ? "变成桌上的笔" : "稍微靠近一点");
    const c3 = m4 ? m4[1].trim() : (isFirst ? "变成口袋里的钱包" : "等待时机");

    return { narration, choices: [c1, c2, c3] };
  }

  /* ============= 详情页 ============= */
  async function renderDetail() {
    const data = await loadData(state.convId);
    const session = (data.sessions || []).find(s => s.id === state.detailId);
    if (!session) { state.view = "home"; render(); return; }

    const scroll = document.getElementById("csScroll");
    let html = `
      <div class="ck-detail-head">
        <span class="ck-card-tag ck-type-${session.type}">${esc(TYPE_NAME_MAP[session.type])}</span>
        <span class="ck-detail-time">${fmtTime(session.createdAt)}</span>
        ${session.identity ? `<div class="ck-detail-identity">身份：${esc(session.identity)}</div>` : ""}
      </div>
    `;
    session.rounds.forEach((r, i) => {
      html += `
        <div class="ck-act-block">
          <div class="ck-act-num">第 ${i + 1} 幕</div>
          <div class="ck-narration">${formatContent(r.narration)}</div>
          ${r.userChoice ? `<div class="ck-user-choice">→ ${esc(r.userChoice)}</div>` : ""}
        </div>`;
    });
    html += `
      <div class="ck-detail-actions">
        <button class="ck-secondary-btn" id="ckContinueBtn">继续这次查岗</button>
        <button class="ck-danger-btn" id="ckDeleteBtn">删除记录</button>
      </div>
    `;
    scroll.innerHTML = html;

    document.getElementById("ckContinueBtn")?.addEventListener("click", () => {
      state.cfg.type = session.type;
      state.cfg.wordCount = session.wordCount || 800;
      state.sessionId = session.id;
      // 如果最后一幕用户还没选，直接进会话页继续选
      // 如果已经选了但没下一幕（理论上不会出现），也允许继续
      state.view = "session";
      render();
    });
    document.getElementById("ckDeleteBtn")?.addEventListener("click", async () => {
      if (!confirm("确定删除这次查岗记录？不可恢复。")) return;
      const fresh = await loadData(state.convId);
      fresh.sessions = (fresh.sessions || []).filter(s => s.id !== session.id);
      await saveData(state.convId, fresh);
      state.view = "home"; render();
      toast("已删除", "success");
    });
  }

  /* ============= Loading mask ============= */
  function showLoadingMask(text) {
    let el = document.getElementById("ckLoadingMask");
    if (!el) {
      el = document.createElement("div");
      el.id = "ckLoadingMask";
      el.className = "ck-loading-mask";
      el.innerHTML = `
        <div class="ck-loading-card">
          <div class="ck-loading-dots"><span></span><span></span><span></span></div>
          <div class="ck-loading-text" id="ckLoadingText">${esc(text || "处理中…")}</div>
        </div>`;
      document.body.appendChild(el);
    }
    const t = el.querySelector("#ckLoadingText");
    if (t) t.textContent = text || "处理中…";
    el.classList.add("show");
  }
  function hideLoadingMask() {
    const el = document.getElementById("ckLoadingMask");
    if (el) el.classList.remove("show");
  }

  window.coupleCheckinModule = { open: openCheckin };
  console.log("✅ couple-checkin 模块就绪");
})();