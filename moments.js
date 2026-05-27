/* =========================
   Moments (朋友圈) 模块
   依赖: window.DB, window.callLLM, window.showStatus, window.getActiveMask
   不依赖 emoji
========================= */
(function () {
  "use strict";

  const STORE = "momentsStore";
  const KEY = "main";
  const LS_FALLBACK_KEY = "moments_store_fallback_v1";
  let __MM_USE_LS_FALLBACK__ = false;

  // ---------- 工作工具 ----------
  function nowTs() { return Date.now(); }

  // 简单写锁，防止并发覆盖
  let __storeLock = Promise.resolve();
  async function withStoreLock(fn) {
    __storeLock = __storeLock.then(fn).catch(fn);
    return __storeLock;
  }
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

  // ---------- 数据存储层 ----------
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
    if (__MM_USE_LS_FALLBACK__) {
      let ls = readLSStore();
      if (!ls) {
        ls = buildDefaultStore();
        writeLSStore(ls);
      }
      return ls;
    }

    try {
      let rec = await window.DB.get(STORE, KEY);
      if (!rec) {
        rec = buildDefaultStore();
        await window.DB.put(STORE, rec);
      }
      return rec;
    } catch (err) {
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

  // ---------- 角色与联系人 ----------
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


async function getActiveMaskConversationChars() {
  const mask = await getActiveMaskSafe();
  const activeMaskId = mask ? mask.id : null;

  const allConvs = await window.DB.getAll("conversations");
  const convs = allConvs.filter(c => {
    // 兼容旧数据：没有 maskId 的会话也算可见
    if (!activeMaskId) return true;
    return !c.maskId || c.maskId === activeMaskId;
  });

  const charIds = [...new Set(convs.map(c => c.charId).filter(Boolean))];
  const allChars = await window.DB.getAll("characters");

  return allChars.filter(c => charIds.includes(c.id));
}

  // ---------- 朋友圈生成上下文 ----------
  async function buildCharMomentPrompt(char, convId) {
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

  // ─── 核心修改 1：重构群发评论提示词，注入面具上下文，杜绝对话身份错乱 ───
  async function buildBatchReactPrompt(chars, postOwnerName, postOwnerType, activeMaskName, postText, existingComments) {
  const charList = chars.map((c, i) => {
    return `${i + 1}. ${c.name}
人设：${(c.detail || "无").slice(0, 180)}`;
  }).join("\n\n");

  const commentsText = existingComments || "暂无评论";
  const isOwnerChar = postOwnerType === "char";

  return `
【场景】
这是朋友圈动态下的互动区。

当前正在使用手机的真实用户面具是：「${activeMaskName}」。

发帖人是：「${postOwnerName}」。
发帖人类型：${isOwnerChar ? "NPC联系人，不是用户" : "用户本人，也就是当前用户面具"}。

动态内容：
「${postText || "（无正文）"}」

已有评论：
${commentsText}

【身份边界，最高优先级】
1. 「${activeMaskName}」才是用户本人。
2. 如果已有评论里出现「${activeMaskName}」或“我”，那就是用户本人在评论。
3. 如果发帖人是 NPC「${postOwnerName}」，其他 NPC 不能把 ta 当成用户，也不能对 ta 进行恋爱、暧昧、撒娇式互动。
4. 所有恋爱、暧昧、占有欲、亲密感，只能指向用户「${activeMaskName}」。
5. NPC之间可以普通评论、吐槽、调侃、关心、阴阳怪气、冷淡路过，但不要像恋人一样互动。
6. 如果动态是用户「${activeMaskName}」发的，亲密角色可以自然表现对用户的在意。

【任务】
请为下面每个角色决定是否点赞、是否评论。

角色列表：
${charList}

【评论要求】
- 评论必须像真实朋友圈评论，短，自然，有人设差异。
- 评论不超过35字。
- 可以不点赞，也可以不评论。
- 不要所有人都夸。
- 不要重复别人说过的话。
- 不要输出解释。

【输出格式，必须每个角色一行】
[角色名]like|评论内容
或
[角色名]like|none
或
[角色名]none|评论内容
或
[角色名]none|none
`.trim();
}

  // ─── 核心修改 1.2：重构单人评论提示词，加入身份防火墙，避免角色打情骂俏 ───
  async function buildCharCommentPrompt(char, ownerName, postOwnerType, activeMaskName, postText) {
    const isOwnerChar = postOwnerType === "char";
    return `
你是${char.name}。
你的说话风格和人设如下：
${char.detail || "（无）"}

当前正在玩手机并互动的用户叫「${activeMaskName}」。
当前发朋友圈的动态所有人是「${ownerName}」（类型：${isOwnerChar ? "另一个NPC联系人角色" : "用户【" + activeMaskName + "】本人"}).

你看到了以下动态：
「${postText}」

根据你的人设和你们之间的关系，请决定你的反应。
⚠️ 严格边界约束：
- 绝对不要和另一个NPC「${ownerName}」打情骂俏或有暧昧举动。所有的暧昧或情意，只能留给用户「${activeMaskName}」。
- 如果「${ownerName}」是另一个NPC，请以普通朋友或同伴的口吻进行符合你性格的评论。

请严格按以下格式输出，不要有其他任何解释文字：
[LIKE]true 或 false
[COMMENT]你的评论内容（如果决定不发表评论，请写 none）
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

  function parseReactAI(raw) {
    const result = { like: false, comment: null };

    // 解析 [LIKE]
    const likeMatch = raw.match(/\[LIKE\]\s*(true|false)/i);
    if (likeMatch) {
      result.like = likeMatch[1].toLowerCase() === "true";
    }

    // 解析 [COMMENT]
    const commentMatch = raw.match(/\[COMMENT\]\s*([\s\S]*?)$/i);
    if (commentMatch && commentMatch[1]) {
      const content = commentMatch[1].trim().slice(0, 150);
      if (content && content.toLowerCase() !== "none" && content.toLowerCase() !== "无") {
        result.comment = content;
      }
    }

    // 容错：如果没有标签但包含关键词
    if (!likeMatch && !commentMatch) {
      const lower = raw.toLowerCase();
      if (lower.includes("点赞") || lower.includes("like") || lower.includes("赞")) {
        result.like = true;
      }
      const trimmed = raw.trim();
      if (trimmed && trimmed.length > 0 && !trimmed.match(/^(none|无|点赞|like|赞)$/i)) {
        result.comment = trimmed.slice(0, 150);
      }
    }

    return result;
  }


  function parseBatchReactAI(raw, charNames) {
    const results = {};
    // 初始化
    charNames.forEach(name => { results[name] = { like: false, comment: null }; });

    const lines = (raw || "").split("\n").filter(l => l.trim());
    for (const line of lines) {
      const m = line.match(/\[(.+?)\]\s*(like|none)\s*\|\s*(.*)/i);
      if (!m) continue;
      const name = m[1].trim();
      const likeStr = m[2].toLowerCase();
      const commentStr = (m[3] || "").trim();

      if (!results[name]) {
        // 模糊匹配
        const found = charNames.find(n => name.includes(n) || n.includes(name));
        if (found) {
          results[found] = {
            like: likeStr === "like",
            comment: (commentStr && commentStr.toLowerCase() !== "none") ? commentStr.slice(0, 80) : null
          };
        }
      } else {
        results[name] = {
          like: likeStr === "like",
          comment: (commentStr && commentStr.toLowerCase() !== "none") ? commentStr.slice(0, 80) : null
        };
      }
    }
    return results;
  }

  // ---------- 发布 ----------
  async function createPost(post) {
    await withStoreLock(async () => {
      const rec = await ensureStoreObject();
      rec.posts.unshift(post);
      await saveStore(rec);
    });
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
      userMaskId: conv.maskId, // ─── 核心修改：让自动定时生成的朋友圈完美绑定所属面具 ───
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

  let finalGroups = visibleGroups || [];
  let finalChars = visibleChars || [];

  // 如果没有选择任何可见范围，默认当前面具会话联系人可见
  if (!finalGroups.length && !finalChars.length) {
    const chars = await getActiveMaskConversationChars();
    finalChars = chars.map(c => c.id);
  }

  const post = {
    id: uuid("post"),
    authorType: "user",
    userMaskId: mask.id,
    text: (text || "").trim().slice(0, 500),
    images: (images || []).slice(0, 9).map(src => ({ type: "photo", value: src })),
    visibleGroups: finalGroups,
    visibleChars: finalChars,
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

  let candidates = await resolveVisibleChars(post);

  // 排除已经点赞或评论过的角色，避免重复刷屏
  const reactedIds = new Set();
  (post.likes || []).forEach(lk => {
    if (lk.charId) reactedIds.add(lk.charId);
  });
  (post.comments || []).forEach(c => {
    if (c.fromType === "char" && c.fromCharId) reactedIds.add(c.fromCharId);
  });

  candidates = candidates.filter(c => !reactedIds.has(c.id));

  if (!candidates.length) {
    console.warn("[moments] 无可互动候选角色", postId);
    return;
  }

  const ownerName = await getPostOwnerName(post);
  const ownerType = post.authorType;
  const mask = await getActiveMaskSafe();
  const maskName = mask ? mask.name : "用户";
  const existingComments = await buildCommentSummary(post);

  let batchResult = {};

  try {
    if (window.recordApiPending) window.recordApiPending();

    const prompt = await buildBatchReactPrompt(
      candidates,
      ownerName,
      ownerType,
      maskName,
      post.text || "",
      existingComments
    );

    // 关键：按候选人数动态增加 token，避免截断
    const maxTokens = Math.min(5000, Math.max(1000, candidates.length * 120));

    const raw = await window.callLLM(
      [{ role: "user", content: prompt }],
      {
        maxTokens,
        temperature: 0.85
      }
    );

    batchResult = parseBatchReactAI(raw, candidates.map(c => c.name));
  } catch (e) {
    console.warn("[triggerGroupInteraction] batch LLM error:", e);
    // fallback：至少让部分角色有反应
    candidates.forEach(c => {
      batchResult[c.name] = {
        like: Math.random() < 0.7,
        comment: Math.random() < 0.35 ? "看到了。" : null
      };
    });
  }

  let delay = 800;

  for (const ch of candidates) {
    const reaction = batchResult[ch.name] || { like: false, comment: null };
    if (!reaction.like && !reaction.comment) continue;

    setTimeout(async () => {
      await withStoreLock(async () => {
        const rec2 = await ensureStoreObject();
        const p2 = rec2.posts.find(x => x.id === postId);
        if (!p2) return;

        // 再次防重
        const alreadyLiked = p2.likes.some(x => x.charId === ch.id);
        const alreadyCommented = p2.comments.some(x =>
          x.fromType === "char" && x.fromCharId === ch.id
        );

        if (reaction.like && !alreadyLiked) {
          p2.likes.push({ charId: ch.id, ts: nowTs() });
        }

        if (reaction.comment && !alreadyCommented) {
          p2.comments.push({
            id: uuid("cmt"),
            fromType: "char",
            fromCharId: ch.id,
            toCommentId: null,
            content: String(reaction.comment).slice(0, 150),
            ts: nowTs()
          });
        }

        await saveStore(rec2);
        await renderFeed();
      });
    }, delay);

    delay += 1000 + Math.random() * 1800;
  }
}
  async function resolveVisibleChars(post) {
  const activeChars = await getActiveMaskConversationChars();

  // 没有当前面具会话联系人时，兜底用全部联系人，避免完全无人反应
  const allChars = activeChars.length ? activeChars : await window.DB.getAll("characters");

  // char 发帖：优先同组角色，排除发帖人
  if (post.authorType === "char") {
    const sameGroup = allChars.filter(c =>
      (c.group || "默认") === (post.charGroup || "默认") &&
      c.id !== post.charId
    );

    // 如果同组没人，兜底让当前面具相关联系人里除帖主外的人反应
    if (sameGroup.length) return sameGroup;

    return allChars.filter(c => c.id !== post.charId);
  }

  // user 发帖：按可见分组/可见联系人
  const set = new Map();

  for (const gid of (post.visibleGroups || [])) {
    allChars
      .filter(c => (c.group || "默认") === gid)
      .forEach(c => set.set(c.id, c));
  }

  for (const cid of (post.visibleChars || [])) {
    const c = allChars.find(x => x.id === cid);
    if (c) set.set(c.id, c);
  }

  // 关键兜底：如果用户没勾选任何可见范围，就默认当前面具的所有会话联系人可见
  if (set.size === 0) {
    allChars.forEach(c => set.set(c.id, c));
  }

  return [...set.values()];
}

  async function interactOne(actorChar, postId) {
    await withStoreLock(async () => {
      const rec = await ensureStoreObject();
      const post = rec.posts.find(p => p.id === postId);
      if (!post) return;

      const ownerName = await getPostOwnerName(post);
      const mask = await getActiveMaskSafe();
      const maskName = mask ? mask.name : "用户";

      let reaction = { like: false, comment: null };
      try {
        const raw = await window.callLLM([{
          role: "user",
          content: await buildCharCommentPrompt(actorChar, ownerName, post.authorType, maskName, post.text || "")
        }], { maxTokens: 1000 });
        reaction = parseReactAI(raw);
      } catch (e) {
        console.warn("[interactOne] LLM error, fallback to like only:", e);
        reaction = { like: true, comment: null };
      }

      if (reaction.like) {
        if (!post.likes.some(x => x.charId === actorChar.id)) {
          post.likes.push({ charId: actorChar.id, ts: nowTs() });
        }
      }

      if (reaction.comment && reaction.comment.trim()) {
        const recentSame = (post.comments || []).find(c =>
          c.fromType === "char" &&
          c.fromCharId === actorChar.id &&
          Math.abs((c.ts || 0) - nowTs()) < 90 * 1000
        );
        if (!recentSame) {
          post.comments.push({
            id: uuid("cmt"),
            fromType: "char",
            fromCharId: actorChar.id,
            toCommentId: null,
            content: reaction.comment,
            ts: nowTs()
          });
        }
      }

      await saveStore(rec);
      await renderFeed();
    });
  }

  async function userComment(postId, text) {
    await withStoreLock(async () => {
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
        content: (text || "").trim().slice(0, 800),
        ts: nowTs()
      };
      post.comments.push(cmt);
      await saveStore(rec);
      await renderFeed();

      // 帖主回复（如果是角色发的帖）
      if (post.authorType === "char") {
        setTimeout(async () => {
          await withStoreLock(async () => {
            const rec2 = await ensureStoreObject();
            const p2 = rec2.posts.find(x => x.id === postId);
            if (!p2) return;

            const owner = await getCharInfo(post.charId);
            if (owner) {
              try {
                const mask = await getActiveMaskSafe();
const maskName = mask?.name || "用户";

const prompt = `
你是${owner.name}。

你的人设：
${owner.detail || "（无）"}

当前真实用户面具是：「${maskName}」。

你的朋友圈动态内容：
「${post.text || "（无正文）"}」

现在用户「${maskName}」在你的朋友圈下评论：
「${text}」

【身份要求】
- 评论者是用户本人「${maskName}」，不是其他NPC。
- 你要根据你和用户的关系回应。
- 如果你对用户有亲密、暧昧、在意、吃醋等情绪，可以自然体现。
- 如果你性格冷淡或傲娇，也可以不明显示好。
- 不要把用户当成路人或另一个NPC。

请输出你的反应，格式如下：
[LIKE]true 或 false
[COMMENT]评论内容，如果不想评论写 none

要求：
- 评论不超过35字。
- 严格按格式输出。
- 不要输出其他任何文字。
`.trim();
                const raw = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 600, temperature: 0.85 });
                const reaction = parseReactAI(raw);

                if (reaction.like && !p2.likes.some(x => x.charId === owner.id)) {
                  p2.likes.push({ charId: owner.id, ts: nowTs() });
                }

                if (reaction.comment) {
                  p2.comments.push({
                    id: uuid("cmt"),
                    fromType: "char",
                    fromCharId: owner.id,
                    toCommentId: cmt.id,
                    content: reaction.comment,
                    ts: nowTs()
                  });
                }
              } catch (e) {
                if (!p2.likes.some(x => x.charId === owner.id)) {
                  p2.likes.push({ charId: owner.id, ts: nowTs() });
                }
              }
            }

            await saveStore(rec2);
            await renderFeed();
          });
        }, 1200 + Math.random() * 2800);
      }
    });

    // 其他可见 char 可能跟评（批量一次调用）
    setTimeout(() => triggerGroupInteraction(postId).catch(()=>{}), 2000);
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

    const previewText = (post.text || "").slice(0, 900);
    const imgCount = (post.images || []).length;
    const hasImage = imgCount > 0;

    const cardHTML = `
<div class="mm-forward-card" data-moment-post-id="${post.id}">
  <div class="mmf-head">
    <div class="mmf-dot"></div>
    <div class="mmf-label">MOMENT SHARE</div>
  </div>

  <div class="mmf-body">
    <div class="mmf-owner">${esc(owner)}</div>
    <div class="mmf-text">${esc(previewText)}${(post.text || "").length > 90 ? "..." : ""}</div>

    ${hasImage ? `
      <div class="mmf-photo-strip">
        <div class="mmf-photo-badge">${imgCount} PHOTOS</div>
      </div>
    ` : `
      <div class="mmf-photo-strip empty">
        <div class="mmf-photo-badge">TEXT ONLY</div>
      </div>
    `}
  </div>

  <div class="mmf-foot">
    <span class="mmf-meta">Tap to view details</span>
    <span class="mmf-arrow">›</span>
  </div>
</div>`.trim();

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

      // 目标角色看后反应（LLM决定点赞/评论）
      setTimeout(async () => {
        await withStoreLock(async () => { // ─── 核心修改 3：添加写锁，防止数据库并发读写覆盖 ───
          const rec2 = await ensureStoreObject();
          const p2 = rec2.posts.find(x => x.id === post.id);
          if (!p2) return;

          const ch = await getCharInfo(conv.charId);
          if (!ch) return;

          let actionType = "like";
          let actionContent = "none";

          try {
            const prompt = `
  你是${ch.name}。
  你的人设：${ch.detail || "（无）"}

  用户转发给你一条朋友圈：
  发送人：${owner}
  内容：${post.text || ""}
  评论摘要：${commentsText || "无"}

  请做出反应，格式如下：
  [LIKE]true 或 false
  [COMMENT]评论内容（如果不想评论，写 none）

  要求：
  - 严格按上面格式输出
  - 不要输出其他任何文字`;

            const raw = await window.callLLM([{ role: "user", content: prompt }], { maxTokens: 1000 });
            const parsed = parseReactAI(raw);
            actionType = parsed.comment ? "comment" : "like";
            actionContent = parsed.comment || "none";
          } catch (e) {
            // fallback
            actionType = Math.random() < 0.6 ? "like" : "comment";
            actionContent = "这条我有点想法。";
          }

          if (actionType === "like") {
            if (!p2.likes.some(x => x.charId === ch.id)) {
              p2.likes.push({ charId: ch.id, ts: nowTs() });
            }
            await window.DB.put("chats", {
              role: "system",
              content: "Ta给你转发的朋友圈点了个赞",
              messageType: "mode_switch",
              conversationId: conv.id,
              charId: conv.charId,
              timestamp: nowTs()
            });
          } else {
            const txt = (actionContent || "这条我有点想法。").slice(0, 300);
            p2.comments.push({
              id: uuid("cmt"),
              fromType: "char",
              fromCharId: ch.id,
              content: txt,
              toCommentId: null,
              ts: nowTs()
            });
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
        });
        if (window.loadConversationMessages) await window.loadConversationMessages(conv.id);
      }, 1800 + Math.random() * 2800);

      if (window.loadConversationMessages) await window.loadConversationMessages(conv.id);
      return;
    }

    // 群聊转发
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
    if (window.loadGroupMessages) await window.loadGroupMessages(target.id);
  }

  async function buildCommentSummary(post) {
  const lines = [];

  for (const c of (post.comments || []).slice(-12)) {
    const from = await getCommentFromName(c);

    if (c.toCommentId) {
      const to = (post.comments || []).find(x => x.id === c.toCommentId);
      const toName = to ? await getCommentFromName(to) : "某人";
      lines.push(`${from}回复${toName}说：${c.content}`);
    } else {
      lines.push(`${from}说：${c.content}`);
    }
  }

  return lines.join("\n");
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

  // ---------- UI 呈现渲染与实时过滤 ----------
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
        const src = it.type === "photo" ? it.value : (() => {
  const txt = (it.value || "图片");
  const maxCharsPerLine = 12;
  const lines = [];
  for (let i = 0; i < txt.length; i += maxCharsPerLine) {
    lines.push(txt.slice(i, i + maxCharsPerLine));
  }
  const lineH = 22;
  const startY = 150 - (lines.length * lineH) / 2 + lineH / 2;
  const tspans = lines.map((ln, idx) =>
    `<tspan x='150' dy='${idx === 0 ? 0 : lineH}'>${ln.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</tspan>`
  ).join("");
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><rect width='100%' height='100%' fill='#f3f4f6'/><text x='150' y='${startY}' text-anchor='middle' font-size='14' fill='#6b7280'>${tspans}</text></svg>`
  )}`;
})();
        return `<img src="${src}" data-img-index="${idx}" alt="">`;
      }).join("")}
    </div>`;
  }

  async function renderFeed() {
    const wrap = document.getElementById("momentsFeed");
    if (!wrap) return;

    const rec = await ensureStoreObject();
    const posts = rec.posts || [];

    // ─── 核心修改 4：获取当前活跃面具，进行朋友圈动态的严格隔离过滤 ───
    const mask = await getActiveMaskSafe();
    const activeMaskId = mask ? mask.id : null;

    const filteredPosts = posts.filter(p => {
      // 兼容历史未标记面具的老动态；对于新发动态，只展现匹配当前面具的动态
      if (!p.userMaskId) return true;
      return p.userMaskId === activeMaskId;
    });

    if (!filteredPosts.length) {
      wrap.innerHTML = `<div style="text-align:center;color:#9aa0aa;padding:40px 0;">当前面具下暂无动态</div>`;
      return;
    }

    let html = "";
    for (const p of filteredPosts) {
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
          commentsHtml += `<div class="mm-comment-line" data-comment-id="${c.id}" style="cursor:pointer;"><span class="from">${esc(from)}</span>：${esc(c.content)}</div>`;
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
    wrap.querySelectorAll(".mm-comment-line[data-comment-id]").forEach(line => {
  line.addEventListener("click", async (e) => {
    e.stopPropagation();
    const cmtId = line.dataset.commentId;
    const postEl = line.closest(".mm-post");
    const pid = postEl?.dataset.postId;
    if (!pid) return;
    const fromName = line.querySelector(".from")?.textContent || "";
    const t = prompt(`回复 ${fromName}：`);
    if (!t || !t.trim()) return;
    await userReplyComment(pid, cmtId, t.trim());
  });
});
  }
  
  async function userReplyComment(postId, toCommentId, text) {
  await withStoreLock(async () => {
    const rec = await ensureStoreObject();
    const post = rec.posts.find(p => p.id === postId);
    if (!post) return;
    const mask = await getActiveMaskSafe();
    if (!mask) return;

    post.comments.push({
      id: uuid("cmt"),
      fromType: "user",
      fromMaskId: mask.id,
      toCommentId: toCommentId,
      content: text.slice(0, 800),
      ts: nowTs()
    });

    await saveStore(rec);
    await renderFeed();
  });

  // 触发帖主+其他人反应（一次调用）
  setTimeout(() => triggerGroupInteraction(postId).catch(()=>{}), 1500);
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
  av.style.backgroundColor = mask?.avatar ? "transparent" : "#d8d8d8";
}
  }

  async function saveSignature(v) {
    await withStoreLock(async () => {
      const rec = await ensureStoreObject();
      rec.signature = (v || "").trim().slice(0, 800);
      await saveStore(rec);
    });
  }

  async function setCoverImage(dataUrl) {
    await withStoreLock(async () => {
      const rec = await ensureStoreObject();
      rec.coverImage = dataUrl || "";
      await saveStore(rec);
    });
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

const textImgBox = document.getElementById("momentsTextImgEditor");
const textImgInput = document.getElementById("momentsTextImgInput");
if (textImgBox) textImgBox.style.display = "none";
if (textImgInput) textImgInput.value = "";

    // ─── 核心修改 5：可见范围与面具严格隔离 ───
    // 在发布动态时，仅仅拉取和展示【当前活跃面具下】建立过单人会话交往的联系人及分组
    const mask = await getActiveMaskSafe();
    const activeMaskId = mask ? mask.id : null;
    const allConvs = await window.DB.getAll("conversations");
    const convs = allConvs.filter(c => c.maskId === activeMaskId);

    const charIds = [...new Set((convs || []).map(c => c.charId).filter(Boolean))];
    const allChars = await window.DB.getAll("characters");
    const chars = allChars.filter(c => charIds.includes(c.id));
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
  
  function makeTextImageDataUrl(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");

    const g = ctx.createLinearGradient(0, 0, 900, 900);
    g.addColorStop(0, "#fff9f3");
    g.addColorStop(1, "#f0e7dc");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 900);

    ctx.fillStyle = "rgba(80,62,48,.08)";
    for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * 900, Math.random() * 900, 20 + Math.random() * 70, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.fillStyle = "#4b3f36";
    ctx.font = "bold 46px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const maxWidth = 720;
    const lineHeight = 66;
    const chars = text.split("");
    let lines = [];
    let cur = "";
    for (const ch of chars) {
        const t = cur + ch;
        if (ctx.measureText(t).width > maxWidth) {
            lines.push(cur);
            cur = ch;
        } else {
            cur = t;
        }
    }
    if (cur) lines.push(cur);
    lines = lines.slice(0, 8);

    // ✅ 修复后的循环
    const totalH = lines.length * lineHeight;
    let y = 450 - totalH / 2 + lineHeight / 2;
    for (const ln of lines) {
        ctx.fillText(ln, 450, y);
        y += lineHeight;
    }

    return canvas.toDataURL("image/jpeg", 0.92);
}
function addTextImageToComposer(text) {
    if (!Array.isArray(editorImages)) editorImages = [];
    if (editorImages.length >= 9) return;
    const dataUrl = makeTextImageDataUrl(text);
    editorImages.push(dataUrl);
    refreshComposerPreview();
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
  let __MM_SHARE_POST_ID__ = null;

async function openSharePicker(postId) {
  __MM_SHARE_POST_ID__ = postId;
  const listEl = document.getElementById("momentsShareList");
  const modal = document.getElementById("momentsShareModal");
  if (!listEl || !modal) return;

  const singles = await window.DB.getAll("conversations");
  const groups = await window.DB.getAll("groupChats");

  let html = "";

  for (const c of singles) {
    const ch = await getCharInfo(c.charId);
    html += `
      <label class="mm-share-item">
        <input type="checkbox" data-type="single" data-id="${c.id}">
        <div>
          <div>单聊 · ${esc(ch?.name || String(c.id))}</div>
          <div class="mm-share-meta">会话ID: ${esc(String(c.id))}</div>
        </div>
      </label>
    `;
  }

  for (const g of groups) {
    html += `
      <label class="mm-share-item">
        <input type="checkbox" data-type="group" data-id="${g.id}">
        <div>
          <div>群聊 · ${esc(g.name || String(g.id))}</div>
          <div class="mm-share-meta">群ID: ${esc(String(g.id))}</div>
        </div>
      </label>
    `;
  }

  if (!html) {
    html = `<div style="text-align:center;color:#999;padding:24px 0;">暂无可转发会话</div>`;
  }

  listEl.innerHTML = html;
  modal.classList.add("show");
}

  // ---------- 对话详情：自动发朋友圈配置 ----------
  async function injectAutoMomentsIntoConvDetail() {
  const page = document.getElementById("page-conv-detail");
  if (!page) return;
  if (document.getElementById("convDetailMomentsSection")) return;

  // 优先插在“角色与你的关系”块后面
  let anchor = null;
  const sections = page.querySelectorAll(".worldbook-section");
  sections.forEach(sec => {
    const h3 = sec.querySelector("h3");
    if (h3 && (h3.textContent || "").includes("角色与你的关系")) {
      anchor = sec;
    }
  });

  const sec = document.createElement("div");
  sec.className = "worldbook-section";
  sec.id = "convDetailMomentsSection";
  sec.innerHTML = `
    <h3 style="margin-bottom:12px;">自动发朋友圈</h3>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="convAutoMomentEnabled">
        启用自动定时
      </label>
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

  if (anchor && anchor.parentNode) {
    anchor.parentNode.insertBefore(sec, anchor.nextSibling);
  } else {
    const scroller = page.querySelector('div[style*="overflow-y:auto"]');
    if (scroller) scroller.appendChild(sec);
    else page.appendChild(sec);
  }

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
    if (window.currentConversationId === Number(convId) && window.loadConversationMessages) {
      await window.loadConversationMessages(Number(convId));
    }
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

      <div class="moments-toolbar"></div>

<div class="moments-feed" id="momentsFeed"></div>

<button class="mm-fab" id="momentsFabBtn" title="发布动态">+</button>

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
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
  <button class="mm-btn" id="momentsComposerTextImgBtn">文字图</button>
  <button class="mm-btn" id="momentsComposerPhotoBtn">${Icons.camera} 上传照片</button>
  <input type="file" id="momentsComposerFile" accept="image/*" multiple style="display:none;">
</div>

<div id="momentsTextImgEditor" style="display:none;border:1px solid #e5e7eb;border-radius:8px;padding:8px;">
  <div style="font-size:12px;color:#666;margin-bottom:6px;">输入文字图内容</div>
  <textarea id="momentsTextImgInput" placeholder="例如：今天的心情是薄荷蓝" style="width:100%;min-height:64px;border:1px solid #e5e7eb;border-radius:6px;padding:8px;resize:vertical;"></textarea>
  <div style="margin-top:8px;display:flex;justify-content:flex-end;gap:8px;">
    <button class="mm-btn" id="momentsTextImgCancelBtn">取消</button>
    <button class="mm-btn primary" id="momentsTextImgAddBtn">加入图片</button>
  </div>
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

  <!-- 转发选择 -->
  <div class="mm-modal" id="momentsShareModal">
    <div class="mm-modal-card">
      <div class="mm-modal-title">选择转发对象</div>
      <div class="mm-share-list" id="momentsShareList"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">
        <button class="mm-btn" id="momentsShareCancelBtn">取消</button>
        <button class="mm-btn primary" id="momentsShareConfirmBtn">确认转发</button>
      </div>
    </div>
  </div>
`;
    appMain.appendChild(page);

    // 注册到 pages 映射（如果你后面用 switchPage('moments')）
    if (window.pages) window.pages.moments = page;
  }

  function bindPageEvents() {
    // ─── 核心修改 2.1：加入事件防重锁，彻底规避按一次按键绑定两个重复事件的情况 ───
    if (window.__moments_events_bound) return;
    window.__moments_events_bound = true;

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

    document.getElementById("momentsFabBtn")?.addEventListener("click", openComposer);

// 上传照片
document.getElementById("momentsComposerPhotoBtn")?.addEventListener("click", () => {
  document.getElementById("momentsComposerFile")?.click();
});
document.getElementById("momentsComposerFile")?.addEventListener("change", async (e) => {
  await onComposerPickImages(e.target.files);
  e.target.value = "";
});

// 文字图入口
document.getElementById("momentsComposerTextImgBtn")?.addEventListener("click", () => {
  const box = document.getElementById("momentsTextImgEditor");
  if (box) box.style.display = box.style.display === "none" ? "block" : "none";
});

document.getElementById("momentsTextImgCancelBtn")?.addEventListener("click", () => {
  const box = document.getElementById("momentsTextImgEditor");
  if (box) box.style.display = "none";
  const inp = document.getElementById("momentsTextImgInput");
  if (inp) inp.value = "";
});

document.getElementById("momentsTextImgAddBtn")?.addEventListener("click", async () => {
  const inp = document.getElementById("momentsTextImgInput");
  const txt = (inp?.value || "").trim();
  if (!txt) {
    window.showStatus?.("请输入文字图内容", "info");
    return;
  }
  addTextImageToComposer(txt);
  if (inp) inp.value = "";
  const box = document.getElementById("momentsTextImgEditor");
  if (box) box.style.display = "none";
});
    document.getElementById("momentsComposerCancelBtn")?.addEventListener("click", () => {
      document.getElementById("momentsComposerModal")?.classList.remove("show");
    });
    document.getElementById("momentsComposerSubmitBtn")?.addEventListener("click", submitComposer);
    
      document.getElementById("momentsShareCancelBtn")?.addEventListener("click", () => {
    document.getElementById("momentsShareModal")?.classList.remove("show");
  });

  document.getElementById("momentsShareConfirmBtn")?.addEventListener("click", async () => {
    const postId = __MM_SHARE_POST_ID__;
    if (!postId) return;

    const picks = [...document.querySelectorAll('#momentsShareList input[type="checkbox"]:checked')];
    if (!picks.length) {
      window.showStatus?.("请至少选择一个会话", "info");
      return;
    }

    for (const p of picks) {
      await forwardPostToConversation(postId, {
        type: p.dataset.type,
        id: Number(p.dataset.id)
      });
      
    }

    document.getElementById("momentsShareModal")?.classList.remove("show");
    window.showStatus?.("已转发", "success");
  });

  document.getElementById("momentsShareModal")?.addEventListener("click", (e) => {
    if (e.target.id === "momentsShareModal") e.currentTarget.classList.remove("show");
  });
  
  // ====== 新增：绑定详情弹窗关闭事件 ======
document.getElementById("momentsDetailCloseBtn")?.addEventListener("click", () => {
  document.getElementById("momentsDetailModal")?.classList.remove("show");
});

document.getElementById("momentsDetailModal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove("show");
  }
});

  bindForwardCardGlobalClick();
}

function bindForwardCardGlobalClick() {
  if (window.__MM_FORWARD_BIND__) return;
  window.__MM_FORWARD_BIND__ = true;

  document.addEventListener("click", async (e) => {
    const card = e.target.closest(".mm-forward-card");
    if (!card) return;

    const postId = card.getAttribute("data-moment-post-id");
    if (!postId) return;

    // 打开朋友圈页面并弹详情
    if (window.switchPage) window.switchPage("moments");
    try {
      await renderHeader();
      await renderFeed();
      await openPostDetail(postId);
    } catch (err) {
      console.error("[moments] open forward post detail error:", err);
    }
  });
}

  // ---------- 对外 ----------
  async function openMomentsPage() {
  // 不能再调用 switchPage("moments")，否则递归死循环
  try {
    await renderHeader();
    await renderFeed();
    
    // 由 switchPage + CSS 控制显示，不在这里强制设置
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

    // 首次预渲染（防首次空白）
try {
  await renderHeader();
  await renderFeed();
  setTimeout(() => { renderHeader().catch(()=>{}); }, 80);
} catch (e) {
  console.warn("[moments] pre-render skipped:", e);
}

// 供外部调用
window.momentsModule = {
  openMomentsPage,
  charPostNowByConversation,
  setAutoRule,
  getAutoRule,
  forwardPostToConversation,
  openPostDetail,
  ensureConvDetailMomentSection: async function () {
    await injectAutoMomentsIntoConvDetail();
    await syncAutoMomentUI();
  }
};
  }

  window.initMomentsModule = initMomentsModule;
})();