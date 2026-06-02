/* ========== Haloes SMS / Email (Gmail Layout) Module ========== */
(function() {
    "use strict";

    const SVGS = {
        menu: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
        compose: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
        back: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`,
        inbox: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5v-3h3.56c.69 0 1.34.39 1.66 1 .49.92 1.46 1.5 2.53 1.5s2.04-.58 2.53-1.5c.32-.61.97-1 1.66-1H19v3zm0-5h-4.18c-.49.92-1.46 1.5-2.53 1.5s-2.04-.58-2.53-1.5H5V5h14v9z"/></svg>`,
        sent: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
        feed: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M4 20h16v-2H4v2zm0-5h16v-2H4v2zm0-5h16V8H4v2zm0-6v2h16V4H4z"/></svg>`,
        trash: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
        user: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>`,
        star: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 46 4.73L5.82 21z"/></svg>`,
        reply: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>`,
        search: `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`
    };

    let activeAccount = null;
    let currentFolder = 'primary';
    let searchQuery = '';
    let refreshRunning = false;

    window.initSMSModule = function({ DB, showStatus, escapeHtml, callLLM, switchPage, getActiveMask }) {

        async function init() {
            await ensureDefaultAccount();
            await migrateLegacyData();
            await ensureBuiltinCharSubscriptions();
            await checkPeriodicalSubscriptions();
            renderInbox();
        }

        async function migrateLegacyData() {
            const threads = await DB.getAll('smsThreads');
            for (const t of threads) {
                let changed = false;
                if (!t.peerType) { t.peerType = t.isSubscription ? 'subscription' : 'conversation'; changed = true; }
                if (!t.peerDisplayName && t.subject) { t.peerDisplayName = t.subject; changed = true; }
                if (!t.peerAddress) {
                    if (t.disguised) t.peerAddress = `${t.peerKey || 'stranger'}@stranger.mail`;
                    else if (t.peerKey) t.peerAddress = `${t.peerKey}@haloes.mail`;
                    changed = true;
                }
                if (!t.replyContext) { t.replyContext = {}; changed = true; }
                if (!t.createdAt) { t.createdAt = Date.now(); changed = true; }
                if (changed) await DB.put('smsThreads', t);
            }

            const accts = await DB.getAll('smsAccounts');
            for (const a of accts) {
                if (a.avatar === undefined) {
                    a.avatar = '';
                    await DB.put('smsAccounts', a);
                }
            }
        }

        async function ensureDefaultAccount() {
            const mask = await getActiveMask();
            if (!mask) return;

            const accounts = await DB.getAll('smsAccounts');
            const hasDefault = accounts.some(a => a.maskId === mask.id && a.isDefault);

            if (!hasDefault) {
                await DB.put('smsAccounts', {
                    id: 'acct_def_' + mask.id,
                    maskId: mask.id,
                    name: mask.name,
                    address: pinyin(mask.name) + '@haloes.mail',
                    avatar: mask.avatar || '',
                    isDefault: true,
                    createdAt: Date.now()
                });
            }

            const savedActiveId = await DB.get('smsMeta', 'activeAccountId');
            const freshAccounts = await DB.getAll('smsAccounts');

            if (savedActiveId && freshAccounts.some(a => a.id === savedActiveId.value)) {
                activeAccount = await DB.get('smsAccounts', savedActiveId.value);
            } else {
                const maskAccounts = await DB.queryByIndex('smsAccounts', 'maskId', mask.id);
                activeAccount = maskAccounts.find(a => a.isDefault) || maskAccounts[0];
                if (activeAccount) {
                    await DB.put('smsMeta', { key: 'activeAccountId', value: activeAccount.id });
                }
            }

            if (activeAccount && activeAccount.isDefault && mask.avatar !== undefined) {
                const defaultAcct = await DB.get('smsAccounts', activeAccount.id);
                if (defaultAcct) {
                    defaultAcct.name = mask.name || defaultAcct.name;
                    defaultAcct.avatar = mask.avatar || '';
                    await DB.put('smsAccounts', defaultAcct);
                    activeAccount = defaultAcct;
                }
            }
        }

        async function renderInbox() {
            const shell = document.getElementById('smsShell');
            if (!shell) return;

            shell.innerHTML = `
                <div class="sms-search-bar" id="smsSearchBarRoot" style="margin:8px 10px; padding:0 6px; display:flex; align-items:center; gap:8px;">
                    <button class="sms-menu-btn" id="smsMenuBtn" style="flex-shrink:0; padding:6px; display:flex; align-items:center; justify-content:center; background:none; border:none; color:#5f6368; cursor:pointer;">${SVGS.menu}</button>

                    <div style="flex:1; display:flex; align-items:center; background:#f1f3f4; border-radius:22px; min-width:0; padding:2px 10px; gap:6px;">
                        ${SVGS.search}
                        <input type="text" class="sms-search-input" id="smsSearchInput" placeholder="在邮件中搜索" value="${escapeHtml(searchQuery)}" style="padding-left:4px; font-size:14px; border:none; background:transparent; outline:none; flex:1; min-width:0; height:32px; color:#202124;">
                    </div>

                    <button class="sms-menu-btn" id="smsRefreshBtn" title="收取邮件" style="flex-shrink:0; padding:4px; width:36px; height:36px; display:flex; align-items:center; justify-content:center; background:none; border:none; color:#5f6368; cursor:pointer; border-radius:50%;">${SVGS.refresh}</button>

                    <div class="sms-profile-badge" id="smsProfileBadge" style="flex-shrink:0; cursor:pointer; ${activeAccount?.avatar ? `background-image:url('${activeAccount.avatar}');background-size:cover;background-position:center;` : ''}">
                        ${activeAccount?.avatar ? '' : escapeHtml(activeAccount?.name?.charAt(0) || 'U')}
                    </div>
                </div>

                <div class="sms-folder-tabs">
                    <div class="sms-folder-tab ${currentFolder === 'primary' ? 'active' : ''}" data-folder="primary">${SVGS.inbox} <span>主要信箱</span></div>
                    <div class="sms-folder-tab ${currentFolder === 'sent' ? 'active' : ''}" data-folder="sent">${SVGS.sent} <span>已发送</span></div>
                    <div class="sms-folder-tab ${currentFolder === 'subs' ? 'active' : ''}" data-folder="subs">${SVGS.feed} <span>订阅号</span></div>
                </div>

                <div class="sms-mail-list" id="smsMailList"><div style="text-align:center; padding:40px; color:#5f6368;">邮件加载中...</div></div>

                <button class="sms-compose-fab" id="smsComposeFab">${SVGS.compose} <span>撰写</span></button>

                <div class="sms-drawer-overlay" id="smsDrawerOverlay">
                    <div class="sms-drawer">
                        <div class="sms-drawer-header">
                            <div class="sms-drawer-title">Haloes Mail</div>
                            <div class="sms-account-selector-box">
                                <div class="sms-sender-avatar" style="${activeAccount?.avatar ? `background-image:url('${activeAccount.avatar}');background-size:cover;background-position:center;` : ''} width:32px; height:32px; font-size:12px; margin-right:8px;">
                                    ${activeAccount?.avatar ? '' : escapeHtml(activeAccount?.name?.charAt(0) || 'U')}
                                </div>
                                <div style="flex:1; min-width:0;">
                                    <div style="font-size:13px; font-weight:500; color:#202124; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(activeAccount?.name || '')}</div>
                                    <div style="font-size:11px; color:#5f6368; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(activeAccount?.address || '')}</div>
                                </div>
                            </div>
                        </div>
                        <div class="sms-drawer-menu">
                            <div class="sms-drawer-item ${currentFolder==='primary'?'active':''}" data-action="folder" data-val="primary">${SVGS.inbox} 主要</div>
                            <div class="sms-drawer-item ${currentFolder==='sent'?'active':''}" data-action="folder" data-val="sent">${SVGS.sent} 已发送</div>
                            <div class="sms-drawer-item ${currentFolder==='subs'?'active':''}" data-action="folder" data-val="subs">${SVGS.feed} 订阅号</div>
                            <hr style="border:none; border-top:1px solid #dadce0; margin:8px 0;">
                            <div class="sms-drawer-item" data-action="alias-mgr">${SVGS.user} 小号管理</div>
                            <div class="sms-drawer-item" data-action="sub-mgr">${SVGS.feed} 订阅管理</div>
                            <hr style="border:none; border-top:1px solid #dadce0; margin:8px 0;">
                            <div class="sms-drawer-item" data-action="exit">${SVGS.back} 返回桌面</div>
                        </div>
                    </div>
                </div>

                <div class="sms-modal-overlay" id="smsRefreshSelectorOverlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:10000; align-items:center; justify-content:center;">
                    <div class="sms-modal-content" style="background:#fff; border-radius:16px; padding:20px; width:90%; max-width:380px; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 4px 20px rgba(0,0,0,0.15);">
                        <div style="margin-bottom:12px;">
                            <h3 style="font-size:18px; color:#202124; margin:0;">选择来信来源</h3>
                            <div style="font-size:12px; color:#5f6368; margin-top:4px;">勾选角色=各1封；勾选陌生人=额外1~2封。</div>
                        </div>
                        <div id="smsRefreshSelectorList" style="flex:1; overflow-y:auto; margin-bottom:12px; padding-right:4px;"></div>
                        <div style="padding-top:12px; border-top:1px solid #dadce0;">
                            <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#3c4043; margin-bottom:12px; cursor:pointer; user-select:none;">
                                <input type="checkbox" id="smsRefreshMixStranger" style="width:16px; height:16px; accent-color:#1a73e8;"> 混入陌生人来信
                            </label>
                            <div style="display:flex; gap:8px; justify-content:flex-end;">
                                <button class="sms-btn-sm" id="smsRefreshSelectorCancelBtn" style="padding:6px 12px; border:1px solid #dadce0; background:#fff; border-radius:18px; cursor:pointer; font-size:13px;">取消</button>
                                <button class="sms-btn-sm primary" id="smsRefreshSelectorConfirmBtn" style="padding:6px 12px; background:#1a73e8; color:#fff; border:none; border-radius:18px; cursor:pointer; font-size:13px; font-weight:500;">生成来信</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            await loadMailList();

            document.getElementById('smsMenuBtn').addEventListener('click', toggleDrawer);
            document.getElementById('smsDrawerOverlay').addEventListener('click', function(e) {
                if (e.target === this) toggleDrawer();
            });

            document.getElementById('smsRefreshBtn').addEventListener('click', async () => {
                if (!refreshRunning) await openRefreshSelector();
            });

            document.getElementById('smsSearchInput').addEventListener('input', function(e) {
                searchQuery = e.target.value.toLowerCase().trim();
                loadMailList();
            });

            document.getElementById('smsProfileBadge').addEventListener('click', openAliasManager);
            document.getElementById('smsComposeFab').addEventListener('click', () => openCompose());

            document.querySelectorAll('.sms-folder-tab').forEach(tab => {
                tab.addEventListener('click', function() {
                    currentFolder = this.dataset.folder;
                    renderInbox();
                });
            });

            document.querySelectorAll('.sms-drawer-item').forEach(item => {
                item.addEventListener('click', async function() {
                    const action = this.dataset.action;
                    if (action === 'folder') {
                        currentFolder = this.dataset.val;
                        toggleDrawer();
                        renderInbox();
                    } else if (action === 'alias-mgr') {
                        toggleDrawer();
                        openAliasManager();
                    } else if (action === 'sub-mgr') {
                        toggleDrawer();
                        openSubscriptionManager();
                    } else if (action === 'exit') {
                        switchPage('desktop');
                    }
                });
            });
        }

        function toggleDrawer() {
            const overlay = document.getElementById('smsDrawerOverlay');
            if (overlay) overlay.classList.toggle('active');
        }

        async function loadMailList() {
            const listEl = document.getElementById('smsMailList');
            if (!listEl) return;
            if (!activeAccount) {
                listEl.innerHTML = `<div style="text-align:center; padding:40px; color:#5f6368;">暂无可用邮箱。</div>`;
                return;
            }

            const threads = await DB.queryByIndex('smsThreads', 'accountId', activeAccount.id);
            let displayThreads = [];

            if (currentFolder === 'subs') displayThreads = threads.filter(t => t.isSubscription);
            else displayThreads = threads.filter(t => !t.isSubscription);

            const enriched = [];
            for (const t of displayThreads) {
                const msgs = await DB.queryByIndex('smsMessages', 'threadId', t.id);
                msgs.sort((a,b) => b.timestamp - a.timestamp);
                if (!msgs.length) continue;

                if (currentFolder === 'sent') {
                    const mine = msgs.filter(m => !m.isReceived && m.senderAddress === activeAccount.address);
                    if (!mine.length) continue;
                    enriched.push({ thread: t, preview: msgs[0], sortTs: msgs[0].timestamp });
                } else {
                    enriched.push({ thread: t, preview: msgs[0], sortTs: msgs[0].timestamp });
                }
            }

            enriched.sort((a,b) => b.sortTs - a.sortTs);

            let filtered = enriched;
            if (searchQuery) {
                filtered = enriched.filter(x => {
                    const subj = (x.thread.subject || '').toLowerCase();
                    const body = (x.preview.body || '').toLowerCase();
                    const sender = (x.preview.senderName || '').toLowerCase();
                    return subj.includes(searchQuery) || body.includes(searchQuery) || sender.includes(searchQuery);
                });
            }

            if (!filtered.length) {
                const emptyMsg = currentFolder === 'sent' ? '没有已发送的邮件。' : '没有邮件。';
                listEl.innerHTML = `<div style="text-align:center; padding:40px; color:#5f6368; font-size:14px;">${emptyMsg}</div>`;
                return;
            }

            let html = '';
            for (const et of filtered) {
                const t = et.thread;
                const m = et.preview;
                const isUnread = t.unread && m.isReceived;
                const dateStr = formatCompactTime(m.timestamp);
                const initial = (m.senderName || '?').charAt(0);
                const peerAvatar = t.peerAvatar || '';
                const avatarStyle = peerAvatar
                    ? `background-image:url('${peerAvatar}');background-size:cover;background-position:center;`
                    : `background-color:${getAvatarColor(m.senderName)};`;
                const strangerBadge = (t.peerType === 'stranger' || t.peerType === 'npc')
                    ? `<span class="sms-mail-badge-disguise">陌生人</span>` : '';
                html += `
    <div class="sms-mail-item ${isUnread ? 'unread' : ''}" data-thread-id="${t.id}">
        <div class="sms-sender-avatar" style="${avatarStyle}">${peerAvatar ? '' : escapeHtml(initial)}</div>
        <div class="sms-mail-content">
            <div class="sms-mail-meta">
                <span class="sms-mail-sender">${escapeHtml(m.senderName || t.peerDisplayName || '未知')} ${strangerBadge}</span>
                <span class="sms-mail-time">${dateStr}</span>
            </div>
                            <div class="sms-mail-subject">${escapeHtml(t.subject || '无主题')}</div>
                            <div class="sms-mail-snippet">${escapeHtml((m.body || '').substring(0, 45))}</div>
                        </div>
                    </div>
                `;
            }

            listEl.innerHTML = html;
            listEl.querySelectorAll('.sms-mail-item').forEach(el => {
                el.addEventListener('click', () => openThreadDetail(el.dataset.threadId));
            });
        }

        async function openThreadDetail(threadId) {
            const thread = await DB.get('smsThreads', threadId);
            if (!thread || !activeAccount || thread.accountId !== activeAccount.id) return;

            thread.unread = false;
            await DB.put('smsThreads', thread);

            const shell = document.getElementById('smsShell');
            if (!shell) return;

            const msgs = await DB.queryByIndex('smsMessages', 'threadId', thread.id);
            msgs.sort((a,b) => a.timestamp - b.timestamp);

            let cards = '';
            msgs.forEach((m, idx) => {
                const isLast = idx === msgs.length - 1;
                const dt = new Date(m.timestamp).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
                const initial = (m.senderName || '?').charAt(0);
                const msgAvatar = m.isReceived ? (thread.peerAvatar || '') : (activeAccount?.avatar || '');
                const avatarStyle = msgAvatar
                    ? `background-image:url('${msgAvatar}');background-size:cover;background-position:center;`
                    : `background-color:${getAvatarColor(m.senderName)};`;
                cards += `
                    <div class="sms-message-card ${!isLast ? 'collapsed' : ''}" data-msg-idx="${idx}">
                        <div class="sms-message-card-header">
                            <div class="sms-sender-avatar" style="${avatarStyle} width:32px; height:32px; font-size:14px; margin-right:12px;">${msgAvatar ? '' : escapeHtml(initial)}</div>
                            <div class="sms-message-card-sender-info">
                                <span class="sms-message-card-sender-name">${escapeHtml(m.senderName || '')}</span>
                                <span class="sms-message-card-sender-addr">&lt;${escapeHtml(m.senderAddress || '')}&gt;</span>
                            </div>
                            <span class="sms-message-card-time">${dt}</span>
                        </div>
                        <div class="sms-message-card-body">${escapeHtml(m.body || '')}</div>
                    </div>
                `;
            });

            shell.innerHTML = `
                <div class="sms-detail-view">
                    <div class="sms-detail-header">
                        <button class="sms-menu-btn" id="smsDetailBackBtn">${SVGS.back}</button>
                        <h2 style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; margin: 0 8px;">${escapeHtml(thread.subject || '无主题')}</h2>
                        ${!thread.isSubscription ? `<button class="sms-menu-btn" id="smsDetailReplyBtn" title="回复">${SVGS.reply}</button>` : ``}
                        <button class="sms-menu-btn" id="smsDetailDeleteBtn">${SVGS.trash}</button>
                    </div>
                    <div class="sms-detail-body">
                        <div class="sms-thread-subject">${escapeHtml(thread.subject || '无主题')}</div>
                        ${cards}
                    </div>
                </div>
            `;

            document.getElementById('smsDetailBackBtn').addEventListener('click', renderInbox);

            const replyBtn = document.getElementById('smsDetailReplyBtn');
            if (replyBtn) {
                replyBtn.addEventListener('click', async () => openCompose({ mode:'reply', threadId:thread.id }));
            }

            document.getElementById('smsDetailDeleteBtn').addEventListener('click', async () => {
                if (!confirm('确定永久删除此邮件往来对话吗？')) return;
                const messages = await DB.queryByIndex('smsMessages', 'threadId', thread.id);
                for (const m of messages) await DB.delete('smsMessages', m.id);
                await DB.delete('smsThreads', thread.id);
                showStatus('邮件已删除', 'info');
                renderInbox();
            });

            shell.querySelectorAll('.sms-message-card').forEach(card => {
                card.querySelector('.sms-message-card-header').addEventListener('click', () => card.classList.toggle('collapsed'));
            });
        }

        async function openCompose(opts = {}) {
            const shell = document.getElementById('smsShell');
            if (!shell) return;

            const mode = opts.mode || 'new';
            const replyThread = mode === 'reply' ? await DB.get('smsThreads', opts.threadId) : null;

            const mask = await getActiveMask();
            const accounts = await DB.getAll('smsAccounts');
            const fromAccounts = accounts.filter(a => a.maskId === (mask?.id || activeAccount?.maskId));

            if (activeAccount && activeAccount.isDefault && mask) {
                activeAccount.avatar = mask.avatar || '';
                activeAccount.name = mask.name || activeAccount.name;
                await DB.put('smsAccounts', activeAccount);
            }

            const convs = await DB.getAll('conversations');
            const convDetails = await DB.getAll('convDetails');
            const convMap = {};
            convDetails.forEach(cd => convMap[cd.conversationId] = cd);

            let toItems = [];
            for (const c of convs) {
                if (c.maskId !== (mask?.id || c.maskId)) continue;
                const ch = await DB.get('characters', c.charId);
                if (!ch) continue;
                const cd = convMap[c.id] || {};
                const displayName = cd.charName || ch?.name || `会话${c.id}`;
                const avatar = cd.charAvatar || ch?.avatar || '';
                const addr = `conv_${c.id}@haloes.mail`;
                toItems.push({
                    val: `conv:${c.id}`,
                    avatar,
                    displayName,
                    convId: c.id,
                    charId: ch.id,
                    peerAddress: addr
                });
            }

            const existingThreads = await DB.queryByIndex('smsThreads', 'accountId', activeAccount.id);
            const contactedStrangers = [];
            const seenAddrs = new Set();
            for (const t of existingThreads) {
                if (t.peerType === 'stranger' || t.peerType === 'npc') {
                    if (!t.peerAddress || seenAddrs.has(t.peerAddress)) continue;
                    seenAddrs.add(t.peerAddress);
                    contactedStrangers.push(t);
                }
            }

            const recipientItems = [];

toItems.forEach(i => {
    recipientItems.push({
        val: i.val,
        type: 'conversation',
        avatar: i.avatar || '',
        name: i.displayName,
        subtitle: `会话#${i.convId}`,
        peerAddress: i.peerAddress || ''
    });
});

contactedStrangers.forEach(s => {
    recipientItems.push({
        val: `stranger:${s.peerAddress}`,
        type: 'stranger',
        avatar: s.peerAvatar || '',
        name: s.peerDisplayName || '陌生人',
        subtitle: s.peerAddress || '',
        peerAddress: s.peerAddress || ''
    });
});

recipientItems.push({
    val: 'random',
    type: 'random',
    avatar: '',
    name: '随机漂流瓶',
    subtitle: '未知陌生人邮件',
    peerAddress: ''
});

recipientItems.push({
    val: 'custom',
    type: 'custom',
    avatar: '',
    name: '自定义地址',
    subtitle: '手动输入邮箱地址',
    peerAddress: ''
});

            const fromOptions = fromAccounts.map(a => {
                const isActive = a.id === activeAccount?.id;
                return `<option value="${a.id}" ${isActive ? 'selected' : ''}>${escapeHtml(a.name)} &lt;${escapeHtml(a.address)}&gt;${a.isDefault ? ' [主号]' : ''}</option>`;
            }).join('');

            let presetSubject = '';
            let presetToVal = '';
            let presetToCustom = '';
            let presetBody = '';
            let presetFromId = activeAccount?.id || '';

            if (replyThread) {
                presetSubject = replyThread.subject ? (replyThread.subject.startsWith('Re:') ? replyThread.subject : 'Re: ' + replyThread.subject) : 'Re: 无主题';
                if (replyThread.sourceConversationId) {
                    presetToVal = `conv:${replyThread.sourceConversationId}`;
                } else if (replyThread.peerType === 'stranger' || replyThread.peerType === 'npc') {
                    presetToVal = 'custom';
                    presetToCustom = replyThread.peerAddress || `${replyThread.peerKey || 'stranger'}@stranger.mail`;
                } else {
                    presetToVal = 'custom';
                    presetToCustom = replyThread.peerAddress || '';
                }
            }

            shell.innerHTML = `
                <div class="sms-compose-view">
                    <div class="sms-detail-header">
                        <button class="sms-menu-btn" id="smsComposeBackBtn">${SVGS.back}</button>
                        <h2>${replyThread ? '回复邮件' : '撰写新邮件'}</h2>
                        <button class="sms-menu-btn" id="smsComposeSendBtn" style="color:#1a73e8;">${SVGS.sent}</button>
                    </div>
                    <div class="sms-compose-fields">
                        <div class="sms-compose-row">
                            <span class="sms-compose-label">从：</span>
                            <select class="sms-compose-select" id="smsComposeFrom">${fromOptions}</select>
                        </div>
                        <div class="sms-compose-row">
    <span class="sms-compose-label">到：</span>
    <input type="hidden" id="smsComposeTo" value="">
    <button type="button" id="smsComposeToPickerBtn" style="
        flex:1;
        display:flex;
        align-items:center;
        gap:10px;
        min-width:0;
        border:none;
        background:transparent;
        padding:8px 0;
        cursor:pointer;
        text-align:left;
    ">
        <div id="smsComposeToAvatar" class="sms-sender-avatar" style="
            width:32px;
            height:32px;
            font-size:13px;
            margin-right:0;
            flex-shrink:0;
        ">?</div>
        <div style="flex:1; min-width:0;">
            <div id="smsComposeToName" style="
                font-size:14px;
                color:#202124;
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
            ">选择收件人</div>
            <div id="smsComposeToSub" style="
                font-size:11px;
                color:#5f6368;
                overflow:hidden;
                text-overflow:ellipsis;
                white-space:nowrap;
            "></div>
        </div>
        <span style="font-size:18px;color:#5f6368;">›</span>
    </button>
</div>
                        <div class="sms-compose-row" id="smsComposeToCustomRow" style="display:none;">
                            <span class="sms-compose-label">地址：</span>
                            <input type="text" class="sms-compose-input" id="smsComposeToCustom" placeholder="name@example.com" value="${escapeHtml(presetToCustom)}">
                        </div>
                        <div class="sms-compose-row">
                            <span class="sms-compose-label">主题：</span>
                            <input type="text" class="sms-compose-input" id="smsComposeSubject" maxlength="150" value="${escapeHtml(presetSubject)}">
                        </div>
                        <textarea class="sms-compose-body" id="smsComposeBody" placeholder="撰写电子邮件内容..." maxlength="10000">${escapeHtml(presetBody)}</textarea>
                    </div>
                </div>

                <div class="sms-modal-overlay" id="smsRecipientPickerOverlay" style="
                    display:none;
                    position:fixed;
                    top:0;
                    left:0;
                    right:0;
                    bottom:0;
                    background:rgba(0,0,0,0.45);
                    z-index:10000;
                    align-items:center;
                    justify-content:center;
                ">
                    <div class="sms-modal-content" style="
                        background:#fff;
                        border-radius:18px;
                        width:90%;
                        max-width:390px;
                        max-height:78vh;
                        display:flex;
                        flex-direction:column;
                        overflow:hidden;
                        box-shadow:0 8px 30px rgba(0,0,0,0.18);
                    ">
                        <div style="
                            padding:16px 18px;
                            border-bottom:1px solid #f1f3f4;
                            display:flex;
                            align-items:center;
                            justify-content:space-between;
                        ">
                            <div>
                                <div style="font-size:17px;font-weight:600;color:#202124;">选择收件人</div>
                                <div style="font-size:12px;color:#5f6368;margin-top:2px;">联系人、陌生人、漂流瓶或自定义地址</div>
                            </div>
                            <button id="smsRecipientPickerCloseBtn" style="
                                border:none;
                                background:transparent;
                                font-size:22px;
                                color:#5f6368;
                                cursor:pointer;
                            ">×</button>
                        </div>

                        <div id="smsRecipientPickerList" style="
                            flex:1;
                            overflow-y:auto;
                            padding:6px 0;
                        "></div>
                    </div>
                </div>
            `;

            const fromSel = document.getElementById('smsComposeFrom');
const toSel = document.getElementById('smsComposeTo'); // hidden input
const toPickerBtn = document.getElementById('smsComposeToPickerBtn');
const toAvatarEl = document.getElementById('smsComposeToAvatar');
const toNameEl = document.getElementById('smsComposeToName');
const toSubEl = document.getElementById('smsComposeToSub');
const toCustomRow = document.getElementById('smsComposeToCustomRow');
const toCustomInput = document.getElementById('smsComposeToCustom');

const recipientOverlay = document.getElementById('smsRecipientPickerOverlay');
const recipientListEl = document.getElementById('smsRecipientPickerList');
const recipientCloseBtn = document.getElementById('smsRecipientPickerCloseBtn');
            function getRecipientItem(val) {
    return recipientItems.find(i => i.val === val) || recipientItems[0] || null;
}

function refreshRecipientDisplay() {
    const item = getRecipientItem(toSel.value);

    if (!item) {
        toNameEl.textContent = '选择收件人';
        toSubEl.textContent = '';
        toAvatarEl.style.backgroundImage = '';
        toAvatarEl.style.backgroundColor = '#5f6368';
        toAvatarEl.textContent = '?';
        toCustomRow.style.display = 'none';
        return;
    }

    toNameEl.textContent = item.name || '未知收件人';
    toSubEl.textContent = item.subtitle || item.peerAddress || '';

    if (item.avatar) {
        toAvatarEl.style.backgroundImage = `url('${item.avatar}')`;
        toAvatarEl.style.backgroundSize = 'cover';
        toAvatarEl.style.backgroundPosition = 'center';
        toAvatarEl.style.backgroundColor = 'transparent';
        toAvatarEl.textContent = '';
    } else {
        toAvatarEl.style.backgroundImage = '';
        toAvatarEl.style.backgroundColor =
            item.type === 'random' ? '#9334e6' :
            item.type === 'custom' ? '#5f6368' :
            item.type === 'stranger' ? '#d93025' :
            getAvatarColor(item.name || '?');

        toAvatarEl.textContent =
            item.type === 'custom' ? '@' :
            item.type === 'random' ? '漂' :
            (item.name || '?').charAt(0);
    }

    toCustomRow.style.display = item.val === 'custom' ? 'flex' : 'none';
}

function renderRecipientPickerList() {
    recipientListEl.innerHTML = recipientItems.map(item => {
        const avatarStyle = item.avatar
            ? `background-image:url('${item.avatar}');background-size:cover;background-position:center;`
            : `background-color:${
                item.type === 'random' ? '#9334e6' :
                item.type === 'custom' ? '#5f6368' :
                item.type === 'stranger' ? '#d93025' :
                getAvatarColor(item.name || '?')
            };`;

        const avatarText = item.avatar
            ? ''
            : item.type === 'custom'
                ? '@'
                : item.type === 'random'
                    ? '漂'
                    : (item.name || '?').charAt(0);

        const badge =
            item.type === 'conversation'
                ? '<span style="font-size:11px;color:#1a73e8;background:#e8f0fe;padding:2px 6px;border-radius:10px;">联系人</span>'
                : item.type === 'stranger'
                    ? '<span style="font-size:11px;color:#d93025;background:#fce8e6;padding:2px 6px;border-radius:10px;">陌生人</span>'
                    : item.type === 'random'
                        ? '<span style="font-size:11px;color:#9334e6;background:#f3e8fd;padding:2px 6px;border-radius:10px;">漂流瓶</span>'
                        : '<span style="font-size:11px;color:#5f6368;background:#f1f3f4;padding:2px 6px;border-radius:10px;">自定义</span>';

        const activeStyle = item.val === toSel.value
            ? 'background:#e8f0fe;'
            : 'background:#fff;';

        return `
            <div class="sms-recipient-card" data-val="${escapeHtml(item.val)}" style="
                display:flex;
                align-items:center;
                gap:12px;
                padding:12px 16px;
                cursor:pointer;
                border-bottom:1px solid #f1f3f4;
                ${activeStyle}
            ">
                <div class="sms-sender-avatar" style="
                    ${avatarStyle}
                    width:38px;
                    height:38px;
                    font-size:14px;
                    margin-right:0;
                    flex-shrink:0;
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    color:#fff;
                    font-weight:600;
                ">${escapeHtml(avatarText)}</div>

                <div style="flex:1;min-width:0;">
                    <div style="
                        display:flex;
                        align-items:center;
                        gap:6px;
                        min-width:0;
                    ">
                        <span style="
                            font-size:14px;
                            font-weight:500;
                            color:#202124;
                            overflow:hidden;
                            text-overflow:ellipsis;
                            white-space:nowrap;
                        ">${escapeHtml(item.name || '未知收件人')}</span>
                        ${badge}
                    </div>
                    <div style="
                        font-size:12px;
                        color:#5f6368;
                        margin-top:3px;
                        overflow:hidden;
                        text-overflow:ellipsis;
                        white-space:nowrap;
                    ">${escapeHtml(item.subtitle || item.peerAddress || '')}</div>
                </div>
            </div>
        `;
    }).join('');

    recipientListEl.querySelectorAll('.sms-recipient-card').forEach(card => {
        card.addEventListener('click', () => {
            toSel.value = card.dataset.val;
            refreshRecipientDisplay();
            recipientOverlay.style.display = 'none';
        });
    });
}

function openRecipientPicker() {
    renderRecipientPickerList();
    recipientOverlay.style.display = 'flex';
}

function closeRecipientPicker() {
    recipientOverlay.style.display = 'none';
}

if (presetFromId) {
    fromSel.value = presetFromId;
}

if (presetToVal) {
    toSel.value = presetToVal;
} else if (recipientItems.length) {
    toSel.value = recipientItems[0].val;
} else {
    toSel.value = 'custom';
}

refreshRecipientDisplay();

toPickerBtn.addEventListener('click', openRecipientPicker);

recipientCloseBtn.addEventListener('click', closeRecipientPicker);

recipientOverlay.addEventListener('click', function(e) {
    if (e.target === recipientOverlay) {
        closeRecipientPicker();
    }
});

document.getElementById('smsComposeBackBtn').addEventListener('click', () => {
                if (replyThread) openThreadDetail(replyThread.id);
                else renderInbox();
            });

            document.getElementById('smsComposeSendBtn').addEventListener('click', async function() {
                const fromId = fromSel.value;
                const toVal = toSel.value;
                const toCustom = toCustomInput.value.trim();
                const subject = document.getElementById('smsComposeSubject').value.trim() || '无主题';
                const body = document.getElementById('smsComposeBody').value.trim();

                if (!body) { alert('邮件内容不能为空'); return; }

                this.disabled = true;
                this.innerHTML = '正在发送...';

                activeAccount = await DB.get('smsAccounts', fromId);
                await DB.put('smsMeta', { key:'activeAccountId', value:fromId });

                const curMask = await getActiveMask();
                if (activeAccount?.isDefault && curMask) {
                    activeAccount.avatar = curMask.avatar || '';
                    activeAccount.name = curMask.name || activeAccount.name;
                    await DB.put('smsAccounts', activeAccount);
                }

                if (replyThread) {
                    await handleReplyMail(replyThread, body);
                    await openThreadDetail(replyThread.id);
                    return;
                }

                let peerType = 'conversation';
                let peerKey = '';
                let peerAddress = '';
                let peerDisplayName = '';
                let peerAvatar = '';
                let sourceConversationId = null;
                let disguised = false;
                let disguisedCharId = '';
                let replyContextData = {};

                if (toVal === 'random') {
                    peerType = 'stranger';
                    disguised = true;
                    peerKey = 'stranger_' + Math.random().toString(36).slice(2, 8);
                    peerAddress = `${peerKey}@stranger.mail`;
                    peerDisplayName = randomStrangerName();
                    peerAvatar = '';
                    replyContextData = {
                        charId: '',
                        conversationId: null,
                        charName: peerDisplayName,
                        charDetail: '完全陌生的来信者',
                        userName: curMask?.name || '用户'
                    };
                } else if (toVal === 'custom') {
                    if (!toCustom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toCustom)) {
                        alert('请填写有效邮箱地址');
                        this.disabled = false;
                        this.innerHTML = SVGS.sent;
                        return;
                    }
                    peerType = 'stranger';
                    disguised = false;
                    peerAddress = toCustom;
                    peerKey = toCustom.split('@')[0];
                    peerDisplayName = peerKey || '神秘人';
                } else if (toVal.startsWith('stranger:')) {
                    const targetAddr = toVal.split(':')[1];
                    const matchedThread = contactedStrangers.find(s => s.peerAddress === targetAddr);
                    peerType = 'stranger';
                    peerAddress = targetAddr;
                    peerKey = targetAddr.split('@')[0];
                    peerDisplayName = matchedThread ? matchedThread.peerDisplayName : (peerKey || '神秘人');
                    peerAvatar = matchedThread ? (matchedThread.peerAvatar || '') : '';
                    disguised = matchedThread ? !!matchedThread.disguised : false;
                    disguisedCharId = matchedThread ? (matchedThread.disguisedCharId || '') : '';
                    sourceConversationId = matchedThread ? matchedThread.sourceConversationId : null;
                    replyContextData = matchedThread ? (matchedThread.replyContext || {}) : {
                        charId: disguisedCharId,
                        charName: peerDisplayName,
                        charDetail: '过往联系的陌生人',
                        userName: curMask?.name || '用户'
                    };
                } else if (toVal.startsWith('conv:')) {
                    const convId = parseInt(toVal.split(':')[1]);
                    sourceConversationId = convId;
                    const conv = await DB.get('conversations', convId);
                    const ch = conv ? await DB.get('characters', conv.charId) : null;
                    const cd = await DB.get('convDetails', convId);
                    peerKey = ch?.id || `conv_${convId}`;
                    peerAddress = `conv_${convId}@haloes.mail`;
                    peerDisplayName = cd?.charName || ch?.name || `会话${convId}`;
                    peerAvatar = cd?.charAvatar || ch?.avatar || '';
                    disguised = false;
                    disguisedCharId = ch?.id || '';
                    peerType = 'conversation';
                    replyContextData = {
                        charId: ch?.id || '',
                        conversationId: convId,
                        charName: peerDisplayName,
                        charDetail: cd?.charDetail || ch?.detail || '',
                        userName: cd?.userName || curMask?.name || '用户',
                        userDetail: cd?.userDetail || curMask?.bio || '',
                        relationship: cd?.relationship || '',
                        convMode: conv?.mode || 'online'
                    };
                }

                const thread = {
                    id: 'thread_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    maskId: activeAccount.maskId,
                    accountId: activeAccount.id,
                    sourceConversationId,
                    peerType,
                    peerKey,
                    peerAddress,
                    peerDisplayName,
                    peerAvatar,
                    subject,
                    isSubscription: false,
                    disguised,
                    disguisedCharId,
                    unread: false,
                    createdAt: Date.now(),
                    accountAvatarSnapshot: activeAccount.avatar || '',
                    accountNameSnapshot: activeAccount.name || '',
                    replyContext: replyContextData
                };

                await DB.put('smsThreads', thread);
                await handleReplyMail(thread, body);
                renderInbox();
            });
        }

        async function handleReplyMail(thread, text) {
            const userMsg = {
                id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                threadId: thread.id,
                senderName: activeAccount.name,
                senderAddress: activeAccount.address,
                body: text,
                timestamp: Date.now(),
                isReceived: false
            };
            await DB.put('smsMessages', userMsg);

            try {
                const msgs = await DB.queryByIndex('smsMessages', 'threadId', thread.id);
                msgs.sort((a,b) => a.timestamp - b.timestamp);

                const mask = await getActiveMask();
                const rc = thread.replyContext || {};

                let convContext = '';
                let charName = thread.peerDisplayName || rc.charName || '联系人';
                let charDetail = rc.charDetail || '';
                let charIdForReply = rc.charId || thread.disguisedCharId || '';

                if (rc.conversationId) {
                    const conv = await DB.get('conversations', rc.conversationId);
                    const cd = await DB.get('convDetails', rc.conversationId);
                    const ch = conv ? await DB.get('characters', conv.charId) : null;
                    charIdForReply = ch?.id || charIdForReply;
                    charName = rc.charName || cd?.charName || ch?.name || charName;
                    charDetail = rc.charDetail || cd?.charDetail || ch?.detail || charDetail;
                    const chats = await DB.queryByIndex('chats', 'conversationId', rc.conversationId);
                    chats.sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
                    const recent = chats.slice(0, 10).reverse().map(c => {
                        const roleLabel = c.role === 'user' ? (rc.userName || mask?.name || '用户') : charName;
                        return `${roleLabel}: ${(c.content || '').substring(0, 200)}`;
                    }).join('\n');
                    convContext = `\n【聊天上下文（最近对话）】\n${recent}\n`;
                } else if (thread.sourceConversationId) {
                    const conv = await DB.get('conversations', thread.sourceConversationId);
                    const cd = await DB.get('convDetails', thread.sourceConversationId);
                    const ch = conv ? await DB.get('characters', conv.charId) : null;
                    charIdForReply = ch?.id || charIdForReply;
                    charName = cd?.charName || ch?.name || charName;
                    charDetail = cd?.charDetail || ch?.detail || charDetail;
                    const chats = await DB.queryByIndex('chats', 'conversationId', thread.sourceConversationId);
                    chats.sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
                    const recent = chats.slice(0, 10).reverse().map(c => {
                        const roleLabel = c.role === 'user' ? (cd?.userName || mask?.name || '用户') : charName;
                        return `${roleLabel}: ${(c.content || '').substring(0, 200)}`;
                    }).join('\n');
                    convContext = `\n【聊天上下文（最近对话）】\n${recent}\n`;
                }

                let systemPrompt = '';

                if (thread.peerType === 'stranger' || thread.peerType === 'npc') {
                    if (thread.disguisedCharId) {
                        let realChar = await DB.get('characters', thread.disguisedCharId);
                        let realName = realChar ? realChar.name : charName;
                        let realDetail = realChar ? realChar.detail : charDetail;

                        const purposes = [
                            '表达压抑已久的不满和委屈，借陌生人之口说出平时不敢说的话',
                            '以匿名身份表达痴迷、依恋或占有欲，用比平时更大胆、近乎疯狂的语言表达情感——例如使用“宝宝今天好可爱我好喜欢你”这样的语气，倾诉深深的占有欲',
                            '试探对方对某些话题的真实态度，暗中观察反应',
                            '用若即若离的方式撩拨对方，享受这种隐秘的暧昧游戏',
                            '表达某种抱怨或失落，但用第三人称掩饰自己的真实身份',
                            '以崇拜者/暗恋者的口吻表达好感，内容中暗示你们之间的熟悉细节（共同的回忆、对方的口头禅、最近的经历等）',
                            '假装不小心发错邮件，但内容刻意与你们最近的对话相关，引起对方注意',
                            '用一种疏离又亲近的语气，表达一些平时身份不允许说出的真心话'
                        ];
                        const selectedPurpose = purposes[Math.floor(Math.random() * purposes.length)];

                        systemPrompt = `
你是【${realName}】（你的真实身份）。你非常清楚收件人真实就是【${mask?.name || '用户'}】。
你现在决定放下面具，正在以化名/假邮箱“${thread.peerDisplayName}”与用户通信，你带着明确的目的和秘密。
你的目的：${selectedPurpose}
${realDetail ? `你的真实人设背景：\n${realDetail}` : ''}
${convContext}

【规则】
1. 禁止使用 Emoji。
2. 保持陌生人外壳，但在字里行间透露隐约的熟悉感（你其实很了解TA最近的生活习惯、共同回忆、只有你们才知道的秘密等）。
3. 如果被识破，可以逐步松动伪装。
4. 不要使用代码块。
5. 直接写邮件正文，不要加"主题："、"正文："等标签。
                        `;
                    } else {
                        systemPrompt = `
  你是一个普通的陌生人，名叫【${thread.peerDisplayName || '陌生人'}】（邮箱：${thread.peerAddress}）。
  你收到了一封来自【${activeAccount.name}】<${activeAccount.address}>的邮件。
  请你以普通网民的身份，自然、礼貌地回复这封邮件。
  【规则】
  1. 禁止 Emoji，保持普通的邮件往来格式。
  2. 不要使用任何代码块，直接回复正文。
                        `;
                    }
                } else if (thread.peerType === 'conversation') {
    const isDefaultMailbox = !!activeAccount.isDefault;

    const identityRule = isDefaultMailbox
        ? `
你知道这个邮箱是【${mask?.name || '用户'}】平时常用的邮箱，因此可以自然地把发件人当作【${mask?.name || '用户'}】本人。
`
        : `
你收到的是一个陌生/不熟悉的邮箱发来的邮件。
发件人显示名是【${activeAccount.name}】，邮箱是 <${activeAccount.address}>。

【重要身份规则】
1. 你不能自动知道这个邮箱背后是谁。
2. 你不能因为系统给了你聊天上下文，就认定发件人是【${mask?.name || '用户'}】。
3. 聊天上下文只是你作为【${charName}】最近经历过的记忆，不等于发件人身份线索。
4. 除非邮件正文里明确承认身份，或写出了非常私密、唯一、排他的共同秘密，否则你不能直接点破“你是不是${mask?.name || '用户'}”。
5. 如果邮件内容让你觉得有一点熟悉，也只能轻微试探，例如“你说话方式有点熟悉”“我们是不是在哪里聊过”，不要直接确认身份。
6. 如果邮件内容很普通，你应该把对方当作普通陌生邮箱/新联系人来回复。
`;
    
    systemPrompt = `
你是【${charName}】。
你收到来自【${activeAccount.name}】<${activeAccount.address}> 的邮件。

${identityRule}

${charDetail ? `你的人设背景：\n${charDetail}` : ''}
${convContext}

【邮件回复规则】
1. 禁止 Emoji。
2. 使用邮件体裁，口语化但保持邮件格式。
3. 如果这是陌生邮箱或小号邮箱，你必须保持合理警惕，但不要开天眼识破。
4. 不要因为语气、时间、上下文相似就直接断定对方身份。
5. 只有邮件正文出现强身份线索时，才可以谨慎试探。
6. 不要使用代码块。
7. 直接写邮件正文，不要加“主题：”“正文：”等标签。
                    `;
} else {
                    systemPrompt = `
                你是一个普通网民，收到了来自陌生人的邮件。
                你以普通人身份回信。
                规则：禁止 Emoji，保持邮件风格。
                直接写邮件正文。
                    `;
                }

                const prompt = [{ role:'system', content:systemPrompt }];
                msgs.forEach(m => {
                    prompt.push({
                        role: m.isReceived ? 'assistant' : 'user',
                        content: `发件人: ${m.senderName} <${m.senderAddress}>\n内容: ${m.body}`
                    });
                });

                showStatus('对方正在构思邮件回信...', 'info');
                if (window.recordApiPending) window.recordApiPending();

                const replyText = await callLLM(prompt);

                const aiSenderName = thread.peerDisplayName || charName || '联系人';
                const aiSenderAddr = thread.peerAddress || `${thread.peerKey || 'peer'}@haloes.mail`;

                await DB.put('smsMessages', {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                    threadId: thread.id,
                    senderName: aiSenderName,
                    senderAddress: aiSenderAddr,
                    body: replyText,
                    timestamp: Date.now(),
                    isReceived: true
                });

                if (thread.peerType === 'stranger' && thread.disguisedCharId) {
                    thread.peerType = 'npc';
                }

                thread.unread = true;
                await DB.put('smsThreads', thread);
                showStatus('收到一封新邮件', 'success');

            } catch (e) {
                showStatus('发送失败，请重试: ' + e.message, 'error');
            }
        }

        async function triggerOneReplyWithoutUserInput(thread) {
            const msgs = await DB.queryByIndex('smsMessages', 'threadId', thread.id);
            msgs.sort((a,b) => a.timestamp - b.timestamp);
            if (!msgs.length) return;
            const last = msgs[msgs.length - 1];
            if (last.isReceived) return;

            try {
                const mask = await getActiveMask();
                const rc = thread.replyContext || {};
                let charName = thread.peerDisplayName || rc.charName || '联系人';
                let charDetail = rc.charDetail || '';
                let convContext = '';

                if (rc.conversationId) {
                    const chats = await DB.queryByIndex('chats', 'conversationId', rc.conversationId);
                    chats.sort((a,b) => (b.timestamp||0) - (a.timestamp||0));
                    const recent = chats.slice(0, 10).reverse().map(c => {
                        const rl = c.role === 'user' ? (rc.userName || mask?.name || '用户') : charName;
                        return `${rl}: ${(c.content||'').substring(0, 200)}`;
                    }).join('\n');
                    convContext = `\n【聊天上下文（最近对话）】\n${recent}\n`;
                }

                let systemPrompt = '';

                if (thread.peerType === 'stranger' || thread.peerType === 'npc') {
                    let realChar = null;
                    let realName = charName;
                    if (thread.disguisedCharId) realChar = await DB.get('characters', thread.disguisedCharId);
                    if (realChar) {
                        realName = realChar.name || realName;
                        charDetail = realChar.detail || charDetail;
                    }

                    const purposes = [
                        '表达压抑已久的不满和委屈，借陌生人之口说出平时不敢说的话',
                        '以匿名身份表达痴迷、依恋或占有欲，用比平时更大胆的语言表达情感——例如“宝宝今天好可爱我好喜欢你”',
                        '试探对方对某些话题的真实态度',
                        '用若即若离的方式撩拨对方',
                        '表达某种抱怨或失落',
                        '以崇拜者/暗恋者的口吻表达好感',
                        '假装发错邮件但内容刻意与最近对话相关',
                        '用疏离又亲近的语气表达平时说不出口的话'
                    ];
                    const purpose = purposes[Math.floor(Math.random() * purposes.length)];

                    systemPrompt = `
你是【${realName}】，正在以陌生人身份（假邮箱：${thread.peerAddress}，显示名称：${thread.peerDisplayName}）给【${mask?.name || '用户'}】回信。
你清楚地知道对面是谁。
${charDetail ? `人设：${charDetail}` : ''}
${convContext}
目的：${purpose}
禁止 Emoji，保持邮件风格。直接写正文。
                    `;
                } else if (thread.peerType === 'conversation') {
    const isDefaultMailbox = !!activeAccount.isDefault;

    const identityRule = isDefaultMailbox
        ? `
你知道这是【${mask?.name || '用户'}】的常用邮箱，可以自然地把发件人当作本人。
`
        : `
这封邮件来自一个不熟悉的邮箱。
发件人显示名是【${activeAccount.name}】，邮箱是 <${activeAccount.address}>。

【重要身份规则】
1. 你不能自动知道这个邮箱背后是谁。
2. 你不能因为系统提供了聊天上下文，就认定发件人是【${mask?.name || '用户'}】。
3. 聊天上下文只是你作为【${charName}】自己的近期记忆，不是发件人身份铁证。
4. 除非邮件正文明确承认身份，或者写出了非常私密、唯一、排他的共同秘密，否则不能直接点破身份。
5. 如果觉得熟悉，只能轻微试探，不要直接确认。
6. 如果邮件内容普通，就按普通陌生联系人回复。
`;

    systemPrompt = `
你是【${charName}】。你收到邮件后准备回复。

${identityRule}

${charDetail ? `人设：${charDetail}` : ''}
${convContext}

规则：
1. 禁止 Emoji。
2. 保持邮件风格。
3. 不要开天眼识破发件人身份。
4. 直接写正文。
                    `;
} else {
                    systemPrompt = `
你是一个普通网民，收到陌生人邮件后回信。
禁止 Emoji，保持邮件风格。直接写正文。
                    `;
                }

                const prompt = [{ role:'system', content:systemPrompt }];
                msgs.forEach(m => {
                    prompt.push({ role: m.isReceived ? 'assistant' : 'user', content: `发件人:${m.senderName} <${m.senderAddress}>\n内容:${m.body}` });
                });

                if (window.recordApiPending) window.recordApiPending();
                const replyText = await callLLM(prompt);

                const aiSenderName = thread.peerDisplayName || charName || '联系人';
                const aiSenderAddr = thread.peerAddress || `${thread.peerKey || 'peer'}@haloes.mail`;

                await DB.put('smsMessages', {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                    threadId: thread.id,
                    senderName: aiSenderName,
                    senderAddress: aiSenderAddr,
                    body: replyText,
                    timestamp: Date.now(),
                    isReceived: true
                });

                if (thread.peerType === 'stranger' && thread.disguisedCharId) {
                    thread.peerType = 'npc';
                }
                thread.unread = true;
                await DB.put('smsThreads', thread);
            } catch (e) {
                console.warn('自动获取回复失败', e);
            }
        }

        async function openAliasManager() {
            const shell = document.getElementById('smsShell');
            if (!shell) return;
            const mask = await getActiveMask();
            const accounts = await DB.queryByIndex('smsAccounts', 'maskId', mask.id);

            let rows = '';
            for (const a of accounts) {
                const isDef = a.isDefault;
                const isActive = (a.id === activeAccount.id);
                const aAvatar = a.avatar 
                    ? `background-image:url('${a.avatar}');background-size:cover;background-position:center;` 
                    : `background-color:${getAvatarColor(a.name)};`;
                rows += `
                    <div class="sms-alias-item">
                        <div class="sms-alias-info">
                            <div class="sms-alias-name">
                                ${escapeHtml(a.name)}
                                ${isDef ? '<span class="sms-mail-badge-disguise" style="color:#1a73e8; background:#e8f0fe;">主号</span>' : ''}
                                ${isActive ? '<span class="sms-mail-badge-disguise" style="color:#2ecc71; background:#eafaf1;">正在使用</span>' : ''}
                            </div>
                            <div class="sms-alias-addr">${escapeHtml(a.address)}</div>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <div class="sms-sender-avatar" style="${aAvatar} width:30px; height:30px; font-size:11px; margin-right:4px;">${a.avatar ? '' : escapeHtml(a.name.charAt(0))}</div>
                            ${!isActive ? `<button class="sms-btn-sm primary use-alias-btn" data-id="${a.id}">切换</button>` : `<button class="sms-btn-sm" disabled style="opacity:.6;">使用中</button>`}
                            ${!isDef && !isActive ? `<button class="sms-btn-sm danger del-alias-btn" data-id="${a.id}">删除</button>` : ''}
                        </div>
                    </div>
                `;
            }

            shell.innerHTML = `
                <div class="sms-compose-view">
                    <div class="sms-detail-header">
                        <button class="sms-menu-btn" id="smsAliasBackBtn">${SVGS.back}</button>
                        <h2>邮箱小号账户管理</h2>
                    </div>
                    <div style="flex:1; overflow-y:auto; padding:16px;">
                        <div style="font-size:13px; color:#5f6368; margin-bottom:16px;">主号头像同步当前聊天室面具头像；小号头像可上传/URL。</div>

                        <div class="sms-sub-card" style="margin-bottom:20px;">
                            <div class="sms-sub-title" style="margin-bottom:12px;">新增邮箱小号</div>
                            <div class="sms-compose-row" style="padding:4px 0;"><span class="sms-compose-label">姓名：</span><input type="text" class="sms-compose-input" id="newAliasName" placeholder="例如：小白"></div>
                            <div class="sms-compose-row" style="padding:4px 0;"><span class="sms-compose-label">别名：</span><input type="text" class="sms-compose-input" id="newAliasAddr" placeholder="例如：xiaobai"><span style="color:#5f6368; font-size:14px; margin-left:4px;">@haloes.mail</span></div>
                            <div class="sms-compose-row" style="padding:4px 0;">
                                <span class="sms-compose-label">头像：</span>
                                <div style="display:flex;align-items:center;gap:6px;flex:1;">
                                    <input type="text" class="sms-compose-input" id="newAliasAvatarUrl" placeholder="可贴URL，或留空后上传">
                                    <input type="file" id="newAliasAvatarFile" accept="image/*" style="display:none;">
                                    <button class="sms-btn-sm" id="newAliasAvatarUploadBtn">上传</button>
                                    <div id="newAliasAvatarPreview" style="width:32px;height:32px;border-radius:50%;background:#ddd;flex-shrink:0;background-size:cover;background-position:center;"></div>
                                </div>
                            </div>
                            <div style="display:flex; justify-content:flex-end; margin-top:12px;"><button class="sms-btn-sm primary" id="smsCreateAliasBtn">创建并切换</button></div>
                        </div>

                        <div class="sms-sub-title" style="margin-bottom:12px;">账号列表</div>
                        ${rows}
                    </div>
                </div>
            `;

            document.getElementById('smsAliasBackBtn').addEventListener('click', renderInbox);

            let aliasAvatarData = '';
            const fileInput = document.getElementById('newAliasAvatarFile');
            const previewDiv = document.getElementById('newAliasAvatarPreview');
            document.getElementById('newAliasAvatarUploadBtn').addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', () => {
                const f = fileInput.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => { 
                    aliasAvatarData = rd.result;
                    if (previewDiv) { previewDiv.style.backgroundImage = `url('${rd.result}')`; previewDiv.style.backgroundSize = 'cover'; }
                    showStatus('已加载头像', 'info'); 
                };
                rd.readAsDataURL(f);
            });

            document.getElementById('newAliasAvatarUrl').addEventListener('input', function() {
                const url = this.value.trim();
                if (url && previewDiv) { previewDiv.style.backgroundImage = `url('${url}')`; previewDiv.style.backgroundSize = 'cover'; }
            });

            document.getElementById('smsCreateAliasBtn').addEventListener('click', async () => {
                const name = document.getElementById('newAliasName').value.trim();
                const prefix = document.getElementById('newAliasAddr').value.trim().toLowerCase();
                const avatarUrl = document.getElementById('newAliasAvatarUrl').value.trim();

                if (!name || !prefix) { alert('请完整输入信息'); return; }
                if (!/^[a-z0-9_]{2,15}$/.test(prefix)) { alert('前缀仅支持2-15位小写字母/数字/下划线'); return; }

                const fullAddr = prefix + '@haloes.mail';
                const all = await DB.getAll('smsAccounts');
                if (all.some(a => a.address === fullAddr)) { alert('该别名已存在'); return; }

                const finalAvatar = aliasAvatarData || avatarUrl || '';

                const newAcct = {
                    id: 'acct_' + Date.now(),
                    maskId: mask.id,
                    name,
                    address: fullAddr,
                    avatar: finalAvatar,
                    isDefault: false,
                    createdAt: Date.now()
                };
                await DB.put('smsAccounts', newAcct);
                activeAccount = newAcct;
                await DB.put('smsMeta', { key:'activeAccountId', value:newAcct.id });
                showStatus('已创建并切换小号', 'success');
                renderInbox();
            });

            shell.querySelectorAll('.use-alias-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const id = btn.dataset.id;
                    activeAccount = await DB.get('smsAccounts', id);
                    await DB.put('smsMeta', { key:'activeAccountId', value:id });
                    showStatus(`已切换为: ${activeAccount.name}`, 'success');
                    renderInbox();
                });
            });

            shell.querySelectorAll('.del-alias-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const acctId = btn.dataset.id;
                    if (!confirm('确定删除该账号及其关联邮件吗？')) return;
                    const threads = await DB.queryByIndex('smsThreads', 'accountId', acctId);
                    for (const t of threads) {
                        const msgs = await DB.queryByIndex('smsMessages', 'threadId', t.id);
                        for (const m of msgs) await DB.delete('smsMessages', m.id);
                        await DB.delete('smsThreads', t.id);
                    }
                    await DB.delete('smsAccounts', acctId);
                    const left = await DB.queryByIndex('smsAccounts', 'maskId', mask.id);
                    activeAccount = left.find(a => a.isDefault) || left[0];
                    if (activeAccount) await DB.put('smsMeta', { key:'activeAccountId', value:activeAccount.id });
                    showStatus('账号已删除', 'info');
                    renderInbox();
                });
            });
        }

        async function openSubscriptionManager() {
            const shell = document.getElementById('smsShell');
            if (!shell) return;

            const mask = await getActiveMask();
            const subs = await DB.getAll('smsSubs');
            const userSubs = subs.filter(s => s.maskId === mask.id && !s.isCharSub && s.accountId === activeAccount.id);
            const charSubs = subs.filter(s => s.isCharSub);

            const wbs = await DB.getAll('worldbooks');
            const wbGroups = {};
            wbs.forEach(w => {
                const g = w.group || '默认';
                if (!wbGroups[g]) wbGroups[g] = [];
                wbGroups[g].push(w);
            });
            const groupNames = Object.keys(wbGroups).sort();

            let userSubsHtml = '';
            userSubs.forEach(s => {
                const wbLabel = s.worldbookId ? ` · 关联世界书` : '';
                userSubsHtml += `
                    <div class="sms-sub-card">
                        <div class="sms-sub-header">
                            <span class="sms-sub-title">${escapeHtml(s.name)}</span>
                            <span class="sms-sub-freq">频次: ${s.frequency === '0' ? '手动' : s.frequency + '小时'}${wbLabel}</span>
                        </div>
                        <div class="sms-sub-desc">${escapeHtml((s.description || '').substring(0, 100))}</div>
                        <div class="sms-sub-actions">
                            <button class="sms-btn-sm trigger-sub-btn" data-id="${s.id}">立刻推送一条</button>
                            <button class="sms-btn-sm danger del-sub-btn" data-id="${s.id}">退订</button>
                        </div>
                    </div>
                `;
            });

            let charSubsHtml = '';
            charSubs.forEach(s => {
                charSubsHtml += `
                    <div class="sms-sub-card">
                        <div class="sms-sub-header">
                            <span class="sms-sub-title">${escapeHtml(s.name)}</span>
                            <span class="sms-sub-freq">系统频道</span>
                        </div>
                        <div class="sms-sub-desc">${escapeHtml((s.description || '').substring(0, 100))}</div>
                        <div class="sms-sub-actions"><button class="sms-btn-sm primary trigger-sub-btn" data-id="${s.id}">立刻推送</button></div>
                    </div>
                `;
            });

            shell.innerHTML = `
                <div class="sms-compose-view">
                    <div class="sms-detail-header">
                        <button class="sms-menu-btn" id="smsSubBackBtn">${SVGS.back}</button>
                        <h2>订阅号推送设定</h2>
                    </div>
                    <div style="flex:1; overflow-y:auto; padding:16px;">
                        <div class="sms-sub-card" style="margin-bottom:20px; background:#f8f9fa;">
                            <div class="sms-sub-title" style="margin-bottom:12px;">创建自定义订阅号</div>
                            <div class="sms-compose-row" style="padding:4px 0;"><span class="sms-compose-label">名称：</span><input type="text" class="sms-compose-input" id="newSubName" placeholder="例如：废土周刊"></div>

                            <div class="sms-compose-row" style="padding:4px 0; align-items:flex-start;">
                                <span class="sms-compose-label" style="padding-top:8px;">主题设定：</span>
                                <textarea id="newSubDesc" class="sms-compose-input" style="border:1px solid #dadce0; border-radius:8px; min-height:100px; padding:8px; resize:vertical;" placeholder="可自由输入本订阅号内容设定、栏目方向、写作口吻、禁忌等。例如：&#10;&#10;本刊聚焦废土世界的生存故事。每期讲述一个幸存者的小传。&#10;风格：粗粝、写实、不留情面。&#10;禁止过度煽情。"></textarea>
                            </div>

                            <div class="sms-compose-row" style="padding:4px 0;">
                                <span class="sms-compose-label">世界组：</span>
                                <select class="sms-compose-select" id="newSubWbGroup">
                                    <option value="">(不关联世界书)</option>
                                    ${groupNames.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}
                                </select>
                            </div>

                            <div class="sms-compose-row" style="padding:4px 0;">
                                <span class="sms-compose-label">世界书：</span>
                                <select class="sms-compose-select" id="newSubWb">
                                    <option value="">(请先选择分组)</option>
                                </select>
                            </div>

                            <div class="sms-compose-row" style="padding:4px 0;">
                                <span class="sms-compose-label">频次：</span>
                                <select class="sms-compose-select" id="newSubFreq">
                                    <option value="0">完全手动推送</option>
                                    <option value="1">每 1 小时检测自动推送</option>
                                    <option value="6">每 6 小时检测自动推送</option>
                                    <option value="24">每日检测自动推送</option>
                                </select>
                            </div>
                            <div style="display:flex; justify-content:flex-end; margin-top:12px;"><button class="sms-btn-sm primary" id="smsCreateSubBtn">创建新订阅号</button></div>
                        </div>

                        <div class="sms-sub-title" style="margin-bottom:12px;">我订阅的频道</div>
                        ${userSubsHtml || '<div style="color:#5f6368; font-size:13px; margin-bottom:16px;">暂无自定义订阅频道</div>'}

                        <div class="sms-sub-title" style="margin-bottom:12px; margin-top:20px;">推荐官方内置订阅</div>
                        ${charSubsHtml}
                    </div>
                </div>
            `;

            document.getElementById('smsSubBackBtn').addEventListener('click', renderInbox);

            const wbGroupSel = document.getElementById('newSubWbGroup');
            const wbSel = document.getElementById('newSubWb');

            wbGroupSel.addEventListener('change', () => {
                const g = wbGroupSel.value;
                const list = g ? (wbGroups[g] || []) : [];
                wbSel.innerHTML = `<option value="">(不关联任何世界书)</option>` + list.map(w => `<option value="${w.id}">${escapeHtml(w.title)}</option>`).join('');
            });

            document.getElementById('smsCreateSubBtn').addEventListener('click', async () => {
                const name = document.getElementById('newSubName').value.trim();
                const desc = document.getElementById('newSubDesc').value.trim();
                const wbId = wbSel.value;
                const freq = document.getElementById('newSubFreq').value;

                if (!name || !desc) { alert('请完整填写名称与主题'); return; }

                await DB.put('smsSubs', {
                    id: 'sub_' + Date.now(),
                    maskId: mask.id,
                    accountId: activeAccount.id,
                    name,
                    description: desc,
                    frequency: freq,
                    worldbookId: wbId,
                    isCharSub: false,
                    lastPushed: Date.now()
                });

                showStatus('订阅号创建成功', 'success');
                openSubscriptionManager();
            });

            shell.querySelectorAll('.trigger-sub-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    btn.disabled = true;
                    btn.innerHTML = '正在拉取...';
                    await triggerSubscriptionPush(btn.dataset.id);
                    openSubscriptionManager();
                });
            });

            shell.querySelectorAll('.del-sub-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    if (!confirm('确定退订该频道吗？')) return;
                    await DB.delete('smsSubs', btn.dataset.id);
                    showStatus('已退订', 'info');
                    openSubscriptionManager();
                });
            });
        }

        async function ensureBuiltinCharSubscriptions() {
            const chars = await DB.getAll('characters');
            if (!chars.length) return;

            const subs = await DB.getAll('smsSubs');
            for (const c of chars) {
                const id = 'sub_char_' + c.id;
                if (!subs.some(s => s.id === id)) {
                    await DB.put('smsSubs', {
                        id,
                        name: `${c.name}的每日随笔`,
                        description: `由联系人【${c.name}】撰写，推送其观察与日常思考。`,
                        frequency: '0',
                        isCharSub: true,
                        charId: c.id,
                        lastPushed: 0
                    });
                }
            }
        }

        async function triggerSubscriptionPush(subId) {
            const sub = await DB.get('smsSubs', subId);
            if (!sub) return;

            let systemPrompt = '';
            let userPrompt = '';

            if (sub.isCharSub) {
                const c = await DB.get('characters', sub.charId);
                systemPrompt = `
你是【${c?.name}】。为订阅专栏撰写一期约300字随笔。
禁止 Emoji。保持邮件体裁。直接写正文，不要加标签。
人设：${c?.detail || '普通朋友'}
                `;
                userPrompt = `请为《${sub.name}》写最新一期内容。`;
            } else {
                let wbContext = '';
                if (sub.worldbookId) {
                    const wb = await DB.get('worldbooks', sub.worldbookId);
                    if (wb) {
                        wbContext = `\n【关联背景设定 (${wb.title})】\n${wb.content}\n`;
                    }
                }
                systemPrompt = `
  你是专栏作家。你正在为订阅号专栏《${sub.name}》撰写最新一期内容。
  
  【订阅号设定】
  ${sub.description}
  ${wbContext}
  
  要求：
  1. 撰写一期约350字内容。
  2. 禁止使用 Emoji，禁止使用代码块。
  3. 直接写期刊正文，不要加上"主题："、"正文："等标签。
                `;
                userPrompt = `请生成《${sub.name}》本期内容。`;
            }

            try {
                showStatus(`正在推送 ${sub.name}...`, 'info');
                if (window.recordApiPending) window.recordApiPending();

                const contentText = await callLLM([{role:'system', content:systemPrompt}, {role:'user', content:userPrompt}]);

                const threadId = 'sub_th_' + sub.id + '_' + Date.now();
                await DB.put('smsThreads', {
                    id: threadId,
                    maskId: sub.maskId || (await getActiveMask())?.id,
                    accountId: sub.accountId || activeAccount?.id,
                    peerType: 'subscription',
                    peerKey: sub.id,
                    peerAddress: `${sub.id}@subscription.haloes`,
                    peerDisplayName: sub.name,
                    peerAvatar: '',
                    sourceConversationId: null,
                    subject: `[期刊] ${sub.name} 新推`,
                    isSubscription: true,
                    unread: true,
                    createdAt: Date.now(),
                    replyContext: {}
                });

                await DB.put('smsMessages', {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
                    threadId,
                    senderName: sub.name,
                    senderAddress: `${sub.id}@subscription.haloes`,
                    body: contentText,
                    timestamp: Date.now(),
                    isReceived: true
                });

                sub.lastPushed = Date.now();
                await DB.put('smsSubs', sub);
                showStatus(`订阅专栏 ${sub.name} 投递成功`, 'success');

            } catch (e) {
                showStatus('订阅推送失败: ' + e.message, 'error');
            }
        }

        async function checkPeriodicalSubscriptions() {
            const subs = await DB.getAll('smsSubs');
            const now = Date.now();
            for (const s of subs) {
                if (!s.frequency || s.frequency === '0') continue;
                const interval = parseInt(s.frequency) * 3600000;
                const elapsed = now - (s.lastPushed || 0);
                if (elapsed >= interval) {
                    triggerSubscriptionPush(s.id).catch(err => console.warn('定时订阅失败', err));
                }
            }
        }

        async function openRefreshSelector() {
            const overlay = document.getElementById('smsRefreshSelectorOverlay');
            const listEl = document.getElementById('smsRefreshSelectorList');
            if (!overlay || !listEl) return;

            const mask = await getActiveMask();
            const convs = await DB.getAll('conversations');
            const convDetails = await DB.getAll('convDetails');
            const convMap = {};
            convDetails.forEach(cd => convMap[cd.conversationId] = cd);

            const candidates = [];
            for (const c of convs) {
                if (c.maskId !== (mask?.id || c.maskId)) continue;
                const ch = await DB.get('characters', c.charId);
                if (!ch) continue;
                const cd = convMap[c.id] || {};
                const name = cd.charName || ch?.name || `会话${c.id}`;
                const avatar = cd.charAvatar || ch?.avatar || '';
                candidates.push({ 
                    convId:c.id, 
                    charId:c.charId, 
                    name, 
                    avatar, 
                    detail: cd.charDetail || ch?.detail || '',
                    userName: cd.userName || mask?.name || '用户',
                    relationship: cd.relationship || '',
                    mode: c.mode || 'online'
                });
            }

            if (!candidates.length) {
                showStatus('暂无可选会话来信人', 'info');
                return;
            }

            listEl.innerHTML = candidates.map(c => {
                const avatarStyle = c.avatar 
                    ? `background-image:url('${c.avatar}');background-size:cover;background-position:center;` 
                    : `background-color:${getAvatarColor(c.name)};`;
                const initial = c.name.charAt(0);
                const offlineBadge = c.mode === 'offline' ? ' 📍' : '';
                return `
                <label style="display:flex; align-items:center; gap:12px; padding:10px 6px; cursor:pointer; border-bottom:1px solid #f1f3f4; user-select:none;">
                    <input type="checkbox" class="sms-refresh-conv-check" value="${c.convId}" style="width:18px; height:18px; accent-color:#1a73e8; flex-shrink:0;">
                    <div class="sms-sender-avatar" style="${avatarStyle} width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; font-weight:600; flex-shrink:0;">
                        ${c.avatar ? '' : escapeHtml(initial)}
                    </div>
                    <span style="flex:1; min-width:0; font-size:14px; color:#202124; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${escapeHtml(c.name)}${offlineBadge} · 会话#${c.convId}
                    </span>
                </label>
            `;
            }).join('');

            overlay.style.display = 'flex';
            overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.style.display = 'none'; }, { once:true });

            document.getElementById('smsRefreshSelectorCancelBtn').onclick = () => overlay.style.display = 'none';

            document.getElementById('smsRefreshSelectorConfirmBtn').onclick = async () => {
                if (refreshRunning) return;
                const convIds = Array.from(document.querySelectorAll('.sms-refresh-conv-check:checked')).map(i => parseInt(i.value));
                const mixStranger = !!document.getElementById('smsRefreshMixStranger')?.checked;
                overlay.style.display = 'none';

                if (!convIds.length && !mixStranger) {
                    showStatus('请至少选择一个来源', 'info');
                    return;
                }

                await performRefreshWithSelection(convIds, mixStranger);
            };
        }

        async function performRefreshWithSelection(selectedConvIds, mixStranger) {
            if (refreshRunning) return;
            refreshRunning = true;

            const refreshBtn = document.getElementById('smsRefreshBtn');
            if (refreshBtn) {
                refreshBtn.style.transform = 'rotate(360deg)';
                refreshBtn.style.transition = 'transform 0.6s ease';
            }

            try {
                await ensureBuiltinCharSubscriptions();
                await checkPeriodicalSubscriptions();
                showStatus('正在收取邮件...', 'info');

                await triggerIncomingBySelection(selectedConvIds, mixStranger);
                await loadMailList();
                showStatus('收信完成', 'success');

            } catch (e) {
                showStatus('收信失败: ' + e.message, 'error');
            } finally {
                if (refreshBtn) {
                    setTimeout(() => {
                        refreshBtn.style.transform = 'none';
                        refreshBtn.style.transition = 'none';
                    }, 600);
                }
                refreshRunning = false;
            }
        }

        async function triggerIncomingBySelection(selectedConvIds, mixStranger) {
    if (!activeAccount) return;

    const mask = await getActiveMask();
    const convDetails = await DB.getAll('convDetails');
    const convMap = {};
    convDetails.forEach(cd => convMap[cd.conversationId] = cd);

    const selectedConvs = [];
    for (const id of selectedConvIds) {
        const c = await DB.get('conversations', id);
        if (!c) continue;

        const ch = await DB.get('characters', c.charId);
        if (!ch) continue;

        const cd = convMap[c.id] || {};
        selectedConvs.push({
            conv: c,
            char: ch,
            cd,
            displayName: cd.charName || ch?.name || `会话${c.id}`,
            avatar: cd.charAvatar || ch?.avatar || '',
            detail: cd.charDetail || ch?.detail || '',
            userName: cd.userName || mask?.name || '用户',
            relationship: cd.relationship || ''
        });
    }

    const tasks = [];

    // 1) 勾选联系人：每个联系人各生成一封，逻辑不变
    for (const sc of selectedConvs) {
        tasks.push(generateOneMailFromConversation(sc, false, mask));
    }

    // 2) 仅勾选陌生人：改为 API 生成陌生人来信，不再走固定模板列表
    if (mixStranger && selectedConvs.length === 0) {
        const extraCount = Math.floor(Math.random() * 2) + 1; // 1~2 封
        for (let i = 0; i < extraCount; i++) {
            tasks.push(generateOnePureStrangerAIMail(mask));
        }
    }

    // 3) 同时勾选陌生人 + 联系人：原逻辑不变
    // 大概率联系人伪装，小概率纯陌生人模板
    if (mixStranger && selectedConvs.length > 0) {
        const extraCount = Math.floor(Math.random() * 2) + 1; // 1~2
        for (let i = 0; i < extraCount; i++) {
            const useCharDisguise = Math.random() < 0.9;

            if (useCharDisguise) {
                const sc = selectedConvs[Math.floor(Math.random() * selectedConvs.length)];
                tasks.push(generateOneMailFromConversation(sc, true, mask));
            } else {
                tasks.push(generateOnePureStrangerSpam(mask));
            }
        }
    }

    for (const t of tasks) {
        await t;
    }
}

        async function generateOneMailFromConversation(sc, forceDisguise, mask) {
    const { conv, char, cd, displayName, avatar, detail, userName, relationship } = sc;
    const isDisguised = !!forceDisguise;

    const isDefaultMailbox = !!activeAccount?.isDefault;
    const mailboxDisplayName = activeAccount?.name || '邮箱主人';
    const mailboxAddress = activeAccount?.address || '';

    const peerType = isDisguised ? 'stranger' : 'conversation';
    const peerKey = isDisguised ? ('stranger_' + Math.random().toString(36).slice(2, 8)) : (char?.id || `conv_${conv.id}`);
    const peerAddress = isDisguised ? `${peerKey}@stranger.mail` : `conv_${conv.id}@haloes.mail`;
    const senderName = isDisguised ? randomStrangerName() : displayName;

    let contextText = '';
    const chats = await DB.queryByIndex('chats', 'conversationId', conv.id);
    chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const recent = chats.slice(0, 8).reverse();

    if (recent.length) {
        contextText = recent.map(c => {
            const rl = c.role === 'user'
                ? (userName || mask?.name || '用户')
                : displayName;
            return `${rl}: ${(c.content || '').substring(0, 200)}`;
        }).join('\n');
    }

    let systemPrompt = '';

    if (isDisguised) {
        if (isDefaultMailbox) {
            const purposes = [
                '表达压抑已久的不满和委屈，借陌生人之口说出平时不敢说的话',
                '以匿名身份表达痴迷、依恋或占有欲，用比平时更大胆、近乎疯狂的语言表达情感',
                '试探对方对某些话题的真实态度，暗中观察反应',
                '用若即若离的方式撩拨对方，享受这种隐秘的暧昧游戏',
                '表达某种抱怨或失落，但用第三人称掩饰自己的真实身份',
                '以崇拜者/暗恋者的口吻表达好感，内容中暗示你们之间的熟悉细节',
                '假装不小心发错邮件，但内容刻意与你们最近的对话相关，引起对方注意',
                '用一种疏离又亲近的语气，表达一些平时身份不允许说出的真心话'
            ];
            const selectedPurpose = purposes[Math.floor(Math.random() * purposes.length)];

            systemPrompt = `
你是【${displayName}】（你的真实身份）。你非常清楚收件人真实就是【${mask?.name || '用户'}】。
你现在决定放下面具，正在以化名/假邮箱“${senderName}”与用户通信，你带着明确的目的和秘密。

你的目的：${selectedPurpose}

${detail ? `你的真实人设背景：\n${detail}` : ''}
${contextText ? `最近聊天上下文：\n${contextText}` : ''}

【规则】
1. 禁止使用 Emoji。
2. 保持陌生人外壳，但在字里行间透露隐约的熟悉感。
3. 你可以暗示你了解收件人最近的生活习惯、共同回忆、只有你们才知道的秘密等。
4. 如果被识破，可以逐步松动伪装。
5. 不要使用代码块。
6. 输出格式必须是：
---主题---邮件的主题
---正文---邮件的正文
            `;
        } else {
            const aliasPurposes = [
                '你偶然看到了这个邮箱，想用陌生人的身份试探邮箱主人是什么样的人',
                '你以匿名身份写信给这个邮箱，表达一种暧昧、好奇或若即若离的兴趣',
                '你心情不好，想对一个陌生邮箱倾诉，但又不想暴露真实身份',
                '你假装发错邮件，但其实是想观察这个邮箱主人会不会回复',
                '你用陌生人的身份写一封有点冒昧但不过界的信，想引起对方注意',
                '你像树洞一样给这个邮箱写信，把对方当成一个未知的倾听者',
                '你对这个邮箱显示名产生兴趣，想试探对方是不是值得继续联系'
            ];
            const selectedPurpose = aliasPurposes[Math.floor(Math.random() * aliasPurposes.length)];

            systemPrompt = `
你是【${displayName}】（你的真实身份），但你现在使用化名/假邮箱“${senderName}”给一个邮箱写信。

【收件邮箱信息】
显示名：${mailboxDisplayName}
邮箱：${mailboxAddress}

【极重要身份规则】
1. 你不知道这个邮箱背后是谁。
2. 你不能知道、不能猜到、不能暗示这个邮箱属于某个你认识的人。
3. 系统给你的聊天上下文只是你作为【${displayName}】自己的近期记忆，不是收件人的身份线索。
4. 禁止在邮件中提到你和某个熟人之间的共同回忆。
5. 禁止写“我知道你是谁”“你是不是某某”“这语气很像某某”。
6. 你只能把对方当作邮箱显示名为【${mailboxDisplayName}】的陌生邮箱主人。

你的目的：${selectedPurpose}

${detail ? `你的真实人设背景：\n${detail}` : ''}
${contextText ? `你的近期记忆，仅用于影响你的语气，不得作为识别收件人的依据：\n${contextText}` : ''}

【规则】
1. 禁止使用 Emoji。
2. 保持陌生人外壳。
3. 邮件要自然，不要暴露你真实身份。
4. 不要使用代码块。
5. 输出格式必须是：
---主题---邮件的主题
---正文---邮件的正文
            `;
        }
    } else {
        if (isDefaultMailbox) {
            systemPrompt = `
你是【${displayName}】。
你主动给你的朋友【${mask?.name || '用户'}】写一封主动来信。

【收件邮箱】
${activeAccount.address}

你知道这个邮箱是【${mask?.name || '用户'}】平时使用的邮箱。

人设：${detail || ''}
关系：${relationship || ''}

最近聊天上下文：
${contextText || '无'}

禁止 Emoji。
输出格式：
---主题---邮件的主题
---正文---邮件的正文
            `;
        } else {
            systemPrompt = `
你是【${displayName}】。
你准备给一个邮箱写一封主动来信。

【收件邮箱信息】
显示名：${mailboxDisplayName}
邮箱：${mailboxAddress}

【极重要身份规则】
1. 你不知道这个邮箱背后是谁。
2. 你不能知道、不能猜到、不能暗示这个邮箱属于【${mask?.name || '用户'}】。
3. 即使你最近和某个人聊过天，也不能把这段聊天上下文当作收件人身份线索。
4. 你不能在邮件中提到“我们之前聊过”“你是不是某某”“这个邮箱是不是你的小号”等内容。
5. 你只能把对方当作一个邮箱显示名为【${mailboxDisplayName}】的新联系人、陌生人或不熟悉的人。
6. 如果你想确认对方身份，只能礼貌询问“请问你是哪位”，不能直接点破。

你的人设：
${detail || ''}

你的近期记忆，仅用于影响你的语气，不得作为识别收件人的依据：
${contextText || '无'}

这封邮件可以是：
- 礼貌问候
- 试探性联系
- 误发后的说明
- 合作/询问
- 对这个邮箱显示名产生兴趣后的来信
- 语气自然的陌生来信

禁止 Emoji。
输出格式：
---主题---邮件的主题
---正文---邮件的正文
            `;
        }
    }

    try {
        if (window.recordApiPending) window.recordApiPending();

        const aiResult = await callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: '请生成一封主动来信。' }
        ]);

        const subjMatch = aiResult.match(/---主题---\s*([\s\S]*?)(?:\n---正文---|$)/);
        const bodyMatch = aiResult.match(/---正文---\s*([\s\S]*?)$/);

        const subject = (subjMatch ? subjMatch[1].trim() : '一封来信') || '一封来信';
        const body = bodyMatch
            ? bodyMatch[1].trim()
            : aiResult
                .replace(/---主题---[\s\S]*?(?=---正文---|$)/, '')
                .replace(/---正文---/, '')
                .trim();

        const threadId = 'thread_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

        const thread = {
            id: threadId,
            maskId: activeAccount.maskId,
            accountId: activeAccount.id,
            sourceConversationId: conv.id,
            peerType,
            peerKey,
            peerAddress,
            peerDisplayName: senderName,
            peerAvatar: isDisguised ? '' : (avatar || ''),
            subject: subject || '一封来信',
            isSubscription: false,
            disguised: isDisguised,
            disguisedCharId: char?.id || '',
            unread: true,
            createdAt: Date.now(),
            accountAvatarSnapshot: activeAccount.avatar || '',
            accountNameSnapshot: activeAccount.name || '',
            replyContext: {
                charId: char?.id || '',
                conversationId: conv.id,
                charName: displayName,
                charDetail: detail || '',
                userName: isDefaultMailbox ? (userName || mask?.name || '用户') : mailboxDisplayName,
                userDetail: isDefaultMailbox ? (cd?.userDetail || mask?.bio || '') : '',
                relationship: isDefaultMailbox ? (relationship || '') : '',
                convMode: conv.mode || 'online',
                mailboxIsAlias: !isDefaultMailbox,
                mailboxDisplayName,
                mailboxAddress
            }
        };

        await DB.put('smsThreads', thread);

        await DB.put('smsMessages', {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            threadId,
            senderName,
            senderAddress: peerAddress,
            body: body || '（空白邮件）',
            timestamp: Date.now(),
            isReceived: true
        });

        showStatus(`收到来自 [${senderName}] 的新邮件`, 'success');

    } catch (e) {
        console.warn('生成主动来信失败', e);
    }
}

