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

        console.log('🌟 重逢模块已加载');
        
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
            btn.textContent = '✨ 生成 NPC';
            btn.style.background = 'linear-gradient(135deg, #7a9e7e 0%, #8bae8b 100%)';
            btn.style.color = 'white';
            btn.style.fontWeight = '600';
        } else {
            btn.textContent = '✨ 生成 NPC';
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
        html += '<span class="manage-tags-btn" id="reunionManageTagsBtn">⚙️</span>';
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

        const labels = { personality: '😊', world: '🌍', plot: '📖' };
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
            html = '<span class="no-tags-hint">👆 请从上方选择标签（三个维度各选一个）</span>';
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

        showStatus('✍️ 正在创作角色...', 'info');
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
            showStatus('✅ 角色创作完成！', 'success');
        } catch (e) {
            showStatus(`❌ 创作失败: ${e.message}`, 'error');
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
                    <div class="npc-empty-icon">🌟</div>
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
                            <span class="npc-card-tag">😊 ${escapeHtml(npc.personality)}</span>
                            <span class="npc-card-tag">🌍 ${escapeHtml(npc.worldSetting)}</span>
                            <span class="npc-card-tag">📖 ${escapeHtml(npc.storyline)}</span>
                        </div>
                    </div>
                    <div class="npc-card-actions">
                        <button class="npc-card-action-btn export-btn" data-action="export" data-npc-id="${npc.id}">📤 导入通讯录</button>
                        <button class="npc-card-action-btn" data-action="edit" data-npc-id="${npc.id}">✏️</button>
                        <button class="npc-card-action-btn delete-btn" data-action="delete" data-npc-id="${npc.id}">🗑️</button>
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
            showStatus(`✅「${npc.name}」已导入通讯录（重逢分组）`, 'success');
        }
    }

    async function reunionDeleteNPC(npcId) {
        const npc = await DB.get('reunionNPCs', npcId);
        if (!npc) return;
        if (confirm(`确定删除 NPC「${npc.name}」吗？`)) {
            await DB.delete('reunionNPCs', npcId);
            await reunionRenderNPCList(reunionCurrentFilter, reunionCurrentFilterValue);
            await reunionRenderFilterBar();
            showStatus('✅ NPC 已删除', 'success');
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
        showStatus('✅ NPC 已更新', 'success');
    }

    // ==================== 标签仓库 ====================
    async function reunionRenderWarehouse() {
        const container = document.getElementById('reunionWarehouseContent');
        if (!container) return;
        
        const categories = [
            { key: 'personality', icon: '😊', label: '性格' },
            { key: 'world', icon: '🌍', label: '世界观' },
            { key: 'plot', icon: '📖', label: '剧本' }
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
                    }
                });
            }
        });
    }

    console.log('🌟 重逢模块脚本已就绪，等待 initReunionModule() 调用');
})();