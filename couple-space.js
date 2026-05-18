/* ================================================================
 * couple-space.js - 情侣空间
 * 功能：
 * 1) 单聊展开菜单点击「情侣空间」→ 打开本页
 * 2) 顶部展示双方头像（与对话同步）+ 已相遇 N 天
 * 3) 四个功能栏：同人 / 查岗 / 约会大作战 / 真心话大冒险
 * 依赖：window.DB, window.escapeHtml, window.showStatus,
 *      window.getAvatarColor, window.switchPage, window.currentConversationId
 * ================================================================ */

(function () {
  "use strict";
  console.log("💕 couple-space 模块加载");

  /* ------------ SVG 图标资源 ------------ */
  const SECTION_ICONS = {
    fanfic:  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/></svg>',
    checkin: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    date:    '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 18.5c-2.5-1.8-4-3.2-4-4.7 0-1.1.9-2 2-2 .7 0 1.4.4 1.7 1 .3-.6 1-1 1.7-1 1.1 0 2 .9 2 2 0 1.5-1.5 2.9-4 4.7z" fill="currentColor" stroke="none"/></svg>',
    truth:   '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
  };

  const SECTIONS = [
    { key: "fanfic",  label: "同人",         desc: "为你们的故事书写新章节",   icon: SECTION_ICONS.fanfic },
    { key: "checkin", label: "查岗",         desc: "看看 Ta 此刻在做什么",     icon: SECTION_ICONS.checkin },
    { key: "date",    label: "约会大作战",   desc: "策划一场特别的约会",       icon: SECTION_ICONS.date },
    { key: "truth",   label: "真心话大冒险", desc: "敢说出心里的那句话吗",     icon: SECTION_ICONS.truth }
  ];

  const BACK_ICON  = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const ARROW_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const HEART_FILLED =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="#ff8aa8" stroke="none"><path d="M12 21s-7-4.35-9.5-9.05C0.5 7.5 4.5 3 9 5.5L12 8l3-2.5C19.5 3 23.5 7.5 21.5 11.95 19 16.65 12 21 12 21z"/></svg>';

  /* ------------ 工具函数 ------------ */
  function esc(s) {
    if (window.escapeHtml) return window.escapeHtml(s);
    return String(s == null ? "" : s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
  }

  function avatarColor(name) {
    if (window.getAvatarColor) return window.getAvatarColor(name || "?");
    return "#ffc4d6";
  }

  function calcDays(startTime) {
    if (!startTime) return 1;
    const start = new Date(startTime);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - start.getTime();
    const days = Math.floor(diffMs / 86400000) + 1;
    return Math.max(1, days);
  }

  function avatarHtml(avatar, name) {
    const ch = esc((name || "?").charAt(0));
    if (avatar) {
      return `<div class="cs-avatar" style="background-image:url('${avatar}')"></div>`;
    }
    return `<div class="cs-avatar cs-avatar-letter" style="background:${avatarColor(name)}">${ch}</div>`;
  }

  /* ------------ 页面骨架 ------------ */
  function ensurePage() {
    let page = document.getElementById("page-couple-space");
    if (page) return page;

    page = document.createElement("div");
    page.id = "page-couple-space";
    page.className = "page";
    page.innerHTML = `
      <div class="chat-header cs-header">
        <div class="chat-header-left">
          <button class="back-btn clickable" id="csBackBtn">${BACK_ICON}</button>
          <h2 class="cs-title">𝓒𝓸𝓾𝓹𝓵𝓮 𝓢𝓹𝓪𝓬𝓮</h2>
        </div>
        <div class="header-actions"></div>
      </div>
      <div class="cs-scroll" id="csScroll"></div>
    `;

    const appMain = document.querySelector(".app-main");
    if (appMain) appMain.appendChild(page);
    else document.body.appendChild(page);

    page.querySelector("#csBackBtn").addEventListener("click", () => {
      if (window.switchPage) window.switchPage("conversation");
    });

    return page;
  }

  /* ------------ 渲染头部卡片 ------------ */
  async function renderHeader(convId) {
    const DB = window.DB;
    if (!DB) return "";
    const conv = await DB.get("conversations", convId);
    if (!conv) return "";

    const char = await DB.get("characters", conv.charId);
    const mask = await DB.get("userProfiles", conv.maskId);
    const detail = await DB.get("convDetails", convId);

    let charName = char?.name || "?";
    let userName = mask?.name || "?";
    let charAvatar = char?.avatar || "";
    let userAvatar = mask?.avatar || "";
    if (detail) {
      if (detail.charName) charName = detail.charName;
      if (detail.userName) userName = detail.userName;
      if (detail.charAvatar) charAvatar = detail.charAvatar;
      if (detail.userAvatar) userAvatar = detail.userAvatar;
    }

    const days = calcDays(conv.createdAt);

    return `
      <div class="cs-hero-card">
        <div class="cs-hero-deco cs-deco-1"></div>
        <div class="cs-hero-deco cs-deco-2"></div>
        <div class="cs-hero-deco cs-deco-3"></div>

        <div class="cs-hero-row">
          <div class="cs-hero-side">
            ${avatarHtml(userAvatar, userName)}
            <div class="cs-hero-name">${esc(userName)}</div>
          </div>

          <div class="cs-hero-mid">
            <div class="cs-hero-bridge">
              <span class="cs-bridge-dots"></span>
              <span class="cs-bridge-heart">${HEART_FILLED}</span>
              <span class="cs-bridge-dots"></span>
            </div>
          </div>

          <div class="cs-hero-side">
            ${avatarHtml(charAvatar, charName)}
            <div class="cs-hero-name">${esc(charName)}</div>
          </div>
        </div>

        <div class="cs-hero-days">
          <span class="cs-days-text">已相遇</span>
          <span class="cs-days-num">${days}</span>
          <span class="cs-days-text">天</span>
        </div>
      </div>
    `;
  }

  /* ------------ 渲染功能区 ------------ */
  function renderSections() {
    return `
      <div class="cs-sections">
        ${SECTIONS.map(s => `
          <div class="cs-section clickable" data-cs-key="${s.key}">
            <div class="cs-section-icon-wrap">${s.icon}</div>
            <div class="cs-section-text">
              <div class="cs-section-title">${esc(s.label)}</div>
              <div class="cs-section-desc">${esc(s.desc)}</div>
            </div>
            <div class="cs-section-go">${ARROW_ICON}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  /* ------------ 主入口 ------------ */
  async function openCoupleSpace(convId) {
    if (!convId) {
      if (window.showStatus) window.showStatus("请先进入对话", "error");
      return;
    }
    const page = ensurePage();
    const scroll = page.querySelector("#csScroll");
    if (scroll) scroll.innerHTML = '<div class="cs-loading">加载中…</div>';

    activatePage();

    const headerHtml = await renderHeader(convId);
    const sectionsHtml = renderSections();
    if (scroll) {
      scroll.innerHTML = headerHtml + sectionsHtml;
      scroll.querySelectorAll("[data-cs-key]").forEach(el => {
  el.addEventListener("click", () => {
    const key = el.dataset.csKey;
    if (key === "fanfic" && window.coupleFanficModule) {
      window.coupleFanficModule.open(convId);
      return;
    }
    if (key === "checkin" && window.coupleCheckinModule) {
      window.coupleCheckinModule.open(convId);
      return;
    }
    if (key === "truth" && window.coupleTruthModule) {
      window.coupleTruthModule.open(convId);
      return;
    }
    if (key === "date" && window.coupleDateModule) {
      window.coupleDateModule.open(convId);
      return;
    }
    const titleEl = el.querySelector(".cs-section-title");
    const title = titleEl ? titleEl.textContent : "敬请期待";
    if (window.showStatus) window.showStatus(title + "：开发中", "info");
  });
});
    }

    window._currentCoupleSpaceConvId = convId;
  }

  /* ------------ 显示控制 ------------ */
  function activatePage() {
    const cspId = "page-couple-space";

    // 用 .page 全局选择器，覆盖所有页面（不限于 .app-main 直接子元素）
    // 同时清除可能存在的内联 display 样式（moments / guangguang 等模块用内联控制显示）
    document.querySelectorAll(".page").forEach(p => {
      if (p.id === cspId) return;
      p.classList.remove("active");
      const ds = p.style.display;
      if (ds && ds !== "none") p.style.display = "none";
    });

    // 顺手把朋友圈 FAB 按钮也隐藏，避免漏网
    const momentsFab = document.getElementById("momentsFabBtn");
    if (momentsFab) momentsFab.style.display = "none";

    const homeMain = document.getElementById("homeMain");
    const homeDock = document.querySelector(".home-dock");
    const pageInd  = document.querySelector(".page-indicator");
    const appMain  = document.querySelector(".app-main");
    const tabBar   = document.getElementById("mainTabBar");

    if (homeMain) homeMain.style.display = "none";
    if (homeDock) homeDock.style.display = "none";
    if (pageInd)  pageInd.style.display  = "none";
    if (appMain)  appMain.style.display  = "";
    if (tabBar)   tabBar.style.display   = "none";

    const page = document.getElementById("page-couple-space");
    if (page) page.classList.add("active");
}

  /* ------------ 给 switchPage 打补丁 ------------ */
  function patchSwitchPage() {
    if (!window.switchPage || window.switchPage._csPatched) return;
    const orig = window.switchPage;
    window.switchPage = function (pageId) {
      const page = document.getElementById("page-couple-space");
      if (pageId === "couple-space") {
        activatePage();
        return;
      }
      if (page) page.classList.remove("active");
      return orig.apply(this, arguments);
    };
    window.switchPage._csPatched = true;
  }

  function setupPatchPolling() {
    if (window.switchPage && !window.switchPage._csPatched) {
      patchSwitchPage();
      return;
    }
    let attempts = 0;
    const id = setInterval(() => {
      if ((window.switchPage && !window.switchPage._csPatched && (patchSwitchPage(), true)) || ++attempts > 60) {
        clearInterval(id);
      }
    }, 100);
  }

  /* ------------ 监听展开菜单点击 ------------ */
  document.addEventListener("click", (e) => {
    const item = e.target.closest('[data-action="coupleSpace"]');
    if (!item) return;
    const expandMenu = document.getElementById("expandMenu");
    if (expandMenu) expandMenu.classList.remove("active");
    const convId = window.currentConversationId;
    if (!convId) {
      if (window.showStatus) window.showStatus("请先进入对话", "error");
      return;
    }
    openCoupleSpace(convId);
  });

  /* ------------ 启动 ------------ */
  function bootstrap() {
    ensurePage();
    setupPatchPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }

  window.coupleSpaceModule = { openCoupleSpace };
  console.log("✅ couple-space 模块就绪");
})();