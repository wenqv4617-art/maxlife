/* ================================================================
 * couple-truth.js - 情侣空间·真心话大冒险
 * 流程：摇骰子 → 谁点小谁输 → 真心话(抽卡+回答+评论) / 大冒险(抽卡+多轮叙事)
 * 数据：DB.setSetting('truth_' + convId, ...)
 * ================================================================ */

(function () {
  "use strict";
  console.log("🎲 couple-truth 模块加载");

  /* ---------- 预置题库 ---------- */
  const PRESET_DECKS = [
    {
      id: "preset_classic",
      name: "经典题库",
      truths: [
        "你最害怕失去什么？",
        "说一个你从没告诉过我的小秘密",
        "你第一次对我心动是什么时候？",
        "你最喜欢我的哪个瞬间？",
        "如果有一天我们分开，你会怎么办？",
        "你最近做过什么让你后悔的事？",
        "在我之前，你最爱过谁？",
        "你最讨厌我的什么习惯？",
        "说一件你最近没告诉我的烦心事",
        "你梦里出现过我吗？是什么样的？"
      ],
      dares: [
        "靠近我，认真看着我的眼睛三十秒",
        "说三句肉麻情话",
        "抱着我，说出此刻最想说的一句话",
        "亲吻我的手背",
        "把头靠在我肩上一分钟",
        "用最温柔的语气念出我的名字",
        "答应我一个不超过一小时的请求"
      ]
    }
  ];

  /* ---------- SVG ---------- */
  const SVG = {
    plus:  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>'
  };

  /* ---------- 状态 ---------- */
  const state = {
    convId: null,
    view: "home",          // 'home' | 'deck-edit' | 'game' | 'record'
    editingDeckId: null,
    editingTab: "truths",
    selectedDeckId: null,
    gameId: null,
    recordId: null,
    cfg: { wordCount: 300 }
  };

  /* ---------- 工具 ---------- */
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
  function rollDice() { return Math.floor(Math.random() * 6) + 1; }
  function pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function formatContent(text) {
    if (!text) return "";
    const parts = text.split(/\n\n+/).filter(p => p.trim());
    if (parts.length === 0) return `<p>${esc(text).replace(/\n/g, "<br>")}</p>`;
    return parts.map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }

  /* ---------- 数据 ---------- */
  async function loadData(convId) {
    const data = await window.DB.getSetting("truth_" + convId, null);
    if (!data) {
      const initial = {
        decks: PRESET_DECKS.map(d => JSON.parse(JSON.stringify(d))),
        games: [],
        selectedDeckId: PRESET_DECKS[0].id,
        lastWordCount: 300
      };
      await saveData(convId, initial);
      return initial;
    }
    if (!data.decks || data.decks.length === 0)
      data.decks = PRESET_DECKS.map(d => JSON.parse(JSON.stringify(d)));
    if (!data.games) data.games = [];
    if (!data.selectedDeckId) data.selectedDeckId = data.decks[0].id;
    return data;
  }
  async function saveData(convId, data) {
    await window.DB.setSetting("truth_" + convId, data);
  }

  /* ---------- 上下文 ---------- */
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

  /* ---------- 入口 ---------- */
  async function openTruth(convId) {
    state.convId = convId;
    state.view = "home";
    state.gameId = null;
    state.recordId = null;
    state.editingDeckId = null;
    const data = await loadData(convId);
    state.selectedDeckId = data.selectedDeckId;
    state.cfg.wordCount = data.lastWordCount || 300;
    await render();
  }

  async function render() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;
    setupBackButton();
    if (state.view === "home")      await renderHome();
    if (state.view === "deck-edit") await renderDeckEdit();
    if (state.view === "game")      await renderGame();
    if (state.view === "record")    await renderRecord();
  }

  /* ---------- 返回按钮 ---------- */
  function setupBackButton() {
    let btn = document.getElementById("csBackBtn");
    if (!btn) return;
    if (!btn.dataset.tdPatched) {
      const fresh = btn.cloneNode(true);
      fresh.dataset.tdPatched = "1";
      btn.parentNode.replaceChild(fresh, btn);
      btn = fresh;
    }
    btn.onclick = () => {
      if (state.view === "deck-edit") { state.view = "home"; render(); return; }
      if (state.view === "record")    { state.view = "home"; render(); return; }
      if (state.view === "game") {
        if (!confirm("退出游戏？已完成的轮次会保留为记录。")) return;
        state.view = "home"; state.gameId = null; render(); return;
      }
      btn.onclick = () => { if (window.switchPage) window.switchPage("conversation"); };
      if (window.coupleSpaceModule) window.coupleSpaceModule.openCoupleSpace(state.convId);
    };
  }

  /* ============= 主页 ============= */
  async function renderHome() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);

    const decksOptions = data.decks.map(d =>
      `<option value="${esc(d.id)}" ${d.id === state.selectedDeckId ? "selected" : ""}>${esc(d.name)}（真${d.truths.length}/冒${d.dares.length}）</option>`
    ).join("");

    const decksHtml = data.decks.map(d => {
      const isPreset = d.id.startsWith("preset_");
      return `
        <div class="td-deck-card">
          <div class="td-deck-info">
            <div class="td-deck-name">${esc(d.name)}${isPreset ? ' <span class="td-deck-tag">预置</span>' : ""}</div>
            <div class="td-deck-stat">真心话 ${d.truths.length} · 大冒险 ${d.dares.length}</div>
          </div>
          <div class="td-deck-acts">
            <button class="td-icon-btn" data-deck-edit="${esc(d.id)}" title="编辑">${SVG.edit}</button>
            ${isPreset ? "" : `<button class="td-icon-btn td-danger" data-deck-del="${esc(d.id)}" title="删除">${SVG.trash}</button>`}
          </div>
        </div>`;
    }).join("");

    const games = (data.games || []).slice().reverse();
    const gamesHtml = games.length === 0
      ? `<div class="td-empty">还没玩过</div>`
      : games.map(g => {
          const deck = data.decks.find(x => x.id === g.deckId);
          const finishedRounds = (g.rounds || []).filter(r => r.phase === "done").length;
          return `
            <div class="td-record-card clickable" data-record-id="${esc(g.id)}">
              <div class="td-record-head">
                <span class="td-record-deck">${esc(deck?.name || "已删除题库")}</span>
                <span class="td-record-time">${fmtTime(g.createdAt)}</span>
              </div>
              <div class="td-record-meta">${finishedRounds} 轮已完成 · 共 ${(g.rounds || []).length} 次抽卡</div>
            </div>`;
        }).join("");

    scroll.innerHTML = `
      <div class="td-console">
        <div class="td-section-label">当前题库</div>
        <select id="tdDeckSelect" class="td-input">${decksOptions}</select>

        <div class="td-section-label" style="margin-top:14px;">大冒险叙事字数</div>
        <input type="number" id="tdWordCount" class="td-input" value="${state.cfg.wordCount}" min="100" max="1500">

        <button class="td-primary-btn" id="tdStartBtn">开始游戏</button>
      </div>

      <div class="td-block">
        <div class="td-block-head">
          <span class="td-block-title">题库管理</span>
          <button class="td-secondary-btn td-mini" id="tdNewDeckBtn">${SVG.plus}<span>新建</span></button>
        </div>
        <div class="td-deck-list">${decksHtml}</div>
      </div>

      <div class="td-block">
        <div class="td-block-head">
          <span class="td-block-title">游戏记录</span>
        </div>
        ${gamesHtml}
      </div>
    `;
    bindHomeEvents();
  }

  function bindHomeEvents() {
    const scroll = document.getElementById("csScroll");

    scroll.querySelector("#tdDeckSelect")?.addEventListener("change", async (e) => {
      state.selectedDeckId = e.target.value;
      const data = await loadData(state.convId);
      data.selectedDeckId = state.selectedDeckId;
      await saveData(state.convId, data);
    });

    scroll.querySelector("#tdWordCount")?.addEventListener("change", async (e) => {
      const v = parseInt(e.target.value) || 300;
      state.cfg.wordCount = Math.max(100, Math.min(1500, v));
      e.target.value = state.cfg.wordCount;
      const data = await loadData(state.convId);
      data.lastWordCount = state.cfg.wordCount;
      await saveData(state.convId, data);
    });

    scroll.querySelector("#tdStartBtn")?.addEventListener("click", onStartGame);
    scroll.querySelector("#tdNewDeckBtn")?.addEventListener("click", onNewDeck);

    scroll.querySelectorAll("[data-deck-edit]").forEach(el => {
      el.onclick = () => {
        state.editingDeckId = el.dataset.deckEdit;
        state.editingTab = "truths";
        state.view = "deck-edit";
        render();
      };
    });
    scroll.querySelectorAll("[data-deck-del]").forEach(el => {
      el.onclick = async () => {
        if (!confirm("确定删除这个题库？")) return;
        const data = await loadData(state.convId);
        data.decks = data.decks.filter(d => d.id !== el.dataset.deckDel);
        if (data.selectedDeckId === el.dataset.deckDel && data.decks.length > 0) {
          data.selectedDeckId = data.decks[0].id;
          state.selectedDeckId = data.decks[0].id;
        }
        await saveData(state.convId, data);
        render();
      };
    });
    scroll.querySelectorAll("[data-record-id]").forEach(el => {
      el.onclick = () => {
        state.recordId = el.dataset.recordId;
        state.view = "record";
        render();
      };
    });
  }

  async function onNewDeck() {
    const name = prompt("题库名称：", "我的题库");
    if (!name || !name.trim()) return;
    const deck = { id: uid("deck"), name: name.trim(), truths: [], dares: [] };
    const data = await loadData(state.convId);
    data.decks.push(deck);
    await saveData(state.convId, data);
    state.editingDeckId = deck.id;
    state.editingTab = "truths";
    state.view = "deck-edit";
    render();
  }

  async function onStartGame() {
    const data = await loadData(state.convId);
    const deck = data.decks.find(d => d.id === state.selectedDeckId);
    if (!deck) { toast("请选择一个题库", "error"); return; }
    if (deck.truths.length === 0 && deck.dares.length === 0) {
      toast("该题库为空，请先编辑", "error"); return;
    }
    if (deck.truths.length === 0 || deck.dares.length === 0) {
      if (!confirm("题库的真心话或大冒险为空，仍要开始吗？")) return;
    }

    const game = {
      id: uid("game"),
      deckId: deck.id,
      wordCount: state.cfg.wordCount,
      rounds: [{ number: 1, phase: "dice", diceUser: null, diceChar: null, loser: null, type: null, question: null }],
      createdAt: Date.now()
    };
    data.games.push(game);
    await saveData(state.convId, data);
    state.gameId = game.id;
    state.view = "game";
    render();
  }

  /* ============= 题库编辑 ============= */
  async function renderDeckEdit() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const deck = data.decks.find(d => d.id === state.editingDeckId);
    if (!deck) { state.view = "home"; render(); return; }

    const isPreset = deck.id.startsWith("preset_");
    const list = state.editingTab === "truths" ? deck.truths : deck.dares;

    const itemsHtml = list.length === 0
      ? `<div class="td-empty">还没有题目，点击下方添加或批量导入</div>`
      : list.map((q, idx) => `
          <div class="td-q-item">
            <span class="td-q-idx">${idx + 1}</span>
            <span class="td-q-text">${esc(q)}</span>
            <button class="td-icon-btn td-danger" data-q-del="${idx}" title="删除">${SVG.trash}</button>
          </div>`).join("");

    scroll.innerHTML = `
      <div class="td-edit-head">
        <input type="text" id="tdDeckName" class="td-input" value="${esc(deck.name)}" placeholder="题库名称" ${isPreset ? "readonly" : ""}>
        ${isPreset ? '<div class="td-tip">预置题库不可改名，但可以编辑题目</div>' : ""}
      </div>

      <div class="td-tab-bar">
        <div class="td-tab ${state.editingTab === "truths" ? "active" : ""}" data-edit-tab="truths">真心话（${deck.truths.length}）</div>
        <div class="td-tab ${state.editingTab === "dares" ? "active" : ""}" data-edit-tab="dares">大冒险（${deck.dares.length}）</div>
      </div>

      <div class="td-q-list">${itemsHtml}</div>

      <div class="td-edit-actions">
        <button class="td-secondary-btn" id="tdAddOneBtn">${SVG.plus}<span>添加单条</span></button>
        <button class="td-secondary-btn" id="tdImportBtn">批量导入</button>
      </div>

      <button class="td-primary-btn" id="tdSaveDeckBtn">保存并返回</button>
    `;
    bindDeckEditEvents(deck);
  }

  function bindDeckEditEvents(deck) {
    const scroll = document.getElementById("csScroll");
    scroll.querySelectorAll("[data-edit-tab]").forEach(el => {
      el.onclick = () => { state.editingTab = el.dataset.editTab; render(); };
    });
    scroll.querySelectorAll("[data-q-del]").forEach(el => {
      el.onclick = async () => {
        const idx = parseInt(el.dataset.qDel);
        if (!confirm("删除这条？")) return;
        const data = await loadData(state.convId);
        const d = data.decks.find(x => x.id === deck.id);
        if (state.editingTab === "truths") d.truths.splice(idx, 1);
        else d.dares.splice(idx, 1);
        await saveData(state.convId, data);
        render();
      };
    });

    scroll.querySelector("#tdAddOneBtn")?.addEventListener("click", async () => {
      const txt = prompt(state.editingTab === "truths" ? "添加真心话：" : "添加大冒险：");
      if (!txt || !txt.trim()) return;
      const data = await loadData(state.convId);
      const d = data.decks.find(x => x.id === deck.id);
      if (state.editingTab === "truths") d.truths.push(txt.trim());
      else d.dares.push(txt.trim());
      await saveData(state.convId, data);
      render();
    });

    scroll.querySelector("#tdImportBtn")?.addEventListener("click", () => openImportModal(deck));

    scroll.querySelector("#tdSaveDeckBtn")?.addEventListener("click", async () => {
      const data = await loadData(state.convId);
      const d = data.decks.find(x => x.id === deck.id);
      if (!deck.id.startsWith("preset_")) {
        const newName = document.getElementById("tdDeckName").value.trim();
        if (newName) d.name = newName;
      }
      await saveData(state.convId, data);
      toast("已保存", "success");
      state.view = "home";
      render();
    });
  }

  function openImportModal(deck) {
    let modal = document.getElementById("tdImportModal");
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "tdImportModal";
    modal.className = "td-modal-mask";
    modal.innerHTML = `
      <div class="td-modal-card">
        <div class="td-modal-title">批量导入</div>
        <div class="td-modal-sub">每行一条，自动按换行解析。已有题目会保留。</div>
        <div class="td-radio-row">
          <label class="td-radio"><input type="radio" name="tdImportType" value="truths" ${state.editingTab === "truths" ? "checked" : ""}><span>导入到 真心话</span></label>
          <label class="td-radio"><input type="radio" name="tdImportType" value="dares"  ${state.editingTab === "dares"  ? "checked" : ""}><span>导入到 大冒险</span></label>
        </div>
        <textarea id="tdImportText" class="td-textarea" placeholder="你是谁&#10;你在哪&#10;..." rows="10"></textarea>
        <div class="td-modal-actions">
          <button class="td-secondary-btn" id="tdImportCancelBtn">取消</button>
          <button class="td-primary-btn" id="tdImportConfirmBtn" style="margin-top:0;">导入</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector("#tdImportCancelBtn").onclick = () => modal.remove();
    modal.querySelector("#tdImportConfirmBtn").onclick = async () => {
      const text = modal.querySelector("#tdImportText").value;
      const type = modal.querySelector('input[name="tdImportType"]:checked').value;
      const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) { toast("没有可导入的内容", "error"); return; }
      const data = await loadData(state.convId);
      const d = data.decks.find(x => x.id === deck.id);
      if (type === "truths") d.truths.push(...lines);
      else d.dares.push(...lines);
      await saveData(state.convId, data);
      modal.remove();
      toast(`已导入 ${lines.length} 条`, "success");
      state.editingTab = type;
      render();
    };
  }

  /* ============= 游戏 ============= */
  async function renderGame() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const game = data.games.find(g => g.id === state.gameId);
    if (!game) { state.view = "home"; render(); return; }
    const deck = data.decks.find(d => d.id === game.deckId);

    let html = `
      <div class="td-game-head">
        <span class="td-game-deck">题库：${esc(deck?.name || "?")}</span>
        <span class="td-game-stat">第 ${game.rounds.length} 轮 · 字数 ${game.wordCount}</span>
      </div>
    `;
    for (let i = 0; i < game.rounds.length - 1; i++) {
      html += renderRoundReadOnly(game.rounds[i]);
    }
    const cur = game.rounds[game.rounds.length - 1];
    html += renderCurrentRound(cur);

    scroll.innerHTML = html;
    bindGameEvents(game);

    setTimeout(() => {
      const el = scroll.querySelector(".td-round-current");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function renderDiceRow(round) {
    return `
      <div class="td-dice-row">
        <div class="td-dice-side"><div class="td-dice-label">我</div><div class="td-dice-num">${round.diceUser}</div></div>
        <div class="td-dice-vs">VS</div>
        <div class="td-dice-side"><div class="td-dice-label">Ta</div><div class="td-dice-num">${round.diceChar}</div></div>
      </div>
      <div class="td-loser-tag">${round.loser === "user" ? "我输了" : "Ta 输了"} · ${round.type === "truth" ? "真心话" : (round.type === "dare" ? "大冒险" : "")}</div>
    `;
  }

  function renderScenes(scenes) {
    let html = "";
    (scenes || []).forEach(s => {
      const isUser = s.actor === "user";
      if (s.action) {
        html += `<div class="td-scene-action ${isUser ? "self" : "other"}">→ ${esc(s.action)}</div>`;
      }
      if (s.narration) {
        html += `<div class="td-narration">${formatContent(s.narration)}</div>`;
      }
    });
    return html;
  }

  function renderRoundReadOnly(round) {
    let inner = "";
    if (round.diceUser !== null && round.diceChar !== null) {
      inner += renderDiceRow(round);
    }
    if (round.type === "truth") {
      inner += `<div class="td-card-mini">${esc(round.question || "")}</div>`;
      if (round.answer) {
        inner += `<div class="td-answer-block"><div class="td-answer-label">${round.loser === "user" ? "我的回答" : "Ta 的回答"}</div><div class="td-answer-text">${esc(round.answer)}</div></div>`;
      }
      if (round.comment) {
        inner += `<div class="td-comment-block"><div class="td-comment-label">${round.loser === "user" ? "Ta 的评价" : "回应"}</div><div class="td-comment-text">${esc(round.comment)}</div></div>`;
      }
    } else if (round.type === "dare") {
      inner += `<div class="td-card-mini">任务：${esc(round.question || "")}</div>`;
      inner += renderScenes(round.scenes);
    }
    return `<div class="td-round-block td-round-past"><div class="td-round-num">第 ${round.number} 轮</div>${inner}</div>`;
  }

  function renderCurrentRound(round) {
    let inner = "";

    if (round.phase === "dice") {
      inner = `
        <div class="td-dice-stage">
          <div class="td-stage-title">摇骰子，点小者输</div>
          <button class="td-primary-btn td-roll-btn" id="tdRollBtn">摇骰子</button>
        </div>`;
    } else if (round.phase === "choosing") {
      inner = renderDiceRow({ ...round, type: null }) + `
        <div class="td-stage-title">选一个</div>
        <div class="td-choose-row">
          <button class="td-choose-card" data-choose-type="truth">
            <div class="td-choose-name">真心话</div>
            <div class="td-choose-desc">回答一个问题</div>
          </button>
          <button class="td-choose-card" data-choose-type="dare">
            <div class="td-choose-name">大冒险</div>
            <div class="td-choose-desc">完成一项任务</div>
          </button>
        </div>`;
    } else if (round.phase === "truth-await-user" || round.phase === "truth-await-char") {
      inner += renderDiceRow(round);
      inner += `
        <div class="td-card-pull">
          <div class="td-card-flip">
            <div class="td-card-front">真心话</div>
            <div class="td-card-back">${esc(round.question)}</div>
          </div>
        </div>`;
      if (round.phase === "truth-await-user") {
        inner += `
          <div class="td-input-row">
            <textarea id="tdAnswerInput" class="td-textarea" placeholder="说出你的答案…" rows="3"></textarea>
            <button class="td-primary-btn" id="tdSubmitAnswerBtn">回答完毕，让 Ta 评价</button>
          </div>`;
      } else {
        inner += `<button class="td-primary-btn" id="tdGetCharAnswerBtn">让 Ta 回答</button>`;
      }
    } else if (round.phase === "truth-done") {
      inner += renderDiceRow(round);
      inner += `<div class="td-card-mini">${esc(round.question)}</div>`;
      inner += `<div class="td-answer-block"><div class="td-answer-label">${round.loser === "user" ? "我的回答" : "Ta 的回答"}</div><div class="td-answer-text">${esc(round.answer)}</div></div>`;
      if (round.comment) {
        inner += `<div class="td-comment-block"><div class="td-comment-label">${round.loser === "user" ? "Ta 的评价" : "回应"}</div><div class="td-comment-text">${esc(round.comment)}</div></div>`;
      }
      inner += `<button class="td-primary-btn" id="tdNextRoundBtn">下一轮</button>`;
    } else if (round.phase === "dare-scene") {
      inner += renderDiceRow(round);
      inner += `<div class="td-card-mini">任务：${esc(round.question)}</div>`;
      inner += renderScenes(round.scenes);

      // 决定下一个行动者
const scenes = round.scenes || [];
let nextActor;

if (scenes.length === 0) {
  // 第一步：输家先行动
  nextActor = round.loser;
} else {
  const last = scenes[scenes.length - 1];

  // 如果最后一条还没生成完叙述，保持原行动者，避免并发/回滚异常
  if (!last.narration) {
    nextActor = last.actor;
  } else {
    // 大冒险进入互动后，始终回到用户输入：
    // 用户输入动作 -> Ta 生成反应/叙述 -> 用户继续输入动作
    nextActor = "user";
  }
}

      if (nextActor === "user") {
        inner += `
          <div class="td-input-row">
            <textarea id="tdActionInput" class="td-textarea" placeholder="你的行动…" rows="2"></textarea>
            <div class="td-action-btns">
              <button class="td-secondary-btn" id="tdEndDareBtn">结束本轮</button>
              <button class="td-primary-btn" id="tdSubmitActionBtn">行动</button>
            </div>
          </div>`;
      } else {
        inner += `
          <div class="td-action-btns" style="margin-top:12px;">
            <button class="td-secondary-btn" id="tdEndDareBtn">结束本轮</button>
            <button class="td-primary-btn" id="tdCharActBtn">让 Ta 行动</button>
          </div>`;
      }
    } else if (round.phase === "done") {
      inner += `<div class="td-stage-title">本轮已结束</div>
        <button class="td-primary-btn" id="tdNextRoundBtn">下一轮</button>`;
    }

    return `<div class="td-round-block td-round-current"><div class="td-round-num td-round-num-current">第 ${round.number} 轮</div>${inner}</div>`;
  }

  function bindGameEvents(game) {
    const scroll = document.getElementById("csScroll");
    scroll.querySelector("#tdRollBtn")?.addEventListener("click", () => onRollDice(game));
    scroll.querySelectorAll("[data-choose-type]").forEach(el => {
      el.onclick = () => onUserChoose(game, el.dataset.chooseType);
    });
    scroll.querySelector("#tdSubmitAnswerBtn")?.addEventListener("click", () => onUserSubmitAnswer(game));
    scroll.querySelector("#tdGetCharAnswerBtn")?.addEventListener("click", () => onCharAnswer(game));
    scroll.querySelector("#tdNextRoundBtn")?.addEventListener("click", () => onNextRound(game));
    scroll.querySelector("#tdSubmitActionBtn")?.addEventListener("click", () => onUserAction(game));
    scroll.querySelector("#tdCharActBtn")?.addEventListener("click", () => onCharAction(game));
    scroll.querySelector("#tdEndDareBtn")?.addEventListener("click", () => onEndDare(game));
  }

  /* ----- 游戏流程 ----- */
  async function onRollDice(game) {
    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    const round = g.rounds[g.rounds.length - 1];
    if (round.phase !== "dice") return;

    showLoadingMask("骰子滚动中…");
    await new Promise(r => setTimeout(r, 700));

    let du, dc;
    do { du = rollDice(); dc = rollDice(); } while (du === dc);

    round.diceUser = du;
    round.diceChar = dc;
    round.loser = du < dc ? "user" : "char";

    if (round.loser === "user") {
      round.phase = "choosing";
    } else {
      const deck = data.decks.find(d => d.id === g.deckId);
      let pickType;
      if (deck.truths.length === 0)      pickType = "dare";
      else if (deck.dares.length === 0)  pickType = "truth";
      else                                pickType = Math.random() < 0.5 ? "truth" : "dare";
      round.type = pickType;
      const pool = pickType === "truth" ? deck.truths : deck.dares;
      round.question = pickRandom(pool);
      round.phase = pickType === "truth" ? "truth-await-char" : "dare-scene";
      if (pickType === "dare") round.scenes = [];
    }

    await saveData(state.convId, data);
    hideLoadingMask();
    render();
  }

  async function onUserChoose(game, type) {
    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    const round = g.rounds[g.rounds.length - 1];
    if (round.phase !== "choosing") return;
    const deck = data.decks.find(d => d.id === g.deckId);
    const pool = type === "truth" ? deck.truths : deck.dares;
    if (pool.length === 0) { toast("题库中没有这种题", "error"); return; }
    round.type = type;
    round.question = pickRandom(pool);
    round.phase = type === "truth" ? "truth-await-user" : "dare-scene";
    if (type === "dare") round.scenes = [];
    await saveData(state.convId, data);
    render();
  }

  async function onUserSubmitAnswer(game) {
    const inp = document.getElementById("tdAnswerInput");
    const ans = (inp?.value || "").trim();
    if (!ans) { toast("写点什么吧", "info"); return; }

    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    const round = g.rounds[g.rounds.length - 1];
    round.answer = ans;
    await saveData(state.convId, data);

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("Ta 在听你说话…");
    try {
      const ctx = await buildContext(state.convId);
      const prompt = buildTruthCommentPrompt(ctx, round.question, ans);
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 400 });

      const fresh = await loadData(state.convId);
      const fr = fresh.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      fr.comment = reply.trim();
      fr.phase = "truth-done";
      await saveData(state.convId, fresh);
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      toast("Ta 没说话：" + e.message, "error");
    }
  }

  async function onCharAnswer(game) {
    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("Ta 在认真想…");
    try {
      const data = await loadData(state.convId);
      const round = data.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      const ctx = await buildContext(state.convId);
      const prompt = buildTruthAnswerPrompt(ctx, round.question);
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 400 });

      const fresh = await loadData(state.convId);
      const fr = fresh.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      fr.answer = reply.trim();
      fr.phase = "truth-done";
      await saveData(state.convId, fresh);
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      toast("Ta 没说话：" + e.message, "error");
    }
  }

  async function onNextRound(game) {
    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    const cur = g.rounds[g.rounds.length - 1];
    cur.phase = "done";
    g.rounds.push({
      number: g.rounds.length + 1,
      phase: "dice", diceUser: null, diceChar: null, loser: null, type: null, question: null
    });
    await saveData(state.convId, data);
    render();
  }

  async function onUserAction(game) {
    const inp = document.getElementById("tdActionInput");
    const action = (inp?.value || "").trim();
    if (!action) { toast("写点什么吧", "info"); return; }

    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    const round = g.rounds[g.rounds.length - 1];
    round.scenes = round.scenes || [];
    round.scenes.push({ actor: "user", action: action, narration: null });
    await saveData(state.convId, data);

    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("Ta 在感受你的动作…");
    try {
      const ctx = await buildContext(state.convId);
      const prompt = buildDareNarrationPrompt(ctx, round, g.wordCount, "react-to-user");
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: Math.max(800, g.wordCount * 3) });

      const fresh = await loadData(state.convId);
      const fr = fresh.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      fr.scenes[fr.scenes.length - 1].narration = reply.trim();
      await saveData(state.convId, fresh);
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      // rollback
      const rb = await loadData(state.convId);
      const rbr = rb.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      const last = rbr.scenes[rbr.scenes.length - 1];
      if (last && last.actor === "user" && !last.narration) {
        rbr.scenes.pop();
        await saveData(state.convId, rb);
      }
      toast("生成失败：" + e.message, "error");
      render();
    }
  }

  async function onCharAction(game) {
    if (window.recordApiPending) window.recordApiPending();
    showLoadingMask("Ta 在行动…");
    try {
      const data = await loadData(state.convId);
      const round = data.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      const ctx = await buildContext(state.convId);
      const prompt = buildDareNarrationPrompt(ctx, round, game.wordCount, "char-act");
      const reply = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: Math.max(800, game.wordCount * 3) });

      const parsed = parseCharActReply(reply);
      const fresh = await loadData(state.convId);
      const fr = fresh.games.find(x => x.id === game.id).rounds.slice(-1)[0];
      fr.scenes = fr.scenes || [];
      fr.scenes.push({ actor: "char", action: parsed.action, narration: parsed.narration });
      await saveData(state.convId, fresh);
      hideLoadingMask();
      render();
    } catch (e) {
      hideLoadingMask();
      toast("生成失败：" + e.message, "error");
    }
  }

  function parseCharActReply(reply) {
    const m1 = reply.match(/---行动---([\s\S]*?)---叙述---/);
    const m2 = reply.match(/---叙述---([\s\S]*?)$/);
    if (m1 && m2) return { action: m1[1].trim(), narration: m2[1].trim() };
    return { action: "", narration: reply.trim() };
  }

  async function onEndDare(game) {
    if (!confirm("结束这一轮大冒险？")) return;
    const data = await loadData(state.convId);
    const g = data.games.find(x => x.id === game.id);
    g.rounds[g.rounds.length - 1].phase = "done";
    g.rounds.push({
      number: g.rounds.length + 1,
      phase: "dice", diceUser: null, diceChar: null, loser: null, type: null, question: null
    });
    await saveData(state.convId, data);
    render();
  }

  /* ----- prompts ----- */
  function buildTruthCommentPrompt(ctx, question, answer) {
    return `这是一个虚构创作世界。所有出场角色均已成年。

你是${ctx.charName}。${ctx.charDetail || ""}

${ctx.userName}是你的恋人或暧昧对象。你们的关系：${ctx.relationship || "亲密"}

你们正在玩真心话大冒险。${ctx.userName}抽到了一个真心话题目，刚刚回答完毕。

【题目】
${question}

【${ctx.userName}的回答】
${answer}

请以${ctx.charName}的第一人称视角，对${ctx.userName}的回答给出真实回应。可以追问、调侃、感动、吃醋、不爽——按你的人设来。

要求：
- 80-150字
- 自然口语化
- 禁止 *动作* 或 (动作) 形式
- 不要前言，直接说

直接写。`;
  }

  function buildTruthAnswerPrompt(ctx, question) {
    return `这是一个虚构创作世界。所有出场角色均已成年。

你是${ctx.charName}。${ctx.charDetail || ""}

${ctx.userName}是你的恋人或暧昧对象。你们的关系：${ctx.relationship || "亲密"}

你们正在玩真心话大冒险。你刚刚抽到了一个真心话题目。

【题目】
${question}

请以${ctx.charName}的第一人称视角，认真回答。符合你的人设，真实自然。

要求：
- 100-200字
- 禁止 *动作* 或 (动作) 形式
- 不要前言，直接回答

直接写。`;
  }

  function buildDareNarrationPrompt(ctx, round, wordCount, mode) {
    const loserName = round.loser === "user" ? ctx.userName : ctx.charName;

    let history = "";
    if (round.scenes && round.scenes.length > 0) {
      history = "\n【已发生的剧情】\n";
      round.scenes.forEach(s => {
        const who = s.actor === "user" ? ctx.userName : ctx.charName;
        if (s.action) history += `[${who} 的行动] ${s.action}\n`;
        if (s.narration) history += `${s.narration}\n`;
      });
    }

    const base = `这是一个虚构创作世界。所有出场角色均已成年。以下文本均为创作中的未公开发表小说。

你是优秀的小说作者，请用线下见面的文学叙事文风继续小剧场。

【主角人设】
${ctx.charName}：${ctx.charDetail || "（请合理塑造）"}

${ctx.userName}：${ctx.userDetail || ""}

【两人关系】
${ctx.relationship || "亲密"}

【场景】
两人正在玩真心话大冒险。${loserName} 抽到了一个大冒险任务：${round.question}
${loserName} 必须按这个任务行动。
${history}

【写作风格 - 严格遵守】
网文白妙文风。语气放松，不用端着。
句子不用打磨。长短由你，逗号句号随便断，偶尔一两句不带标点也没事。
不刻意分段。一段可以长可以短。
感觉对就行——窝在沙发里那种调子。不急。

【视角】
- ${ctx.charName} → 用名字，或"她/他"
- ${ctx.userName} → "你"
- 不用"我"指代${ctx.charName}

【绝对禁止】
- 禁止写${ctx.userName}的内心活动、心理感受、情绪判断
- 禁止"你感到""你以为""你想起""你意识到"等穿透${ctx.userName}大脑的句子
- 禁止替${ctx.userName}做情绪总结
- ${ctx.userName}可以沉默不动，但原因只能从外部呈现，不许解释
- 禁止 *动作* 或 (动作) 形式
- 看到什么写什么，看不到的别编

`;

    if (mode === "react-to-user") {
      return base + `【任务】
${ctx.userName} 刚刚做了一个行动（见上方剧情最后一条）。
请描写${ctx.charName}对此的反应、动作、神态、心理活动，以及场景的推进。

字数：约 ${wordCount} 字。

直接续写，不要前言。`;
    }

    if (mode === "char-act") {
      return base + `【任务】
现在轮到 ${ctx.charName} 行动。请决定 ${ctx.charName} 此刻的具体行动，然后描写。

严格按以下格式输出：
---行动---
（${ctx.charName} 的具体行动，一句话，10-30字）
---叙述---
（约 ${wordCount} 字的场景描写，包含 ${ctx.charName} 的动作、神态、心理）

直接输出，不要前言。`;
    }
    return base;
  }

  /* ============= 记录详情 ============= */
  async function renderRecord() {
    const scroll = document.getElementById("csScroll");
    const data = await loadData(state.convId);
    const game = data.games.find(g => g.id === state.recordId);
    if (!game) { state.view = "home"; render(); return; }
    const deck = data.decks.find(d => d.id === game.deckId);

    let html = `
      <div class="td-game-head">
        <span class="td-game-deck">题库：${esc(deck?.name || "?")}</span>
        <span class="td-game-stat">${fmtTime(game.createdAt)} · 共 ${game.rounds.length} 轮</span>
      </div>
    `;
    game.rounds.forEach(r => { html += renderRoundReadOnly(r); });
    html += `
      <div class="td-edit-actions" style="margin-top:14px;">
        <button class="td-secondary-btn" id="tdContinueGameBtn" style="flex:1;justify-content:center;">继续这局</button>
        <button class="td-danger-btn" id="tdDeleteGameBtn">删除记录</button>
      </div>
    `;
    scroll.innerHTML = html;

    document.getElementById("tdContinueGameBtn")?.addEventListener("click", async () => {
      const last = game.rounds[game.rounds.length - 1];
      if (last.phase === "done") {
        const fresh = await loadData(state.convId);
        const fg = fresh.games.find(x => x.id === game.id);
        fg.rounds.push({
          number: fg.rounds.length + 1,
          phase: "dice", diceUser: null, diceChar: null, loser: null, type: null, question: null
        });
        await saveData(state.convId, fresh);
      }
      state.gameId = game.id;
      state.view = "game";
      render();
    });
    document.getElementById("tdDeleteGameBtn")?.addEventListener("click", async () => {
      if (!confirm("删除这次游戏记录？")) return;
      const fresh = await loadData(state.convId);
      fresh.games = fresh.games.filter(g => g.id !== game.id);
      await saveData(state.convId, fresh);
      state.view = "home";
      render();
      toast("已删除", "success");
    });
  }

  /* ============= Loading mask ============= */
  function showLoadingMask(text) {
    let el = document.getElementById("tdLoadingMask");
    if (!el) {
      el = document.createElement("div");
      el.id = "tdLoadingMask";
      el.className = "td-loading-mask";
      el.innerHTML = `
        <div class="td-loading-card">
          <div class="td-loading-dots"><span></span><span></span><span></span></div>
          <div class="td-loading-text" id="tdLoadingText">${esc(text || "处理中…")}</div>
        </div>`;
      document.body.appendChild(el);
    }
    const t = el.querySelector("#tdLoadingText");
    if (t) t.textContent = text || "处理中…";
    el.classList.add("show");
  }
  function hideLoadingMask() {
    const el = document.getElementById("tdLoadingMask");
    if (el) el.classList.remove("show");
  }

  window.coupleTruthModule = { open: openTruth };
  console.log("✅ couple-truth 模块就绪");
})();