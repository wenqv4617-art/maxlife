// ==================== 论坛数据 (IndexedDB) ====================
async function getForumData() {
    const record = await window.DB.get('forum', 'main');
    if (record && record.value) return record.value;
    return {
        following: [],
        likedPosts: [],
        settings: {
            name: '星海社区',
            style: '这是一个温馨友好的社区，用户们喜欢分享日常生活、科技趣闻和创意想法。大家互相尊重，氛围轻松。'
        },
        mountedWorldbooks: [],
        accounts: [],
        currentAccountId: null,
        posts: [],
        trends: [],
        notifications: [],
        messages: [],
        comments: {}
    };
}

async function saveForumData(data) {
    await window.DB.put('forum', { key: 'main', value: data });
}

function getCurrentAccount() {
    if (!window._forumDataCache) return null;
    const data = window._forumDataCache;
    if (!data.currentAccountId) return null;
    return data.accounts.find(a => a.id === data.currentAccountId) || null;
}

async function ensureDefaultAccount() {
    const data = await getForumData();
    if (data.accounts.length === 0) {
        const defaultAccount = {
            id: 'acct_' + Date.now(),
            name: '论坛用户',
            handle: 'user_' + Math.random().toString(36).slice(2, 8),
            bio: '这个人很懒，什么都没写',
            persona: '一个普通用户，友善、偶尔幽默，喜欢参与讨论。',
            avatar: ''
        };
        data.accounts.push(defaultAccount);
        data.currentAccountId = defaultAccount.id;
        await saveForumData(data);
    }
    window._forumDataCache = data;
}

// ==================== 论坛子视图切换 ====================
const forumViews = [
    'forumMainView', 'forumTrendView', 'forumNotifView', 'forumMsgView',
    'forumDetailView', 'forumProfileView', 'forumAccountsView', 'forumSettingsView',
    'forumMsgConversationView', 'forumTrendSearchView'
];

window._forumHistoryStack = [];

function pushForumHistory(pageType, pageData = {}) {
    // 如果栈顶和当前相同则不重复压入
    if (window._forumHistoryStack.length > 0) {
        const top = window._forumHistoryStack[window._forumHistoryStack.length - 1];
        if (top.type === pageType && JSON.stringify(top.data) === JSON.stringify(pageData)) return;
    }
    window._forumHistoryStack.push({ type: pageType, data: pageData });
}

function popForumHistory() {
    if (window._forumHistoryStack.length > 0) {
        return window._forumHistoryStack.pop();
    }
    return null;
}

async function restoreForumHistory(entry) {
    if (!entry) {
        // 空栈，返回首页
        switchForumView('forumMainView');
        updateBottomNavActive('main');
        await renderPostList();
        return;
    }
    
    switch (entry.type) {
        case 'main':
            switchForumView('forumMainView');
            updateBottomNavActive('main');
            await renderPostList();
            break;
        case 'trend':
            switchForumView('forumTrendView');
            updateBottomNavActive('trend');
            await renderTrendList();
            break;
        case 'notif':
            switchForumView('forumNotifView');
            updateBottomNavActive('notif');
            await renderNotifList();
            break;
        case 'msg':
            switchForumView('forumMsgView');
            updateBottomNavActive('msg');
            await renderMsgList(window._currentMsgTab === 'friends');
            break;
        case 'post':
            switchForumView('forumDetailView');
            if (entry.data?.postId) {
                await openPostDetailDirect(entry.data.postId);
            }
            break;
        case 'profile_self':
            await openProfileDirect();
            break;
        case 'profile_self_likes':
            await openProfileDirect();
            await switchProfileTab('likes');
            break;
        case 'profile_other':
            if (entry.data?.authorHandle) {
                await openAuthorProfileDirect(entry.data.authorHandle, entry.data.authorName || '', entry.data.authorBio || '', entry.data.postCount || 0);
            }
            break;
        case 'conv':
            if (entry.data?.fromName) {
                await openConversationDirect(entry.data.fromName, entry.data.authorHandle || '');
            }
            break;
        case 'settings':
            await openForumSettings();
            break;
        case 'accounts':
            await openAccountsList();
            break;
        default:
            switchForumView('forumMainView');
            updateBottomNavActive('main');
            await renderPostList();
    }
}

function getCurrentViewType() {
    if (document.getElementById('forumMainView').style.display !== 'none') {
        return { type: 'main' };
    }
    if (document.getElementById('forumProfileView').style.display !== 'none') {
        if (window._profileTab === 'likes') {
            return { type: 'profile_self_likes' };
        }
        return { type: 'profile_self' };
    }
    if (document.getElementById('forumMsgView').style.display !== 'none') {
        return { type: 'msg' };
    }
    if (document.getElementById('forumNotifView').style.display !== 'none') {
        return { type: 'notif' };
    }
    if (document.getElementById('forumTrendView').style.display !== 'none') {
        return { type: 'trend' };
    }
    if (document.getElementById('forumMsgConversationView').style.display !== 'none') {
        return { type: 'conv', data: { fromName: window._currentConversationFrom || '' } };
    }
    // 在帖子详情页或作者主页时返回null（不需要压栈，因为这些都是由上层压入的）
    return null;
}

function switchForumView(viewId) {
    forumViews.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(viewId);
    if (target) target.style.display = 'block';

    const bottomNav = document.getElementById('forumBottomNav');
    const fab = document.getElementById('forumFabBtn');
    const isSubView = ['forumDetailView', 'forumProfileView', 'forumAccountsView',
        'forumSettingsView', 'forumMsgConversationView', 'forumTrendSearchView'].includes(viewId);
    if (bottomNav) bottomNav.style.display = isSubView ? 'none' : 'flex';

    if (fab && viewId === 'forumProfileView') {
        fab.style.display = 'block';
    } else if (fab && isSubView) {
        fab.style.display = 'none';
    } else if (fab) {
        fab.style.display = 'block';
    }

    if (viewId === 'forumMsgConversationView') {
        const notifCard = document.querySelector('.msg-notification-card');
        if (notifCard) notifCard.remove();
    }
}

function updateBottomNavActive(view) {
    document.querySelectorAll('.forum-bottom-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
}

// ==================== 论坛：渲染帖子列表 ====================
async function renderPostList(filter = 'recommend') {
    const data = await getForumData();
    window._forumDataCache = data;
    const listEl = document.getElementById('forumPostList');
    let posts = data.posts || [];

    if (filter === 'following') {
        const following = data.following || [];
        const followingHandles = following.map(f => f.handle);
        posts = posts.filter(p => followingHandles.includes(p.handle));
    }

    if (posts.length === 0) {
        listEl.innerHTML = `
            <div class="forum-empty">
                <div class="forum-empty-icon">📝</div>
                <div class="forum-empty-title">暂无帖子</div>
                <div class="forum-empty-desc">点击右下角 + 按钮发布第一条帖子<br>或长按顶部 ℳ 图标生成内容</div>
            </div>`;
        return;
    }

    listEl.innerHTML = posts.map((post) => {
        const hasTitle = post.title && post.title.trim();
        const hasImage = post.imageData && post.imageData.trim();
        const hasImageDesc = post.imageDesc && post.imageDesc.trim();
        let imageHtml = '';
        if (hasImage) {
            imageHtml = `<div class="tweet-image-placeholder" style="background-image:url('${post.imageData}');"></div>`;
        } else if (hasImageDesc) {
            imageHtml = `<div class="tweet-image-placeholder text-image">🖼️ ${window.escapeHtml(post.imageDesc)}</div>`;
        }

        return `
        <div class="tweet-card" data-post-id="${post.id}">
            <div class="tweet-header-row">
                <div class="tweet-avatar" style="background-image:url('${post.avatar || ''}');">${post.avatar ? '' : (post.name || '?').charAt(0)}</div>
                <div class="tweet-body">
                    <div class="tweet-author-row">
                        <span class="tweet-name">${window.escapeHtml(post.name || '匿名')}</span>
                        <span class="tweet-verified">✓</span>
                        <span class="tweet-handle">@${window.escapeHtml(post.handle || 'unknown')}</span>
                        <span class="tweet-time">· ${window.escapeHtml(post.time || '')}</span>
                    </div>
                    ${hasTitle ? `<div class="tweet-title">${window.escapeHtml(post.title)}</div>` : ''}
                    <div class="tweet-content">${window.escapeHtml(post.content || '')}</div>
                    ${imageHtml}
                </div>
            </div>
            <div class="tweet-stats-row">
                <span class="tweet-stat">⋫ ${post.comments || 0}</span>
                <span class="tweet-stat">⇄ ${post.retweets || 0}</span>
                <span class="tweet-stat">♡ ${post.likes || 0}</span>
                <span class="tweet-stat">⊙ ${post.views || 0}</span>
                <span class="tweet-stat bookmark-btn" data-post-id="${post.id}" title="点击生成互动">✧</span>
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.tweet-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.tweet-stat')) return;
            openPostDetail(card.dataset.postId);
        });
    });

    listEl.querySelectorAll('.bookmark-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const postId = btn.dataset.postId;
            if (!postId || btn.classList.contains('generating')) return;
            btn.classList.add('generating');
            btn.textContent = '⏳';
            await generatePostInteraction(postId);
            btn.classList.remove('generating');
            btn.textContent = '⭐';
            await renderPostList();
            window.showStatus('✅ 已生成新互动', 'success');
        });
    });
}

async function renderTrendList() {
    const data = await getForumData();
    window._forumDataCache = data;
    const listEl = document.getElementById('forumTrendList');
    const trends = data.trends || [];

    if (trends.length === 0) {
        listEl.innerHTML = `
            <div class="forum-empty">
                <div class="forum-empty-icon">🔍</div>
                <div class="forum-empty-title">暂无趋势</div>
                <div class="forum-empty-desc">长按顶部 ℳ 图标生成趋势内容</div>
            </div>`;
        return;
    }

    listEl.innerHTML = trends.map(t => `
        <div class="trend-item" data-trend-name="${window.escapeHtml(t.name || '')}" data-trend-category="${window.escapeHtml(t.category || '')}">
            <div class="trend-category">${window.escapeHtml(t.category || '热门趋势')}</div>
            <div class="trend-name">${window.escapeHtml(t.name || '')}</div>
            <div class="trend-count">${window.escapeHtml(t.count || '')} 条帖子</div>
        </div>
    `).join('');

    listEl.querySelectorAll('.trend-item').forEach(item => {
        item.addEventListener('click', () => {
            openTrendSearch(item.dataset.trendName, item.dataset.trendCategory);
        });
    });
}

async function openTrendSearch(trendName, trendCategory) {
    document.getElementById('trendSearchKeyword').textContent = trendName;
    document.getElementById('trendSearchTitle').textContent = '趋势搜索';
    document.getElementById('trendSearchSubtitle').textContent = trendCategory || '热门趋势';

    document.getElementById('forumTrendView').style.display = 'none';
    document.getElementById('forumTrendSearchView').style.display = 'block';
    document.getElementById('forumBottomNav').style.display = 'none';
    document.getElementById('forumFabBtn').style.display = 'none';

    const listEl = document.getElementById('trendSearchPostList');
    listEl.innerHTML = '<div class="loading-dots">🤖 正在搜索相关帖子...</div>';

    const context = await buildForumContext(false);
    try {
        const account = getCurrentAccount();
        const prompt = `${context}\n\n请生成5-7条与"${trendName}"相关的论坛帖子。以JSON数组格式返回。\n每条帖子字段：\n- title: 标题(必填，5-15字，与"${trendName}"相关)\n- name: 作者名\n- handle: @账号(不含@)\n- time: 发帖时间(最近24小时内)\n- content: 帖子正文(20-80字)\n- imageDesc: 图片文字描述(可选)\n\n【重要回避规则】\n禁止使用以下用户信息发帖：\n- 禁止使用name="${account?.name || ''}"\n- 禁止使用handle="${account?.handle || ''}"\n\n内容要符合论坛氛围。`;
        
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 1.0, maxTokens: 2500 });
        const posts = parseJSONFromReply(reply);

        if (posts && posts.length > 0) {
            const searchPosts = posts.map(p => ({
                ...p,
                id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: p.name || '匿名',
                handle: p.handle || 'user',
                title: p.title || '',
                avatar: '',
                time: p.time || '刚刚',
                content: p.content || '',
                imageData: '',
                imageDesc: p.imageDesc || '',
                comments: Math.floor(Math.random() * 20),
                retweets: Math.floor(Math.random() * 10),
                likes: Math.floor(Math.random() * 80),
                views: Math.floor(Math.random() * 30000)
            }));

            const data = await getForumData();
            data.posts = [...searchPosts, ...(data.posts || [])];
            await saveForumData(data);
            window._forumDataCache = data;

            renderTrendSearchResults(searchPosts);
            window.showStatus('✅ 已生成 ' + searchPosts.length + ' 条相关帖子', 'success');
        } else {
            listEl.innerHTML = '<div class="forum-empty"><div class="forum-empty-title">暂无结果</div></div>';
        }
    } catch (e) {
        listEl.innerHTML = '<div class="forum-empty"><div class="forum-empty-title">搜索失败</div></div>';
        window.showStatus('❌ ' + e.message, 'error');
    }
}

function renderTrendSearchResults(posts) {
    const listEl = document.getElementById('trendSearchPostList');
    listEl.innerHTML = posts.map(post => {
        const hasTitle = post.title && post.title.trim();
        const hasImageDesc = post.imageDesc && post.imageDesc.trim();
        let imageHtml = '';
        if (hasImageDesc) {
            imageHtml = `<div class="tweet-image-placeholder text-image">🖼️ ${window.escapeHtml(post.imageDesc)}</div>`;
        }
        return `
        <div class="tweet-card" data-post-id="${post.id}">
            <div class="tweet-header-row">
                <div class="tweet-avatar" style="background-image:url('${post.avatar || ''}');">${post.avatar ? '' : (post.name || '?').charAt(0)}</div>
                <div class="tweet-body">
                    <div class="tweet-author-row">
                        <span class="tweet-name">${window.escapeHtml(post.name || '匿名')}</span>
                        <span class="tweet-verified">✓</span>
                        <span class="tweet-handle">@${window.escapeHtml(post.handle || 'unknown')}</span>
                        <span class="tweet-time">· ${window.escapeHtml(post.time || '')}</span>
                    </div>
                    ${hasTitle ? `<div class="tweet-title">${window.escapeHtml(post.title)}</div>` : ''}
                    <div class="tweet-content">${window.escapeHtml(post.content || '')}</div>
                    ${imageHtml}
                </div>
            </div>
            <div class="tweet-stats-row">
                <span class="tweet-stat">⋫ ${post.comments || 0}</span>
                <span class="tweet-stat">⇄ ${post.retweets || 0}</span>
                <span class="tweet-stat">♡ ${post.likes || 0}</span>
                <span class="tweet-stat">⊙ ${post.views || 0}</span>
                <span class="tweet-stat bookmark-btn" data-post-id="${post.id}" title="点击生成互动">✧</span>
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.tweet-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.tweet-stat')) return;
            openPostDetail(card.dataset.postId);
        });
    });
}

