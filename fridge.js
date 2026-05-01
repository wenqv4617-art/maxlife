// ============================================
// 冰箱（冷静评论箱）模块 - fridge.js
// 版本：v1.0
// 说明：提供帖子的新建、编辑、归档、评论功能
// ============================================

(function() {
    "use strict";

    // 等待全局 DB 对象和工具函数就绪
    function waitForGlobal(name, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (window[name] && typeof window[name] === 'object') {
                    resolve(window[name]);
                } else if (Date.now() - start > timeout) {
                    reject(new Error(`等待全局对象 ${name} 超时`));
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    let DB;
    let showStatus;
    let escapeHtml;
    let getAvatarColor;

    // 模块内部状态
    const STORAGE_KEY = 'calm_comment_box_v5';
    let entries = [];
    let currentEntryId = null;
    let selectedImages = [];
    let detailImages = [];
    let currentTab = 'new';

    // 初始化函数，由主程序调用
    window.initFridgeModule = async function(deps) {
        if (deps) {
            DB = deps.DB;
            showStatus = deps.showStatus;
            escapeHtml = deps.escapeHtml;
            getAvatarColor = deps.getAvatarColor;
        } else {
            // 尝试从全局获取
            DB = window.DB;
            showStatus = window.showStatus || function(msg, type) { console.log(`[${type}] ${msg}`); };
            escapeHtml = window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
            getAvatarColor = window.getAvatarColor || function(name) {
                const colors = ['#f39c12', '#3498db', '#e67e22', '#2ecc71', '#9b59b6', '#1abc9c', '#e74c3c'];
                return colors[(name || '?').charCodeAt(0) % colors.length];
            };
        }

        console.log('🧊 冰箱模块已加载');
        loadEntries();
        renderAll();
        bindAllEvents();

        // 定时刷新帖子列表
        setInterval(() => {
            if (currentTab === 'posts') renderPostsList();
        }, 1000);
    };

    function loadEntries() {
        const stored = localStorage.getItem(STORAGE_KEY);
        entries = stored ? JSON.parse(stored) : [];
        entries = entries.map(e => ({
            ...e,
            title: e.title || e.originalText?.substring(0, 30) || '未命名',
            images: e.images || [],
            comments: e.comments || []
        }));
    }

    function saveEntries() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    }

    function getActiveEntries() {
        const now = Date.now();
        return entries.filter(e => e.visibleUntil && e.visibleUntil > now);
    }

    function getArchivedEntries() {
        const now = Date.now();
        return entries.filter(e => !e.visibleUntil || e.visibleUntil <= now);
    }

    function renderPostsList() {
        const active = getActiveEntries().sort((a, b) => b.createdAt - a.createdAt);
        const activeCountEl = document.getElementById('activeCount');
        if (activeCountEl) activeCountEl.textContent = active.length + ' 条';

        const postsListEl = document.getElementById('postsList');
        const postsEmptyEl = document.getElementById('postsEmpty');

        if (active.length === 0) {
            if (postsListEl) postsListEl.innerHTML = '';
            if (postsEmptyEl) postsEmptyEl.style.display = 'block';
            return;
        }
        if (postsEmptyEl) postsEmptyEl.style.display = 'none';

        const now = Date.now();
        let html = '';
        active.forEach(entry => {
            const remain = entry.visibleUntil - now;
            const hours = Math.floor(remain / 3600000);
            const mins = Math.floor((remain % 3600000) / 60000);
            const timeStr = `${hours}h ${mins}m`;
            const warning = remain < 7200000;

            html += `<div class="post-card" data-id="${entry.id}">`;
            html += `<div class="post-title">${escapeHtml(entry.title)}</div>`;
            html += `<div class="post-meta">`;
            if (entry.url) html += `<span>🔗 有链接</span>`;
            if (entry.tags?.length) html += `<span>🏷️ ${entry.tags.length}个标签</span>`;
            if (entry.images?.length) html += `<span>🖼️ ${entry.images.length}张图</span>`;
            if (entry.comments?.length) html += `<span>💬 ${entry.comments.length}条评论</span>`;
            html += `</div>`;
            html += `<div class="post-preview">${escapeHtml(entry.originalText)}</div>`;
            html += `<div class="post-footer">`;
            html += `<div class="tags-row">${(entry.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`;
            html += `<span class="countdown-badge ${warning ? 'warning' : ''}">⏳ ${timeStr}</span>`;
            html += `</div></div>`;
        });
        if (postsListEl) postsListEl.innerHTML = html;
    }

    function renderArchiveList() {
        const archived = getArchivedEntries().sort((a, b) => b.createdAt - a.createdAt);
        const archiveCountEl = document.getElementById('archiveCount');
        if (archiveCountEl) archiveCountEl.textContent = archived.length + ' 条';

        const archiveListEl = document.getElementById('archiveList');
        const archiveEmptyEl = document.getElementById('archiveEmpty');

        if (archived.length === 0) {
            if (archiveListEl) archiveListEl.innerHTML = '';
            if (archiveEmptyEl) archiveEmptyEl.style.display = 'block';
            return;
        }
        if (archiveEmptyEl) archiveEmptyEl.style.display = 'none';

        let html = '';
        archived.forEach(entry => {
            const dateStr = new Date(entry.createdAt).toLocaleDateString('zh');
            html += `<div class="post-card" data-id="${entry.id}" style="cursor:pointer;opacity:0.9;">`;
            html += `<div class="post-title">${escapeHtml(entry.title)}</div>`;
            html += `<div class="post-meta">${dateStr}</div>`;
            html += `<div class="post-preview">${escapeHtml(entry.originalText?.substring(0, 100))}…</div>`;
            html += `</div>`;
        });
        if (archiveListEl) archiveListEl.innerHTML = html;
    }

    function openDetailView(entryId) {
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return;

        currentEntryId = entryId;
        detailImages = [...(entry.images || [])];

        const detailTitle = document.getElementById('detailTitle');
        const detailUrl = document.getElementById('detailUrl');
        const detailTags = document.getElementById('detailTags');
        const originalDisplay = document.getElementById('originalDisplay');
        const originalEditArea = document.getElementById('originalEditArea');
        const editOriginalBtn = document.getElementById('editOriginalBtn');

        if (detailTitle) detailTitle.value = entry.title || '';
        if (detailUrl) detailUrl.value = entry.url || '';
        if (detailTags) detailTags.value = (entry.tags || []).join(', ');

        if (originalDisplay) originalDisplay.textContent = entry.originalText || '暂无内容';
        if (originalEditArea) originalEditArea.classList.add('hidden');
        if (editOriginalBtn) editOriginalBtn.classList.remove('hidden');

        renderDetailImages();
        renderComments(entry);
        renderDetailImagePreview();

        const mainView = document.getElementById('fridgeMainView');
        const detailView = document.getElementById('fridgeDetailView');
        if (mainView) mainView.classList.add('hidden');
        if (detailView) detailView.classList.remove('hidden');
    }

    function renderDetailImages() {
        const container = document.getElementById('detailImages');
        if (!container) return;

        if (!detailImages.length) {
            container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">暂无图片</p>';
            return;
        }

        container.innerHTML = detailImages.map((img, idx) =>
            `<img src="${img}" class="detail-image" onclick="window.fridgeShowImageModal('${img}')" alt="图片${idx + 1}">`
        ).join('');
    }

    function renderDetailImagePreview() {
        const container = document.getElementById('detailImagePreview');
        if (!container) return;

        if (!detailImages.length) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = detailImages.map((img, idx) => `
            <div class="thumbnail-wrapper">
                <img src="${img}" class="thumbnail">
                <button class="remove-thumb" onclick="window.fridgeRemoveDetailImage(${idx})">×</button>
            </div>
        `).join('');
    }

    // 挂载到 window 以便 onclick 调用
    window.fridgeRemoveDetailImage = function(idx) {
        detailImages.splice(idx, 1);
        renderDetailImages();
        renderDetailImagePreview();
    };

    window.fridgeShowImageModal = function(src) {
        const modal = document.createElement('div');
        modal.className = 'image-modal';
        modal.innerHTML = `
            <button class="close-modal" onclick="this.parentElement.remove()">×</button>
            <img src="${src}">
        `;
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        document.body.appendChild(modal);
    };

    function renderComments(entry) {
        const container = document.getElementById('commentsList');
        if (!container) return;

        const comments = entry.comments || [];

        if (!comments.length) {
            container.innerHTML = '<p style="color:#94a3b8;padding:20px;text-align:center;">暂无评论</p>';
            return;
        }

        container.innerHTML = comments.sort((a, b) => b.time - a.time).map(c => `
            <div class="comment-item">
                <div class="comment-time">${new Date(c.time).toLocaleString('zh')}</div>
                <div class="comment-text">${escapeHtml(c.text)}</div>
            </div>
        `).join('');
    }

    function addComment() {
        const input = document.getElementById('newCommentInput');
        if (!input) return;

        const text = input.value.trim();
        if (!text) return;

        const entry = entries.find(e => e.id === currentEntryId);
        if (!entry) return;

        if (!entry.comments) entry.comments = [];
        entry.comments.push({
            text: text,
            time: Date.now()
        });

        saveEntries();
        renderComments(entry);
        input.value = '';
    }

    function saveDetail() {
        const entry = entries.find(e => e.id === currentEntryId);
        if (!entry) return;

        const detailTitle = document.getElementById('detailTitle');
        const detailUrl = document.getElementById('detailUrl');
        const detailTags = document.getElementById('detailTags');

        if (detailTitle) entry.title = detailTitle.value.trim() || '未命名';
        if (detailUrl) entry.url = detailUrl.value.trim();
        if (detailTags) {
            entry.tags = detailTags.value.trim()
                .split(',').map(t => t.trim()).filter(t => t);
        }
        entry.images = [...detailImages];

        saveEntries();
        backToMain();
    }

    function deleteDetail() {
        if (!confirm('确定删除这条记录？')) return;

        entries = entries.filter(e => e.id !== currentEntryId);
        saveEntries();
        backToMain();
    }

    function backToMain() {
        const mainView = document.getElementById('fridgeMainView');
        const detailView = document.getElementById('fridgeDetailView');
        if (mainView) mainView.classList.remove('hidden');
        if (detailView) detailView.classList.add('hidden');
        currentEntryId = null;
        renderAll();
    }

    function addNewEntry() {
        const entryTitle = document.getElementById('entryTitle');
        const postUrl = document.getElementById('postUrl');
        const originalText = document.getElementById('originalText');
        const tagsInput = document.getElementById('tagsInput');

        const title = entryTitle ? entryTitle.value.trim() : '';
        const url = postUrl ? postUrl.value.trim() : '';
        const original = originalText ? originalText.value.trim() : '';

        if (!original) {
            alert('请填写对方原话');
            return;
        }

        const now = Date.now();
        const newEntry = {
            id: now + Math.floor(Math.random() * 1000),
            title: title || original.substring(0, 30),
            url: url,
            originalText: original,
            tags: tagsInput ? tagsInput.value.trim().split(',').map(t => t.trim()).filter(t => t) : [],
            images: selectedImages.map(img => img.dataUrl),
            comments: [],
            createdAt: now,
            visibleUntil: now + 24 * 60 * 60 * 1000
        };

        entries.push(newEntry);
        saveEntries();
        clearNewForm();
        switchFridgeTab('posts');
        renderAll();
    }

    function clearNewForm() {
        const entryTitle = document.getElementById('entryTitle');
        const postUrl = document.getElementById('postUrl');
        const originalText = document.getElementById('originalText');
        const tagsInput = document.getElementById('tagsInput');

        if (entryTitle) entryTitle.value = '';
        if (postUrl) postUrl.value = '';
        if (originalText) originalText.value = '';
        if (tagsInput) tagsInput.value = '';
        selectedImages = [];
        const imagePreview = document.getElementById('imagePreview');
        if (imagePreview) imagePreview.innerHTML = '';
    }

    function renderNewImagePreview() {
        const container = document.getElementById('imagePreview');
        if (!container) return;

        container.innerHTML = selectedImages.map((img, idx) => `
            <div class="thumbnail-wrapper">
                <img src="${img.dataUrl}" class="thumbnail">
                <button class="remove-thumb" onclick="window.fridgeRemoveNewImage(${idx})">×</button>
            </div>
        `).join('');
    }

    window.fridgeRemoveNewImage = function(idx) {
        selectedImages.splice(idx, 1);
        renderNewImagePreview();
    };

    function switchFridgeTab(tabId) {
        currentTab = tabId;
        const tabs = document.querySelectorAll('.bottom-tab-btn');
        const panels = {
            new: document.getElementById('panel-new'),
            posts: document.getElementById('panel-posts'),
            archive: document.getElementById('panel-archive')
        };

        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabId);
        });
        Object.entries(panels).forEach(([id, panel]) => {
            if (panel) panel.classList.toggle('active', id === tabId);
        });

        if (tabId === 'posts') renderPostsList();
        else if (tabId === 'archive') renderArchiveList();
    }

    function renderAll() {
        renderPostsList();
        renderArchiveList();
    }

    function bindAllEvents() {
        // 图片上传 - 新建页面
        const imageUpload = document.getElementById('imageUpload');
        if (imageUpload && !imageUpload.dataset.fridgeBound) {
            imageUpload.dataset.fridgeBound = '1';
            imageUpload.addEventListener('change', (e) => {
                Array.from(e.target.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        selectedImages.push({ dataUrl: ev.target.result });
                        renderNewImagePreview();
                    };
                    reader.readAsDataURL(file);
                });
                imageUpload.value = '';
            });
        }

        // 图片上传 - 详情页面
        const detailImageUpload = document.getElementById('detailImageUpload');
        if (detailImageUpload && !detailImageUpload.dataset.fridgeBound) {
            detailImageUpload.dataset.fridgeBound = '1';
            detailImageUpload.addEventListener('change', (e) => {
                Array.from(e.target.files).forEach(file => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        detailImages.push(ev.target.result);
                        renderDetailImages();
                        renderDetailImagePreview();
                    };
                    reader.readAsDataURL(file);
                });
                detailImageUpload.value = '';
            });
        }

        // 编辑原话
        const editOriginalBtn = document.getElementById('editOriginalBtn');
        if (editOriginalBtn && !editOriginalBtn.dataset.fridgeBound) {
            editOriginalBtn.dataset.fridgeBound = '1';
            editOriginalBtn.addEventListener('click', () => {
                const entry = entries.find(e => e.id === currentEntryId);
                if (!entry) return;
                const detailOriginal = document.getElementById('detailOriginal');
                const originalDisplay = document.getElementById('originalDisplay');
                const originalEditArea = document.getElementById('originalEditArea');
                if (detailOriginal) detailOriginal.value = entry.originalText || '';
                if (originalDisplay) originalDisplay.classList.add('hidden');
                if (originalEditArea) originalEditArea.classList.remove('hidden');
                if (editOriginalBtn) editOriginalBtn.classList.add('hidden');
            });
        }

        const saveOriginalBtn = document.getElementById('saveOriginalBtn');
        if (saveOriginalBtn && !saveOriginalBtn.dataset.fridgeBound) {
            saveOriginalBtn.dataset.fridgeBound = '1';
            saveOriginalBtn.addEventListener('click', () => {
                const entry = entries.find(e => e.id === currentEntryId);
                if (!entry) return;
                const detailOriginal = document.getElementById('detailOriginal');
                const originalDisplay = document.getElementById('originalDisplay');
                const originalEditArea = document.getElementById('originalEditArea');
                const editOriginalBtn2 = document.getElementById('editOriginalBtn');
                if (detailOriginal) entry.originalText = detailOriginal.value.trim();
                if (originalDisplay) originalDisplay.textContent = entry.originalText || '暂无内容';
                if (originalDisplay) originalDisplay.classList.remove('hidden');
                if (originalEditArea) originalEditArea.classList.add('hidden');
                if (editOriginalBtn2) editOriginalBtn2.classList.remove('hidden');
            });
        }

        const cancelOriginalBtn = document.getElementById('cancelOriginalBtn');
        if (cancelOriginalBtn && !cancelOriginalBtn.dataset.fridgeBound) {
            cancelOriginalBtn.dataset.fridgeBound = '1';
            cancelOriginalBtn.addEventListener('click', () => {
                const originalDisplay = document.getElementById('originalDisplay');
                const originalEditArea = document.getElementById('originalEditArea');
                const editOriginalBtn2 = document.getElementById('editOriginalBtn');
                if (originalDisplay) originalDisplay.classList.remove('hidden');
                if (originalEditArea) originalEditArea.classList.add('hidden');
                if (editOriginalBtn2) editOriginalBtn2.classList.remove('hidden');
            });
        }

        // 帖子列表点击
        const postsList = document.getElementById('postsList');
        if (postsList && !postsList.dataset.fridgeBound) {
            postsList.dataset.fridgeBound = '1';
            postsList.addEventListener('click', (e) => {
                const card = e.target.closest('.post-card');
                if (card) {
                    const id = Number(card.dataset.id);
                    openDetailView(id);
                }
            });
        }

        const archiveList = document.getElementById('archiveList');
        if (archiveList && !archiveList.dataset.fridgeBound) {
            archiveList.dataset.fridgeBound = '1';
            archiveList.addEventListener('click', (e) => {
                const card = e.target.closest('.post-card');
                if (card && card.dataset.id) {
                    const id = Number(card.dataset.id);
                    openDetailView(id);
                }
            });
        }

        // 底部标签切换
        document.querySelectorAll('.bottom-tab-btn').forEach(tab => {
            if (!tab.dataset.fridgeBound) {
                tab.dataset.fridgeBound = '1';
                tab.addEventListener('click', () => switchFridgeTab(tab.dataset.tab));
            }
        });

        // 保存按钮
        const saveEntryBtn = document.getElementById('saveEntryBtn');
        if (saveEntryBtn && !saveEntryBtn.dataset.fridgeBound) {
            saveEntryBtn.dataset.fridgeBound = '1';
            saveEntryBtn.addEventListener('click', addNewEntry);
        }

        // 清除图片
        const clearImagesBtn = document.getElementById('clearImagesBtn');
        if (clearImagesBtn && !clearImagesBtn.dataset.fridgeBound) {
            clearImagesBtn.dataset.fridgeBound = '1';
            clearImagesBtn.addEventListener('click', () => {
                selectedImages = [];
                renderNewImagePreview();
            });
        }

        // 返回按钮
        const fridgeBackBtn = document.getElementById('fridgeBackBtn');
        if (fridgeBackBtn && !fridgeBackBtn.dataset.fridgeBound) {
            fridgeBackBtn.dataset.fridgeBound = '1';
            fridgeBackBtn.addEventListener('click', backToMain);
        }

        // 保存详情
        const saveDetailBtn = document.getElementById('saveDetailBtn');
        if (saveDetailBtn && !saveDetailBtn.dataset.fridgeBound) {
            saveDetailBtn.dataset.fridgeBound = '1';
            saveDetailBtn.addEventListener('click', saveDetail);
        }

        // 删除详情
        const deleteDetailBtn = document.getElementById('deleteDetailBtn');
        if (deleteDetailBtn && !deleteDetailBtn.dataset.fridgeBound) {
            deleteDetailBtn.dataset.fridgeBound = '1';
            deleteDetailBtn.addEventListener('click', deleteDetail);
        }

        // 添加评论
        const addCommentBtn = document.getElementById('addCommentBtn');
        if (addCommentBtn && !addCommentBtn.dataset.fridgeBound) {
            addCommentBtn.dataset.fridgeBound = '1';
            addCommentBtn.addEventListener('click', addComment);
        }

        // 回车发送评论
        const newCommentInput = document.getElementById('newCommentInput');
        if (newCommentInput && !newCommentInput.dataset.fridgeBound) {
            newCommentInput.dataset.fridgeBound = '1';
            newCommentInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addComment();
            });
        }
    }

    console.log('🧊 冰箱模块脚本已就绪，等待 initFridgeModule() 调用');
})();