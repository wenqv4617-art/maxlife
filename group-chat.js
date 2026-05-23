/* ================================================================
 * group-chat.js - 群聊系统完整逻辑
 * 依赖：window.DB, window.escapeHtml, window.getAvatarColor,
 *       window.showStatus, window.callLLM, window.recordApiPending,
 *       window.recordApiSuccess, window.recordApiError,
 *       window.compressImage, window.switchPage,
 *       window.loadConversationMessages
 * ================================================================ */

(function initGroupChat() {
    "use strict";
    console.log('👥 群聊模块初始化');

    // ========== 群聊全局变量 ==========
    window.currentGroupId = null;
    window.currentGroupMode = 'online';
    let curEmoGroupId = null;
    let emoticonPickerOpen = false;
    let groupEmoticonPickerOpen = false;
    let quotedMessage = null;
    let rpMode = 'multi';

    // ========== 数据库：确保 groupChats/groupMessages/groupNPCs/groupMemories 存在 ==========
    async function ensureGroupStores() {
        const DB_NAME = "CompanionDB_V18";
        // 获取 index.html 中当前数据库实例来确定实际版本
        const d = await new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME);
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e.target.error);
        });
        
        const requiredStores = ['groupChats', 'groupMessages', 'groupNPCs', 'groupMemories'];
        const missingStores = requiredStores.filter(s => !d.objectStoreNames.contains(s));
        
        if (missingStores.length > 0) {
            const currentVersion = d.version;
            d.close();
            const newVersion = currentVersion + 1;
            
            await new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, newVersion);
                req.onupgradeneeded = e => {
                    const db = e.target.result;
                    missingStores.forEach(s => {
                        if (!db.objectStoreNames.contains(s)) {
                            const st = db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
                            if (s === 'groupMessages') st.createIndex('groupId', 'groupId');
                            if (s === 'groupNPCs') st.createIndex('groupId', 'groupId');
                            if (s === 'groupMemories') st.createIndex('groupId', 'groupId');
                        }
                    });
                };
                req.onsuccess = e => {
                    e.target.result.close();
                    resolve();
                };
                req.onerror = e => reject(e.target.error);
            });
            // 升级后需要重新打开数据库，index.html的openDB会自动处理
            console.log(`✅ 群聊stores已创建，数据库升级到版本 ${newVersion}`);
        } else {
            d.close();
            console.log('✅ 群聊stores已存在，无需升级');
        }
    }
    // ========== 群聊 System Prompt - 线上模式 ==========
    async function buildGroupOnlinePrompt(g) {
        const id = g.id;
        const mask = await window.getActiveMask();
        const userName = mask?.name || '用户';
        const ms = (await window.DB.queryByIndex('groupMessages', 'groupId', id))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        let membersInfo = [];
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (!ch) continue;
            const md = g.members?.find(m => m.id === mid);
            let info = {
                name: ch.name,
                detail: ch.detail || '',
                isOwner: mid === g.ownerId,
                isAdmin: g.adminIds?.includes(mid) && mid !== g.ownerId,
                title: md?.title || '',
                syncMemory: md?.syncMemory || false
            };
            if (md?.syncMemory) {
                const convs = await window.DB.queryByIndex('conversations', 'charId', mid);
                if (convs.length > 0) {
                    const convId = convs[0].id;
                    const memories = await window.DB.queryByIndex('memories', 'charId', mid);
                    const convMemories = memories.filter(m => m.conversationId === convId);
                    const summaries = convMemories.filter(m => m.type === 'summary')
                        .sort((a,b) => b.segmentStart - a.segmentStart).slice(0, 3);
                    const coreMemories = convMemories.filter(m => m.type === 'core_memory')
                        .sort((a,b) => b.createdAt - a.createdAt).slice(0, 5);
                    if (summaries.length > 0) info.recentSummaries = summaries.map(s => s.content);
                    if (coreMemories.length > 0) info.coreMemories = coreMemories.map(m => m.content);
                }
            }
            membersInfo.push(info);
        }
        const npcs = await window.DB.queryByIndex('groupNPCs', 'groupId', id);
        npcs.forEach(n => membersInfo.push({
            name: n.name, detail: n.detail || '',
            isOwner: false, isAdmin: false, title: '', isNPC: true
        }));

        let worldbookSection = '';
let wbGroupExtra = '';
if (g.worldbookIds?.length > 0) {
    const allWorldbooks = await window.DB.getAll('worldbooks');
    if (window.wbE) {
        // 获取最近消息用于关键词匹配
        let recentForKw = ms.slice(-10).map(m => ({
            role: m.senderId === 'user' ? 'user' : 'assistant',
            content: m.content || ''
        }));
        const resolved = window.wbE.resolve({
    charId: null,
    scene: 'chat',
    recentChats: recentForKw,
    worldbookIds: g.worldbookIds || [],
    worldbookMountOverrides: g.worldbookMountOverrides || {},
    allWorldbooks: allWorldbooks
});
        if (resolved.before) worldbookSection = '\n' + resolved.before + '\n';
        if (resolved.middle) wbGroupExtra += '\n' + resolved.middle + '\n';
        if (resolved.after) wbGroupExtra += '\n' + resolved.after + '\n';
        if (resolved.hasHtml) {
            wbGroupExtra += '\n[HTML 卡片格式] 在群聊中输出 HTML 卡片时，使用：[角色名]:[MSG]html_card:<你的 html>。使用卡片工具类。不要使用 script 标签。\n';
        }
    } else {
        const mounted = allWorldbooks.filter(wb => g.worldbookIds.includes(wb.id));
        if (mounted.length > 0) {
            worldbookSection = '\n';
            mounted.forEach(wb => { worldbookSection += `--- ${wb.title} ---\n${wb.content}\n\n`; });
        }
    }
}

        let charsSection = '【出场角色信息 · 严格按以下人设发言】\n';
        membersInfo.forEach((m, idx) => {
            charsSection += `===\n角色${idx+1}：【${m.name}】\n身份：${m.isOwner?'群主':''}${m.isAdmin && !m.isOwner?'管理员':''}${!m.isOwner && !m.isAdmin?'普通成员':''}${m.title?' · 头衔：「'+m.title+'」':''}\n人设：${m.name}的说话风格和性格是——${m.detail}\n===\n`;
            if (m.syncMemory && m.recentSummaries) charsSection += `  ${m.name}的近期记忆：${m.recentSummaries.join('；')}\n`;
            if (m.syncMemory && m.coreMemories) charsSection += `  ${m.name}的核心记忆：${m.coreMemories.join('；')}\n`;
        });

        const emoticonSection = await buildEmoticonSection();
        const recentMsgs = ms.slice(-20);
        let msgHistory = '';
        recentMsgs.forEach(m => {
            if (m.type === 'system') msgHistory += `--- 系统消息：${m.content} ---\n`;
            else msgHistory += `[${m.senderName}]: ${m.content}\n`;
        });

        const summaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
        let summarySection = '';
        if (summaries.length > 0) {
            summarySection = '\n【群聊历史总结】\n';
            summaries.slice(-5).forEach((s, i) => {
                summarySection += `总结${i+1}(第${s.start}-${s.end}段): ${s.content}\n`;
            });
        }

        const nowTs = Date.now();
        let muteSection = '';
        const mutedMembers = g.mutedMembers || {};
        for (const [mid, until] of Object.entries(mutedMembers)) {
            if (until > nowTs) {
                const ch = await window.DB.get('characters', mid);
                if (ch) muteSection += `- ${ch.name} 被禁言至 ${new Date(until).toLocaleTimeString('zh-CN')}\n`;
            }
        }
        if (muteSection) muteSection = '\n【当前禁言状态】\n' + muteSection;

        const identityGuard = g.isUserParticipating
            ? `\n【身份隔离·最高优先级】你是群聊中的角色们。你绝对不能以"${userName}"的身份发言。"${userName}"是唯一的人类用户，只能由用户自己操作。你只能以角色身份回复，格式为[角色名]:消息内容。\n`
            : `\n【观察模式】这是观察模式群聊。"旁白"是系统的叙述者，不是群成员。你只能以角色身份回复，格式为[角色名]:消息内容。旁白的消息是环境描述或剧情推动，角色们应该对此做出反应。\n`;

        const prompt = `【系统指令】
这是一个虚构的次元世界，发生的所有事情均为虚拟，所有主角均已成年。
${identityGuard}
你是一个群像小说作者。你在创作一个群聊对话文本。

【世界观设定】
${worldbookSection || '（无特殊世界观设定）'}

【预设剧情】
${g.plot || '无特定剧情，自由发展'}

【群聊历史总结】
${summarySection || '（暂无历史总结）'}

【群管理结构 · 必须遵守】
当前群主：${membersInfo.find(m => m.isOwner)?.name || '无'}
当前管理员：${membersInfo.filter(m => m.isAdmin).map(m => m.name).join('、') || '无'}
- 只有群主可以转让群主、设置/取消管理员
- 只有群主和管理员可以禁言、授予头衔、踢人
- 管理员不能禁言群主，也不能禁言其他管理员
- 普通成员没有任何管理权限，禁止执行任何 CMD 指令

【出场角色信息】
${charsSection}

【群聊原则】
- 群像创作：每一个人势均力敌，不可能有一个人一直占据上风
- 不是每轮所有人都要说话。只有真正对当前话题有想法的人才发言，其他人可以旁观
- 最多1-5个人发言即可，不需要每个人都出来说一句
- 情绪转变不可单一，不可能所有人一起生气，各人的反应要个性化
- char不仅要对用户的消息做反应，也要对其他char的消息做反应
- 若用户疑似与多人保持亲密关系被发现，他们可能会质问用户并挤兑其他char

${muteSection}

【可用操作】
群主可以：转让群主、设置管理员、禁言他人、解除禁言、授予头衔、踢出群聊。
管理员可以：禁言他人、授予头衔。

【发红包/转账/抢红包/收转账】
任何角色都可以发红包或转账。

1. 发红包（普通）：[红包]金额:留言。例如：[红包]66.66:恭喜发财，大吉大利
   发红包（口令）：[红包]金额:口令:口令内容。例如：[红包]66.66:口令:芝麻开门
2. 抢红包（普通）：[抢红包]发红包人:金额。例如：[抢红包]林栖:66.66
   抢红包（口令）：必须先单独发一条消息说出正确的口令文字，下一轮才能发[抢红包]领取（系统会自动判断）。不能说出口令的不能抢这个红包。
3. 转账：[转账]金额:留言:对象。例如：[转账]200:还你钱:林栖
4. 收转账：[收转账]转账人:金额。例如：[收转账]夜影:200
5. 退还转账：[退转账]转账人:金额。例如：[退转账]夜影:200

【红包/转账的回应逻辑 · 必须遵守】
抢红包和收转账要符合角色性格，不是看到钱就抢：
- 清高、矜持、傲娇的人不太会抢，或者抢了也不说感谢
- 活跃、开朗、爱凑热闹的人大概率会抢并回应
- 如果发红包是为了撒钱炫耀，可能会被嘲讽
- 如果发红包是表达歉意或感谢，亲近的人会更愿意领
- 转账是否接收取决于两人关系和金额大小：关系好的收得爽快，关系差的可能退回去
- 用户发的红包/转账，角色也要根据上述逻辑回应

【口令红包规则】
- 如果有人发了口令红包，角色必须先单独发送一条消息说出正确口令（如"芝麻开门"），下一轮才能用[抢红包]领取
- 如果角色不知道口令或不想说，就不要抢这个红包
- 口令必须完全匹配才能领取

${emoticonSection}

【可用指令格式 · 权限绑定身份】
指令必须独占一行。只能由拥有对应权限的角色执行。
格式：[CMD]:执行人:动作:被执行人:参数

可用动作及权限：
- transfer_owner：转让群主（仅群主可用）。格式：[CMD]:林栖:transfer_owner:夜影
- set_admin：设置管理员（仅群主）。格式：[CMD]:林栖:set_admin:夜影
- remove_admin：取消管理员（仅群主）。格式：[CMD]:林栖:remove_admin:夜影
- mute：禁言（群主和管理员）。格式：[CMD]:林栖:mute:夜影:30（分钟）
- unmute：解除禁言（群主和管理员）。格式：[CMD]:林栖:unmute:夜影
- set_title：授予头衔（群主和管理员）。格式：[CMD]:林栖:set_title:夜影:金牌搭档（15字内）
- kick：踢出群聊（群主和管理员）。格式：[CMD]:林栖:kick:夜影

指令规则：
- 指令要自然融入对话，在合适的时机使用，不要频繁操作
- 指令必须单独一行，不要和其他消息混在一起
- 只有拥有对应权限的角色才能执行操作

【普通消息格式 · 严格】
每条消息独占一行。MSG 必须带类型标签：
正确：
[林栖]:这个好好吃！
[林栖]:[MSG]表情包:开心
错误（缺少"表情包"标签）：
[林栖]:[MSG]开心:拍桌大笑

MSG格式必须完整：[MSG]表情包:文字说明（不能省略"表情包"三个字）
文字和MSG必须分两行，不能混在同一行。
- [角色名]:消息内容
- [角色名]:[MSG]表情包:文字说明
- [角色名]:[MSG]图片:图片描述
- [角色名]:[MSG]语音:语音内容

【消息风格 · 重要】
- 回复要短，像发微信一样，每条消息1-2句话即可
- 一个角色可以连续发2-3条短消息，而不是一条长消息
- 偶尔可以发语音或图片（格式：[角色名]:[MSG]语音:内容 或 [角色名]:[MSG]图片:描述），但不能连续发同类消息
- 如果某角色不知道该说什么，可以不出场（不发消息），不要没话找话
- 禁止写长段落，禁止写小作文
- 禁止使用括号动作描写，如(笑)、(叹气)等

【发言自然度】
- 性格决定说话方式，但不要机械地每句话都带固定口癖
- 不要每轮都"哈哈哈"、"嘿嘿嘿"，情绪表达要自然有变化
- 如果不知道该说什么，选择沉默而不是硬凑

【身份隔离 · 最高优先级】
- 每个角色只能以自己的【人设】说话，禁止借用其他角色的性格
- 例：如果林栖的人设是温和内敛，夜影就不能说林栖的口头禅
- 每个角色是独立的个体，拒绝"角色串味"
- 输出时必须严格遵守 [角色名]:消息内容 的格式【当前群聊记录】

${msgHistory}
${wbGroupExtra}
请根据以上信息，生成群聊回复。`;
        return { prompt, membersInfo, mutedMembers: g.mutedMembers || {}, userName };
    }

    // ========== 群聊 System Prompt - 线下模式 ==========
    async function buildGroupOfflinePrompt(g) {
        const id = g.id;
        const mask = await window.getActiveMask();
        const ms = (await window.DB.queryByIndex('groupMessages', 'groupId', id))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        let membersInfo = [];
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (!ch) continue;
            const md = g.members?.find(m => m.id === mid);
            let info = {
                name: ch.name, detail: ch.detail || '',
                isOwner: mid === g.ownerId,
                isAdmin: g.adminIds?.includes(mid) && mid !== g.ownerId,
                title: md?.title || '', syncMemory: md?.syncMemory || false
            };
            if (md?.syncMemory) {
                const convs = await window.DB.queryByIndex('conversations', 'charId', mid);
                if (convs.length > 0) {
                    const convId = convs[0].id;
                    const memories = await window.DB.queryByIndex('memories', 'charId', mid);
                    const convMemories = memories.filter(m => m.conversationId === convId);
                    const summaries = convMemories.filter(m => m.type === 'summary')
                        .sort((a,b) => b.segmentStart - a.segmentStart).slice(0, 3);
                    const coreMemories = convMemories.filter(m => m.type === 'core_memory')
                        .sort((a,b) => b.createdAt - a.createdAt).slice(0, 5);
                    if (summaries.length > 0) info.recentSummaries = summaries.map(s => s.content);
                    if (coreMemories.length > 0) info.coreMemories = coreMemories.map(m => m.content);
                }
            }
            membersInfo.push(info);
        }
        const npcs = await window.DB.queryByIndex('groupNPCs', 'groupId', id);
        npcs.forEach(n => membersInfo.push({
            name: n.name, detail: n.detail || '',
            isOwner: false, isAdmin: false, title: '', isNPC: true
        }));

        let worldbookSection = '';
