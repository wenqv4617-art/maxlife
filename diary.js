// ============================================
// 日记模块 - diary.js
// 版本：v1.0
// 说明：提供日记的创建、编辑、查看功能
//       支持荧光笔标注、小秘密、好友批注
// 依赖：需要全局 DB 对象（IndexedDB操作）
//      需要全局 showStatus 函数
//      需要全局 escapeHtml 函数
//      需要全局 getAvatarColor 函数
//      需要全局 getActiveMask 函数
//      需要全局 callLLM 函数（AI调用）
//      需要全局 recordApiPending 函数（API监控）
//      需要全局 switchPage 函数（页面导航）
// ============================================

(function() {
    "use strict";

    const DIARY_STORE = 'diaryEntries';

    // 日记编辑状态
    window.diaryIsEditMode = false;
    window.diaryCurrentMood = '😊';
    window.diaryCurrentId = null;

    // 缓存全局依赖
    let DB, showStatus, escapeHtml, getAvatarColor, getActiveMask, callLLM, recordApiPending, switchPage;

    // ==================== 初始化 ====================
    window.initDiaryModule = async function(deps) {
        if (deps) {
            DB = deps.DB;
            showStatus = deps.showStatus;
            escapeHtml = deps.escapeHtml;
            getAvatarColor = deps.getAvatarColor;
            getActiveMask = deps.getActiveMask;
            callLLM = deps.callLLM;
            recordApiPending = deps.recordApiPending;
            switchPage = deps.switchPage;
        } else {
            DB = window.DB;
            showStatus = window.showStatus || function(msg, type) { console.log(`[${type}] ${msg}`); };
            escapeHtml = window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
            getAvatarColor = window.getAvatarColor || function(name) { const colors = ['#f39c12','#3498db','#e67e22','#2ecc71','#9b59b6','#1abc9c','#e74c3c']; return colors[(name||'?').charCodeAt(0)%colors.length]; };
            getActiveMask = window.getActiveMask || async function() { return null; };
            callLLM = window.callLLM;
            recordApiPending = window.recordApiPending || function() {};
            switchPage = window.switchPage || function() {};
        }

        console.log('📔 日记模块已加载');
        bindDiaryEvents();
        await renderDiaryList();
    };

    // ==================== 事件绑定 ====================
    function bindDiaryEvents() {
    if (window._diaryEventsBound) return;
    window._diaryEventsBound = true;
        // 返回按钮
        document.getElementById('backFromDiaryBtn')?.addEventListener('click', () => switchPage('desktop'));
        document.getElementById('backFromDiaryDetailBtn')?.addEventListener('click', () => {
            if (window.diaryIsEditMode) {
                diarySaveCurrent();
            }
            switchPage('diary');
            renderDiaryList();
        });

        // 新建日记
        document.getElementById('diaryNewBtn')?.addEventListener('click', diaryCreateNew);

        // 删除日记
        document.getElementById('diaryDeleteBtn')?.addEventListener('click', async () => {
            if (!window.diaryCurrentId) return;
            if (!confirm('确定要删除这篇日记吗？此操作不可恢复！')) return;
            await DB.delete('diaryEntries', window.diaryCurrentId);
            window.diaryCurrentId = null;
            window.diaryIsEditMode = false;
            switchPage('diary');
            await renderDiaryList();
        });

        // 切换编辑/查看模式
        document.getElementById('diaryToggleEditBtn')?.addEventListener('click', async (e) => {
    e.stopImmediatePropagation();
            if (window.diaryIsEditMode) {
                await diarySaveCurrent();
                window.diaryIsEditMode = false;
            } else {
                window.diaryIsEditMode = true;
            }
            await diaryRenderDetail();
        });

        // 心情选择
        document.getElementById('diaryMoodSelector')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.diary-mood-btn');
            if (!btn) return;
            window.diaryCurrentMood = btn.dataset.mood;
            document.querySelectorAll('.diary-mood-btn').forEach(b => {
                b.classList.toggle('selected', b.dataset.mood === window.diaryCurrentMood);
            });
        });

        // 荧光笔按钮
        document.querySelectorAll('.diary-color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                diaryApplyHighlight(btn.dataset.color);
            });
        });

        // 小秘密按钮
        document.getElementById('diarySecretBtn')?.addEventListener('click', diaryApplySecret);

        // 邀请批注按钮
        document.getElementById('diaryInviteAnnotationBtn')?.addEventListener('click', diaryShowAnnotationPicker);

        // 点击小秘密文字显示/隐藏
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('secret-text')) {
                e.stopPropagation();
                e.target.classList.toggle('revealed');
            } else {
                document.querySelectorAll('.secret-text.revealed').forEach(span => {
                    span.classList.remove('revealed');
                });
            }
        });
    }

    // ==================== 数据操作 ====================
    async function getDiaryEntries() {
        const entries = await DB.getAll(DIARY_STORE);
        return entries || [];
    }

    function getTodayDateStr() {
        const d = new Date();
        return d.toISOString().split('T')[0];
    }

    function formatDiaryDate(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
        }
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
    }

    // ==================== 日记列表 ====================
    async function renderDiaryList() {
        const entries = await getDiaryEntries();
        const container = document.getElementById('diaryListContainer');
        if (!container) return;

        if (entries.length === 0) {
            container.innerHTML = '<div class="diary-empty-list">✍️ 还没有日记，点击右上角开始记录</div>';
            return;
        }

        const sorted = entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        let html = '';
        sorted.forEach(entry => {
            const titleText = entry.title || '无标题';
            const moodEmoji = entry.mood || '😊';
            html += `
                <div class="diary-card" data-id="${entry.id}">
                    <div class="diary-card-date">${formatDiaryDate(entry.date)}</div>
                    <div class="diary-card-title">${escapeHtml(titleText)}</div>
                    <div class="diary-card-mood">${moodEmoji}</div>
                </div>`;
        });
        container.innerHTML = html;

        container.querySelectorAll('.diary-card').forEach(card => {
            card.addEventListener('click', () => {
                diaryOpenDetail(card.dataset.id);
            });
        });
    }

    async function diaryOpenDetail(id) {
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === id);
        if (!entry) return;

        window.diaryCurrentId = id;
        window.diaryIsEditMode = false;
        window.diaryCurrentMood = entry.mood || '😊';

        await diaryRenderDetail();
        switchPage('diary-detail');
    }

    async function diaryCreateNew() {
        const newEntry = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 6),
            date: getTodayDateStr(),
            title: '',
            content: '',
            mood: '😊',
            richContent: ''
        };
        await DB.put(DIARY_STORE, newEntry);

        window.diaryCurrentId = newEntry.id;
        window.diaryIsEditMode = true;
        window.diaryCurrentMood = '😊';

        await diaryRenderDetail();
        switchPage('diary-detail');

        setTimeout(() => {
            const editable = document.getElementById('diaryEditableBody');
            if (editable) editable.focus();
        }, 100);
    }

    // ==================== 日记详情渲染 ====================
    async function diaryRenderDetail() {
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === window.diaryCurrentId);
        if (!entry) return;

        document.getElementById('diaryDetailDate').textContent = formatDiaryDate(entry.date);
        document.getElementById('diaryDetailTitle').textContent = entry.title || '日记';

        const titleInput = document.getElementById('diaryTitleInput');
        const titleView = document.getElementById('diaryTitleView');
        const bodyView = document.getElementById('diaryBodyView');
        const editableBody = document.getElementById('diaryEditableBody');
        const toolbar = document.getElementById('diaryFormatToolbar');
        const toggleBtn = document.getElementById('diaryToggleEditBtn');
        const deleteBtn = document.getElementById('diaryDeleteBtn');
        const annotationsSection = document.getElementById('diaryAnnotationsSection');

        // 心情选择器高亮
        document.querySelectorAll('.diary-mood-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.mood === window.diaryCurrentMood);
        });

        if (window.diaryIsEditMode) {
            // 编辑模式
            if (titleInput) { titleInput.style.display = ''; titleInput.value = entry.title || ''; }
            if (titleView) titleView.style.display = 'none';
            if (bodyView) bodyView.style.display = 'none';
            if (editableBody) { editableBody.style.display = ''; editableBody.innerHTML = entry.richContent || ''; }
            if (toolbar) toolbar.style.display = 'flex';
            if (toggleBtn) toggleBtn.textContent = '💾';
            if (deleteBtn) deleteBtn.style.display = '';
            if (annotationsSection) annotationsSection.style.display = 'none';
        } else {
            // 查看模式
            if (titleInput) titleInput.style.display = 'none';
            if (titleView) { titleView.style.display = ''; titleView.textContent = entry.title || '无标题'; }
            if (editableBody) editableBody.style.display = 'none';
            if (bodyView) { bodyView.style.display = ''; bodyView.innerHTML = entry.richContent || '✨ 暂无内容'; }
            if (toolbar) toolbar.style.display = 'none';
            if (toggleBtn) toggleBtn.textContent = '✎';
            if (deleteBtn) deleteBtn.style.display = 'none';

            if (annotationsSection) {
                annotationsSection.style.display = '';
                await diaryRenderAnnotations();
            }

            // 绑定小秘密点击事件
            bodyView?.querySelectorAll('.secret-text').forEach(span => {
                span.onclick = function(e) {
                    e.stopPropagation();
                    this.classList.toggle('revealed');
                };
            });
        }
    }

    async function diarySaveCurrent() {
        if (!window.diaryCurrentId) return;
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === window.diaryCurrentId);
        if (!entry) return;

        entry.title = document.getElementById('diaryTitleInput').value.trim();
        entry.mood = window.diaryCurrentMood;
        entry.richContent = document.getElementById('diaryEditableBody').innerHTML;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = entry.richContent;
        entry.content = tempDiv.textContent || '';

        await DB.put(DIARY_STORE, entry);
    }

    // ==================== 荧光笔 & 小秘密 ====================
    function diaryApplyHighlight(colorClass) {
        if (!window.diaryIsEditMode) return;

        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) {
            alert('请先选择要标记的文字');
            return;
        }

        const editableBody = document.getElementById('diaryEditableBody');
        const range = selection.getRangeAt(0);

        if (!editableBody.contains(range.commonAncestorContainer)) {
            alert('请在编辑区内选择文字');
            return;
        }

        const span = document.createElement('span');
        span.className = colorClass;

        try {
            range.surroundContents(span);
            selection.removeAllRanges();
            editableBody.focus();
        } catch (e) {
            const contents = range.extractContents();
            const newSpan = document.createElement('span');
            newSpan.className = colorClass;
            newSpan.appendChild(contents);
            range.insertNode(newSpan);
            selection.removeAllRanges();
            editableBody.focus();
        }
    }

    function diaryApplySecret() {
        if (!window.diaryIsEditMode) return;

        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) {
            alert('请先选择要隐藏的文字');
            return;
        }

        const editableBody = document.getElementById('diaryEditableBody');
        const range = selection.getRangeAt(0);

        if (!editableBody.contains(range.commonAncestorContainer)) {
            alert('请在编辑区内选择文字');
            return;
        }

        const span = document.createElement('span');
        span.className = 'secret-text';
        span.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('revealed');
        });

        try {
            range.surroundContents(span);
            selection.removeAllRanges();
            editableBody.focus();
        } catch (e) {
            const contents = range.extractContents();
            const newSpan = document.createElement('span');
            newSpan.className = 'secret-text';
            newSpan.appendChild(contents);
            newSpan.addEventListener('click', function(ev) {
                ev.stopPropagation();
                this.classList.toggle('revealed');
            });
            range.insertNode(newSpan);
            selection.removeAllRanges();
            editableBody.focus();
        }
    }

    // ==================== 批注功能 ====================
    async function diaryGetAnnotationFriends() {
        const activeMaskId = await DB.getSetting('activeUserProfileId');
        const allConvs = await DB.getAll('conversations');
        const maskConvs = activeMaskId ? allConvs.filter(c => c.maskId === activeMaskId) : allConvs;
        const charIds = [...new Set(maskConvs.map(c => c.charId))];
        const friends = [];

        for (const charId of charIds) {
            const char = await DB.get('characters', charId);
            if (char) {
                const conv = maskConvs.find(c => c.charId === charId);
                let avatar = char.avatar || '';
                const convDetail = conv ? await DB.get('convDetails', conv.id) : null;
                if (convDetail && convDetail.charAvatar) {
                    avatar = convDetail.charAvatar;
                }

                friends.push({
                    charId: char.id,
                    name: char.name,
                    avatar: avatar,
                    convId: conv ? conv.id : null
                });
            }
        }

        return friends;
    }

    async function diaryShowAnnotationPicker() {
        const friends = await diaryGetAnnotationFriends();
        const existingModal = document.querySelector('.diary-annotation-picker-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.className = 'diary-annotation-picker-modal';

        let listHtml = '';
        if (friends.length === 0) {
            listHtml = '<div class="diary-annotation-picker-empty">暂无好友可邀请<br><span style="font-size:12px;">请先创建对话</span></div>';
        } else {
            const entries = await getDiaryEntries();
            const entry = entries.find(e => e.id === window.diaryCurrentId);
            const existingAnnotations = entry?.annotations || [];
            const existingCharIds = existingAnnotations.map(a => a.charId);

            friends.forEach(f => {
                const isExisting = existingCharIds.includes(f.charId);
                const avatarStyle = f.avatar ? `background-image: url('${f.avatar}'); background-size: cover; background-position: center;` : '';
                const bgColor = getAvatarColor(f.name);

                listHtml += `
                    <div class="diary-annotation-picker-item${isExisting ? ' selected' : ''}" 
                         data-char-id="${f.charId}" 
                         data-char-name="${escapeHtml(f.name)}" 
                         data-char-avatar="${escapeHtml(f.avatar)}" 
                         data-conv-id="${f.convId || ''}">
                        <div class="diary-annotation-picker-avatar" style="background-color: ${bgColor}; ${avatarStyle}">${f.avatar ? '' : f.name.charAt(0)}</div>
                        <div class="diary-annotation-picker-info">
                            <div class="diary-annotation-picker-name">${escapeHtml(f.name)}</div>
                        </div>
                        <div class="diary-annotation-picker-check">✓</div>
                    </div>`;
            });
        }

        modal.innerHTML = `
            <div class="diary-annotation-picker-card">
                <div class="diary-annotation-picker-header">
                    <span class="diary-annotation-picker-title">📝 邀请好友批注</span>
                    <button class="diary-viewer-close picker-close-btn">✕</button>
                </div>
                <div class="diary-annotation-picker-list">${listHtml}</div>
                <div class="diary-annotation-picker-footer">
                    <span id="annotationPickerCount" style="flex:1; font-size:12px; color:#7a8a7e;">已选 0 人</span>
                    <button class="small-btn clickable picker-cancel-btn">取消</button>
                    <button class="small-btn clickable picker-confirm-btn" style="background:#7a9e7e;color:white;">生成批注</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        let selectedCharIds = new Set();
        modal.querySelectorAll('.diary-annotation-picker-item.selected').forEach(item => {
            selectedCharIds.add(item.dataset.charId);
        });
        updateSelectedCount();

        function updateSelectedCount() {
            const countEl = document.getElementById('annotationPickerCount');
            if (countEl) countEl.textContent = '已选 ' + selectedCharIds.size + ' 人';
        }

        modal.querySelectorAll('.diary-annotation-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const charId = item.dataset.charId;
                if (selectedCharIds.has(charId)) {
                    selectedCharIds.delete(charId);
                    item.classList.remove('selected');
                } else {
                    selectedCharIds.add(charId);
                    item.classList.add('selected');
                }
                updateSelectedCount();
            });
        });

        const closeModal = () => modal.remove();
        modal.querySelector('.picker-close-btn')?.addEventListener('click', closeModal);
        modal.querySelector('.picker-cancel-btn')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        modal.querySelector('.picker-confirm-btn')?.addEventListener('click', async () => {
            if (selectedCharIds.size === 0) return;
            closeModal();

            const selectedFriends = [];
            modal.querySelectorAll('.diary-annotation-picker-item.selected').forEach(item => {
                selectedFriends.push({
                    charId: item.dataset.charId,
                    name: item.dataset.charName,
                    avatar: item.dataset.charAvatar,
                    convId: item.dataset.convId
                });
            });

            await diaryGenerateAnnotations(selectedFriends);
        });
    }

    async function diaryGenerateAnnotations(friends) {
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === window.diaryCurrentId);
        if (!entry) return;

        const diaryContent = (entry.richContent || entry.content || '').replace(/<[^>]*>/g, '');
        if (!diaryContent.trim()) {
            showStatus('日记内容为空，无法生成批注', 'error');
            return;
        }

        const activeMask = await getActiveMask();
        const userName = activeMask?.name || '用户';
        const userBio = activeMask?.bio || '';

        if (!entry.annotations) entry.annotations = [];

        for (const friend of friends) {
            const existingIndex = entry.annotations.findIndex(a => a.charId === friend.charId);
            if (existingIndex >= 0) {
                entry.annotations.splice(existingIndex, 1);
            }

            entry.annotations.push({
                charId: friend.charId,
                charName: friend.name,
                charAvatar: friend.avatar,
                content: '',
                loading: true,
                createdAt: Date.now()
            });
        }

        await DB.put(DIARY_STORE, entry);
        await diaryRenderAnnotations();

        for (let i = 0; i < friends.length; i++) {
            const friend = friends[i];

            try {
                const annotationContent = await diaryCallAnnotationAPI(friend, diaryContent, userName, userBio);

                const updatedEntries = await getDiaryEntries();
                const updatedEntry = updatedEntries.find(e => e.id === window.diaryCurrentId);
                if (updatedEntry && updatedEntry.annotations) {
                    const annotationIndex = updatedEntry.annotations.findIndex(
                        a => a.charId === friend.charId && a.loading
                    );
                    if (annotationIndex >= 0) {
                        updatedEntry.annotations[annotationIndex].content = annotationContent;
                        updatedEntry.annotations[annotationIndex].loading = false;
                        await DB.put(DIARY_STORE, updatedEntry);
                    }
                }
            } catch (e) {
                const updatedEntries = await getDiaryEntries();
                const updatedEntry = updatedEntries.find(e => e.id === window.diaryCurrentId);
                if (updatedEntry && updatedEntry.annotations) {
                    updatedEntry.annotations = updatedEntry.annotations.filter(
                        a => !(a.charId === friend.charId && a.loading)
                    );
                    await DB.put(DIARY_STORE, updatedEntry);
                }
                console.error('批注生成失败:', friend.name, e);
            }

            await diaryRenderAnnotations();
        }
    }

    async function diaryCallAnnotationAPI(friend, diaryContent, userName, userBio) {
        const char = await DB.get('characters', friend.charId);
        if (!char) throw new Error('角色不存在');

        let worldbookContext = '';
        const allWorldbooks = await DB.getAll('worldbooks');

        if (friend.convId) {
            const convDetail = await DB.get('convDetails', friend.convId);
            const mountedIds = convDetail?.worldbookIds || [];
            for (const wb of allWorldbooks) {
                if (mountedIds.includes(wb.id)) {
                    worldbookContext += `\n【${wb.title}】\n${wb.content}\n`;
                }
            }
        }

        for (const wb of allWorldbooks) {
            if ((wb.mountScenes || []).includes('diary') && (wb.mountChars || []).includes(char.id)) {
                if (!worldbookContext.includes(wb.title)) {
                    worldbookContext += `\n【${wb.title}】\n${wb.content}\n`;
                }
            }
        }

        let contextSummary = '';
        if (friend.convId) {
            const chats = await DB.queryByIndex('chats', 'conversationId', friend.convId);
            const displayChats = chats
                .filter(c => c.messageType !== 'innerVoice')
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                .slice(-6);

            if (displayChats.length > 0) {
                contextSummary = '\n【近期对话上下文】\n';
                displayChats.forEach(c => {
                    const roleLabel = c.role === 'user' ? userName : char.name;
                    contextSummary += `${roleLabel}: ${c.content}\n`;
                });
            }

            const memories = await DB.queryByIndex('memories', 'conversationId', friend.convId);
            const coreMemories = memories
                .filter(m => m.type === 'core_memory')
                .sort((a, b) => b.createdAt - a.createdAt);

            if (coreMemories.length > 0) {
                contextSummary += '\n【核心记忆】\n';
                coreMemories.forEach(m => {
                    contextSummary += `• ${m.content}\n`;
                });
            }
        }

        const prompt = `你是${char.name}。以下是你的角色设定：

${char.detail || ''}

${worldbookContext ? '【世界书设定】' + worldbookContext : ''}

${contextSummary}

你正在阅读你的朋友「${userName}」的日记。以下是日记内容：

---
${diaryContent}
---

请以第一人称，用书信文体为这篇日记写一段批注。要求：
1. 字数在 100-450 字之间
2. 像写信一样，可以称呼对方为「你」
3. 分享你的感受、想法或相关的回忆
4. 语气要符合你的性格和你们的关系
5. 保持温暖、真诚，不要说教
6. 直接输出批注内容，不要加任何前缀或格式标记`;

        if (recordApiPending) recordApiPending();
        const result = await callLLM(
            [{ role: 'user', content: prompt }], 
            { maxTokens: 600, temperature: 0.8 }
        );

        return result.trim();
    }

    async function diaryDeleteAnnotation(charId) {
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === window.diaryCurrentId);
        if (!entry || !entry.annotations) return;

        if (!confirm('确定删除这条批注吗？')) return;

        entry.annotations = entry.annotations.filter(a => a.charId !== charId);
        await DB.put(DIARY_STORE, entry);
        await diaryRenderAnnotations();
    }

    async function diaryRenderAnnotations() {
        const entries = await getDiaryEntries();
        const entry = entries.find(e => e.id === window.diaryCurrentId);
        const container = document.getElementById('diaryAnnotationsList');
        if (!container) return;

        const annotations = entry?.annotations || [];

        if (annotations.length === 0) {
            container.innerHTML = '<div class="annotation-empty">📝 暂无批注，点击上方按钮邀请好友</div>';
            return;
        }

        let html = '';
        annotations.forEach((a, idx) => {
            const avatarStyle = a.charAvatar ? `background-image: url('${a.charAvatar}'); background-size: cover; background-position: center;` : '';

            if (a.loading === true && !a.content) {
                html += `
                    <div class="annotation-item">
                        <div class="annotation-header">
                            <div class="annotation-avatar" style="background-color: ${getAvatarColor(a.charName)}; ${avatarStyle}">${a.charAvatar ? '' : a.charName.charAt(0)}</div>
                            <span class="annotation-name">${escapeHtml(a.charName)}</span>
                        </div>
                        <div class="annotation-loading">正在阅读日记...</div>
                    </div>`;
            } else {
                const contentPreview = (a.content || '').replace(/<[^>]*>/g, '').substring(0, 40);
                html += `
                    <div class="annotation-item collapsed" data-annotation-idx="${idx}">
                        <div class="annotation-header" style="cursor:pointer;" onclick="window.diaryToggleAnnotation(${idx})">
                            <div class="annotation-avatar" style="background-color: ${getAvatarColor(a.charName)}; ${avatarStyle}">${a.charAvatar ? '' : a.charName.charAt(0)}</div>
                            <span class="annotation-name">${escapeHtml(a.charName)}</span>
                            <button class="annotation-toggle-btn" title="展开">▶</button>
                            <button class="annotation-delete-btn" onclick="event.stopPropagation(); window.diaryDeleteAnnotationGlobal('${a.charId}')" title="删除">🗑️</button>
                        </div>
                        <div class="annotation-preview-hint">${escapeHtml(contentPreview)}${contentPreview.length >= 40 ? '...' : ''}</div>
                        <div class="annotation-content">${escapeHtml(a.content)}</div>
                    </div>`;
            }
        });
        container.innerHTML = html;
    }

    // 挂载到 window 以便 onclick 调用
    window.diaryDeleteAnnotationGlobal = diaryDeleteAnnotation;

    window.diaryToggleAnnotation = function(idx) {
        const container = document.getElementById('diaryAnnotationsList');
        if (!container) return;
        const item = container.querySelector(`.annotation-item[data-annotation-idx="${idx}"]`);
        if (!item) return;

        const isCollapsed = item.classList.contains('collapsed');
        const toggleBtn = item.querySelector('.annotation-toggle-btn');
        const previewHint = item.querySelector('.annotation-preview-hint');

        if (isCollapsed) {
            item.classList.remove('collapsed');
            if (toggleBtn) toggleBtn.textContent = '▼';
            if (previewHint) previewHint.style.display = 'none';
        } else {
            item.classList.add('collapsed');
            if (toggleBtn) toggleBtn.textContent = '▶';
            if (previewHint) previewHint.style.display = '';
        }
    };

    console.log('📔 日记模块脚本已就绪，等待 initDiaryModule() 调用');
})();
