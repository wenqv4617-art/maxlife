// ============================================
// 重逢（NPC生成器）模块 - reunion.js
// 版本：v1.0
// 说明：提供标签选择、NPC生成、NPC池管理功能
// 依赖：需要全局 DB 对象（IndexedDB操作）
//      需要全局 showStatus 函数
//      需要全局 escapeHtml 函数
//      需要全局 getAvatarColor 函数
//      需要全局 callLLM 函数（AI调用）
//      需要全局 recordApiPending 函数（API监控）
// ============================================

(function() {
    "use strict";

    // ==================== 模块内部状态 ====================
    let reunionCurrentDim = 'personality';
    let reunionSelectedTags = { personality: null, world: null, plot: null };
    let reunionCurrentFilter = 'all';
    let reunionCurrentFilterValue = null;
    let reunionFlipNPC = null;

    // 缓存全局依赖
    let DB, showStatus, escapeHtml, getAvatarColor, callLLM, recordApiPending;

    // ==================== 初始化 ====================
    window.initReunionModule = async function(deps) {
        // 获取依赖
        if (deps) {
            DB = deps.DB;
            showStatus = deps.showStatus;
            escapeHtml = deps.escapeHtml;
            getAvatarColor = deps.getAvatarColor;
            callLLM = deps.callLLM;
            recordApiPending = deps.recordApiPending;
        } else {
            DB = window.DB;
            showStatus = window.showStatus || function(msg, type) { console.log(`[${type}] ${msg}`); };
            escapeHtml = window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
            getAvatarColor = window.getAvatarColor || function(name) { const colors = ['#f39c12','#3498db','#e67e22','#2ecc71','#9b59b6','#1abc9c','#e74c3c']; return colors[(name||'?').charCodeAt(0)%colors.length]; };
            callLLM = window.callLLM;
            recordApiPending = window.recordApiPending || function() {};
        }

        console.log('[模块] 重逢模块已加载');
        
        // 重置状态
        reunionCurrentDim = 'personality';
        reunionSelectedTags = { personality: null, world: null, plot: null };
        reunionCurrentFilter = 'all';
        reunionCurrentFilterValue = null;

        // 显示顶部标签区域
        const topArea = document.querySelector('.reunion-top');
        if (topArea) topArea.style.display = 'block';

        // 显示已选标签行
        const selectedTagsRow = document.getElementById('reunionSelectedTagsRow');
        if (selectedTagsRow) selectedTagsRow.style.display = '';

        // 切换底部标签到"生成"
        document.querySelectorAll('.reunion-bottom-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.panel === 'generate');
        });
        document.querySelectorAll('.reunion-panel').forEach(p => {
            p.classList.toggle('active', p.id === 'reunionGeneratePanel');
        });

        // 确保世界书面板默认隐藏
        const wbPanel = document.getElementById('reunionWorldbookPanel');
        if (wbPanel) wbPanel.classList.remove('active');

        // 清空备注
        const noteInput = document.getElementById('reunionGenerateNote');
        if (noteInput) noteInput.value = '';

        // 初始化维度标签
        document.querySelectorAll('.dimension-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.dim === reunionCurrentDim);
        });

        // 渲染界面
        await reunionRenderTagSelection();
        reunionRenderSelectedTags();
        reunionUpdateGenerateBtn();
        await reunionRenderNPCList();
        await reunionRenderFilterBar();
        bindReunionEvents();
    };

    // ==================== 标签操作 ====================
    async function reunionGetTagsByCategory(category) {
        const all = await DB.getAll('reunionTags');
        return all.filter(t => t.category === category).sort((a, b) => {
            if (a.isPreset && !b.isPreset) return -1;
            if (!a.isPreset && b.isPreset) return 1;
            return 0;
        });
    }

    async function reunionAddTag(category, name, description = '') {
        const id = 'rt_' + category + '_' + Date.now();
        await DB.put('reunionTags', { id, category, name, description: description || '', isPreset: false });
    }

    async function reunionDeleteTag(id) {
        const tag = await DB.get('reunionTags', id);
        if (tag && tag.isPreset) {
            showStatus('预置标签不可删除', 'info');
            return false;
        }
        await DB.delete('reunionTags', id);
        return true;
    }

    function reunionSelectTag(category, tagName) {
        reunionSelectedTags[category] = tagName;
        reunionRenderSelectedTags();
        reunionUpdateGenerateBtn();
        reunionRenderTagSelection();
    }

    function reunionRemoveTag(category) {
        reunionSelectedTags[category] = null;
        reunionRenderSelectedTags();
        reunionUpdateGenerateBtn();
        reunionRenderTagSelection();
    }

    function reunionUpdateGenerateBtn() {
        const btn = document.getElementById('reunionGenerateBtn');
        if (!btn) return;
        const allSelected = reunionSelectedTags.personality && reunionSelectedTags.world && reunionSelectedTags.plot;
        btn.disabled = !allSelected;
        if (allSelected) {
            btn.innerHTML = '<svg class="reunion-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 12h18"/></svg> 生成 NPC';
            btn.style.background = 'linear-gradient(135deg, #7a9e7e 0%, #8bae8b 100%)';
            btn.style.color = 'white';
            btn.style.fontWeight = '600';
        } else {
            btn.innerHTML = '<svg class="reunion-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 12h18"/></svg> 生成 NPC';
            btn.style.background = '#c9c1b6';
            btn.style.color = '#fff';
            btn.style.fontWeight = '500';
        }
    }

    async function reunionRenderTagSelection() {
        const container = document.getElementById('reunionTagSelection');
        if (!container) return;
        const tags = await reunionGetTagsByCategory(reunionCurrentDim);
        let html = '';
        tags.forEach(tag => {
            const isSelected = reunionSelectedTags[reunionCurrentDim] === tag.name;
            html += `<span class="tag-chip ${isSelected ? 'selected' : ''}" 
                data-tag-action="select" 
                data-tag-cat="${reunionCurrentDim}" 
                data-tag-name="${escapeHtml(tag.name)}">
                ${escapeHtml(tag.name)}
            </span>`;
        });
        html += '<span class="manage-tags-btn" id="reunionManageTagsBtn"><svg class="reunion-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span>';
        container.innerHTML = html;

        container.querySelectorAll('.tag-chip[data-tag-action="select"]').forEach(chip => {
            chip.addEventListener('click', () => {
                reunionSelectTag(chip.dataset.tagCat, chip.dataset.tagName);
            });
        });

        const manageBtn = document.getElementById('reunionManageTagsBtn');
        if (manageBtn) {
            manageBtn.addEventListener('click', () => {
                document.getElementById('reunionTagWarehouseModal').classList.add('active');
                reunionRenderWarehouse();
            });
        }
    }

    function reunionRenderSelectedTags() {
        const container = document.getElementById('reunionSelectedTagsRow');
        if (!container) return;

        const labels = { personality: '<svg class="reunion-inline-icon reunion-label-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>', world: '<svg class="reunion-inline-icon reunion-label-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', plot: '<svg class="reunion-inline-icon reunion-label-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>' };
        const labelNames = { personality: '性格', world: '世界观', plot: '剧本' };
        let html = '';
        let hasAny = false;

        for (const [cat, tag] of Object.entries(reunionSelectedTags)) {
            if (tag) {
                html += `<span class="selected-tag-mini">
                    ${labels[cat]} <span class="tag-label">${labelNames[cat]}:</span> ${escapeHtml(tag)}
                    <span class="remove-mini" data-remove-cat="${cat}">✕</span>
                </span>`;
                hasAny = true;
            }
        }

        if (!hasAny) {
            html = '<span class="no-tags-hint"><svg class="reunion-inline-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 13l5 5 5-5M12 4v14"/></svg> 请从上方选择标签（三个维度各选一个）</span>';
        }

        container.innerHTML = html;

        container.querySelectorAll('.remove-mini').forEach(btn => {
            btn.addEventListener('click', () => {
                reunionRemoveTag(btn.dataset.removeCat);
            });
        });
    }

    // ==================== NPC生成 ====================
    async function reunionGenerateNPC() {
        if (!reunionSelectedTags.personality || !reunionSelectedTags.world || !reunionSelectedTags.plot) {
            showStatus('请选择全部三个标签', 'error');
            return;
        }

        const personality = reunionSelectedTags.personality;
        const world = reunionSelectedTags.world;
        const plot = reunionSelectedTags.plot;
        const note = document.getElementById('reunionGenerateNote')?.value?.trim() || '';

        let noteSection = '';
        if (note) {
            noteSection = `\n【作者特别交代】\n请务必融入以下设定：${note}`;
        }

        const prompt = `你是一位小说家，正在为一部"${world}"世界观的小说构思一段"${plot}"情节，为此你需要创造一个"${personality}"性格的角色。

请严格按照以下格式输出（只输出内容，不要任何额外说明）：

【姓名】
（2-4个字的名字）

【详情】
以小说家的口吻，用自然流畅的文学段落来描写这个角色。内容包括：
- 他/她叫什么，多大年纪，做什么的
- 性格如何体现——不要只贴标签，要写出性格带来的内在矛盾、习惯、说话方式
- 他/她在这个世界观里处于什么位置，过着怎样的日常
- 简要勾勒他/她即将卷入的情节，以及这对TA意味着什么

写成一段完整的角色速写，像在笔记本上随手记录人物灵感一样。不要使用编号或列表。${noteSection}`;

        showStatus('✎ 正在创作角色...', 'info');
        if (recordApiPending) recordApiPending();

        try {
            const response = await callLLM(
                [{ role: 'user', content: prompt }], 
                { maxTokens: 600, temperature: 0.95 }
            );

            const nameMatch = response.match(/【姓名】\s*\n?\s*(.+?)(?:\n|$)/);
            let npcName = '未命名';
            if (nameMatch) {
                npcName = nameMatch[1].trim().replace(/^["'「」『』]|["'「」『』]$/g, '');
            }

            const detailMatch = response.match(/【详情】\s*\n?\s*([\s\S]+?)$/);
            let npcDetail = response;
            if (detailMatch) {
                npcDetail = detailMatch[1].trim();
            }

            const npcId = 'npc_' + Date.now();
            const npc = {
                id: npcId,
                name: npcName,
                gender: '未知',
                age: '未知',
                personality: personality,
                worldSetting: world,
                storyline: plot,
                personalityDesc: personality,
                backstory: npcDetail,
                note: note,
                createdAt: Date.now()
            };
            await DB.put('reunionNPCs', npc);

            showReunionFlipCard(npc);
            await reunionRenderNPCList();
            await reunionRenderFilterBar();
            showStatus('✓ 角色创作完成！', 'success');
        } catch (e) {
            showStatus(`✗ 创作失败: ${e.message}`, 'error');
        }
    }

    // ==================== 翻牌动画 ====================
    function showReunionFlipCard(npc) {
        reunionFlipNPC = npc;
        const modal = document.getElementById('reunionFlipModal');
        const card = document.getElementById('reunionFlipCard');
        if (!modal || !card) return;

        card.classList.remove('flipped');

        document.getElementById('flipNPCName').textContent = npc.name;
        document.getElementById('flipNPCPersonality').textContent = npc.personalityDesc || npc.personality;
        document.getElementById('flipNPCWorld').textContent = npc.worldSetting;
        document.getElementById('flipNPCPlot').textContent = npc.storyline;
        document.getElementById('flipNPCBackstory').textContent = npc.backstory;

        modal.style.display = 'flex';
    }

    function flipReunionCard() {
        const card = document.getElementById('reunionFlipCard');
        if (card) card.classList.toggle('flipped');
    }

    function closeReunionFlipModal() {
        document.getElementById('reunionFlipModal').style.display = 'none';
        reunionFlipNPC = null;
    }

    // ==================== NPC池 ====================
    async function reunionRenderNPCList(filterCategory, filterValue) {
        // 使用传入的参数或当前状态
        const cat = filterCategory || reunionCurrentFilter;
        const val = filterValue !== undefined ? filterValue : reunionCurrentFilterValue;
        
        const container = document.getElementById('reunionNPCList');
        if (!container) return;
        
        const allNPCs = await DB.getAll('reunionNPCs');

        let filtered = allNPCs;
        if (cat !== 'all' && val) {
            const fieldMap = { personality: 'personality', world: 'worldSetting', plot: 'storyline' };
            const field = fieldMap[cat];
            filtered = allNPCs.filter(npc => npc[field] === val);
        }

        filtered.sort((a, b) => b.createdAt - a.createdAt);

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="npc-empty">
                    <div class="npc-empty-icon"><svg class="reunion-inline-icon reunion-empty-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg></div>
                    <p>${cat === 'all' ? '还没有生成的NPC' : '该筛选条件下没有NPC'}</p>
                    <p style="font-size:12px;margin-top:4px;">选择标签后点击「生成 NPC」开始</p>
                </div>`;
            return;
        }

        const avatarColors = ['#7a9e7e', '#8b7d6b', '#6b8e8e', '#9b7e6b', '#7e8b6b', '#6b7b8e'];
        let html = '';
        filtered.forEach((npc, idx) => {
            const color = avatarColors[idx % avatarColors.length];
            html += `
                <div class="npc-card" data-npc-id="${npc.id}">
                    <div class="npc-card-avatar" style="background-color:${color}">${escapeHtml(npc.name.charAt(0))}</div>
                    <div class="npc-card-info">
                        <div class="npc-card-name">${escapeHtml(npc.name)}</div>
                        <div class="npc-card-tags">
                            <span class="npc-card-tag"><svg class="reunion-inline-icon reunion-card-tag-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg> ${escapeHtml(npc.personality)}</span>
                            <span class="npc-card-tag"><svg class="reunion-inline-icon reunion-card-tag-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> ${escapeHtml(npc.worldSetting)}</span>
                            <span class="npc-card-tag"><svg class="reunion-inline-icon reunion-card-tag-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> ${escapeHtml(npc.storyline)}</span>
                        </div>
                    </div>
                    <div class="npc-card-actions">
                        <button class="npc-card-action-btn export-btn" data-action="export" data-npc-id="${npc.id}"><svg class="reunion-inline-icon reunion-action-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 导入通讯录</button>
                        <button class="npc-card-action-btn" data-action="edit" data-npc-id="${npc.id}"><svg class="reunion-inline-icon reunion-action-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button class="npc-card-action-btn delete-btn" data-action="delete" data-npc-id="${npc.id}"><svg class="reunion-inline-icon reunion-action-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                    </div>
                </div>`;
        });
        container.innerHTML = html;

        // 绑定事件
        container.querySelectorAll('[data-action="export"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); reunionExportNPC(btn.dataset.npcId); });
        });
        container.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); reunionOpenEditNPC(btn.dataset.npcId); });
        });
        container.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); reunionDeleteNPC(btn.dataset.npcId); });
        });
    }

    async function reunionRenderFilterBar() {
        const container = document.getElementById('reunionFilterBar');
        if (!container) return;
        const allNPCs = await DB.getAll('reunionNPCs');

        const personalityTags = [...new Set(allNPCs.map(n => n.personality))];
        const worldTags = [...new Set(allNPCs.map(n => n.worldSetting))];
        const plotTags = [...new Set(allNPCs.map(n => n.storyline))];

        let html = `<span class="npc-filter-chip ${reunionCurrentFilter === 'all' ? 'active' : ''}" data-cat="all" data-val="">全部</span>`;

        if (personalityTags.length > 0) {
            html += '<span style="font-size:11px;color:#a0a8a2;margin:0 4px;">| 性格:</span>';
            personalityTags.forEach(t => {
                html += `<span class="npc-filter-chip ${reunionCurrentFilter === 'personality' && reunionCurrentFilterValue === t ? 'active' : ''}" data-cat="personality" data-val="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
            });
        }
        if (worldTags.length > 0) {
            html += '<span style="font-size:11px;color:#a0a8a2;margin:0 4px;">| 世界观:</span>';
            worldTags.forEach(t => {
                html += `<span class="npc-filter-chip ${reunionCurrentFilter === 'world' && reunionCurrentFilterValue === t ? 'active' : ''}" data-cat="world" data-val="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
            });
        }
        if (plotTags.length > 0) {
            html += '<span style="font-size:11px;color:#a0a8a2;margin:0 4px;">| 剧本:</span>';
            plotTags.forEach(t => {
                html += `<span class="npc-filter-chip ${reunionCurrentFilter === 'plot' && reunionCurrentFilterValue === t ? 'active' : ''}" data-cat="plot" data-val="${escapeHtml(t)}">${escapeHtml(t)}</span>`;
            });
        }

        container.innerHTML = html;

        container.querySelectorAll('.npc-filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                reunionCurrentFilter = chip.dataset.cat;
                reunionCurrentFilterValue = chip.dataset.val || null;
                reunionRenderFilterBar();
                reunionRenderNPCList(reunionCurrentFilter, reunionCurrentFilterValue);
            });
        });
    }

    // ==================== NPC操作 ====================
    async function reunionExportNPC(npcId) {
        const npc = await DB.get('reunionNPCs', npcId);
        if (!npc) return;

        if (confirm(`确定将「${npc.name}」导入通讯录吗？将自动归入「重逢」分组。`)) {
            const charId = 'char_' + Date.now();
            const detail = `性别：${npc.gender || '未知'}，年龄：${npc.age || '未知'}\n性格：${npc.personalityDesc || npc.personality}\n背景：${npc.backstory}\n\n说话风格：体现性格特点，回复简短。用"|||"分隔短句。禁止动作描写。`;

            await DB.put('characters', {
                id: charId,
                name: npc.name,
                avatar: '',
                group: '重逢',
                detail: detail
            });
            showStatus(`✓「${npc.name}」已导入通讯录（重逢分组）`, 'success');
        }
    }

    async function reunionDeleteNPC(npcId) {
        const npc = await DB.get('reunionNPCs', npcId);
        if (!npc) return;
        if (confirm(`确定删除 NPC「${npc.name}」吗？`)) {
            await DB.delete('reunionNPCs', npcId);
            await reunionRenderNPCList(reunionCurrentFilter, reunionCurrentFilterValue);
            await reunionRenderFilterBar();
            showStatus('✓ NPC 已删除', 'success');
        }
    }

    async function reunionOpenEditNPC(npcId) {
        const npc = await DB.get('reunionNPCs', npcId);
        if (!npc) return;

        document.getElementById('reunionEditNPCId').value = npc.id;
        document.getElementById('reunionEditNPCName').value = npc.name;
        document.getElementById('reunionEditNPCPersonality').value = npc.personality;
        document.getElementById('reunionEditNPCWorld').value = npc.worldSetting;
        document.getElementById('reunionEditNPCPlot').value = npc.storyline;
        document.getElementById('reunionEditNPCBackstory').value = npc.backstory;

        document.getElementById('reunionEditNPCModal').classList.add('active');
    }

    async function reunionSaveEditNPC() {
        const npcId = document.getElementById('reunionEditNPCId').value;
        const npc = await DB.get('reunionNPCs', npcId);
        if (!npc) return;

        npc.name = document.getElementById('reunionEditNPCName').value.trim() || npc.name;
        npc.personality = document.getElementById('reunionEditNPCPersonality').value.trim() || npc.personality;
        npc.worldSetting = document.getElementById('reunionEditNPCWorld').value.trim() || npc.worldSetting;
        npc.storyline = document.getElementById('reunionEditNPCPlot').value.trim() || npc.storyline;
        npc.backstory = document.getElementById('reunionEditNPCBackstory').value.trim() || npc.backstory;

        await DB.put('reunionNPCs', npc);
        document.getElementById('reunionEditNPCModal').classList.remove('active');
        await reunionRenderNPCList(reunionCurrentFilter, reunionCurrentFilterValue);
        await reunionRenderFilterBar();
        showStatus('✓ NPC 已更新', 'success');
    }

    // ==================== 标签仓库 ====================
    async function reunionRenderWarehouse() {
        const container = document.getElementById('reunionWarehouseContent');
        if (!container) return;
        
        const categories = [
            { key: 'personality', icon: '<svg class="reunion-inline-icon reunion-wh-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg>', label: '性格' },
            { key: 'world', icon: '<svg class="reunion-inline-icon reunion-wh-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', label: '世界观' },
            { key: 'plot', icon: '<svg class="reunion-inline-icon reunion-wh-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', label: '剧本' }
        ];

        let html = '';
        for (const cat of categories) {
            const tags = await reunionGetTagsByCategory(cat.key);
            html += `
                <div class="tag-warehouse-section">
                    <h3>${cat.icon} ${cat.label}</h3>
                    <div class="tag-warehouse-list">`;

            tags.forEach(tag => {
                const isPreset = tag.isPreset ? ' preset' : '';
                html += `<span class="tag-warehouse-item${isPreset}">${escapeHtml(tag.name)}${tag.description ? ' · ' + escapeHtml(tag.description) : ''}${!tag.isPreset ? `<span class="tag-delete" data-tag-id="${tag.id}" data-tag-cat="${cat.key}">✕</span>` : ''}</span>`;
            });

            html += `</div>
                    <div class="add-tag-row">
                        <input type="text" placeholder="新标签名" id="newTagName_${cat.key}" maxlength="10">
                        <input type="text" class="tag-desc-input" placeholder="简短描述" id="newTagDesc_${cat.key}" maxlength="20">
                        <button data-cat="${cat.key}" class="add-tag-warehouse-btn">+ 添加</button>
                    </div>
                </div>`;
        }

        container.innerHTML = html;

        // 删除标签
        container.querySelectorAll('.tag-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const tagId = btn.dataset.tagId;
                const tagCat = btn.dataset.tagCat;
                const success = await reunionDeleteTag(tagId);
                if (success) {
                    const tag = await DB.get('reunionTags', tagId);
                    if (reunionSelectedTags[tagCat] === tag?.name) {
                        reunionSelectedTags[tagCat] = null;
                        reunionRenderSelectedTags();
                        reunionUpdateGenerateBtn();
                    }
                    reunionRenderWarehouse();
                    reunionRenderTagSelection();
                    reunionRenderFilterBar();
                }
            });
        });

        // 添加标签
        container.querySelectorAll('.add-tag-warehouse-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const cat = btn.dataset.cat;
                const nameInput = document.getElementById(`newTagName_${cat}`);
                const descInput = document.getElementById(`newTagDesc_${cat}`);
                const name = nameInput.value.trim();
                if (!name) { alert('请输入标签名'); return; }
                await reunionAddTag(cat, name, descInput.value.trim());
                nameInput.value = '';
                descInput.value = '';
                reunionRenderWarehouse();
                reunionRenderTagSelection();
            });
        });
    }

    // ==================== 事件绑定 ====================
    function bindReunionEvents() {
        // 维度标签切换
        document.querySelectorAll('.dimension-tab').forEach(tab => {
            tab.onclick = () => {
                reunionCurrentDim = tab.dataset.dim;
                document.querySelectorAll('.dimension-tab').forEach(t => {
                    t.classList.toggle('active', t.dataset.dim === reunionCurrentDim);
                });
                reunionRenderTagSelection();
            };
        });

        // 生成按钮
        const generateBtn = document.getElementById('reunionGenerateBtn');
        if (generateBtn && !generateBtn.dataset.reunionBound) {
            generateBtn.dataset.reunionBound = '1';
            generateBtn.addEventListener('click', reunionGenerateNPC);
        }

        // 翻牌
        const flipContainer = document.getElementById('reunionFlipContainer');
        if (flipContainer && !flipContainer.dataset.reunionBound) {
            flipContainer.dataset.reunionBound = '1';
            flipContainer.addEventListener('click', (e) => {
                if (!e.target.closest('.flip-close-btn') && !e.target.closest('#reunionFlipConfirmBtn')) {
                    flipReunionCard();
                }
            });
        }
        document.getElementById('reunionFlipCloseTop')?.addEventListener('click', closeReunionFlipModal);
        document.getElementById('reunionFlipCloseBack')?.addEventListener('click', closeReunionFlipModal);
        document.getElementById('reunionFlipConfirmBtn')?.addEventListener('click', closeReunionFlipModal);

        // 标签仓库
        document.getElementById('reunionTagWarehouseBtn')?.addEventListener('click', () => {
            document.getElementById('reunionTagWarehouseModal').classList.add('active');
            reunionRenderWarehouse();
        });
        document.getElementById('reunionCloseWarehouseBtn')?.addEventListener('click', () => {
            document.getElementById('reunionTagWarehouseModal').classList.remove('active');
        });

        // 编辑NPC
        document.getElementById('reunionCancelEditNPCBtn')?.addEventListener('click', () => {
            document.getElementById('reunionEditNPCModal').classList.remove('active');
        });
        document.getElementById('reunionSaveEditNPCBtn')?.addEventListener('click', reunionSaveEditNPC);

        // 底部标签切换
        document.querySelectorAll('.reunion-bottom-tab').forEach(tab => {
            if (!tab.dataset.reunionBound) {
                tab.dataset.reunionBound = '1';
                tab.addEventListener('click', () => {
                    const panelId = tab.dataset.panel;

                    document.querySelectorAll('.reunion-bottom-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    document.querySelectorAll('.reunion-panel').forEach(p => p.classList.remove('active'));

                    const topArea = document.querySelector('.reunion-top');

                    if (panelId === 'generate') {
                        document.getElementById('reunionGeneratePanel').classList.add('active');
                        if (topArea) topArea.style.display = 'block';
                    } else if (panelId === 'npcpool') {
                        document.getElementById('reunionNPCPoolPanel').classList.add('active');
                        if (topArea) topArea.style.display = 'none';
                        reunionRenderNPCList(reunionCurrentFilter, reunionCurrentFilterValue);
                    } else if (panelId === 'worldbook') {
                        document.getElementById('reunionWorldbookPanel').classList.add('active');
                        if (topArea) topArea.style.display = 'none';
                        reunionWorldbookRenderNPCList();
                    }
                });
            }
        });

        // 开盲盒按钮
        const luckBtn = document.getElementById('reunionLuckBtn');
        if (luckBtn && !luckBtn.dataset.reunionBound) {
            luckBtn.dataset.reunionBound = '1';
            luckBtn.addEventListener('click', reunionLuckDraw);
        }

        // 世界书生成按钮
        const wbGenBtn = document.getElementById('reunionWorldbookGenerateBtn');
        if (wbGenBtn && !wbGenBtn.dataset.reunionBound) {
            wbGenBtn.dataset.reunionBound = '1';
            wbGenBtn.addEventListener('click', reunionGenerateWorldbook);
        }

        // 世界书 NPC 列表 checkbox 委托点击
        const wbNpcList = document.getElementById('reunionWorldbookNPCList');
        if (wbNpcList && !wbNpcList.dataset.reunionBound) {
            wbNpcList.dataset.reunionBound = '1';
            wbNpcList.addEventListener('click', (e) => {
                const item = e.target.closest('.worldbook-npc-checkbox');
                if (item) {
                    item.classList.toggle('checked');
                    const cb = item.querySelector('input[type="checkbox"]');
                    if (cb) cb.checked = !cb.checked;
                }
            });
        }
    }

    // ==================== 开盲盒 ====================
    async function reunionLuckDraw() {
        showStatus('>> 正在开盲盒，随机抽取标签...', 'info');
        try {
            const categories = ['personality', 'world', 'plot'];
            const picked = {};

            for (const cat of categories) {
                const tags = await reunionGetTagsByCategory(cat);
                if (tags.length === 0) {
                    showStatus(`✗ "${cat}" 分类下没有可用标签`, 'error');
                    return;
                }
                const randomTag = tags[Math.floor(Math.random() * tags.length)];
                picked[cat] = randomTag.name;
            }

            // 设定选中的标签
            reunionSelectedTags.personality = picked.personality;
            reunionSelectedTags.world = picked.world;
            reunionSelectedTags.plot = picked.plot;
            reunionRenderSelectedTags();
            reunionUpdateGenerateBtn();
            reunionRenderTagSelection();

            showStatus(`>> 抽中：${picked.personality} · ${picked.world} · ${picked.plot}，正在生成...`, 'info');

            // 直接调用 NPC 生成（自动使用已选中的标签）
            await reunionGenerateNPC();
        } catch (e) {
            showStatus(`✗ 开盲盒失败: ${e.message}`, 'error');
        }
    }

    // ==================== 世界书生成 ====================
    async function reunionWorldbookRenderNPCList() {
        const container = document.getElementById('reunionWorldbookNPCList');
        if (!container) return;

        const allNPCs = await DB.getAll('reunionNPCs');
        allNPCs.sort((a, b) => b.createdAt - a.createdAt);

        if (allNPCs.length === 0) {
            container.innerHTML = '<div class="worldbook-empty-hint">还没有NPC，先去生成一些吧</div>';
            return;
        }

        let html = '';
        allNPCs.forEach(npc => {
            const escapedName = escapeHtml(npc.name);
            html += `<span class="worldbook-npc-checkbox" data-npc-id="${npc.id}">
                <span class="check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                ${escapedName}
            </span>`;
        });
        container.innerHTML = html;
    }

    async function reunionGenerateWorldbook() {
        // 收集选中的 NPC
        const checkedItems = document.querySelectorAll('#reunionWorldbookNPCList .worldbook-npc-checkbox.checked');
        const selectedNPCIds = Array.from(checkedItems).map(el => el.dataset.npcId);

        const tagsInput = document.getElementById('reunionWorldbookTagsInput');
        const descInput = document.getElementById('reunionWorldbookDescInput');
        const titleInput = document.getElementById('reunionWorldbookTitleInput');

        const tagsText = tagsInput ? tagsInput.value.trim() : '';
        const descText = descInput ? descInput.value.trim() : '';
        const titleText = titleInput ? titleInput.value.trim() : '';

        if (!titleText) {
            showStatus('请填写世界书标题', 'error');
            return;
        }

        if (selectedNPCIds.length === 0 && !tagsText && !descText) {
            showStatus('请至少选择一个NPC，或填写关键词/描述', 'error');
            return;
        }

        showStatus('[书] 正在创作世界书...', 'info');
        if (recordApiPending) recordApiPending();

        try {
            // 获取选中 NPC 的信息
            let npcInfoText = '';
            if (selectedNPCIds.length > 0) {
                const npcPromises = selectedNPCIds.map(id => DB.get('reunionNPCs', id));
                const npcs = await Promise.all(npcPromises);
                const validNPCs = npcs.filter(n => n);
                if (validNPCs.length > 0) {
                    npcInfoText = '\n\n【已选角色】\n' + validNPCs.map(n =>
                        `- ${n.name}（性格：${n.personality}，背景：${n.backstory?.substring(0, 100) || '无'})`
                    ).join('\n');
                }
            }

            let extraSection = '';
            if (tagsText) extraSection += `\n【关键词】${tagsText}`;
            if (descText) extraSection += `\n【描述】${descText}`;

            const prompt = `你是一位小说家，正在创作一部新作品的"世界书"设定。

世界书标题：${titleText}
${extraSection}${npcInfoText}

请严格按照以下格式输出（只输出内容，不要任何额外说明）：

【世界背景】
（描述这个世界的基本设定、时代背景、地理环境等，200-300字）

【核心规则】
（这个世界运行的独特规则、魔法/科技体系、社会结构等，150-200字）

【主要冲突】
（这个世界中正在酝酿或已经存在的核心矛盾/冲突，100-150字）

【氛围与基调】
（描述这个世界的情感氛围和叙事基调，50-100字）`;

            const response = await callLLM(
                [{ role: 'user', content: prompt }],
                { maxTokens: 800, temperature: 0.9 }
            );

            const worldbookId = 'wb_' + Date.now();
            const worldbook = {
                id: worldbookId,
                title: titleText,
                tags: tagsText,
                description: descText,
                selectedNPCIds: selectedNPCIds,
                fullContent: response,
                group: '重逢',
                createdAt: Date.now()
            };

            // 存入 worldbooks 集合
            await DB.put('worldbooks', worldbook);

            showStatus('✓ 世界书创作完成！', 'success');

            // 清理输入
            if (tagsInput) tagsInput.value = '';
            if (descInput) descInput.value = '';
            if (titleInput) titleInput.value = '';
            document.querySelectorAll('#reunionWorldbookNPCList .worldbook-npc-checkbox.checked').forEach(el => {
                el.classList.remove('checked');
                const cb = el.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            });

        } catch (e) {
            showStatus(`✗ 世界书创作失败: ${e.message}`, 'error');
        }
    }

    console.log('[模块] 重逢模块脚本已就绪，等待 initReunionModule() 调用');
})();