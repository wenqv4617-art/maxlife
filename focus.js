// ============================================
// 专注模式模块 - focus.js
// 版本：v1.0
// 说明：提供专注计时、陪伴立绘、随机语句、专注报告功能
// 依赖：需要全局 DB 对象（IndexedDB操作）
//      需要全局 showStatus 函数
//      需要全局 escapeHtml 函数
//      需要全局 callLLM 函数（AI调用）
//      需要全局 recordApiPending 函数（API监控）
//      需要全局 loadConversationMessages 函数
// ============================================

(function() {
    "use strict";

    // 缓存全局依赖
    let DB, showStatus, escapeHtml, callLLM, recordApiPending, loadConversationMessages;

    // ==================== 模块内部状态 ====================
    let focusMode = 'study';
    let focusDuration = 30;
    let focusSecondsLeft = 0;
    let focusTimerInterval = null;
    let focusSentences = [];
    let focusAllSentencesHistory = [];
    let focusCurrentBubbleTimeout = null;
    let focusTotalDuration = 0;
    let focusType = '';

    // ==================== 初始化 ====================
    window.initFocusModule = async function(deps) {
        if (deps) {
            DB = deps.DB;
            showStatus = deps.showStatus;
            escapeHtml = deps.escapeHtml;
            callLLM = deps.callLLM;
            recordApiPending = deps.recordApiPending;
            loadConversationMessages = deps.loadConversationMessages;
        } else {
            DB = window.DB;
            showStatus = window.showStatus || function(msg, type) { console.log(`[${type}] ${msg}`); };
            escapeHtml = window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
            callLLM = window.callLLM;
            recordApiPending = window.recordApiPending || function() {};
            loadConversationMessages = window.loadConversationMessages || function() {};
        }

        console.log('🧘 专注模块已加载');
        bindFocusEvents();
    };

    // ==================== 事件绑定 ====================
    function bindFocusEvents() {
        // 在 expandMenu 中添加专注按钮（如果还没有）
        const expandMenu = document.getElementById('expandMenu');
        if (expandMenu && !document.querySelector('.expand-menu-item[data-action="focus"]')) {
            const focusItem = document.createElement('div');
            focusItem.className = 'expand-menu-item';
            focusItem.dataset.action = 'focus';
            // B (新代码)
focusItem.innerHTML = '<span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span><span class="expand-menu-label">专注</span>';
            expandMenu.appendChild(focusItem);
            
            focusItem.addEventListener('click', () => {
                expandMenu.classList.remove('active');
                openFocusSetup();
            });
        }

        // 设置弹窗 - 取消
        document.getElementById('cancelFocusSetupBtn')?.addEventListener('click', () => {
            document.getElementById('focusSetupModal').classList.remove('active');
        });

        // 模式选择按钮
        document.querySelectorAll('.focus-mode-btn').forEach(btn => {
            if (!btn.dataset.focusBound) {
                btn.dataset.focusBound = '1';
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.focus-mode-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    focusMode = btn.dataset.mode;
                });
            }
        });

        // 时长选择按钮
        document.querySelectorAll('.focus-duration-btn').forEach(btn => {
            if (!btn.dataset.focusBound) {
                btn.dataset.focusBound = '1';
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.focus-duration-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    focusDuration = parseInt(btn.dataset.dur);
                });
            }
        });

        // 本地上传立绘
        const uploadBtn = document.getElementById('focusUploadBtn');
        const fileInput = document.getElementById('focusImageFile');
        if (uploadBtn && fileInput && !uploadBtn.dataset.focusBound) {
            uploadBtn.dataset.focusBound = '1';
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                        const img = new Image();
                        img.onload = async () => {
                            const canvas = document.createElement('canvas');
                            const maxW = 800, maxH = 1200;
                            let w = img.width, h = img.height;
                            if (w / h > maxW / maxH) {
                                if (w > maxW) { h = (h * maxW) / w; w = maxW; }
                            } else {
                                if (h > maxH) { w = (w * maxH) / h; h = maxH; }
                            }
                            canvas.width = w;
                            canvas.height = h;
                            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                            document.getElementById('focusImageData').value = dataUrl;
                            renderFocusPreview(dataUrl);
                        };
                        img.src = ev.target.result;
                    };
                    reader.readAsDataURL(file);
                    e.target.value = '';
                }
            });
        }

        // URL导入立绘
        const urlBtn = document.getElementById('focusUrlBtn');
        if (urlBtn && !urlBtn.dataset.focusBound) {
            urlBtn.dataset.focusBound = '1';
            urlBtn.addEventListener('click', async () => {
                const url = prompt('请输入立绘图片URL:');
                if (url && url.trim()) {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = async () => {
                        const canvas = document.createElement('canvas');
                        const maxW = 800, maxH = 1200;
                        let w = img.width, h = img.height;
                        if (w / h > maxW / maxH) {
                            if (w > maxW) { h = (h * maxW) / w; w = maxW; }
                        } else {
                            if (h > maxH) { w = (w * maxH) / h; h = maxH; }
                        }
                        canvas.width = w;
                        canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                        document.getElementById('focusImageData').value = dataUrl;
                        renderFocusPreview(dataUrl);
                    };
                    img.onerror = () => alert('图片加载失败');
                    img.src = url.trim();
                }
            });
        }

        // 清除立绘
        const clearBtn = document.getElementById('focusClearBtn');
        if (clearBtn && !clearBtn.dataset.focusBound) {
            clearBtn.dataset.focusBound = '1';
            clearBtn.addEventListener('click', () => {
                document.getElementById('focusImageData').value = '';
                renderFocusPreview('');
            });
        }

        // 开始专注
        const startBtn = document.getElementById('startFocusBtn');
        if (startBtn && !startBtn.dataset.focusBound) {
            startBtn.dataset.focusBound = '1';
            startBtn.addEventListener('click', startFocusSession);
        }

        // 退出专注
        const exitBtn = document.getElementById('focusExitBtn');
        if (exitBtn && !exitBtn.dataset.focusBound) {
            exitBtn.dataset.focusBound = '1';
            exitBtn.addEventListener('click', exitFocus);
        }

        // 点击立绘显示气泡
        const imageContainer = document.getElementById('focusImageContainer');
        if (imageContainer && !imageContainer.dataset.focusBound) {
            imageContainer.dataset.focusBound = '1';
            imageContainer.addEventListener('click', (e) => {
                // 涟漪效果
                const ripple = document.createElement('span');
                const container = e.currentTarget;
                const rect = container.getBoundingClientRect();
                const size = Math.max(container.offsetWidth, container.offsetHeight);
                const x = e.clientX - rect.left - size / 2;
                const y = e.clientY - rect.top - size / 2;

                ripple.style.cssText = `
                    position: absolute;
                    width: ${size}px;
                    height: ${size}px;
                    left: ${x}px;
                    top: ${y}px;
                    background: rgba(255, 255, 255, 0.3);
                    border-radius: 50%;
                    transform: scale(0);
                    animation: focusRipple 0.6s ease-out;
                    pointer-events: none;
                    z-index: 5;
                `;
                container.appendChild(ripple);
                ripple.addEventListener('animationend', () => ripple.remove());

                showRandomFocusSentence();
            });
        }

        // 继续专注按钮
        document.querySelectorAll('.focus-continue-btn').forEach(btn => {
            if (!btn.dataset.focusBound) {
                btn.dataset.focusBound = '1';
                btn.addEventListener('click', () => continueFocus(parseInt(btn.dataset.min)));
            }
        });

        // 生成报告
        const reportBtn = document.getElementById('generateFocusReportBtn');
        if (reportBtn && !reportBtn.dataset.focusBound) {
            reportBtn.dataset.focusBound = '1';
            reportBtn.addEventListener('click', generateFocusReport);
        }

        // 关闭结束弹窗
        const closeEndBtn = document.getElementById('closeFocusEndBtn');
        if (closeEndBtn && !closeEndBtn.dataset.focusBound) {
            closeEndBtn.dataset.focusBound = '1';
            closeEndBtn.addEventListener('click', () => {
                document.getElementById('focusEndModal').classList.remove('active');
            });
        }

        // 查看专注报告（聊天中的气泡点击）
        document.addEventListener('click', (e) => {
            const reportBubble = e.target.closest('.focus-report-bubble');
            if (reportBubble) {
                try {
                    const reportData = JSON.parse(reportBubble.dataset.reportData);
                    showFocusReportModal(reportData);
                } catch (e) {}
            }
        });
    }

    // ==================== 立绘预览 ====================
    function renderFocusPreview(dataUrl) {
        const preview = document.getElementById('focusImagePreview');
        if (!preview) return;
        if (dataUrl) {
            preview.innerHTML = `<img src="${dataUrl}" style="max-width:100%; max-height:240px; object-fit:contain; border-radius:12px;" alt="立绘预览">`;
        } else {
            preview.innerHTML = '<span style="color:#eee;">暂无立绘</span>';
        }
    }

    // ==================== 打开设置弹窗 ====================
    async function openFocusSetup() {
        const convId = window.currentConversationId;
        if (!convId) {
            showStatus('请先进入对话', 'error');
            return;
        }

        // 加载已保存的立绘
        let savedImage = '';
        try {
            const convDetail = await DB.get('convDetails', convId);
            savedImage = convDetail?.focusImage || '';
        } catch (e) {}

        document.getElementById('focusImageData').value = savedImage;
        renderFocusPreview(savedImage);
        document.getElementById('focusSetupModal').classList.add('active');
    }

    // ==================== 开始专注 ====================
    async function startFocusSession() {
        const convId = window.currentConversationId;
        if (!convId) return;

        // 保存立绘设置
        try {
            let convDetail = await DB.get('convDetails', convId);
            if (!convDetail) {
                convDetail = { conversationId: convId, charId: window.currentCharId };
            }
            convDetail.focusImage = document.getElementById('focusImageData').value;
            await DB.put('convDetails', convDetail);
        } catch (e) {}

        const imageUrl = document.getElementById('focusImageData').value;
        if (!imageUrl) {
            alert('请先导入陪伴立绘');
            return;
        }

        document.getElementById('focusSetupModal').classList.remove('active');

        // 显示加载卡片
        const loadingCard = document.getElementById('focusLoadingCard');
        if (loadingCard) loadingCard.style.display = 'block';

        focusTotalDuration = focusDuration;
        focusSecondsLeft = focusDuration * 60;
        focusType = focusMode;
        focusAllSentencesHistory = [];

        // 生成陪伴语句
        try {
            const char = await DB.get('characters', window.currentCharId);
            if (char) {
                const loadingText = document.getElementById('focusLoadingText');
                if (loadingText) loadingText.textContent = char.name + ' 正在准备中...';
            }
            await generateFocusSentences(false);
        } catch (e) {
            console.error('生成专注句子失败', e);
            focusSentences = getDefaultSentences();
        }

        // 隐藏加载卡片
        if (loadingCard) loadingCard.style.display = 'none';

        // 显示专注界面
        document.getElementById('focusFullImage').src = imageUrl;
        document.getElementById('focusActiveOverlay').style.display = 'block';
        document.getElementById('focusBubble').style.display = 'none';

        updateFocusTimerDisplay();

        // 启动计时器
        clearInterval(focusTimerInterval);
        focusTimerInterval = setInterval(focusTick, 1000);
    }

    // ==================== 计时器 ====================
    function updateFocusTimerDisplay() {
        const mins = Math.floor(focusSecondsLeft / 60);
        const secs = focusSecondsLeft % 60;
        const timerEl = document.getElementById('focusTimer');
        if (timerEl) {
            timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }

    function focusTick() {
        if (focusSecondsLeft <= 0) {
            clearInterval(focusTimerInterval);
            focusTimerInterval = null;
            showFocusEndModal();
            return;
        }
        focusSecondsLeft--;
        updateFocusTimerDisplay();
    }

    // ==================== 陪伴语句生成 ====================
    async function generateFocusSentences(isContinue = false) {
        const convId = window.currentConversationId;
        if (!convId) return;

        const char = await DB.get('characters', window.currentCharId);
        if (!char) return;

        let sentenceCount = 15;
        if (focusDuration >= 90) sentenceCount = 45;
        else if (focusDuration >= 60) sentenceCount = 45;
        else if (focusDuration >= 30) sentenceCount = 40;
        else if (focusDuration >= 10) sentenceCount = 25;

        // 获取最近对话上下文
        let recentContext = '';
        try {
            const chats = await DB.queryByIndex('chats', 'conversationId', convId);
            const displayChats = chats
                .filter(c => c.messageType !== 'innerVoice' && c.messageType !== 'focus_report');
            displayChats.sort((a, b) => b.timestamp - a.timestamp);
            recentContext = displayChats.slice(0, 10).reverse().map(c => c.content).join('\n');
        } catch (e) {}

        // 获取核心记忆
        let memoryText = '';
        try {
            const memories = await DB.queryByIndex('memories', 'conversationId', convId);
            const coreMemories = memories
                .filter(m => m.type === 'core_memory')
                .sort((a, b) => b.createdAt - a.createdAt);
            memoryText = coreMemories.map(m => m.content).join('\n');
        } catch (e) {}

        const modeNames = { study: '学习', work: '工作', rest: '小憩', meditation: '冥想' };
        const modeName = modeNames[focusMode] || '专注';

        const prompt = `你是${char.name}，正在陪伴用户进行${focusDuration}分钟的${modeName}。

角色设定：${char.detail || '温暖体贴的陪伴者'}
最近对话：
${recentContext || '暂无'}
核心记忆：
${memoryText || '暂无'}

请生成${sentenceCount}条短句，用于在用户专注时随机显示。要求：
1. 分为三类：
   - 情景类（60%）：与${modeName}相关的陪伴话语，如关心进度、提问、闲谈
   - 记忆类（20%）：根据最近对话和核心记忆内容，提及具体的事件、约定、考试、论文等
   - 时间触发类（20%），每条带时间标签：
     * [前期]标签（剩余100%-85%时触发）：专心、这就坐不住了、再学一会等
     * [后期]标签（剩余20%-0%时触发）：就快结束了、再陪我待一会儿、休息一下眼睛等

2. 每条短句不超过20字，口语化，像微信消息。
3. 输出纯文本，每行一条。
4. 普通句不需要标签。`;

        try {
            const raw = await callLLM([{ role: 'user', content: prompt }], { maxTokens: 800, temperature: 0.9 });
            const lines = raw.split('\n').filter(l => l.trim());
            if (lines.length === 0) throw new Error('空响应');

            if (isContinue) {
                focusSentences = focusSentences.concat(lines);
            } else {
                focusSentences = lines;
            }
            focusAllSentencesHistory = focusAllSentencesHistory.concat(lines);
        } catch (e) {
            focusSentences = getDefaultSentences();
            focusAllSentencesHistory = focusAllSentencesHistory.concat(focusSentences);
        }
    }

    function getDefaultSentences() {
        const modeWords = {
            study: ['好好学', '我脸上有字吗？', '遇到难题了?', '嗯。', '嗯？', '不会的题就先空着', '我看看'],
            work: ['专心', '加油', '喝口水', '别太累', '这个方案不错'],
            rest: ['闭眼休息一会', '放松', '音乐好听吗', '嗯~'],
            meditation: ['吸气...', '呼气...', '放空', '感受当下']
        };
        const base = modeWords[focusMode] || modeWords.study;
        const timeTriggers = [
            '[前期]专心', '[前期]这就坐不住了?', '[前期]再学一会',
            '[后期]就快结束了', '[后期]再陪我待一会儿', '[后期]结束之后休息一下眼睛'
        ];
        return base.concat(timeTriggers);
    }

    // ==================== 随机显示语句 ====================
    function showRandomFocusSentence() {
        if (focusCurrentBubbleTimeout) clearTimeout(focusCurrentBubbleTimeout);

        const totalSecs = focusDuration * 60;
        const remainRatio = totalSecs > 0 ? focusSecondsLeft / totalSecs : 0;

        let pool = [...focusSentences];
        let timeFiltered = [];
        for (const s of pool) {
            if (s.startsWith('[前期]')) {
                if (remainRatio >= 0.85) timeFiltered.push(s.replace('[前期]', ''));
            } else if (s.startsWith('[后期]')) {
                if (remainRatio <= 0.2) timeFiltered.push(s.replace('[后期]', ''));
            } else {
                timeFiltered.push(s);
            }
        }

        if (timeFiltered.length === 0) return;

        const sentence = timeFiltered[Math.floor(Math.random() * timeFiltered.length)];
        const bubble = document.getElementById('focusBubble');
        if (bubble) {
            bubble.textContent = sentence;
            bubble.style.display = 'block';

            focusCurrentBubbleTimeout = setTimeout(() => {
                bubble.style.display = 'none';
            }, 3000);
        }
    }

    // ==================== 退出 & 结束 ====================
    function exitFocus() {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        document.getElementById('focusActiveOverlay').style.display = 'none';
        const loadingCard = document.getElementById('focusLoadingCard');
        if (loadingCard) loadingCard.style.display = 'none';
    }

    function showFocusEndModal() {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        document.getElementById('focusActiveOverlay').style.display = 'none';
        const loadingCard = document.getElementById('focusLoadingCard');
        if (loadingCard) loadingCard.style.display = 'none';
        document.getElementById('focusEndModal').classList.add('active');
    }

    // ==================== 继续专注 ====================
    async function continueFocus(addMinutes) {
        document.getElementById('focusEndModal').classList.remove('active');

        focusDuration = addMinutes;
        focusTotalDuration += addMinutes;
        focusSecondsLeft = addMinutes * 60;

        // 显示加载
        const loadingCard = document.getElementById('focusLoadingCard');
        if (loadingCard) loadingCard.style.display = 'block';

        try {
            await generateFocusSentences(true);
        } catch (e) {
            console.error('继续专注生成句子失败', e);
        }

        if (loadingCard) loadingCard.style.display = 'none';

        // 重新显示专注界面
        document.getElementById('focusActiveOverlay').style.display = 'block';
        updateFocusTimerDisplay();

        clearInterval(focusTimerInterval);
        focusTimerInterval = setInterval(focusTick, 1000);
    }

    // ==================== 生成专注报告 ====================
    async function generateFocusReport() {
        document.getElementById('focusEndModal').classList.remove('active');

        const convId = window.currentConversationId;
        if (!convId) return;

        const modeNames = { study: '学习', work: '工作', rest: '小憩', meditation: '冥想' };
        const reportData = {
            type: 'focus_report',
            mode: modeNames[focusType] || '专注',
            totalMinutes: focusTotalDuration,
            sentences: focusAllSentencesHistory.map(s => s.replace(/^\[前期\]|^\[后期\]/, '')),
            timestamp: Date.now()
        };

        try {
            const conv = await DB.get('conversations', convId);
            if (!conv) return;

            await DB.put('chats', {
                role: 'assistant',
                content: JSON.stringify(reportData),
                messageType: 'focus_report',
                conversationId: convId,
                charId: conv.charId,
                timestamp: Date.now()
            });

            await DB.put('conversations', { ...conv, updatedAt: Date.now() });
            await loadConversationMessages(convId);
            showStatus('✅ 专注报告已生成', 'success');
        } catch (e) {
            showStatus('❌ 报告生成失败', 'error');
        }

        focusAllSentencesHistory = [];
    }

    // ==================== 查看报告弹窗 ====================
    function showFocusReportModal(reportData) {
        const existing = document.querySelector('.focus-report-view-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'focus-report-view-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.4);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
        `;

        const sentencesHtml = (reportData.sentences || []).map(s =>
            `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.15);color:#f4f4f4;">${escapeHtml(s)}</div>`
        ).join('');

        modal.innerHTML = `
            <div style="
                background: rgba(255,255,255,0.2);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 20px;
                max-width: 360px;
                width: 100%;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
            ">
                <div style="padding:16px;border-bottom:1px solid rgba(255,255,255,0.2);display:flex;justify-content:space-between;align-items:center;">
                    <span style="font-weight:600;color:#fff;">🧘 专注报告</span>
                    <button class="close-report-btn" style="background:none;border:none;font-size:20px;cursor:pointer;color:#fff;">✕</button>
                </div>
                <div style="padding:16px;color:#f4f4f4;">
                    <div>📌 模式：${escapeHtml(reportData.mode)}</div>
                    <div>⏱️ 时长：${reportData.totalMinutes}分钟</div>
                </div>
                <div style="flex:1;overflow-y:auto;padding:0 16px 16px;max-height:50vh;">
                    ${sentencesHtml || '<div style="color:#aaa;text-align:center;padding:20px;">暂无数据</div>'}
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('.close-report-btn')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    }

    console.log('🧘 专注模块脚本已就绪，等待 initFocusModule() 调用');
    // 在 focus.js 文件最底部，})(); 之前添加：
window.showFocusReportModal = showFocusReportModal;
})();