async function renderNotifList() {
    const data = await getForumData();
    window._forumDataCache = data;
    const listEl = document.getElementById('forumNotifList');
    const account = getCurrentAccount();
    const notifs = (data.notifications || []).filter(n => n.accountId === account?.id);

    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';

    if (notifs.length === 0) {
        listEl.innerHTML = `
            <div class="forum-empty">
                <div class="forum-empty-icon">🔔</div>
                <div class="forum-empty-title">暂无通知</div>
                <div class="forum-empty-desc">当你发帖或评论后，<br>AI会生成互动通知</div>
            </div>`;
        return;
    }

    listEl.innerHTML = notifs.map(n => {
        const hasPostId = n.postId && n.postId.trim();
        const clickableClass = hasPostId ? 'clickable-notif' : '';
        const style = hasPostId ? 'cursor:pointer;' : '';
        return `
        <div class="trend-item ${clickableClass}" data-post-id="${hasPostId ? n.postId : ''}" style="${style}">
            <div style="font-size:13px;color:#657786;margin-bottom:2px;">${window.escapeHtml(n.time || '')}</div>
            <div style="font-size:15px;">${window.escapeHtml(n.content || '')}</div>
            ${hasPostId ? '<div style="font-size:12px;color:#1d9bf0;margin-top:4px;">👉 点击查看</div>' : ''}
        </div>
    `}).join('');

    listEl.querySelectorAll('.clickable-notif').forEach(item => {
        item.addEventListener('click', () => {
            const postId = item.dataset.postId;
            if (postId) {
                switchForumView('forumMainView');
                updateBottomNavActive('main');
                openPostDetail(postId);
            }
        });
    });
}

