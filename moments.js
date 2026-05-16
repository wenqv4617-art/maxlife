/* =========================
   Moments 模块
   依赖: window.DB, window.callLLM, window.showStatus, window.getActiveMask
   不依赖 emoji
========================= */
(function () {
  "use strict";

  const STORE = "momentsStore";
const KEY = "main";
const LS_FALLBACK_KEY = "moments_store_fallback_v1";
let __MM_USE_LS_FALLBACK__ = false;

// ---------- 工具 ----------
  function nowTs() { return Date.now(); }
  function uuid(prefix = "id") { return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m])); }
  function fmtTime(ts) {
    const d = new Date(ts || Date.now());
    const M = d.getMonth() + 1, D = d.getDate();
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${M}-${D} ${h}:${m}`;
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
  }
  function parseHM(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hm || "");
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2]) };
  }
  function atLeastReached(hm) {
    const p = parseHM(hm); if (!p) return false;
    const d = new Date();
    if (d.getHours() > p.h) return true;
    if (d.getHours() === p.h && d.getMinutes() >= p.m) return true;
    return false;
  }

  // ---------- 图标 ----------
  const Icons = {
    like: `<svg viewBox="0 0 24 24"><path d="M7 10v10"/><path d="M14 4l-1 4h6a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h7z"/></svg>`,
    comment: `<svg viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>`,
    share: `<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6L8.6 10.5"/></svg>`,
    camera: `<svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4v12H4z"/><circle cx="12" cy="13" r="4"/></svg>`,
    edit: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5l4 4L8 20l-5 1 1-5z"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>`
  };

  // ---------- 数据层 ----------
  function buildDefaultStore() {
  return {
    key: KEY,
    coverImage: "",
    signature: "这个人很懒，什么都没留下。",
    posts: [],
    autoRules: {}
  };
}

function readLSStore() {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function writeLSStore(rec) {
  localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(rec));
}

async function ensureStoreObject() {
  // 已切换到 localStorage fallback
  if (__MM_USE_LS_FALLBACK__) {
    let ls = readLSStore();
    if (!ls) {
      ls = buildDefaultStore();
      writeLSStore(ls);
    }
    return ls;
  }

  // 先尝试 IndexedDB
  try {
    let rec = await window.DB.get(STORE, KEY);
    if (!rec) {
      rec = buildDefaultStore();
      await window.DB.put(STORE, rec);
    }
    return rec;
  } catch (err) {
    // 表不存在时自动降级
    const msg = String(err && err.message || err);
    if (
      msg.includes("object stores was not found") ||
      msg.includes("One of the specified object stores was not found")
    ) {
      console.warn("[moments] momentsStore 不存在，已自动切换 localStorage fallback");
      __MM_USE_LS_FALLBACK__ = true;
      let ls = readLSStore();
      if (!ls) {
        ls = buildDefaultStore();
        writeLSStore(ls);
      }
      return ls;
    }
    throw err;
  }
}

