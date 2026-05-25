/* ================================================================
 * couple-live.js - 情侣空间 · 直播系统
 *
 * 功能：
 * 1. 情侣空间新增「直播系统」
 * 2. 面板：直播开关 弹幕数量 / 粉丝量 / 打赏榜 / 独立世界书挂载
 * 3. 粉丝通道：粉丝群 / char 私信箱 / user 私信箱
 * 4. 开启直播后，监听 chats 入库，每轮 char / assistant / offline_card 回复后自动生成弹幕
 * 5. 弹幕从右往左飘，支持评论 / 打赏 / 关注
 * 6. 粉丝群、私信对话固定聊天区，聊天记录内部滚动
 * 7. 私信箱支持强制触发新私信
 * 8. char 私信：左侧获取 Ta 回复，右侧小飞机获取网友回复
 * 9. user 私信：输入框回车上屏，小飞机获取网友回复
 *
 * 依赖：
 * window.DB, window.callLLM, window.showStatus, window.escapeHtml,
 * window.switchPage, window.currentConversationId
 * ================================================================ */

(function () {
  "use strict";
  console.log("LIVE SYSTEM module loading");

  const SVG = {
    live:
      '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M10 10l4 2-4 2z"/></svg>',

    back:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',

    arrow:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',

    group:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',

    inbox:
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',

    send:
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
  };

  const DEFAULT_CFG = {
    enabled: false,
    minBullets: 4,
    maxBullets: 9,
    fans: 1280,
    lastProcessedChatId: null,
    mountedWorldbookIds: [],
    rank: [
      { name: "BlackCard", amount: 3200 },
      { name: "SignalLost", amount: 2100 },
      { name: "白噪声", amount: 1560 }
    ],
    fanGroup: [],
    charInbox: [],
    userInbox: []
  };

  const clDebounceTimers = {};

  function esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"]/g, m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    }[m]));
  }

  function nowTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    return (
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }

  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function clamp(n, min, max) {
    n = Number(n);
    if (Number.isNaN(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function cfgKey(convId) {
    return "couple_live_cfg_" + convId;
  }

  function safeClone(obj) {
    try {
      return structuredClone(obj);
    } catch (e) {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  async function getCfg(convId) {
    const DB = window.DB;
    if (!DB) return safeClone(DEFAULT_CFG);

    const v = await DB.getSetting(cfgKey(convId), null);
    const cfg = Object.assign({}, safeClone(DEFAULT_CFG), v || {});

    if (!Array.isArray(cfg.rank)) cfg.rank = [];
    if (!Array.isArray(cfg.fanGroup)) cfg.fanGroup = [];
    if (!Array.isArray(cfg.charInbox)) cfg.charInbox = [];
    if (!Array.isArray(cfg.userInbox)) cfg.userInbox = [];
    if (!Array.isArray(cfg.mountedWorldbookIds)) cfg.mountedWorldbookIds = [];

    cfg.minBullets = clamp(cfg.minBullets, 1, 50);
    cfg.maxBullets = clamp(cfg.maxBullets, cfg.minBullets, 80);
    cfg.fans = Number(cfg.fans || 0);

    return cfg;
  }

  async function saveCfg(convId, cfg) {
    const DB = window.DB;
    if (!DB) return;
    await DB.setSetting(cfgKey(convId), cfg);
  }

  async function getConvInfo(convId) {
    const DB = window.DB;
    if (!DB) return null;

    const conv = await DB.get("conversations", convId);
    if (!conv) return null;

    const char = await DB.get("characters", conv.charId);
    const mask = await DB.get("userProfiles", conv.maskId);
    const detail = await DB.get("convDetails", convId);

    let charName = char?.name || "CHAR";
    let userName = mask?.name || "USER";
    let charDetail = char?.detail || "";
    let userDetail = mask?.bio || "";
    let relation = "";

    if (detail) {
      if (detail.charName) charName = detail.charName;
      if (detail.userName) userName = detail.userName;
      if (detail.charDetail) charDetail = detail.charDetail;
      if (detail.userDetail) userDetail = detail.userDetail;
      if (detail.relationship) relation = detail.relationship;
    }

    return {
      conv,
      char,
      mask,
      detail,
      charName,
      userName,
      charDetail,
      userDetail,
      relation
    };
  }

  /* ------------------------------------------------------------
   * 直播触发器：监听 chats 入库
   * ------------------------------------------------------------ */

  function scheduleLiveCheck(convId) {
    if (!convId) return;

    clearTimeout(clDebounceTimers[convId]);

    // 延迟一点，避免 assistant 一次回复多条消息时触发多次
    clDebounceTimers[convId] = setTimeout(() => {
      maybeGenerateLiveBullets(convId);
    }, 900);
  }

  function patchDBPutForLive() {
    if (!window.DB || !window.DB.put || window.DB.put._clLivePatched) return;

    const originalPut = window.DB.put.bind(window.DB);

    window.DB.put = async function (store, obj) {
      const result = await originalPut(store, obj);

      try {
        if (store === "chats" && obj && obj.conversationId) {
          const isCharReply =
            obj.role === "assistant" ||
            obj.role === "char" ||
            obj.messageType === "offline_card";

          const ignoredTypes = new Set([
            "innerVoice",
            "phone_intrusion",
            "mode_switch",
            "voice_call_msg"
          ]);

          if (isCharReply && !ignoredTypes.has(obj.messageType)) {
            console.log("[LIVE] chat put detected", obj.conversationId, obj.role, obj.messageType);
            scheduleLiveCheck(obj.conversationId);
          }
        }
      } catch (e) {
        console.warn("[LIVE] DB.put hook error:", e);
      }

      return result;
    };

    window.DB.put._clLivePatched = true;
    console.log("[LIVE] DB.put hook patched");
  }

  function setupPatchPolling() {
    let attempts = 0;

    const id = setInterval(() => {
      if (window.DB && window.DB.put && !window.DB.put._clLivePatched) {
        patchDBPutForLive();
        clearInterval(id);
        return;
      }

      attempts++;
      if (attempts > 100) {
        clearInterval(id);
        console.warn("[LIVE] DB.put hook patch timeout");
      }
    }, 100);
  }

  /* ------------------------------------------------------------
   * 在情侣空间注入“直播系统”入口
   * ------------------------------------------------------------ */

  function injectEntry() {
    const scroll = document.getElementById("csScroll");
    if (!scroll) return;
    if (scroll.querySelector("[data-cs-key='live']")) return;

    const sections = scroll.querySelector(".cs-sections");
    if (!sections) return;

    const card = document.createElement("div");
    card.className = "cl-entry-card clickable";
    card.dataset.csKey = "live";
    card.innerHTML = `
      <div class="cl-entry-icon">${SVG.live}</div>
      <div class="cl-entry-text">
        <div class="cl-entry-title">直播系统</div>
        <div class="cl-entry-desc">开放围观、弹幕、粉丝群与私信通道</div>
      </div>
      <div class="cl-entry-go">${SVG.arrow}</div>
    `;

    card.addEventListener("click", () => {
      const convId = window._currentCoupleSpaceConvId || window.currentConversationId;
      if (!convId) {
        window.showStatus && window.showStatus("请先进入对话", "error");
        return;
      }
      openLiveHome(convId);
    });

    sections.appendChild(card);
  }

  function observeCoupleSpace() {
    const mo = new MutationObserver(() => injectEntry());
    mo.observe(document.body, { childList: true, subtree: true });

    setTimeout(injectEntry, 300);
    setTimeout(injectEntry, 1000);
    setTimeout(injectEntry, 2000);
  }

  /* ------------------------------------------------------------
   * 页面骨架
   * ------------------------------------------------------------ */

  function ensureLivePage() {
    let page = document.getElementById("page-couple-live");
    if (page) return page;

    page = document.createElement("div");
    page.id = "page-couple-live";
    page.className = "page cl-page";
    page.innerHTML = `
      <div class="chat-header cs-header">
        <div class="chat-header-left">
          <button class="back-btn clickable" id="clBackBtn">${SVG.back}</button>
          <h2 class="cs-title">LIVE SYSTEM</h2>
        </div>
        <div class="header-actions"></div>
      </div>
      <div class="cl-scroll" id="clScroll"></div>
    `;

    const appMain = document.querySelector(".app-main");
    if (appMain) appMain.appendChild(page);
    else document.body.appendChild(page);

    page.querySelector("#clBackBtn").addEventListener("click", () => {
      const convId = window._currentCoupleLiveConvId || window.currentConversationId;
      if (window.coupleSpaceModule && window.coupleSpaceModule.openCoupleSpace) {
        window.coupleSpaceModule.openCoupleSpace(convId);
      } else if (window.switchPage) {
        window.switchPage("conversation");
      }
    });

    return page;
  }

  function activateLivePage() {
    document.querySelectorAll(".page").forEach(p => {
      if (p.id === "page-couple-live") return;
      p.classList.remove("active");
      if (p.style.display && p.style.display !== "none") p.style.display = "none";
    });

    const homeMain = document.getElementById("homeMain");
    const homeDock = document.querySelector(".home-dock");
    const pageInd = document.querySelector(".page-indicator");
    const appMain = document.querySelector(".app-main");
    const tabBar = document.getElementById("mainTabBar");
    const momentsFab = document.getElementById("momentsFabBtn");

    if (homeMain) homeMain.style.display = "none";
    if (homeDock) homeDock.style.display = "none";
    if (pageInd) pageInd.style.display = "none";
    if (appMain) appMain.style.display = "";
    if (tabBar) tabBar.style.display = "none";
    if (momentsFab) momentsFab.style.display = "none";

    const page = ensureLivePage();
    page.classList.add("active");

    const couplePage = document.getElementById("page-couple-space");
    if (couplePage) couplePage.dataset.clTheme = "live";
  }

  /* ------------------------------------------------------------
   * 首页：控制面板 + 粉丝通道
   * ------------------------------------------------------------ */

  async function openLiveHome(convId) {
    window._currentCoupleLiveConvId = convId;

    const page = ensureLivePage();
    activateLivePage();

    const scroll = page.querySelector("#clScroll");
    scroll.innerHTML = `<div class="cl-empty">LOADING</div>`;

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);

    scroll.innerHTML = `
      ${renderControlPanel(cfg)}
      ${await renderWorldbookPanel(convId, cfg)}
      ${renderFanChannel(cfg, info)}
    `;

    bindControlEvents(convId);
    bindWorldbookEvents(convId);
    bindChannelEvents(convId);
  }

  function renderControlPanel(cfg) {
    const rank = cfg.rank || [];

    return `
      <div class="cl-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Control Panel</div>
          <div class="cl-switch ${cfg.enabled ? "on" : ""}" id="clLiveSwitch"></div>
        </div>
        <div class="cl-panel-body">
          <div class="cl-row">
            <div>
              <div class="cl-label">直播系统开关</div>
              <div class="cl-sub">开启后，每轮线上或线下互动都会生成实时弹幕</div>
            </div>
            <div class="cl-switch ${cfg.enabled ? "on" : ""}" id="clLiveSwitch2"></div>
          </div>

          <div class="cl-row">
            <div>
              <div class="cl-label">每轮弹幕数量</div>
              <div class="cl-sub">控制单轮 API 返回的最小与最大弹幕条数</div>
            </div>
            <div class="cl-num-group">
              <input class="cl-num-input" id="clMinBullets" type="number" min="1" max="50" value="${cfg.minBullets}">
              <span>-</span>
              <input class="cl-num-input" id="clMaxBullets" type="number" min="1" max="80" value="${cfg.maxBullets}">
            </div>
          </div>

          <div class="cl-stats-grid">
            <div class="cl-stat-card">
              <div class="cl-stat-num" id="clFansNum">${Number(cfg.fans || 0).toLocaleString()}</div>
              <div class="cl-stat-label">CURRENT FANS</div>
            </div>
            <div class="cl-stat-card">
              <div class="cl-stat-num">${rank.length}</div>
              <div class="cl-stat-label">RANK USERS</div>
            </div>
          </div>
        </div>
      </div>

      <div class="cl-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Contribution Rank</div>
        </div>
        <div class="cl-panel-body">
          <div class="cl-rank-list">
            ${
              rank.length
                ? rank
                    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
                    .slice(0, 8)
                    .map((r, i) => `
                      <div class="cl-rank-row cl-rank-clickable" data-cl-rank-name="${esc(r.name)}">
  <div class="cl-rank-index">${String(i + 1).padStart(2, "0")}</div>
  <div class="cl-rank-name">${esc(r.name)}</div>
  <div class="cl-rank-money">${Number(r.amount || 0).toLocaleString()}</div>
</div>
                    `).join("")
                : `<div class="cl-empty">NO RANK DATA</div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  async function renderWorldbookPanel(convId, cfg) {
    const DB = window.DB;
    if (!DB) {
      return `
        <div class="cl-panel">
          <div class="cl-panel-head"><div class="cl-panel-title">Mounted Worldbooks</div></div>
          <div class="cl-panel-body"><div class="cl-empty">DB NOT READY</div></div>
        </div>
      `;
    }

    const all = (await DB.getAll("worldbooks")) || [];
    const selected = cfg.mountedWorldbookIds || [];

    if (!all.length) {
      return `
        <div class="cl-panel">
          <div class="cl-panel-head"><div class="cl-panel-title">Mounted Worldbooks</div></div>
          <div class="cl-panel-body"><div class="cl-empty">NO WORLDBOOK</div></div>
        </div>
      `;
    }

    const groupMap = {};
    all.forEach(wb => {
      const g = wb.group || "未分组";
      if (!groupMap[g]) groupMap[g] = [];
      groupMap[g].push(wb);
    });

    const groups = Object.keys(groupMap).sort((a, b) => a.localeCompare(b, "zh-CN"));

    return `
      <div class="cl-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Mounted Worldbooks</div>
        </div>
        <div class="cl-panel-body">
          <div class="cl-sub" style="margin-bottom:10px;">
            直播系统世界书与线上、线下聊天完全隔离，只影响弹幕、粉丝群和私信。
          </div>

          ${groups.map(g => {
            const list = groupMap[g];
            const checkedCount = list.filter(w => selected.includes(w.id)).length;

            return `
              <div class="cl-wb-group ${checkedCount ? "" : "collapsed"}">
                <div class="cl-wb-group-head">
                  <span>${esc(g)}</span>
                  <span>${checkedCount}/${list.length}</span>
                </div>
                <div class="cl-wb-group-body">
                  ${list.map(wb => `
                    <label class="cl-wb-item">
                      <input type="checkbox" class="clWbCheck" value="${esc(wb.id)}" ${selected.includes(wb.id) ? "checked" : ""}>
                      <div>
                        <div class="cl-wb-title">${esc(wb.title || "未命名世界书")}</div>
                        <div class="cl-wb-preview">${esc((wb.content || "").slice(0, 70))}</div>
                      </div>
                    </label>
                  `).join("")}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderFanChannel(cfg, info) {
    const charName = info?.charName || "CHAR";
    const userName = info?.userName || "USER";

    return `
      <div class="cl-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Fan Channel</div>
        </div>
        <div class="cl-panel-body">
          <div class="cl-channel-card" data-cl-channel="fanGroup">
            <div class="cl-channel-icon">${SVG.group}</div>
            <div class="cl-channel-info">
              <div class="cl-channel-name">粉丝群</div>
              <div class="cl-channel-desc">置顶频道，与围观你们的粉丝交流</div>
            </div>
            <div>${SVG.arrow}</div>
          </div>

          <div class="cl-channel-card" data-cl-channel="inbox">
            <div class="cl-channel-icon">${SVG.inbox}</div>
            <div class="cl-channel-info">
              <div class="cl-channel-name">私信箱</div>
              <div class="cl-channel-desc">${esc(charName)} / ${esc(userName)} 的网友私信</div>
            </div>
            <div>${SVG.arrow}</div>
          </div>
        </div>
      </div>
    `;
  }

  function bindControlEvents(convId) {
    const bindSwitch = id => {
      const el = document.getElementById(id);
      if (!el) return;

      el.addEventListener("click", async () => {
        const cfg = await getCfg(convId);
        cfg.enabled = !cfg.enabled;
        await saveCfg(convId, cfg);

        window.showStatus && window.showStatus(
          cfg.enabled ? "直播系统已开启" : "直播系统已关闭",
          "success"
        );

        await openLiveHome(convId);
      });
    };

    bindSwitch("clLiveSwitch");
    bindSwitch("clLiveSwitch2");

    const minEl = document.getElementById("clMinBullets");
    const maxEl = document.getElementById("clMaxBullets");

    async function saveNums() {
      const cfg = await getCfg(convId);

      let min = clamp(minEl.value, 1, 50);
      let max = clamp(maxEl.value, 1, 80);

      if (max < min) max = min;

      cfg.minBullets = min;
      cfg.maxBullets = max;

      await saveCfg(convId, cfg);

      minEl.value = min;
      maxEl.value = max;

      window.showStatus && window.showStatus("弹幕数量设置已保存", "success");
    }

    minEl?.addEventListener("change", saveNums);
    maxEl?.addEventListener("change", saveNums);
    
    document.querySelectorAll(".cl-rank-row[data-cl-rank-name]").forEach(row => {
  row.addEventListener("click", async () => {
    const name = row.dataset.clRankName;
    if (!name) return;
    await openRankUserThread(convId, name);
  });
});
    
  }

  function bindWorldbookEvents(convId) {
    document.querySelectorAll(".cl-wb-group-head").forEach(head => {
      head.addEventListener("click", () => {
        head.closest(".cl-wb-group").classList.toggle("collapsed");
      });
    });

    document.querySelectorAll(".clWbCheck").forEach(cb => {
      cb.addEventListener("change", async () => {
        const cfg = await getCfg(convId);
        cfg.mountedWorldbookIds = [...document.querySelectorAll(".clWbCheck:checked")].map(x => x.value);
        await saveCfg(convId, cfg);
        window.showStatus && window.showStatus("直播世界书挂载已更新", "success");
      });
    });
  }

  function bindChannelEvents(convId) {
    document.querySelector("[data-cl-channel='fanGroup']")?.addEventListener("click", () => openFanGroup(convId));
    document.querySelector("[data-cl-channel='inbox']")?.addEventListener("click", () => openInbox(convId, "char"));
  }

  /* ------------------------------------------------------------
   * 粉丝群
   * ------------------------------------------------------------ */

  async function openFanGroup(convId) {
    window._currentCoupleLiveConvId = convId;
    activateLivePage();

    const cfg = await getCfg(convId);
    const scroll = document.getElementById("clScroll");

    if (!cfg.fanGroup || cfg.fanGroup.length === 0) {
      cfg.fanGroup = [
        {
          role: "fan",
          name: "NullPointer",
          content: "开播第一天就这么有戏，谁还睡得着。",
          ts: Date.now() - 60000
        },
        {
          role: "fan",
          name: "白噪声",
          content: "我先占座，后面肯定会变成名场面。",
          ts: Date.now() - 30000
        }
      ];
      await saveCfg(convId, cfg);
    }

    scroll.innerHTML = `
      <div class="cl-panel cl-chat-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Fan Group</div>
          <button class="cl-small-btn ghost" id="clBackHomeBtn">BACK</button>
        </div>
        <div class="cl-panel-body">
          <div class="cl-chat-list" id="clFanGroupList">
            ${cfg.fanGroup.map(m => renderFanMsg(m)).join("")}
          </div>
          <div class="cl-input-row">
            <input class="cl-text-input" id="clFanGroupInput" placeholder="输入要发给粉丝群的内容">
            <button class="cl-send-btn" id="clFanGroupSend">${SVG.send}</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("clBackHomeBtn").addEventListener("click", () => openLiveHome(convId));
    document.getElementById("clFanGroupSend").addEventListener("click", () => sendFanGroup(convId));
    document.getElementById("clFanGroupInput").addEventListener("keypress", e => {
      if (e.key === "Enter") sendFanGroup(convId);
    });

    const list = document.getElementById("clFanGroupList");
    if (list) list.scrollTop = list.scrollHeight;
  }

  function renderFanMsg(m) {
    const self = m.role === "self";
    return `
      <div class="cl-msg-row ${self ? "self" : "other"}">
        <div class="cl-msg-bubble">
          ${self ? "" : `<b>${esc(m.name || "fan")}</b><br>`}
          ${esc(m.content)}
        </div>
      </div>
    `;
  }

  async function sendFanGroup(convId) {
    const input = document.getElementById("clFanGroupInput");
    const text = input.value.trim();
    if (!text) return;

    const cfg = await getCfg(convId);
    cfg.fanGroup = cfg.fanGroup || [];
    cfg.fanGroup.push({
      role: "self",
      name: "主播",
      content: text,
      ts: Date.now()
    });

    input.value = "";
    await saveCfg(convId, cfg);
    await openFanGroup(convId);

    await generateFanGroupReplies(convId, text);
  }

  async function generateFanGroupReplies(convId, text) {
    if (!window.callLLM) {
      window.showStatus && window.showStatus("API模块未就绪", "error");
      return;
    }

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);
    const worldbook = await buildLiveWorldbook(convId);

    const prompt = `
你正在模拟一个直播间粉丝群。
核心风格：强网感、会玩梗、有弹幕文化、嘴快、有人阴阳怪气、有人嗑CP、有人理性分析。
禁止使用emoji。
禁止使用解释性旁白。
每条回复前要有网友昵称。

主播/用户刚在粉丝群发言：
${text}

角色信息：
CHAR=${info.charName}
USER=${info.userName}
关系信息：
${info.relation || "未知"}

直播系统专属世界书：
${worldbook || "无"}

请生成 2 到 5 条粉丝群回复。
严格输出 JSON 数组：
[
  {"name":"昵称","content":"内容"}
]
`;

    try {
      if (window.recordApiPending) window.recordApiPending();

      const raw = await window.callLLM(
        [{ role: "user", content: prompt }],
        { maxTokens: 800, temperature: 0.9 }
      );

      const arr = parseJsonArray(raw).slice(0, 5);

      arr.forEach(x => {
        cfg.fanGroup.push({
          role: "fan",
          name: x.name || randomFanName(),
          content: x.content || "",
          ts: Date.now()
        });
      });

      await saveCfg(convId, cfg);
      await openFanGroup(convId);
    } catch (e) {
      window.showStatus && window.showStatus("粉丝群回复生成失败：" + e.message, "error");
    }
  }

  /* ------------------------------------------------------------
   * 私信箱
   * ------------------------------------------------------------ */

  async function openInbox(convId, box = "char") {
    activateLivePage();

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);

    await ensureInboxSeed(convId, cfg, info);

    const threads = box === "char" ? cfg.charInbox : cfg.userInbox;
    const scroll = document.getElementById("clScroll");

    const boxTitle = box === "char" ? `${info.charName} 的私信箱` : `${info.userName} 的私信箱`;

    scroll.innerHTML = `
      <div class="cl-tabs">
        <div class="cl-tab ${box === "char" ? "active" : ""}" data-cl-box="char">${esc(info.charName)} 的私信箱</div>
        <div class="cl-tab ${box === "user" ? "active" : ""}" data-cl-box="user">${esc(info.userName)} 的私信箱</div>
      </div>

      <div class="cl-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">Direct Messages</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="cl-force-btn" id="clForceInboxBtn">FORCE DM</button>
            <button class="cl-small-btn ghost" id="clBackHomeBtn">BACK</button>
          </div>
        </div>
        <div class="cl-panel-body">
          <div class="cl-sub" style="margin-bottom:10px;">${esc(boxTitle)}</div>
          <div class="cl-thread-list">
            ${
              threads.length
                ? threads.map(t => `
                    <div class="cl-thread-card" data-cl-thread="${esc(t.id)}" data-cl-box="${box}">
                      <div class="cl-thread-head">
                        <div class="cl-thread-name">${esc(t.name)}</div>
                        <div class="cl-thread-time">${nowTime(t.updatedAt)}</div>
                      </div>
                      <div class="cl-thread-preview">${esc(lastMsg(t))}</div>
                    </div>
                  `).join("")
                : `<div class="cl-empty">NO MESSAGE</div>`
            }
          </div>
        </div>
      </div>
    `;

    document.getElementById("clBackHomeBtn").addEventListener("click", () => openLiveHome(convId));

    document.getElementById("clForceInboxBtn").addEventListener("click", async () => {
      await forceGenerateInboxMessage(convId, box);
    });

    document.querySelectorAll(".cl-tab").forEach(tab => {
      tab.addEventListener("click", () => openInbox(convId, tab.dataset.clBox));
    });

    document.querySelectorAll("[data-cl-thread]").forEach(card => {
      card.addEventListener("click", () => {
        openThread(convId, card.dataset.clBox, card.dataset.clThread);
      });
    });
  }
  
  async function openRankUserThread(convId, fanName) {
  const cfg = await getCfg(convId);
  const info = await getConvInfo(convId);

  cfg.userInbox = cfg.userInbox || [];

  let thread = cfg.userInbox.find(t => t.name === fanName);

  if (!thread) {
    thread = {
      id: "user_rank_dm_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      name: fanName,
      target: "user",
      source: "rank",
      updatedAt: Date.now(),
      messages: [
        {
          role: "fan",
          content: `你居然点我私信？我刚还在榜上刷礼物呢。`,
          ts: Date.now()
        }
      ]
    };

    cfg.userInbox.unshift(thread);
  } else {
    thread.updatedAt = Date.now();
  }

  await saveCfg(convId, cfg);

  window.showStatus && window.showStatus(
    `已打开与 ${fanName} 的私信`,
    "success"
  );

  await openThread(convId, "user", thread.id);
}

  function lastMsg(t) {
    const m = (t.messages || [])[t.messages.length - 1];
    return m ? m.content : "";
  }

  async function ensureInboxSeed(convId, cfg, info) {
    let changed = false;

    if (!cfg.charInbox || cfg.charInbox.length === 0) {
      cfg.charInbox = [
        {
          id: "char_dm_" + Date.now(),
          name: "SignalLost",
          target: "char",
          updatedAt: Date.now(),
          messages: [
            {
              role: "fan",
              content: `你和${info.userName}到底是什么关系，能不能正面说一次。`,
              ts: Date.now()
            }
          ]
        }
      ];
      changed = true;
    }

    if (!cfg.userInbox || cfg.userInbox.length === 0) {
      cfg.userInbox = [
        {
          id: "user_dm_" + Date.now(),
          name: "BlackCard",
          target: "user",
          updatedAt: Date.now(),
          messages: [
            {
              role: "fan",
              content: "我说真的，你们这直播比电视剧上头多了。",
              ts: Date.now()
            }
          ]
        }
      ];
      changed = true;
    }

    if (changed) await saveCfg(convId, cfg);
  }

  async function forceGenerateInboxMessage(convId, box) {
    if (!window.callLLM) {
      window.showStatus && window.showStatus("API模块未就绪", "error");
      return;
    }

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);
    const worldbook = await buildLiveWorldbook(convId);

    const targetName = box === "char" ? info.charName : info.userName;
    const targetDesc = box === "char" ? info.charDetail : info.userDetail;
    const inboxKey = box === "char" ? "charInbox" : "userInbox";

    const prompt = `
你正在模拟直播系统里的网友私信。

目标收信人：${targetName}

${buildViewerDmIdentityRules(info, targetName)}

要求：
- 强网感
- 像真实网友私信
- 可以嗑CP，可以阴阳怪气，可以拱火，可以认真发问
- 禁止使用emoji
- 禁止长篇作文
- 内容要能引发后续对话
- 昵称要有互联网感

目标人物设定：
${targetDesc || "无"}

关系信息：
CHAR=${info.charName}
USER=${info.userName}
关系=${info.relation || "未知"}

直播系统专属世界书：
${worldbook || "无"}

请生成 1 条新的私信。
严格输出 JSON：
{
  "name": "网友昵称",
  "content": "私信内容"
}
`;

    try {
      if (window.recordApiPending) window.recordApiPending();
      window.showStatus && window.showStatus("正在生成新的私信...", "info");

      const raw = await window.callLLM(
        [{ role: "user", content: prompt }],
        { maxTokens: 500, temperature: 0.95 }
      );

      const obj = parseJsonObject(raw);

      const name = obj.name || randomFanName();
      const content = obj.content || "你们刚才那段我看了三遍，别装没事。";

      cfg[inboxKey] = cfg[inboxKey] || [];

      cfg[inboxKey].unshift({
        id: box + "_dm_" + Date.now() + "_" + Math.random().toString(36).slice(2),
        name,
        target: box,
        updatedAt: Date.now(),
        messages: [
          {
            role: "fan",
            content,
            ts: Date.now()
          }
        ]
      });

      cfg[inboxKey] = cfg[inboxKey].slice(0, 80);

      await saveCfg(convId, cfg);
      await openInbox(convId, box);

      window.showStatus && window.showStatus("新的私信已送达", "success");
    } catch (e) {
      window.showStatus && window.showStatus("私信生成失败：" + e.message, "error");
    }
  }

  async function openThread(convId, box, threadId) {
    activateLivePage();

    const cfg = await getCfg(convId);
    const list = box === "char" ? cfg.charInbox : cfg.userInbox;
    const thread = list.find(t => t.id === threadId);

    if (!thread) return;

    const scroll = document.getElementById("clScroll");

    const bottomHtml = box === "char"
      ? `
        <div class="cl-thread-action-row">
          <button class="cl-small-btn ghost" id="clAutoSelfReplyBtn">获取TA的回复</button>
          <button class="cl-send-btn" id="clFanReplyBtn">${SVG.send}</button>
        </div>
      `
      : `
        <div class="cl-user-input-row">
          <input class="cl-text-input" id="clThreadInput" placeholder="输入内容，回车上屏">
          <button class="cl-send-btn" id="clFanReplyBtn">${SVG.send}</button>
        </div>
      `;

    scroll.innerHTML = `
      <div class="cl-panel cl-chat-panel">
        <div class="cl-panel-head">
          <div class="cl-panel-title">${esc(thread.name)}</div>
          <button class="cl-small-btn ghost" id="clBackInboxBtn">BACK</button>
        </div>
        <div class="cl-panel-body">
          <div class="cl-chat-list" id="clThreadList">
            ${(thread.messages || []).map(m => `
              <div class="cl-msg-row ${m.role === "self" ? "self" : "other"}">
                <div class="cl-msg-bubble">${esc(m.content)}</div>
              </div>
            `).join("")}
          </div>

          ${bottomHtml}
        </div>
      </div>
    `;

    document.getElementById("clBackInboxBtn").addEventListener("click", () => openInbox(convId, box));

    if (box === "char") {
      document.getElementById("clAutoSelfReplyBtn").addEventListener("click", () => {
        generateThreadReply(convId, box, threadId);
      });

      document.getElementById("clFanReplyBtn").addEventListener("click", () => {
        generateFanThreadReply(convId, box, threadId);
      });
    } else {
      const input = document.getElementById("clThreadInput");

      input.addEventListener("keypress", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendThreadMsg(convId, box, threadId);
        }
      });

      document.getElementById("clFanReplyBtn").addEventListener("click", () => {
        generateFanThreadReply(convId, box, threadId);
      });
    }

    const msgList = document.getElementById("clThreadList");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;
  }

  async function sendThreadMsg(convId, box, threadId) {
    const input = document.getElementById("clThreadInput");
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const cfg = await getCfg(convId);
    const list = box === "char" ? cfg.charInbox : cfg.userInbox;
    const thread = list.find(t => t.id === threadId);

    if (!thread) return;

    thread.messages.push({
      role: "self",
      content: text,
      ts: Date.now()
    });

    thread.updatedAt = Date.now();

    input.value = "";

    await saveCfg(convId, cfg);
    await openThread(convId, box, threadId);
  }

  async function generateThreadReply(convId, box, threadId) {
    if (!window.callLLM) {
      window.showStatus && window.showStatus("API模块未就绪", "error");
      return;
    }

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);
    const list = box === "char" ? cfg.charInbox : cfg.userInbox;
    const thread = list.find(t => t.id === threadId);

    if (!thread) return;

    const worldbook = await buildLiveWorldbook(convId);
    const history = thread.messages
      .map(m => `${m.role === "self" ? "主播侧" : thread.name}: ${m.content}`)
      .join("\n");

    const speaker = box === "char" ? info.charName : info.userName;

    const prompt = `
你正在模拟直播系统私信。
目标回复者：${speaker}
私信对象：${thread.name}

${buildSelfReplyDmIdentityRules(info, box, thread.name)}

核心风格：
- 网感强
- 像真实私信
- 可以多条短回复
- 可以犀利、暧昧、吐槽、拉扯
- 不要像客服，不要像作文

禁止使用emoji。
禁止动作描写。
禁止长篇说教。

角色信息：
CHAR=${info.charName}
USER=${info.userName}
CHAR设定=${info.charDetail || "无"}
USER设定=${info.userDetail || "无"}
关系=${info.relation || "无"}

直播系统专属世界书：
${worldbook || "无"}

私信历史：
${history}

请以 ${speaker} 的口吻回复。
支持多条回复。
严格输出 JSON 数组：
[
  {"content":"第一条"},
  {"content":"第二条"}
]
`;

    try {
      if (window.recordApiPending) window.recordApiPending();
      window.showStatus && window.showStatus("正在获取TA的回复...", "info");

      const raw = await window.callLLM(
        [{ role: "user", content: prompt }],
        { maxTokens: 900, temperature: 0.85 }
      );

      const arr = parseJsonArray(raw).slice(0, 6);

      arr.forEach(x => {
        thread.messages.push({
          role: "self",
          content: x.content || "",
          ts: Date.now()
        });
      });

      thread.updatedAt = Date.now();
      await saveCfg(convId, cfg);
      await openThread(convId, box, threadId);

      window.showStatus && window.showStatus("TA已回复", "success");
    } catch (e) {
      window.showStatus && window.showStatus("私信回复失败：" + e.message, "error");
    }
  }

  async function generateFanThreadReply(convId, box, threadId) {
    if (!window.callLLM) {
      window.showStatus && window.showStatus("API模块未就绪", "error");
      return;
    }

    const cfg = await getCfg(convId);
    const info = await getConvInfo(convId);
    const list = box === "char" ? cfg.charInbox : cfg.userInbox;
    const thread = list.find(t => t.id === threadId);

    if (!thread) return;

    const worldbook = await buildLiveWorldbook(convId);

    const targetName = box === "char" ? info.charName : info.userName;

    const history = thread.messages
      .map(m => `${m.role === "self" ? targetName : thread.name}: ${m.content}`)
      .join("\n");

    const prompt = `
你正在模拟直播系统里的网友私信回复。

网友昵称：${thread.name}
私信对象：${targetName}

${buildFanReplyDmIdentityRules(info, box, thread.name)}

核心风格：
- 强网感
- 像真实网友私信
- 可以嘴快、嗑CP、拱火、阴阳怪气、追问
- 不要像客服
- 不要像作文
- 禁止使用emoji
- 禁止动作描写

直播双方：
CHAR=${info.charName}
USER=${info.userName}
关系=${info.relation || "未知"}

直播系统专属世界书：
${worldbook || "无"}

私信历史：
${history}

请以网友 ${thread.name} 的口吻继续回复。
支持多条短回复。
严格输出 JSON 数组：
[
  {"content":"第一条"},
  {"content":"第二条"}
]
`;

    try {
      if (window.recordApiPending) window.recordApiPending();
      window.showStatus && window.showStatus("正在获取网友回复...", "info");

      const raw = await window.callLLM(
        [{ role: "user", content: prompt }],
        { maxTokens: 800, temperature: 0.95 }
      );

      const arr = parseJsonArray(raw).slice(0, 5);

      arr.forEach(x => {
        thread.messages.push({
          role: "fan",
          content: x.content || "",
          ts: Date.now()
        });
      });

      thread.updatedAt = Date.now();

      await saveCfg(convId, cfg);
      await openThread(convId, box, threadId);

      window.showStatus && window.showStatus("网友已回复", "success");
    } catch (e) {
      window.showStatus && window.showStatus("网友回复失败：" + e.message, "error");
    }
  }

  /* ------------------------------------------------------------
   * 弹幕生成与播放
   * ------------------------------------------------------------ */

  async function maybeGenerateLiveBullets(convId) {
    console.log("[LIVE] check live bullets", convId);

    if (!convId) return;
    if (window.__clGenerating) {
      console.log("[LIVE] already generating, skip");
      return;
    }

    const cfg = await getCfg(convId);
    console.log("[LIVE] cfg", cfg);

    if (!cfg.enabled) {
      console.log("[LIVE] live disabled");
      return;
    }

    if (!window.callLLM) {
      console.warn("[LIVE] callLLM not ready");
      return;
    }

    const DB = window.DB;
    const conv = await DB.get("conversations", convId);
    if (!conv) return;

    const chats = await DB.queryByIndex("chats", "conversationId", convId);

    const visible = chats
      .filter(c =>
        c.messageType !== "innerVoice" &&
        c.messageType !== "phone_intrusion" &&
        c.messageType !== "mode_switch" &&
        c.messageType !== "voice_call_msg"
      )
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    const last = [...visible].reverse().find(c =>
      c.role === "assistant" ||
      c.role === "char" ||
      c.messageType === "offline_card"
    );

    if (!last) {
      console.log("[LIVE] no char reply found");
      return;
    }

    const lastKey = [
      last.id || "noid",
      last.timestamp || 0,
      last.role || "",
      last.messageType || "",
      String(last.content || "").slice(0, 40)
    ].join("|");

    if (String(cfg.lastProcessedChatId) === String(lastKey)) {
      console.log("[LIVE] already processed", lastKey);
      return;
    }

    cfg.lastProcessedChatId = lastKey;
    await saveCfg(convId, cfg);

    window.__clGenerating = true;

    try {
      console.log("[LIVE] generating bullets...");
      const bullets = await generateBullets(convId, cfg, visible.slice(-8));

      console.log("[LIVE] bullets result", bullets);

      if (bullets.length) {
        await applyBulletEffects(convId, bullets);
        playDanmaku(bullets);
      }
    } catch (e) {
      console.error("[LIVE] generate bullets failed", e);
      window.showStatus && window.showStatus("直播弹幕生成失败：" + e.message, "error");
    } finally {
      window.__clGenerating = false;
    }
  }

  async function generateBullets(convId, cfg, recentChats) {
    const info = await getConvInfo(convId);
    const worldbook = await buildLiveWorldbook(convId);

    const min = clamp(cfg.minBullets, 1, 50);
    const max = clamp(cfg.maxBullets, min, 80);

    const context = recentChats.map(c => {
      let who;
      if (c.role === "user") who = info.userName;
      else who = info.charName;
      return `${who}: ${c.content}`;
    }).join("\n");

    const prompt = `
你正在模拟一个高热度直播间的弹幕系统。

核心玩点：网感。
弹幕要像真实网友，不要像作文。
可以有：
1. 路人评价
2. 嗑CP
3. 阴阳怪气
4. 打赏通知
5. 关注通知
6. 榜一发言
7. 催互动、拱火、看热闹

要求：
- 禁止使用emoji。
- 禁止解释。
- 昵称要有网感，但不要过长。
- 系统通知也要像直播间通知。
- 弹幕可以短，可以尖锐，可以嗑疯，可以阴阳怪气。
- 不要每条都很温柔。
- 不要输出 Markdown。
- 不要输出代码块。

直播双方：
CHAR=${info.charName}
USER=${info.userName}
关系=${info.relation || "未知"}

最近直播内容：
${context}

直播系统专属世界书：
${worldbook || "无"}

请生成 ${min} 到 ${max} 条弹幕。
严格输出 JSON 数组：
[
  {"type":"comment","name":"冰山","content":"好甜呀好甜呀"},
  {"type":"gift","name":"AAA","amount":1000,"content":"我们要看点刺激的"},
  {"type":"follow","name":"萌妹子万岁","content":"关注了直播间"}
]

type 只能是 comment / gift / follow。
gift 必须带 amount 数字。
`;

    try {
      if (window.recordApiPending) window.recordApiPending();

      const raw = await window.callLLM(
        [{ role: "user", content: prompt }],
        {
          maxTokens: 1200,
          temperature: 0.95
        }
      );

      const arr = parseJsonArray(raw);

      const normalized = arr
        .slice(0, max)
        .map(x => normalizeBullet(x))
        .filter(Boolean);

      if (normalized.length < min) {
        const fb = fallbackBullets(min - normalized.length, min - normalized.length);
        normalized.push(...fb);
      }

      return normalized.slice(0, max);
    } catch (e) {
      console.warn("[LIVE] live bullets API failed, using fallback", e);
      return fallbackBullets(min, max);
    }
  }

  function normalizeBullet(x) {
    if (!x) return null;

    const type = ["comment", "gift", "follow"].includes(x.type) ? x.type : "comment";
    const name = String(x.name || randomFanName()).slice(0, 16);
    const content = String(x.content || "").slice(0, 80);
    const amount = Number(x.amount || 0);

    return {
      type,
      name,
      content,
      amount
    };
  }

  function fallbackBullets(min, max) {
    const n = Math.floor(Math.random() * (max - min + 1)) + min;

    const samples = [
      { type: "comment", name: "白噪声", content: "这个对视我真的会反复看。" },
      { type: "comment", name: "NullPointer", content: "别装了，你们两个都有问题。" },
      { type: "comment", name: "SignalLost", content: "这直播间怎么比剧本还像剧本。" },
      { type: "comment", name: "404观众", content: "刚刚那句我暂停截图了。" },
      { type: "comment", name: "只看名场面", content: "这段剪出来绝对爆。" },
      { type: "follow", name: "低电量用户", content: "关注了直播间" }
    ];

    return Array.from({ length: n }, () => Object.assign({}, rand(samples)));
  }

  async function applyBulletEffects(convId, bullets) {
    const cfg = await getCfg(convId);

    cfg.rank = cfg.rank || [];
    cfg.fans = Number(cfg.fans || 0);

    bullets.forEach(b => {
      if (b.type === "follow") {
        cfg.fans += 1 + Math.floor(Math.random() * 3);
      }

      if (b.type === "gift") {
        const amount = Number(b.amount || 0);
        if (amount <= 0) return;

        const old = cfg.rank.find(x => x.name === b.name);
        if (old) {
          old.amount = Number(old.amount || 0) + amount;
        } else {
          cfg.rank.push({
            name: b.name,
            amount
          });
        }
      }
    });

    if (Math.random() < 0.35) {
      await generateAutoInbox(convId, cfg, bullets);
    }

    await saveCfg(convId, cfg);
  }

  async function generateAutoInbox(convId, cfg, bullets) {
    const info = await getConvInfo(convId);
    const b = rand(bullets);
    const target = Math.random() < 0.5 ? "char" : "user";
    const box = target === "char" ? "charInbox" : "userInbox";
    const name = b.name || randomFanName();

    cfg[box] = cfg[box] || [];

    const contentPool = target === "char"
      ? [
          `${info.charName}，你刚才那个反应也太明显了吧。`,
          `你是不是已经有点离不开${info.userName}了。`,
          `我不管，你们这条线我追定了。`,
          `你别嘴硬，直播间都看见了。`
        ]
      : [
          "你刚刚那句话真的很会。",
          `说实话，你和${info.charName}比我刷到的所有剧都上头。`,
          "能不能多给点正面回应，直播间都急了。",
          "你别装淡定，你耳朵根都快红了。"
        ];

    cfg[box].unshift({
      id: target + "_dm_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      name,
      target,
      updatedAt: Date.now(),
      messages: [
        {
          role: "fan",
          content: rand(contentPool),
          ts: Date.now()
        }
      ]
    });

    cfg[box] = cfg[box].slice(0, 50);
  }

  function ensureDanmakuLayer() {
    const phone = document.querySelector(".phone-mock");
    if (!phone) return null;

    let layer = document.getElementById("clDanmakuLayer");

    if (!layer) {
      layer = document.createElement("div");
      layer.id = "clDanmakuLayer";
      layer.className = "cl-danmaku-layer";
      phone.appendChild(layer);
    }

    return layer;
  }

  function playDanmaku(bullets) {
    const layer = ensureDanmakuLayer();
    if (!layer) return;

    const layerHeight = layer.clientHeight || 420;
    const lanes = Math.max(5, Math.floor(layerHeight / 32));

    bullets.forEach((b, i) => {
      const el = document.createElement("div");
      el.className = "cl-danmaku-item " + (b.type === "gift" || b.type === "follow" ? "notice" : "");

      if (b.type === "gift") {
        el.textContent = `${b.name} 打赏了 ${Number(b.amount || 0)} 元，留言：${b.content}`;
      } else if (b.type === "follow") {
        el.textContent = `${b.name} ${b.content || "关注了直播间"}`;
      } else {
        el.textContent = `${b.name}: ${b.content}`;
      }

      const lane = i % lanes;

      el.style.top = `${lane * 30 + 8}px`;

      // 动画时长适当拉长，避免左侧突然停顿
      el.style.animationDuration = `${10 + Math.random() * 4}s`;
      el.style.animationDelay = `${i * 0.35}s`;

      layer.appendChild(el);

      // 注意：CSS 已经改成完整飘出左侧。
      // 这里的移除时间只作为兜底，略大于动画时间。
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 20000);
    });
  }

  /* ------------------------------------------------------------
   * 直播专属世界书
   * ------------------------------------------------------------ */

  async function buildLiveWorldbook(convId) {
    const DB = window.DB;
    if (!DB) return "";
    const cfg = await getCfg(convId);
    const ids = cfg.mountedWorldbookIds || [];

    if (!ids.length) return "";

    const all = await DB.getAll("worldbooks");
    const mounted = all.filter(w => ids.includes(w.id));

    return mounted
      .map(w => `--- ${w.title || "未命名"} ---\n${w.content || ""}`)
      .join("\n\n");
  }
  
    function buildViewerDmIdentityRules(info, targetName) {
    return `
【私信身份边界 · 最高优先级】
- 你正在生成的是直播系统里的网友私信。
- 发信人是直播间的路人、粉丝、观众或打赏者，不是 ${info.charName}，也不是 ${info.userName}。
- 发信人只知道直播中公开发生过的内容，以及私信历史里出现过的信息。
- 发信人不能拥有现实关系中的记忆，不能像恋人、朋友、家人、同事一样说话。
- 发信人可以嗑CP、拱火、八卦、质疑、打赏后找存在感，但本质上仍然是围观者。
- 私信对象是 ${targetName}。
- 禁止把网友写成现实剧情里的重要角色。
- 禁止让网友自称和 ${info.charName} 或 ${info.userName} 有线下旧识，除非直播世界书明确写了这个设定。
`;
  }

  function buildSelfReplyDmIdentityRules(info, box, fanName) {
    const selfName = box === "char" ? info.charName : info.userName;
    const otherMainName = box === "char" ? info.userName : info.charName;

    return `
【私信回复身份边界 · 最高优先级】
- 你是 ${selfName}，正在回复直播系统里网友「${fanName}」发来的私信。
- 这是直播间私信，不是你和 ${otherMainName} 的主线对话。
- 私信对象「${fanName}」是直播间观众 / 粉丝 / 打赏者，不是你的恋人、朋友、家人或现实旧识。
- 你可以意识到自己正在被直播间围观，也可以意识到对方是网友。
- 你的回复应符合你的人设，但要保持“回复网友私信”的语境。
- 不要把网友当成 ${otherMainName}。
- 不要把这段私信写成现实见面或主线剧情。
- 可以礼貌、冷淡、调侃、反问、拉开距离、顺势营业，取决于你的性格。
`;
  }

  function buildFanReplyDmIdentityRules(info, box, fanName) {
    const targetName = box === "char" ? info.charName : info.userName;

    return `
【网友私信身份边界 · 最高优先级】
- 你是直播间网友「${fanName}」，正在给 ${targetName} 回私信。
- 你不是 ${info.charName}，也不是 ${info.userName}。
- 你不是现实关系里的朋友、恋人、亲人、同事。
- 你只是直播间观众 / 粉丝 / 打赏者 / 路人。
- 你只知道直播公开内容和这段私信历史，不知道现实私密信息。
- 你的语气可以很有网感，可以嗑CP、拱火、阴阳怪气、追问、打赏后找存在感。
- 禁止突然拥有现实关系记忆。
- 禁止用主线角色口吻说话。
`;
  }

  /* ------------------------------------------------------------
   * JSON 容错
   * ------------------------------------------------------------ */

  function parseJsonArray(raw) {
    if (!raw) return [];

    let text = String(raw).trim();

    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {}

    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {}
    }

    return [];
  }

  function parseJsonObject(raw) {
    if (!raw) return {};

    let text = String(raw).trim();

    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (e) {}

    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch (e) {}
    }

    return {};
  }

  function randomFanName() {
    return rand([
      "白噪声",
      "SignalLost",
      "NullPointer",
      "BlackCard",
      "灰度样本",
      "低电量用户",
      "频道巡视员",
      "404观众",
      "夜间模式",
      "只看名场面",
      "数据过载",
      "匿名看客",
      "弹幕鉴定师"
    ]);
  }

  /* ------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------ */

  function bootstrap() {
    ensureLivePage();
    observeCoupleSpace();
    setupPatchPolling();
    console.log("LIVE SYSTEM bootstrap complete");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  window.coupleLiveModule = {
    openLiveHome,
    openFanGroup,
    openInbox,
    playDanmaku,
    maybeGenerateLiveBullets,
    getCfg,
    saveCfg
  };

  console.log("LIVE SYSTEM module ready");
})();