async function renderMsgList(friendsOnly = false) {
    const data = await getForumData();
    window._forumDataCache = data;
    const listEl = document.getElementById('forumMsgList');
    const account = getCurrentAccount();
    const myAccId = account?.id || null;
    const myName = account?.name || '';

    // 只取属于当前账户的消息
    const msgs = (data.messages || []).filter(m => m.accountId === myAccId);

    const getOtherParty = (m) => {
        if (m.from === myName) {
            return { name: m.to || '匿名', handle: m.toHandle || '', avatar: '' };
        }
        return { name: m.from || '匿名', handle: m.fromHandle || '', avatar: m.avatar || '' };
    };

    const displayMsgs = msgs.filter(m => {
        if (m.isPlaceholder && (!m.content || m.content.trim() === '') && (!m.bubbles || m.bubbles.length === 0 || !m.bubbles[0].content)) {
            const other = getOtherParty(m);
            const hasRealMsg = msgs.some(o =>
                o !== m && getOtherParty(o).name === other.name &&
                (!o.isPlaceholder || (o.content && o.content.trim()) || (o.bubbles && o.bubbles.length > 0 && o.bubbles[0].content))
            );
            return hasRealMsg ? false : true;
        }
        return true;
    });

    const following = data.following || [];
    let filteredMsgs = displayMsgs;
    if (friendsOnly) {
        filteredMsgs = displayMsgs.filter(m => {
            const other = getOtherParty(m);
            return following.some(f => f.name === other.name || f.handle === other.handle);
        });
    } else {
        filteredMsgs = displayMsgs.filter(m => {
            const other = getOtherParty(m);
            return !following.some(f => f.name === other.name || f.handle === other.handle);
        });
    }

    if (filteredMsgs.length === 0) {
        listEl.innerHTML = `
            <div class="forum-empty">
                <div class="forum-empty-icon">✉️</div>
                <div class="forum-empty-title">暂无私信</div>
                <div class="forum-empty-desc">长按顶部 ℳ 图标生成私信内容</div>
            </div>`;
        return;
    }

    const conversations = {};
    filteredMsgs.forEach(m => {
        const other = getOtherParty(m);
        const key = other.name;
        if (!conversations[key]) {
            conversations[key] = {
                from: other.name,
                fromHandle: other.handle,
                avatar: other.avatar,
                lastMsg: m,
                allMsgs: []
            };
        }
        conversations[key].allMsgs.push(m);
        if (other.handle && !conversations[key].fromHandle) conversations[key].fromHandle = other.handle;
        if (other.avatar && !conversations[key].avatar) conversations[key].avatar = other.avatar;

        const getTs = (msg) => msg?.timestamp || 0;
        if (getTs(m) > getTs(conversations[key].lastMsg)) {
            conversations[key].lastMsg = m;
        }
    });

    const convArray = Object.values(conversations).sort((a, b) => {
        const getTs = (msg) => msg?.timestamp || 0;
        return getTs(b.lastMsg) - getTs(a.lastMsg);
    });

    listEl.innerHTML = convArray.map(c => {
        const fromName = c.from || '匿名';
        const fromHandle = c.fromHandle || '';
        const avatarLetter = fromName.charAt(0);
        const lastMsgFromMe = c.lastMsg.from === myName;
        const previewPrefix = lastMsgFromMe ? '我: ' : '';
        const previewContent = (c.lastMsg.content || '').substring(0, 50);
        const previewSuffix = (c.lastMsg.content || '').length > 50 ? '...' : '';
        return `
        <div class="msg-list-item" data-from="${window.escapeHtml(c.from)}">
            <div class="msg-list-avatar" style="background-image:url('${c.avatar || ''}');">${c.avatar ? '' : avatarLetter}</div>
            <div class="msg-list-info">
                <div class="msg-list-name">${window.escapeHtml(fromName)}</div>
                ${fromHandle ? `<div style="font-size:12px;color:#657786;">@${window.escapeHtml(fromHandle)}</div>` : ''}
                <div class="msg-list-preview">${window.escapeHtml(previewPrefix + previewContent)}${previewSuffix}</div>
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.msg-list-item').forEach(item => {
        item.addEventListener('click', () => {
            openConversation(item.dataset.from);
        });
    });
}

// ==================== 私信对话 ====================
async function openConversation(fromName, authorHandle = '') {
    // 压入当前页面
    const currentView = getCurrentViewType();
    if (currentView) {
        pushForumHistory(currentView.type, currentView.data);
    }
    
    await openConversationDirect(fromName, authorHandle);
}

async function openConversationDirect(fromName, authorHandle = '') {
    const notifCard = document.querySelector('.msg-notification-card');
    if (notifCard) notifCard.remove();

    const data = await getForumData();
    window._forumDataCache = data;
    const msgs = data.messages || [];
    const account = getCurrentAccount();

    const convMsgs = msgs.filter(m => {
    if (m.accountId !== account?.id) return false;
    if (m.isPlaceholder && (!m.content || m.content.trim() === '') && (!m.bubbles || m.bubbles.length === 0 || !m.bubbles[0].content)) return false;
    return (m.from === fromName && m.to === (account?.name || '')) ||
        (m.to === fromName && m.from === (account?.name || '')) ||
        (m.from === fromName && !m.to) ||
        (m.to === fromName && !m.from);
});

    let displayName = fromName;
    let displayHandle = authorHandle || '';
    let displayAvatar = '';
    let displayBio = '';

    for (const m of convMsgs) {
        if (m.from === fromName) {
            if (!displayHandle) displayHandle = m.fromHandle || '';
            displayAvatar = m.avatar || '';
            displayBio = m.fromBio || '';
            break;
        }
    }

    if (!displayHandle) {
        const authorPosts = (data.posts || []).filter(p => p.name === fromName || p.handle === fromName);
        if (authorPosts.length > 0) displayHandle = authorPosts[0].handle || '';
    }

    document.getElementById('msgConvTitle').textContent = fromName;
    const contentEl = document.getElementById('forumMsgConversationContent');
    const avatarLetter = displayName.charAt(0);

    let convHTML = `
        <div class="msg-conv-header">
            <div class="conv-header-avatar"
                 data-author-name="${window.escapeHtml(displayName)}"
                 data-author-handle="${window.escapeHtml(displayHandle || fromName)}"
                 style="background-image:url('${displayAvatar}');">
                 ${displayAvatar ? '' : avatarLetter}
            </div>
            <div class="conv-header-name">${window.escapeHtml(displayName)}</div>
            ${displayHandle ? `<div class="conv-header-handle">@${window.escapeHtml(displayHandle)}</div>` : ''}
            ${displayBio ? `<div class="conv-header-bio">${window.escapeHtml(displayBio)}</div>` : ''}
        </div>`;

    if (convMsgs.length === 0) {
        convHTML += `<div style="text-align:center;padding:40px 16px;color:#a0a8a2;font-size:14px;">这是你和 @${window.escapeHtml(displayHandle || fromName)} 的第一次对话<br>发送消息开始聊天吧</div>`;
    }

    convHTML += convMsgs.map(m => {
        const isSent = m.from === (account?.name || '');
        const msgDisplayAvatar = isSent ? (account?.avatar || '') : (m.avatar || '');
        const msgAvatarLetter = isSent ? (account?.name || '我').charAt(0) : fromName.charAt(0);
        return parseMsgBubbles(m, isSent, msgDisplayAvatar, msgAvatarLetter);
    }).join('');

    contentEl.innerHTML = convHTML;

    setTimeout(() => {
        const headerAvatar = contentEl.querySelector('.conv-header-avatar');
        if (headerAvatar) {
            headerAvatar.addEventListener('click', async (e) => {
                e.stopPropagation();
                const authorHandle = headerAvatar.dataset.authorHandle;
                const authorName = headerAvatar.dataset.authorName;
                const currentAccount = getCurrentAccount();
                const isSelf = currentAccount && (authorHandle === currentAccount.handle || authorName === currentAccount.name);
                if (isSelf) { window.showStatus('这是你自己的主页', 'info'); return; }

                const d = await getForumData();
                const existingPosts = (d.posts || []).filter(p => p.handle === authorHandle || p.name === authorName);
                if (existingPosts.length > 0) {
                    openAuthorProfile(authorHandle || authorName, authorName || authorHandle, '', existingPosts.length);
                    return;
                }
                if (authorHandle || authorName) {
                    await generateAuthorProfile(authorHandle || authorName, authorName || authorHandle);
                }
            });
        }
    }, 100);

    setTimeout(() => { contentEl.scrollTop = contentEl.scrollHeight; }, 100);

    document.getElementById('forumMsgView').style.display = 'none';
    document.getElementById('forumMsgConversationView').style.display = 'flex';
    document.getElementById('forumBottomNav').style.display = 'none';
    document.getElementById('forumFabBtn').style.display = 'none';
    window._currentConversationFrom = fromName;
}

function updateToolbarUI() {
    const type = window._currentMsgType || 'text';
    const input = document.getElementById('msgConvInput');
    const toggleBtn = document.getElementById('msgToolbarToggleBtn');
    if (type === 'voice') {
        input.placeholder = '输入语音转文字内容...';
        toggleBtn.textContent = '🎤';
        toggleBtn.style.background = '#007aff';
        toggleBtn.style.color = '#fff';
    } else if (type === 'image') {
        input.placeholder = '输入图片描述文字...';
        toggleBtn.textContent = '🖼️';
        toggleBtn.style.background = '#007aff';
        toggleBtn.style.color = '#fff';
    } else {
        input.placeholder = '输入消息...';
        toggleBtn.textContent = '+';
        toggleBtn.style.background = '#e9e9eb';
        toggleBtn.style.color = '#333';
    }
}

function showBubbleDetail(title, content) {
    const existing = document.querySelector('.msg-bubble-detail-card');
    if (existing) existing.remove();
    
    const card = document.createElement('div');
    card.className = 'msg-bubble-detail-card';
    card.style.cssText = `
        position: fixed;
        background: white;
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 700;
        animation: menuFadeIn 0.15s ease;
        min-width: 200px;
        max-width: 300px;
        padding: 16px;
        text-align: center;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
    `;
    card.innerHTML = `
        <div style="font-size:36px;margin-bottom:8px;">${title.startsWith('🎤') ? '🎤' : '🖼️'}</div>
        <div style="font-weight:600;font-size:15px;margin-bottom:10px;">${title}</div>
        <div style="font-size:14px;line-height:1.5;color:#333;">${window.escapeHtml(content || '暂无详情')}</div>
        <button class="detail-close-btn" style="margin-top:12px;background:#007aff;color:white;border:none;padding:8px 24px;border-radius:20px;font-size:13px;cursor:pointer;">关闭</button>
    `;
    (document.getElementById('page-forum') || document.body).appendChild(card);
    
    const closeDetail = () => {
        if (card.parentNode) card.remove();
        document.removeEventListener('click', outsideClickHandler);
    };
    
    card.querySelector('.detail-close-btn').addEventListener('click', closeDetail);
    
    const outsideClickHandler = (e) => {
        if (!card.contains(e.target)) {
            closeDetail();
        }
    };
    setTimeout(() => document.addEventListener('click', outsideClickHandler), 100);
}

function parseMsgBubbles(m, isSent, displayAvatar, avatarLetter) {
    const rawContent = m.content || '';
    const bubbles = m.bubbles;
    if (bubbles && Array.isArray(bubbles) && bubbles.length > 0) {
        return bubbles.map((b, bi) => renderSingleBubble(b, isSent, displayAvatar, avatarLetter, bi === 0, m.id + '_' + bi)).join('');
    }
    return renderSingleBubble({ type: 'text', content: rawContent }, isSent, displayAvatar, avatarLetter, true, m.id + '_0');
}

function renderSingleBubble(bubble, isSent, displayAvatar, avatarLetter, showAvatar, bubbleId) {
    let bubbleHtml = '';
    if (bubble.type === 'text') {
        bubbleHtml = `<div class="msg-bubble">${window.escapeHtml(bubble.content || '')}</div>`;
    } else if (bubble.type === 'voice') {
        const duration = bubble.duration || '0:00';
        bubbleHtml = `<div class="msg-bubble voice-bubble" data-bubble-id="${bubbleId}" data-bubble-type="voice" data-bubble-content="${window.escapeHtml(bubble.content || bubble.transcript || '')}"><span class="voice-icon">🔊</span><span class="voice-duration">${window.escapeHtml(duration)}</span></div>`;
    } else if (bubble.type === 'image') {
        const caption = bubble.caption || bubble.content || '';
        bubbleHtml = `<div class="msg-bubble image-bubble" data-bubble-id="${bubbleId}" data-bubble-type="image" data-bubble-content="${window.escapeHtml(caption)}"><div class="image-square">${window.escapeHtml(caption)}</div></div>`;
    }
    return `
    <div class="msg-bubble-row ${isSent ? 'sent' : 'received'}">
        ${showAvatar ? `<div class="msg-bubble-avatar" style="background-image:url('${displayAvatar}');">${displayAvatar ? '' : avatarLetter}</div>` : '<div class="msg-bubble-avatar" style="visibility:hidden;"></div>'}
        <div>${bubbleHtml}</div>
    </div>`;
}

window._currentMsgType = 'text';

async function sendMessageLocal() {
    const fromName = window._currentConversationFrom;
    if (!fromName) return;
    const msgData = buildMessageData(fromName);
    if (!msgData) return;
    const data = await getForumData();
    if (!data.messages) data.messages = [];

    const account = getCurrentAccount();
    data.messages = data.messages.filter(m => {
        if (m.isPlaceholder && m.accountId === account?.id && m.from === fromName && m.to === (account?.name || '')) return false;
        if (m.isPlaceholder && m.accountId === account?.id && m.from === (account?.name || '') && m.to === fromName) return false;
        return true;
    });

    data.messages.push(msgData);
    await saveForumData(data);
    window._forumDataCache = data;
    clearInputAndRefresh(fromName);
}
async function sendMessageWithAI() {
    const fromName = window._currentConversationFrom;
    if (!fromName) return;
    const msgData = buildMessageData(fromName);
    if (!msgData) return;
    const data = await getForumData();
    const account = getCurrentAccount();
    if (!data.messages) data.messages = [];

    data.messages = data.messages.filter(m => {
        if (m.isPlaceholder && m.accountId === account?.id && m.from === fromName && m.to === (account?.name || '')) return false;
        if (m.isPlaceholder && m.accountId === account?.id && m.from === (account?.name || '') && m.to === fromName) return false;
        return true;
    });

    data.messages.push(msgData);
    await saveForumData(data);
    window._forumDataCache = data;
    clearInputAndRefresh(fromName);

    setTimeout(async () => {
        const context = await buildForumContext(true);
        const d = await getForumData();
        const allMsgs = (d.messages || []).filter(m =>
            m.accountId === account?.id && (
                (m.from === fromName && m.to === (account?.name || '')) ||
                (m.to === fromName && m.from === (account?.name || '')) ||
                (m.from === fromName && !m.to) ||
                (m.to === fromName && !m.from)
            )
        );
        const convHistory = allMsgs.slice(-15).map(m => {
            const sender = m.from === (account?.name || '') ? '我' : m.from;
            if (m.bubbles && m.bubbles.length > 0) {
                return `${sender}: [${m.bubbles.map(b => {
                    if (b.type === 'text') return b.content;
                    if (b.type === 'voice') return '🎤语音:' + (b.transcript || b.content);
                    if (b.type === 'image') return '🖼️图片:' + (b.caption || b.content);
                    return '';
                }).join(' | ')}]`;
            }
            return `${sender}: ${m.content || ''}`;
        }).join('\n');

        try {
            const formatGuide = `【气泡格式说明】\n你可以在一条消息中发送多个气泡。用JSON数组返回：\n[{"type":"text","content":"文字内容"},{"type":"voice","content":"语音转文字内容","transcript":"语音转文字内容","duration":"0:03"},{"type":"image","content":"图片描述文字","caption":"图片说明"}]\n规则：type可选text/voice/image，一条消息可包含多个气泡。`;
            const prompt = `${context}\n\n${formatGuide}\n\n【当前对话对象】\n对方名称：${fromName}\n我的名称：${account?.name || '用户'}\n我的账号：@${account?.handle || 'unknown'}\n我的人设：${account?.persona || '普通用户'}\n\n【私信对话完整上下文】\n${convHistory}\n\n现在请以"${fromName}"的身份回复。请直接返回JSON数组（不要包含markdown代码块标记）。`;
            if (window.recordApiPending) window.recordApiPending();
            const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 0.9, maxTokens: 600 });
            const bubbles = parseJSONFromReply(reply);
            if (bubbles && Array.isArray(bubbles) && bubbles.length > 0) {
                const updatedData = await getForumData();
                const replyMsg = {
                    id: 'msg_' + Date.now() + '_r',
                    accountId: account?.id || null,
                    timestamp: Date.now(),
                    from: fromName,
                    to: account?.name || '我',
                    content: bubbles.filter(b => b.type === 'text').map(b => b.content).join('\n') || bubbles[0]?.content || '',
                    time: '刚刚',
                    avatar: '',
                    bubbles: bubbles
                };
                if (!updatedData.messages) updatedData.messages = [];
                updatedData.messages.push(replyMsg);
                await saveForumData(updatedData);
                window._forumDataCache = updatedData;

                const preview = bubbles.filter(b => b.type === 'text').map(b => b.content).join(' ') || bubbles[0]?.content || '';
                addMessageNotification(fromName, preview);

                if (window._currentConversationFrom === fromName && document.getElementById('forumMsgConversationView').style.display === 'flex') {
                    await openConversationDirect(fromName);
                }
            }
        } catch (e) { /* 静默 */ }
    }, 1500);
}

function buildMessageData(fromName) {
    const account = getCurrentAccount();
    const accId = account?.id || null;
    const msgType = window._currentMsgType || 'text';
    const text = document.getElementById('msgConvInput').value.trim();
    if (!text) return null;

    const ts = Date.now();

    if (msgType === 'voice') {
        return { id: 'msg_' + ts, accountId: accId, from: account?.name || '我', to: fromName, content: '[语音] ' + text, time: '刚刚', timestamp: ts, avatar: account?.avatar || '', bubbles: [{ type: 'voice', content: text, transcript: text, duration: '0:05' }] };
    } else if (msgType === 'image') {
        return { id: 'msg_' + ts, accountId: accId, from: account?.name || '我', to: fromName, content: '[图片] ' + text, time: '刚刚', timestamp: ts, avatar: account?.avatar || '', bubbles: [{ type: 'image', content: text, caption: text }] };
    }
    return { id: 'msg_' + ts, accountId: accId, from: account?.name || '我', to: fromName, content: text, time: '刚刚', timestamp: ts, avatar: account?.avatar || '', bubbles: [{ type: 'text', content: text }] };
}
async function clearInputAndRefresh(fromName) {
    document.getElementById('msgConvInput').value = '';
    const ta = document.getElementById('msgConvInput');
    ta.style.height = 'auto';
    window._currentMsgType = 'text';
    updateToolbarUI();
    await openConversationDirect(fromName);
}

// ==================== 帖子详情 ====================
async function openPostDetail(postId) {
    // 压入当前页面（根据当前视图判断）
    const currentView = getCurrentViewType();
    if (currentView) {
        pushForumHistory(currentView.type, currentView.data);
    }
    await openPostDetailDirect(postId);
}

async function openPostDetailDirect(postId) {
    const data = await getForumData();
    window._forumDataCache = data;
    const post = (data.posts || []).find(p => p.id === postId);
    if (!post) return;

    const detailEl = document.getElementById('forumDetailContent');
    const comments = (data.comments || {})[postId] || [];
    console.log('📩 openPostDetailDirect 渲染评论:', postId, '顶层评论数:', comments.length, JSON.stringify(comments.map(c => ({handle: c.handle, text: (c.text||'').substring(0,30), replies: (c.replies||[]).length}))));
    const hasTitle = post.title && post.title.trim();
    let imageHtml = '';
    if (post.imageData) {
        imageHtml = `<div class="detail-image"><img src="${post.imageData}" alt="图片"></div>`;
    } else if (post.imageDesc) {
        imageHtml = `<div class="detail-image"><div class="detail-image-desc" style="background:linear-gradient(135deg,#e8f4fd,#d4e8f9);color:#1d6fa5;font-size:15px;font-weight:500;padding:30px 20px;border-radius:14px;text-align:center;border:2px dashed #b8d8f0;">🖼️ ${window.escapeHtml(post.imageDesc)}</div></div>`;
    }

    detailEl.innerHTML = `
        <div class="detail-tweet">
            <div class="detail-author-row">
                <div class="detail-avatar clickable-avatar" data-author-handle="${window.escapeHtml(post.handle || '')}" data-author-name="${window.escapeHtml(post.name || '')}" style="background-image:url('${post.avatar || ''}');cursor:pointer;">${post.avatar ? '' : (post.name || '?').charAt(0)}</div>
                <div class="detail-info">
                    <div class="detail-name">${window.escapeHtml(post.name || '匿名')} <span class="tweet-verified" style="display:inline-flex;">✓</span></div>
                    <div class="detail-handle">@${window.escapeHtml(post.handle || 'unknown')}</div>
                </div>
            </div>
            ${hasTitle ? `<div class="detail-title">${window.escapeHtml(post.title)}</div>` : ''}
            <div class="detail-content">${window.escapeHtml(post.content || '')}</div>
            ${imageHtml}
            <div class="detail-meta">${window.escapeHtml(post.time || '')} · ${post.views || 0} 查看</div>
            <div class="detail-stats-bar">
                <span><span class="detail-stat-num">${post.comments || 0}</span> 评论</span>
                <span><span class="detail-stat-num">${post.retweets || 0}</span> 转发</span>
                <span id="detailLikeBtn" style="cursor:pointer;color:${(window._likedPosts || []).includes(postId) ? '#e74c3c' : '#657786'};" data-post-id="${postId}"><span class="detail-stat-num">${post.likes || 0}</span> ${(window._likedPosts || []).includes(postId) ? '❤️' : '♡'} 喜欢</span>
                <span class="tweet-stat bookmark-btn" data-post-id="${post.id}" style="cursor:pointer;margin-left:auto;" title="点击生成互动">⭐ 生成互动</span>
            </div>
        </div>
        <div style="padding:12px 16px;font-weight:600;font-size:15px;">💬 评论 (${comments.length})</div>
        ${comments.map((c, ci) => `
        <div class="comment-item clickable-comment" data-comment-index="${ci}" data-comment-handle="${window.escapeHtml(c.handle || '')}" data-comment-name="${window.escapeHtml(c.name || '')}" style="cursor:pointer;">
            <div class="comment-avatar" style="background-image:url('${c.avatar || ''}');"></div>
            <div class="comment-body">
                <span class="comment-name">${window.escapeHtml(c.name || '匿名')}</span>
                <span class="comment-handle">@${window.escapeHtml(c.handle || '')}</span>
                <div class="comment-text">${window.escapeHtml(c.text || '')}</div>
                <div style="font-size:11px;color:#1d9bf0;margin-top:4px;">💬 回复</div>
        ${c.handle === (getCurrentAccount()?.handle || '') ? `<button class="gen-reply-btn" data-post-id="${postId}" data-comment-handle="${window.escapeHtml(c.handle || '')}" style="font-size:11px;background:none;border:1px solid #1d9bf0;color:#1d9bf0;border-radius:10px;padding:2px 8px;cursor:pointer;margin-top:4px;">⭐ 生成回复</button>` : ''}
            </div>
        </div>
        ${c.replies && c.replies.length > 0 ? c.replies.map((r, ri) => `
        <div class="comment-item" style="padding-left:48px;background:#fafafa;">
            <div class="comment-avatar" style="width:28px;height:28px;background-image:url('${r.avatar || ''}');"></div>
            <div class="comment-body">
                <span class="comment-name">${window.escapeHtml(r.name || '匿名')}</span>
                <span class="comment-handle">@${window.escapeHtml(r.handle || '')}</span>
                <div class="comment-text">${window.escapeHtml(r.text || '')}</div>
            </div>
        </div>`).join('') : ''}
        `).join('')}
    `;

    switchForumView('forumDetailView');
    const commentInputRow = document.getElementById('forumDetailCommentInput');
    if (commentInputRow) commentInputRow.style.display = 'flex';
    document.getElementById('detailCommentInput').value = '';
    document.getElementById('detailCommentInput').placeholder = '发布你的回复...';
    window._currentDetailPostId = postId;
    window._replyToHandle = '';

    setTimeout(() => {
        const avatarEl = document.querySelector('#forumDetailContent .clickable-avatar');
        if (avatarEl) {
            avatarEl.addEventListener('click', async (e) => {
                e.stopPropagation();
                const authorHandle = avatarEl.dataset.authorHandle;
                const authorName = avatarEl.dataset.authorName;
                const currentAccount = getCurrentAccount();
                const isSelf = currentAccount && (authorHandle === currentAccount.handle || authorName === currentAccount.name);
                if (isSelf) { window.showStatus('这是你自己的帖子', 'info'); return; }
                
                // 压入当前帖子页面
                pushForumHistory('post', { postId });
                
                const d = await getForumData();
                const existingPosts = (d.posts || []).filter(p => p.handle === authorHandle || p.name === authorName);
                if (existingPosts.length > 0) {
                    openAuthorProfileDirect(authorHandle || authorName, authorName || authorHandle, '', existingPosts.length);
                    return;
                }
                if (authorHandle || authorName) await generateAuthorProfileDeflect(authorHandle, authorName, postId);
            });
        }
    }, 100);

    setTimeout(() => {
        const bookmarkBtn = document.querySelector('#forumDetailContent .bookmark-btn');
        if (bookmarkBtn) {
            bookmarkBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (bookmarkBtn.classList.contains('generating')) return;
                bookmarkBtn.classList.add('generating');
                bookmarkBtn.textContent = '⏳ 生成中...';
                await generatePostInteraction(postId);
                bookmarkBtn.classList.remove('generating');
                bookmarkBtn.textContent = '⭐ 生成互动';
                await openPostDetailDirect(postId);
                window.showStatus('✅ 已生成新互动', 'success');
            });
        }

        // ========== 评论点击回复 ==========
        document.querySelectorAll('#forumDetailContent .clickable-comment').forEach(commentEl => {
            commentEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const commentHandle = commentEl.dataset.commentHandle;
                const commentName = commentEl.dataset.commentName;
                const commentInput = document.getElementById('detailCommentInput');
                commentInput.value = '';
                commentInput.placeholder = `回复 @${commentHandle || commentName}：`;
                commentInput.focus();
                // 设置回复目标
                window._replyToHandle = commentHandle;
            });
        });

        // ========== 点赞按钮 ==========
        const likeBtn = document.getElementById('detailLikeBtn');
        if (likeBtn) {
            likeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const pid = likeBtn.dataset.postId;
                const d = await getForumData();
                if (!d.likedPosts) d.likedPosts = [];
                const alreadyLiked = d.likedPosts.includes(pid);
                const post = d.posts.find(p => p.id === pid);
                if (alreadyLiked) {
                    d.likedPosts = d.likedPosts.filter(id => id !== pid);
                    if (post) post.likes = Math.max(0, (post.likes || 0) - 1);
                    window.showStatus('已取消喜欢', 'info');
                } else {
                    d.likedPosts.push(pid);
                    if (post) post.likes = (post.likes || 0) + 1;
                    window.showStatus('❤️ 已喜欢', 'success');
                }
                window._likedPosts = d.likedPosts;
                await saveForumData(d);
                window._forumDataCache = d;
                // 刷新详情页
                await openPostDetailDirect(pid);
            });
        }
                // ========== 生成回复按钮 ==========
        document.querySelectorAll('#forumDetailContent .gen-reply-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const pid = btn.dataset.postId;
                const handle = btn.dataset.commentHandle;
                btn.textContent = '⏳';
                btn.disabled = true;
                await generateCommentReplies(pid, handle);
                await openPostDetailDirect(pid);
            });
        });
    }, 100);
}

// ==================== 侧边栏 ====================
async function updateSidebarInfo() {
    const account = getCurrentAccount();
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarName = document.getElementById('sidebarName');
    const sidebarHandle = document.getElementById('sidebarHandle');
    const forumNavAvatar = document.getElementById('forumNavAvatar');
    if (account) {
        sidebarName.textContent = account.name;
        sidebarHandle.textContent = '@' + account.handle;
        if (account.avatar) {
            sidebarAvatar.style.backgroundImage = `url('${account.avatar}')`;
            forumNavAvatar.style.backgroundImage = `url('${account.avatar}')`;
            sidebarAvatar.textContent = '';
            forumNavAvatar.textContent = '';
        } else {
            sidebarAvatar.style.backgroundImage = '';
            forumNavAvatar.style.backgroundImage = '';
            sidebarAvatar.textContent = account.name.charAt(0);
            forumNavAvatar.textContent = account.name.charAt(0);
        }
    }
}

function openSidebar() {
    document.getElementById('forumSidebar').classList.add('open');
    document.getElementById('forumSidebarOverlay').classList.add('open');
    updateSidebarInfo();
}

function closeSidebar() {
    document.getElementById('forumSidebar').classList.remove('open');
    document.getElementById('forumSidebarOverlay').classList.remove('open');
}

// ==================== 个人主页 ====================
async function openProfile() {
    // 压入当前页面再进入个人主页
    const currentView = getCurrentViewType();
    if (currentView) {
        pushForumHistory(currentView.type, currentView.data);
    }
    await openProfileDirect();
}

async function openProfileDirect() {
    const account = getCurrentAccount();
    if (!account) { window.showStatus('请先创建账户', 'error'); return; }
    
    // 加载喜欢数据
    const data = await getForumData();
    if (!data.likedPosts) data.likedPosts = [];
    window._likedPosts = data.likedPosts;
    
    document.getElementById('profileAvatarLg').style.backgroundImage = account.avatar ? `url('${account.avatar}')` : '';
    document.getElementById('profileAvatarLg').textContent = account.avatar ? '' : account.name.charAt(0);
    document.getElementById('profileDisplayName').textContent = account.name;
    document.getElementById('profileHandle').textContent = '@' + account.handle;
    document.getElementById('profileBio').textContent = account.bio || '暂无签名';
    await renderProfilePosts(account);
    switchForumView('forumProfileView');
    // 默认显示"我的帖子"
    window._profileTab = 'posts';
    updateProfileTabUI();
}

async function renderProfilePosts(account) {
    const data = await getForumData();
    window._forumDataCache = data;
    const allPosts = data.posts || [];
    const userPosts = allPosts.filter(p => p.handle === account.handle || p.name === account.name);
    const postCountEl = document.getElementById('profilePostCount');
    if (postCountEl) postCountEl.textContent = userPosts.length;
    const listEl = document.getElementById('profilePostList');
    if (!listEl) return;

    if (userPosts.length === 0) {
        listEl.innerHTML = `<div class="forum-empty" style="padding:40px 20px;"><div class="forum-empty-icon">📝</div><div class="forum-empty-title">暂无帖子</div></div>`;
        return;
    }

    listEl.innerHTML = userPosts.map(post => {
        const hasTitle = post.title && post.title.trim();
        const hasImage = post.imageData && post.imageData.trim();
        const hasImageDesc = post.imageDesc && post.imageDesc.trim();
        let imageHtml = '';
        if (hasImage) imageHtml = `<div class="tweet-image-placeholder" style="background-image:url('${post.imageData}');"></div>`;
        else if (hasImageDesc) imageHtml = `<div class="tweet-image-placeholder text-image">🖼️ ${window.escapeHtml(post.imageDesc)}</div>`;
        return `
        <div class="tweet-card" data-post-id="${post.id}">
            <div class="tweet-header-row">
                <div class="tweet-avatar" style="background-image:url('${post.avatar || ''}');">${post.avatar ? '' : (post.name || '?').charAt(0)}</div>
                <div class="tweet-body">
                    <div class="tweet-author-row">
                        <span class="tweet-name">${window.escapeHtml(post.name || '匿名')}</span>
                        <span class="tweet-verified">✓</span>
                        <span class="tweet-handle">@${window.escapeHtml(post.handle || 'unknown')}</span>
                        <span class="tweet-time">· ${window.escapeHtml(post.time || '')}</span>
                    </div>
                    ${hasTitle ? `<div class="tweet-title">${window.escapeHtml(post.title)}</div>` : ''}
                    <div class="tweet-content">${window.escapeHtml(post.content || '')}</div>
                    ${imageHtml}
                </div>
            </div>
            <div class="tweet-stats-row">
                <span class="tweet-stat">⋫ ${post.comments || 0}</span>
                <span class="tweet-stat">⇄ ${post.retweets || 0}</span>
                <span class="tweet-stat">♡ ${post.likes || 0}</span>
                <span class="tweet-stat">⊙ ${post.views || 0}</span>
                <span class="tweet-stat bookmark-btn" data-post-id="${post.id}" title="点击生成互动">✧</span>
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.tweet-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.tweet-stat')) return;
            openPostDetail(card.dataset.postId);
        });
    });
    listEl.querySelectorAll('.bookmark-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const postId = btn.dataset.postId;
            if (!postId || btn.classList.contains('generating')) return;
            btn.classList.add('generating');
            btn.textContent = '⏳';
            await generatePostInteraction(postId);
            btn.classList.remove('generating');
            btn.textContent = '⭐';
            await renderProfilePosts(getCurrentAccount());
            window.showStatus('✅ 已生成新互动', 'success');
        });
    });
}

