// ============================================
// 语音通话模块 - voice-call.js
// 版本：v1.0
// 说明：提供语音通话发起/接听/挂断/通话消息/
//       来电弹窗/线下邀约等完整功能
// 依赖：需要全局 DB 对象（IndexedDB操作）
//      需要全局 showStatus 函数
//      需要全局 escapeHtml 函数
//      需要全局 callLLM 函数（AI调用）
//      需要全局 recordApiPending 函数（API监控）
//      需要全局 loadConversationMessages 函数
//      需要全局 buildSystemPrompt 函数
// ============================================

(function() {
    "use strict";

    // 缓存全局依赖
    let DB, showStatus, escapeHtml, callLLM, recordApiPending, loadConversationMessages, buildSystemPrompt, getAvatarColor;

    // ==================== 模块内部状态 ====================
    let voiceCallActive = false;
    let voiceCallRole = null;          // 'caller' | 'receiver'
    let voiceCallConversationId = null;
    let voiceCallStartTime = null;
    let voiceCallTimerInterval = null;
    let voiceCallMessages = [];

    // ==================== 初始化 ====================
    window.initVoiceCallModule = async function(deps) {
        if (deps) {
            DB = deps.DB;
            showStatus = deps.showStatus;
            escapeHtml = deps.escapeHtml;
            callLLM = deps.callLLM;
            recordApiPending = deps.recordApiPending;
            loadConversationMessages = deps.loadConversationMessages;
            buildSystemPrompt = deps.buildSystemPrompt;
            getAvatarColor = deps.getAvatarColor;
        } else {
            // 回退到全局
            DB = window.DB;
            showStatus = window.showStatus || function(msg, type) { console.log(`[${type}] ${msg}`); };
            escapeHtml = window.escapeHtml || function(s) { return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); };
            callLLM = window.callLLM;
            recordApiPending = window.recordApiPending || function() {};
            loadConversationMessages = window.loadConversationMessages || function() {};
            buildSystemPrompt = window.buildSystemPrompt || async function() { return ''; };
            getAvatarColor = window.getAvatarColor || function(n) { return '#444'; };
        }

        console.log('📞 语音通话模块已加载');
        bindVoiceCallEvents();
    };

    // ==================== 事件绑定 ====================
    function bindVoiceCallEvents() {
        // 挂断
        document.getElementById('voiceCallHangupBtn')?.addEventListener('click', hangUpVoiceCall);
        // 接听
        document.getElementById('voiceCallAnswerBtn')?.addEventListener('click', connectVoiceCall);
        // 发送通话消息
        document.getElementById('voiceCallSendBtn')?.addEventListener('click', sendVoiceCallMessage);
        document.getElementById('voiceCallInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendVoiceCallMessage();
        });

        // 静音按钮（视觉切换）
        document.getElementById('voiceCallMuteBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            if (btn.style.background === 'rgb(255, 255, 255)') {
                btn.style.background = '#333';
                btn.style.color = '';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
            } else {
                btn.style.background = '#fff';
                btn.style.color = '#000';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v5"/><path d="M15 9V4a3 3 0 0 0-5.12-2.12"/><path d="M19 10v2a7 7 0 0 1-11.9 4.95"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
            }
        });

        // 免提按钮（视觉切换）
        document.getElementById('voiceCallSpeakerBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            if (btn.style.background === 'rgb(7, 193, 96)') {
                btn.style.background = '#333';
                btn.style.color = '';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
            } else {
                btn.style.background = '#07C160';
                btn.style.color = '#fff';
                btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
            }
        });

        // 来电弹窗事件
        document.getElementById('incomingCallAcceptBtn')?.addEventListener('click', acceptIncomingCall);
        document.getElementById('incomingCallRefuseBtn')?.addEventListener('click', refuseIncomingCall);
    }

    // ==================== 启动语音通话 ====================
    async function startVoiceCall(convId, role = 'caller') {
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        const char = await DB.get('characters', conv.charId);
        const convDetail = await DB.get('convDetails', convId);

        const charName = convDetail?.charName || char?.name || '对方';
        const charAvatar = convDetail?.charAvatar || char?.avatar || '';

        const avatarEl = document.getElementById('voiceCallAvatar');
        if (charAvatar) {
            avatarEl.style.backgroundImage = `url('${charAvatar}')`;
            avatarEl.style.backgroundColor = 'transparent';
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.style.backgroundColor = '#444';
            avatarEl.textContent = charName.charAt(0);
        }
        document.getElementById('voiceCallName').textContent = charName;
        document.getElementById('voiceCallStatus').textContent = role === 'caller' ? '等待对方接听...' : '邀请你语音通话...';
        document.getElementById('voiceCallStatus').style.display = 'block';
        document.getElementById('voiceCallTimer').style.display = 'none';
        document.getElementById('voiceCallInputRow').style.display = 'none';
        document.getElementById('voiceCallMsgArea').innerHTML = '';
        document.getElementById('voiceCallAnswerItem').style.display = role === 'receiver' ? 'flex' : 'none';

        voiceCallActive = true;
        voiceCallRole = role;
        voiceCallConversationId = convId;
        voiceCallMessages = [];
        voiceCallStartTime = null;
        if (voiceCallTimerInterval) clearInterval(voiceCallTimerInterval);

        document.getElementById('voiceCallOverlay').style.display = 'flex';

        if (role === 'caller') {
            setTimeout(() => {
                if (!voiceCallActive || voiceCallRole !== 'caller') return;
                connectVoiceCall();
            }, 2000);
        }
    }
    window.startVoiceCall = startVoiceCall;

    // ==================== 接通语音通话 ====================
    function connectVoiceCall() {
        if (!voiceCallActive) return;
        // 关闭来电弹窗
        document.getElementById('incomingCallCard').classList.remove('show');

        document.getElementById('voiceCallStatus').style.display = 'none';
        document.getElementById('voiceCallTimer').style.display = 'block';
        document.getElementById('voiceCallAnswerItem').style.display = 'none';
        document.getElementById('voiceCallInputRow').style.display = 'flex';
        document.getElementById('voiceCallInput').focus();

        voiceCallStartTime = Date.now();

        (async () => {
            const startRole = voiceCallRole === 'caller' ? 'user' : 'assistant';
            const conv = await DB.get('conversations', voiceCallConversationId);
            if (conv) {
                await DB.put('chats', {
                    role: startRole,
                    content: '语音通话',
                    messageType: 'voice_call_start',
                    conversationId: voiceCallConversationId,
                    charId: conv.charId,
                    timestamp: Date.now()
                });
            }
        })();

        voiceCallTimerInterval = setInterval(updateVoiceCallTimer, 1000);
        updateVoiceCallTimer();
    }

    // ==================== 更新通话计时器 ====================
    function updateVoiceCallTimer() {
        if (!voiceCallStartTime) return;
        const elapsed = Math.floor((Date.now() - voiceCallStartTime) / 1000);
        const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const secs = (elapsed % 60).toString().padStart(2, '0');
        document.getElementById('voiceCallTimer').textContent = `${mins}:${secs}`;
    }

    // ==================== 挂断语音通话 ====================
    async function hangUpVoiceCall() {
        if (!voiceCallActive) return;
        const hangingUpRole = voiceCallRole;
        voiceCallActive = false;
        if (voiceCallTimerInterval) clearInterval(voiceCallTimerInterval);

        const convId = voiceCallConversationId;
        const elapsedSec = voiceCallStartTime ? Math.floor((Date.now() - voiceCallStartTime) / 1000) : 0;
        const durationStr = formatVoiceDuration(elapsedSec);

        await generateVoiceCallLog(convId, durationStr, hangingUpRole);

        document.getElementById('voiceCallOverlay').style.display = 'none';
        document.getElementById('incomingCallCard').classList.remove('show');
        document.getElementById('voiceCallInput').value = '';
        document.getElementById('voiceCallMsgArea').innerHTML = '';
        voiceCallMessages = [];
        voiceCallConversationId = null;
    }

    // ==================== 格式化通话时长 ====================
    function formatVoiceDuration(totalSec) {
        if (totalSec < 60) return `${totalSec}秒`;
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${m}分${s}秒`;
    }

    // ==================== 生成通话记录气泡 ====================
    async function generateVoiceCallLog(convId, durationStr, hangingUpRole) {
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        const now = Date.now();
        const endRole = hangingUpRole === 'caller' ? 'user' : 'assistant';
        await DB.put('chats', {
            role: endRole,
            content: `语音通话已结束${durationStr}`,
            messageType: 'voice_call_end',
            conversationId: convId,
            charId: conv.charId,
            timestamp: now
        });
        await loadConversationMessages(convId);
    }

    // ==================== 发送通话中消息 ====================
    async function sendVoiceCallMessage() {
        if (!voiceCallActive || !voiceCallConversationId) return;
        const input = document.getElementById('voiceCallInput');
        const text = input.value.trim();
        if (!text) return;

        voiceCallMessages.push({ role: 'user', content: text });
        renderVoiceCallMessages();
        input.value = '';

        await DB.put('chats', {
            role: 'user',
            content: text,
            messageType: 'voice_call_msg',
            conversationId: voiceCallConversationId,
            charId: (await DB.get('conversations', voiceCallConversationId)).charId,
            timestamp: Date.now()
        });

        await fetchVoiceCallAIReply(voiceCallConversationId);
    }

    // ==================== 获取通话中AI回复 ====================
    async function fetchVoiceCallAIReply(convId) {
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        const char = await DB.get('characters', conv.charId);
        const mask = await DB.get('userProfiles', conv.maskId);
        if (!char) return;

        const systemPrompt = await buildVoiceCallSystemPrompt(char, mask, convId);
        const messages = [{ role: 'system', content: systemPrompt }];
        const context = voiceCallMessages.slice(-6);
        context.forEach(m => {
            messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
        });

        try {
            const reply = await callLLM(messages, { temperature: 0.95 });

            // 检查是否包含挂断指令
            const hasEndCmd = reply.includes('[voiceCall:end]');
            const cleanReply = reply.replace(/\s*\[voiceCall:end\]\s*/g, '').trim();

            if (cleanReply) {
                await DB.put('chats', {
                    role: 'assistant',
                    content: cleanReply,
                    messageType: 'voice_call_msg',
                    conversationId: convId,
                    charId: char.id,
                    timestamp: Date.now()
                });
                voiceCallMessages.push({ role: 'assistant', content: cleanReply });
                renderVoiceCallMessages();
            }

            // 如果有挂断指令，执行挂断
            if (hasEndCmd) {
                voiceCallRole = voiceCallRole === 'caller' ? 'receiver' : 'caller';
                await hangUpVoiceCall();
            }
        } catch (e) {
            showStatus(`通话回复失败: ${e.message}`, 'error');
        }
    }

    // ==================== 构建通话系统prompt ====================
    async function buildVoiceCallSystemPrompt(char, mask, convId) {
        const basePrompt = await buildSystemPrompt(char, mask, null, 'online', convId);
        // 把【回复准则】开始到末尾的所有内容，替换为语音通话专用规则
        let prompt = basePrompt.replace(
            /【回复准则】[\s\S]*$/,
            `【语音通话模式说明】
- 你正在与用户进行实时语音通话，这是一种沉浸式的实时对话体验。
- 说话方式要像真实打电话一样：用语自然随意，带语气词，句子短而连贯。
- 避免任何书面化的长篇大论，不要像在写文章或回复消息。
- 可以使用"嗯""那个""其实吧""你知道吗"等口语化表达。
- 保持角色性格和说话风格不变。
- 不要任何格式标记，不要[MSG]前缀，不要思维链，不要心声标记。
- 直接输出你要说的话，就是纯文本对话内容。
- 禁止使用动作描写符号（如*微笑*、(点头)等），因为这是语音通话，不是文字聊天。

【话题连续性规则 - 非常重要】
- 你必须密切关注对话上下文，围绕之前聊的话题继续深入。
- 每次回复都要回顾最近几轮对话的内容，确保不跑题、不跳跃。
- 如果用户在聊某个具体话题，你应继续推动话题发展：追问细节、分享相关经历、表达共鸣等。
- 只有当前话题明显自然结束时，才可以温和地过渡到新话题。
- 不要突然转移话题或重新开启一个无关的寒暄。

【主动挂断规则】
- 当对话自然结束，或你有事需要离开时（比如要去忙工作、到站了、手机没电了等），你可以主动挂断通话。
- 当用户提出需要你挂断语音通话时你需要主动挂断。
- 挂断前必须先给出自然的结束语，比如"那我先挂啦""回头再聊""到了再给你打"等，让挂断不显得突兀。
- 在结束语的最后一行，单独输出指令：[voiceCall:end]
- 挂断后，你和用户回到线上聊天界面。你的结束语应自然收尾，让对话可以平滑过渡回文字聊天。
- 示例：
  嗯好，那就这么说定了，我先去开会啦，回头聊。
  [voiceCall:end]
- 注意：指令必须单独成行，放在最后。用户看不到这条指令，这是给系统处理的。

直接输出你要说的话（包含可能的[voiceCall:end]指令），不要任何格式标记。`
        );
        return prompt;
    }

    // ==================== 渲染通话中消息 ====================
    function renderVoiceCallMessages() {
        const area = document.getElementById('voiceCallMsgArea');
        if (!area) return;
        let html = '';
        voiceCallMessages.forEach(m => {
            const cls = m.role === 'user' ? 'self' : 'other';
            html += `<div class="voice-call-msg ${cls}">${escapeHtml(m.content)}</div>`;
        });
        area.innerHTML = html;
        area.scrollTop = area.scrollHeight;
    }

    // ==================== 接收通话邀请（显示来电弹窗） ====================
    async function receiveVoiceCallInvitation(convId) {
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        const char = await DB.get('characters', conv.charId);
        const convDetail = await DB.get('convDetails', convId);

        const charName = convDetail?.charName || char?.name || '对方';
        const charAvatar = convDetail?.charAvatar || char?.avatar || '';

        const cardAvatar = document.getElementById('incomingCallAvatar');
        if (charAvatar) {
            cardAvatar.style.backgroundImage = `url('${charAvatar}')`;
            cardAvatar.style.backgroundColor = 'transparent';
            cardAvatar.textContent = '';
        } else {
            cardAvatar.style.backgroundImage = '';
            cardAvatar.style.backgroundColor = '#444';
            cardAvatar.textContent = charName.charAt(0);
        }
        document.getElementById('incomingCallName').textContent = charName;

        window._incomingCallConvId = convId;
        document.getElementById('incomingCallCard').classList.add('show');

        // 如果当前正在通话中，先挂断
        if (voiceCallActive) {
            await hangUpVoiceCall();
        }
    }
    window.receiveVoiceCallInvitation = receiveVoiceCallInvitation;

    // ==================== 接听来电 ====================
    async function acceptIncomingCall() {
        const convId = window._incomingCallConvId;
        if (!convId) return;
        document.getElementById('incomingCallCard').classList.remove('show');
        window._incomingCallConvId = null;
        await startVoiceCall(convId, 'receiver');
    }

    // ==================== 拒接来电 ====================
    async function refuseIncomingCall() {
        const convId = window._incomingCallConvId;
        document.getElementById('incomingCallCard').classList.remove('show');

        if (convId) {
            const conv = await DB.get('conversations', convId);
            if (conv) {
                await DB.put('chats', {
                    role: 'user',
                    content: '已拒绝语音通话',
                    messageType: 'voice_call_end',
                    conversationId: convId,
                    charId: conv.charId,
                    timestamp: Date.now()
                });

                await generateRejectionReaction(convId, 'voice');

                if (window.currentConversationId === convId) {
                    await loadConversationMessages(convId);
                }
            }
        }
        window._incomingCallConvId = null;
    }

    // ==================== 生成拒绝反应 ====================
    async function generateRejectionReaction(convId, type) {
        const conv = await DB.get('conversations', convId);
        if (!conv) return;
        const char = await DB.get('characters', conv.charId);
        const mask = await DB.get('userProfiles', conv.maskId);
        if (!char) return;

        const chats = await DB.queryByIndex('chats', 'conversationId', convId);
        const contextChats = chats.filter(c => c.messageType !== 'innerVoice');
        contextChats.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const recent = contextChats.slice(-8);

        const systemPrompt = await buildSystemPrompt(char, mask, null, 'online', convId);
        const messages = [{ role: 'system', content: systemPrompt }];
        recent.forEach(m => {
            messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content });
        });

        const typeHint = type === 'voice'
            ? '对方刚才拒绝了你的语音通话请求。请根据上下文，自然地对这个拒绝做出反应。比如问一句"怎么不接电话？"或者表达一点小情绪，但要贴合你的人设和你们的关系。直接输出你要说的话，正常使用[MSG]格式。'
            : '对方刚才拒绝了你的线下见面邀约。请根据上下文，自然地对这个拒绝做出反应。比如问一句"为什么不想见我？"或者表示理解，但要贴合你的人设和你们的关系。直接输出你要说的话，正常使用[MSG]格式。';

        messages.push({ role: 'user', content: typeHint });

        try {
            const reply = await callLLM(messages);
            // 使用全局 parseAIResponse（需要在 index 中已定义）
            const parsedMessages = typeof parseAIResponse === 'function' ? parseAIResponse(reply) : [{ type: 'text', content: reply }];
            if (parsedMessages.length === 0) {
                await DB.put('chats', {
                    role: 'assistant', content: reply, messageType: 'text',
                    conversationId: convId, charId: char.id, timestamp: Date.now()
                });
            } else {
                let baseTime = Date.now();
                for (let i = 0; i < parsedMessages.length; i++) {
                    const msg = parsedMessages[i];
                    await DB.put('chats', {
                        role: 'assistant', content: msg.content, messageType: msg.type,
                        conversationId: convId, charId: char.id, timestamp: baseTime + i
                    });
                }
            }
            await DB.put('conversations', { ...conv, updatedAt: Date.now() });
        } catch (e) {
            console.error('生成拒绝反应失败:', e);
        }
    }
    window.generateRejectionReaction = generateRejectionReaction;

    // ==================== 折叠通话记录气泡 ====================
    function foldCallMessages(startRow, endRow) {
        let current = startRow.nextElementSibling;
        const toHide = [];
        while (current && current !== endRow) {
            toHide.push(current);
            current = current.nextElementSibling;
        }
        if (toHide.length === 0) return;
        toHide.forEach(el => {
            el.style.display = 'none';
            el.classList.add('call-folded-msg');
        });
        const bubble = startRow.querySelector('.bubble');
        if (bubble) {
            const toggleBtn = document.createElement('span');
            toggleBtn.className = 'call-toggle-btn';
            toggleBtn.innerHTML = ' ▶ 展开';
            toggleBtn.style.cssText = 'cursor:pointer;font-size:12px;color:#d7e4ee;margin-left:8px;';
            toggleBtn.onclick = function(e) {
                e.stopPropagation();
                const isHidden = toHide[0].style.display === 'none';
                toHide.forEach(el => { el.style.display = isHidden ? '' : 'none'; });
                toggleBtn.innerHTML = isHidden ? ' ▼' : ' ▶';
            };
            bubble.appendChild(toggleBtn);
        }
    }
    window.foldCallMessages = foldCallMessages;

    console.log('📞 语音通话模块脚本已就绪，等待 initVoiceCallModule() 调用');
})();


// ============================================
// 对话详情页增强模块
// 功能：
// 1. 在 1v1 对话详情页加入时间感知开关
// 2. 将详情页部分 emoji UI 替换为 SVG 图标
// 说明：直接合并在 voice-call.js 中
// ============================================
(function() {
    "use strict";

    const CD_ICONS = {
        save: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',

        trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',

        brain: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></svg>',

        sparkle: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 14.39 8.26 21 9.27 16 13.97 17.18 20.5 12 17.27 6.82 20.5 8 13.97 3 9.27 9.61 8.26 12 2"/></svg>',

        heart: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',

        leaf: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.81C20.71 13.42 19.2 18.13 11 20z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg>',

        user: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',

        clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',

        userCircle: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>'
    };

    function iconWrap(svgStr, marginRight = 6) {
        return `<span class="cd-icon" style="margin-right:${marginRight}px;color:currentColor;vertical-align:middle;">${svgStr}</span>`;
    }

    function getDB() {
        return window.DB;
    }

    function getShowStatus() {
        return window.showStatus || function(msg) { console.log(msg); };
    }

    function findLabelByText(scope, text) {
        const labels = scope.querySelectorAll('label');
        for (const label of labels) {
            if ((label.textContent || '').trim().includes(text)) return label;
        }
        return null;
    }

    function injectTimePerceptionSection(page) {
        if (!page || page.querySelector('.cd-tp-section')) return;

        const relationshipInput = page.querySelector('#convDetailRelationship');
        const relationshipSection = relationshipInput ? relationshipInput.closest('.worldbook-section') : null;
        if (!relationshipSection) return;

        const section = document.createElement('div');
        section.className = 'worldbook-section cd-tp-section';
        section.innerHTML = `
            <div class="cd-tp-row">
                <div class="cd-tp-info">
                    <div class="cd-tp-title">
                        ${iconWrap(CD_ICONS.clock, 8)}
                        <span>时间感知</span>
                    </div>
                    <div class="cd-tp-desc">
                        开启后，会把当前时间和星期注入给角色。关闭后，角色不会知道现在几点或今天周几。
                    </div>
                </div>
                <div class="cd-switch on" id="cdTimePerceptionSwitch" role="switch" aria-checked="true"></div>
            </div>
        `;

        relationshipSection.parentNode.insertBefore(section, relationshipSection.nextSibling);

        const sw = section.querySelector('#cdTimePerceptionSwitch');
        sw.addEventListener('click', async () => {
            const DB = getDB();
            const showStatus = getShowStatus();
            const convId = window.currentEditingConvId;

            if (!DB || !convId) return;

            const enabled = !sw.classList.contains('on');
            sw.classList.toggle('on', enabled);
            sw.setAttribute('aria-checked', String(enabled));

            try {
                const oldDetail = await DB.get('convDetails', convId);
                const conv = await DB.get('conversations', convId);

                const detail = {
                    ...(oldDetail || {}),
                    conversationId: convId,
                    charId: oldDetail?.charId || conv?.charId,
                    timePerception: enabled
                };

                await DB.put('convDetails', detail);
                showStatus(enabled ? '已开启时间感知' : '已关闭时间感知', 'success');
            } catch (e) {
                console.error('保存时间感知开关失败:', e);
                showStatus('保存失败：' + e.message, 'error');
            }
        });
    }

    async function syncTimePerceptionState() {
        const DB = getDB();
        const convId = window.currentEditingConvId;
        const sw = document.getElementById('cdTimePerceptionSwitch');

        if (!DB || !convId || !sw) return;

        try {
            const detail = await DB.get('convDetails', convId);
            const enabled = !detail || detail.timePerception !== false;

            sw.classList.toggle('on', enabled);
            sw.setAttribute('aria-checked', String(enabled));
        } catch (e) {
            console.warn('同步时间感知状态失败:', e);
        }
    }

    function patchStaticUI(page) {
        if (!page || page.dataset.cdEnhanced === '1') return;
        page.dataset.cdEnhanced = '1';

        const saveBtn = document.getElementById('saveConvDetailBtn');
        if (saveBtn) {
            saveBtn.innerHTML = iconWrap(CD_ICONS.save, 4) + '保存';
        }

        const deleteBtn = document.getElementById('deleteConvBtn');
        if (deleteBtn) {
            deleteBtn.innerHTML = CD_ICONS.trash;
            deleteBtn.title = '删除对话';
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.style.alignItems = 'center';
            deleteBtn.style.justifyContent = 'center';
        }

        const aiBtn = document.getElementById('aiUpdateSelfModelBtn');
        if (aiBtn) {
            const h3 = aiBtn.parentElement;
            if (h3 && h3.tagName === 'H3') {
                aiBtn.innerHTML = iconWrap(CD_ICONS.sparkle, 4) + 'AI更新';
                aiBtn.style.fontSize = '11px';

                h3.innerHTML = iconWrap(CD_ICONS.brain, 6) + '<span>角色自我认知</span>';
                h3.style.marginBottom = '12px';
                h3.style.display = 'flex';
                h3.style.alignItems = 'center';

                h3.appendChild(aiBtn);
            }
        }

        const relationshipLabel = findLabelByText(page, '关系理解');
        if (relationshipLabel) {
            relationshipLabel.innerHTML = iconWrap(CD_ICONS.heart, 6) + '关系理解（角色怎么看待你们的关系）';
        }

        const growthLabel = findLabelByText(page, '自我成长');
        if (growthLabel) {
            growthLabel.innerHTML = iconWrap(CD_ICONS.leaf, 6) + '自我成长（角色自身的变化）';
        }

        const traitsLabel = findLabelByText(page, '用户画像');
        if (traitsLabel) {
            traitsLabel.innerHTML = iconWrap(CD_ICONS.user, 6) + '用户画像（角色观察到的用户特征）';
        }

        injectTimePerceptionSection(page);
    }

    function patchDynamicAvatars(page) {
        if (!page) return;

        page.querySelectorAll('.avatar-preview').forEach(el => {
            const text = (el.textContent || '').trim();
            if (text === '👤') {
                el.innerHTML = CD_ICONS.userCircle;
            }
        });
    }

    function onConvDetailActive() {
        const page = document.getElementById('page-conv-detail');
        if (!page) return;

        patchStaticUI(page);
        patchDynamicAvatars(page);
        syncTimePerceptionState();

        setTimeout(() => {
            patchDynamicAvatars(page);
            syncTimePerceptionState();
        }, 80);
    }

    function bootstrapConvDetailEnhance() {
        const page = document.getElementById('page-conv-detail');
        if (!page) return;

        if (page.classList.contains('active')) {
            onConvDetailActive();
        }

        const observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                if (
                    m.type === 'attributes' &&
                    m.attributeName === 'class' &&
                    page.classList.contains('active')
                ) {
                    onConvDetailActive();
                }
            }
        });

        observer.observe(page, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapConvDetailEnhance);
    } else {
        bootstrapConvDetailEnhance();
    }

    console.log('📞 对话详情页增强已并入 voice-call.js');
})();