if ((g.worldbookIds && g.worldbookIds.length > 0) || g.worldbookMountOverrides) {
    const allWorldbooks = await window.DB.getAll('worldbooks');

    if (window.wbE) {
        let recentForKw = ms.slice(-10).map(m => ({
            role: m.senderId === 'user' ? 'user' : 'assistant',
            content: m.content || ''
        }));

        const resolved = window.wbE.resolve({
            charId: null,
            scene: 'chat',
            recentChats: recentForKw,
            worldbookIds: g.worldbookIds || [],
            worldbookMountOverrides: g.worldbookMountOverrides || {},
            allWorldbooks: allWorldbooks,
            skipHtml: true
        });

        if (resolved.before || resolved.middle || resolved.after) {
            worldbookSection = '【世界观设定】\n';
            if (resolved.before) worldbookSection += resolved.before + '\n\n';
            if (resolved.middle) worldbookSection += resolved.middle + '\n\n';
            if (resolved.after) worldbookSection += resolved.after + '\n\n';
        }
    } else {
        const mounted = allWorldbooks.filter(wb => (g.worldbookIds || []).includes(wb.id));
        if (mounted.length > 0) {
            worldbookSection = '【世界观设定】\n';
            mounted.forEach(wb => {
                worldbookSection += `--- ${wb.title} ---\n${wb.content}\n\n`;
            });
        }
    }
}

        let charsSection = '';
        membersInfo.forEach(m => {
            charsSection += `- ${m.name}${m.isOwner?'（群主）':''}${m.isAdmin?'（管理员）':''}，人设：${m.detail}\n`;
            if (m.syncMemory && m.recentSummaries) charsSection += `  近期记忆：${m.recentSummaries.join('；')}\n`;
            if (m.syncMemory && m.coreMemories) charsSection += `  核心记忆：${m.coreMemories.join('；')}\n`;
        });

        const summaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
        let summarySection = '';
        if (summaries.length > 0) {
            summarySection = '【群聊历史总结】\n';
            summaries.slice(-5).forEach((s, i) => { summarySection += `${s.content}\n`; });
        }

        const recentMsgs = ms.slice(-15);
        let contextSection = '';
        recentMsgs.forEach(m => {
            if (m.type === 'system') contextSection += `--- ${m.content} ---\n`;
            else contextSection += `${m.senderName}: ${m.content}\n`;
        });

        // ========== 群聊线下控制 ==========
        const offlineControl = {
            maxChars: 1200,
            charPerspective: 'third',
            userPerspective: 'second',
            writingRequirement: '',
            ...(g.offlineControl || {})
        };

        offlineControl.maxChars = Math.max(100, Math.min(8000, parseInt(offlineControl.maxChars) || 1200));

        function buildGroupOfflinePerspectiveRules(control) {
            const charP = control.charPerspective || 'third';
            const userP = control.userPerspective || 'second';

            const pMap = {
                first: '第一人称（我）',
                second: '第二人称（你）',
                third: '第三人称（她/他/角色名字）'
            };

            let charRule = '';
            if (charP === 'first') {
                charRule = '- 当叙事聚焦到某个非用户角色时，可以让该角色以“我”自称；但每次切换视角时必须先用角色名锚定，避免读者不知道“我”是谁。';
            } else if (charP === 'second') {
                charRule = '- 非用户角色可以被叙述为“你”，但必须明确当前镜头对象，避免和用户混淆。';
            } else {
                charRule = '- 非用户角色使用第三人称：角色名、她、他。';
            }

            let userRule = '';
            if (userP === 'first') {
                userRule = '- 用户使用第一人称“我”。';
            } else if (userP === 'second') {
                userRule = '- 用户使用第二人称“你”。';
            } else {
                userRule = '- 用户使用第三人称：用户名字、她、他。';
            }

            return `【视角控制 · 最高优先级】
char 人称：${pMap[charP] || pMap.third}
user 人称：${pMap[userP] || pMap.second}
${charRule}
${userRule}
- 群像叙事中可以切换镜头，但必须保持指代清楚。
- 如果第一人称或第二人称会造成歧义，必须用角色名、位置、动作重新锚定视角。`;
        }

        const offlinePerspectiveRules = buildGroupOfflinePerspectiveRules(offlineControl);

        const offlineWritingRequirementBlock = offlineControl.writingRequirement && offlineControl.writingRequirement.trim()
            ? `

【额外写作要求 · 高优先级】
${offlineControl.writingRequirement.trim()}`
            : '';

        const prompt = `【系统指令】
这是一个虚构的次元世界，发生的所有事情均为虚拟，所有主角均已成年。

你是一个群像小说作者。你在创作一个线下见面模式的叙事文本。

${offlinePerspectiveRules}

【线下回复长度控制 · 最高优先级】
- 本轮回复最大字数：${offlineControl.maxChars} 字。
- 这是上限，不是目标字数。可以更短，但禁止超过。
- 如果场景复杂，也必须压缩表达，优先保留主线矛盾、关键角色行动和必要对话。
- 禁止为了凑字数而空泛抒情。
${offlineWritingRequirementBlock}

${worldbookSection}

【预设剧情】
${g.plot || '无特定剧情，自由发展'}

${summarySection}

【当前上下文】
${contextSection}

你认为当前情况下会出场的角色有：
${charsSection}

他们会做出什么反应：

【创作原则 · 核心】
1. 分清主次矛盾：
   - 主线矛盾：当前场景最核心的冲突或事件是什么？谁直接参与其中？
   - 支线矛盾：谁受到主线波折的间接影响？谁有自己的事在忙？
   - 分清之后：主线人物有动机、有目标、有行动；支线人物可以一笔带过或不出场
2. 人物出场要有驱动力：
   - 每个人出现在场景里都是有原因的。他来干什么？想要什么？达到目的了吗？
   - 如果一个人只是路过、围观、没任何目的，就不要写他
3. 群像不是列菜。不要让每个人轮流说一句话然后消失。该谁说话谁说话，该谁沉默谁沉默
4. 自然生活原则：不在主线矛盾中心的人，他该干嘛干嘛去。不用每人都给镜头
5. 角色塑造最高原则：每个人都有自己独立的生活、事业、目标，不是围着某个人转的卫星
6. 场景调度：本轮出场不超过3人。与当前矛盾无关的人，哪怕读者知道他在附近，也不需要写。

【文风要求 · 重要】
- 短句为主，节奏要快。但偶尔可以突然插入一两句长的心理分析，制造落差感
- 用口语化叙述，像有人在跟朋友讲故事。可以带语气词：啊、吧、呢、嘛、他娘的（角色说脏话时）
- 视角自由切换，这一句写A的动作，下一句可以写B看到A时的心理活动，再下一句写旁观者的反应
- 细节丰富但不啰嗦。关键动作要写到位，无关紧要的直接跳过
- 幽默感可以穿插在严肃场景里。人物有反差感才真实——高冷的人也会心软，严肃的场合也会有人出洋相
- 叙事中间可以突然插入叙述者的一句评价，也可以突然补一段往事。想到什么说什么，不用刻意分段
- 句子不用打磨，长短由你。逗号句号随便断，偶尔一两句不带标点的也没事
- 感觉要对。就是那种窝在沙发里，有一搭没一搭地往下说的调子。不急

【绝对禁止】
- 禁止用对话体！禁止输出"[角色名]:消息"格式
- 禁止写用户的内心活动、心理感受、情绪判断（用户是读者视角，不是镜头里的角色）
- 禁止写"你感到……""你以为……""你知道……""你想起……""你意识到……"
- 直接以叙事文本输出。描述谁做了什么、说了什么、发生了什么。像写小说一样`;

        return { prompt };
    }

    // ========== 消息段分段 ==========
    function groupMessagesIntoSegments(messages) {
        if (!messages.length) return [];
        const segments = [];
        let currentSegment = { senderId: messages[0].senderId, messages: [messages[0]], startIndex: 0 };
        for (let i = 1; i < messages.length; i++) {
            const msg = messages[i];
            const prevIsUser = currentSegment.senderId === 'user';
            const currIsUser = msg.senderId === 'user';
            if (prevIsUser !== currIsUser) {
                segments.push(currentSegment);
                currentSegment = { senderId: msg.senderId, messages: [msg], startIndex: i };
            } else {
                currentSegment.messages.push(msg);
            }
        }
        segments.push(currentSegment);
        segments.forEach((seg, idx) => { seg.segmentNumber = idx + 1; });
        return segments;
    }

    // ========== 解析发送者信息 ==========
    async function resolveSenderInfo(g, name) {
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (ch && ch.name === name) {
                const md = g.members?.find(m => String(m.id) === String(mid));
                return {
                    id: mid, name: ch.name,
                    avatar: md?.avatar || ch.avatar || '',
                    isOwner: String(mid) === String(g.ownerId),
                    isAdmin: g.adminIds?.some(x => String(x) === String(mid)),
                    title: md?.title || ''
                };
            }
        }
        const npcs = await window.DB.queryByIndex('groupNPCs', 'groupId', g.id);
        const npc = npcs.find(n => n.name === name);
        if (npc) {
            const md = g.members?.find(m => String(m.id) === String(npc.id));
            return {
                id: npc.id, name: npc.name, avatar: npc.avatar || '',
                isOwner: String(npc.id) === String(g.ownerId),
                isAdmin: g.adminIds?.some(x => String(x) === String(npc.id)),
                title: md?.title || '', isNPC: true
            };
        }
        return null;
    }

    // ========== 加载群聊消息 ==========
    async function loadGroupMessages(id) {
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const mode = g.mode || 'online';
        let ms = (await window.DB.queryByIndex('groupMessages', 'groupId', id))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (mode === 'offline') {
            ms = ms.filter(m => m.type === 'offline' || m.messageType === 'offline_card' || m.type === 'system');
        } else {
            ms = ms.filter(m => m.type !== 'offline' && m.messageType !== 'offline_card');
        }
        const ct = document.getElementById('groupChatMessages');
        if (g.bgImage) {
            ct.style.backgroundImage = `url('${g.bgImage}')`;
            ct.style.backgroundSize = 'cover';
            ct.style.backgroundPosition = 'center';
        } else {
            ct.style.backgroundImage = '';
        }
        const mask = await window.getActiveMask();
        if (!ms.length) { ct.innerHTML = '<div class="empty-state">群聊开始~</div>'; return; }

        if (mode === 'offline') {
            let h = '';
            ms.forEach((m, i) => {
                if (m.type === 'system') { h += `<div class="group-system-msg">${window.escapeHtml(m.content)}</div>`; }
                else if (m.senderId === 'user') {
                    h += `<div style="position:relative;" data-offline-msg-id="${m.id||''}">
                        <div class="bubble-toolbar offline-toolbar" data-toolbar-for="${i}">
                            <button class="toolbar-btn reback-btn" data-idx="${i}">↩️ 重回</button>
                            <button class="toolbar-btn danger delete-msg-btn" data-idx="${i}">🗑️ 删除</button>
                            <button class="toolbar-btn multi-select-btn" data-idx="${i}">☑️ 多选</button>
                            <button class="toolbar-btn edit-msg-btn" data-idx="${i}">✏️ 编辑</button>
                        </div>
                        <div class="group-offline-card-user">${window.escapeHtml(m.content)}</div>
                        <div class="bubble-dot" data-idx="${i}" style="position:absolute;left:8px;bottom:6px;"></div>
                    </div>`;
                } else {
                    h += `<div style="position:relative;" data-offline-msg-id="${m.id||''}">
                        <div class="bubble-toolbar offline-toolbar" data-toolbar-for="${i}">
                            <button class="toolbar-btn reback-btn" data-idx="${i}">↩️ 重回</button>
                            <button class="toolbar-btn danger delete-msg-btn" data-idx="${i}">🗑️ 删除</button>
                            <button class="toolbar-btn multi-select-btn" data-idx="${i}">☑️ 多选</button>
                            <button class="toolbar-btn edit-msg-btn" data-idx="${i}">✏️ 编辑</button>
                        </div>
                        <div class="group-offline-card-ai">${window.escapeHtml(m.content)}</div>
                        <div class="bubble-dot" data-idx="${i}" style="position:absolute;right:8px;bottom:6px;"></div>
                    </div>`;
                }
            });
            ct.innerHTML = h;
            bindGroupBubbleToolbar(ct, ms);
        } else {
            let h = '';
            for (let i = 0; i < ms.length; i++) {
                const m = ms[i];
                if (m.type === 'system') {
                    h += `<div class="group-system-msg">${window.escapeHtml(m.content)}</div>`;
                } else if (m.senderId === 'user') {
                    // user 消息渲染（含引用/红包/转账/表情/图片/语音）
                    let contentHtml;
                    if (m.messageType === 'transfer' || m.messageType === 'redpacket') {
                        contentHtml = `<div style="width:88%;max-width:88%;padding:0 4px;">${m.content}</div>`;
                    } else if (m.messageType === 'emoticon') {
                        let url = '', tx = '';
                        try { const p = JSON.parse(m.content); url = p.url; tx = p.text; } catch(e) {}
                        contentHtml = `<div class="emoticon-bubble">${url?`<img src="${url}" alt="${window.escapeHtml(tx)}">`:''}<span class="emoticon-text">${window.escapeHtml(tx)}</span></div>`;
                    } else if (m.messageType === 'image') {
    contentHtml = renderGroupMediaBubble('image', m.content);
} else if (m.messageType === 'voice') {
    contentHtml = renderGroupMediaBubble('voice', m.content);
} else if (m.messageType === 'voice_call_start' || m.messageType === 'voice_call_end') {
    contentHtml = renderGroupCallBubble(m.content);
} else {
    contentHtml = renderQuotedGroupBubble(m.content);
}
                    const userMaskName = mask?.name || '我';
                    let userBadges = '';
                    if (g.ownerId === 'user') userBadges += '<span class="group-owner-badge">群主</span>';
                    if (g.adminIds?.includes('user')) userBadges += '<span class="group-admin-badge">管理</span>';
                    const userMember = g.members?.find(m => m.id === 'user');
                    h += `<div class="group-message-row self" data-msg-id="${m.id||''}" data-idx="${i}">
                        <div class="group-message-content">
                            <div class="bubble-toolbar" data-toolbar-for="${i}">
                                <button class="toolbar-btn reback-btn" data-idx="${i}">↩️ 重回</button>
                                <button class="toolbar-btn danger delete-msg-btn" data-idx="${i}">🗑️ 删除</button>
                                <button class="toolbar-btn multi-select-btn" data-idx="${i}">☑️ 多选</button>
                                <button class="toolbar-btn edit-msg-btn" data-idx="${i}">✏️ 编辑</button>
                            </div>
                            <div class="group-sender-name" style="text-align:right;padding-right:4px;">${userMember?.title?`<span class="group-title-badge">${window.escapeHtml(userMember.title)}</span>`:''}${window.escapeHtml(userMaskName)}${userBadges}</div>
                            ${contentHtml}
                            <div class="bubble-dot" data-idx="${i}"></div>
                        </div>
                        <div class="message-avatar" style="background:${window.getAvatarColor(userMaskName)}">${userMaskName[0]}</div>
                    </div>`;
                } else {
                    const si = await resolveSenderInfo(g, m.senderName);
                    if (!si && m.senderName) continue;
                    let badges = '';
                    if (si?.isOwner) badges += '<span class="group-owner-badge">群主</span>';
                    if (si?.isAdmin && !si?.isOwner) badges += '<span class="group-admin-badge">管理</span>';
                    let bubbleContent;
                    if (m.messageType === 'emoticon') {
                        let url = '', tx = '';
                        try { const p = JSON.parse(m.content); url = p.url; tx = p.text; } catch(e) { tx = m.content; }
                        bubbleContent = `<div class="emoticon-bubble">${url?`<img src="${url}" alt="${window.escapeHtml(tx)}">`:''}<span class="emoticon-text">${window.escapeHtml(tx)}</span></div>`;
                    } else if (m.messageType === 'transfer' || m.messageType === 'redpacket') {
                        bubbleContent = `<div style="width:100%;max-width:100%;">${m.content}</div>`;
                    } else if (m.messageType === 'image') {
    bubbleContent = renderGroupMediaBubble('image', m.content);
} else if (m.messageType === 'voice') {
    bubbleContent = renderGroupMediaBubble('voice', m.content);
} else if (m.messageType === 'voice_call_start' || m.messageType === 'voice_call_end') {
    bubbleContent = renderGroupCallBubble(m.content);
} else if (m.messageType === 'html_card') {
    const sanitized = window.wbE ? window.wbE.sanitize(m.content || '') : window.escapeHtml(m.content || '');
    bubbleContent = `<div class="html-card-bubble">${sanitized}</div>`;
} else {
    bubbleContent = renderQuotedGroupBubble(m.content);
}
                    h += `<div class="group-message-row" data-msg-id="${m.id||''}" data-idx="${i}">
                        <div class="message-avatar" style="background:${window.getAvatarColor(si?.name||'?')};${si?.avatar?`background-image:url('${si.avatar}');background-size:cover;`:''}">${si?.avatar?'':(si?.name||'?')[0]}</div>
                        <div class="group-message-content">
                            <div class="bubble-toolbar" data-toolbar-for="${i}">
                                <button class="toolbar-btn reback-btn" data-idx="${i}">↩️ 重回</button>
                                <button class="toolbar-btn danger delete-msg-btn" data-idx="${i}">🗑️ 删除</button>
                                <button class="toolbar-btn multi-select-btn" data-idx="${i}">☑️ 多选</button>
                                <button class="toolbar-btn edit-msg-btn" data-idx="${i}">✏️ 编辑</button>
                            </div>
                            <div class="group-sender-name">${badges}${window.escapeHtml(si?.name||'?')}${si?.title?`<span class="group-title-badge">${window.escapeHtml(si.title)}</span>`:''}</div>
                            ${bubbleContent}
                            <div class="bubble-dot" data-idx="${i}"></div>
                        </div>
                    </div>`;
                }
            }
            ct.innerHTML = h;
            bindGroupBubbleToolbar(ct, ms);
        }
        setTimeout(async () => {
    ct.scrollTop = ct.scrollHeight;
    bindGroupCardClicks(ct);
    if (window.bubbleThemeModule?.applyBubbleThemeForGroup) {
        await window.bubbleThemeModule.applyBubbleThemeForGroup(id);
    }
}, 100);
    }

    // ========== 引用功能 ==========
    function quoteMessage(idx, msgs) {
        const msg = msgs[idx];
        if (!msg || !msg.content) return;
        const previewText = msg.messageType === 'emoticon'
            ? '[表情包]'
            : (msg.content.length > 30 ? msg.content.slice(0, 30) + '...' : msg.content);
        quotedMessage = { senderName: msg.senderName || '未知', content: msg.content, preview: previewText };
        document.getElementById('groupQuotePreviewContent').textContent = `${quotedMessage.senderName}: ${previewText}`;
        document.getElementById('groupQuotePreviewBar').classList.add('show');
        document.getElementById('groupMessageInput').focus();
    }

    function clearQuote() {
        quotedMessage = null;
        document.getElementById('groupQuotePreviewBar').classList.remove('show');
    }
    
    function svgIcon(name) {
    return window.UI_SVG && window.UI_SVG[name] ? window.UI_SVG[name] : '';
}