async function renderProfileLikedPosts() {
    const data = await getForumData();
    window._forumDataCache = data;
    const likedPostIds = data.likedPosts || [];
    const allPosts = data.posts || [];
    const likedPosts = allPosts.filter(p => likedPostIds.includes(p.id));
    
    const postCountEl = document.getElementById('profilePostCount');
    if (postCountEl) postCountEl.textContent = likedPosts.length;
    const listEl = document.getElementById('profilePostList');
    if (!listEl) return;

    if (likedPosts.length === 0) {
        listEl.innerHTML = `<div class="forum-empty" style="padding:40px 20px;"><div class="forum-empty-icon">❤️</div><div class="forum-empty-title">暂未喜欢任何帖子</div></div>`;
        return;
    }

    listEl.innerHTML = likedPosts.map(post => {
        const hasTitle = post.title && post.title.trim();
        const hasImage = post.imageData && post.imageData.trim();
        const hasImageDesc = post.imageDesc && post.imageDesc.trim();
        let imageHtml = '';
        if (hasImage) imageHtml = `<div class="tweet-image-placeholder" style="background-image:url('${post.imageData}');"></div>`;
        else if (hasImageDesc) imageHtml = `<div class="tweet-image-placeholder text-image">🖼️ ${window.escapeHtml(post.imageDesc)}</div>`;
        return `
        <div class="tweet-card" data-post-id="${post.id}">
            <div class="tweet-header-row">
                <div class="tweet-avatar" style="background-image:url('${post.avatar || ''}');">${post.avatar ? '' : (post.name || '?').charAt(0)}</div>
                <div class="tweet-body">
                    <div class="tweet-author-row">
                        <span class="tweet-name">${window.escapeHtml(post.name || '匿名')}</span>
                        <span class="tweet-verified">✓</span>
                        <span class="tweet-handle">@${window.escapeHtml(post.handle || 'unknown')}</span>
                        <span class="tweet-time">· ${window.escapeHtml(post.time || '')}</span>
                    </div>
                    ${hasTitle ? `<div class="tweet-title">${window.escapeHtml(post.title)}</div>` : ''}
                    <div class="tweet-content">${window.escapeHtml(post.content || '')}</div>
                    ${imageHtml}
                </div>
            </div>
            <div class="tweet-stats-row">
                <span class="tweet-stat">⋫ ${post.comments || 0}</span>
                <span class="tweet-stat">⇄ ${post.retweets || 0}</span>
                <span class="tweet-stat">♡ ${post.likes || 0}</span>
                <span class="tweet-stat">⊙ ${post.views || 0}</span>
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.tweet-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.tweet-stat')) return;
            openPostDetail(card.dataset.postId);
        });
    });
}

function updateProfileTabUI() {
    const tabPosts = document.getElementById('profileTabPosts');
    const tabLikes = document.getElementById('profileTabLikes');
    if (tabPosts) tabPosts.classList.toggle('active', window._profileTab === 'posts');
    if (tabLikes) tabLikes.classList.toggle('active', window._profileTab === 'likes');
}

async function switchProfileTab(tab) {
    window._profileTab = tab;
    updateProfileTabUI();
    if (tab === 'posts') {
        await renderProfilePosts(getCurrentAccount());
    } else if (tab === 'likes') {
        await renderProfileLikedPosts();
    }
}

async function openAccountsList() {
    await renderAccountsList();
    switchForumView('forumAccountsView');
}

async function renderAccountsList() {
    const data = await getForumData();
    window._forumDataCache = data;
    const listEl = document.getElementById('forumAccountsList');
    if (data.accounts.length === 0) {
        listEl.innerHTML = '<div class="forum-empty"><div class="forum-empty-title">暂无账户</div></div>';
        return;
    }
    listEl.innerHTML = data.accounts.map(a => `
        <div class="account-card" data-acct-id="${a.id}">
            <div class="account-card-avatar" style="background-image:url('${a.avatar || ''}');">${a.avatar ? '' : a.name.charAt(0)}</div>
            <div class="account-card-info">
                <div class="account-card-name">${window.escapeHtml(a.name)}</div>
                <div class="account-card-handle">@${window.escapeHtml(a.handle)}</div>
            </div>
            ${a.id === data.currentAccountId ? '<span class="account-card-badge">当前</span>' : ''}
        </div>
    `).join('');

    listEl.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('click', async () => {
        const aid = card.dataset.acctId;
        const d = await getForumData();
        d.currentAccountId = aid;
        await saveForumData(d);
        window._forumDataCache = d;

        // 切换账户时清空通知红点（下次有新通知再亮）
        const badge = document.getElementById('notifBadge');
        if (badge) badge.style.display = 'none';

        await updateSidebarInfo();
        switchForumView('forumMainView');
        updateBottomNavActive('main');
        await renderPostList();
        window.showStatus('已切换账户', 'success');
    });
});
}

function openAccountEdit(accountId = null) {
    const data = window._forumDataCache || getForumData();
    let account = null;
    if (accountId) {
        account = data.accounts.find(a => a.id === accountId);
    }
    // accountId 为 null/undefined 时保持 account = null，作为新建处理

    const modal = document.getElementById('accountEditModal');
    document.getElementById('accountEditTitle').textContent = account ? '编辑账户' : '新建账户';
    document.getElementById('accountEditId').value = account ? account.id : '';
    document.getElementById('accountEditName').value = account ? account.name : '';
    document.getElementById('accountEditHandle').value = account ? account.handle : '';
    document.getElementById('accountEditBio').value = account ? account.bio : '';
    document.getElementById('accountEditPersona').value = account ? (account.persona || '') : '';
    document.getElementById('accountEditAvatarData').value = account ? (account.avatar || '') : '';

    const preview = document.getElementById('accountEditAvatarPreview');
    if (account && account.avatar) {
        preview.style.backgroundImage = `url('${account.avatar}')`;
        preview.textContent = '';
    } else {
        preview.style.backgroundImage = '';
        preview.textContent = account ? account.name.charAt(0) : '?';
    }
    modal.classList.add('open');
}

async function saveAccountEdit() {
    const id = document.getElementById('accountEditId').value;
    const name = document.getElementById('accountEditName').value.trim();
    const handle = document.getElementById('accountEditHandle').value.trim();
    const bio = document.getElementById('accountEditBio').value.trim();
    const persona = document.getElementById('accountEditPersona').value.trim();
    const avatar = document.getElementById('accountEditAvatarData').value;
    if (!name) { window.showStatus('请输入用户名', 'error'); return; }
    if (!handle) { window.showStatus('请输入账号名', 'error'); return; }

    const data = await getForumData();
    if (id) {
        const idx = data.accounts.findIndex(a => a.id === id);
        if (idx >= 0) data.accounts[idx] = { ...data.accounts[idx], name, handle, bio, persona, avatar };
    } else {
        const newAccount = { id: 'acct_' + Date.now(), name, handle, bio, persona, avatar };
        data.accounts.push(newAccount);
        if (!data.currentAccountId) data.currentAccountId = newAccount.id;
    }
    await saveForumData(data);
    window._forumDataCache = data;
    document.getElementById('accountEditModal').classList.remove('open');
    await updateSidebarInfo();
    await renderAccountsList();
    window.showStatus('账户已保存', 'success');
}

// ==================== 论坛设置 ====================
async function openForumSettings() {
    const data = await getForumData();
    window._forumDataCache = data;
    document.getElementById('forumNameInput').value = data.settings.name || '';
    document.getElementById('forumStyleInput').value = data.settings.style || '';
    await renderWorldbookMountList();
    await renderPresetList();
    resetPresetButtons();
    switchForumView('forumSettingsView');
}

async function renderWorldbookMountList() {
    const data = await getForumData();
    const wbs = await window.DB.getAll('worldbooks');
    const mounted = data.mountedWorldbooks || [];
    const listEl = document.getElementById('forumWorldbookList');
    if (wbs.length === 0) {
        listEl.innerHTML = '<div style="color:#a0a8a2;font-size:13px;padding:10px;">暂无世界书</div>';
        return;
    }
    listEl.innerHTML = wbs.map(wb => `
        <label class="worldbook-checkbox">
            <input type="checkbox" value="${wb.id}" ${mounted.includes(wb.id) ? 'checked' : ''}>
            <div>
                <div style="font-weight:500;">${window.escapeHtml(wb.title)}</div>
                <div style="font-size:11px;color:#7a8a7e;">${window.escapeHtml((wb.content || '').substring(0, 40))}...</div>
            </div>
        </label>
    `).join('');
}

async function saveForumSettings() {
    const data = await getForumData();
    data.settings.name = document.getElementById('forumNameInput').value.trim();
    data.settings.style = document.getElementById('forumStyleInput').value.trim();
    const checkboxes = document.querySelectorAll('#forumWorldbookList input[type="checkbox"]');
    data.mountedWorldbooks = [];
    checkboxes.forEach(cb => { if (cb.checked) data.mountedWorldbooks.push(cb.value); });
    await saveForumData(data);
    window._forumDataCache = data;
    window.showStatus('✅ 论坛设置已保存并生效', 'success');
}

// ==================== 预设管理 ====================
async function getPresets() {
    const record = await window.DB.get('forumPresets', 'list');
    return record?.value || [];
}
async function savePresets(presets) {
    await window.DB.put('forumPresets', { key: 'list', value: presets });
}

async function renderPresetList() {
    const presets = await getPresets();
    const container = document.getElementById('presetListContainer');
    if (presets.length === 0) {
        container.innerHTML = '<div style="color:#a0a8a2;font-size:13px;padding:10px;">暂无预设</div>';
        return;
    }
    container.innerHTML = presets.map((p, i) => `
        <div class="preset-item" data-index="${i}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f8f8f8;border-radius:10px;margin-bottom:6px;cursor:pointer;">
            <span style="font-weight:500;">${window.escapeHtml(p.name || '未命名')}</span>
            <span style="font-size:12px;color:#657786;">${(p.style || '').substring(0, 20)}...</span>
        </div>
    `).join('');

    container.querySelectorAll('.preset-item').forEach(item => {
        item.addEventListener('click', async () => {
            const idx = parseInt(item.dataset.index);
            const presets = await getPresets();
            const preset = presets[idx];
            if (preset) await loadPresetToForm(preset, idx);
        });
    });
}

async function loadPresetToForm(preset, presetIndex) {
    document.getElementById('forumNameInput').value = preset.name || '';
    document.getElementById('forumStyleInput').value = preset.style || '';
    await renderWorldbookMountList();
    setTimeout(() => {
        const checkboxes = document.querySelectorAll('#forumWorldbookList input[type="checkbox"]');
        checkboxes.forEach(cb => { cb.checked = (preset.mountedWorldbooks || []).includes(cb.value); });
    }, 100);

    const saveBtn = document.getElementById('saveForumSettingsBtn');
    saveBtn.textContent = '💾 保存并生效';
    saveBtn.style.flex = '1';
    const presetBtn = document.getElementById('savePresetBtn');
    presetBtn.textContent = '🔄 更新预设';
    presetBtn.style.flex = '1';
    presetBtn.dataset.presetIndex = presetIndex;
    window.showStatus('✅ 已加载预设：' + preset.name, 'success');
}

async function saveCurrentAsPreset() {
    const name = document.getElementById('forumNameInput').value.trim();
    const style = document.getElementById('forumStyleInput').value.trim();
    if (!name) { window.showStatus('请输入论坛名称', 'error'); return; }
    const checkboxes = document.querySelectorAll('#forumWorldbookList input[type="checkbox"]');
    const mountedWorldbooks = [];
    checkboxes.forEach(cb => { if (cb.checked) mountedWorldbooks.push(cb.value); });
    const preset = { name, style, mountedWorldbooks };
    const presets = await getPresets();
    presets.push(preset);
    await savePresets(presets);
    await renderPresetList();
    resetPresetButtons();
    window.showStatus('✅ 预设已保存', 'success');
}

async function updatePreset(presetIndex) {
    const name = document.getElementById('forumNameInput').value.trim();
    const style = document.getElementById('forumStyleInput').value.trim();
    if (!name) { window.showStatus('请输入论坛名称', 'error'); return; }
    const checkboxes = document.querySelectorAll('#forumWorldbookList input[type="checkbox"]');
    const mountedWorldbooks = [];
    checkboxes.forEach(cb => { if (cb.checked) mountedWorldbooks.push(cb.value); });
    const preset = { name, style, mountedWorldbooks };
    const presets = await getPresets();
    if (presetIndex >= 0 && presetIndex < presets.length) {
        presets[presetIndex] = preset;
        await savePresets(presets);
        await renderPresetList();
        resetPresetButtons();
        window.showStatus('✅ 预设已更新', 'success');
    }
}

function resetPresetButtons() {
    document.getElementById('saveForumSettingsBtn').textContent = '💾 保存并生效';
    const presetBtn = document.getElementById('savePresetBtn');
    presetBtn.textContent = '📥 存为预设';
    presetBtn.removeAttribute('data-preset-index');
}

// ==================== 通知 ====================
async function addNotification(content, postId = null) {
    const data = await getForumData();
    if (!data.notifications) data.notifications = [];
    const account = getCurrentAccount();
    const accId = account?.id || null;

    data.notifications.unshift({
        id: 'notif_' + Date.now(),
        time: '刚刚',
        content,
        postId,
        accountId: accId
    });

    // 当前账户最多保留20条（旧版是全局20条，会互相挤掉）
    const myCount = data.notifications.filter(n => n.accountId === accId).length;
    if (myCount > 20) {
        let toDelete = myCount - 20;
        for (let i = data.notifications.length - 1; i >= 0 && toDelete > 0; i--) {
            if (data.notifications[i].accountId === accId) {
                data.notifications.splice(i, 1);
                toDelete--;
            }
        }
    }

    await saveForumData(data);
    window._forumDataCache = data;
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'block';
    if (document.getElementById('forumNotifView').style.display !== 'none') {
        await renderNotifList();
    }
}

function addMessageNotification(fromName, preview) {
    if (window._currentConversationFrom === fromName && document.getElementById('forumMsgConversationView').style.display === 'flex') return;
    const existing = document.querySelector('.msg-notification-card');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'msg-notification-card';
    card.innerHTML = `
        <div class="msg-notification-avatar">${fromName.charAt(0)}</div>
        <div class="msg-notification-info">
            <div class="msg-notification-name">${window.escapeHtml(fromName)}</div>
            <div class="msg-notification-preview">${window.escapeHtml(preview.substring(0, 30))}${preview.length > 30 ? '...' : ''}</div>
        </div>
        <div class="msg-notification-close">✕</div>`;
    (document.getElementById('page-forum') || document.body).appendChild(card);

    card.addEventListener('click', (e) => {
        if (e.target.closest('.msg-notification-close')) return;
        card.remove();
        document.getElementById('forumMsgConversationView').style.display = 'none';
        document.getElementById('forumMsgView').style.display = 'block';
        document.getElementById('forumBottomNav').style.display = 'flex';
        document.getElementById('forumFabBtn').style.display = 'block';
        updateBottomNavActive('msg');
        switchForumView('forumMsgView');
        setTimeout(() => openConversation(fromName), 100);
    });

    card.querySelector('.msg-notification-close').addEventListener('click', (e) => {
        e.stopPropagation();
        card.classList.add('dismissed');
        setTimeout(() => card.remove(), 300);
    });

    let startX = 0, currentX = 0, isDragging = false;
    card.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; currentX = startX; isDragging = true;
        card.classList.add('swiping'); });
    card.addEventListener('touchmove', (e) => { if (!isDragging) return;
        currentX = e.touches[0].clientX; const diff = currentX - startX;
        card.style.transform = `translateX(${diff}px)`;
        card.style.opacity = Math.max(0, 1 - Math.abs(diff) / 200); });
    card.addEventListener('touchend', () => { isDragging = false;
        card.classList.remove('swiping'); if (Math.abs(currentX - startX) > 80) { card.classList.add('dismissed');
            setTimeout(() => card.remove(), 300); } else { card.style.transform = '';
            card.style.opacity = ''; } });
    card.addEventListener('mousedown', (e) => { if (e.target.closest('.msg-notification-close')) return;
        startX = e.clientX;
        currentX = startX;
        isDragging = true;
        card.classList.add('swiping');
        e.preventDefault(); });
    document.addEventListener('mousemove', (e) => { if (!isDragging) return;
        currentX = e.clientX; const diff = currentX - startX;
        card.style.transform = `translateX(${diff}px)`;
        card.style.opacity = Math.max(0, 1 - Math.abs(diff) / 200); });
    document.addEventListener('mouseup', () => { if (!isDragging) return;
        isDragging = false;
        card.classList.remove('swiping'); if (Math.abs(currentX - startX) > 80) { card.classList.add('dismissed');
            setTimeout(() => card.remove(), 300); } else { card.style.transform = '';
            card.style.opacity = ''; } });
    setTimeout(() => { if (card.parentNode) { card.classList.add('dismissed');
            setTimeout(() => { if (card.parentNode) card.remove(); }, 300); } }, 5000);
}

// ==================== AI 生成上下文 ====================
async function buildForumContext(includeAccountPersona = false) {
    const data = await getForumData();
    window._forumDataCache = data;
    const account = getCurrentAccount();
    const wbs = await window.DB.getAll('worldbooks');
    const mounted = data.mountedWorldbooks || [];

    let context = `【论坛设定】\n论坛名称：${data.settings.name}\n氛围风格：${data.settings.style}\n`;
    if (mounted.length > 0) {
        context += '\n【挂载世界书】\n';
        wbs.filter(wb => mounted.includes(wb.id)).forEach(wb => { context += `--- ${wb.title} ---\n${wb.content}\n\n`; });
    }
    if (includeAccountPersona && account) {
        context += `\n【当前操作用户】\n用户名：${account.name}\n账号：@${account.handle}\n签名：${account.bio}\n人设：${account.persona || '普通用户'}\n`;
    }
    return context;
}

// ==================== AI 生成互动 ====================
async function generatePostInteraction(postId) {
    const data = await getForumData();
    const post = (data.posts || []).find(p => p.id === postId);
    if (!post) return;
    const context = await buildForumContext(false);
    const existingComments = (data.comments || {})[postId] || [];
    const commentContext = existingComments.length > 0 ? existingComments.map((c, i) => `评论${i + 1}：@${c.handle || 'unknown'} 说："${c.text || ''}"`).join('\n') : '暂无评论';

    try {
        const currentAccount = getCurrentAccount();
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n【帖子信息】\n标题：${post.title || '无标题'}\n作者：${post.name || '匿名'} (@${post.handle || 'unknown'})\n内容：${post.content || ''}\n\n【对方（帖子作者）】\n名称：${post.name || '匿名'}\n账号：@${post.handle || 'unknown'}\n\n【已有评论】\n${commentContext}\n\n请生成1-2条新评论。JSON：[{"name":"","handle":"","text":"","replyTo":""}]\n禁止使用name="${currentAccount?.name || ''}"、handle="${currentAccount?.handle || ''}"` }], { temperature: 1.0, maxTokens: 600 });
        const newComments = parseJSONFromReply(reply);

        if (newComments && newComments.length > 0) {
            const d = await getForumData();
            if (!d.comments) d.comments = {};
            if (!d.comments[postId]) d.comments[postId] = [];

            newComments.forEach(c => {
                const text = c.text || '';
                const replyTo = c.replyTo || '';
                const newComment = { id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: c.name || '匿名', handle: c.handle || 'user', avatar: '', text, replyTo };
                if (replyTo) {
                    let parentComment = null;
                    for (const comment of d.comments[postId]) { if (comment.handle === replyTo.replace('@', '')) { parentComment = comment; break; } }
                    if (parentComment) {
                        if (!parentComment.replies) parentComment.replies = [];
                        newComment.text = `回复 @${replyTo.replace('@', '')}：${text}`;
                        parentComment.replies.push(newComment);
                        return;
                    }
                }
                d.comments[postId].push(newComment);
            });

            const p = d.posts.find(p => p.id === postId);
            if (p) { p.comments = (d.comments[postId] || []).reduce((sum, c) => sum + 1 + (c.replies ? c.replies.length : 0), 0);
                p.likes = (p.likes || 0) + Math.floor(Math.random() * 8) + 2;
                p.retweets = (p.retweets || 0) + Math.floor(Math.random() * 3);
                p.views = (p.views || 0) + Math.floor(Math.random() * 200) + 50; }
            await saveForumData(d);
            window._forumDataCache = d;

            const postTitle = post.title || post.content || '帖子';
            newComments.forEach(c => {
                const replyTo = c.replyTo || '';
                if (replyTo) {
                    addNotification(`${c.name || '匿名'} 回复了 @${replyTo.replace('@', '')}`, postId);
                } else {
                    addNotification(`${c.name || '匿名'} 评论了${postTitle.substring(0, 20)}`, postId);
                }
            });
            addNotification(`帖子获得了 ${p?.likes || 0} 个喜欢`, postId);

            await renderPostList();
            if (window._currentDetailPostId === postId) {
                await openPostDetailDirect(postId);
            }
        }
    } catch (e) { console.error('生成互动失败:', e); }
}

