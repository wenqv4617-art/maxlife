/* sticker.js —— 表情包模块 */

;(function () {
    "use strict";
    if (window.__stickerModuleInited) return;
    window.__stickerModuleInited = true;

    const DB = window.DB;
    const STORE_GROUPS = 'sticker_groups';
    const STORE_STICKERS = 'sticker_stickers';

    /* ========= 简单工具 ========= */
    function uid() {
        return 'sk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    /** 获取 DB 实例（复用现有 openDB 的模式，补建 store） */
    async function getDB() {
    // 直接复用 index.html 中已打开的 DB，不再自己升级版本
    const d = await new Promise((resolve, reject) => {
        const req = indexedDB.open("CompanionDB_V18", 20);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });

    // 如果 store 不存在，关闭旧连接，升级版本
    if (!d.objectStoreNames.contains(STORE_GROUPS) || !d.objectStoreNames.contains(STORE_STICKERS)) {
        d.close();
        return new Promise((resolve, reject) => {
            const req = indexedDB.open("CompanionDB_V18", d.version + 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_GROUPS)) {
                    db.createObjectStore(STORE_GROUPS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_STICKERS)) {
                    const ss = db.createObjectStore(STORE_STICKERS, { keyPath: 'id' });
                    ss.createIndex('groupId', 'groupId', { unique: false });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }
    return d;
}

    async function getAll(storeName) {
        const d = await getDB();
        return new Promise((resolve) => {
            const tx = d.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
        });
    }
    async function put(storeName, obj) {
        const d = await getDB();
        return new Promise((resolve) => {
            const tx = d.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(obj);
            tx.oncomplete = resolve;
        });
    }
    async function del(storeName, id) {
        const d = await getDB();
        return new Promise((resolve) => {
            const tx = d.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).delete(id);
            tx.oncomplete = resolve;
        });
    }
    async function getByIndex(storeName, indexName, value) {
        const d = await getDB();
        return new Promise((resolve) => {
            const tx = d.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).index(indexName).getAll(value);
            req.onsuccess = () => resolve(req.result || []);
        });
    }

    async function getGroups() { return getAll(STORE_GROUPS); }
    async function putGroup(group) { return put(STORE_GROUPS, group); }
    async function deleteGroup(id) {
        const stickers = await getByIndex(STORE_STICKERS, 'groupId', id);
        for (const s of stickers) await del(STORE_STICKERS, s.id);
        return del(STORE_GROUPS, id);
    }
    async function getStickersByGroup(groupId) { return getByIndex(STORE_STICKERS, 'groupId', groupId); }
    async function putSticker(sticker) { return put(STORE_STICKERS, sticker); }
    async function deleteSticker(id) { return del(STORE_STICKERS, id); }

    /* ========= 管理页状态 ========= */
    let currentGroupId = null;
    let pendingBatchStickers = []; // 批量上传暂存

    /* ========= 分组渲染 ========= */
    async function renderGroups() {
        const groups = await getGroups();
        const sidebar = document.getElementById('stickerGroupSidebar');
        if (!sidebar) return;

        // 如果没有分组，自动创建默认分组
        if (groups.length === 0) {
            const defaultId = uid();
            await putGroup({ id: defaultId, name: '默认分组' });
            currentGroupId = defaultId;
            return renderGroups();
        }

        // 如果当前分组不存在，选第一个
        if (!groups.find(g => g.id === currentGroupId)) {
            currentGroupId = groups[0].id;
        }

        let html = '';
        groups.forEach(g => {
            const activeClass = g.id === currentGroupId ? ' active' : '';
            html += `<div class="sticker-group-item${activeClass}" data-group-id="${g.id}">
                <span>${escapeHTML(g.name || '未分组')}</span>
                <span class="sticker-group-delete" data-delete-group="${g.id}">✕</span>
            </div>`;
        });
        html += '<div class="sticker-add-group-btn" id="stickerAddGroupBtn">＋ 新建</div>';
        sidebar.innerHTML = html;

        // 点击分组
        sidebar.querySelectorAll('.sticker-group-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('sticker-group-delete')) return;
                currentGroupId = el.dataset.groupId;
                renderGroups();
                renderStickers();
            });
        });

        // 删除分组
        sidebar.querySelectorAll('.sticker-group-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const gid = btn.dataset.deleteGroup;
                if (!confirm('确定删除该分组及其中所有表情包吗？')) return;
                await deleteGroup(gid);
                const groups = await getGroups();
                currentGroupId = groups.length > 0 ? groups[0].id : null;
                await renderGroups();
                renderStickers();
            });
        });

        // 新建分组
        const addBtn = document.getElementById('stickerAddGroupBtn');
        if (addBtn && !addBtn.dataset.bound) {
            addBtn.dataset.bound = '1';
            addBtn.addEventListener('click', async () => {
                const name = prompt('请输入分组名称：');
                if (!name || !name.trim()) return;
                const id = uid();
                await putGroup({ id, name: name.trim() });
                currentGroupId = id;
                await renderGroups();
                renderStickers();
            });
        }
    }

    /* ========= 表情包渲染 ========= */
    async function renderStickers() {
        const main = document.getElementById('stickerMainArea');
        if (!main) return;
        if (!currentGroupId) {
            main.innerHTML = '<div class="sticker-empty">👈 请选择一个分组</div>';
            return;
        }
        const stickers = await getStickersByGroup(currentGroupId);
        let html = '';

        // 上传区域
        html += `<div class="sticker-upload-zone" id="stickerSingleUploadBtn">
            <div style="font-size:28px;">📷</div>
            <div>点击上传表情包</div>
        </div>`;
        html += `<div class="sticker-upload-zone" id="stickerBatchUploadBtn" style="border-style:dashed;">
            <div style="font-size:28px;">📋</div>
            <div>批量导入</div>
        </div>`;

        if (stickers.length === 0) {
            html += '<div class="sticker-empty">还没有表情包<br>点击上方按钮上传</div>';
        } else {
            stickers.forEach(s => {
                const text = s.text || '无说明';
                html += `
                <div class="sticker-card" data-sticker-id="${s.id}">
                    <div class="sticker-card-delete" data-delete-id="${s.id}">✕</div>
                    <img class="sticker-card-img" src="${s.image || ''}" alt="${escapeHTML(text)}" loading="lazy">
                    <div class="sticker-card-text">${escapeHTML(text)}</div>
                </div>`;
            });
        }
        main.innerHTML = html;

        // ---- 事件绑定 ----

        // 单张上传
        const singleBtn = document.getElementById('stickerSingleUploadBtn');
        if (singleBtn && !singleBtn.dataset.bound) {
            singleBtn.dataset.bound = '1';
            singleBtn.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const dataUrl = await fileToDataURL(file);
                    showStickerEditModal(dataUrl, null, currentGroupId, null);
                };
                input.click();
            });
        }

        // 批量导入
        const batchBtn = document.getElementById('stickerBatchUploadBtn');
        if (batchBtn && !batchBtn.dataset.bound) {
            batchBtn.dataset.bound = '1';
            batchBtn.addEventListener('click', () => {
                showBatchImportModal(currentGroupId);
            });
        }

        // 拖拽上传
        main.querySelectorAll('.sticker-upload-zone').forEach(zone => {
            if (zone.dataset.dragBound) return;
            zone.dataset.dragBound = '1';
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
            zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length === 0) return;
                // 批量图片拖入 → 进入批量确认流程
                const dataUrls = [];
                for (const file of files) {
                    dataUrls.push(await fileToDataURL(file));
                }
                showBatchImageModal(dataUrls, currentGroupId);
            });
        });

        // 卡片点击 → 编辑
        main.querySelectorAll('.sticker-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                if (e.target.classList.contains('sticker-card-delete')) return;
                const id = card.dataset.stickerId;
                const stickers = await getStickersByGroup(currentGroupId);
                const s = stickers.find(s => s.id === id);
                if (s) showStickerEditModal(s.image, s, currentGroupId, id);
            });
        });

        // 删除按钮
        main.querySelectorAll('.sticker-card-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.deleteId;
                if (!confirm('确定删除这个表情包吗？')) return;
                await deleteSticker(id);
                renderStickers();
            });
        });
    }

    /* ========= 文件转 DataURL ========= */
    function fileToDataURL(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.readAsDataURL(file);
        });
    }

    /* ========= 编辑/新增弹窗 ========= */
    function showStickerEditModal(imageData, existingSticker, groupId, stickerId) {
        const existing = document.querySelector('.sticker-edit-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sticker-modal-overlay sticker-edit-overlay';
        overlay.innerHTML = `
            <div class="sticker-modal-card">
                <h3>${existingSticker ? '编辑表情包' : '新增表情包'}</h3>
                <img class="sticker-edit-preview" src="${imageData}" alt="预览">
                <input type="text" id="stickerEditText" placeholder="文字说明（必填）" value="${escapeHTML(existingSticker?.text || '')}" maxlength="40">
                <div class="sticker-modal-btn-row">
                    ${existingSticker ? '<button class="sticker-btn danger" id="stickerEditDelete">🗑 删除</button>' : ''}
                    <button class="sticker-btn" id="stickerEditCancel">取消</button>
                    <button class="sticker-btn primary" id="stickerEditSave">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.getElementById('stickerEditCancel')?.addEventListener('click', close);

        document.getElementById('stickerEditSave')?.addEventListener('click', async () => {
            const text = document.getElementById('stickerEditText')?.value.trim();
            if (!text) {
                window.showStatus?.('请输入文字说明', 'error');
                return;
            }
            if (existingSticker) {
                existingSticker.text = text;
                existingSticker.image = imageData;
                await putSticker(existingSticker);
            } else {
                await putSticker({ id: uid(), groupId, image: imageData, text });
            }
            close();
            renderStickers();
        });

        document.getElementById('stickerEditDelete')?.addEventListener('click', async () => {
            if (!confirm('确定删除？')) return;
            await deleteSticker(existingSticker.id);
            close();
            renderStickers();
        });
    }

    /* ========= 批量图片拖入弹窗（逐个设置文字） ========= */
    function showBatchImageModal(dataUrls, groupId) {
        const existing = document.querySelector('.sticker-batch-img-overlay');
        if (existing) existing.remove();

        let currentIndex = 0;
        const total = dataUrls.length;
        pendingBatchStickers = [];

        const overlay = document.createElement('div');
        overlay.className = 'sticker-modal-overlay sticker-batch-img-overlay';
        overlay.innerHTML = `
            <div class="sticker-modal-card">
                <h3>批量设置表情包 (${currentIndex + 1}/${total})</h3>
                <img class="sticker-edit-preview" id="batchImgPreview" src="${dataUrls[0]}" alt="预览">
                <input type="text" id="batchImgText" placeholder="文字说明" maxlength="40">
                <div class="sticker-modal-btn-row" style="justify-content:space-between;">
                    <button class="sticker-btn" id="batchImgSkip">跳过</button>
                    <div>
                        <button class="sticker-btn" id="batchImgPrev" disabled>上一步</button>
                        <button class="sticker-btn primary" id="batchImgNext">下一步 →</button>
                        <button class="sticker-btn primary" id="batchImgFinish" style="display:none;">完成</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const preview = document.getElementById('batchImgPreview');
        const textInput = document.getElementById('batchImgText');
        const prevBtn = document.getElementById('batchImgPrev');
        const nextBtn = document.getElementById('batchImgNext');
        const skipBtn = document.getElementById('batchImgSkip');
        const finishBtn = document.getElementById('batchImgFinish');

        function updateUI() {
            preview.src = dataUrls[currentIndex];
            textInput.value = pendingBatchStickers[currentIndex]?.text || '';
            document.querySelector('.sticker-modal-card h3').textContent = `批量设置表情包 (${currentIndex + 1}/${total})`;
            prevBtn.disabled = currentIndex === 0;
            if (currentIndex === total - 1) {
                nextBtn.style.display = 'none';
                finishBtn.style.display = '';
            } else {
                nextBtn.style.display = '';
                finishBtn.style.display = 'none';
            }
        }

        // 保存当前输入
        function saveCurrent() {
            pendingBatchStickers[currentIndex] = {
                image: dataUrls[currentIndex],
                text: textInput.value.trim()
            };
        }

        nextBtn.addEventListener('click', () => {
            saveCurrent();
            if (currentIndex < total - 1) {
                currentIndex++;
                updateUI();
            }
        });
        prevBtn.addEventListener('click', () => {
            saveCurrent();
            if (currentIndex > 0) {
                currentIndex--;
                updateUI();
            }
        });
        skipBtn.addEventListener('click', () => {
            // 跳过当前图片
            pendingBatchStickers[currentIndex] = null;
            if (currentIndex < total - 1) {
                currentIndex++;
                updateUI();
            } else {
                finishBatch();
            }
        });
        finishBtn.addEventListener('click', async () => {
            saveCurrent();
            await finishBatch();
        });

        async function finishBatch() {
            overlay.remove();
            let success = 0;
            for (const item of pendingBatchStickers) {
                if (item && item.text) {
                    await putSticker({ id: uid(), groupId, image: item.image, text: item.text });
                    success++;
                }
            }
            window.showStatus?.(`成功导入 ${success} 个表情包`, success > 0 ? 'success' : 'info');
            pendingBatchStickers = [];
            renderStickers();
        }

        // 关闭弹窗时也保存
        const close = () => {
            saveCurrent();
            finishBatch();
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    /* ========= 批量导入弹窗（文字:URL 格式） ========= */
    function showBatchImportModal(groupId) {
        const existing = document.querySelector('.sticker-batch-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'sticker-modal-overlay sticker-batch-overlay';
        overlay.innerHTML = `
            <div class="sticker-modal-card">
                <h3>📋 批量导入表情包</h3>
                <textarea id="stickerBatchText" placeholder="格式：文字:URL; 每行一条&#10;例如：&#10;开心:https://xxx.png;&#10;难过:https://yyy.jpg;" rows="8" style="width:100%;min-height:140px;"></textarea>
                <div style="font-size:12px;color:#8ba3c7;margin-bottom:12px;">💡 文字与URL用第一个「:」分隔，以「;」结尾表示一条。</div>
                <div class="sticker-modal-btn-row">
                    <button class="sticker-btn" id="stickerBatchCancel">取消</button>
                    <button class="sticker-btn primary" id="stickerBatchConfirm">导入</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        document.getElementById('stickerBatchCancel')?.addEventListener('click', close);

        document.getElementById('stickerBatchConfirm')?.addEventListener('click', async () => {
            const raw = document.getElementById('stickerBatchText')?.value || '';
            const items = raw.split(';').map(s => s.trim()).filter(Boolean);
            let success = 0, fail = 0;
            for (const item of items) {
                const idx = item.indexOf(':');
                if (idx < 0) { fail++; continue; }
                const text = item.slice(0, idx).trim();
                const url = item.slice(idx + 1).trim();
                if (!text || !url) { fail++; continue; }
                try {
                    await new Promise((resolve, reject) => {
                        const img = new Image();
                        img.crossOrigin = 'anonymous';
                        img.onload = () => resolve();
                        img.onerror = () => reject();
                        setTimeout(() => reject(), 5000);
                        img.src = url;
                    });
                    await putSticker({ id: uid(), groupId, image: url, text });
                    success++;
                } catch (e) {
                    fail++;
                }
            }
            close();
            window.showStatus?.(`导入完成：成功 ${success} 个，失败 ${fail} 个`, success > 0 ? 'success' : 'error');
            renderStickers();
        });
    }

    /* ========= 聊天内表情包选择器 ========= */

    function createStickerPicker(conversationId) {
        const old = document.getElementById('stickerPicker');
        if (old) {
            // 移除旧的事件监听
            if (old._closeHandler) document.removeEventListener('click', old._closeHandler);
            old.remove();
        }

        const picker = document.createElement('div');
        picker.id = 'stickerPicker';
        picker.className = 'sticker-picker';
        picker.innerHTML = `
            <div class="sticker-picker-close" id="stickerPickerClose">✕</div>
            <div class="sticker-picker-groups" id="stickerPickerGroups"></div>
            <div class="sticker-picker-content" id="stickerPickerContent"></div>
        `;

        const chatMessages = document.getElementById('convChatMessages');
        const chatInputArea = document.querySelector('#page-conversation .chat-input-area');
        if (chatMessages && chatInputArea) {
            chatMessages.after(picker);
        } else {
            const convPage = document.getElementById('page-conversation');
            if (convPage) convPage.appendChild(picker);
        }

        // 关闭按钮
        picker.querySelector('#stickerPickerClose').addEventListener('click', () => {
            picker.classList.remove('active');
            StickerModule._visible = false;
        });

        // 点击外部关闭
        const closeHandler = (e) => {
            if (!picker.classList.contains('active')) return;
            if (picker.contains(e.target)) return;
            if (e.target.closest('[data-action="sticker"]')) return;
            if (e.target.closest('#expandMenu')) return;
            picker.classList.remove('active');
            StickerModule._visible = false;
        };
        document.addEventListener('click', closeHandler);
        picker._closeHandler = closeHandler;

        return picker;
    }

    async function loadStickerPickerGroups(convId) {
        const groupsEl = document.getElementById('stickerPickerGroups');
        const contentEl = document.getElementById('stickerPickerContent');
        if (!groupsEl || !contentEl) return;

        const allGroups = await getGroups();
        const mountedIds = await getMountedStickerGroupIds(convId);
        const visibleGroups = allGroups.filter(g => mountedIds.includes(g.id));

        if (visibleGroups.length === 0) {
            groupsEl.innerHTML = '<span style="font-size:12px;color:#8a8a8a;padding:6px;">暂无可用分组，请先在对话详情中挂载</span>';
            contentEl.innerHTML = '';
            return;
        }

        let currentPickerGroup = visibleGroups[0]?.id;
        groupsEl.innerHTML = visibleGroups.map(g =>
            `<span class="sticker-picker-group-chip ${g.id === currentPickerGroup ? 'active' : ''}" data-pg="${g.id}">${escapeHTML(g.name)}</span>`
        ).join('');

        const renderContent = async (groupId) => {
            const stickers = await getStickersByGroup(groupId);
            if (stickers.length === 0) {
                contentEl.innerHTML = '<span style="color:#8a8a8a;font-size:12px;padding:12px;">该分组暂无表情包</span>';
                return;
            }
            contentEl.innerHTML = stickers.map(s => `
                <div class="sticker-picker-item" data-sid="${s.id}" data-text="${escapeHTML(s.text || '')}" data-img="${s.image || ''}">
                    <img src="${s.image || ''}" alt="${escapeHTML(s.text || '')}" loading="lazy">
                    <span class="sticker-picker-text">${escapeHTML(s.text || '')}</span>
                </div>
            `).join('');

            contentEl.querySelectorAll('.sticker-picker-item').forEach(item => {
                item.addEventListener('click', () => {
                    sendStickerMessage(item.dataset.img, item.dataset.text, convId);
                });
            });
        };

        groupsEl.querySelectorAll('.sticker-picker-group-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                groupsEl.querySelectorAll('.sticker-picker-group-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderContent(chip.dataset.pg);
            });
        });

        await renderContent(currentPickerGroup);
    }

    async function sendStickerMessage(imageUrl, text, convId) {
        if (!convId) return;
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        await DB.put('chats', {
            role: 'user',
            content: JSON.stringify({ type: 'sticker', image: imageUrl, text }),
            messageType: 'sticker',
            conversationId: convId,
            charId: conv.charId,
            timestamp: Date.now()
        });
        await DB.put('conversations', { ...conv, updatedAt: Date.now() });
        if (window.loadConversationMessages) await window.loadConversationMessages(convId);
        window.showStatus?.('表情包已发送', 'success');
    }

    function toggleStickerPicker(convId) {
        let picker = document.getElementById('stickerPicker');
        if (!picker) {
            picker = createStickerPicker(convId);
        }
        const isVisible = picker.classList.contains('active');
        if (isVisible) {
            picker.classList.remove('active');
            StickerModule._visible = false;
        } else {
            picker.classList.add('active');
            StickerModule._visible = true;
            loadStickerPickerGroups(convId);
        }
    }

    /* ========= 已挂载分组 ========= */
    async function getMountedStickerGroupIds(convId) {
        if (!convId) return [];
        const convDetail = await DB.get('convDetails', convId);
        return convDetail?.stickerGroupIds || [];
    }

    /* ========= 对话详情挂载渲染 ========= */
    async function renderConvDetailStickerMounts(convId) {
        const container = document.getElementById('convDetailStickerList');
        if (!container) return;

        const allGroups = await getGroups();
        const mountedIds = await getMountedStickerGroupIds(convId);

        if (allGroups.length === 0) {
            container.innerHTML = '<p style="color:#a0a8a2;padding:12px;font-size:13px;">暂未创建表情包分组</p>';
            return;
        }

        container.innerHTML = allGroups.map(g => `
            <label class="mount-checkbox">
                <input type="checkbox" value="${g.id}" class="conv-detail-sticker-checkbox" ${mountedIds.includes(g.id) ? 'checked' : ''}>
                <span>😂 ${escapeHTML(g.name)}</span>
            </label>
        `).join('');
    }

    function getSelectedStickerGroupIds() {
        const ids = [];
        document.querySelectorAll('.conv-detail-sticker-checkbox:checked').forEach(cb => ids.push(cb.value));
        return ids;
    }

    /* ========= 渲染表情包消息 ========= */
    window.renderStickerMessage = function (msg) {
        try {
            const data = JSON.parse(msg.content);
            if (data.type === 'sticker') {
                return `<img class="sticker-msg-img" src="${data.image || ''}" alt="${escapeHTML(data.text || '')}" title="${escapeHTML(data.text || '')}">`;
            }
        } catch (e) {
            // 纯文字表情包（char 发出的）
        }
        return `<span class="sticker-text-only">😂 ${escapeHTML(msg.content)}</span>`;
    };

    /* ========= HTML 转义 ========= */
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>"'/]/g, function (s) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;' })[s];
        });
    }

    /* ========= 图表消息匹配图片（char 发出的文字表情包） ========= */
    async function matchStickerImage(text, convId) {
        if (!convId) return '';
        const mountedIds = await getMountedStickerGroupIds(convId);
        const allGroups = await getGroups();
        for (const g of allGroups) {
            if (!mountedIds.includes(g.id)) continue;
            const stickers = await getStickersByGroup(g.id);
            const match = stickers.find(s => s.text === text);
            if (match) return match.image;
        }
        return '';
    }
    window.matchStickerImage = matchStickerImage;

    /* ========= 公开 API ========= */
    const StickerModule = {
        getGroups,
        putGroup,
        deleteGroup,
        getStickersByGroup,
        putSticker,
        deleteSticker,
        renderGroups,
        renderStickers,
        setCurrentGroupId: (id) => { currentGroupId = id; },
        getCurrentGroupId: () => currentGroupId,
        toggleStickerPicker,
        getMountedStickerGroupIds,
        renderConvDetailStickerMounts,
        getSelectedStickerGroupIds,
        renderStickerMessage: window.renderStickerMessage,
        sendStickerMessage,
        _visible: false
    };
    window.StickerModule = StickerModule;

    /* ========= 初始化入口 ========= */
    window.initStickerModule = async function (ctx) {
        await getDB();
        console.log('✅ 表情包模块已就绪');
    };
})();