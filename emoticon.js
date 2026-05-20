/* ========== 表情包模块 ========== */
window.initEmoticonModule = function({ DB, showStatus, escapeHtml, getAvatarColor, compressImage, callLLM, switchPage }) {

    // ========== 状态变量 ==========
    let currentEmoticonGroupId = null;
    let emoticonPickerOpen = false;

    // ========== 表情包管理页 ==========
    async function renderEmoticonPage() {
        const groups = await DB.getAll('emoticonGroups');
        groups.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const gl = document.getElementById('emoticonGroupList');
        if (!gl) return;
        let html = groups.map(g =>
            `<div class="emoticon-group-item ${g.id===currentEmoticonGroupId?'active':''}" data-group-id="${g.id}">${escapeHtml(g.name)}</div>`
        ).join('');
        html += '<div class="emoticon-add-group" id="emoticonAddGroupBtn">+ 新建分组</div>';
        gl.innerHTML = html;

        gl.querySelectorAll('.emoticon-group-item').forEach(item => item.addEventListener('click', () => {
            currentEmoticonGroupId = item.dataset.groupId;
            renderEmoticonPage();
        }));

        document.getElementById('emoticonAddGroupBtn')?.addEventListener('click', async () => {
            const name = prompt('请输入分组名称：');
            if (name && name.trim()) {
                await DB.put('emoticonGroups', { id: 'emogroup_' + Date.now(), name: name.trim(), createdAt: Date.now() });
                currentEmoticonGroupId = null;
                await renderEmoticonPage();
            }
        });

        await renderEmoticonGrid();
    }

    async function renderEmoticonGrid() {
        const grid = document.getElementById('emoticonGrid');
        if (!grid) return;
        if (!currentEmoticonGroupId) {
            grid.innerHTML = '<div class="emoticon-empty">请选择左侧分组</div>';
            return;
        }
        const items = await DB.queryByIndex('emoticonItems', 'groupId', currentEmoticonGroupId);
        items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (items.length === 0) {
            grid.innerHTML = '<div class="emoticon-empty">该分组暂无表情包<br>使用上方按钮导入</div>';
            return;
        }
        grid.innerHTML = items.map(item =>
            `<div class="emoticon-card" data-item-id="${item.id}"><img src="${item.url}" alt="${escapeHtml(item.text)}" onerror="this.src='data:image/svg+xml,${encodeURIComponent('<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23eee%22/><text x=%2250%22 y=%2260%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%23999%22>加载失败</text></svg>')}"><div class="emoticon-card-text">${escapeHtml(item.text||'未设置说明')}</div></div>`
        ).join('');

        grid.querySelectorAll('.emoticon-card').forEach(card => card.addEventListener('click', () =>
            openEmoticonEditor(card.dataset.itemId)));
    }

    async function openEmoticonEditor(itemId) {
        const item = await DB.get('emoticonItems', parseInt(itemId));
        if (!item) return;
        document.getElementById('emoticonEditId').value = item.id;
        document.getElementById('emoticonEditGroupId').value = item.groupId;
        document.getElementById('emoticonEditText').value = item.text || '';
        document.getElementById('emoticonEditPreview').src = item.url;
        document.getElementById('emoticonEditModal').classList.add('active');
    }

    async function addEmoticon(groupId, url, text) {
    const id = Date.now() + Math.floor(Math.random() * 1000);

    const item = {
        id,
        groupId,
        url,
        text: text || '',
        createdAt: Date.now()
    };

    await DB.put('emoticonItems', item);
    return item;
}

    async function uploadEmoticonFile() {
        if (!currentEmoticonGroupId) { showStatus('请先选择分组', 'error'); return; }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const dataUrl = await compressImage(file, 300, 300, 0.8);
            const item = await addEmoticon(currentEmoticonGroupId, dataUrl, '');
            await renderEmoticonGrid();
            openEmoticonEditor(item.id);
        };
        input.click();
    }

    async function addEmoticonUrl() {
        if (!currentEmoticonGroupId) { showStatus('请先选择分组', 'error'); return; }
        const url = prompt('请输入表情包图片URL:');
        if (url && url.trim()) {
            const item = await addEmoticon(currentEmoticonGroupId, url.trim(), '');
            await renderEmoticonGrid();
            openEmoticonEditor(item.id);
        }
    }

    function batchImport() {
        if (!currentEmoticonGroupId) { showStatus('请先选择分组', 'error'); return; }
        document.getElementById('emoticonBatchText').value = '';
        document.getElementById('emoticonBatchModal').classList.add('active');
    }

    async function doBatchImport() {
        const text = document.getElementById('emoticonBatchText').value.trim();
        if (!text) return;
        const lines = text.split('\n').filter(l => l.trim());
        let sc = 0, fc = 0;
        for (const line of lines) {
            let cleanLine = line.trim();
            if (cleanLine.endsWith(';')) cleanLine = cleanLine.slice(0, -1).trim();
            const urlMatch = cleanLine.match(/https?:\/\//);
            if (!urlMatch) { fc++; continue; }
            const splitIndex = urlMatch.index;
            const et = cleanLine.substring(0, splitIndex).trim();
            const finalText = et.replace(/[：:]$/, '').trim();
            const url = cleanLine.substring(splitIndex).trim();
            if (!finalText || !url) { fc++; continue; }
            try {
                await addEmoticon(currentEmoticonGroupId, url, finalText);
                sc++;
            } catch (e) { fc++; }
        }
        document.getElementById('emoticonBatchModal').classList.remove('active');
        await renderEmoticonGrid();
        showStatus(`导入完成！成功 ${sc} 个，失败 ${fc} 个`, sc > 0 ? 'success' : 'error');
    }

    async function deleteEmoticonGroup() {
        if (!currentEmoticonGroupId) return;
        if (!confirm('确定删除该分组及所有表情包吗？')) return;
        const items = await DB.queryByIndex('emoticonItems', 'groupId', currentEmoticonGroupId);
        for (const item of items) await DB.delete('emoticonItems', item.id);
        await DB.delete('emoticonGroups', currentEmoticonGroupId);
        currentEmoticonGroupId = null;
        await renderEmoticonPage();
        showStatus('✅ 分组已删除', 'success');
    }

    // ========== 表情包选择器 ==========
    async function renderEmoticonPicker() {
        const convId = window.currentConversationId;
        let availableIds = [];
        if (convId) {
            const cd = await DB.get('convDetails', convId);
            if (cd && cd.emoticonGroupIds) availableIds = cd.emoticonGroupIds;
        }
        const allGroups = await DB.getAll('emoticonGroups');
        const groups = availableIds.length > 0 ? allGroups.filter(g => availableIds.includes(g.id)) : allGroups;
        groups.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const tc = document.getElementById('emoticonPickerTabs');
        if (!tc) return;
        tc.innerHTML = groups.map((g, i) =>
            `<button class="emoticon-picker-tab ${i===0?'active':''}" data-group-id="${g.id}">${escapeHtml(g.name)}</button>`
        ).join('') || '<span style="font-size:12px;color:#a0a8a2;padding:8px;">暂无可用表情包</span>';

        tc.querySelectorAll('.emoticon-picker-tab').forEach(tab => tab.addEventListener('click', async () => {
            tc.querySelectorAll('.emoticon-picker-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            await renderPickerGrid(tab.dataset.groupId);
        }));

        if (groups.length > 0) await renderPickerGrid(groups[0].id);
        else {
            const grid = document.getElementById('emoticonPickerGrid');
            if (grid) grid.innerHTML = '<div class="emoticon-picker-empty">暂无可用表情包</div>';
        }
    }

    async function renderPickerGrid(groupId) {
        const grid = document.getElementById('emoticonPickerGrid');
        if (!grid) return;
        const items = await DB.queryByIndex('emoticonItems', 'groupId', groupId);
        items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        if (items.length === 0) {
            grid.innerHTML = '<div class="emoticon-picker-empty">该分组暂无表情包</div>';
            return;
        }
        grid.innerHTML = items.map(item =>
            `<div class="emoticon-picker-item" data-item-id="${item.id}"><img src="${item.url}" alt="${escapeHtml(item.text)}" onerror="this.style.display='none'"><div class="emoticon-picker-item-text">${escapeHtml(item.text||'无说明')}</div></div>`
        ).join('');

        grid.querySelectorAll('.emoticon-picker-item').forEach(el => el.addEventListener('click', async () => {
            const item = await DB.get('emoticonItems', parseInt(el.dataset.itemId));
            if (item) {
                await sendEmoticonMessage(item);
                document.getElementById('emoticonPicker').classList.remove('active');
                emoticonPickerOpen = false;
            }
        }));
    }

    function toggleEmoticonPicker() {
        emoticonPickerOpen = !emoticonPickerOpen;
        const picker = document.getElementById('emoticonPicker');
        if (!picker) return;
        if (emoticonPickerOpen) {
            renderEmoticonPicker();
            picker.classList.add('active');
        } else {
            picker.classList.remove('active');
        }
    }

    function setupEmoticonPickerDismiss() {
        document.addEventListener('click', function(e) {
            if (!emoticonPickerOpen) return;
            const picker = document.getElementById('emoticonPicker');
            const expandMenu = document.getElementById('expandMenu');
            const expandBtn = document.getElementById('expandMenuBtn');
            if (!picker) return;
            if (!picker.contains(e.target) &&
                !expandMenu.contains(e.target) &&
                e.target !== expandBtn &&
                !expandBtn.contains(e.target)) {
                emoticonPickerOpen = false;
                picker.classList.remove('active');
            }
        });
    }

    // ========== 发送表情包消息 ==========
    async function sendEmoticonMessage(item) {
        const convId = window.currentConversationId;
        if (!convId) { showStatus('请先选择对话', 'error'); return; }
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        await DB.put('chats', {
            role: 'user',
            content: JSON.stringify({ url: item.url, text: item.text }),
            messageType: 'emoticon',
            conversationId: convId,
            charId: conv.charId,
            timestamp: Date.now()
        });
        await DB.put('conversations', { ...conv, updatedAt: Date.now() });
        if (window.loadConversationMessages) await window.loadConversationMessages(convId);
    }

    // ========== Prompt 中的表情包段落 ==========
    async function buildEmoticonSection(convId) {
        if (!convId) return '';
        const cd = await DB.get('convDetails', convId);
        if (!cd || !cd.emoticonGroupIds || cd.emoticonGroupIds.length === 0) return '';
        const allItems = await DB.getAll('emoticonItems');
        const mounted = allItems.filter(item => cd.emoticonGroupIds.includes(item.groupId));
        if (mounted.length === 0) return '';
        let section = '\n\n【可用表情包】\n你可以使用以下表情包来表达情绪。在消息中使用格式：[MSG]表情包:文字说明\n';
        mounted.forEach(item => { section += `- ${item.text}\n`; });
        return section;
    }

    function getEmoticonPromptRule(hasEmoticon) {
        if (hasEmoticon) {
            return '你可以偶尔使用表情包，格式为 [MSG]表情包:文字说明，且文字说明必须完全来自【可用表情包】列表中列出的内容，不要自创。';
        }
        return '不要使用表情包格式。';
    }

    function wrapUserEmoticonForAI(content) {
        try {
            const p = JSON.parse(content);
            return `（对方发了一个表情包：${p.text}）`;
        } catch (e) {
            return content;
        }
    }

    // ========== AI 回复解析 ==========
    function parseAIResponse(response) {
        const messages = [];
        const lines = response.split('\n').filter(l => l.trim());
        for (const line of lines) {
            const regex = /\[EMOTICON:([^\]]+)\]/g;
            let match, lastIdx = 0;
            let textAccum = '';
            while ((match = regex.exec(line)) !== null) {
                if (match.index > lastIdx) textAccum += line.substring(lastIdx, match.index);
                if (textAccum.trim()) { messages.push({ type: 'text', content: textAccum.trim() }); textAccum = ''; }
                messages.push({ type: 'emoticon', text: match[1] });
                lastIdx = match.index + match[0].length;
            }
            if (lastIdx < line.length) textAccum += line.substring(lastIdx);
            if (textAccum.trim()) messages.push({ type: 'text', content: textAccum.trim() });
        }
        if (messages.length === 0 && response.trim()) messages.push({ type: 'text', content: response.trim() });
        return messages;
    }

    async function saveAIEmoticonMessages(convId, charId, parsed, baseTime) {
        for (let i = 0; i < parsed.length; i++) {
            const msg = parsed[i];
            if (msg.type === 'emoticon') {
                const allItems = await DB.getAll('emoticonItems');
                const matched = allItems.find(item => item.text === msg.text);
                const content = matched
                    ? JSON.stringify({ url: matched.url, text: matched.text })
                    : JSON.stringify({ url: '', text: msg.text });
                await DB.put('chats', {
                    role: 'assistant', content, messageType: 'emoticon',
                    conversationId: convId, charId: charId, timestamp: baseTime + i
                });
            } else {
                await DB.put('chats', {
                    role: 'assistant', content: msg.content, messageType: 'text',
                    conversationId: convId, charId: charId, timestamp: baseTime + i
                });
            }
        }
    }

    // ========== 对话详情挂载 ==========
    async function renderConvDetailEmoticonList(convId) {
        const container = document.getElementById('convDetailEmoticonList');
        if (!container) return;
        const cd = await DB.get('convDetails', convId);
        const emoticonGroupIds = cd?.emoticonGroupIds || [];
        const groups = await DB.getAll('emoticonGroups');
        container.innerHTML = groups.length === 0
            ? '<p style="color:#a0a8a2;padding:12px;">暂无表情包分组</p>'
            : groups.map(g =>
                `<label class="mount-checkbox"><input type="checkbox" value="${g.id}" class="conv-detail-em-checkbox" ${emoticonGroupIds.includes(g.id)?'checked':''}><span>😊 ${escapeHtml(g.name)}</span></label>`
            ).join('');
    }

    function collectEmoticonGroupIds() {
        const ids = [];
        document.querySelectorAll('.conv-detail-em-checkbox:checked').forEach(cb => ids.push(cb.value));
        return ids;
    }

    // ========== 渲染对话消息中的表情包 ==========
    function renderEmoticonBubble(item) {
        let url = '', text = '';
        if (item.content && item.content.startsWith('{')) {
            try { const p = JSON.parse(item.content); url = p.url; text = p.text; } catch (e) {}
        }
        const rc = item.role === 'assistant' ? 'other' : 'self';
        const charName = window.currentCharName || '?';
        const isAI = item.role === 'assistant';
        return `<div class="message-row ${rc}">
            ${isAI ? `<div class="message-avatar" style="background-color:${getAvatarColor(charName)}">${charName.charAt(0)}</div>` : ''}
            <div class="bubble emoticon-bubble">
                ${url ? `<img src="${url}" alt="${escapeHtml(text)}" onerror="this.style.display='none'">` : ''}
                <span class="emoticon-text">${escapeHtml(text)}</span>
            </div>
            ${!isAI ? `<div class="message-avatar" style="background-color:${getAvatarColor('我')}">我</div>` : ''}
        </div>`;
    }

    // ========== 暴露方法 ==========
    return {
        // 管理页
        renderEmoticonPage,
        // 选择器
        renderEmoticonPicker,
        toggleEmoticonPicker,
        setupEmoticonPickerDismiss,
        // Prompt
        buildEmoticonSection,
        getEmoticonPromptRule,
        wrapUserEmoticonForAI,
        // AI 解析
        parseAIResponse,
        saveAIEmoticonMessages,
        // 对话详情
        renderConvDetailEmoticonList,
        collectEmoticonGroupIds,
        // 消息渲染
        renderEmoticonBubble,
        // 事件绑定（在 init 中调用）
        bindEvents: function() {
            // 管理页工具栏
            document.getElementById('emoticonUploadBtn')?.addEventListener('click', uploadEmoticonFile);
            document.getElementById('emoticonUrlBtn')?.addEventListener('click', addEmoticonUrl);
            document.getElementById('emoticonBatchBtn')?.addEventListener('click', batchImport);
            document.getElementById('emoticonDeleteGroupBtn')?.addEventListener('click', deleteEmoticonGroup);

            // 编辑弹窗
            document.getElementById('emoticonSaveBtn')?.addEventListener('click', async () => {
                const id = parseInt(document.getElementById('emoticonEditId').value);
                const text = document.getElementById('emoticonEditText').value.trim();
                const item = await DB.get('emoticonItems', id);
                if (item) { item.text = text; await DB.put('emoticonItems', item); }
                document.getElementById('emoticonEditModal').classList.remove('active');
                await renderEmoticonGrid();
            });
            document.getElementById('emoticonDeleteBtn')?.addEventListener('click', async () => {
                if (!confirm('确定删除该表情包吗？')) return;
                await DB.delete('emoticonItems', parseInt(document.getElementById('emoticonEditId').value));
                document.getElementById('emoticonEditModal').classList.remove('active');
                await renderEmoticonGrid();
            });
            document.getElementById('emoticonCancelBtn')?.addEventListener('click', () => {
                document.getElementById('emoticonEditModal').classList.remove('active');
            });

            // 批量导入
            document.getElementById('emoticonBatchConfirmBtn')?.addEventListener('click', doBatchImport);
            document.getElementById('emoticonBatchCancelBtn')?.addEventListener('click', () => {
                document.getElementById('emoticonBatchModal').classList.remove('active');
            });

            // 进入管理页入口
            document.getElementById('emoticonEntryBtn')?.addEventListener('click', () => {
                if (switchPage) switchPage('emoticon');
            });
            document.getElementById('backFromEmoticonBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (switchPage) switchPage('profile');
});
        }
    };
};
