/* ============================================
   查手机模块 - phone-check.js
   版本：v1.0
   依赖：
   - window.DB (IndexedDB)
   - window.callLLM (AI调用)
   - window.escapeHtml
   - window.getAvatarColor
   - window.showStatus
   - window.currentConversationId / window.currentCharId
   ============================================ */

(function() {
    "use strict";

    let DB, callLLM, escapeHtml, getAvatarColor, showStatus;

    // 模块内部状态
    let currentPhoneCharId = null;
    let currentPhoneApp = null;
    let longPressTimer = null;
    window._currentDiaryIdx = undefined;
    
    
   // ==================== SVG 图标（禁止 emoji） ====================
const PHONE_SVG = {
    send: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>`,
    refresh: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"></path>
        <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"></path>
    </svg>`,
    phone: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18"></line>
    </svg>`,
    loading: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.2-8.56"></path>
    </svg>`,
    warning: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>`
};

function phoneIcon(name) {
    return PHONE_SVG[name] || '';
}

    // ==================== 初始化入口 ====================
    window.initPhoneCheckModule = function(deps) {
        DB = deps.DB || window.DB;
        callLLM = deps.callLLM || window.callLLM;
        escapeHtml = deps.escapeHtml || window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
        getAvatarColor = deps.getAvatarColor || window.getAvatarColor || function(n) { const c=['#f39c12','#3498db','#e67e22','#2ecc71','#9b59b6','#1abc9c','#e74c3c']; return c[(n||'?').charCodeAt(0)%c.length]; };
        showStatus = deps.showStatus || window.showStatus || function(m,t){console.log(`[${t}]${m}`);};
        bindPhoneCheckEvents();
        console.log('📱 查手机模块已加载');
    };

    // ==================== 数据读写（持久化到 IndexedDB phoneData store） ====================
    async function getPhoneData(charId) {
        const key = `phone_${charId}`;
        let data = await DB.get('phoneData', key);
        if (!data) {
            data = await createDefaultPhoneData(charId);
            if (data) await DB.put('phoneData', data);
        }
        return data;
    }

    async function savePhoneData(data) {
        if (DB && data) await DB.put('phoneData', data);
    }

    async function createDefaultPhoneData(charId) {
        const char = await DB.get('characters', charId);
        const charName = char?.name || '未知';
        return {
            key: `phone_${charId}`,
            charId,
            todos: [
                { text: `给${charName}的朋友准备生日礼物`, checked: false, time: '2026/5/10 09:00' },
                { text: '预约牙医', checked: false, time: '2026/5/15 14:30' },
                { text: '交电费', checked: true, time: '2026/4/28 11:00' },
            ],
            messages: [{ contactName: '', contactAvatar: '', messages: [], time: '', isPinned: true }],
            browserHistory: [
                { text: 'HTML CSS JS 教程', time: '今天 10:30' },
                { text: '附近的咖啡店推荐', time: '今天 09:15' },
            ],
            browserPosts: {},
            memoItems: [
                { text: '买生日礼物', checked: false },
                { text: '预约牙医', checked: false },
            ],
            diaryEntries: [
                { title: '今天天气真好', date: '2026年5月3日', content: '今天天气特别好，阳光明媚。' },
            ],
            forumPosts: [
                { title: '前端开发学习路线分享', date: '2小时前', content: '刚入门前端。', comments: [{ name: '前端小白', text: '太有用了！' }] },
            ],
            shopCart: [
                { name: '手机壳 蓝色', desc: 'iPhone 15 Pro Max 硅胶保护壳', price: '¥39.90', icon: '📱' },
            ],
            shopTotalAssets: '¥8,500.00',
            shopAssets: [
                { desc: '工资收入', amount: '+ ¥8,500.00', type: 'income' },
                { desc: '房租支出', amount: '- ¥2,000.00', type: 'expense' },
            ],
            statsData: {
                totalTime: '7h 30min',
                apps: [
                    { name: '讯息', time: '3h 10min', color: '#72c9bf', icon: '✉️', iconBg: '#e0f7f6' },
                    { name: '浏览器', time: '1h 20min', color: '#ffc107', icon: '🌐', iconBg: '#fff8e1' },
                ]
            }
        };
    }

    // ==================== 事件绑定 ====================
    function bindPhoneCheckEvents() {
        const expandMenu = document.getElementById('expandMenu');
        if (expandMenu && !document.querySelector('.expand-menu-item[data-action="checkPhone"]')) {
            const item = document.createElement('div');
            item.className = 'expand-menu-item';
            item.dataset.action = 'checkPhone';
            item.innerHTML = '<span class="expand-menu-icon">📱</span><span class="expand-menu-label">查手机</span>';
            expandMenu.appendChild(item);
            item.addEventListener('click', () => { expandMenu.classList.remove('active'); openPhoneCheck(); });
        }
        // 如果 HTML 中已有，也绑定
        const existing = document.querySelector('.expand-menu-item[data-action="checkPhone"]');
        if (existing && !existing.dataset.phoneBound) {
            existing.dataset.phoneBound = '1';
            existing.addEventListener('click', () => { document.getElementById('expandMenu').classList.remove('active'); openPhoneCheck(); });
        }

        // 桌面 & Dock 按钮
        document.querySelectorAll('#phoneAppBox2x2 .phone-app-item, #phoneAppBox .phone-app-item').forEach(el => { if(!el.dataset.phoneBound){ el.dataset.phoneBound='1'; el.addEventListener('click',()=>{ const a=el.dataset.app; if(a)openPhoneApp(a); }); } });
        const dockMap = { phoneDockMessageBtn:'message', phoneDockBrowserBtn:'browser', phoneDockDiaryBtn:'diary' };
        Object.keys(dockMap).forEach(id => { const el=document.getElementById(id); if(el&&!el.dataset.phoneBound){ el.dataset.phoneBound='1'; el.addEventListener('click',()=>openPhoneApp(dockMap[id])); } });

        // 返回/关闭按钮
        const closeBtn=document.getElementById('phoneCheckCloseBtn'); if(closeBtn&&!closeBtn.dataset.phoneBound){ closeBtn.dataset.phoneBound='1'; closeBtn.addEventListener('click',closePhoneCheck); }
        const fb=document.getElementById('phoneFullscreenBackBtn'); if(fb&&!fb.dataset.phoneBound){ fb.dataset.phoneBound='1'; fb.addEventListener('click',closePhoneApp); }
        const db=document.getElementById('phoneDetailBackBtn'); if(db&&!db.dataset.phoneBound){ db.dataset.phoneBound='1'; db.addEventListener('click',closePhoneDetail); }

        // 清除按钮
        const acb=document.getElementById('phoneAppClearBtn'); if(acb&&!acb.dataset.phoneBound){ acb.dataset.phoneBound='1'; acb.addEventListener('click',()=>{ const t=document.getElementById('phoneAppTitle')?.dataset?.appType; if(t)clearPhoneAppData(t); }); }
        const dcb=document.getElementById('phoneDetailClearBtn'); if(dcb&&!dcb.dataset.phoneBound){ dcb.dataset.phoneBound='1'; dcb.addEventListener('click',()=>{ const t=document.getElementById('phoneDetailTitle')?.dataset?.appType; if(t==='diary'&&window._currentDiaryIdx!==undefined)clearSingleDiary(window._currentDiaryIdx); else if(t==='browser')clearBrowserSearchCache(); }); }
    }

    // ==================== 打开/关闭 ====================
    window.openPhoneCheck = function() {
        const charId = window.currentCharId;
        if (!charId) { showStatus('请先进入对话','error'); return; }
        currentPhoneCharId = charId;
        document.getElementById('phoneCheckPage')?.classList.add('active');
        renderPhoneDesktop(); updatePhoneTime();
    }
    function closePhoneCheck() { document.getElementById('phoneCheckPage')?.classList.remove('active'); }
    function updatePhoneTime() {
        const n=new Date();
        document.getElementById('phoneTime').innerText = n.getHours().toString().padStart(2,'0')+':'+n.getMinutes().toString().padStart(2,'0');
        const w=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
        document.getElementById('phoneDate').innerText = `${n.getFullYear()}年${(n.getMonth()+1).toString().padStart(2,'0')}月${n.getDate().toString().padStart(2,'0')}日 ${w[n.getDay()]}`;
    }
    setInterval(()=>{ if(document.getElementById('phoneCheckPage')?.classList.contains('active')) updatePhoneTime(); }, 60000);

    async function renderPhoneDesktop() {
        const data = await getPhoneData(currentPhoneCharId);
        if (!data) return;
        const unchecked = (data.todos||[]).filter(t=>!t.checked);
        document.getElementById('phoneTodoTitle').textContent = `${unchecked.length} 项待办`;
        document.getElementById('phoneTodoList').innerHTML = unchecked.length ? unchecked.slice(0,6).map(t=>`<div class="phone-todo-item"><div class="phone-todo-checkbox"></div><div class="phone-todo-text">${escapeHtml(t.text)}</div></div>`).join('') : '<div style="text-align:center;color:#999;padding:20px;font-size:13px;">暂无待办</div>';
    }

    // ==================== App 打开/关闭 ====================
    function openPhoneApp(appType) {
        currentPhoneApp = appType;
        document.getElementById('phoneFullscreenApp').classList.add('active');
        const t = document.getElementById('phoneAppTitle');
        t.dataset.appType = appType;
        setupLongPress(t, appType);
        const map = { message:renderPhoneMessages, browser:renderPhoneBrowser, memo:renderPhoneMemo, diary:renderPhoneDiary, forum:renderPhoneForum, shop:renderPhoneShop, stats:renderPhoneStats };
        if (map[appType]) map[appType]();
    }
    function closePhoneApp() { document.getElementById('phoneFullscreenApp').classList.remove('active'); currentPhoneApp=null; if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;} }
    function closePhoneDetail() {
    document.getElementById('phoneDetailPage').classList.remove('active');
    document.getElementById('phoneFullscreenApp').classList.add('active');
    document.getElementById('phoneDetailClearBtn').style.display='none';
    window._currentDiaryIdx=undefined;
    // 重新渲染当前 App
    if (currentPhoneApp) {
        const map = { message:renderPhoneMessages, browser:renderPhoneBrowser, memo:renderPhoneMemo, diary:renderPhoneDiary, forum:renderPhoneForum, shop:renderPhoneShop, stats:renderPhoneStats };
        if (map[currentPhoneApp]) map[currentPhoneApp]();
    }
}

    // ==================== 长按生成 ====================
    function setupLongPress(el, appType) {
        if (!el) return;
        const names = { message:'讯息', browser:'浏览器', memo:'备忘录', diary:'日记', forum:'论坛', shop:'购物', stats:'统计' };
        el.textContent = names[appType]||'应用';
        el.dataset.appType = appType;
        const n = el.cloneNode(true);
        el.parentNode.replaceChild(n, el);
        const start = () => { if(longPressTimer)clearTimeout(longPressTimer); longPressTimer = setTimeout(()=>triggerPhoneRegenerate(appType, n), 1500); };
        const stop = () => { if(longPressTimer)clearTimeout(longPressTimer); };
        n.addEventListener('touchstart', start, {passive:false}); n.addEventListener('touchend',stop); n.addEventListener('touchmove',stop);
        n.addEventListener('mousedown',start); n.addEventListener('mouseup',stop); n.addEventListener('mouseleave',stop);
    }

    async function triggerPhoneRegenerate(appType, titleEl) {
        if (!currentPhoneCharId) return;
        showLongPressHint('🔮 AI 正在生成内容...');
        if (titleEl) { titleEl.textContent='生成中...'; titleEl.style.opacity='0.6'; }
        try {
            if (appType==='memo') { const d=await getPhoneData(currentPhoneCharId); const u=(d?.memoItems||[]).filter(m=>!m.checked); if(u.length){ const c=Math.min(Math.floor(Math.random()*2)+1,u.length); const now=new Date(); const ts=`${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`; for(let i=0;i<c;i++){u[i].checked=true;u[i].time=ts;} await savePhoneData(d); } }
            let extra={};
            if(appType==='message'){ const d=await getPhoneData(currentPhoneCharId); extra.existingChats=(d?.messages||[]).filter(c=>!c.isPinned); extra.pinnedContactName=(d?.messages||[]).find(c=>c.isPinned)?.contactName||''; }
            const prompt = await buildPhoneRegeneratePrompt(appType, extra);
            if (window.recordApiPending) window.recordApiPending();
const reply = await callLLM([{role:'user',content:prompt}], {maxTokens:3000,temperature:0.9});
            await applyPhoneRegenerateData(appType, parsePhoneJSON(reply));
            // 根据当前所在页面来刷新
            const detailPage = document.getElementById('phoneDetailPage');
            if (detailPage && detailPage.classList.contains('active')) {
                // 在详情页中，重新触发详情页渲染
                // 对于讯息，需要重新调用 openPhoneChatDetail
                // 简单处理：关闭详情页，回到 App 列表
                closePhoneDetail();
            }
            // 重新渲染当前 App
            const map = { message:renderPhoneMessages, browser:renderPhoneBrowser, memo:renderPhoneMemo, diary:renderPhoneDiary, forum:renderPhoneForum, shop:renderPhoneShop, stats:renderPhoneStats };
            if (map[appType]) map[appType]();
            // 同时也刷新桌面待办
            renderPhoneDesktop();
            showLongPressHint('✅ 内容已更新');
        } catch(e) { showLongPressHint('❌ 生成失败: '+e.message); }
        if (titleEl) { const names={message:'讯息',browser:'浏览器',memo:'备忘录',diary:'日记',forum:'论坛',shop:'购物',stats:'统计'}; titleEl.textContent=names[appType]||'应用'; titleEl.style.opacity='1'; }
    }

    function showLongPressHint(msg) {
        const e=document.querySelector('.long-press-hint'); if(e)e.remove();
        const h=document.createElement('div'); h.className='long-press-hint'; h.innerHTML = escapeHtml(msg);
        document.querySelector('.phone-mock')?.appendChild(h);
        setTimeout(()=>h.remove(),2500);
    }

    // ==================== Prompt 构建 ====================
    async function buildPhoneRegeneratePrompt(appType, extra={}) {
        const charId = currentPhoneCharId;
        const char = await DB.get('characters', charId);
        const convId = window.currentConversationId;
        let base = `你是${char?.name||'用户'}。`;
        if (convId) {
            const cd = await DB.get('convDetails', convId);
            if (cd?.charDetail) base += `\n角色设定：${cd.charDetail}`;
            else if (char?.detail) base += `\n角色设定：${char.detail}`;
            if (cd?.relationship) base += `\n与用户的关系：${cd.relationship}`;

            const mems = await DB.queryByIndex('memories', 'conversationId', convId);
            const core = mems.filter(m=>m.type==='core_memory').sort((a,b)=>b.createdAt-a.createdAt);
            if (core.length) { base += '\n\n【核心记忆】\n'; core.forEach(m=>{base+=`• ${m.content}\n`;}); }

            const chats = await DB.queryByIndex('chats', 'conversationId', convId);
            const dc = chats.filter(c=>c.messageType!=='innerVoice').sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
            if (dc.length) { base += '\n【最近对话上下文】\n'; dc.slice(0,10).reverse().forEach(c=>{base+=`${c.role==='user'?'用户':char?.name}: ${c.content}\n`;}); }
        } else if (char?.detail) { base += `\n角色设定：${char.detail}`; }

        const prompts = {
            message: `${base}

【重要】你现在在看自己的手机讯息列表。置顶聊天是和你正在聊天的人（${extra.pinnedContactName || '用户'}），这个对话的消息不要生成。

${(()=>{
    const chats = extra.existingChats || [];
    if (!chats.length) return '（目前除了置顶聊天外没有其他对话）';
    return '以下是已有的其他对话：\n' + chats.map((c,i) => 
        `${i+1}. "${c.contactName}" - 最近消息：\n` + 
        (c.messages||[]).slice(-3).map(m => `  ${m.role==='self'?'你':c.contactName}: ${m.text}`).join('\n')
    ).join('\n\n');
})()}

请生成新的讯息内容。要求：
1. 绝对不要生成和"${extra.pinnedContactName || '用户'}"之间的对话
2. 新对话的联系人名字必须是你生活中的其他人（朋友、家人、同事等）
3. 每个对话有4-8条消息
4. 可以给置顶联系人换一个备注名（pinnedNickname字段）
5. 输出JSON格式：
{
  "pinnedNickname": "你给置顶联系人起的新备注（可选，不换就省略）",
  "messages": [
    {
      "contactName": "联系人名字（不能是${extra.pinnedContactName || '用户'}）",
      "time": "时间描述",
      "messages": [
        {"role": "other", "text": "对方的消息"},
        {"role": "self", "text": "你的回复"}
      ]
    }
  ]
}`,
            browser: `${base}\n\n生成5-8条搜索历史。输出JSON: {"history":[{"text":"","time":""}]}`,
            browser_search: `${base}\n\n搜索"${extra.searchText||''}"，生成3-4篇200-350字长文帖子带评论。JSON: {"posts":[...]}`,
            memo: `${base}\n\n生成5-8条新备忘录，全部未完成。JSON: {"memos":[{"text":"","checked":false}]}`,
            diary: `${base}

【写日记前的强制思考】
【身份确认 - 非常重要】
你是${char?.name || '角色'}，现在你需要以你自己的口吻，第一视角写一篇日记。
日记中的所有经历、情感、想法都是你的，禁止代入用户视角。

在动笔之前，请先在心里梳理以下问题（不要输出这些思考，只在内心完成）：

1. 【人际关系回顾】
   - 你生命中目前最重要的人是谁？你和他们最近发生了什么？
   - 有没有谁让你开心、失望、想念、愧疚、感激？
   - 你和核心记忆中提到的人，最近关系怎么样了？
   - 有没有已经很久没联系、但偶尔会想起的人？

2. 【近期经历回顾】
   - 最近几天发生了什么具体的事？（从对话上下文中找线索）
   - 有没有什么让你情绪波动的事情？
   - 你的工作/学习/生活中最近有什么变化或压力？
   - 有没有什么未完成的心愿或遗憾？

3. 【内心状态】
   - 你现在的情绪基调是什么？孤独、平静、焦虑、期待、怀旧？
   - 有没有什么事情你"在人前不说，但心里一直在想"？
   - 你对未来有什么隐隐的担忧或期待？
   - 今天有没有某个瞬间让你突然想到什么？

4. 【写作要求】
   - 从上面梳理的内容中，选择1-2个最有感触的点来写
   - 日记要有具体的细节（某句话、某个场景、某个时间点），不要泛泛而谈
   - 情感要真实复杂，可以有矛盾、犹豫、不确定
   - 可以写一两件日常小事，从小事中折射出你的性格和情感
   - 语气要像真的在和自己对话，可以喃喃自语、反问自己
   - 禁止写"今天天气很好"这种模板化开头，直接从心里想的事情开始写
   - 不要写成作文，要像真实日记——可能有点乱、有点碎，但真实

只生成一篇日记，JSON格式：
{"diaries":[{"title":"标题","date":"${new Date().toLocaleDateString('zh-CN')}","content":"内容"}]}`,
            forum: `${base}

你现在正在浏览手机上的论坛App。请以**你自己的口吻和视角**生成3-5篇论坛帖子。要求：
- 帖子内容要体现你的性格特点、兴趣爱好和生活状态
- 每篇帖子有2-4条评论，评论者来自各种不同的网友
- 评论风格要真实多样（有赞同、有抬杠、有吃瓜、有热心建议）
- 评论者名字要有网感（如"暴躁老哥"、"爱吃瓜的猫"）
- 时间合理分布（今天、昨天、几天前）
- 输出JSON: {"posts":[{"title":"","date":"","content":"","comments":[{"name":"","text":""}]}]}`,
            shop: `${base}\n\n你正在看自己的购物App。请生成购物车（2-4件商品）和最近收支（5-8条）。总资产是一个数字。\n输出JSON：\n{"cart":[{"name":"商品名","desc":"描述","price":"¥39.90","icon":"📱"}],"assets":[{"desc":"工资收入","amount":"+ ¥8,500.00","type":"income"}],"totalAssets":"¥12,580.50"}`,
            stats: `${base}

你现在在看手机上的屏幕使用统计。请生成过去24小时的使用数据。

要求：
- 5-7个App，种类多样化（社交、短视频、购物、工具、游戏等）
- 总时长3-10小时，各App时间加起来等于总时长
- 时间格式严格使用 "Xh Xmin"（如 "3h 10min"、"0h 30min"），min部分不能省略
- 每个App必须有 name、time、color、icon、iconBg 五个字段
- 只输出纯JSON，不要任何解释文字，不要代码块标记

输出格式：
{"totalTime":"7h 30min","apps":[{"name":"微信","time":"2h 15min","color":"#07C160","icon":"💬","iconBg":"#e0f7e6"},...]}`,
        };
        return prompts[appType] || base;
    }

    function parsePhoneJSON(reply) {
        console.log('🔍 原始回复:', reply);
        let jsonStr = reply;
        
        // 1. 先试着匹配代码块里的 JSON
        const codeMatch = reply.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (codeMatch) {
            jsonStr = codeMatch[1].trim();
            console.log('🔍 从代码块提取:', jsonStr.substring(0, 100));
        }
        
        // 2. 找到第一个 { 和最后一个 }
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
        }
        
        // 3. 尝试解析
        try {
            const result = JSON.parse(jsonStr);
            console.log('✅ JSON解析成功');
            return result;
        } catch(e) {
            console.error('❌ JSON解析失败:', e.message, '\n尝试解析的字符串:', jsonStr.substring(0, 200));
            return null;
        }
    }
    async function applyPhoneRegenerateData(appType, parsed) {
        if (!parsed) return;
        const data = await getPhoneData(currentPhoneCharId);
        if (!data) return;
        switch (appType) {
            case 'message':
                if (parsed.pinnedNickname) {
                    const p = data.messages.find(c => c.isPinned);
                    if (p) p.contactName = parsed.pinnedNickname;
                }
                if (parsed.messages && Array.isArray(parsed.messages)) {
                    if (!data.messages) data.messages = [];
                    parsed.messages.forEach(newChat => {
                        if (newChat.isPinned) return;
                        const newName = (newChat.contactName || '').trim();
                        if (!newName || !newChat.messages || !newChat.messages.length) {
                            console.warn('⚠️ 跳过无效对话:', newChat);
                            return;
                        }
                        const normalized = newName.replace(/\s+/g, '').toLowerCase();
                        const existing = data.messages.find(m => 
                            !m.isPinned && (m.contactName || '').replace(/\s+/g, '').toLowerCase() === normalized
                        );
                        if (existing) {
                            existing.messages = [...(existing.messages || []), ...newChat.messages];
                            existing.time = newChat.time || existing.time;
                            console.log('📩 追加到已有对话:', existing.contactName);
                        } else {
                            data.messages.push({
                                contactName: newName,
                                contactAvatar: newChat.contactAvatar || '',
                                messages: newChat.messages,
                                time: newChat.time || '',
                                isPinned: false
                            });
                            console.log('📩 新增对话:', newName);
                        }
                    });
                }
                break;
            case 'browser': if(parsed.history)data.browserHistory=parsed.history; break;
            case 'memo': if(parsed.memos){data.memoItems=[...parsed.memos.map(m=>({...m,checked:false})),...(data.memoItems||[])];data.todos=[...parsed.memos.map(m=>({text:m.text,checked:false,time:''})),...(data.todos||[])];} break;
            case 'diary': if(parsed.diaries)data.diaryEntries=[...parsed.diaries,...(data.diaryEntries||[])]; break;
            case 'forum': if(parsed.posts)data.forumPosts=[...parsed.posts,...(data.forumPosts||[])]; break;
            case 'shop':
                if (parsed.cart && Array.isArray(parsed.cart)) {
                    if (!data.shopCart) data.shopCart = [];
                    data.shopCart = [...parsed.cart, ...data.shopCart];
                }
                if (parsed.assets && Array.isArray(parsed.assets)) {
                    if (!data.shopAssets) data.shopAssets = [];
                    data.shopAssets = [...parsed.assets, ...data.shopAssets];
                }
                if (parsed.totalAssets) data.shopTotalAssets = String(parsed.totalAssets);
                break;
            case 'stats': if(parsed.totalTime)data.statsData=parsed; break;
        }
        await savePhoneData(data);
        await renderPhoneDesktop();
    }

    // ==================== 各 App 渲染（精简版） ====================
    async function syncUserChatToPhone(data) {
    const convId=window.currentConversationId; if(!convId)return;
    const chats=await DB.queryByIndex('chats','conversationId',convId);
    // 升级过滤条件：过滤掉心声、看手机入侵通知以及所有系统指令/提示
    const dc=chats.filter(c=>
        c.messageType !== 'innerVoice' &&
        c.messageType !== 'phone_intrusion' &&
        c.role !== 'system'
    ).sort((a,b)=>(a.timestamp||0)-(a.timestamp||0));
    if(!dc.length)return;
    const cd=await DB.get('convDetails',convId);
        const char = await DB.get('characters', currentPhoneCharId);
        const un=cd?.userName||'用户';
        const ua=cd?.userAvatar||'';
        const cn=cd?.charName||char?.name||'角色';
        const ca=cd?.charAvatar||char?.avatar||'';
        const synced=dc.map(c=>({role:c.role==='user'?'other':'self',text:c.content||'',avatar:c.role==='user'?ua:ca,name:c.role==='user'?un:cn}));
        let uc=data.messages.find(c=>c.isPinned);
        if(!uc){uc={contactName:un,contactAvatar:ua,messages:[],time:'',isPinned:true};data.messages.unshift(uc);}
        uc.contactAvatar=ua; uc.messages=synced; if(synced.length)uc.time='现在';
        await savePhoneData(data);
    }

    async function renderPhoneMessages() {
        const data=await getPhoneData(currentPhoneCharId); await syncUserChatToPhone(data);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='讯息';
        let html='<div class="phone-chat-list">';
        const all=data.messages||[];
        all.forEach((c,i)=>{
            if (!c || !c.contactName) return;
            const last=c.messages?.[c.messages.length-1];
            const prev=last?(last.text?.length>15?last.text.substring(0,15)+'...':last.text):'';
            const ava=c.contactAvatar||'';
            const avaBg=ava?`background-image:url('${ava}');background-size:cover;background-position:center;`:'';
            const avaTxt=ava?'':c.contactName.charAt(0);
            html+=`<div class="phone-chat-item" data-chat-idx="${i}" style="${c.isPinned?'background:#f0f0f0;':''}"><div class="phone-chat-avatar" style="background-color:${getAvatarColor(c.contactName)};${avaBg}">${avaTxt}</div><div class="phone-chat-info"><div class="phone-chat-name-row"><div class="phone-chat-name">${escapeHtml(c.contactName)}</div><div class="phone-chat-time">${escapeHtml(c.time||'')}</div></div><div class="phone-chat-preview">${escapeHtml(prev)}</div></div></div>`;
        });
        html+='</div>'; content.innerHTML=html;
        content.querySelectorAll('.phone-chat-item').forEach(el=>{el.addEventListener('click',()=>{const i=parseInt(el.dataset.chatIdx); if(!isNaN(i))openPhoneChatDetail(i);});});
    }

    function openPhoneChatDetail(idx) {
    getPhoneData(currentPhoneCharId).then(data => {
        if (!data || !data.messages) return;

        const chat = data.messages[idx];
        if (!chat || !chat.contactName) return;

        document.getElementById('phoneDetailTitle').textContent = chat.contactName;
        document.getElementById('phoneDetailTitle').dataset.chatIdx = String(idx);
        document.getElementById('phoneDetailTitle').dataset.appType = 'message';

        const messageHtml = '<div class="phone-chat-messages" id="phoneChatMessagesBox">' + (chat.messages || []).map(m => {
            const mava = m.avatar || '';
            const mavaBg = mava ? `background-image:url('${mava}');background-size:cover;background-position:center;` : '';
            const mavaTxt = mava ? '' : (m.name || chat.contactName || '?').charAt(0);
            const mcolor = m.role === 'self' ? '#72c9bf' : '#ffc107';

            return `
                <div class="phone-message-item ${m.role === 'self' ? 'right' : 'left'}">
                    <div class="phone-message-avatar" style="background-color:${mcolor};${mavaBg}">${escapeHtml(mavaTxt)}</div>
                    <div class="phone-message-bubble">${escapeHtml(m.text)}</div>
                </div>
            `;
        }).join('') + '</div>';

        const inputHtml = chat.isPinned ? `
            <div class="phone-chat-send-disabled">
                置顶对话会同步当前主聊天，不能在这里伪装发送。
            </div>
        ` : `
            <div class="phone-chat-send-area">
                <input class="phone-chat-send-input" id="phoneChatSendInput" placeholder="用 Ta 的手机发消息..." maxlength="300">
                <button class="phone-chat-send-btn" id="phoneChatSendBtn" title="发送">${phoneIcon('send')}</button>
                <button class="phone-chat-ai-btn" id="phoneChatFetchReplyBtn" title="获取对方回复">${phoneIcon('refresh')}</button>
            </div>
        `;

        document.getElementById('phoneDetailContent').innerHTML = `
            <div class="phone-chat-detail-wrap">
                ${messageHtml}
                ${inputHtml}
            </div>
        `;

        document.getElementById('phoneDetailPage').classList.add('active');
        document.getElementById('phoneFullscreenApp').classList.remove('active');

        const box = document.getElementById('phoneChatMessagesBox');
        if (box) box.scrollTop = box.scrollHeight;

        if (!chat.isPinned) {
            const input = document.getElementById('phoneChatSendInput');
            const sendBtn = document.getElementById('phoneChatSendBtn');
            const fetchBtn = document.getElementById('phoneChatFetchReplyBtn');

            sendBtn?.addEventListener('click', () => sendPhoneChatMessage(idx));
            fetchBtn?.addEventListener('click', () => fetchPhoneContactReply(idx));

            input?.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendPhoneChatMessage(idx);
                }
            });
        }
    });
}

async function sendPhoneChatMessage(chatIdx) {
    const input = document.getElementById('phoneChatSendInput');
    const text = input?.value?.trim();

    if (!text) return;
    if (!currentPhoneCharId) return;

    const data = await getPhoneData(currentPhoneCharId);
    const chat = data?.messages?.[chatIdx];

    if (!chat || chat.isPinned) return;

    if (!Array.isArray(chat.messages)) chat.messages = [];

    chat.messages.push({
        role: 'self',
        text,
        time: Date.now()
    });

    chat.time = '刚刚';

    await savePhoneData(data);

    await recordPhoneIntrusion({
        type: 'send',
        contactName: chat.contactName,
        userText: text,
        contactReply: ''
    });

    input.value = '';
    openPhoneChatDetail(chatIdx);
    renderPhoneMessages();
}

async function fetchPhoneContactReply(chatIdx) {
    if (!currentPhoneCharId) return;

    const data = await getPhoneData(currentPhoneCharId);
    const chat = data?.messages?.[chatIdx];

    if (!chat || chat.isPinned) return;

    const fetchBtn = document.getElementById('phoneChatFetchReplyBtn');
    if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = phoneIcon('loading');
        fetchBtn.classList.add('loading');
    }

    try {
        const prompt = await buildPhoneContactReplyPrompt(chat);

        if (window.recordApiPending) window.recordApiPending();

        const reply = await callLLM([
            { role: 'user', content: prompt }
        ], {
            maxTokens: 800,
            temperature: 0.85
        });

        const text = parsePhoneContactReply(reply);

        if (!Array.isArray(chat.messages)) chat.messages = [];

        chat.messages.push({
            role: 'other',
            text,
            time: Date.now()
        });

        chat.time = '刚刚';

        await savePhoneData(data);

        const lastSelf = [...chat.messages].reverse().find(m => m.role === 'self');

        await recordPhoneIntrusion({
            type: 'reply',
            contactName: chat.contactName,
            userText: lastSelf?.text || '',
            contactReply: text
        });

        openPhoneChatDetail(chatIdx);
        renderPhoneMessages();

    } catch (e) {
        showLongPressHint('获取回复失败: ' + e.message);
    } finally {
        if (fetchBtn) {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = phoneIcon('refresh');
            fetchBtn.classList.remove('loading');
        }
    }
}

async function buildPhoneContactReplyPrompt(chat) {
    const char = await DB.get('characters', currentPhoneCharId);
    const convId = window.currentConversationId;

    let base = `你是"${chat.contactName}"。`;
    base += `\n你正在和"${char?.name || '角色'}"的手机聊天。`;
    base += `\n但是现在实际发消息的人不是${char?.name || '角色'}本人，而是用户偷偷拿到了${char?.name || '角色'}的手机。`;
    base += `\n你不能直接知道这一点，除非聊天内容明显不符合${char?.name || '角色'}平时的说话方式。`;

    if (convId) {
        const cd = await DB.get('convDetails', convId);
        if (cd?.charDetail) {
            base += `\n\n【${char?.name || '角色'}的人设】\n${cd.charDetail}`;
        } else if (char?.detail) {
            base += `\n\n【${char?.name || '角色'}的人设】\n${char.detail}`;
        }

        if (cd?.relationship) {
            base += `\n\n【${char?.name || '角色'}和用户的关系】\n${cd.relationship}`;
        }

        const chats = await DB.queryByIndex('chats', 'conversationId', convId);
        const recent = chats
            .filter(c => c.messageType !== 'innerVoice')
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .slice(0, 8)
            .reverse();

        if (recent.length) {
            base += `\n\n【用户和${char?.name || '角色'}最近的主对话】\n`;
            recent.forEach(c => {
                if (c.role === 'system') {
                    base += `系统：${c.content}\n`;
                } else {
                    base += `${c.role === 'user' ? '用户' : char?.name || '角色'}：${c.content}\n`;
                }
            });
        }
    } else if (char?.detail) {
        base += `\n\n【${char?.name || '角色'}的人设】\n${char.detail}`;
    }

    const history = (chat.messages || []).slice(-12).map(m => {
        return `${m.role === 'self' ? char?.name || '角色' : chat.contactName}：${m.text}`;
    }).join('\n');

    return `${base}

【你和${char?.name || '角色'}的聊天记录】
${history || '暂无'}

【回复要求】
1. 你只能扮演"${chat.contactName}"。
2. 你不知道手机被用户拿走，除非上一条消息非常异常。
3. 如果你觉得对方不像${char?.name || '角色'}，可以试探、怀疑、反问。
4. 回复要像真实即时通讯，短一些，自然一点。
5. 只输出一句或两句回复，不要解释，不要 JSON，不要代码块。
6. 禁止使用 emoji。
7. 禁止使用括号动作描写。

现在请以"${chat.contactName}"的口吻回复最后一条消息。`;
}

function parsePhoneContactReply(reply) {
    if (!reply) return '你刚刚那句话有点奇怪。';

    let text = String(reply)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*["“]|["”]\s*$/g, '')
        .trim();

    // 容错：如果模型输出 JSON
    try {
        const j = JSON.parse(text);
        if (j.reply) text = j.reply;
        else if (j.text) text = j.text;
        else if (j.message) text = j.message;
    } catch (e) {}

    text = text
        .replace(/\[MSG\][^:：]*[:：]/g, '')
        .replace(/[😀-🙏🌀-🗿🚀-🛿☀-⛿✀-➿]/gu, '')
        .trim();

    if (!text) text = '你刚刚那句话有点奇怪。';

    return text.slice(0, 300);
}

async function recordPhoneIntrusion(payload) {
    const convId = window.currentConversationId;
    const charId = currentPhoneCharId || window.currentCharId;

    if (!convId || !charId) return;

    const contactName = payload.contactName || '某个联系人';
    const userText = payload.userText || '';
    const contactReply = payload.contactReply || '';

    let content = '';

    if (payload.type === 'send') {
        content = `【查手机事件】用户偷偷使用你的手机，给你的联系人"${contactName}"发送了一条消息："${userText}"。你不一定立刻发现，但如果后续对话、手机通知或联系人反应暴露异常，你可能会察觉，并按你的性格调侃、追问或质问用户。`;
    } else if (payload.type === 'reply') {
        content = `【查手机事件】用户偷偷使用你的手机与联系人"${contactName}"聊天。用户之前发送："${userText}"。联系人"${contactName}"回复："${contactReply}"。你不一定立刻发现，但如果你察觉到手机被动过、聊天记录异常或联系人态度变化，你可以按你的性格调侃、追问或质问用户。`;
    } else {
        content = `【查手机事件】用户偷偷使用了你的手机。你不一定立刻发现，但之后可能察觉异常。`;
    }

    await DB.put('chats', {
        role: 'system',
        content,
        messageType: 'phone_intrusion',
        conversationId: convId,
        charId,
        timestamp: Date.now()
    });

    const conv = await DB.get('conversations', convId);
    if (conv) {
        conv.updatedAt = Date.now();
        await DB.put('conversations', conv);
    }
}

    async function renderPhoneBrowser() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='浏览器';
        let html='<div class="phone-browser-search"><div class="phone-search-bar"><input type="text" placeholder="搜索或输入网址" disabled></div></div><div class="phone-history-section"><div class="phone-history-title">搜索历史</div>';
        (data?.browserHistory||[]).forEach((h,i)=>{html+=`<div class="phone-history-item" data-bidx="${i}"><span class="phone-history-icon">🕒</span><span class="phone-history-text">${escapeHtml(h.text)}</span><span class="phone-history-time">${escapeHtml(h.time||'')}</span></div>`;});
        html+='</div>'; content.innerHTML=html;
        content.querySelectorAll('.phone-history-item').forEach(el=>{el.addEventListener('click',async()=>{const i=parseInt(el.dataset.bidx);const item=data.browserHistory[i];if(!item)return;document.getElementById('phoneDetailTitle').textContent=item.text;document.getElementById('phoneDetailClearBtn').style.display='block';document.getElementById('phoneDetailContent').innerHTML='<div style="text-align:center;color:#999;padding:40px;">🔍 正在搜索...</div>';document.getElementById('phoneDetailPage').classList.add('active');document.getElementById('phoneFullscreenApp').classList.remove('active');if(!data.browserPosts)data.browserPosts={};if(!data.browserPosts[item.text]){try{const p=await buildPhoneRegeneratePrompt('browser_search',{searchText:item.text});const r=await callLLM([{role:'user',content:p}],{maxTokens:2500});const j=parsePhoneJSON(r);if(j?.posts){data.browserPosts[item.text]=j.posts;await savePhoneData(data);}}catch(e){document.getElementById('phoneDetailContent').innerHTML='<div style="text-align:center;color:#999;padding:40px;">❌ '+e.message+'</div>';return;}}const posts=data.browserPosts[item.text]||[];document.getElementById('phoneDetailContent').innerHTML=posts.map((p,i)=>`<div class="phone-list-item" style="cursor:pointer;flex-direction:column;align-items:flex-start;" onclick="window._openBP('${escapeHtml(item.text)}',${i})"><div style="font-size:16px;font-weight:500;">${escapeHtml(p.title)}</div><div style="font-size:13px;color:#666;">${escapeHtml((p.content||'').substring(0,100))}...</div></div>`).join('');});});
    }
    window._openBP = function(key,idx) { getPhoneData(currentPhoneCharId).then(d=>{const p=d.browserPosts?.[key]?.[idx];if(!p)return;document.getElementById('phoneDetailContent').innerHTML=`<div class="phone-detail-title">${escapeHtml(p.title)}</div><div class="phone-detail-body">${escapeHtml(p.content||'')}</div><div class="phone-section-title">评论 (${(p.comments||[]).length})</div>`+(p.comments||[]).map(c=>`<div class="phone-detail-comment"><div class="phone-detail-comment-name">${escapeHtml(c.name)}</div><div class="phone-detail-comment-text">${escapeHtml(c.text)}</div></div>`).join('');});};

    async function renderPhoneMemo() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='备忘录';
        const items=[...(data?.memoItems||[])].sort((a,b)=>a.checked?1:-1);
        content.innerHTML=items.length?items.map(m=>`<div class="phone-todo-item" style="padding:8px 16px;${m.checked?'opacity:0.5':''}"><div class="phone-todo-checkbox ${m.checked?'checked':''}">${m.checked?'✓':''}</div><div class="phone-todo-text" style="font-size:15px;${m.checked?'text-decoration:line-through':''}">${escapeHtml(m.text)}</div></div>`).join(''):'<div style="text-align:center;color:#999;padding:40px;">暂无备忘录</div>';
    }

    async function renderPhoneDiary() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='日记';
        content.innerHTML=(data?.diaryEntries||[]).map((d,i)=>`<div class="phone-list-item" data-didx="${i}"><div class="phone-list-item-info"><div class="phone-list-item-title">${escapeHtml(d.title)}</div><div class="phone-list-item-sub">${escapeHtml((d.content||'').substring(0,30))}...</div></div><div class="phone-list-item-date">${escapeHtml(d.date||'')}</div></div>`).join('')||'<div style="text-align:center;color:#999;padding:40px;">暂无日记</div>';
        content.querySelectorAll('[data-didx]').forEach(el=>{el.addEventListener('click',()=>{const i=parseInt(el.dataset.didx);window._currentDiaryIdx=i;const d=data.diaryEntries[i];document.getElementById('phoneDetailClearBtn').style.display='block';document.getElementById('phoneDetailTitle').textContent=d.title;document.getElementById('phoneDetailContent').innerHTML=`<div class="phone-detail-title">${escapeHtml(d.title)}</div><div class="phone-detail-date">${escapeHtml(d.date||'')}</div><div class="phone-detail-body">${escapeHtml(d.content||'')}</div>`;document.getElementById('phoneDetailPage').classList.add('active');document.getElementById('phoneFullscreenApp').classList.remove('active');});});
    }

    async function renderPhoneForum() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='论坛';
        content.innerHTML=(data?.forumPosts||[]).map((p,i)=>`<div class="phone-list-item" data-fidx="${i}"><div class="phone-list-item-info"><div class="phone-list-item-title">${escapeHtml(p.title)}</div><div class="phone-list-item-sub">${escapeHtml((p.content||'').substring(0,30))}...</div></div><div class="phone-list-item-date">${escapeHtml(p.date||'')}</div></div>`).join('')||'<div style="text-align:center;color:#999;padding:40px;">暂无帖子</div>';
        content.querySelectorAll('[data-fidx]').forEach(el=>{el.addEventListener('click',()=>{const p=data.forumPosts[parseInt(el.dataset.fidx)];if(!p)return;document.getElementById('phoneDetailTitle').textContent=p.title;document.getElementById('phoneDetailContent').innerHTML=`<div class="phone-detail-title">${escapeHtml(p.title)}</div><div class="phone-detail-date">${escapeHtml(p.date||'')}</div><div class="phone-detail-body">${escapeHtml(p.content||'')}</div><div class="phone-section-title">评论 (${(p.comments||[]).length})</div>`+(p.comments||[]).map(c=>`<div class="phone-detail-comment"><div class="phone-detail-comment-name">${escapeHtml(c.name)}</div><div class="phone-detail-comment-text">${escapeHtml(c.text)}</div></div>`).join('');document.getElementById('phoneDetailPage').classList.add('active');document.getElementById('phoneFullscreenApp').classList.remove('active');});});
    }

    async function renderPhoneShop() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='购物';
        let html='<div class="phone-shop-tabs"><div class="phone-shop-tab active" data-st="cart">购物车</div><div class="phone-shop-tab" data-st="asset">资产</div></div>';
        html+='<div class="phone-shop-panel active" id="phoneCartPanel">'+((data?.shopCart||[]).map(i=>`<div class="phone-cart-item"><div class="phone-cart-img">${i.icon||'📦'}</div><div class="phone-cart-info"><div class="phone-cart-name">${escapeHtml(i.name)}</div><div class="phone-cart-desc">${escapeHtml(i.desc||'')}</div><div class="phone-cart-price">${escapeHtml(i.price)}</div></div></div>`).join('')||'<div style="text-align:center;color:#999;padding:20px;">购物车为空</div>')+'</div>';
        html+='<div class="phone-shop-panel" id="phoneAssetPanel"><div class="phone-asset-total">总资产 <span>'+escapeHtml(data?.shopTotalAssets||'¥0.00')+'</span></div>'+((data?.shopAssets||[]).length?'<div style="font-size:15px;color:#666;margin:16px 0 8px;">最近收支</div>'+(data.shopAssets||[]).map(a=>`<div class="phone-asset-item"><div class="phone-asset-desc">${escapeHtml(a.desc)}</div><div class="phone-asset-amount ${a.type}">${escapeHtml(a.amount)}</div></div>`).join(''):'')+'</div>';
        content.innerHTML=html;
        content.querySelectorAll('.phone-shop-tab').forEach(t=>{t.addEventListener('click',()=>{const tab=t.dataset.st;content.querySelectorAll('.phone-shop-tab').forEach((el,i)=>el.classList.toggle('active',(tab==='cart'&&i===0)||(tab==='asset'&&i===1)));content.querySelector('#phoneCartPanel').classList.toggle('active',tab==='cart');content.querySelector('#phoneAssetPanel').classList.toggle('active',tab==='asset');});});
    }

    function parseMinutes(t){if(!t)return 0;let n=0;const h=t.match(/(\d+)\s*h/),m=t.match(/(\d+)\s*min/);if(h)n+=parseInt(h[1])*60;if(m)n+=parseInt(m[1]);return n;}
    function formatTotalTime(m){const h=Math.floor(m/60),min=m%60;return h>0&&min>0?`${h}h ${min}min`:h>0?`${h}h`:`${min}min`;}

    async function renderPhoneStats() {
        const data=await getPhoneData(currentPhoneCharId);
        const content=document.getElementById('phoneAppContent'); if(!content)return;
        document.getElementById('phoneAppTitle').textContent='屏幕使用统计';
        const s=data?.statsData; if(!s){content.innerHTML='<div style="text-align:center;color:#999;padding:40px;">暂无统计数据</div>';return;}
        const apps=(s.apps||[]).map(a=>({...a,minutes:parseMinutes(a.time)}));
        const maxM=Math.max(...apps.map(a=>a.minutes),1);
        const total=apps.reduce((sum,a)=>sum+a.minutes,0);
        let html=`<div class="phone-stats-summary"><div class="phone-stats-total">过去24小时 <span>${escapeHtml(formatTotalTime(total))}</span></div>`;
        html+='<div class="phone-stats-bar-chart">'+apps.map(a=>`<div class="phone-stats-bar-item"><div class="phone-stats-bar" style="height:${Math.max(4,(a.minutes/maxM)*80)}px;background:${a.color||'#72c9bf'};"></div><div class="phone-stats-bar-label">${escapeHtml(a.name)}</div></div>`).join('')+'</div>';
        html+=apps.map(a=>`<div class="phone-stats-list-item"><div class="phone-stats-icon" style="background:${a.iconBg||'#e0f7f6'};">${a.icon||'📱'}</div><div class="phone-stats-info"><div class="phone-stats-name">${escapeHtml(a.name)}</div></div><div class="phone-stats-time">${escapeHtml(a.time)}</div></div>`).join('');
        html+='</div>'; content.innerHTML=html;
    }

    // ==================== 清除 ====================
    async function clearPhoneAppData(appType) {
        if(!currentPhoneCharId)return;
        const names={message:'讯息',browser:'浏览器',memo:'备忘录',diary:'日记',forum:'论坛',shop:'购物',stats:'统计'};
        if(!confirm(`确定清除"${names[appType]||'此应用'}"的全部数据？`))return;
        const data=await getPhoneData(currentPhoneCharId); if(!data)return;
        switch(appType){case'message':data.messages=[{contactName:'',messages:[],time:'',isPinned:true}];break;case'browser':data.browserHistory=[];data.browserPosts={};break;case'memo':data.memoItems=[];data.todos=[];break;case'diary':data.diaryEntries=[];break;case'forum':data.forumPosts=[];break;case'shop':data.shopCart=[];data.shopAssets=[];data.shopTotalAssets='¥0.00';break;case'stats':data.statsData=null;break;}
        await savePhoneData(data); await renderPhoneDesktop();
        const map={message:renderPhoneMessages,browser:renderPhoneBrowser,memo:renderPhoneMemo,diary:renderPhoneDiary,forum:renderPhoneForum,shop:renderPhoneShop,stats:renderPhoneStats};
        if(map[appType])map[appType]();
        showLongPressHint('✅ 已清除');
    }
    async function clearSingleDiary(idx){if(!confirm('确定删除这篇日记？'))return;const data=await getPhoneData(currentPhoneCharId);if(data?.diaryEntries){data.diaryEntries.splice(idx,1);await savePhoneData(data);}closePhoneDetail();await renderPhoneDiary();await renderPhoneDesktop();}
    async function clearBrowserSearchCache(){const t=document.getElementById('phoneDetailTitle')?.textContent;if(!t)return;const data=await getPhoneData(currentPhoneCharId);if(data?.browserPosts){delete data.browserPosts[t];await savePhoneData(data);}closePhoneDetail();}


    console.log('📱 查手机模块脚本就绪');

    // ===== 新增：自动初始化（回退方案） =====
    if (window.DB && window.callLLM && !window._phoneCheckInited) {
        window._phoneCheckInited = true;
        setTimeout(() => {
            if (typeof window.initPhoneCheckModule === 'function') {
                window.initPhoneCheckModule({
                    DB: window.DB,
                    showStatus: window.showStatus,
                    escapeHtml: window.escapeHtml,
                    getAvatarColor: window.getAvatarColor,
                    callLLM: window.callLLM,
                    recordApiPending: window.recordApiPending
                });
            }
        }, 500);
    }

    // ==================== [NEW] 全局通知管理模块（重构高精版） ====================
    const SVG_MSG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>`;
    const SVG_GROUP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a3 3 0 0 1 0 5.75"></path></svg>`;

    const notificationQueue = [];
    let isProcessingQueue = false;

    function queueNotification(notification) {
        notificationQueue.push(notification);
        processQueue();
    }

    function processQueue() {
        if (isProcessingQueue || notificationQueue.length === 0) return;
        isProcessingQueue = true;

        const next = notificationQueue.shift();
        displayNotificationCard(next);

        setTimeout(() => {
            isProcessingQueue = false;
            processQueue();
        }, 1000);
    }

    function formatNotificationBody(content, type) {
        if (!content) return '';
        let text = String(content);

        if (type === 'emoticon') {
            if (text.startsWith('{')) {
                try {
                    const p = JSON.parse(text);
                    return `[表情] ${p.text || ''}`;
                } catch (e) {}
            }
            return `[表情]`;
        }
        if (type === 'image') return `[图片] ${text}`;
        if (type === 'voice') return `[语音] ${text}`;
        if (type === 'html_card') return `[卡片] 网页卡片`;
        if (type === 'transfer') {
            if (text.includes('gg-transfer-card')) {
                const match = text.match(/¥([\d.]+)/);
                return `[微信转账] ¥${match ? match[1] : '金额'}`;
            }
            return `[转账]`;
        }
        if (type === 'redpacket') {
            if (text.includes('gg-redpacket-card')) {
                const msgMatch = text.match(/<div class="gg-redpacket-msg">([^<]+)<\/div>/);
                return `[微信红包] ${msgMatch ? msgMatch[1] : '恭喜发财'}`;
            }
            return `[红包]`;
        }
        if (type === 'offline_invite') return `[线下邀约] ${text}`;

        return text;
    }

    function displayNotificationCard(notif) {
        const phoneMock = document.querySelector('.phone-mock');
        if (!phoneMock) return;

        let container = phoneMock.querySelector('.h-notification-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'h-notification-container';
            phoneMock.appendChild(container);
        }

        const card = document.createElement('div');
        card.className = 'h-notification-card';

        const appIcon = notif.type === 'group' ? SVG_GROUP : SVG_MSG;
        const appLabel = notif.type === 'group' ? '群聊' : '讯息';

        const avatarChar = (notif.fallbackCharName || '?').charAt(0);
        const avatarColor = window.getAvatarColor ? window.getAvatarColor(notif.fallbackCharName) : '#72c9bf';
        const avatarStyle = notif.avatar ? `background-image: url('${notif.avatar}'); background-color: transparent;` : `background-color: ${avatarColor};`;

        card.innerHTML = `
            <div class="h-notification-avatar" style="${avatarStyle}">
                ${notif.avatar ? '' : avatarChar}
            </div>
            <div class="h-notification-content">
                <div class="h-notification-header">
                    <div class="h-notification-title">${window.escapeHtml ? window.escapeHtml(notif.title) : notif.title}</div>
                    <div class="h-notification-app-info">
                        <span class="h-notification-app-icon">${appIcon}</span>
                        <span>${appLabel}</span>
                    </div>
                </div>
                <div class="h-notification-body">${window.escapeHtml ? window.escapeHtml(notif.body) : notif.body}</div>
            </div>
        `;

        container.appendChild(card);

        requestAnimationFrame(() => {
            card.classList.add('show');
        });

        // 自动隐藏定时器
        const autoDismissTimeout = setTimeout(() => {
            dismissCard(card);
        }, 5000);

        function dismissCard(c) {
            clearTimeout(autoDismissTimeout);
            if (c.parentNode) {
                c.classList.add('slide-out');
                setTimeout(() => {
                    c.remove();
                    if (container.children.length === 0) {
                        container.remove();
                    }
                }, 300);
            }
        }

        // 高精滑动手势与点击拦截绑定
        bindSwipeDismiss(card, notif, () => {
            card.remove();
            if (container.children.length === 0) {
                container.remove();
            }
        }, dismissCard);
    }

    function bindSwipeDismiss(card, notif, onRemove, dismissCard) {
        let startX = 0;
        let currentX = 0;
        let startTime = 0;
        let isDragging = false;
        let hasMovedSignificantly = false;

        const onStart = (clientX) => {
            startX = clientX;
            currentX = 0;
            startTime = Date.now();
            isDragging = true;
            hasMovedSignificantly = false;
            card.style.transition = 'none';
        };

        const onMove = (clientX) => {
            if (!isDragging) return;
            currentX = clientX - startX;
            if (Math.abs(currentX) > 10) {
                hasMovedSignificantly = true;
            }
            card.style.transform = `translateX(${currentX}px)`;
            const opacity = Math.max(0, 1 - Math.abs(currentX) / 250);
            card.style.opacity = opacity;
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            card.style.transition = '';

            const diffX = currentX;
            const duration = Date.now() - startTime;

            if (Math.abs(diffX) > 100 || (Math.abs(diffX) > 30 && duration < 250)) {
                // 确实是左右滑走
                const direction = diffX > 0 ? 'right' : 'left';
                card.classList.add(direction === 'right' ? 'slide-out' : 'slide-out-left');
                setTimeout(onRemove, 300);
            } else {
                // 如果在极短时间内释放，且位移没有超过10px，判定为极其准确的 Tap 点击
                if (!hasMovedSignificantly && duration < 350) {
                    triggerTapNavigation();
                } else {
                    // 仅小位移抖动，弹性拉回
                    card.style.transform = '';
                    card.style.opacity = '';
                }
            }
            currentX = 0;
        };

        // 执行全局跳转核心导航
        function triggerTapNavigation() {
            const targetId = Number(notif.id);
            if (notif.type === 'group') {
                if (typeof window.openGroupConversation === 'function') {
                    window.openGroupConversation(targetId);
                }
            } else {
                if (typeof window.openConversation === 'function') {
                    window.openConversation(targetId);
                }
            }
            // 跳转后卡片淡出
            dismissCard(card);
        }

        // 触屏端
        card.addEventListener('touchstart', (e) => {
            onStart(e.touches[0].clientX);
        }, { passive: true });

        card.addEventListener('touchmove', (e) => {
            onMove(e.touches[0].clientX);
        }, { passive: true });

        card.addEventListener('touchend', (e) => {
            onEnd();
        });

        // 鼠标端
        let isMouseDown = false;
        card.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            onStart(e.clientX);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isMouseDown) return;
            onMove(e.clientX);
        });

        document.addEventListener('mouseup', (e) => {
            if (!isMouseDown) return;
            isMouseDown = false;
            onEnd();
        });

        // 兜底原生 click 事件（防止部分环境下手势穿透）
        card.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
    }

    async function triggerSingleChatNotification(obj) {
        try {
            const conv = await window.DB.get('conversations', obj.conversationId);
            if (!conv) return;
            const char = await window.DB.get('characters', conv.charId);
            const detail = await window.DB.get('convDetails', obj.conversationId);

            const name = detail?.charName || char?.name || '联系人';
            const avatar = detail?.charAvatar || char?.avatar || '';

            let contentText = formatNotificationBody(obj.content, obj.messageType);

            queueNotification({
                title: name,
                body: contentText,
                avatar: avatar,
                type: 'single',
                id: obj.conversationId,
                fallbackCharName: name
            });
        } catch (e) {
            console.error('Failed to trigger single chat notification:', e);
        }
    }

    async function triggerGroupChatNotification(obj) {
        try {
            const group = await window.DB.get('groupChats', obj.groupId);
            if (!group) return;

            let senderName = obj.senderName || '群成员';
            let avatar = '';

            for (const mid of group.memberIds) {
                const ch = await window.DB.get('characters', mid);
                if (ch && ch.name === senderName) {
                    const md = group.members?.find(m => String(m.id) === String(mid));
                    avatar = md?.avatar || ch.avatar || '';
                    break;
                }
            }
            if (!avatar) {
                const npcs = await window.DB.queryByIndex('groupNPCs', 'groupId', obj.groupId);
                const npc = npcs.find(n => n.name === senderName);
                if (npc) {
                    avatar = npc.avatar || '';
                }
            }

            let contentText = formatNotificationBody(obj.content, obj.messageType);

            queueNotification({
                title: group.name || '新群聊消息',
                body: `${senderName}: ${contentText}`,
                avatar: avatar,
                type: 'group',
                id: obj.groupId,
                fallbackCharName: senderName
            });
        } catch (e) {
            console.error('Failed to trigger group chat notification:', e);
        }
    }

    function setupDatabaseNotificationHook() {
        if (!window.DB) {
            setTimeout(setupDatabaseNotificationHook, 200);
            return;
        }

        const originalPut = window.DB.put;
        window.DB.put = async function(store, obj) {
            const result = await originalPut.apply(this, arguments);

            if (store === 'chats') {
                if (obj && obj.role === 'assistant' && obj.messageType !== 'innerVoice') {
                    const now = Date.now();
                    const msgTime = obj.timestamp || now;
                    if (Math.abs(now - msgTime) < 15000) {
                        const isActive = document.getElementById('page-conversation')?.classList.contains('active');
                        const isSameConv = window.currentConversationId === obj.conversationId;
                        if (!isActive || !isSameConv) {
                            triggerSingleChatNotification(obj);
                        }
                    }
                }
            }

            if (store === 'groupMessages') {
                if (obj && (obj.role === 'assistant' || obj.senderId === 'char') && obj.messageType !== 'system') {
                    const now = Date.now();
                    const msgTime = obj.timestamp || now;
                    if (Math.abs(now - msgTime) < 15000) {
                        const isActive = document.getElementById('page-group-conversation')?.classList.contains('active');
                        const isSameGroup = window.currentGroupId === obj.groupId;
                        if (!isActive || !isSameGroup) {
                            triggerGroupChatNotification(obj);
                        }
                    }
                }
            }

            return result;
        };
    }

    setupDatabaseNotificationHook();

})();