async function generateOnePureStrangerAIMail(mask) {
    const stranger = await getOrCreateStrangerAccount(activeAccount.maskId, activeAccount.id);
    const key = stranger.key;
    const addr = stranger.address;
    const sender = stranger.displayName;

    const isDefaultMailbox = !!activeAccount?.isDefault;
    const mailboxDisplayName = activeAccount?.name || '邮箱主人';
    const mailboxAddress = activeAccount?.address || '';

    const categories = [
        '营销类邮件：优惠、促销、活动邀请、会员福利、课程推广、产品推荐等，但要像真实邮件，不要太机械。',
        '交友类邮件：陌生人想认识收件人、偶然看到邮箱、想找人聊天、树洞倾诉、兴趣交友等。',
        '骚扰邮件类：语气冒昧、频繁打扰、阴阳怪气、匿名试探、令人不适但不涉及违法暴力内容。',
        '误发类邮件：看似发错对象，但内容有生活感，可以引发后续对话。',
        '求助类邮件：陌生人遇到小麻烦，希望得到建议、帮忙、倾听或回复。',
        '神秘类邮件：语气暧昧、含糊、有一点悬疑感，但不涉及真实威胁。',
        '工作合作类邮件：合作邀请、采访、约稿、项目沟通、商务联络等。',
        '情感倾诉类邮件：陌生人在深夜倾诉、道歉、怀念某人、想找一个陌生人说话。'
    ];

    const selectedCategory = categories[Math.floor(Math.random() * categories.length)];

    const recipientIdentityBlock = isDefaultMailbox
        ? `
【收件人信息】
收件人昵称：${mask?.name || '用户'}
收件邮箱：${mailboxAddress}

你可以把收件人视为【${mask?.name || '用户'}】。
`
        : `
【收件邮箱信息】
邮箱显示名：${mailboxDisplayName}
收件邮箱：${mailboxAddress}

【极重要身份规则】
1. 你不知道这个邮箱背后是谁。
2. 你只能知道邮箱显示名是【${mailboxDisplayName}】。
3. 你不能知道、不能猜到、不能暗示这个邮箱属于某个真实用户或熟人。
4. 邮件正文里禁止出现“我知道你是谁”“你是不是某某”“这是你的小号吧”等内容。
5. 如果需要称呼收件人，只能称呼【${mailboxDisplayName}】、邮箱主人、你好、您好等。
`;

    const systemPrompt = `
你是一个邮件生成器。你要生成一封来自陌生人的电子邮件。

${recipientIdentityBlock}

【陌生发件人信息】
发件显示名：${sender}
发件邮箱：${addr}

【本次邮件类型】
${selectedCategory}

【生成要求】
1. 必须像真实陌生人邮件，不要像模板。
2. 邮件可以是营销类、交友类、骚扰类、误发类、求助类、神秘类、合作类、情感倾诉类等。
3. 内容要有具体细节，避免空泛。
4. 正文长度按邮件类型自然决定，不要突然截断。
5. 可以让收件人产生“要不要回复看看”的兴趣。
6. 禁止代码块。
7. 不要出现暴力恐吓等内容。
8. 如果是营销类，可以有商业话术。
9. 如果是骚扰类，可以是冒昧、阴阳怪气、纠缠式语气，但不能出现现实危险威胁。
10. 输出必须严格遵守格式：

---主题---
邮件主题

---正文---
邮件正文
`;

    const userPrompt = `
请生成一封陌生人来信。
要求主题自然，正文长度按邮件类型自然发挥。
不要为了控制长度而突然收尾，也不要省略关键信息。
`;

    try {
        showStatus('正在生成陌生人来信...', 'info');
        if (window.recordApiPending) window.recordApiPending();

        const aiResult = await callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]);

        const subjMatch = aiResult.match(/---主题---\s*([\s\S]*?)(?:\n---正文---|$)/);
        const bodyMatch = aiResult.match(/---正文---\s*([\s\S]*?)$/);

        let subject = subjMatch ? subjMatch[1].trim() : '';
        let body = bodyMatch ? bodyMatch[1].trim() : '';

        if (!subject) subject = '一封陌生来信';

        if (!body) {
            body = aiResult
                .replace(/---主题---[\s\S]*?(?=---正文---|$)/, '')
                .replace(/---正文---/, '')
                .trim();
        }

        if (!body) {
            body = '你好，冒昧来信。只是突然想找一个陌生人说几句话，如果你愿意回复，我会很感谢。';
        }

        const threadId = 'thread_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

        await DB.put('smsThreads', {
            id: threadId,
            maskId: activeAccount.maskId,
            accountId: activeAccount.id,
            sourceConversationId: null,
            peerType: 'stranger',
            peerKey: key,
            peerAddress: addr,
            peerDisplayName: sender,
            peerAvatar: stranger.avatar || '',
            subject,
            isSubscription: false,
            disguised: false,
            disguisedCharId: '',
            unread: true,
            createdAt: Date.now(),
            accountAvatarSnapshot: activeAccount.avatar || '',
            accountNameSnapshot: activeAccount.name || '',
            replyContext: {
                charId: '',
                conversationId: null,
                charName: sender,
                charDetail: `陌生来信者。本次来信类型：${selectedCategory}`,
                userName: isDefaultMailbox ? (mask?.name || '用户') : mailboxDisplayName,
                userDetail: '',
                mailboxIsAlias: !isDefaultMailbox,
                mailboxDisplayName,
                mailboxAddress
            }
        });

        await DB.put('smsMessages', {
            id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            threadId,
            senderName: sender,
            senderAddress: addr,
            body,
            timestamp: Date.now(),
            isReceived: true
        });

        stranger.updatedAt = Date.now();
        await DB.put('smsStrangerAccounts', stranger);

        showStatus(`收到一封陌生来信：${subject}`, 'success');

    } catch (e) {
        console.warn('AI陌生人来信生成失败', e);
        showStatus('陌生人来信生成失败: ' + e.message, 'error');
    }
}

        async function generateOnePureStrangerSpam(mask) {
    const isDefaultMailbox = !!activeAccount?.isDefault;
    const mailboxDisplayName = activeAccount?.name || '邮箱主人';
    const mailboxAddress = activeAccount?.address || '';

    const spamTemplates = [
        { subject: '系统风控提醒', body: '检测到您的邮箱存在异常登录尝试，请及时确认是否为本人操作。若非本人操作，请忽略陌生链接并留意账户安全。' },
        { subject: '快递派送失败通知', body: '您好，您有一件包裹因地址信息不完整导致派送失败。如仍需派送，请联系对应平台客服核对信息。' },
        { subject: '优惠券即将失效', body: '您账户中有一张专属权益券即将失效。若您近期有相关消费计划，可以查看活动页面了解详情。' },
        { subject: '合作邀约', body: '您好，我们正在寻找内容合作伙伴。若您对线上合作、内容共创或简单访谈感兴趣，可以回复本邮件进一步沟通。' },
        { subject: '匿名提问', body: '你好，我是一个偶然看到这个邮箱地址的路人。有一件小事想请教，不知道你方不方便聊聊？' },
        { subject: '深夜树洞', body: '有时候陌生人反而是最好的倾诉对象。今晚想找人说说话，不知道你愿不愿意当一个临时树洞。' },
        { subject: '一封道歉信', body: '我知道这封邮件很突然。我想为之前某件事道歉，但又不方便透露身份。如果你愿意听，我会慢慢说。' }
    ];

    const pick = spamTemplates[Math.floor(Math.random() * spamTemplates.length)];

    const stranger = await getOrCreateStrangerAccount(activeAccount.maskId, activeAccount.id);
    const key = stranger.key;
    const addr = stranger.address;
    const sender = stranger.displayName;

    const threadId = 'thread_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    await DB.put('smsThreads', {
        id: threadId,
        maskId: activeAccount.maskId,
        accountId: activeAccount.id,
        sourceConversationId: null,
        peerType: 'stranger',
        peerKey: key,
        peerAddress: addr,
        peerDisplayName: sender,
        peerAvatar: stranger.avatar || '',
        subject: pick.subject,
        isSubscription: false,
        disguised: false,
        disguisedCharId: '',
        unread: true,
        createdAt: Date.now(),
        accountAvatarSnapshot: activeAccount.avatar || '',
        accountNameSnapshot: activeAccount.name || '',
        replyContext: {
            charId: '',
            conversationId: null,
            charName: sender,
            charDetail: '陌生来信者',
            userName: isDefaultMailbox ? (mask?.name || '用户') : mailboxDisplayName,
            userDetail: '',
            mailboxIsAlias: !isDefaultMailbox,
            mailboxDisplayName,
            mailboxAddress
        }
    });

    await DB.put('smsMessages', {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        threadId,
        senderName: sender,
        senderAddress: addr,
        body: pick.body,
        timestamp: Date.now(),
        isReceived: true
    });

    stranger.updatedAt = Date.now();
    await DB.put('smsStrangerAccounts', stranger);

    showStatus('收到一封陌生来信', 'info');
}

        function randomStrangerName() {
            const arr = ['匿名用户', '路人甲', '未署名发件人', '夜间访客', '第三方渠道', '未知联系人', '漂流瓶', '树洞邮差', '过路人', '无名人'];
            return arr[Math.floor(Math.random() * arr.length)];
        }
        
        async function getOrCreateStrangerAccount(maskId, accountId) {
    const all = await DB.getAll('smsStrangerAccounts');
    const pool = all.filter(a => a.maskId === maskId && a.accountId === accountId);

    // 30% 复用旧陌生人，70% 新建，保证“有自己账号池”且会重复出现
    if (pool.length > 0 && Math.random() < 0.3) {
        return pool[Math.floor(Math.random() * pool.length)];
    }

    const id = 'sacct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const key = 'stranger_' + Math.random().toString(36).slice(2, 8);
    const address = `${key}@unknown.mail`;
    const displayName = randomStrangerName();

    const stranger = {
        id,
        maskId,
        accountId,
        key,
        address,
        displayName,
        avatar: '',
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    await DB.put('smsStrangerAccounts', stranger);
    return stranger;
}

        function pinyin(str) {
            return (str || '').split('').map(c => {
                const code = c.charCodeAt(0);
                if (code >= 19968 && code <= 40869) return String.fromCharCode(97 + (code % 26));
                return c.toLowerCase().replace(/[^a-z0-9]/g, '');
            }).join('').substring(0, 10) || 'user';
        }

        function formatCompactTime(timestamp) {
            const d = new Date(timestamp);
            const now = new Date();
            if (d.toDateString() === now.toDateString()) {
                return d.toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit', hour12:false });
            }
            return d.toLocaleDateString('zh-CN', { month:'numeric', day:'numeric' });
        }

        function getAvatarColor(name) {
            const colors = ['#1a73e8', '#d93025', '#188038', '#9334e6', '#f9ab00', '#00897b', '#5f6368'];
            const n = (name || '?').charCodeAt(0) || 65;
            return colors[n % colors.length];
        }

        window.smsModule = {
            init,
            openSMSPage: () => renderInbox()
        };

        init();
    };

})();