function renderQuotedGroupBubble(rawContent) {
    const content = rawContent || '';
    const quoteMatch = content.match(/^「([\s\S]+?)」\n([\s\S]*)$/);

    if (!quoteMatch) {
        return `<div class="group-bubble">${window.escapeHtml(content)}</div>`;
    }

    const quoteInfo = quoteMatch[1] || '';
    const mainText = quoteMatch[2] || '';

    return `
        <div class="group-bubble quoted-bubble">
            <div class="quoted-bubble-main">${window.escapeHtml(mainText)}</div>
            <div class="quote-ref-footer">
                <div class="quote-ref-footer-title">
                    <span class="quote-ref-icon">${svgIcon('quote')}</span>
                    <span>引用</span>
                </div>
                <div class="quote-ref-footer-content">${window.escapeHtml(quoteInfo)}</div>
            </div>
        </div>
    `;
}

function renderGroupMediaBubble(kind, content) {
    if (kind === 'image') {
        return `
            <div class="bubble image-bubble clickable" data-image-desc="${window.escapeHtml(content || '')}">
                <span class="image-icon">${svgIcon('image')}</span>
            </div>
        `;
    }

    return `
        <div class="bubble voice-bubble clickable" data-voice-content="${window.escapeHtml(content || '')}">
            <div class="voice-bubble-header">
                <span class="voice-icon">${svgIcon('mic')}</span>
                <span class="voice-duration">7"</span>
            </div>
        </div>
    `;
}

function renderGroupCallBubble(content) {
    return `
        <div class="bubble call-record-bubble">
            <span class="call-record-icon">${svgIcon('phone')}</span>
            <span>${window.escapeHtml(content || '')}</span>
        </div>
    `;
}
    
    function bindGroupLongPressToolbar(container) {
    let timer = null;
    let sx = 0, sy = 0;
    const DELAY = 420;
    const MOVE = 10;

    function clearT() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function attachToRow(row, targetSelector) {
        const target = row.querySelector(targetSelector);
        if (!target) return;

        const show = () => {
            const tb = row.querySelector('.bubble-toolbar');
            if (!tb) return;
            container.querySelectorAll('.bubble-toolbar.show').forEach(x => {
                if (x !== tb) x.classList.remove('show');
            });
            tb.classList.add('show');
        };

        target.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            sx = e.touches[0].clientX; sy = e.touches[0].clientY;
            clearT();
            timer = setTimeout(show, DELAY);
        }, { passive: true });

        target.addEventListener('touchmove', (e) => {
            if (!timer) return;
            const dx = Math.abs(e.touches[0].clientX - sx);
            const dy = Math.abs(e.touches[0].clientY - sy);
            if (dx > MOVE || dy > MOVE) clearT();
        }, { passive: true });

        target.addEventListener('touchend', clearT, { passive: true });
        target.addEventListener('touchcancel', clearT, { passive: true });

        target.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            sx = e.clientX; sy = e.clientY;
            clearT();
            timer = setTimeout(show, DELAY);
        });
        target.addEventListener('mousemove', (e) => {
            if (!timer) return;
            const dx = Math.abs(e.clientX - sx);
            const dy = Math.abs(e.clientY - sy);
            if (dx > MOVE || dy > MOVE) clearT();
        });
        target.addEventListener('mouseup', clearT);
        target.addEventListener('mouseleave', clearT);
    }

    container.querySelectorAll('.group-message-row').forEach(row => {
        attachToRow(row, '.group-bubble, .emoticon-bubble, .image-bubble, .voice-bubble, .gg-transfer-card, .gg-redpacket-card');
    });
    container.querySelectorAll('[data-offline-msg-id]').forEach(row => {
        attachToRow(row, '.group-offline-card-user, .group-offline-card-ai');
    });

    container.addEventListener('click', (e) => {
        if (e.target.closest('.bubble-toolbar')) return;
        container.querySelectorAll('.bubble-toolbar.show').forEach(tb => tb.classList.remove('show'));
    });
}

    // ========== 气泡工具栏 ==========