async function generateAuthorProfile(authorHandle, authorName) {
    window.showStatus('🤖 正在生成主页...', 'info');
    const context = await buildForumContext(false);
    const data = await getForumData();
    const existingPosts = (data.posts || []).filter(p => p.handle === authorHandle);

    try {
        const account = getCurrentAccount();
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n请为论坛用户"${authorName}"(@${authorHandle})生成账号主页信息和3-5条帖子。JSON：{"profile":{"bio":"","persona":""},"posts":[{"title":"","content":"","time":"","imageDesc":""}]}\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"` }], { temperature: 1.0, maxTokens: 2000 });
        const result = parseJSONFromReply(reply);
        if (result && result.posts) {
            const newPosts = result.posts.map(p => ({
                ...p, id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: result.profile?.name || authorName, handle: authorHandle, avatar: '',
                title: p.title || '', content: p.content || '', time: p.time || '刚刚', imageData: '', imageDesc: p.imageDesc || '',
                comments: Math.floor(Math.random() * 15), retweets: Math.floor(Math.random() * 8), likes: Math.floor(Math.random() * 60), views: Math.floor(Math.random() * 20000)
            }));
            data.posts = [...newPosts, ...existingPosts, ...(data.posts || []).filter(p => p.handle !== authorHandle)];
            await saveForumData(data);
            window._forumDataCache = data;
            window.showStatus(`✅ 已生成 ${authorName} 的主页`, 'success');
            openAuthorProfileDirect(authorHandle, authorName, result.profile?.bio || '', existingPosts.length + newPosts.length);
        }
    } catch (e) { window.showStatus('❌ ' + e.message, 'error'); }
}