async function saveStore(rec) {
  if (__MM_USE_LS_FALLBACK__) {
    writeLSStore(rec);
    return;
  }
  try {
    await window.DB.put(STORE, rec);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (
      msg.includes("object stores was not found") ||
      msg.includes("One of the specified object stores was not found")
    ) {
      __MM_USE_LS_FALLBACK__ = true;
      writeLSStore(rec);
      return;
    }
    throw err;
  }
}

  // ---------- 角色信息 ----------
  async function getMaskInfo(maskId) {
    const m = await window.DB.get("userProfiles", maskId);
    return m || null;
  }

  async function getCharInfo(charId) {
    return await window.DB.get("characters", charId);
  }

  async function getActiveMaskSafe() {
    if (window.getActiveMask) return await window.getActiveMask();
    const all = await window.DB.getAll("userProfiles");
    return all[0] || null;
  }

  async function getCharsByGroup(groupName) {
    const all = await window.DB.getAll("characters");
    return all.filter(c => (c.group || "默认") === (groupName || "默认"));
  }

  async function getConversationByChar(charId) {
    const all = await window.DB.getAll("conversations");
    return all.find(c => c.charId === charId) || null;
  }

  // ---------- 上下文构建（复用线上聊天） ----------
  async function buildCharMomentPrompt(char, convId) {
    // 取近期消息 + 记忆 + 世界书，尽量和线上一致（简化版）
    const chats = await window.DB.queryByIndex("chats", "conversationId", convId);
    chats.sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
    const recent = chats.filter(x => x.messageType !== "innerVoice").slice(-16);

    const conv = await window.DB.get("conversations", convId);
    const mask = conv ? await window.DB.get("userProfiles", conv.maskId) : null;

    const memories = (await window.DB.queryByIndex("memories", "conversationId", convId) || [])
      .filter(m => m.type === "core_memory" || m.type === "summary")
      .slice(-8);

    const convDetail = await window.DB.get("convDetails", convId);
    const mountedWB = [];
    if (convDetail?.worldbookIds?.length) {
      const allWB = await window.DB.getAll("worldbooks");
      for (const id of convDetail.worldbookIds) {
        const wb = allWB.find(x => x.id === id);
        if (wb) mountedWB.push(wb);
      }
    }

    let chatText = recent.map(m => {
      const who = m.role === "user" ? (mask?.name || "用户") : (char?.name || "角色");
      return `${who}: ${m.content}`;
    }).join("\n");

    let memText = memories.map(m => `- ${m.content}`).join("\n");
    let wbText = mountedWB.map(w => `[${w.title}] ${w.content}`).join("\n");

    return `
你是${char.name}。
你的设定：${char.detail || "（无）"}

请根据“最近上下文”“记忆”“世界设定”发一条朋友圈动态：
- 表达近期发生事情后的感受，或当前心情
- 语气必须贴合你的人设
- 一条尽量不超过100字
- 可以有图片描述（可选）
- 不要emoji，不要markdown标题

输出严格格式：
[TEXT]这里是动态正文
[IMAGES]可选，用 | 分隔图片描述，没有则写 none

最近上下文：
${chatText || "（无）"}

记忆：
${memText || "（无）"}

世界设定：
${wbText || "（无）"}
`.trim();
  }

  async function buildCharCommentPrompt(actorChar, postOwnerName, postText) {
    return `
你是${actorChar.name}。
你的人设：${actorChar.detail || "（无）"}

你在朋友圈看到 ${postOwnerName} 发了一条动态：
「${postText}」

请只输出一行，格式：
[TYPE]like 或 comment
[CONTENT]如果是comment，评论内容（不超过30字）；如果是like，写 none

要求：
- 符合你的人设
- 可以是调侃、关心、起哄、无语等自然反应
- 禁止emoji
`.trim();
  }

  // ---------- AI 解析 ----------
  function parseMomentAI(raw) {
    const textM = raw.match(/\[TEXT\]([\s\S]*?)(?:\n\[IMAGES\]|$)/);
    const imgM = raw.match(/\[IMAGES\]([\s\S]*)$/);
    const text = (textM ? textM[1] : raw).trim().slice(0, 140);
    let images = [];
    if (imgM) {
      const v = imgM[1].trim();
      if (v && v.toLowerCase() !== "none") {
        images = v.split("|").map(s => s.trim()).filter(Boolean).slice(0, 9);
      }
    }
    return { text, images };
  }

  function parseCommentAI(raw) {
    const tm = raw.match(/\[TYPE\]\s*(like|comment)/i);
    const cm = raw.match(/\[CONTENT\]([\s\S]*)$/i);
    const type = tm ? tm[1].toLowerCase() : "comment";
    const content = (cm ? cm[1] : "").trim().slice(0, 30);
    return { type, content: content || "..." };
  }

  // ---------- 发布 ----------
  async function createPost(post) {
    const rec = await ensureStoreObject();
    rec.posts.unshift(post);
    await saveStore(rec);
    await renderFeed();
  }

  async function charPostNowByConversation(convId) {
    const conv = await window.DB.get("conversations", convId);
    if (!conv) return;
    const char = await getCharInfo(conv.charId);
    if (!char) return;

    let text = `${char.name} 今天状态平稳，记录一下。`;
    let imgs = [];

    try {
      if (window.recordApiPending) window.recordApiPending();
      const prompt = await buildCharMomentPrompt(char, convId);
      const raw = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 280 });
      const parsed = parseMomentAI(raw);
      text = parsed.text || text;
      // char 图片默认先不自动生成真实图，IMAGES做文字图占位
      imgs = parsed.images.map(desc => ({ type: "textcard", value: desc }));
    } catch (e) {
      // fallback
    }

    const post = {
      id: uuid("post"),
      authorType: "char",
      charId: char.id,
      charGroup: char.group || "默认",
      text,
      images: imgs,
      visibleGroups: [(char.group || "默认")],
      visibleChars: [],
      likes: [],
      comments: [],
      forwards: [],
      createdAt: nowTs()
    };
    await createPost(post);

    // 异步触发同组互动
    triggerGroupInteraction(post.id).catch(()=>{});
  }

  async function userPostNow({ text, images, visibleGroups, visibleChars }) {
    const mask = await getActiveMaskSafe();
    if (!mask) return;
    const post = {
      id: uuid("post"),
      authorType: "user",
      userMaskId: mask.id,
      text: (text || "").trim().slice(0, 500),
      images: (images || []).slice(0, 9).map(src => ({ type: "photo", value: src })),
      visibleGroups: visibleGroups || [],
      visibleChars: visibleChars || [],
      likes: [],
      comments: [],
      forwards: [],
      createdAt: nowTs()
    };
    await createPost(post);
    triggerGroupInteraction(post.id).catch(()=>{});
  }

  // ---------- 互动 ----------
  async function triggerGroupInteraction(postId) {
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;

    const candidates = await resolveVisibleChars(post);

    for (const c of candidates) {
      const delay = 1200 + Math.floor(Math.random() * 6000);
      setTimeout(() => interactOne(c, postId).catch(()=>{}), delay);
    }
  }

  async function resolveVisibleChars(post) {
    const allChars = await window.DB.getAll("characters");

    // char 发帖：默认同组
    if (post.authorType === "char") {
      return allChars.filter(c =>
        (c.group || "默认") === (post.charGroup || "默认") &&
        c.id !== post.charId
      );
    }

    // user 发帖：按可见分组/可见联系人
    const set = new Map();
    for (const gid of (post.visibleGroups || [])) {
      allChars.filter(c => (c.group || "默认") === gid).forEach(c => set.set(c.id, c));
    }
    for (const cid of (post.visibleChars || [])) {
      const c = allChars.find(x => x.id === cid);
      if (c) set.set(c.id, c);
    }
    return [...set.values()];
  }

  async function interactOne(actorChar, postId) {
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;

    const ownerName = await getPostOwnerName(post);
    const raw = await window.callLLM([{ role: "user", content: await buildCharCommentPrompt(actorChar, ownerName, post.text || "") }], { maxTokens: 120 });
    const parsed = parseCommentAI(raw);

    if (parsed.type === "like") {
      if (!post.likes.some(x => x.charId === actorChar.id)) {
        post.likes.push({ charId: actorChar.id, ts: nowTs() });
      }
    } else {
      post.comments.push({
        id: uuid("cmt"),
        fromType: "char",
        fromCharId: actorChar.id,
        toCommentId: null,
        content: parsed.content,
        ts: nowTs()
      });
    }

    await saveStore(rec);
    await renderFeed();

    // 帖主可能回复（小概率）
    if (Math.random() < 0.35 && post.authorType === "char") {
      const owner = await getCharInfo(post.charId);
      if (owner) {
        setTimeout(async () => {
          const rec2 = await ensureStoreObject();
          const p2 = rec2.posts.find(x => x.id === postId);
          if (!p2) return;
          const last = p2.comments[p2.comments.length - 1];
          if (!last) return;
          p2.comments.push({
            id: uuid("cmt"),
            fromType: "char",
            fromCharId: owner.id,
            toCommentId: last.id,
            content: "收到，记下了。",
            ts: nowTs()
          });
          await saveStore(rec2);
          await renderFeed();
        }, 1500 + Math.random()*4000);
      }
    }
  }

  async function userComment(postId, text) {
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;
    const mask = await getActiveMaskSafe();
    if (!mask) return;

    const cmt = {
      id: uuid("cmt"),
      fromType: "user",
      fromMaskId: mask.id,
      toCommentId: null,
      content: (text || "").trim().slice(0, 80),
      ts: nowTs()
    };
    post.comments.push(cmt);
    await saveStore(rec);
    await renderFeed();

    // 帖主必回
    if (post.authorType === "char") {
      setTimeout(async () => {
        const rec2 = await ensureStoreObject();
        const p2 = rec2.posts.find(x => x.id === postId);
        if (!p2) return;
        p2.comments.push({
          id: uuid("cmt"),
          fromType: "char",
          fromCharId: p2.charId,
          toCommentId: cmt.id,
          content: "看到了，我也这么想。",
          ts: nowTs()
        });
        await saveStore(rec2);
        await renderFeed();
      }, 1200 + Math.random()*2800);
    }

    // 其他可见 char 可能跟评
    const vis = await resolveVisibleChars(post);
    vis.slice(0, 4).forEach((ch, i) => {
      if (Math.random() < 0.45) {
        setTimeout(() => interactOne(ch, postId).catch(()=>{}), 1800 + i * 900 + Math.random()*3000);
      }
    });
  }

  async function toggleLikeByUser(postId) {
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;
    const mask = await getActiveMaskSafe();
    if (!mask) return;

    const idx = post.likes.findIndex(x => x.fromType === "user" && x.fromMaskId === mask.id);
    if (idx >= 0) post.likes.splice(idx, 1);
    else post.likes.push({ fromType: "user", fromMaskId: mask.id, ts: nowTs() });

    await saveStore(rec);
    await renderFeed();
  }

  // ---------- 转发 ----------
  async function forwardPostToConversation(postId, target) {
    // target: {type:'single'|'group', id}
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;

    const owner = await getPostOwnerName(post);
    const commentsText = await buildCommentSummary(post);

    const cardHTML = `
<div class="mm-forward-card" data-moment-post-id="${post.id}" style="border:1px solid #d9d9d9;border-radius:10px;padding:10px;background:#fafafa;cursor:pointer;">
  <div style="font-size:12px;color:#888;margin-bottom:6px;">朋友圈转发</div>
  <div style="font-size:14px;font-weight:600;color:#333;margin-bottom:4px;">发送人：${esc(owner)}</div>
  <div style="font-size:13px;color:#444;line-height:1.5;">${esc(post.text || "")}</div>
</div>`.trim();

    // 构造上下文文本
    const contextText = `user转发了一条朋友圈，发送人${owner}，内容${post.text || ""}，评论有:${commentsText || "无"}`;

    if (target.type === "single") {
      const conv = await window.DB.get("conversations", target.id);
      if (!conv) return;
      await window.DB.put("chats", {
        role: "user",
        content: cardHTML,
        messageType: "moments_forward_card",
        extraContext: contextText,
        refPostId: post.id,
        conversationId: conv.id,
        charId: conv.charId,
        timestamp: nowTs()
      });

      // 仅系统消息体现结果（点赞/评论在朋友圈发生）
      setTimeout(async () => {
        const rec2 = await ensureStoreObject();
        const p2 = rec2.posts.find(x => x.id === post.id);
        if (!p2) return;
        const ch = await getCharInfo(conv.charId);
        if (!ch) return;

        // 模拟看后反应
        if (Math.random() < 0.55) {
          if (!p2.likes.some(x => x.charId === ch.id)) p2.likes.push({ charId: ch.id, ts: nowTs() });
          await window.DB.put("chats", {
            role: "system",
            content: "Ta给你转发的朋友圈点了个赞",
            messageType: "mode_switch",
            conversationId: conv.id,
            charId: conv.charId,
            timestamp: nowTs()
          });
        } else {
          const txt = "这条我有点想法。";
          p2.comments.push({ id: uuid("cmt"), fromType: "char", fromCharId: ch.id, content: txt, toCommentId: null, ts: nowTs() });
          await window.DB.put("chats", {
            role: "system",
            content: `Ta给你转发的朋友圈评论: ${txt}`,
            messageType: "mode_switch",
            conversationId: conv.id,
            charId: conv.charId,
            timestamp: nowTs()
          });
        }
        await saveStore(rec2);
        await renderFeed();
        if (window.loadConversationMessages) window.loadConversationMessages(conv.id);
      }, 1800 + Math.random()*2800);

      if (window.loadConversationMessages) window.loadConversationMessages(conv.id);
    } else {
      // 群聊
      await window.DB.put("groupMessages", {
        groupId: target.id,
        senderType: "user",
        senderId: "user",
        content: cardHTML,
        messageType: "moments_forward_card",
        extraContext: contextText,
        refPostId: post.id,
        timestamp: nowTs()
      });
      if (window.loadGroupMessages) window.loadGroupMessages(target.id);
    }
  }

  async function buildCommentSummary(post) {
    const lines = [];
    for (const c of (post.comments || []).slice(-8)) {
      const from = await getCommentFromName(c);
      if (c.toCommentId) {
        const to = post.comments.find(x => x.id === c.toCommentId);
        const toName = to ? await getCommentFromName(to) : "某人";
        lines.push(`${from}回复${toName}说${c.content}`);
      } else {
        lines.push(`${from}说${c.content}`);
      }
    }
    return lines.join("，");
  }

  // ---------- 自动发 ----------
  let autoTimer = null;
  async function tickAutoPost() {
    const rec = await ensureStoreObject();
    const rules = rec.autoRules || {};
    const keys = Object.keys(rules);
    for (const convId of keys) {
      const r = rules[convId];
      if (!r?.enabled || !r?.timeHM) continue;
      const day = todayKey();
      const doneToday = r.lastSentDay === day;
      if (doneToday) continue;
      if (atLeastReached(r.timeHM)) {
        await charPostNowByConversation(Number(convId));
        r.lastSentDay = day;
      }
    }
    await saveStore(rec);
  }

  function startAutoLoop() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => { tickAutoPost().catch(()=>{}); }, 60 * 1000);
    tickAutoPost().catch(()=>{});
  }

  async function setAutoRule(convId, enabled, timeHM) {
    const rec = await ensureStoreObject();
    rec.autoRules = rec.autoRules || {};
    rec.autoRules[String(convId)] = {
      enabled: !!enabled,
      timeHM: timeHM || "09:00",
      lastSentDay: rec.autoRules[String(convId)]?.lastSentDay || null
    };
    await saveStore(rec);
  }

  async function getAutoRule(convId) {
    const rec = await ensureStoreObject();
    return rec.autoRules?.[String(convId)] || { enabled: false, timeHM: "09:00", lastSentDay: null };
  }

  // ---------- UI 渲染 ----------
  async function getPostOwnerName(post) {
    if (post.authorType === "char") {
      const c = await getCharInfo(post.charId);
      return c?.name || "角色";
    }
    const m = await getMaskInfo(post.userMaskId);
    return m?.name || "我";
  }

  async function getPostOwnerAvatar(post) {
    if (post.authorType === "char") {
      const c = await getCharInfo(post.charId);
      return c?.avatar || "";
    }
    const m = await getMaskInfo(post.userMaskId);
    return m?.avatar || "";
  }

  async function getCommentFromName(c) {
    if (c.fromType === "char") {
      const ch = await getCharInfo(c.fromCharId);
      return ch?.name || "角色";
    }
    const m = await getMaskInfo(c.fromMaskId);
    return m?.name || "我";
  }

  function buildImageGridHtml(images) {
    if (!images?.length) return "";
    const cls = images.length === 1 ? "one" : images.length === 2 ? "two" : "";
    return `<div class="mm-grid ${cls}">
      ${images.map((it, idx) => {
        const src = it.type === "photo" ? it.value : `data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='100%' height='100%' fill='#f3f4f6'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='16' fill='#6b7280'>${(it.value||"图片").slice(0,24)}</text></svg>`
        )}`;
        return `<img src="${src}" data-img-index="${idx}" alt="">`;
      }).join("")}
    </div>`;
  }

  async function renderFeed() {
    const wrap = document.getElementById("momentsFeed");
    if (!wrap) return;

    const rec = await ensureStoreObject();
    const posts = rec.posts || [];

    if (!posts.length) {
      wrap.innerHTML = `<div style="text-align:center;color:#9aa0aa;padding:40px 0;">暂无动态</div>`;
      return;
    }

    let html = "";
    for (const p of posts) {
      const ownerName = await getPostOwnerName(p);
      const avatar = await getPostOwnerAvatar(p);
      const likesNames = [];
      for (const lk of (p.likes || [])) {
        if (lk.charId) {
          const c = await getCharInfo(lk.charId);
          if (c?.name) likesNames.push(c.name);
        } else if (lk.fromType === "user") {
          const m = await getMaskInfo(lk.fromMaskId);
          if (m?.name) likesNames.push(m.name);
        }
      }

      let commentsHtml = "";
      for (const c of (p.comments || [])) {
        const from = await getCommentFromName(c);
        if (c.toCommentId) {
          const to = p.comments.find(x => x.id === c.toCommentId);
          const toN = to ? await getCommentFromName(to) : "某人";
          commentsHtml += `<div class="mm-comment-line"><span class="from">${esc(from)}</span> 回复 <span class="to">${esc(toN)}</span>：${esc(c.content)}</div>`;
        } else {
          commentsHtml += `<div class="mm-comment-line"><span class="from">${esc(from)}</span>：${esc(c.content)}</div>`;
        }
      }

      html += `
      <div class="mm-post" data-post-id="${p.id}">
        <div class="mm-post-top">
          <div class="mm-post-avatar" style="${avatar ? `background-image:url('${avatar}')` : ""}"></div>
          <div class="mm-post-main">
            <div class="mm-post-author">${esc(ownerName)}</div>
            <div class="mm-post-time">${fmtTime(p.createdAt)}</div>
            <div class="mm-post-text">${esc(p.text || "")}</div>
            ${buildImageGridHtml(p.images || [])}
            <div class="mm-post-actions">
              <button class="mm-action" data-act="like">${Icons.like}<span>点赞</span></button>
              <button class="mm-action" data-act="comment">${Icons.comment}<span>评论</span></button>
              <button class="mm-action" data-act="share">${Icons.share}<span>转发</span></button>
            </div>
            <div class="mm-reply-box">
              ${(likesNames.length ? `<div class="mm-likes">${esc(likesNames.join("，"))}</div>` : "")}
              <div class="mm-comments">${commentsHtml || ""}</div>
            </div>
          </div>
        </div>
      </div>`;
    }

    wrap.innerHTML = html;

    wrap.querySelectorAll(".mm-post").forEach(postEl => {
      const pid = postEl.dataset.postId;
      postEl.querySelector('[data-act="like"]')?.addEventListener("click", () => toggleLikeByUser(pid));
      postEl.querySelector('[data-act="comment"]')?.addEventListener("click", async () => {
        const t = prompt("输入评论内容");
        if (!t || !t.trim()) return;
        await userComment(pid, t.trim());
      });
      postEl.querySelector('[data-act="share"]')?.addEventListener("click", () => openSharePicker(pid));
      postEl.addEventListener("dblclick", () => openPostDetail(pid));
    });
  }

  async function renderHeader() {
    const rec = await ensureStoreObject();
    const cover = document.getElementById("momentsCover");
    const sig = document.getElementById("mSignatureInput");
    if (cover) {
      if (rec.coverImage) {
        cover.style.backgroundImage = `url('${rec.coverImage}')`;
      } else {
        cover.style.backgroundImage = "";
      }
    }
    if (sig) sig.value = rec.signature || "";

    const mask = await getActiveMaskSafe();
    const nameEl = document.getElementById("momentsUserName");
    const av = document.getElementById("momentsUserAvatar");
    if (nameEl) nameEl.textContent = mask?.name || "我";
    if (av) {
      av.style.backgroundImage = mask?.avatar ? `url('${mask.avatar}')` : "";
    }
  }

  async function saveSignature(v) {
    const rec = await ensureStoreObject();
    rec.signature = (v || "").trim().slice(0, 80);
    await saveStore(rec);
  }

  async function setCoverImage(dataUrl) {
    const rec = await ensureStoreObject();
    rec.coverImage = dataUrl || "";
    await saveStore(rec);
    await renderHeader();
  }

  // ---------- 详情弹窗 ----------
  async function openPostDetail(postId) {
    const rec = await ensureStoreObject();
    const p = rec.posts.find(x => x.id === postId);
    if (!p) return;
    const owner = await getPostOwnerName(p);

    let likes = [];
    for (const lk of (p.likes||[])) {
      if (lk.charId) {
        const c = await getCharInfo(lk.charId);
        if (c?.name) likes.push(c.name);
      } else {
        const m = await getMaskInfo(lk.fromMaskId);
        if (m?.name) likes.push(m.name);
      }
    }

    let comments = "";
    for (const c of (p.comments||[])) {
      const from = await getCommentFromName(c);
      comments += `<div class="mm-comment-line"><span class="from">${esc(from)}</span>：${esc(c.content)}</div>`;
    }

    const modal = document.getElementById("momentsDetailModal");
    const body = document.getElementById("momentsDetailBody");
    if (!modal || !body) return;
    body.innerHTML = `
      <div class="mm-modal-title">动态详情</div>
      <div style="font-size:13px;color:#666;margin-bottom:6px;">发送人：${esc(owner)}</div>
      <div style="font-size:14px;line-height:1.6;margin-bottom:8px;">${esc(p.text||"")}</div>
      ${buildImageGridHtml(p.images || [])}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #eee;">
        <div style="font-size:13px;color:#355a8a;margin-bottom:6px;">点赞：${esc(likes.join("，") || "暂无")}</div>
        <div>${comments || '<div style="font-size:13px;color:#999;">暂无评论</div>'}</div>
      </div>
    `;
    modal.classList.add("show");
  }

  // ---------- 发帖弹窗 ----------
  let editorImages = [];

  async function openComposer() {
    const modal = document.getElementById("momentsComposerModal");
    const area = document.getElementById("momentsComposerText");
    const prev = document.getElementById("momentsComposerPreview");
    const scopeG = document.getElementById("momentsScopeGroups");
    const scopeC = document.getElementById("momentsScopeChars");

    editorImages = [];
    if (area) area.value = "";
    if (prev) prev.innerHTML = "";

    // 可见范围来源：已有单人对话的联系人
    const convs = await window.DB.getAll("conversations");
    const charIds = [...new Set(convs.map(c => c.charId))];
    const chars = (await window.DB.getAll("characters")).filter(c => charIds.includes(c.id));

    const groups = [...new Set(chars.map(c => c.group || "默认"))];

    if (scopeG) {
      scopeG.innerHTML = groups.map(g => `<label class="mm-scope-item"><input type="checkbox" value="${esc(g)}"> ${esc(g)}</label>`).join("");
    }
    if (scopeC) {
      scopeC.innerHTML = chars.map(c => `<label class="mm-scope-item"><input type="checkbox" value="${esc(c.id)}"> ${esc(c.name)}</label>`).join("");
    }

    modal?.classList.add("show");
  }

  function refreshComposerPreview() {
    const prev = document.getElementById("momentsComposerPreview");
    if (!prev) return;
    prev.innerHTML = editorImages.map(src => `<img src="${src}" alt="">`).join("");
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = e => resolve(e.target.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  async function onComposerPickImages(files) {
    if (!files?.length) return;
    for (const f of files) {
      if (editorImages.length >= 9) break;
      const dataUrl = await readFileAsDataUrl(f);
      editorImages.push(dataUrl);
    }
    refreshComposerPreview();
  }

  async function submitComposer() {
    const text = (document.getElementById("momentsComposerText")?.value || "").trim();
    const vg = [...document.querySelectorAll('#momentsScopeGroups input[type="checkbox"]:checked')].map(i => i.value);
    const vc = [...document.querySelectorAll('#momentsScopeChars input[type="checkbox"]:checked')].map(i => i.value);

    if (!text && !editorImages.length) {
      window.showStatus?.("内容不能为空", "error");
      return;
    }
    await userPostNow({
      text,
      images: editorImages,
      visibleGroups: vg,
      visibleChars: vc
    });
    document.getElementById("momentsComposerModal")?.classList.remove("show");
  }

  // ---------- 转发选择 ----------
  async function openSharePicker(postId) {
    const singles = await window.DB.getAll("conversations");
    const groups = await window.DB.getAll("groupChats");

    let s = "选择转发目标：\n";
    let map = [];
    let idx = 1;

    for (const c of singles) {
      const ch = await getCharInfo(c.charId);
      s += `${idx}. 单聊：${ch?.name || c.id}\n`;
      map.push({ type: "single", id: c.id });
      idx++;
    }
    for (const g of groups) {
      s += `${idx}. 群聊：${g.name}\n`;
      map.push({ type: "group", id: g.id });
      idx++;
    }

    const input = prompt(s + "\n输入序号");
    const n = Number(input);
    if (!n || n < 1 || n > map.length) return;
    await forwardPostToConversation(postId, map[n - 1]);
    window.showStatus?.("已转发", "success");
  }

  // ---------- 对话详情：自动发朋友圈配置 ----------
  async function injectAutoMomentsIntoConvDetail() {
    const root = document.querySelector("#page-conv-detail .worldbook-section:last-child");
    if (!root || document.getElementById("convDetailMomentsSection")) return;

    const sec = document.createElement("div");
    sec.className = "worldbook-section";
    sec.id = "convDetailMomentsSection";
    sec.innerHTML = `
      <h3 style="margin-bottom:12px;">自动发朋友圈</h3>
      <div class="form-group">
        <label><input type="checkbox" id="convAutoMomentEnabled"> 启用自动定时</label>
      </div>
      <div class="form-group">
        <label>时间</label>
        <input type="time" id="convAutoMomentTime" value="09:00">
      </div>
      <div style="display:flex;gap:8px;">
        <button class="small-btn" id="convAutoMomentSaveBtn">保存设置</button>
        <button class="small-btn" id="convAutoMomentPostNowBtn">立即发一条</button>
      </div>
    `;
    root.parentNode.insertBefore(sec, root.nextSibling);

    document.getElementById("convAutoMomentSaveBtn")?.addEventListener("click", async () => {
      const convId = window.currentEditingConvId;
      if (!convId) return;
      const enabled = !!document.getElementById("convAutoMomentEnabled")?.checked;
      const timeHM = document.getElementById("convAutoMomentTime")?.value || "09:00";
      await setAutoRule(convId, enabled, timeHM);
      window.showStatus?.("自动发朋友圈设置已保存", "success");
    });

    document.getElementById("convAutoMomentPostNowBtn")?.addEventListener("click", async () => {
      const convId = window.currentEditingConvId;
      if (!convId) return;
      await charPostNowByConversation(convId);
      window.showStatus?.("已发送一条朋友圈", "success");
    });
  }

  async function syncAutoMomentUI() {
    const convId = window.currentEditingConvId;
    if (!convId) return;
    const rule = await getAutoRule(convId);
    const en = document.getElementById("convAutoMomentEnabled");
    const tm = document.getElementById("convAutoMomentTime");
    if (en) en.checked = !!rule.enabled;
    if (tm) tm.value = rule.timeHM || "09:00";
  }

  // ---------- 页面初始化 ----------
  async function ensureMomentsPageElements() {
    if (document.getElementById("page-moments")) return;

    const appMain = document.querySelector(".app-main");
    if (!appMain) return;

    const page = document.createElement("div");
    page.id = "page-moments";
    page.className = "page";
    page.innerHTML = `
      <div class="chat-header">
        <div class="chat-header-left">
          <button class="back-btn clickable" id="backFromMomentsBtn">←</button>
          <h2>Moments</h2>
        </div>
        <div class="header-actions"></div>
      </div>

      <div class="moments-header">
        <div class="moments-cover" id="momentsCover"></div>
        <div class="moments-cover-tools">
          <button class="mm-icon-btn" id="momentsCoverUploadBtn" title="更换背景">${Icons.camera}</button>
          <input type="file" id="momentsCoverFile" accept="image/*" style="display:none;">
        </div>
        <div class="moments-profile">
          <div class="moments-user-name" id="momentsUserName">我</div>
          <div class="moments-user-avatar" id="momentsUserAvatar"></div>
        </div>
      </div>

      <div class="moments-signature-wrap">
        <input id="mSignatureInput" placeholder="编辑个性签名">
      </div>

      <div class="moments-toolbar">
        <button class="mm-btn primary" id="momentsNewPostBtn">${Icons.edit} 发布动态</button>
      </div>

      <div class="moments-feed" id="momentsFeed"></div>

      <!-- 动态详情 -->
      <div class="mm-modal" id="momentsDetailModal">
        <div class="mm-modal-card">
          <button class="mm-modal-close" id="momentsDetailCloseBtn">${Icons.close}</button>
          <div id="momentsDetailBody"></div>
        </div>
      </div>

      <!-- 发布动态 -->
      <div class="mm-modal" id="momentsComposerModal">
        <div class="mm-modal-card">
          <div class="mm-modal-title">发布动态</div>
          <div class="mm-editor">
            <textarea id="momentsComposerText" placeholder="分享这一刻..."></textarea>
            <div style="display:flex;gap:8px;">
              <button class="mm-btn" id="momentsComposerPickBtn">${Icons.camera} 添加图片</button>
              <input type="file" id="momentsComposerFile" accept="image/*" multiple style="display:none;">
            </div>
            <div class="mm-editor-grid-preview" id="momentsComposerPreview"></div>

            <div class="mm-scope-box">
              <div class="mm-scope-title">可见分组</div>
              <div class="mm-scope-list" id="momentsScopeGroups"></div>
            </div>

            <div class="mm-scope-box">
              <div class="mm-scope-title">可见联系人</div>
              <div class="mm-scope-list" id="momentsScopeChars"></div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="mm-btn" id="momentsComposerCancelBtn">取消</button>
              <button class="mm-btn primary" id="momentsComposerSubmitBtn">发布</button>
            </div>
          </div>
        </div>
      </div>
    `;
    appMain.appendChild(page);

    // 注册到 pages 映射（如果你后面用 switchPage('moments')）
    if (window.pages) window.pages.moments = page;
  }

  function bindPageEvents() {
    document.getElementById("backFromMomentsBtn")?.addEventListener("click", () => {
      if (window.switchPage) window.switchPage("chat");
    });

    document.getElementById("momentsCoverUploadBtn")?.addEventListener("click", () => {
      document.getElementById("momentsCoverFile")?.click();
    });
    document.getElementById("momentsCoverFile")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const data = await readFileAsDataUrl(f);
      await setCoverImage(data);
      e.target.value = "";
    });

    document.getElementById("mSignatureInput")?.addEventListener("change", async (e) => {
      await saveSignature(e.target.value || "");
    });

    document.getElementById("momentsNewPostBtn")?.addEventListener("click", openComposer);

    document.getElementById("momentsDetailCloseBtn")?.addEventListener("click", () => {
      document.getElementById("momentsDetailModal")?.classList.remove("show");
    });
    document.getElementById("momentsDetailModal")?.addEventListener("click", (e) => {
      if (e.target.id === "momentsDetailModal") e.currentTarget.classList.remove("show");
    });

    document.getElementById("momentsComposerPickBtn")?.addEventListener("click", () => {
      document.getElementById("momentsComposerFile")?.click();
    });
    document.getElementById("momentsComposerFile")?.addEventListener("change", async (e) => {
      await onComposerPickImages(e.target.files);
      e.target.value = "";
    });
    document.getElementById("momentsComposerCancelBtn")?.addEventListener("click", () => {
      document.getElementById("momentsComposerModal")?.classList.remove("show");
    });
    document.getElementById("momentsComposerSubmitBtn")?.addEventListener("click", submitComposer);
  }

  // ---------- 对外 ----------
  async function openMomentsPage() {
  if (window.switchPage) window.switchPage("moments");
  try {
    await renderHeader();
    await renderFeed();
  } catch (e) {
    console.error("[moments] open page error:", e);
    const feed = document.getElementById("momentsFeed");
    if (feed) feed.innerHTML = '<div style="text-align:center;color:#999;padding:40px 0;">朋友圈加载失败，请刷新重试</div>';
  }
}

  async function initMomentsModule() {
  try {
    await ensureStoreObject();
  } catch (e) {
    console.error("[moments] init store error:", e);
    // 兜底强制启用 localStorage
    __MM_USE_LS_FALLBACK__ = true;
    const ls = readLSStore() || buildDefaultStore();
    writeLSStore(ls);
  }

  await ensureMomentsPageElements();
  bindPageEvents();
  startAutoLoop();
    // 当进入对话详情时注入“自动发朋友圈”区块
    const obs = new MutationObserver(async () => {
      const active = document.querySelector("#page-conv-detail.page.active");
      if (active) {
        await injectAutoMomentsIntoConvDetail();
        await syncAutoMomentUI();
      }
      const mActive = document.querySelector("#page-moments.page.active");
      if (mActive) {
        await renderHeader();
        await renderFeed();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // 供外部调用
    window.momentsModule = {
      openMomentsPage,
      charPostNowByConversation,
      setAutoRule,
      getAutoRule,
      forwardPostToConversation,
      openPostDetail
    };
  }

  window.initMomentsModule = initMomentsModule;
})();