function bindGroupBubbleToolbar(container, msgs) {
    // 多选状态
    let multiSelectMode = false;
    let multiSelectedIdxs = new Set();

    bindGroupLongPressToolbar(container);

    // 删除
    container.querySelectorAll('.delete-msg-btn').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            if (!confirm('确定删除这条消息吗？')) return;
            var idx = parseInt(this.dataset.idx);
            var msg = msgs[idx];
            if (msg && msg.id) await window.DB.delete('groupMessages', msg.id);
            this.closest('.bubble-toolbar').classList.remove('show');
            await loadGroupMessages(window.currentGroupId);
        });
    });

    // 重回
    container.querySelectorAll('.reback-btn').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            var idx = parseInt(this.dataset.idx);
            var msg = msgs[idx];
            if (!msg) return;
            var lastUserIdx = -1;
            for (var i = idx - 1; i >= 0; i--) { if (msgs[i]?.senderId === 'user') { lastUserIdx = i; break; } }
            if (lastUserIdx === -1) { window.showStatus('无法找到对应的用户消息', 'error'); return; }
            if (!confirm('确定要回到这条消息并删除之后的所有回复吗？')) return;
            for (var j = lastUserIdx + 1; j < msgs.length; j++) { if (msgs[j]?.id) await window.DB.delete('groupMessages', msgs[j].id); }
            this.closest('.bubble-toolbar').classList.remove('show');
            await loadGroupMessages(window.currentGroupId);
            await fetchGroupAIReply();
        });
    });

    // ====== 多选 ======
    container.querySelectorAll('.multi-select-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.dataset.idx);
            multiSelectMode = true;
            multiSelectedIdxs.add(idx);
            updateGroupMultiSelectUI();
            this.closest('.bubble-toolbar').classList.remove('show');
        });
    });

    function updateGroupMultiSelectUI() {
        var rows = container.querySelectorAll('.group-message-row, [data-offline-msg-id]');
        rows.forEach(function(row) {
            var idx = parseInt(row.dataset.idx);
            if (isNaN(idx)) return;
            if (multiSelectMode && multiSelectedIdxs.has(idx)) {
                row.style.outline = '2px solid #d7e4ee';
                row.style.outlineOffset = '2px';
            } else {
                row.style.outline = '';
                row.style.outlineOffset = '';
            }
        });
        var bar = document.getElementById('multiSelectBar');
        if (multiSelectMode) {
            bar.style.display = 'flex';
            document.getElementById('multiSelectCount').textContent = '已选 ' + multiSelectedIdxs.size + ' 条';
        } else {
            bar.style.display = 'none';
        }
    }

    container.addEventListener('click', function(e) {
        if (!multiSelectMode) return;
        if (e.target.closest('.bubble-toolbar') || e.target.closest('.bubble-dot')) return;
        var row = e.target.closest('.group-message-row') || e.target.closest('[data-offline-msg-id]');
        if (!row) return;
        var idx = parseInt(row.dataset.idx);
        if (isNaN(idx)) return;
        if (multiSelectedIdxs.has(idx)) {
            multiSelectedIdxs.delete(idx);
        } else {
            multiSelectedIdxs.add(idx);
        }
        updateGroupMultiSelectUI();
    });

    // 多选删除 & 取消按钮（复用 #multiSelectBar）
    document.getElementById('multiSelectDeleteBtn').onclick = async function() {
        if (multiSelectedIdxs.size === 0) return;
        if (!confirm('确定删除选中的 ' + multiSelectedIdxs.size + ' 条消息吗？')) return;
        for (var idx of multiSelectedIdxs) {
            var msg = msgs[idx];
            if (msg && msg.id) await window.DB.delete('groupMessages', msg.id);
        }
        multiSelectMode = false;
        multiSelectedIdxs.clear();
        updateGroupMultiSelectUI();
        await loadGroupMessages(window.currentGroupId);
    };

    document.getElementById('multiSelectCancelBtn').onclick = function() {
        multiSelectMode = false;
        multiSelectedIdxs.clear();
        updateGroupMultiSelectUI();
    };

    // ====== 编辑 ======
    container.querySelectorAll('.edit-msg-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.dataset.idx);
            var msg = msgs[idx];
            if (!msg || (msg.messageType && msg.messageType !== 'text' && msg.messageType !== 'offline_card')) {
                window.showStatus('只能编辑文字消息', 'info');
                return;
            }
            // 找到气泡或卡片内容元素
            var row = this.closest('.group-message-row') || this.closest('[data-offline-msg-id]');
            var bubble = row.querySelector('.group-bubble') || row.querySelector('.group-offline-card-user') || row.querySelector('.group-offline-card-ai');
            if (!bubble) return;
            var currentContent = msg.content;

            var textarea = document.createElement('textarea');
            textarea.className = 'bubble-edit-textarea';
            textarea.value = currentContent;
            textarea.style.width = '100%';

            var actionsRow = document.createElement('div');
            actionsRow.className = 'edit-actions-row';
            actionsRow.innerHTML = '<button class="toolbar-btn save">💾 保存</button><button class="toolbar-btn cancel">✕ 取消</button>';

            bubble.style.display = 'none';
            bubble.parentNode.appendChild(textarea);
            bubble.parentNode.appendChild(actionsRow);
            textarea.focus();

            this.closest('.bubble-toolbar').classList.remove('show');

            actionsRow.querySelector('.save').addEventListener('click', async function() {
                var newContent = textarea.value.trim();
                if (!newContent) { window.showStatus('内容不能为空', 'error'); return; }
                msg.content = newContent;
                await window.DB.put('groupMessages', msg);
                await loadGroupMessages(window.currentGroupId);
            });

            actionsRow.querySelector('.cancel').addEventListener('click', function() {
                textarea.remove();
                actionsRow.remove();
                bubble.style.display = '';
            });
        });
    });

    // 关闭工具栏
    container.addEventListener('click', function(e) {
        if (e.target.closest('.bubble-toolbar') || e.target.closest('.bubble-dot')) return;
        container.querySelectorAll('.bubble-toolbar.show').forEach(function(tb) { tb.classList.remove('show'); });
    });

    // 左滑引用
    var touchStartX = 0, touchStartY = 0, currentSwipeRow = null;
    container.querySelectorAll('.group-message-row').forEach(function(row) {
        row.addEventListener('touchstart', function(e) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; currentSwipeRow = row; }, { passive: true });
        row.addEventListener('touchend', function(e) {
            if (currentSwipeRow !== row) return;
            var dx = e.changedTouches[0].clientX - touchStartX;
            var dy = e.changedTouches[0].clientY - touchStartY;
            if (dx < -50 && Math.abs(dx) > Math.abs(dy)) {
                var idx = parseInt(row.dataset.idx);
                if (!isNaN(idx)) quoteMessage(idx, msgs);
            }
        });
    });

    bindGroupCardClicks(container);
}

    // ========== 红包/转账卡片点击 ==========
    function bindGroupCardClicks(container) {
    // 图片点击：展示大图描述（防重复绑定）
    container.querySelectorAll('.image-bubble[data-image-desc]').forEach(card => {
        if (card.dataset.imgBound === '1') return;
        card.dataset.imgBound = '1';
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const desc = card.getAttribute('data-image-desc') || '';
            if (window.showImageModalGlobal) {
                window.showImageModalGlobal(desc);
            } else {
                alert(desc || '图片');
            }
        });
    });

    // 语音点击：切换展示文字内容（防重复绑定）
    container.querySelectorAll('.voice-bubble[data-voice-content]').forEach(card => {
        if (card.dataset.voiceBound === '1') return;
        card.dataset.voiceBound = '1';
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const content = card.getAttribute('data-voice-content') || '';
            let panel = card.querySelector('.voice-content-display');
            if (panel) {
                panel.remove();
                return;
            }
            panel = document.createElement('div');
            panel.className = 'voice-content-display';
            panel.textContent = content;
            card.appendChild(panel);
        });
    });

    container.querySelectorAll('.gg-redpacket-card, .gg-transfer-card.pending').forEach(el => {
        el.replaceWith(el.cloneNode(true));
    });
        container.querySelectorAll('.gg-redpacket-card').forEach(card => {
            card.addEventListener('click', async () => {
                const row = card.closest('.group-message-row');
                if (!row) return;
                const msgId = parseInt(row.dataset.msgId);
                if (isNaN(msgId)) return;
                const msg = await window.DB.get('groupMessages', msgId);
                if (!msg || msg.senderId === 'user') return;
                const senderName = msg.senderName || '未知';
                const mask = await window.getActiveMask();
                await window.DB.put('groupMessages', {
                    groupId: window.currentGroupId, senderId: 'system', senderName: '系统',
                    role: 'system', content: `${mask?.name || '我'} 领取了 ${senderName} 的红包`,
                    messageType: 'system', type: 'system', timestamp: Date.now()
                });
                await loadGroupMessages(window.currentGroupId);
            });
        });
        container.querySelectorAll('.gg-transfer-card.pending').forEach(card => {
            card.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = card.closest('.group-message-row');
                if (!row) return;
                const msgId = parseInt(row.dataset.msgId);
                if (isNaN(msgId)) return;
                const msg = await window.DB.get('groupMessages', msgId);
                if (!msg || msg.senderId === 'user') return;
                const senderName = msg.senderName || '未知';
                const amountMatch = card.textContent.match(/¥([\d.]+)/);
                const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
                const overlay = document.createElement('div');
                overlay.className = 'modal';
                overlay.style.display = 'flex';
                overlay.style.zIndex = '2000';
                overlay.innerHTML = `<div class="modal-content" style="max-width:300px;text-align:center;">
                    <button style="position:absolute;top:8px;right:12px;background:none;border:none;font-size:18px;cursor:pointer;color:#999;" class="close-transfer-modal">✕</button>
                    <h3 style="margin-top:8px;">微信转账</h3>
                    <p style="font-size:14px;color:#4a5568;">${window.escapeHtml(senderName)} 向你转账</p>
                    <p style="font-size:22px;font-weight:700;color:#b9061e;">¥${amount.toFixed(2)}</p>
                    <div style="display:flex;gap:8px;margin-top:16px;">
                        <button class="small-btn danger close-transfer-modal">拒绝</button>
                        <button class="small-btn primary accept-transfer-btn">接收</button>
                    </div>
                </div>`;
                document.body.appendChild(overlay);
                const closeModal = () => overlay.remove();
                overlay.querySelectorAll('.close-transfer-modal').forEach(btn => btn.addEventListener('click', closeModal));
                overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });
                overlay.querySelector('.accept-transfer-btn').addEventListener('click', async () => {
                    closeModal();
                    const mask = await window.getActiveMask();
                    const acceptedCard = `<div class="gg-transfer-card pending"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${mask?.name || '我'}已收款</div></div>`;
                    await window.DB.put('groupMessages', { groupId: window.currentGroupId, senderId: 'user', senderName: mask?.name || '我', role: 'user', content: acceptedCard, messageType: 'transfer', timestamp: Date.now() });
                    await window.DB.put('groupMessages', { groupId: window.currentGroupId, senderId: 'system', senderName: '系统', role: 'system', content: `${mask?.name || '我'} 接收了 ${senderName} 的转账 ¥${amount.toFixed(2)}`, messageType: 'system', type: 'system', timestamp: Date.now() + 1 });
                    await loadGroupMessages(window.currentGroupId);
                });
            });
        });
    }

    // ========== 打开群聊 ==========
    async function openGroupConversation(id) {
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        g.updatedAt = Date.now();
        await window.DB.put('groupChats', g);
        window.currentGroupId = id;
        window.currentConversationId = null;
        document.getElementById('groupConversationTitle').textContent = g.name;
        document.getElementById('groupChatInputArea').style.display = '';
        const msgInput = document.getElementById('groupMessageInput');
        msgInput.placeholder = g.isUserParticipating ? '输入消息...' : '输入旁白/系统消息...';
        await loadGroupMessages(id);
if (window.bubbleThemeModule?.applyBubbleThemeForGroup) {
    await window.bubbleThemeModule.applyBubbleThemeForGroup(id);
}
window.switchPage('group-conversation');
        
    }

    // ========== 发送消息 ==========
    async function sendGroupMsg() {
        const inp = document.getElementById('groupMessageInput');
        const t = inp.value.trim();
        if (!t) return;
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const mask = await window.getActiveMask();
        const mode = g.mode || 'online';
        let finalContent = t;
        if (quotedMessage) {
            finalContent = `「${quotedMessage.senderName}: ${quotedMessage.preview}」\n${t}`;
            clearQuote();
        }
        if (!g.isUserParticipating) {
            await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '旁白', role: 'system', content: finalContent, messageType: 'system', type: 'system', timestamp: Date.now() });
        } else {
            await window.DB.put('groupMessages', { groupId: id, senderId: 'user', senderName: mask?.name || '我', role: 'user', content: finalContent, messageType: mode === 'offline' ? 'offline_card' : 'text', type: mode === 'offline' ? 'offline' : '', timestamp: Date.now() });
        }
        g.updatedAt = Date.now();
        await window.DB.put('groupChats', g);
        await loadGroupMessages(id);
        inp.value = '';
    }
    // ========== AI回复 ==========
    async function fetchGroupAIReply() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const mode = g.mode || 'online';
        let prompt, userName;
        if (mode === 'offline') {
            const result = await buildGroupOfflinePrompt(g);
            prompt = result.prompt;
        } else {
            const result = await buildGroupOnlinePrompt(g);
            prompt = result.prompt;
            userName = result.userName;
        }
        const allMembers = [];
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (ch) allMembers.push({ id: mid, name: ch.name, isOwner: mid === g.ownerId, isAdmin: g.adminIds?.includes(mid) });
        }
        const npcList = await window.DB.queryByIndex('groupNPCs', 'groupId', id);
        npcList.forEach(n => allMembers.push({ id: n.id, name: n.name, isOwner: false, isAdmin: false, isNPC: true }));

        window.showStatus('🤖 正在生成群聊回复...', 'info');
        window.recordApiPending();
        try {
            let llmOptions = { maxTokens: 1500 };

if (mode === 'offline') {
    const offlineMaxChars = parseInt(g.offlineControl?.maxChars || 1200);

    llmOptions.maxTokens = Math.min(
        16000,
        Math.max(2000, Math.ceil(offlineMaxChars * 1.5))
    );
}

const reply = await window.callLLM(
    [
        { role: 'system', content: prompt },
        { role: 'user', content: '请生成回复。' }
    ],
    llmOptions
);
            const nowTs = Date.now();
            let bt = nowTs;
            if (mode === 'offline') {
                await window.DB.put('groupMessages', {
                    groupId: id, senderId: 'system', senderName: '系统', role: 'system',
                    content: reply.trim(), messageType: 'offline_card', type: 'offline', timestamp: bt
                });
            } else {
                const lines = reply.split('\n').filter(l => l.trim());
                const mutedNow = Date.now();
                const activeMuted = {};
                for (const [mid, until] of Object.entries(g.mutedMembers || {})) {
                    if (until > mutedNow) activeMuted[mid] = true;
                }
                for (const line of lines) {
                    // CMD 指令
                    const cmdMatch = line.match(/^\[CMD\]:([^:]+):([^:]+):([^:]+)(?::(.+))?$/);
                    if (cmdMatch) {
                        const executor = cmdMatch[1].trim();
                        const action = cmdMatch[2].trim();
                        const target = cmdMatch[3].trim();
                        const param = cmdMatch[4] ? cmdMatch[4].trim() : '';
                        const execMember = allMembers.find(m => m.name === executor);
                        if (!execMember) continue;
                        const targetMember = allMembers.find(m => m.name === target);
                        if (!targetMember && action !== 'kick') continue;
                        const isOwner = execMember.isOwner, isAdmin = execMember.isAdmin;
                        let sysMsg = '', shouldSave = true;
                        switch (action) {
                            case 'transfer_owner': if (!isOwner) continue;
                                if (targetMember && !targetMember.isNPC) { g.ownerId = targetMember.id;
                                    sysMsg = `${executor} 将群主转让给了 ${target}`; } break;
                            case 'set_admin': if (!isOwner) continue;
                                if (targetMember && !targetMember.isNPC) { if (!g.adminIds) g.adminIds = []; if (!g.adminIds.includes(targetMember.id)) { g.adminIds.push(targetMember.id);
                                        sysMsg = `${executor} 设置 ${target} 为管理员`; } } break;
                            case 'remove_admin': if (!isOwner) continue;
                                if (targetMember && g.adminIds) { g.adminIds = g.adminIds.filter(x => x !== targetMember.id);
                                    sysMsg = `${executor} 取消了 ${target} 的管理员`; } break;
                            case 'mute': if (!isOwner && !isAdmin) continue;
                                if (targetMember && param && !targetMember.isNPC && !targetMember.isOwner) { const minutes = parseInt(param) || 30; if (!g.mutedMembers) g.mutedMembers = {};
                                    g.mutedMembers[targetMember.id] = Date.now() + minutes * 60 * 1000;
                                    sysMsg = `${executor} 将 ${target} 禁言 ${minutes} 分钟`; } break;
                            case 'unmute': if (!isOwner && !isAdmin) continue;
                                if (targetMember && g.mutedMembers && g.mutedMembers[targetMember.id]) { delete g.mutedMembers[targetMember.id];
                                    sysMsg = `${executor} 解除了 ${target} 的禁言`; } break;
                            case 'set_title': if (!isOwner && !isAdmin) continue;
                                if (targetMember && param && !targetMember.isNPC) { if (!g.members) g.members = []; let md = g.members.find(m => m.id === targetMember.id); if (!md) { md = { id: targetMember.id, title: '', syncMemory: false };
                                        g.members.push(md); }
                                    md.title = param.slice(0, 15);
                                    sysMsg = `${executor} 授予 ${target} 头衔「${param.slice(0, 15)}」`; } break;
                            case 'kick': if (!isOwner && !isAdmin) continue;
                                if (targetMember && !targetMember.isNPC && !targetMember.isOwner) { g.memberIds = g.memberIds.filter(x => x !== targetMember.id);
                                    sysMsg = `${executor} 将 ${target} 踢出了群聊`; } break;
                            default: shouldSave = false;
                        }
                        if (shouldSave && sysMsg) {
                            await window.DB.put('groupChats', g);
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: sysMsg, messageType: 'system', type: 'system', timestamp: bt });
                            bt += 10;
                        }
                        continue;
                    }
                    // 普通消息
                    const match = line.match(/^\[(.+?)\]:\s*(.+)$/);
                    if (match) {
                        const senderName = match[1].trim();
                        const rawContent = match[2].trim();
                        if (senderName === userName) continue;
                        const senderMember = allMembers.find(m => m.name === senderName);
                        if (!senderMember) continue;
                        const mutedKey = String(senderMember.id);
                        if (!senderMember.isOwner && activeMuted[mutedKey]) continue;
                        // 红包
                        const rpMatch = rawContent.match(/^\[红包\]([\d.]+):(.+)$/);
                        if (rpMatch) {
                            const amount = parseFloat(rpMatch[1]);
                            const msg = rpMatch[2].trim();
                            const isKouling = msg.startsWith('口令:');
                            const kouling = isKouling ? msg.replace('口令:', '').trim() : '';
                            const card = `<div class="gg-redpacket-card" data-kouling="${window.escapeHtml(kouling)}"><div class="gg-redpacket-icon">🧧</div><div class="gg-redpacket-msg">${window.escapeHtml(isKouling?kouling:msg)}</div><div class="gg-redpacket-label">微信红包${isKouling?' · 口令':''}</div></div>`;
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName, role: 'assistant', content: card, messageType: 'redpacket', timestamp: bt, kouling: kouling, total: amount, count: 1 });
                            bt += 10;
                            if (!isKouling) {
                                const otherMembers = allMembers.filter(m => m.name !== senderName && !activeMuted[String(m.id)]);
                                const grabbers = otherMembers.sort(() => Math.random() - 0.5).slice(0, Math.min(Math.floor(Math.random() * 3) + 1, otherMembers.length));
                                for (const grabber of grabbers) {
                                    await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: `${grabber.name} 领取了 ${senderName} 的红包`, messageType: 'system', type: 'system', timestamp: bt });
                                    bt += 5;
                                }
                            }
                            continue;
                        }
                        // 抢红包
                        const grMatch = rawContent.match(/^\[抢红包\](.+):([\d.]+)$/);
                        if (grMatch) {
                            const fromWho = grMatch[1].trim();
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: `${senderName} 领取了 ${fromWho} 的红包`, messageType: 'system', type: 'system', timestamp: bt });
                            bt += 5;
                            continue;
                        }
                        // 转账
                        const trMatch = rawContent.match(/^\[转账\]([\d.]+):(.+):(.+)$/);
                        if (trMatch) {
                            const amount = parseFloat(trMatch[1]);
                            const msg = trMatch[2].trim();
                            const target = trMatch[3].trim();
                            const card = `<div class="gg-transfer-card pending"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${window.escapeHtml(msg)} · 给${window.escapeHtml(target)}</div></div>`;
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName, role: 'assistant', content: card, messageType: 'transfer', timestamp: bt });
                            bt += 10;
                            const targetMember = allMembers.find(m => m.name === target);
                            if (targetMember) {
                                const willAccept = Math.random() > 0.3;
                                const card2 = willAccept
                                    ? `<div class="gg-transfer-card pending"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${window.escapeHtml(target)}已收款</div></div>`
                                    : `<div class="gg-transfer-card pending" style="opacity:0.5;"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${window.escapeHtml(target)}已退还</div></div>`;
                                await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName: targetMember.name, role: 'assistant', content: card2, messageType: 'transfer', timestamp: bt });
                                bt += 10;
                            }
                            continue;
                        }
                        // 收转账
                        const atMatch = rawContent.match(/^\[收转账\](.+):([\d.]+)$/);
                        if (atMatch) {
                            const fromWho = atMatch[1].trim();
                            const amount = parseFloat(atMatch[2]);
                            const card = `<div class="gg-transfer-card pending"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${window.escapeHtml(senderName)}已收款</div></div>`;
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName, role: 'assistant', content: card, messageType: 'transfer', timestamp: bt });
                            bt += 10;
                            continue;
                        }
                        // 退转账
                        const rtMatch = rawContent.match(/^\[退转账\](.+):([\d.]+)$/);
                        if (rtMatch) {
                            const fromWho = rtMatch[1].trim();
                            const amount = parseFloat(rtMatch[2]);
                            const card = `<div class="gg-transfer-card pending" style="opacity:0.5;"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${amount.toFixed(2)}</div><div class="gg-transfer-hint">${window.escapeHtml(senderName)}已退还</div></div>`;
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName, role: 'assistant', content: card, messageType: 'transfer', timestamp: bt });
                            bt += 10;
                            continue;
                        }
                        // MSG 解析
                        const parts = [];
                        let remaining = rawContent;
                        const msgRegex = /\[MSG\](文字|图片|语音|表情包|html_card):\s*([^\[\]]+?)(?=\[MSG\]|$)/g;
                        let lastIdx = 0, execResult;
                        while ((execResult = msgRegex.exec(remaining)) !== null) {
                            const beforeText = remaining.substring(lastIdx, execResult.index).trim();
                            if (beforeText) parts.push({ type: 'text', content: beforeText });
                            const typeMap = { '文字': 'text', '图片': 'image', '语音': 'voice', '表情包': 'emoticon', 'html_card': 'html_card' };
                            parts.push({ type: typeMap[execResult[1]] || 'text', content: execResult[2].trim(), isMSG: true });
                            lastIdx = execResult.index + execResult[0].length;
                        }
                        const tailText = remaining.substring(lastIdx).trim();
                        if (tailText) parts.push({ type: 'text', content: tailText });
                        if (parts.length === 0) parts.push({ type: 'text', content: rawContent });
                        for (const part of parts) {
                            let finalContent = part.content;
                            if (part.type === 'emoticon') {
                                const mountedIds = g.emoticonGroupIds || [];
                                let allItems;
                                if (mountedIds.length > 0) {
                                    allItems = [];
                                    for (const gid of mountedIds) {
                                        const items = await window.DB.queryByIndex('emoticonItems', 'groupId', gid);
                                        allItems.push(...items);
                                    }
                                } else {
                                    allItems = await window.DB.getAll('emoticonItems');
                                }
                                const matched = allItems.find(item => item.text === part.content);
                                finalContent = matched ? JSON.stringify({ url: matched.url, text: matched.text }) : JSON.stringify({ url: '', text: part.content });
                            }
                            await window.DB.put('groupMessages', { groupId: id, senderId: 'char', senderName, role: 'assistant', content: finalContent, messageType: part.type, timestamp: bt });
                            bt += 10;
                        }
                    }
                }

                // ====== 口令红包自动匹配（必须在 else 分支内，因为 lines 定义在这里） ======
                const allTextLines = lines.filter(l => {
                    const m = l.match(/^\[(.+?)\]:\s*(.+)$/);
                    return m && !m[2].startsWith('[红包]') && !m[2].startsWith('[抢红包]') && !m[2].startsWith('[转账]') && !m[2].startsWith('[收转账]') && !m[2].startsWith('[退转账]');
                }).map(l => {
                    const m = l.match(/^\[(.+?)\]:\s*(.+)$/);
                    return { name: m[1].trim(), text: m[2].trim() };
                });

                const allRedpackets = (await window.DB.queryByIndex('groupMessages', 'groupId', id))
                    .filter(m => m.messageType === 'redpacket' && m.kouling && m.count > 0)
                    .sort((a, b) => a.timestamp - b.timestamp);

                const claimedThisRound = new Set();

                for (const rp of allRedpackets) {
                    for (const line of allTextLines) {
                        if (line.text === rp.kouling && line.name !== rp.senderName && !claimedThisRound.has(line.name)) {
                            const bonus = rp.count > 1
                                ? (Math.random() * rp.total * 0.5).toFixed(2)
                                : rp.total.toFixed(2);

                            await window.DB.put('groupMessages', {
                                groupId: id, senderId: 'system', senderName: '系统', role: 'system',
                                content: `${line.name} 领取了 ${rp.senderName} 的口令红包 ¥${bonus}`,
                                messageType: 'system', type: 'system', timestamp: bt
                            });
                            bt += 5;

                            rp.count -= 1;
                            if (rp.count <= 0) {
                                rp.count = 0;
                                rp.status = 'finished';
                            }
                            await window.DB.put('groupMessages', rp);

                            claimedThisRound.add(line.name);
                            break;
                        }
                    }
                }
                // ====== 口令红包匹配结束 ======
            }

            g.updatedAt = Date.now();
            await window.DB.put('groupChats', g);
            await loadGroupMessages(id);
            window.showStatus('✅ 群聊回复成功', 'success');
        } catch (e) {
            window.recordApiError('GROUP_AI', e.message);
            window.showStatus('❌ ' + e.message, 'error');
        }
    }

    // ========== 切换模式 ==========
    async function toggleGroupMode() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const nm = g.mode === 'online' ? 'offline' : 'online';
        if (nm === 'offline' && !confirm('切换到线下模式？')) return;
        g.mode = nm;
        g.updatedAt = Date.now();
        await window.DB.put('groupChats', g);
        await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: '— 切换到' + (nm === 'offline' ? '线下' : '线上') + ' —', messageType: 'system', type: 'system', timestamp: Date.now() });
        await loadGroupMessages(id);
    }

    // ========== 转账 ==========
    async function groupTransfer() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const amt = prompt('转账金额：');
        if (!amt || isNaN(amt) || Number(amt) <= 0) return;
        const lst = document.getElementById('groupTransferTargetList');
        let h = '';
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (ch) h += `<div class="contact-item transfer-target" data-char-id="${mid}" data-name="${ch.name}"><div class="avatar" style="background:${window.getAvatarColor(ch.name)}">${ch.name[0]}</div><div>${ch.name}</div></div>`;
        }
        lst.innerHTML = h;
        document.getElementById('groupTransferTargetModal').classList.add('active');
        lst.querySelectorAll('.transfer-target').forEach(el => el.addEventListener('click', async () => {
            const cn = el.dataset.name;
            const card = `<div class="gg-transfer-card pending"><div style="color:#999;font-size:13px;">微信转账</div><div class="gg-transfer-amount">¥${Number(amt).toFixed(2)}</div><div class="gg-transfer-hint">待${cn}确认收款</div></div>`;
            document.getElementById('groupTransferTargetModal').classList.remove('active');
            await window.DB.put('groupMessages', { groupId: id, senderId: 'user', senderName: '我', role: 'user', content: card, messageType: 'transfer', type: '', timestamp: Date.now() });
           
g.updatedAt = Date.now();
await window.DB.put('groupChats', g);
await loadGroupMessages(id);
        }));
    }

    // ========== 红包 ==========
    function showRedPacketModal() {
        document.getElementById('rpTypeMulti').classList.add('selected');
        document.getElementById('rpTypeSingle').classList.remove('selected');
        document.getElementById('rpMultiSettings').style.display = '';
        document.getElementById('rpSingleSettings').style.display = 'none';
        rpMode = 'multi';
        document.getElementById('rpModeNormal').classList.add('selected');
        document.getElementById('rpModeLucky').classList.remove('selected');
        document.getElementById('rpMessage').placeholder = '恭喜发财！';
        document.getElementById('rpMessage').value = '';
        document.getElementById('groupRedPacketModal').classList.add('active');
    }
    async function confirmRedPacket() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        if (rpMode === 'multi') {
            const total = document.getElementById('rpTotalAmount').value;
            const count = document.getElementById('rpCount').value;
            const msg = document.getElementById('rpMessage').value || '恭喜发财！';
            const isKouling = document.getElementById('rpModeLucky').classList.contains('selected');
            if (!total || !count) return;
            const koulingLabel = isKouling ? ' · 口令' : '';
            const card = `<div class="gg-redpacket-card" data-total="${total}" data-count="${count}"><div class="gg-redpacket-icon">🧧</div><div class="gg-redpacket-msg">${window.escapeHtml(msg)}</div><div class="gg-redpacket-label">${count}个红包 · ¥${total}${koulingLabel}</div></div>`;
            await window.DB.put('groupMessages', { groupId: id, senderId: 'user', senderName: '我', role: 'user', content: card, messageType: 'redpacket', type: '', timestamp: Date.now(), kouling: isKouling ? msg : '', total: parseFloat(total), count: parseInt(count) });
        } else {
            const amt = document.getElementById('rpSingleAmount').value;
            const target = document.getElementById('rpSingleTarget').value;
            const msg = document.getElementById('rpSingleMessage').value || '恭喜发财！';
            if (!amt || !target) return;
            const ch = await window.DB.get('characters', target);
            const card = `<div class="gg-redpacket-card"><div class="gg-redpacket-icon">🧧</div><div class="gg-redpacket-msg">${window.escapeHtml(msg)}</div><div class="gg-redpacket-label">专属红包 · ¥${amt} · ${window.escapeHtml(ch?.name||target)}</div></div>`;
            await window.DB.put('groupMessages', { groupId: id, senderId: 'user', senderName: '我', role: 'user', content: card, messageType: 'redpacket', type: '', timestamp: Date.now(), total: parseFloat(amt), count: 1 });
        }
        document.getElementById('groupRedPacketModal').classList.remove('active');
        g.updatedAt = Date.now();
        await window.DB.put('groupChats', g);
        await loadGroupMessages(id);
    }

    // ========== 群聊总结 ==========
    async function showGroupSummaryModal() {
        const id = window.currentGroupId;
        if (!id) return;
        const ms = (await window.DB.queryByIndex('groupMessages', 'groupId', id))
            .filter(m => m.type !== 'system').sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const segments = groupMessagesIntoSegments(ms);
        const totalSegments = segments.length;
        const lastSummarized = (await window.DB.getSetting(`groupLastSummaryEnd_${id}`, 0));
        document.getElementById('groupSummaryStart').value = lastSummarized + 1;
        document.getElementById('groupSummaryEnd').value = totalSegments;
        document.getElementById('groupSummaryModal').classList.add('active');
        window._groupTotalSegments = totalSegments;
        window._groupSegments = segments;
        await renderSummaryCards();
    }
    async function renderSummaryCards() {
        const id = window.currentGroupId;
        if (!id) return;
        const summaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
        const container = document.getElementById('groupSummaryList');
        if (!summaries || !summaries.length) {
            container.innerHTML = '<div style="text-align:center;color:#8ba3c7;font-size:13px;padding:12px;">暂无保存的总结</div>';
            return;
        }
        container.innerHTML = '';
        summaries.forEach((s, i) => {
            const card = document.createElement('div');
            card.className = 'group-summary-card';
            card.style.cssText = 'background:#f8f6f2;border-radius:8px;padding:10px;border:1px solid #e0dcd5;margin-bottom:10px;';
            card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:11px;color:#8ba3c7;">第${s.start||'?'}-${s.end||'?'}段</span>
                <div style="display:flex;gap:4px;">
                    <button class="small-btn summary-edit-btn" style="font-size:11px;padding:2px 8px;">✏️</button>
                    <button class="small-btn danger summary-delete-btn" style="font-size:11px;padding:2px 8px;">🗑️</button>
                </div>
            </div>
            <div class="summary-content" style="max-height:400px;overflow-y:auto;font-size:13px;color:#4a5568;white-space:pre-wrap;word-break:break-word;">${window.escapeHtml(s.content)}</div>`;
            card.querySelector('.summary-edit-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                const currentSummaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
                const item = currentSummaries[i];
                if (!item) return;
                const newText = prompt('编辑总结：', item.content);
                if (newText !== null && newText.trim()) { item.content = newText.trim(); await window.DB.setSetting(`groupSummaries_${id}`, currentSummaries);
                    card.querySelector('.summary-content').textContent = newText.trim(); }
            });
            card.querySelector('.summary-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('确定删除这条总结吗？')) return;
                const currentSummaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
                currentSummaries.splice(i, 1);
                await window.DB.setSetting(`groupSummaries_${id}`, currentSummaries);
                await renderSummaryCards();
            });
            container.appendChild(card);
        });
    }
    async function groupSummaryAutoFill() {
        const id = window.currentGroupId;
        if (!id) return;
        const lastSummarized = (await window.DB.getSetting(`groupLastSummaryEnd_${id}`, 0));
        document.getElementById('groupSummaryStart').value = lastSummarized + 1;
        document.getElementById('groupSummaryEnd').value = window._groupTotalSegments || 1;
    }
    async function generateGroupSummary() {
        const id = window.currentGroupId;
        if (!id) return;
        const start = parseInt(document.getElementById('groupSummaryStart').value);
        const end = parseInt(document.getElementById('groupSummaryEnd').value);
        if (isNaN(start) || isNaN(end) || start > end) { window.showStatus('请填写有效范围', 'error'); return; }
        const segments = window._groupSegments || [];
        const targetSegs = segments.filter(s => s.segmentNumber >= start && s.segmentNumber <= end);
        if (targetSegs.length === 0) { window.showStatus('所选范围无内容', 'error'); return; }
        let contentText = '';
        targetSegs.forEach(seg => {
            const label = seg.senderId === 'user' ? '用户' : '角色们';
            const msgText = seg.messages.map(m => `[${m.senderName}]: ${m.content}`).join(' | ');
            contentText += `[${label}]: ${msgText}\n`;
        });
        window.showStatus('📝 正在生成总结...', 'info');
        try {
            const aiReply = await window.callLLM([{ role: 'user', content: `请用第三人称总结以下群聊内容，200字以内：\n\n${contentText}` }], { maxTokens: 300 });
            const summaryContent = (aiReply || '').trim();
            if (!summaryContent) { window.showStatus('❌ AI返回为空', 'error'); return; }
            const summaries = await window.DB.getSetting(`groupSummaries_${id}`, []);
            summaries.push({ start, end, content: summaryContent, createdAt: Date.now() });
            await window.DB.setSetting(`groupSummaries_${id}`, summaries.slice(-20));
            await window.DB.setSetting(`groupLastSummaryEnd_${id}`, end);
            await renderSummaryCards();
            window.showStatus('✅ 总结已保存', 'success');
        } catch (e) { window.showStatus('❌ ' + e.message, 'error'); }
    }

    // ========== 群聊详情 ==========
    async function openGroupDetail() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        document.getElementById('groupDetailName').value = g.name || '';
        document.getElementById('groupDetailPlot').value = g.plot || '';
        document.getElementById('groupAvatarData').value = g.avatar || '';
        const avatarPreview = document.getElementById('groupAvatarPreview');
        if (g.avatar) { avatarPreview.style.backgroundImage = `url('${g.avatar}')`;
            avatarPreview.style.backgroundColor = 'transparent';
            avatarPreview.textContent = ''; } else { avatarPreview.style.backgroundImage = '';
            avatarPreview.style.backgroundColor = '#5cb85c';
            avatarPreview.textContent = '群'; }
        document.getElementById('groupBgData').value = g.bgImage || '';
        const bgPreview = document.getElementById('groupBgPreview');
        bgPreview.style.backgroundImage = g.bgImage ? `url('${g.bgImage}')` : '';
        const nowTs = Date.now();
        const mutedMembers = g.mutedMembers || {};
        let cleaned = false;
        for (const [mid, until] of Object.entries(mutedMembers)) { if (until < nowTs) { delete mutedMembers[mid];
                cleaned = true; } }
        if (cleaned) { g.mutedMembers = mutedMembers; await window.DB.put('groupChats', g); }
        const mc = document.getElementById('groupMemberList');
        let h = '';
        for (const mid of g.memberIds) {
            const ch = await window.DB.get('characters', mid);
            if (!ch) continue;
            const md = g.members?.find(m => m.id === mid);
            const isOwner = mid === g.ownerId;
            const isAdmin = !isOwner && (g.adminIds?.includes(mid));
            const isMuted = !!mutedMembers[String(mid)];
            const muteUntil = mutedMembers[String(mid)] ? new Date(mutedMembers[String(mid)]).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '';
            h += `<div class="group-member-item"><div class="group-member-avatar" style="background:${window.getAvatarColor(ch.name)};${ch.avatar?`background-image:url('${ch.avatar}');background-size:cover;`:''}">${ch.avatar?'':ch.name[0]}</div><div class="group-member-info"><div class="group-member-name">${window.escapeHtml(ch.name)}${isOwner?' 👑':''}${isAdmin?' ⭐':''}${isMuted?`<span class="muted-badge">禁言至${muteUntil}</span>`:''}</div><div style="font-size:11px;color:#8ba3c7;">${md?.title||'无头衔'}</div><label class="sync-memory-toggle"><input type="checkbox" ${md?.syncMemory?'checked':''} onchange="window._toggleSyncMemory('${mid}', this.checked)">同步单人对话记忆</label></div><div class="group-member-actions">${mid !== g.ownerId ? `<button class="small-btn" onclick="window._setGroupAdmin('${mid}')">${isAdmin?'取消管理':'设管理'}</button><button class="small-btn" onclick="window._transferOwner('${mid}')">转让群主</button><button class="small-btn" onclick="window._setMemberTitle('${mid}')">头衔</button><button class="small-btn" onclick="window._showMuteModal('${mid}','${window.escapeHtml(ch.name)}')">${isMuted?'解除禁言':'禁言'}</button><button class="small-btn danger" onclick="window._kickMember('${mid}')">踢出</button>` : '<span style="font-size:11px;color:#8ba3c7;">群主</span>'}</div></div>`;
        }
        mc.innerHTML = h || '<div class="empty-state">暂无成员</div>';
        const nc = document.getElementById('groupNPCList');
        const npcs = await window.DB.queryByIndex('groupNPCs', 'groupId', id);
        nc.innerHTML = npcs.map(n => `<div class="group-member-item" style="background:#f0edf7;">
            <div class="group-member-avatar" style="background:#9b59b6;${n.avatar?`background-image:url('${n.avatar}');background-size:cover;`:''}">${n.avatar?'':'🤖'}</div>
            <div class="group-member-info"><div class="group-member-name">${window.escapeHtml(n.name)} <span style="font-size:10px;color:#9b59b6;">NPC</span>${String(n.id)===String(g?.ownerId)?' 👑':''}${g?.adminIds?.some(x=>String(x)===String(n.id))?' ⭐':''}</div><div style="font-size:11px;color:#8ba3c7;">${window.escapeHtml((n.detail||'').substring(0,30))}...</div></div>
            <div class="group-member-actions">${String(n.id)!==String(g?.ownerId) ? `<button class="small-btn" onclick="window._setGroupAdmin('${n.id}')">${g?.adminIds?.some(x=>String(x)===String(n.id))?'取消管理':'设管理'}</button><button class="small-btn" onclick="window._transferOwner('${n.id}')">转让群主</button><button class="small-btn" onclick="window._setMemberTitle('${n.id}')">头衔</button><button class="small-btn" onclick="window._showMuteModal('${n.id}','${window.escapeHtml(n.name)}')">禁言</button><button class="small-btn danger" onclick="window._kickMember('${n.id}')">踢出</button>` : '<span style="font-size:11px;color:#8ba3c7;">群主</span>'}<button class="small-btn" onclick="window._editGroupNPC(${n.id})">✏️</button></div></div>`).join('');
        updateGroupDetailWorldbookStatus();
        updateGroupDetailEmoticonStatus();
        window.switchPage('group-detail');
    }
    async function updateGroupDetailWorldbookStatus() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        const el = document.getElementById('groupWorldbookStatus');
        if (el && g) { const count = (g.worldbookIds || []).length;
            el.textContent = count > 0 ? `已挂载 ${count} 本世界书` : '点击挂载按钮设置'; }
    }
    async function updateGroupDetailEmoticonStatus() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        const el = document.getElementById('groupEmoticonMountStatus');
        if (el && g) { const count = (g.emoticonGroupIds || []).length;
            el.textContent = count > 0 ? `已挂载 ${count} 个表情包分组` : '点击挂载按钮设置'; }
    }
    async function saveGroupDetail() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        g.name = document.getElementById('groupDetailName').value.trim();
        g.plot = document.getElementById('groupDetailPlot').value.trim();
        g.avatar = document.getElementById('groupAvatarData').value;
        g.bgImage = document.getElementById('groupBgData').value;
        await window.DB.put('groupChats', g);
        document.getElementById('groupConversationTitle').textContent = g.name;
        window.showStatus('✅ 已保存', 'success');
    }
    // 成员操作（挂载到 window）
    window._toggleSyncMemory = async function(mid, checked) {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        if (!g.members) g.members = [];
        let md = g.members.find(m => m.id === mid);
        if (!md) { md = { id: mid, title: '', syncMemory: false };
            g.members.push(md); }
        md.syncMemory = checked;
        await window.DB.put('groupChats', g);
    };
    window._setGroupAdmin = async function(cid) {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        if (!g.adminIds) g.adminIds = [];
        const cidStr = String(cid);
        if (g.adminIds.some(x => String(x) === cidStr)) g.adminIds = g.adminIds.filter(x => String(x) !== cidStr);
        else g.adminIds.push(cidStr);
        await window.DB.put('groupChats', g);
        await openGroupDetail();
    };
    window._transferOwner = async function(cid) {
        const id = window.currentGroupId;
        if (!id) return;
        if (!confirm('确定转让群主吗？')) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        g.ownerId = String(cid);
        await window.DB.put('groupChats', g);
        await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: '群主已转让', messageType: 'system', type: 'system', timestamp: Date.now() });
        await openGroupDetail();
    };
    window._setMemberTitle = async function(cid) {
        const id = window.currentGroupId;
        if (!id) return;
        const t = prompt('头衔（15字内）：');
        if (t === null) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        if (!g.members) g.members = [];
        const cidStr = String(cid);
        let md = g.members.find(m => String(m.id) === cidStr);
        if (!md) { md = { id: cidStr, title: '', syncMemory: false };
            g.members.push(md); }
        md.title = t.slice(0, 15);
        await window.DB.put('groupChats', g);
        const mask = await window.getActiveMask();
        const targetName = await getMemberName(cidStr, g);
        await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: `${mask?.name||'我'} 授予 ${targetName} 头衔「${t.slice(0,15)}」`, messageType: 'system', type: 'system', timestamp: Date.now() });
        await openGroupDetail();
    };
    window._showMuteModal = function(mid, name) { showMuteModal(String(mid), name); };
    window._kickMember = async function(cid) {
        const id = window.currentGroupId;
        if (!id) return;
        if (!confirm('确定踢出？')) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        g.memberIds = g.memberIds.filter(x => String(x) !== String(cid));
        await window.DB.put('groupChats', g);
        await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: '成员已移出群聊', messageType: 'system', type: 'system', timestamp: Date.now() });
        await openGroupDetail();
    };
    window._editGroupNPC = async function(nid) {
        const npc = await window.DB.get('groupNPCs', nid);
        if (npc) {
            document.getElementById('groupNPCEditTitle').textContent = '编辑NPC';
            document.getElementById('groupNPCEditId').value = npc.id;
            document.getElementById('groupNPCName').value = npc.name;
            document.getElementById('groupNPCDetail').value = npc.detail || '';
            document.getElementById('npcAvatarData').value = npc.avatar || '';
            const preview = document.getElementById('npcAvatarPreview');
            if (npc.avatar) { preview.style.backgroundImage = `url('${npc.avatar}')`;
                preview.style.backgroundColor = 'transparent';
                preview.textContent = ''; } else { preview.style.backgroundImage = '';
                preview.style.backgroundColor = '#9b59b6';
                preview.textContent = '🤖'; }
            document.getElementById('deleteGroupNPCBtn').style.display = 'inline-block';
            document.getElementById('groupNPCEditModal').classList.add('active');
        }
    };
    async function getMemberName(cidStr, g) {
        const ch = await window.DB.get('characters', cidStr);
        if (ch) return ch.name;
        try { const npc = await window.DB.get('groupNPCs', parseInt(cidStr)); if (npc) return npc.name; } catch(e) {}
        return '未知成员';
    }
    function showMuteModal(memberId, memberName) {
        document.getElementById('muteMemberId').value = memberId;
        document.getElementById('muteMemberName').textContent = '禁言：' + memberName;
        document.getElementById('muteDuration').value = 30;
        document.getElementById('muteMemberModal').classList.add('active');
    }
    async function confirmMuteMember() {
        const id = window.currentGroupId;
        const memberId = document.getElementById('muteMemberId').value;
        const duration = parseInt(document.getElementById('muteDuration').value);
        if (!id || !memberId) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        if (!g.mutedMembers) g.mutedMembers = {};
        const key = String(memberId);
        const mask = await window.getActiveMask();
        const targetName = await getMemberName(key, g);
        const executorName = mask?.name || '我';
        if (duration <= 0) { delete g.mutedMembers[key]; await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: `${executorName} 解除了 ${targetName} 的禁言`, messageType: 'system', type: 'system', timestamp: Date.now() }); } else { g.mutedMembers[key] = Date.now() + duration * 60 * 1000; await window.DB.put('groupMessages', { groupId: id, senderId: 'system', senderName: '系统', role: 'system', content: `${executorName} 将 ${targetName} 禁言 ${duration} 分钟`, messageType: 'system', type: 'system', timestamp: Date.now() }); }
        await window.DB.put('groupChats', g);
        document.getElementById('muteMemberModal').classList.remove('active');
        await openGroupDetail();
    }

    // ========== 世界书挂载 ==========
    async function showGroupWorldbookModal() {
    const id = window.currentGroupId;
    if (!id) return;

    const g = await window.DB.get('groupChats', id);
    const allWorldbooks = await window.DB.getAll('worldbooks');
    const selectedIds = g?.worldbookIds || [];
    const container = document.getElementById('groupWorldbookList');

    if (!container) return;

    if (allWorldbooks.length === 0) {
        container.innerHTML = `
            <p style="color:#a0a8a2;padding:12px;">暂无世界书</p>
        `;
        document.getElementById('groupWorldbookModal').classList.add('active');
        return;
    }

    const groupMap = {};
    allWorldbooks.forEach(wb => {
        const groupName = wb.group || '未分组';
        if (!groupMap[groupName]) groupMap[groupName] = [];
        groupMap[groupName].push(wb);
    });

    const groupNames = Object.keys(groupMap).sort((a, b) => {
        if (a === '未分组') return 1;
        if (b === '未分组') return -1;
        return a.localeCompare(b, 'zh-CN');
    });

    const chevronSvg = `
        <svg class="wb-mount-group-icon" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
    `;

    const bookSvg = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
    `;

    let html = `
        <div class="wb-priority-hint">
            当前群聊详情中的勾选状态优先级最高：勾选为强制挂载，取消为强制屏蔽。未设置时，才使用世界书底部的场景规则。
        </div>
    `;

    groupNames.forEach(groupName => {
        const list = groupMap[groupName].sort((a, b) => {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });

        const checkedCount = list.filter(wb => selectedIds.includes(wb.id)).length;
        const collapsedClass = checkedCount > 0 ? '' : 'collapsed';

        html += `
            <div class="wb-mount-group ${collapsedClass}" data-wb-group="${window.escapeHtml(groupName)}">
                <div class="wb-mount-group-header">
                    ${chevronSvg}
                    <span style="display:inline-flex;color:#4a5568;">${bookSvg}</span>
                    <span class="wb-mount-group-title">${window.escapeHtml(groupName)}</span>
                    <span class="wb-mount-group-count">${checkedCount}/${list.length}</span>
                </div>
                <div class="wb-mount-group-body">
        `;

        list.forEach(wb => {
            const checked = selectedIds.includes(wb.id) ? 'checked' : '';
            const depth = wb.injectDepth || 'before';
            const kwCount = (wb.triggerKeywords || []).length;

            html += `
                <label class="mount-checkbox wb-mount-checkbox" style="align-items:flex-start;">
                    <input type="checkbox" value="${wb.id}" class="group-wb-checkbox" ${checked}>
                    <div style="flex:1;min-width:0;">
                        <div class="wb-mount-title">${window.escapeHtml(wb.title || '未命名世界书')}</div>
                        <div class="wb-mount-preview">
                            ${window.escapeHtml((wb.content || '').substring(0, 70))}${(wb.content || '').length > 70 ? '...' : ''}
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
                            <span class="wb-badge-depth">${window.escapeHtml(depth)}</span>
                            ${kwCount > 0 ? `<span class="wb-badge-kw">${kwCount} kw</span>` : ''}
                            ${wb.group === 'HTML' ? `<span class="wb-badge-html">HTML</span>` : ''}
                        </div>
                    </div>
                </label>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.wb-mount-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.wb-mount-group');
            group.classList.toggle('collapsed');
        });
    });

    container.querySelectorAll('.group-wb-checkbox').forEach(cb => {
        cb.addEventListener('click', e => {
            e.stopPropagation();
        });

        cb.addEventListener('change', () => {
            const group = cb.closest('.wb-mount-group');
            if (!group) return;

            const all = group.querySelectorAll('.group-wb-checkbox');
            const checked = group.querySelectorAll('.group-wb-checkbox:checked');
            const countEl = group.querySelector('.wb-mount-group-count');

            if (countEl) {
                countEl.textContent = `${checked.length}/${all.length}`;
            }
        });
    });

    document.getElementById('groupWorldbookModal').classList.add('active');
}

    async function saveGroupWorldbook() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const ids = [];
const overrides = {};

document.querySelectorAll('.group-wb-checkbox').forEach(cb => {
    const wbId = cb.value;

    if (cb.checked) {
        ids.push(wbId);
        overrides[wbId] = true;
    } else {
        overrides[wbId] = false;
    }
});

g.worldbookIds = ids;
g.worldbookMountOverrides = overrides;

await window.DB.put('groupChats', g);
        document.getElementById('groupWorldbookModal').classList.remove('active');
        window.showStatus('✅ 世界书挂载已保存', 'success');
        updateGroupDetailWorldbookStatus();
    }

    // ========== 表情包挂载 ==========
    async function showGroupEmoticonMountModal() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        const groups = await window.DB.getAll('emoticonGroups');
        const selectedIds = g?.emoticonGroupIds || [];
        const container = document.getElementById('groupEmoticonMountList');
        container.innerHTML = groups.length === 0 ? '<p style="color:#a0a8a2;padding:12px;">暂无表情包分组</p>' : groups.map(grp => `<label class="mount-checkbox"><input type="checkbox" value="${grp.id}" class="group-em-checkbox" ${selectedIds.includes(grp.id)?'checked':''}><span>😊 ${window.escapeHtml(grp.name)}</span></label>`).join('');
        document.getElementById('groupEmoticonMountModal').classList.add('active');
    }
    async function saveGroupEmoticonMount() {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const ids = [];
        document.querySelectorAll('.group-em-checkbox:checked').forEach(cb => ids.push(cb.value));
        g.emoticonGroupIds = ids;
        await window.DB.put('groupChats', g);
        document.getElementById('groupEmoticonMountModal').classList.remove('active');
        window.showStatus('✅ 表情包挂载已保存', 'success');
        updateGroupDetailEmoticonStatus();
    }

    // ========== 表情包 Section ==========
    async function buildEmoticonSection() {
        const id = window.currentGroupId;
        if (!id) return '';
        const g = await window.DB.get('groupChats', id);
        const mountedIds = g?.emoticonGroupIds || [];
        if (mountedIds.length === 0) return '';
        let allItems = [];
        for (const gid of mountedIds) {
            const items = await window.DB.queryByIndex('emoticonItems', 'groupId', gid);
            allItems.push(...items);
        }
        if (allItems.length === 0) return '';
        let section = '\n\n【可用表情包】\n你可以使用以下表情包来表达情绪。格式：[MSG]表情包:文字说明\n';
        const seen = new Set();
        allItems.forEach(item => {
            if (item.text && !seen.has(item.text)) {
                seen.add(item.text);
                section += `- ${item.text}\n`;
            }
        });
        return section;
    }

    // ========== 群聊表情包选择器 ==========
    async function renderGroupEmoticonPicker() {
        const id = window.currentGroupId;
        const g = id ? await window.DB.get('groupChats', id) : null;
        const allGs = await window.DB.getAll('emoticonGroups');
        const mountedIds = g?.emoticonGroupIds || [];
        const gs = mountedIds.length > 0 ? allGs.filter(grp => mountedIds.includes(grp.id)) : allGs;
        const tc = document.getElementById('groupEmoticonPickerTabs');
        if (!tc) return;
        tc.innerHTML = gs.length ? gs.map((g, i) => `<button class="emoticon-picker-tab ${i===0?'active':''}" data-gid="${g.id}">${window.escapeHtml(g.name)}</button>`).join('') : '<span style="font-size:12px;color:#a0a8a2;padding:8px;">未挂载表情包</span>';
        tc.querySelectorAll('.emoticon-picker-tab').forEach(t => t.addEventListener('click', async () => {
            tc.querySelectorAll('.emoticon-picker-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            await renderGroupPickerGrid(t.dataset.gid);
        }));
        if (gs.length > 0) await renderGroupPickerGrid(gs[0].id);
        else { const grid = document.getElementById('groupEmoticonPickerGrid'); if (grid) grid.innerHTML = '<div style="text-align:center;padding:20px;color:#a0a8a2;">请先在群聊详情中挂载表情包</div>'; }
    }
    async function renderGroupPickerGrid(gid) {
        const grid = document.getElementById('groupEmoticonPickerGrid');
        if (!grid) return;
        const items = await window.DB.queryByIndex('emoticonItems', 'groupId', gid);
        grid.innerHTML = items.length ? items.map(it => `<div class="emoticon-picker-item" data-iid="${it.id}"><img src="${it.url}" onerror="this.style.display='none'"><div class="emoticon-picker-item-text">${window.escapeHtml(it.text||'无说明')}</div></div>`).join('') : '<div style="text-align:center;padding:20px;color:#a0a8a2;">暂无</div>';
        grid.querySelectorAll('.emoticon-picker-item').forEach(el => el.addEventListener('click', async () => {
            const it = await window.DB.get('emoticonItems', parseInt(el.dataset.iid));
            if (it) { await sendGroupEmoticonMsg(it);
                document.getElementById('groupEmoticonPicker').classList.remove('active');
                groupEmoticonPickerOpen = false; }
        }));
    }
    function toggleGroupEmoticonPicker() {
        groupEmoticonPickerOpen = !groupEmoticonPickerOpen;
        const p = document.getElementById('groupEmoticonPicker');
        if (!p) return;
        if (groupEmoticonPickerOpen) { renderGroupEmoticonPicker();
            p.classList.add('active'); } else p.classList.remove('active');
    }
    async function sendGroupEmoticonMsg(item) {
        const id = window.currentGroupId;
        if (!id) return;
        const g = await window.DB.get('groupChats', id);
        if (!g) return;
        const mask = await window.getActiveMask();
        await window.DB.put('groupMessages', { groupId: id, senderId: 'user', senderName: mask?.name || '我', role: 'user', content: JSON.stringify({ url: item.url, text: item.text }), messageType: 'emoticon', timestamp: Date.now() });
        g.updatedAt = Date.now();
        await window.DB.put('groupChats', g);
        await loadGroupMessages(id);
    }

    // ========== 新建群聊流程 ==========
    async function showNewGroupFlow() {
        const convs = await window.DB.getAll('conversations');
        const mid = await window.DB.getSetting('activeUserProfileId');
        const filteredConvs = mid ? convs.filter(c => c.maskId === mid) : convs;
        const lst = document.getElementById('multiSelectContactList');
        let h = '';
        for (const conv of filteredConvs) {
            const ch = await window.DB.get('characters', conv.charId);
            if (!ch) continue;
            const convDetail = await window.DB.get('convDetails', conv.id);
            const displayName = convDetail?.charName || ch.name;
            const avatar = convDetail?.charAvatar || ch.avatar || '';
            const avatarStyle = avatar ? `background-image:url('${avatar}');background-size:cover;` : `background:${window.getAvatarColor(displayName)};`;
            h += `<div class="multi-select-item" data-cid="${conv.charId}" data-conv-id="${conv.id}"><div class="check-box">✓</div><div class="avatar" style="width:36px;height:36px;${avatarStyle}font-size:14px;">${avatar?'':displayName[0]}</div><div>${window.escapeHtml(displayName)}</div></div>`;
        }
        lst.innerHTML = h || '<div class="empty-state">暂无已建立的对话</div>';
        lst.querySelectorAll('.multi-select-item').forEach(el => { el.addEventListener('click', () => { el.classList.toggle('selected'); }); });
        document.getElementById('multiSelectContactsModal').classList.add('active');
    }
    async function confirmMultiSelect() {
        const sel = document.querySelectorAll('#multiSelectContactList .multi-select-item.selected');
        if (!sel.length) { window.showStatus('请至少选择一位', 'error'); return; }
        window._selMembers = Array.from(sel).map(el => ({ cid: el.dataset.cid, convId: el.dataset.convId }));
        document.getElementById('multiSelectContactsModal').classList.remove('active');
        const mask = await window.getActiveMask();
        document.getElementById('groupSetupName').value = '';
        document.getElementById('setupParticipateYes').classList.add('selected');
        document.getElementById('setupParticipateNo').classList.remove('selected');
        const os = document.getElementById('groupSetupOwner');
        os.innerHTML = '<option value="user">' + (mask?.name || '我') + '</option>';
        for (const member of window._selMembers) { const ch = await window.DB.get('characters', member.cid); if (ch) os.innerHTML += '<option value="' + member.cid + '">' + ch.name + '</option>'; }
        document.getElementById('groupSetupModal').classList.add('active');
    }
    async function confirmGroupSetup() {
        const name = document.getElementById('groupSetupName').value.trim();
        if (!name) { window.showStatus('请输入群聊名称', 'error'); return; }
        const sel = window._selMembers || [];
        const mids = sel.map(s => s.cid);
        const isParticipate = document.getElementById('setupParticipateYes').classList.contains('selected');
        const owner = document.getElementById('groupSetupOwner').value;
        const mask = await window.getActiveMask();
        const membersWithAvatar = [];
        for (const s of sel) {
            const convDetail = await window.DB.get('convDetails', parseInt(s.convId));
            const ch = await window.DB.get('characters', s.cid);
            membersWithAvatar.push({ id: s.cid, convId: s.convId, title: '', syncMemory: false, avatar: convDetail?.charAvatar || ch?.avatar || '' });
        }
        const g = { name, memberIds: mids, isUserParticipating: isParticipate, ownerId: owner, adminIds: [], maskId: mask?.id || '', mode: 'online', plot: '', avatar: '', worldbookIds: [], emoticonGroupIds: [], mutedMembers: {}, members: membersWithAvatar, createdAt: Date.now(), updatedAt: Date.now() };
        await window.DB.put('groupChats', g);
        document.getElementById('groupSetupModal').classList.remove('active');
        window._selMembers = null;
        if (typeof refreshConversationList === 'function') await refreshConversationList();
        window.showStatus('✅ 群聊创建成功', 'success');
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
        document.getElementById('chooseNewGroupBtn')?.addEventListener('click', showNewGroupFlow);
        document.getElementById('cancelMultiSelectBtn')?.addEventListener('click', () => document.getElementById('multiSelectContactsModal').classList.remove('active'));
        document.getElementById('confirmMultiSelectBtn')?.addEventListener('click', confirmMultiSelect);
        document.getElementById('cancelGroupSetupBtn')?.addEventListener('click', () => document.getElementById('groupSetupModal').classList.remove('active'));
        document.getElementById('confirmGroupSetupBtn')?.addEventListener('click', confirmGroupSetup);
        document.getElementById('setupParticipateYes')?.addEventListener('click', async () => {
            document.getElementById('setupParticipateYes').classList.add('selected');
            document.getElementById('setupParticipateNo').classList.remove('selected');
            const os = document.getElementById('groupSetupOwner');
            if (!os.querySelector('option[value="user"]')) {
                const mask = await window.getActiveMask();
                const opt = document.createElement('option');
                opt.value = 'user';
                opt.textContent = mask?.name || '我';
                os.insertBefore(opt, os.firstChild);
            }
        });
        document.getElementById('setupParticipateNo')?.addEventListener('click', () => {
            document.getElementById('setupParticipateNo').classList.add('selected');
            document.getElementById('setupParticipateYes').classList.remove('selected');
            const os = document.getElementById('groupSetupOwner');
            const userOption = os.querySelector('option[value="user"]');
            if (userOption) userOption.remove();
        });
        document.getElementById('groupSendBtn')?.addEventListener('click', sendGroupMsg);
        document.getElementById('groupFetchBtn')?.addEventListener('click', fetchGroupAIReply);
        document.getElementById('groupMessageInput')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendGroupMsg(); });
        document.getElementById('groupDetailBtn')?.addEventListener('click', openGroupDetail);
        document.getElementById('cancelRedPacketBtn')?.addEventListener('click', () => document.getElementById('groupRedPacketModal').classList.remove('active'));
        document.getElementById('confirmRedPacketBtn')?.addEventListener('click', confirmRedPacket);
        document.getElementById('cancelTransferTargetBtn')?.addEventListener('click', () => document.getElementById('groupTransferTargetModal').classList.remove('active'));
        document.getElementById('rpTypeMulti')?.addEventListener('click', () => { rpMode = 'multi';
            document.getElementById('rpTypeMulti').classList.add('selected');
            document.getElementById('rpTypeSingle').classList.remove('selected');
            document.getElementById('rpMultiSettings').style.display = '';
            document.getElementById('rpSingleSettings').style.display = 'none'; });
        document.getElementById('rpTypeSingle')?.addEventListener('click', async () => { rpMode = 'single';
            document.getElementById('rpTypeSingle').classList.add('selected');
            document.getElementById('rpTypeMulti').classList.remove('selected');
            document.getElementById('rpMultiSettings').style.display = 'none';
            document.getElementById('rpSingleSettings').style.display = ''; const g = await window.DB.get('groupChats', window.currentGroupId); if (g) { const s = document.getElementById('rpSingleTarget');
                s.innerHTML = '';
                g.memberIds.forEach(async mid => { const ch = await window.DB.get('characters', mid); if (ch) s.innerHTML += `<option value="${mid}">${ch.name}</option>`; }); } });
        document.getElementById('rpModeNormal')?.addEventListener('click', () => { document.getElementById('rpModeNormal').classList.add('selected');
            document.getElementById('rpModeLucky').classList.remove('selected'); });
        document.getElementById('rpModeLucky')?.addEventListener('click', () => { document.getElementById('rpModeLucky').classList.add('selected');
            document.getElementById('rpModeNormal').classList.remove('selected'); });
        document.getElementById('saveGroupDetailBtn')?.addEventListener('click', saveGroupDetail);
        document.getElementById('groupWorldbookBtn')?.addEventListener('click', showGroupWorldbookModal);
        document.getElementById('groupWorldbookCancelBtn')?.addEventListener('click', () => document.getElementById('groupWorldbookModal').classList.remove('active'));
        document.getElementById('groupWorldbookSaveBtn')?.addEventListener('click', saveGroupWorldbook);
        document.getElementById('groupEmoticonMountBtn')?.addEventListener('click', showGroupEmoticonMountModal);
        document.getElementById('groupEmoticonMountCancelBtn')?.addEventListener('click', () => document.getElementById('groupEmoticonMountModal').classList.remove('active'));
        document.getElementById('groupEmoticonMountSaveBtn')?.addEventListener('click', saveGroupEmoticonMount);
        document.getElementById('muteMemberCancelBtn')?.addEventListener('click', () => document.getElementById('muteMemberModal').classList.remove('active'));
        document.getElementById('muteMemberConfirmBtn')?.addEventListener('click', confirmMuteMember);
        document.getElementById('groupSummaryCloseBtn')?.addEventListener('click', () => { document.getElementById('groupSummaryModal').classList.remove('active');
            document.getElementById('groupSummaryList').innerHTML = ''; });
        document.getElementById('groupSummaryAutoFillBtn')?.addEventListener('click', groupSummaryAutoFill);
        document.getElementById('groupSummaryGenerateBtn')?.addEventListener('click', generateGroupSummary);
        document.getElementById('groupQuotePreviewClose')?.addEventListener('click', clearQuote);
        document.getElementById('groupExpandMenuBtn')?.addEventListener('click', () => {
            const menu = document.getElementById('groupExpandMenu');
            const g = window.DB.get('groupChats', window.currentGroupId).then(g => {
                if (!g) { menu.classList.toggle('active'); return; }
                if (g.isUserParticipating) {
                    menu.innerHTML = `<div class="expand-menu-item" data-action="groupVoice"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span><span class="expand-menu-label">语音</span></div><div class="expand-menu-item" data-action="groupImage"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></span><span class="expand-menu-label">图片</span></div><div class="expand-menu-item" data-action="groupEmoticon"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></span><span class="expand-menu-label">表情</span></div><div class="expand-menu-item" data-action="groupToggleMode"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></span><span class="expand-menu-label">见面</span></div><div class="expand-menu-item" data-action="groupTransfer"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span><span class="expand-menu-label">转账</span></div><div class="expand-menu-item" data-action="groupRedPacket"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="18" height="20" rx="3"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="10" r="3"/></svg></span><span class="expand-menu-label">发红包</span></div><div class="expand-menu-item" data-action="groupSummary"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span><span class="expand-menu-label">总结</span></div><div class="expand-menu-item" data-action="groupOpenDetail"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="expand-menu-label">详情</span></div>`;
                } else {
                    menu.innerHTML = `<div class="expand-menu-item" data-action="groupSummary"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span><span class="expand-menu-label">总结</span></div><div class="expand-menu-item" data-action="groupOpenDetail"><span class="expand-menu-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></span><span class="expand-menu-label">详情</span></div>`;
                }
                bindExpandMenuActions();
                menu.classList.toggle('active');
            });
        });
                // === 群聊头像 ===
        document.getElementById('groupAvatarUploadBtn')?.addEventListener('click', () => document.getElementById('groupAvatarFile').click());
        document.getElementById('groupAvatarFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const dataUrl = await window.compressImage(file, 200, 200, 0.8);
            document.getElementById('groupAvatarData').value = dataUrl;
            const preview = document.getElementById('groupAvatarPreview');
            preview.style.backgroundImage = `url('${dataUrl}')`;
            preview.style.backgroundColor = 'transparent';
            preview.textContent = '';
        });
        document.getElementById('groupAvatarUrlBtn')?.addEventListener('click', () => {
            const url = prompt('群聊头像URL:'); if (url) {
                document.getElementById('groupAvatarData').value = url;
                const preview = document.getElementById('groupAvatarPreview');
                preview.style.backgroundImage = `url('${url}')`;
                preview.style.backgroundColor = 'transparent';
                preview.textContent = '';
            }
        });
        document.getElementById('groupAvatarClearBtn')?.addEventListener('click', () => {
            document.getElementById('groupAvatarData').value = '';
            const preview = document.getElementById('groupAvatarPreview');
            preview.style.backgroundImage = '';
            preview.style.backgroundColor = '#5cb85c';
            preview.textContent = '群';
        });

        // === 群聊背景 ===
        document.getElementById('groupBgUploadBtn')?.addEventListener('click', () => document.getElementById('groupBgFile').click());
        document.getElementById('groupBgFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const dataUrl = await window.compressImage(file, 800, 600, 0.7);
            document.getElementById('groupBgData').value = dataUrl;
            document.getElementById('groupBgPreview').style.backgroundImage = `url('${dataUrl}')`;
        });
        document.getElementById('groupBgUrlBtn')?.addEventListener('click', () => {
            const url = prompt('背景图片URL:'); if (url) {
                document.getElementById('groupBgData').value = url;
                document.getElementById('groupBgPreview').style.backgroundImage = `url('${url}')`;
            }
        });
        document.getElementById('groupBgClearBtn')?.addEventListener('click', () => {
            document.getElementById('groupBgData').value = '';
            document.getElementById('groupBgPreview').style.backgroundImage = '';
        });

        // === NPC头像 ===
        document.getElementById('npcAvatarUploadBtn')?.addEventListener('click', () => document.getElementById('npcAvatarFile').click());
        document.getElementById('npcAvatarFile')?.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            const dataUrl = await window.compressImage(file, 200, 200, 0.8);
            document.getElementById('npcAvatarData').value = dataUrl;
            const preview = document.getElementById('npcAvatarPreview');
            preview.style.backgroundImage = `url('${dataUrl}')`;
            preview.style.backgroundColor = 'transparent';
            preview.textContent = '';
        });
        document.getElementById('npcAvatarUrlBtn')?.addEventListener('click', () => {
            const url = prompt('NPC头像URL:'); if (url) {
                document.getElementById('npcAvatarData').value = url;
                const preview = document.getElementById('npcAvatarPreview');
                preview.style.backgroundImage = `url('${url}')`;
                preview.style.backgroundColor = 'transparent';
                preview.textContent = '';
            }
        });
        document.getElementById('npcAvatarClearBtn')?.addEventListener('click', () => {
            document.getElementById('npcAvatarData').value = '';
            const preview = document.getElementById('npcAvatarPreview');
            preview.style.backgroundImage = '';
            preview.style.backgroundColor = '#9b59b6';
            preview.textContent = '🤖';
        });

        // === NPC 编辑 ===
        document.getElementById('addGroupNPCBtn')?.addEventListener('click', () => {
            document.getElementById('groupNPCEditTitle').textContent = '添加NPC';
            document.getElementById('groupNPCEditId').value = '';
            document.getElementById('groupNPCName').value = '';
            document.getElementById('groupNPCDetail').value = '';
            document.getElementById('npcAvatarData').value = '';
            document.getElementById('deleteGroupNPCBtn').style.display = 'none';
            const preview = document.getElementById('npcAvatarPreview');
            preview.style.backgroundImage = '';
            preview.style.backgroundColor = '#9b59b6';
            preview.textContent = '🤖';
            document.getElementById('groupNPCEditModal').classList.add('active');
        });
        document.getElementById('saveGroupNPCBtn')?.addEventListener('click', async () => {
            const nid = document.getElementById('groupNPCEditId').value;
            const name = document.getElementById('groupNPCName').value.trim();
            const avatar = document.getElementById('npcAvatarData').value;
            if (!name) return;
            if (nid) {
                const npc = await window.DB.get('groupNPCs', parseInt(nid));
                if (npc) { npc.name = name; npc.avatar = avatar; npc.detail = document.getElementById('groupNPCDetail').value.trim(); await window.DB.put('groupNPCs', npc); }
            } else {
                const newNPC = { groupId: window.currentGroupId, name, avatar, detail: document.getElementById('groupNPCDetail').value.trim(), createdAt: Date.now() };
                await window.DB.put('groupNPCs', newNPC);
                const g = await window.DB.get('groupChats', window.currentGroupId);
                if (g) {
                    const allNPCs = await window.DB.queryByIndex('groupNPCs', 'groupId', window.currentGroupId);
                    const npcIds = allNPCs.map(n => n.id).sort((a,b) => b - a);
                    const npcId = npcIds[0];
                    if (npcId && !g.memberIds.some(mid => String(mid) === String(npcId))) {
                        g.memberIds.push(String(npcId));
                        if (!g.members) g.members = [];
                        g.members.push({ id: String(npcId), title: '', syncMemory: false, avatar: avatar });
                        await window.DB.put('groupChats', g);
                    }
                }
            }
            document.getElementById('groupNPCEditModal').classList.remove('active');
            openGroupDetail();
        });
        document.getElementById('cancelGroupNPCBtn')?.addEventListener('click', () => document.getElementById('groupNPCEditModal').classList.remove('active'));
        document.getElementById('deleteGroupNPCBtn')?.addEventListener('click', async () => {
            if (!confirm('确定删除？')) return;
            await window.DB.delete('groupNPCs', parseInt(document.getElementById('groupNPCEditId').value));
            document.getElementById('groupNPCEditModal').classList.remove('active');
            openGroupDetail();
        });
    }
    function bindExpandMenuActions() {
        document.querySelectorAll('#groupExpandMenu .expand-menu-item').forEach(el => el.addEventListener('click', () => {
            const a = el.dataset.action;
            document.getElementById('groupExpandMenu').classList.remove('active');
            if (a === 'groupToggleMode') toggleGroupMode();
            if (a === 'groupTransfer') groupTransfer();
            if (a === 'groupRedPacket') showRedPacketModal();
            if (a === 'groupSummary') showGroupSummaryModal();
            if (a === 'groupOpenDetail') openGroupDetail();
            if (a === 'groupEmoticon') toggleGroupEmoticonPicker();
            if (a === 'groupVoice') {
    const c = prompt('语音内容：');
    if (c) {
        window.DB.put('groupMessages', {
            groupId: window.currentGroupId,
            senderId: 'user',
            senderName: '我',
            role: 'user',
            content: c,
            messageType: 'voice',
            timestamp: Date.now()
        });
        loadGroupMessages(window.currentGroupId);
    }
}

if (a === 'groupImage') {
    const d = prompt('图片描述：');
    if (d) {
        window.DB.put('groupMessages', {
            groupId: window.currentGroupId,
            senderId: 'user',
            senderName: '我',
            role: 'user',
            content: d,
            messageType: 'image',
            timestamp: Date.now()
        });
        loadGroupMessages(window.currentGroupId);
    }
}
        }));
    }

    // ========== 暴露到 window ==========
    window.openGroupConversation = openGroupConversation;
    window.loadGroupMessages = loadGroupMessages;
    window.openGroupDetail = openGroupDetail;
    window.fetchGroupAIReply = fetchGroupAIReply;
    window.buildGroupOnlinePrompt = buildGroupOnlinePrompt;
    window.buildGroupOfflinePrompt = buildGroupOfflinePrompt;
    window.showGroupSummaryModal = showGroupSummaryModal;
    window.showNewGroupFlow = showNewGroupFlow;
    window.showGroupWorldbookModal = showGroupWorldbookModal;
    window.showGroupEmoticonMountModal = showGroupEmoticonMountModal;
    window.showMuteModal = showMuteModal;
    window.showRedPacketModal = showRedPacketModal;
    window.groupTransfer = groupTransfer;
    window.toggleGroupMode = toggleGroupMode;
    window.toggleGroupEmoticonPicker = toggleGroupEmoticonPicker;

    // ========== 初始化（暴露给 index.html 调用）==========
    async function initGroupChatModule() {
        await ensureGroupStores();
        bindEvents();
        console.log('✅ 群聊模块初始化完成');
    }
    window.initGroupChatModule = initGroupChatModule;
})();