async function generateAuthorProfileDeflect(authorHandle, authorName, fromPostId) {
    window.showStatus('🤖 正在生成主页...', 'info');
    const context = await buildForumContext(false);
    const data = await getForumData();
    const existingPosts = (data.posts || []).filter(p => p.handle === authorHandle);

    try {
        const account = getCurrentAccount();
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n请为论坛用户"${authorName}"(@${authorHandle})生成账号主页信息和3-5条帖子。JSON：{"profile":{"bio":"","persona":""},"posts":[{"title":"","content":"","time":"","imageDesc":""}]}\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"` }], { temperature: 1.0, maxTokens: 2000 });
        const result = parseJSONFromReply(reply);
        if (result && result.posts) {
            const newPosts = result.posts.map(p => ({
                ...p, id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: result.profile?.name || authorName, handle: authorHandle, avatar: '',
                title: p.title || '', content: p.content || '', time: p.time || '刚刚', imageData: '', imageDesc: p.imageDesc || '',
                comments: Math.floor(Math.random() * 15), retweets: Math.floor(Math.random() * 8), likes: Math.floor(Math.random() * 60), views: Math.floor(Math.random() * 20000)
            }));
            data.posts = [...newPosts, ...existingPosts, ...(data.posts || []).filter(p => p.handle !== authorHandle)];
            await saveForumData(data);
            window._forumDataCache = data;
            window.showStatus(`✅ 已生成 ${authorName} 的主页`, 'success');
            openAuthorProfileDirect(authorHandle, authorName, result.profile?.bio || '', existingPosts.length + newPosts.length);
        }
    } catch (e) { window.showStatus('❌ ' + e.message, 'error'); }
}

async function submitPostAsAuthor(authorHandle, authorName) {
    window.showStatus('🤖 正在以 ' + authorName + ' 的身份发帖...', 'info');
    const context = await buildForumContext(false);
    const data = await getForumData();
    try {
        const account = getCurrentAccount();
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n以"${authorName}"(@${authorHandle})身份生成1条帖子。JSON：{"title":"","content":"","imageDesc":""}\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"` }], { temperature: 1.0, maxTokens: 500 });
        const postData = parseJSONFromReplySingle(reply);
        if (postData && postData.content) {
            const newPost = { id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), name: authorName, handle: authorHandle, avatar: '', title: postData.title || '', content: postData.content || '', time: '刚刚', imageData: '', imageDesc: postData.imageDesc || '', comments: Math.floor(Math.random() * 10), retweets: Math.floor(Math.random() * 5), likes: Math.floor(Math.random() * 30), views: Math.floor(Math.random() * 10000) };
            data.posts.unshift(newPost);
            await saveForumData(data);
            window._forumDataCache = data;
            const currentPosts = (data.posts || []).filter(p => p.handle === authorHandle || p.name === authorName);
            openAuthorProfileDirect(authorHandle, authorName, '', currentPosts.length);
            addNotification(`${authorName} 发布了一条新帖子`, newPost.id);
            window.showStatus('✅ ' + authorName + ' 已发布新帖子', 'success');
        }
    } catch (e) { window.showStatus('❌ ' + e.message, 'error'); }
}

async function openAuthorProfile(authorHandle, authorName, authorBio, postCount) {
    // 压入当前页面
    const currentView = getCurrentViewType();
    if (currentView) {
        pushForumHistory(currentView.type, currentView.data);
    }
    await openAuthorProfileDirect(authorHandle, authorName, authorBio, postCount);
}

async function openAuthorProfileDirect(authorHandle, authorName, authorBio, postCount) {
    const data = await getForumData();
    const authorPosts = (data.posts || []).filter(p => p.handle === authorHandle);
    const profileHtml = `
        <div style="padding:16px;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <div style="width:60px;height:60px;border-radius:50%;background:#ddd;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:600;color:#666;flex-shrink:0;">${(authorName || '?').charAt(0)}</div>
                <div style="flex:1;min-width:0;overflow:hidden;">
                    <div style="font-size:18px;font-weight:bold;">${window.escapeHtml(authorName || '匿名')}</div>
                    <div style="color:#657786;">@${window.escapeHtml(authorHandle || '')}</div>
                </div>
                <button class="btn btn-primary" id="followAuthorBtn" data-handle="${window.escapeHtml(authorHandle)}" data-name="${window.escapeHtml(authorName)}" style="margin-left:auto;padding:4px 10px;font-size:11px;">👤 关注</button>
            </div>
            <div style="color:#333;margin-bottom:12px;">${window.escapeHtml(authorBio || '暂无签名')}</div>
            <div style="color:#657786;font-size:14px;margin-bottom:16px;"><span style="font-weight:bold;color:#000;">${postCount || authorPosts.length}</span> 帖子</div>
            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <button class="profile-action-btn" id="dmAuthorBtn" data-handle="${window.escapeHtml(authorHandle)}" data-name="${window.escapeHtml(authorName)}" style="flex:1;">💬 私信</button>
            </div>
            <div style="border-top:1px solid #eee;padding-top:12px;font-weight:600;cursor:pointer;color:#1d9bf0;" id="authorPostBtn" data-author-handle="${window.escapeHtml(authorHandle)}" data-author-name="${window.escapeHtml(authorName)}">📝 帖子 (点击以对方身份发帖)</div>
            ${authorPosts.map(p => `
            <div class="tweet-card" data-post-id="${p.id}" style="margin:0 -16px;cursor:pointer;">
                <div class="tweet-header-row">
                    <div class="tweet-avatar" style="background-image:url('${p.avatar || ''}');">${p.avatar ? '' : (p.name || '?').charAt(0)}</div>
                    <div class="tweet-body">
                        <div class="tweet-author-row">
                            <span class="tweet-name">${window.escapeHtml(p.name || '匿名')}</span>
                            <span class="tweet-verified">✓</span>
                            <span class="tweet-handle">@${window.escapeHtml(p.handle || '')}</span>
                            <span class="tweet-time">· ${window.escapeHtml(p.time || '')}</span>
                        </div>
                        ${p.title ? `<div class="tweet-title">${window.escapeHtml(p.title)}</div>` : ''}
                        <div class="tweet-content">${window.escapeHtml(p.content || '')}</div>
                        ${p.imageDesc ? `<div class="tweet-image-placeholder text-image">🖼️ ${window.escapeHtml(p.imageDesc)}</div>` : ''}
                    </div>
                </div>
                <div class="tweet-stats-row">
                    <span class="tweet-stat">💬 ${p.comments || 0}</span>
                    <span class="tweet-stat">🔁 ${p.retweets || 0}</span>
                    <span class="tweet-stat">❤️ ${p.likes || 0}</span>
                    <span class="tweet-stat">📶 ${p.views || 0}</span>
                </div>
            </div>
            `).join('')}
        </div>`;

    document.getElementById('forumDetailContent').innerHTML = profileHtml;
    switchForumView('forumDetailView');
    const commentInputRow = document.getElementById('forumDetailCommentInput');
    if (commentInputRow) commentInputRow.style.display = 'none';

    setTimeout(() => {
        const followBtn = document.getElementById('followAuthorBtn');
        if (followBtn) {
            // 克隆节点清除旧事件绑定
            const newFollowBtn = followBtn.cloneNode(true);
            followBtn.parentNode.replaceChild(newFollowBtn, followBtn);
            
            const data2 = window._forumDataCache || getForumData();
            const following = data2?.following || [];
            if (following.some(f => f.handle === authorHandle)) {
                newFollowBtn.textContent = '✅ 已关注';
                newFollowBtn.style.background = '#e0e0e0';
                newFollowBtn.style.color = '#333';
            }
            newFollowBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const d = await getForumData();
                if (!d.following) d.following = [];
                if (!d.following.some(f => f.handle === authorHandle)) {
                    d.following.push({ handle: authorHandle, name: authorName });
                    await saveForumData(d);
                    window._forumDataCache = d;
                    newFollowBtn.textContent = '✅ 已关注';
                    newFollowBtn.style.background = '#e0e0e0';
                    newFollowBtn.style.color = '#333';
                    window.showStatus('✅ 已关注 @' + authorHandle, 'success');
                } else {
                    d.following = d.following.filter(f => f.handle !== authorHandle);
                    await saveForumData(d);
                    window._forumDataCache = d;
                    newFollowBtn.textContent = '👤 关注';
                    newFollowBtn.style.background = '#1d9bf0';
                    newFollowBtn.style.color = '#fff';
                    window.showStatus('已取消关注', 'info');
                }
            });
        }

        const dmBtn = document.getElementById('dmAuthorBtn');
        if (dmBtn) {
            const newDmBtn = dmBtn.cloneNode(true);
            dmBtn.parentNode.replaceChild(newDmBtn, dmBtn);
            newDmBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await openDMWithAuthor(authorHandle, authorName);
            });
        }

        const postBtn = document.getElementById('authorPostBtn');
        if (postBtn) {
            const newPostBtn = postBtn.cloneNode(true);
            postBtn.parentNode.replaceChild(newPostBtn, postBtn);
            newPostBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await submitPostAsAuthor(newPostBtn.dataset.authorHandle, newPostBtn.dataset.authorName);
            });
        }

        document.querySelectorAll('#forumDetailContent .tweet-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.tweet-stat') || e.target.closest('#followAuthorBtn') || e.target.closest('#dmAuthorBtn')) return;
                if (card.dataset.postId) {
                    pushForumHistory('profile_other', { authorHandle, authorName, authorBio, postCount: postCount || authorPosts.length });
                    openPostDetailDirect(card.dataset.postId);
                }
            });
        });
    }, 200);
}

// ==================== 向作者发起私信 ====================
async function openDMWithAuthor(authorHandle, authorName) {
    const account = getCurrentAccount();
    if (!account) { window.showStatus('请先创建账户', 'error'); return; }
    if (authorHandle === account.handle) { window.showStatus('不能给自己发私信', 'info'); return; }

    const data = await getForumData();
    window._forumDataCache = data;
    
    // 检查是否有历史消息
    const existingMsgs = (data.messages || []).filter(m =>
        (m.from === authorName && m.to === account.name) ||
        (m.to === authorName && m.from === account.name)
    );

    // 如果没有历史消息，创建一个占位消息以确保对话出现在列表中
    if (existingMsgs.length === 0) {
        const placeholderMsg = {
    id: 'msg_' + Date.now() + '_placeholder',
    accountId: account.id,
    timestamp: Date.now(),
    from: authorName,
    fromHandle: authorHandle,
    to: account.name,
    content: '',
    time: '刚刚',
    avatar: '',
    bubbles: [{ type: 'text', content: '' }],
    isPlaceholder: true
};
        if (!data.messages) data.messages = [];
        data.messages.push(placeholderMsg);
        await saveForumData(data);
        window._forumDataCache = data;
    }

    // 关闭详情视图，切换到私信对话
    document.getElementById('forumDetailView').style.display = 'none';
    document.getElementById('forumBottomNav').style.display = 'none';
    document.getElementById('forumFabBtn').style.display = 'none';
    
    await openConversation(authorName, authorHandle);
}

// ==================== AI 生成帖子/趋势/私信 ====================
async function generatePosts() {
    window.showStatus('🤖 正在生成帖子...', 'info');
    const context = await buildForumContext(true);
    const data = await getForumData();
    const account = getCurrentAccount();

    try {
        const prompt = `${context}\n\n请生成3-5条虚拟论坛帖子。JSON数组：[{"title":"标题(5-15字)","name":"作者名","handle":"账号","time":"发帖时间","content":"正文(20-80字)","imageDesc":"图片描述(可选)"}]\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"`;
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 1.0, maxTokens: 2000 });
        const posts = parseJSONFromReply(reply);

        if (posts && posts.length > 0) {
            const newPosts = posts.map(p => ({
                ...p, id: 'post_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: p.name || '匿名', handle: p.handle || 'user', title: p.title || '', avatar: '',
                time: p.time || '刚刚', content: p.content || '', imageData: '', imageDesc: p.imageDesc || '',
                comments: Math.floor(Math.random() * 30), retweets: Math.floor(Math.random() * 20),
                likes: Math.floor(Math.random() * 150), views: Math.floor(Math.random() * 50000)
            }));
            data.posts = [...newPosts, ...(data.posts || [])];
            await saveForumData(data);
            window._forumDataCache = data;
            await renderPostList();
            window.showStatus('✅ 已生成 ' + posts.length + ' 条新帖子', 'success');
        }
    } catch (e) {
        window.showStatus('❌ ' + e.message, 'error');
    }
}