/* ================================================================
 * message-favorites-enhance
 * 功能：
 * 1. 单聊 / 群聊 / 线上 / 线下工具栏 SVG 化
 * 2. 增加收藏按钮
 * 3. 我的页增加“收藏”入口
 * 4. 收藏随当前面具切换
 * 5. 收藏页支持搜索、按对话查看、渲染 HTML 卡片
 * ================================================================ */
(function() {
    "use strict";

    const FAV_VERSION = 1;

    const ICONS = {
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        reback: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
        delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        multi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="m15 18 2 2 4-5"/></svg>',
        favorite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
        star: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 14.39 8.26 21 9.27 16 13.97 17.18 20.5 12 17.27 6.82 20.5 8 13.97 3 9.27 9.61 8.26 12 2"/></svg>',
        close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
        mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
    };

    const TOOLBAR_MAP = [
        { cls: 'edit-msg-btn', label: '编辑', icon: ICONS.edit },
        { cls: 'reback-btn', label: '重回', icon: ICONS.reback },
        { cls: 'delete-msg-btn', label: '删除', icon: ICONS.delete },
        { cls: 'multi-select-btn', label: '多选', icon: ICONS.multi },
        { cls: 'favorite-msg-btn', label: '收藏', icon: ICONS.favorite }
    ];

    function esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s ?? '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    }

    function show(msg, type = 'info') {
        if (window.showStatus) window.showStatus(msg, type);
        else console.log(msg);
    }

    async function getMaskId() {
        try {
            const mask = window.getActiveMask ? await window.getActiveMask() : null;
            return mask?.id || await window.DB.getSetting('activeUserProfileId', 'default') || 'default';
        } catch (e) {
            return 'default';
        }
    }

    async function favKey() {
        return 'messageFavorites_' + await getMaskId();
    }

    async function getFavorites() {
        const key = await favKey();
        const arr = await window.DB.getSetting(key, []);
        return Array.isArray(arr) ? arr : [];
    }

    async function saveFavorites(arr) {
        const key = await favKey();
        await window.DB.setSetting(key, arr);
    }

    function setBtn(btn, icon, label) {
        if (!btn) return;
        btn.innerHTML = `${icon}<span class="tb-label">${label}</span>`;
        btn.title = label;
    }

    function ensureToolbarFavoriteAndSvg(toolbar) {
        if (!toolbar || toolbar.dataset.favNormalized === '1') return;
        toolbar.dataset.favNormalized = '1';

        if (!toolbar.querySelector('.favorite-msg-btn')) {
            const favBtn = document.createElement('button');
            favBtn.className = 'toolbar-btn favorite-msg-btn';
            favBtn.type = 'button';

            const anyBtn = toolbar.querySelector('.toolbar-btn');
            if (anyBtn?.dataset.idx) favBtn.dataset.idx = anyBtn.dataset.idx;
            if (anyBtn?.dataset.index) favBtn.dataset.index = anyBtn.dataset.index;
            if (anyBtn?.dataset.offlineIndex) favBtn.dataset.offlineIndex = anyBtn.dataset.offlineIndex;

            toolbar.appendChild(favBtn);
        }

        TOOLBAR_MAP.forEach(item => {
            toolbar.querySelectorAll('.' + item.cls).forEach(btn => setBtn(btn, item.icon, item.label));
        });

        // 重新排序：编辑、重回、删除、多选、收藏
        TOOLBAR_MAP.forEach(item => {
            const btn = toolbar.querySelector('.' + item.cls);
            if (btn) toolbar.appendChild(btn);
        });
    }

    function normalizeAllToolbars(root = document) {
        root.querySelectorAll('.bubble-toolbar').forEach(ensureToolbarFavoriteAndSvg);
    }

    function startToolbarObserver() {
        normalizeAllToolbars();

        const obs = new MutationObserver(mutations => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (!(node instanceof Element)) return;
                    if (node.classList?.contains('bubble-toolbar')) ensureToolbarFavoriteAndSvg(node);
                    normalizeAllToolbars(node);
                });
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });
    }

    async function getSingleTitle(convId) {
        const conv = await window.DB.get('conversations', convId);
        if (!conv) return '未知对话';
        const char = await window.DB.get('characters', conv.charId);
        const detail = await window.DB.get('convDetails', convId);
        return detail?.charName || char?.name || '未知对话';
    }

    async function getGroupTitle(groupId) {
        const g = await window.DB.get('groupChats', groupId);
        return g?.name || '未知群聊';
    }

    function getContainerScope(el) {
        if (el.closest('#groupChatMessages')) return 'group';
        if (el.closest('#convChatMessages')) return 'single';
        return '';
    }

    async function collectFavoriteFromButton(btn) {
        const scope = getContainerScope(btn);
        if (!scope) return null;

        if (scope === 'group') {
            const row = btn.closest('.group-message-row') || btn.closest('[data-offline-msg-id]');
            if (!row) return null;

            const msgId = parseInt(row.dataset.msgId || row.dataset.offlineMsgId || '');
            if (!msgId) return null;

            const msg = await window.DB.get('groupMessages', msgId);
            if (!msg) return null;

            const groupId = msg.groupId || window.currentGroupId;
            const group = await window.DB.get('groupChats', groupId);
            const title = await getGroupTitle(groupId);

            return {
                id: `group:${groupId}:${msgId}`,
                version: FAV_VERSION,
                scope: 'group',
                chatId: groupId,
                chatTitle: title,
                mode: group?.mode || 'online',
                msgId,
                senderName: msg.senderName || '',
                senderId: msg.senderId || '',
                role: msg.role || '',
                messageType: msg.messageType || msg.type || 'text',
                content: msg.content || '',
                sourceTimestamp: msg.timestamp || Date.now(),
                favoritedAt: Date.now()
            };
        }

        if (scope === 'single') {
            const row = btn.closest('.message-row') || btn.closest('[data-offline-msg-id]');
            if (!row) return null;

            const msgId = parseInt(row.dataset.messageId || row.dataset.offlineMsgId || '');
            if (!msgId) return null;

            const msg = await window.DB.get('chats', msgId);
            if (!msg) return null;

            const convId = msg.conversationId || window.currentConversationId;
            const conv = await window.DB.get('conversations', convId);
            const title = await getSingleTitle(convId);

            return {
                id: `single:${convId}:${msgId}`,
                version: FAV_VERSION,
                scope: 'single',
                chatId: convId,
                chatTitle: title,
                mode: conv?.mode || 'online',
                msgId,
                senderName: msg.role === 'user' ? '我' : title,
                senderId: msg.role || '',
                role: msg.role || '',
                messageType: msg.messageType || 'text',
                content: msg.content || '',
                sourceTimestamp: msg.timestamp || Date.now(),
                favoritedAt: Date.now()
            };
        }

        return null;
    }

    async function addFavoriteFromButton(btn) {
        if (!window.DB) return;

        const fav = await collectFavoriteFromButton(btn);
        if (!fav) {
            show('无法收藏这条消息', 'error');
            return;
        }

        const arr = await getFavorites();
        const exists = arr.some(x => x.id === fav.id);

        if (exists) {
            show('这条消息已经收藏过了', 'info');
            return;
        }

        arr.unshift(fav);
        await saveFavorites(arr);
        show('已收藏', 'success');
    }

    function bindFavoriteToolbarClick() {
        document.addEventListener('click', async e => {
            const btn = e.target.closest('.favorite-msg-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            await addFavoriteFromButton(btn);
            btn.closest('.bubble-toolbar')?.classList.remove('show');
        }, true);
    }

    function injectProfileEntry() {
        if (document.getElementById('favoriteMessagesEntryBtn')) return;

        const emoticonEntry = document.getElementById('emoticonEntryBtn');
        if (!emoticonEntry || !emoticonEntry.parentNode) return;

        const item = document.createElement('div');
        item.className = 'menu-item clickable profile-favorites-entry';
        item.id = 'favoriteMessagesEntryBtn';
        item.innerHTML = `
            <span class="menu-icon">${ICONS.star}</span>
            <span class="menu-text">收藏</span>
        `;

        emoticonEntry.parentNode.insertBefore(item, emoticonEntry);
        item.addEventListener('click', openFavoriteModal);
    }

    function ensureFavoriteModal() {
        let modal = document.getElementById('favoriteMessagesModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'favoriteMessagesModal';
        modal.className = 'favorite-modal';
        modal.innerHTML = `
            <div class="favorite-panel">
                <div class="favorite-header">
                    <button class="favorite-back" id="favoriteBackBtn" style="display:none;">${ICONS.back}</button>
                    <div class="favorite-title" id="favoritePanelTitle">收藏</div>
                    <button class="favorite-close" id="favoriteCloseBtn">${ICONS.close}</button>
                </div>
                <div class="favorite-search-wrap" id="favoriteSearchWrap">
                    <input class="favorite-search" id="favoriteSearchInput" placeholder="搜索收藏消息或对话...">
                </div>
                <div class="favorite-body" id="favoriteBody"></div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#favoriteCloseBtn').addEventListener('click', closeFavoriteModal);
        modal.querySelector('#favoriteBackBtn').addEventListener('click', () => renderFavoriteConversationList());
        modal.addEventListener('click', e => {
            if (e.target === modal) closeFavoriteModal();
        });
        modal.querySelector('#favoriteSearchInput').addEventListener('input', () => renderFavoriteConversationList());

        return modal;
    }

    function closeFavoriteModal() {
        document.getElementById('favoriteMessagesModal')?.classList.remove('show');
    }

    async function openFavoriteModal() {
        ensureFavoriteModal().classList.add('show');
        await renderFavoriteConversationList();
    }

    function previewText(fav) {
        const type = fav.messageType;
        if (type === 'image') return '[图片] ' + (fav.content || '');
        if (type === 'voice') return '[语音] ' + (fav.content || '');
        if (type === 'html_card') return '[HTML卡片]';
        if (type === 'emoticon') {
            try {
                const p = JSON.parse(fav.content || '{}');
                return '[表情包] ' + (p.text || '');
            } catch (e) {
                return '[表情包]';
            }
        }
        return String(fav.content || '').replace(/<[^>]+>/g, '').slice(0, 80);
    }

    async function renderFavoriteConversationList() {
        const modal = ensureFavoriteModal();
        const body = modal.querySelector('#favoriteBody');
        const title = modal.querySelector('#favoritePanelTitle');
        const back = modal.querySelector('#favoriteBackBtn');
        const search = modal.querySelector('#favoriteSearchInput');

        title.textContent = '收藏';
        back.style.display = 'none';
        search.style.display = '';

        const q = (search.value || '').trim().toLowerCase();
        const arr = await getFavorites();

        const filtered = arr.filter(f => {
            if (!q) return true;
            const hay = [
                f.chatTitle,
                f.senderName,
                f.messageType,
                previewText(f),
                f.content
            ].join(' ').toLowerCase();
            return hay.includes(q);
        });

        const map = new Map();
        filtered.forEach(f => {
            const key = f.scope + ':' + f.chatId;
            if (!map.has(key)) {
                map.set(key, {
                    scope: f.scope,
                    chatId: f.chatId,
                    title: f.chatTitle || '未知对话',
                    items: []
                });
            }
            map.get(key).items.push(f);
        });

        const groups = Array.from(map.values())
            .sort((a, b) => Math.max(...b.items.map(x => x.favoritedAt || 0)) - Math.max(...a.items.map(x => x.favoritedAt || 0)));

        if (!groups.length) {
            body.innerHTML = '<div class="favorite-empty">暂无收藏</div>';
            return;
        }

        body.innerHTML = groups.map(g => {
            const latest = g.items[0];
            return `
                <div class="favorite-conv-item" data-scope="${g.scope}" data-chat-id="${g.chatId}">
                    <div class="favorite-conv-title">
                        <span>${esc(g.title)}</span>
                        <span class="favorite-conv-count">${g.items.length}</span>
                    </div>
                    <div class="favorite-conv-preview">${esc(previewText(latest))}</div>
                </div>
            `;
        }).join('');

        body.querySelectorAll('.favorite-conv-item').forEach(item => {
            item.addEventListener('click', async () => {
                await renderFavoriteDetail(item.dataset.scope, item.dataset.chatId);
            });
        });
    }

    function formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function renderFavoriteContent(fav) {
        const type = fav.messageType || 'text';
        const content = fav.content || '';

        if (type === 'html_card') {
            if (window.buildSafeHtmlCardIframe) {
                return `<div class="favorite-html-card-wrap">${window.buildSafeHtmlCardIframe(content)}</div>`;
            }
            const safe = window.wbE ? window.wbE.sanitize(content) : esc(content);
            return `<div class="favorite-html-card-wrap">${safe}</div>`;
        }

        if (type === 'image') {
            return `
                <div class="favorite-msg-image">
                    ${ICONS.image}
                    <span>${esc(content)}</span>
                </div>
            `;
        }

        if (type === 'voice') {
            return `
                <div class="favorite-msg-voice">
                    ${ICONS.mic}
                    <span>${esc(content)}</span>
                </div>
            `;
        }

        if (type === 'emoticon') {
            let url = '', text = '';
            try {
                const p = JSON.parse(content);
                url = p.url || '';
                text = p.text || '';
            } catch (e) {
                text = content;
            }

            return `
                <div class="favorite-msg-emoticon">
                    ${url ? `<img src="${esc(url)}" alt="${esc(text)}">` : ''}
                    <div class="favorite-msg-text">${esc(text)}</div>
                </div>
            `;
        }

        if (type === 'transfer' || type === 'redpacket' || content.includes('gg-transfer-card') || content.includes('gg-redpacket-card')) {
            return `<div>${content}</div>`;
        }

        if (type === 'offline_card' || fav.mode === 'offline' || type === 'offline') {
            return `<div class="favorite-msg-text favorite-msg-offline">${esc(content)}</div>`;
        }

        return `<div class="favorite-msg-text">${esc(content)}</div>`;
    }

    async function deleteFavorite(favId) {
        const arr = await getFavorites();
        await saveFavorites(arr.filter(f => f.id !== favId));
    }

    async function renderFavoriteDetail(scope, chatId) {
        const modal = ensureFavoriteModal();
        const body = modal.querySelector('#favoriteBody');
        const title = modal.querySelector('#favoritePanelTitle');
        const back = modal.querySelector('#favoriteBackBtn');
        const search = modal.querySelector('#favoriteSearchInput');

        back.style.display = '';
        search.style.display = 'none';

        const arr = await getFavorites();
        const list = arr
            .filter(f => f.scope === scope && String(f.chatId) === String(chatId))
            .sort((a, b) => (a.sourceTimestamp || 0) - (b.sourceTimestamp || 0));

        const chatTitle = list[0]?.chatTitle || '收藏详情';
        title.textContent = chatTitle;

        if (!list.length) {
            body.innerHTML = '<div class="favorite-empty">这个对话暂无收藏</div>';
            return;
        }

        body.innerHTML = list.map(f => `
            <div class="favorite-msg-card" data-fav-id="${esc(f.id)}">
                <div class="favorite-msg-meta">
                    <div>
                        <span class="favorite-msg-sender">${esc(f.senderName || '')}</span>
                        <span class="favorite-source-tag">${f.scope === 'group' ? '群聊' : '单聊'} · ${f.mode === 'offline' ? '线下' : '线上'}</span>
                    </div>
                    <div>
                        <span>${formatTime(f.sourceTimestamp)}</span>
                        <button class="favorite-msg-delete" data-fav-id="${esc(f.id)}">删除</button>
                    </div>
                </div>
                ${renderFavoriteContent(f)}
            </div>
        `).join('');

        body.querySelectorAll('.favorite-msg-delete').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                if (!confirm('确定取消收藏这条消息吗？')) return;
                await deleteFavorite(btn.dataset.favId);
                await renderFavoriteDetail(scope, chatId);
            });
        });

        if (window.setupHtmlCardIframes) {
            setTimeout(() => window.setupHtmlCardIframes(body), 50);
        }
    }

    function bootstrapFavorites() {
        injectProfileEntry();
        ensureFavoriteModal();
        startToolbarObserver();
        bindFavoriteToolbarClick();

        // 我的页可能后续重渲染，补一次
        const profile = document.getElementById('page-profile');
        if (profile) {
            const obs = new MutationObserver(() => injectProfileEntry());
            obs.observe(profile, { childList: true, subtree: true });
        }

        console.log('✅ 消息收藏模块已加载');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrapFavorites);
    } else {
        bootstrapFavorites();
    }
})();

/* ================================================================
 * offline-control-enhance
 * 功能：
 * 1. 单聊详情页增加「线下控制」
 * 2. 群聊详情页增加「线下控制」
 * 3. 控制线下回复最大字数、char视角、user视角、额外写作要求
 * 数据：
 * - 单聊：convDetails.offlineControl
 * - 群聊：groupChats.offlineControl
 * ================================================================ */
(function() {
    "use strict";

    const OC_ICON = {
        edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
        eye: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
        text: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
        pen: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
    };

    const DEFAULT_CONTROL = {
        maxChars: 1200,
        charPerspective: "third",
        userPerspective: "second",
        writingRequirement: ""
    };
    
    let injectingSingleOfflineControl = false;
let injectingGroupOfflineControl = false;

    function esc(s) {
        if (window.escapeHtml) return window.escapeHtml(s);
        return String(s ?? '').replace(/[&<>"]/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[m]));
    }

    function icon(svg) {
        return `<span class="offline-control-icon">${svg}</span>`;
    }

    function clampMaxChars(v) {
        let n = parseInt(v);
        if (isNaN(n)) n = DEFAULT_CONTROL.maxChars;
        return Math.max(100, Math.min(20000, n));
    }

    function normalizeControl(c) {
        return {
            maxChars: clampMaxChars(c?.maxChars),
            charPerspective: c?.charPerspective || DEFAULT_CONTROL.charPerspective,
            userPerspective: c?.userPerspective || DEFAULT_CONTROL.userPerspective,
            writingRequirement: c?.writingRequirement || ""
        };
    }
    
    function cleanupDuplicateOfflinePanels(root, type) {
    if (!root) return;

    const selector = `[data-offline-control="${type}"]`;
    root.querySelectorAll(selector).forEach(p => p.remove());
}

    function perspectiveOptions(value) {
        const opts = [
            { key: "first", label: "第一人称：我" },
            { key: "second", label: "第二人称：你" },
            { key: "third", label: "第三人称：她/他" }
        ];
        return opts.map(o => `<option value="${o.key}" ${value === o.key ? "selected" : ""}>${o.label}</option>`).join("");
    }

    function buildPanelHTML(control, prefix) {
        const c = normalizeControl(control);
        return `
            <div class="offline-control-section" data-offline-control="${prefix}">
                <h3>${icon(OC_ICON.eye)}<span>线下控制</span></h3>
                <div class="offline-control-hint">
                    这里控制线下模式下角色每轮回复的写法。设置会注入到 prompt 中，单聊和群聊线下模式都会遵守各自详情页里的配置。
                </div>

                <div class="offline-control-grid">
                    <div class="offline-control-field">
                        <label>${icon(OC_ICON.text)}<span style="margin-left:5px;">每轮线下回复最大字数</span></label>
                        <input type="number" id="${prefix}OfflineMaxChars" min="100" max="20000" step="50" value="${c.maxChars}">
                    </div>

                    <div class="offline-control-row-2">
                        <div class="offline-control-field">
                            <label>${icon(OC_ICON.eye)}<span style="margin-left:5px;">char 人称</span></label>
                            <select id="${prefix}OfflineCharPerspective">
                                ${perspectiveOptions(c.charPerspective)}
                            </select>
                        </div>

                        <div class="offline-control-field">
                            <label>${icon(OC_ICON.eye)}<span style="margin-left:5px;">user 人称</span></label>
                            <select id="${prefix}OfflineUserPerspective">
                                ${perspectiveOptions(c.userPerspective)}
                            </select>
                        </div>
                    </div>

                    <div class="offline-control-field">
                        <label>${icon(OC_ICON.pen)}<span style="margin-left:5px;">额外写作要求</span></label>
                        <textarea id="${prefix}OfflineWritingReq" placeholder="例如：更短句；多写环境细节；不要频繁写对话；更偏压抑氛围；减少抒情……">${esc(c.writingRequirement)}</textarea>
                    </div>
                </div>

                <div class="offline-control-save-tip">修改后会自动保存。</div>
            </div>
        `;
    }

    async function getSingleControl(convId) {
        const cd = await window.DB.get("convDetails", convId);
        return normalizeControl(cd?.offlineControl);
    }

    async function saveSingleControl(convId, control) {
        const oldDetail = await window.DB.get("convDetails", convId);
        const conv = await window.DB.get("conversations", convId);

        const next = {
            ...(oldDetail || {}),
            conversationId: convId,
            charId: oldDetail?.charId || conv?.charId,
            offlineControl: normalizeControl(control)
        };

        await window.DB.put("convDetails", next);
    }

    async function getGroupControl(groupId) {
        const g = await window.DB.get("groupChats", groupId);
        return normalizeControl(g?.offlineControl);
    }

    async function saveGroupControl(groupId, control) {
        const g = await window.DB.get("groupChats", groupId);
        if (!g) return;
        g.offlineControl = normalizeControl(control);
        await window.DB.put("groupChats", g);
    }

    function readPanel(prefix) {
        return normalizeControl({
            maxChars: document.getElementById(prefix + "OfflineMaxChars")?.value,
            charPerspective: document.getElementById(prefix + "OfflineCharPerspective")?.value,
            userPerspective: document.getElementById(prefix + "OfflineUserPerspective")?.value,
            writingRequirement: document.getElementById(prefix + "OfflineWritingReq")?.value || ""
        });
    }

    function bindPanel(prefix, saveFn) {
        const ids = [
            prefix + "OfflineMaxChars",
            prefix + "OfflineCharPerspective",
            prefix + "OfflineUserPerspective",
            prefix + "OfflineWritingReq"
        ];

        let timer = null;

        const doSave = () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                try {
                    await saveFn(readPanel(prefix));
                    if (window.showStatus) window.showStatus("线下控制已保存", "success");
                } catch (e) {
                    console.error("保存线下控制失败:", e);
                    if (window.showStatus) window.showStatus("保存失败：" + e.message, "error");
                }
            }, 250);
        };

        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.ocBound === "1") return;
            el.dataset.ocBound = "1";
            el.addEventListener("change", doSave);
            el.addEventListener("input", doSave);
        });
    }

async function injectSingleOfflineControl() {
    if (injectingSingleOfflineControl) return;
    injectingSingleOfflineControl = true;

    try {
        const page = document.getElementById("page-conv-detail");
        if (!page || !page.classList.contains("active")) return;

        const convId = window.currentEditingConvId;
        if (!convId || !window.DB) return;

        // 关键：先删除所有单聊线下控制，保证永远只剩一个
        cleanupDuplicateOfflinePanels(page, "single");

        const control = await getSingleControl(convId);
        const relationshipEl = document.getElementById("convDetailRelationship");
        const relationshipSection = relationshipEl ? relationshipEl.closest(".worldbook-section") : null;

        const html = buildPanelHTML(control, "single");

        if (relationshipSection && relationshipSection.parentNode) {
            relationshipSection.insertAdjacentHTML("afterend", html);
        } else {
            const scroll = page.querySelector('[style*="overflow-y:auto"]');
            if (scroll) scroll.insertAdjacentHTML("beforeend", html);
        }

        bindPanel("single", c => saveSingleControl(convId, c));
    } finally {
        injectingSingleOfflineControl = false;
    }
}

    async function injectGroupOfflineControl() {
    if (injectingGroupOfflineControl) return;
    injectingGroupOfflineControl = true;

    try {
        const page = document.getElementById("page-group-detail");
        if (!page || !page.classList.contains("active")) return;

        const groupId = window.currentGroupId;
        if (!groupId || !window.DB) return;

        // 关键：先删除所有群聊线下控制，保证永远只剩一个
        cleanupDuplicateOfflinePanels(page, "group");

        const control = await getGroupControl(groupId);
        const plotEl = document.getElementById("groupDetailPlot");
        const plotSection = plotEl ? plotEl.closest(".group-detail-section") : null;

        const html = buildPanelHTML(control, "group");

        if (plotSection && plotSection.parentNode) {
            plotSection.insertAdjacentHTML("afterend", html);
        } else {
            const scroll = page.querySelector('[style*="overflow-y:auto"]');
            if (scroll) scroll.insertAdjacentHTML("beforeend", html);
        }

        bindPanel("group", c => saveGroupControl(groupId, c));
    } finally {
        injectingGroupOfflineControl = false;
    }
}

    function syncPanelValues(prefix, control) {
        const c = normalizeControl(control);
        const maxEl = document.getElementById(prefix + "OfflineMaxChars");
        const charEl = document.getElementById(prefix + "OfflineCharPerspective");
        const userEl = document.getElementById(prefix + "OfflineUserPerspective");
        const reqEl = document.getElementById(prefix + "OfflineWritingReq");

        if (maxEl) maxEl.value = c.maxChars;
        if (charEl) charEl.value = c.charPerspective;
        if (userEl) userEl.value = c.userPerspective;
        if (reqEl) reqEl.value = c.writingRequirement;
    }

    async function onPageChange() {
        await injectSingleOfflineControl();
        await injectGroupOfflineControl();

        // 某些详情页内容会异步渲染，再补一次
        setTimeout(() => {
            injectSingleOfflineControl();
            injectGroupOfflineControl();
        }, 120);
    }

    function bootstrap() {
        onPageChange();

        const targets = [
            document.getElementById("page-conv-detail"),
            document.getElementById("page-group-detail")
        ].filter(Boolean);

        targets.forEach(page => {
    const obs = new MutationObserver(onPageChange);
    obs.observe(page, {
        attributes: true,
        attributeFilter: ["class"]
    });
});

        console.log("✅ 线下控制面板已加载");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
        bootstrap();
    }
})();