async function generateTrends() {
    window.showStatus('🤖 正在生成趋势...', 'info');
    const context = await buildForumContext();
    try {
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n请生成5个热门趋势话题，JSON：[{"category":"","name":"","count":""}]` }], { temperature: 1.0, maxTokens: 500 });
        const trends = parseJSONFromReply(reply);
        if (trends && trends.length > 0) {
            const data = await getForumData();
            data.trends = trends;
            await saveForumData(data);
            window._forumDataCache = data;
            await renderTrendList();
            window.showStatus('✅ 已生成趋势', 'success');
        }
    } catch (e) {
        window.showStatus('❌ ' + e.message, 'error');
    }
}

async function generateMessages() {
    window.showStatus('🤖 正在生成私信...', 'info');
    const context = await buildForumContext(true);
    const account = getCurrentAccount();
    const data = await getForumData();
    
    // 获取用户近期帖子
    const userPosts = (data.posts || []).filter(p => p.handle === account?.handle || p.name === account?.name).slice(0, 5);
    const userPostsContext = userPosts.length > 0 ? 
        '\n【用户近期帖子】\n' + userPosts.map(p => `标题：${p.title || '无标题'}\n内容：${p.content || ''}`).join('\n\n') : 
        '\n【用户近期帖子】\n暂无帖子';
    
    try {
        if (window.recordApiPending) window.recordApiPending();
        const prompt = `${context}\n\n【用户发帖历史】\n${userPostsContext}\n\n请以其他论坛用户的身份，给 @${account?.handle || 'user'} 发送2-4条私信。\n要求：\n- 一部分来自已关注的好友（名字在关注列表中），内容亲切自然\n- 一部分来自新陌生人（名字不在关注列表中），内容为搭讪或交流\nJSON格式：[{"from":"对方名字","fromHandle":"对方账号","isFriend":true/false,"time":"刚刚","bubbles":[{"type":"text","content":"消息内容"}]}]`;
        
        const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 1.0, maxTokens: 800 });
        const msgs = parseJSONFromReply(reply);
        if (msgs && msgs.length > 0) {
            const nowTs = Date.now();
            const newMsgs = msgs.map((m, i) => ({
    ...m,
    id: 'msg_' + nowTs + '_' + i,
    accountId: account?.id || null,
    timestamp: nowTs + i,
    fromHandle: m.fromHandle || '',
    fromBio: m.fromBio || '',
    to: account?.name || ''
}));
            data.messages = [...newMsgs, ...(data.messages || [])];
            await saveForumData(data);
            window._forumDataCache = data;
            await renderMsgList(window._currentMsgTab === 'friends');
            window.showStatus('✅ 已生成 ' + msgs.length + ' 条新私信', 'success');
        }
    } catch (e) {
        window.showStatus('❌ ' + e.message, 'error');
    }
}

async function generateAutoMessages(triggerType, triggerData) {
    const context = await buildForumContext(true);
    const account = getCurrentAccount();
    const data = await getForumData();
    const following = data.following || [];
    
    let triggerContext = '';
    if (triggerType === 'post') {
        triggerContext = `\n【用户刚刚发布了帖子】\n标题：${triggerData.title || '无标题'}\n内容：${triggerData.content || ''}`;
    } else if (triggerType === 'comment') {
        const post = (data.posts || []).find(p => p.id === triggerData.postId);
        triggerContext = `\n【用户刚刚发表了评论】\n评论内容：${triggerData.text || ''}\n${triggerData.replyToHandle ? '回复对象：@' + triggerData.replyToHandle : ''}\n相关帖子：${post ? (post.title || post.content || '').substring(0, 50) : '未知'}`;
    }
    
    try {
        const prompt = `${context}\n\n${triggerContext}\n\n请以其他论坛用户的身份，给 @${account?.handle || 'user'} 发送1-2条私信，内容应呼应刚刚的帖子/评论。\n要求：\n- 可能来自已关注的好友（isFriend:true），内容亲切\n- 可能来自新陌生人（isFriend:false），内容为搭讪\nJSON格式：[{"from":"对方名字","fromHandle":"对方账号","isFriend":true/false,"bubbles":[{"type":"text","content":"消息内容"}]}]`;
        
        if (window.recordApiPending) window.recordApiPending();
        const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 0.9, maxTokens: 400 });
        const msgs = parseJSONFromReply(reply);
        if (msgs && msgs.length > 0) {
            const d = await getForumData();
            const nowTs = Date.now();
            const newMsgs = msgs.map((m, i) => ({
    ...m,
    id: 'msg_' + nowTs + '_' + i,
    accountId: account?.id || null,
    timestamp: nowTs + i,
    fromHandle: m.fromHandle || '',
    to: account?.name || ''
}));
            d.messages = [...newMsgs, ...(d.messages || [])];
            await saveForumData(d);
            window._forumDataCache = d;
            
            // 通知
            newMsgs.forEach(m => {
                const preview = (m.bubbles && m.bubbles[0]?.content) ? m.bubbles[0].content.substring(0, 20) : '新消息';
                addMessageNotification(m.from, preview);
            });
        }
    } catch (e) { /* 静默 */ }
}

async function generateCommentReplies(postId, commentHandle) {
    const context = await buildForumContext(false);
    const data = await getForumData();
    const comments = (data.comments || {})[postId] || [];
    const target = comments.find(c => c.handle === commentHandle);
    if (!target) return;
    
    const account = getCurrentAccount();
    const prompt = `${context}\n\n有人评论说："${target.text}"\n\n生成1-2条针对这条评论的回复。JSON：[{"name":"","handle":"","text":""}]\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"`;
    
    if (window.recordApiPending) window.recordApiPending();
    const reply = await window.callLLM([{ role: 'user', content: prompt }], { temperature: 1.0, maxTokens: 400 });
    const replies = parseJSONFromReply(reply);
    
    if (replies && replies.length > 0) {
        const d = await getForumData();
        if (!d.comments) d.comments = {};
        if (!d.comments[postId]) d.comments[postId] = [];
        
        const targetComment = d.comments[postId].find(c => c.handle === commentHandle);
        if (targetComment) {
            if (!targetComment.replies) targetComment.replies = [];
            replies.forEach(r => {
                targetComment.replies.push({
                    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    name: r.name || '匿名',
                    handle: r.handle || 'user',
                    avatar: '',
                    text: r.text || ''
                });
            });
        }
        
        const p = d.posts.find(p => p.id === postId);
        if (p) p.comments = (d.comments[postId] || []).reduce((sum, c) => sum + 1 + (c.replies ? c.replies.length : 0), 0);
        
        await saveForumData(d);
        window._forumDataCache = d;
        window.showStatus('✅ 已生成回复', 'success');
    }
}

// ==================== 发帖/评论 ====================
async function submitNewPost(title, content, imageData, imageDesc) {
    const data = await getForumData();
    const account = getCurrentAccount();
    if (!account) { window.showStatus('请先创建账户', 'error'); return; }
    if (!content.trim()) { window.showStatus('请输入正文', 'error'); return; }

    const newPost = {
        id: 'post_' + Date.now(), name: account.name, handle: account.handle,
        avatar: account.avatar || '', title: title.trim(), time: '刚刚',
        content: content.trim(), imageData: imageData || '', imageDesc: imageDesc || '',
        comments: 0, retweets: 0, likes: 0, views: 0
    };
    data.posts.unshift(newPost);
    await saveForumData(data);
    window._forumDataCache = data;
    await renderPostList();
    window.showStatus('✅ 发布成功', 'success');
    addNotification(`你发布了一条新帖子："${(title || content).substring(0, 30)}..."`);

    setTimeout(async () => {
        const context = await buildForumContext(false);
        try {
            if (window.recordApiPending) window.recordApiPending();
            const reply = await window.callLLM([{ role: 'user', content: `${context}\n\n用户 @${account.handle} 发了帖子：标题"${title}"，内容"${content}"\n\n生成2-3条评论。JSON：[{"name":"","handle":"","text":""}]\n禁止使用name="${account?.name || ''}"、handle="${account?.handle || ''}"` }], { temperature: 1.0, maxTokens: 600 });
            const comments = parseJSONFromReply(reply);
            if (comments && comments.length > 0) {
                const d = await getForumData();
                if (!d.comments) d.comments = {};
                d.comments[newPost.id] = comments.map(c => ({ id: 'cmt_' + Date.now(), name: c.name || '匿名', handle: c.handle || 'user', avatar: '', text: c.text || '' }));
                const post = d.posts.find(p => p.id === newPost.id);
                if (post) { post.comments = comments.length;
                    post.likes = Math.floor(Math.random() * 10);
                    post.retweets = Math.floor(Math.random() * 3);
                    post.views = Math.floor(Math.random() * 500); }
                await saveForumData(d);
                window._forumDataCache = d;
                if (post?.handle === account?.handle) {
                    comments.forEach(c => addNotification(`${c.name || '匿名'} 评论了你的帖子`, newPost.id));
                    addNotification(`你的帖子获得了 ${post?.likes || 0} 个喜欢`, newPost.id);
                }
                // 刷新帖子列表和详情页
                await renderPostList();
                if (window._currentDetailPostId === newPost.id) {
                    await openPostDetailDirect(newPost.id);
                }
            }
        } catch (e) { /* 静默 */ }
        
        // ========== 自动触发私信生成 ==========
        setTimeout(async () => {
            await generateAutoMessages('post', { title, content });
        }, 2000);
    }, 2000);
}

async function submitComment(postId, text, replyToHandle = '') {
    const data = await getForumData();
    const account = getCurrentAccount();
    if (!account) { window.showStatus('请先创建账户', 'error'); return; }
    if (!text.trim()) return;

    const comment = { id: 'cmt_' + Date.now(), name: account.name, handle: account.handle, avatar: account.avatar || '', text: text.trim(), replyTo: replyToHandle };
    if (!data.comments) data.comments = {};
    if (!data.comments[postId]) data.comments[postId] = [];
    
    if (replyToHandle) {
        const targetComment = data.comments[postId].find(c => c.handle === replyToHandle);
        if (targetComment) {
            if (!targetComment.replies) targetComment.replies = [];
            comment.text = `回复 @${replyToHandle}：${text.trim()}`;
            targetComment.replies.push(comment);
        } else {
            data.comments[postId].push(comment);
        }
    } else {
        data.comments[postId].push(comment);
    }

    const post = data.posts.find(p => p.id === postId);
    if (post) post.comments = (post.comments || 0) + 1;

    await saveForumData(data);
    window._forumDataCache = data;
    await openPostDetailDirect(postId);
    window.showStatus('✅ 评论已发布', 'success');
    addNotification(`你评论了 @${post?.handle || 'unknown'} 的帖子`, postId);
}

// ==================== JSON 解析 ====================
function parseJSONFromReply(reply) {
    try {
        const cleaned = reply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        const match = reply.match(/\[[\s\S]*\]/);
        if (match) { try { return JSON.parse(match[0]); } catch (e2) {} }
        return null;
    }
}

function parseJSONFromReplySingle(reply) {
    try {
        const cleaned = reply.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const objMatch = reply.match(/\{[\s\S]*\}/);
        if (objMatch) return JSON.parse(objMatch[0]);
        return JSON.parse(cleaned);
    } catch (e) { return null; }
}

// ==================== 事件绑定 ====================
function bindForumEvents() {
    // 侧边栏
    document.getElementById('forumNavAvatar').addEventListener('click', openSidebar);
    document.getElementById('forumSidebarOverlay').addEventListener('click', closeSidebar);
    document.getElementById('sidebarProfileBtn').addEventListener('click', () => { closeSidebar();
        openProfile(); });
    document.getElementById('sidebarSettingsBtn').addEventListener('click', () => { closeSidebar();
        openForumSettings(); });
    document.getElementById('sidebarAccountsBtn').addEventListener('click', () => { closeSidebar();
        openAccountsList(); });

    // 论坛 Logo
    const logoBtn = document.getElementById('forumLogoBtn');
    let logoPressTimer = null;
    let logoIsLongPress = false;

    logoBtn.addEventListener('click', (e) => {
        if (logoIsLongPress) { logoIsLongPress = false; return; }
        window.switchPage('desktop');
    });

    function startLogoPress() {
        logoIsLongPress = false;
        logoBtn.classList.add('press-ripple');
        logoPressTimer = setTimeout(() => {
            logoIsLongPress = true;
            logoBtn.classList.remove('press-ripple');
            const currentView = getCurrentForumMainView();
            if (currentView === 'trend') generateTrends();
            else if (currentView === 'msg') generateMessages();
            else generatePosts();
        }, 800);
    }
    function endLogoPress() {
        clearTimeout(logoPressTimer);
        setTimeout(() => logoBtn.classList.remove('press-ripple'), 300);
    }
    function getCurrentForumMainView() {
        if (document.getElementById('forumMainView').style.display !== 'none') return 'main';
        if (document.getElementById('forumTrendView').style.display !== 'none') return 'trend';
        if (document.getElementById('forumNotifView').style.display !== 'none') return 'notif';
        if (document.getElementById('forumMsgView').style.display !== 'none') return 'msg';
        return 'unknown';
    }

    logoBtn.addEventListener('mousedown', startLogoPress);
    logoBtn.addEventListener('mouseup', endLogoPress);
    logoBtn.addEventListener('mouseleave', endLogoPress);
    logoBtn.addEventListener('touchstart', startLogoPress);
    logoBtn.addEventListener('touchend', endLogoPress);
    logoBtn.addEventListener('touchcancel', endLogoPress);

    // 底部导航
    document.querySelectorAll('.forum-bottom-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            window._forumHistoryStack = []; // 清空历史栈
            updateBottomNavActive(view);
            if (view === 'main') { switchForumView('forumMainView');
                renderPostList(); } else if (view === 'trend') { switchForumView('forumTrendView');
                renderTrendList(); } else if (view === 'notif') { switchForumView('forumNotifView');
                renderNotifList();
                document.getElementById('notifBadge').style.display = 'none'; } else if (view === 'msg') { 
                switchForumView('forumMsgView');
                renderMsgList(window._currentMsgTab === 'friends'); 
            }
        });
    });

    // Tab切换
    document.getElementById('forumTabBar').addEventListener('click', (e) => {
        if (e.target.classList.contains('forum-tab')) {
            document.querySelectorAll('#forumTabBar .forum-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderPostList(e.target.dataset.tab);
        }
    });

    // 私信Tab切换（新增）
    const msgTabBar = document.getElementById('forumMsgTabBar');
    if (msgTabBar) {
        msgTabBar.addEventListener('click', (e) => {
            if (e.target.classList.contains('forum-tab')) {
                document.querySelectorAll('#forumMsgTabBar .forum-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                const tab = e.target.dataset.msgTab;
                window._currentMsgTab = tab;
                renderMsgList(tab === 'friends');
            }
        });
    }

    // 个人主页标签切换
    document.getElementById('profileTabPosts')?.addEventListener('click', () => switchProfileTab('posts'));
    document.getElementById('profileTabLikes')?.addEventListener('click', () => switchProfileTab('likes'));

    // 发帖按钮
    document.getElementById('forumFabBtn').addEventListener('click', () => {
        document.getElementById('newPostTitle').value = '';
        document.getElementById('newPostContent').value = '';
        document.getElementById('newPostImageDesc').value = '';
        document.getElementById('newPostImagePreview').className = 'preview-thumb empty';
        document.getElementById('newPostImagePreview').textContent = '无图片';
        document.getElementById('newPostImagePreview').style.backgroundImage = '';
        window._newPostImageData = '';
        document.getElementById('newPostModal').classList.add('open');
    });

    // 论坛设置按钮
    document.getElementById('forumSettingsBtn').addEventListener('click', openForumSettings);

    // 发帖弹窗
    document.getElementById('newPostCancelBtn').addEventListener('click', () => document.getElementById('newPostModal').classList.remove('open'));
    document.getElementById('newPostSubmitBtn').addEventListener('click', async () => {
        const title = document.getElementById('newPostTitle').value.trim();
        const content = document.getElementById('newPostContent').value.trim();
        const imageDesc = document.getElementById('newPostImageDesc').value.trim();
        const imageData = window._newPostImageData || '';
        if (!content && !imageData && !imageDesc) { window.showStatus('请输入内容', 'error'); return; }
        document.getElementById('newPostModal').classList.remove('open');
        await submitNewPost(title, content, imageData, imageDesc);
    });

    // 发帖图片
    document.getElementById('newPostImageUploadBtn').addEventListener('click', () => document.getElementById('newPostImageFile').click());
    document.getElementById('newPostImageFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const dataUrl = await window.compressImage(file, 600, 600, 0.85);
            window._newPostImageData = dataUrl;
            const preview = document.getElementById('newPostImagePreview');
            preview.className = 'preview-thumb';
            preview.style.backgroundImage = `url('${dataUrl}')`;
            preview.textContent = '';
            e.target.value = '';
        }
    });
    document.getElementById('newPostImageUrlBtn').addEventListener('click', () => {
        const url = prompt('请输入图片URL:');
        if (url && url.trim()) {
            window._newPostImageData = url.trim();
            const preview = document.getElementById('newPostImagePreview');
            preview.className = 'preview-thumb';
            preview.style.backgroundImage = `url('${url.trim()}')`;
            preview.textContent = '';
        }
    });
    document.getElementById('newPostImageClearBtn').addEventListener('click', () => {
        window._newPostImageData = '';
        const preview = document.getElementById('newPostImagePreview');
        preview.className = 'preview-thumb empty';
        preview.style.backgroundImage = '';
        preview.textContent = '无图片';
    });

    // 详情返回
    document.getElementById('forumDetailBackBtn').addEventListener('click', async () => {
        document.getElementById('forumDetailCommentInput').style.display = 'flex';
        const prev = popForumHistory();
        await restoreForumHistory(prev);
    });
    document.getElementById('forumTrendSearchBackBtn').addEventListener('click', () => {
        document.getElementById('forumTrendSearchView').style.display = 'none';
        document.getElementById('forumTrendView').style.display = 'block';
        document.getElementById('forumBottomNav').style.display = 'flex';
        document.getElementById('forumFabBtn').style.display = 'block';
        updateBottomNavActive('trend');
    });
    document.getElementById('forumMsgConvBackBtn').addEventListener('click', async () => {
        document.getElementById('forumMsgConversationView').style.display = 'none';
        const prev = popForumHistory();
        if (prev) {
            await restoreForumHistory(prev);
        } else {
            document.getElementById('forumMsgView').style.display = 'block';
            document.getElementById('forumBottomNav').style.display = 'flex';
            document.getElementById('forumFabBtn').style.display = 'block';
            updateBottomNavActive('msg');
            renderMsgList(window._currentMsgTab === 'friends');
        }
    });

    // 评论发送
    document.getElementById('detailCommentSendBtn').addEventListener('click', async () => {
        const text = document.getElementById('detailCommentInput').value.trim();
        const postId = window._currentDetailPostId;
        if (!text || !postId) return;
        const replyToHandle = window._replyToHandle || '';
        document.getElementById('detailCommentInput').value = '';
        document.getElementById('detailCommentInput').placeholder = '发布你的回复...';
        window._replyToHandle = '';
        await submitComment(postId, text, replyToHandle);
    });

    // 私信
    document.getElementById('msgConvSendBtn').addEventListener('click', sendMessageWithAI);
    document.getElementById('msgConvInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault();
            sendMessageLocal(); }
    });
    document.getElementById('msgConvInput').addEventListener('input', (e) => {
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    });

    // 工具栏
    const toolbar = document.getElementById('msgToolbar');
    document.getElementById('msgToolbarToggleBtn').addEventListener('click', () => { if (toolbar) toolbar.classList.toggle('open'); });
    if (toolbar) {
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.msg-toolbar-btn');
            if (!btn) return;
            window._currentMsgType = btn.dataset.type;
            updateToolbarUI();
            toolbar.classList.remove('open');
        });
    }

    // 气泡交互
    const convContent = document.getElementById('forumMsgConversationContent');
    if (convContent) {
        let bubblePressTimer = null, bubbleIsLongPress = false, currentBubble = null;
        convContent.addEventListener('touchstart', (e) => {
            currentBubble = e.target.closest('.voice-bubble') || e.target.closest('.image-bubble') || e.target.closest('.msg-bubble');
            if (currentBubble) { bubbleIsLongPress = false;
                bubblePressTimer = setTimeout(() => { bubbleIsLongPress = true;
                    showBubbleContextMenu(currentBubble); }, 600); }
        }, { passive: true });
        convContent.addEventListener('touchend', () => { clearTimeout(bubblePressTimer); if (!bubbleIsLongPress && currentBubble) handleBubbleTap(currentBubble);
            currentBubble = null; });
        convContent.addEventListener('touchmove', () => { clearTimeout(bubblePressTimer);
            currentBubble = null; });
        convContent.addEventListener('contextmenu', (e) => { const bubble = e.target.closest('.msg-bubble'); if (bubble) { e.preventDefault();
                showBubbleContextMenu(bubble); } });
    }

    function handleBubbleTap(bubble) {
        if (bubble.classList.contains('voice-bubble')) showBubbleDetail('🎤 语音消息', bubble.dataset.bubbleContent || '');
        else if (bubble.classList.contains('image-bubble')) showBubbleDetail('🖼️ 图片说明', bubble.dataset.bubbleContent || '');
    }

    function showBubbleContextMenu(bubble) {
        const existing = document.querySelector('.msg-bubble-menu');
        if (existing) existing.remove();
        const menu = document.createElement('div');
        menu.className = 'msg-bubble-menu';
        menu.innerHTML = '<div class="msg-bubble-menu-item" data-action="edit">✏️ 编辑</div><div class="msg-bubble-menu-item danger" data-action="delete">🗑️ 删除</div>';
        const rect = bubble.getBoundingClientRect();
        menu.style.top = Math.min(rect.top, window.innerHeight - 120) + 'px';
        menu.style.left = Math.min(rect.left, window.innerWidth - 140) + 'px';
        (document.getElementById('page-forum') || document.body).appendChild(menu);
        menu.addEventListener('click', (me) => {
            const action = me.target.closest('.msg-bubble-menu-item')?.dataset.action;
            menu.remove();
            if (action === 'edit') openBubbleEdit(bubble.dataset.bubbleId || '', bubble.dataset.bubbleType || 'text', bubble.dataset.bubbleContent || '');
            else if (action === 'delete') deleteBubble(bubble.dataset.bubbleId || '');
        });
        setTimeout(() => { const closeMenu = (e) => { if (!menu.contains(e.target)) { menu.remove();
                document.removeEventListener('click', closeMenu); } };
            document.addEventListener('click', closeMenu); }, 100);
    }

    function openBubbleEdit(bubbleId, bubbleType, bubbleContent) {
        const existing = document.querySelector('.msg-edit-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.className = 'msg-edit-overlay';
        overlay.innerHTML = `<div class="msg-edit-card"><h3>✏️ 编辑消息</h3><textarea id="msgEditTextarea">${window.escapeHtml(bubbleContent)}</textarea><div class="btn-row"><button class="btn btn-ghost" id="msgEditCancelBtn">取消</button><button class="btn btn-primary" id="msgEditSaveBtn">保存</button></div></div>`;
        (document.getElementById('page-forum') || document.body).appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.id === 'msgEditCancelBtn') overlay.remove(); });
        document.getElementById('msgEditSaveBtn').addEventListener('click', async () => {
            const newContent = document.getElementById('msgEditTextarea').value.trim();
            if (!newContent) return;
            const fromName = window._currentConversationFrom;
            const data = await getForumData();
            let updated = false;
            for (const msg of (data.messages || [])) {
                if (msg.bubbles && Array.isArray(msg.bubbles)) {
                    for (let i = 0; i < msg.bubbles.length; i++) {
                        if (msg.id + '_' + i === bubbleId) {
                            msg.bubbles[i].content = newContent;
                            if (msg.bubbles[i].type === 'voice') msg.bubbles[i].transcript = newContent;
                            if (msg.bubbles[i].type === 'image') msg.bubbles[i].caption = newContent;
                            msg.content = msg.bubbles.filter(b => b.type === 'text').map(b => b.content).join('\n') || msg.bubbles[0]?.content || '';
                            updated = true; break;
                        }
                    }
                }
                if (updated) break;
            }
            if (updated) { await saveForumData(data);
                window._forumDataCache = data;
                overlay.remove();
                await openConversationDirect(fromName);
                window.showStatus('✅ 已编辑', 'success'); }
        });
        setTimeout(() => document.getElementById('msgEditTextarea').focus(), 200);
    }

    async function deleteBubble(bubbleId) {
        if (!confirm('确定删除这条消息吗？')) return;
        const fromName = window._currentConversationFrom;
        const data = await getForumData();
        let deleted = false;
        for (let j = 0; j < (data.messages || []).length; j++) {
            const msg = data.messages[j];
            if (msg.bubbles && Array.isArray(msg.bubbles)) {
                for (let i = 0; i < msg.bubbles.length; i++) {
                    if (msg.id + '_' + i === bubbleId) {
                        msg.bubbles.splice(i, 1);
                        if (msg.bubbles.length === 0) data.messages.splice(j, 1);
                        else msg.content = msg.bubbles.filter(b => b.type === 'text').map(b => b.content).join('\n') || msg.bubbles[0]?.content || '';
                        deleted = true; break;
                    }
                }
            }
            if (deleted) break;
        }
        if (deleted) { await saveForumData(data);
            window._forumDataCache = data;
            await openConversationDirect(fromName);
            window.showStatus('✅ 已删除', 'success'); }
    }

    // 个人主页
    document.getElementById('forumProfileBackBtn').addEventListener('click', async () => {
        const prev = popForumHistory();
        if (prev) {
            await restoreForumHistory(prev);
        } else {
            switchForumView('forumMainView');
            updateBottomNavActive('main');
        }
    });
    document.getElementById('profileEditBtn').addEventListener('click', () => {
    const acc = getCurrentAccount();
    openAccountEdit(acc?.id || null);
});
    document.getElementById('profileSwitchBtn').addEventListener('click', openAccountsList);

    // 账户列表
    document.getElementById('forumAccountsBackBtn').addEventListener('click', () => switchForumView('forumProfileView'));
    document.getElementById('forumAddAccountBtn').addEventListener('click', () => openAccountEdit(null));

    // 论坛设置
    document.getElementById('forumSettingsBackBtn').addEventListener('click', () => { switchForumView('forumMainView');
        updateBottomNavActive('main'); });
    document.getElementById('saveForumSettingsBtn').addEventListener('click', saveForumSettings);
    document.getElementById('savePresetBtn').addEventListener('click', async () => {
        const idx = document.getElementById('savePresetBtn').dataset.presetIndex;
        if (idx !== undefined) await updatePreset(parseInt(idx));
        else await saveCurrentAsPreset();
    });

    // 账户编辑弹窗
    document.getElementById('accountEditCancelBtn').addEventListener('click', () => document.getElementById('accountEditModal').classList.remove('open'));
    document.getElementById('accountEditSaveBtn').addEventListener('click', saveAccountEdit);

    // 账户头像
    document.getElementById('accountEditUploadBtn').addEventListener('click', () => document.getElementById('accountEditAvatarFile').click());
    document.getElementById('accountEditAvatarFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const dataUrl = await window.compressImage(file);
            document.getElementById('accountEditAvatarData').value = dataUrl;
            document.getElementById('accountEditAvatarPreview').style.backgroundImage = `url('${dataUrl}')`;
            document.getElementById('accountEditAvatarPreview').textContent = '';
            e.target.value = '';
        }
    });
    document.getElementById('accountEditUrlBtn').addEventListener('click', () => {
        const url = prompt('请输入头像URL:');
        if (url && url.trim()) {
            document.getElementById('accountEditAvatarData').value = url.trim();
            document.getElementById('accountEditAvatarPreview').style.backgroundImage = `url('${url.trim()}')`;
            document.getElementById('accountEditAvatarPreview').textContent = '';
        }
    });
}

// ==================== 初始化 ====================
async function initForum() {
    await ensureDefaultAccount();

    // 一次性迁移：给历史 messages/notifications 补 accountId
    const data = await getForumData();
    const currentAccId = data.currentAccountId;
    let needSave = false;
    if (currentAccId) {
        (data.messages || []).forEach(m => {
            if (!m.accountId) { m.accountId = currentAccId; needSave = true; }
        });
        (data.notifications || []).forEach(n => {
            if (!n.accountId) { n.accountId = currentAccId; needSave = true; }
        });
    }
    if (needSave) {
        await saveForumData(data);
        console.log('✅ 论坛数据已迁移：消息/通知按账户隔离');
    }

    if (!data.likedPosts) data.likedPosts = [];
    window._likedPosts = data.likedPosts;
    window._currentMsgTab = 'all';
    bindForumEvents();
    console.log('✅ 论坛模块初始化完成');
}
window.initForum = initForum;
window.forumGetData = getForumData;
window.forumSaveData = saveForumData;
