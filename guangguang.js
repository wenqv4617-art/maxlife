/* ================================================================
 * guangguang.js - 逛逛模块完整逻辑
 * 来源：3.0转账红包.html
 * 说明：包含首页搜索、商品详情、购买、购物车、消息、我的、
 *       转账卡片、红包卡片、AI主动发起(转账/红包/代付/送礼)
 *       所有卡片构建函数、AI交互逻辑
 * 依赖：window.DB, window.escapeHtml, window.getAvatarColor,
 *       window.showStatus, window.callLLM, window.recordApiPending,
 *       window.recordApiSuccess, window.compressImage,
 *       window.loadConversationMessages
 * ================================================================ */

(function initGuangGuang() {
    "use strict";
    console.log('🛍️ 逛逛模块初始化');

    // =================================================================
    // 逛逛内部状态
    // =================================================================
    const GG = {
        currentDetailGoods: null,
        currentPurchaseGoods: null,
        currentPurchaseIsGift: false,
        currentPurchaseGiftContactId: null,
        currentPurchasePayMethod: 'self',
        currentPurchaseTafuContactId: null,
        currentMsgShopId: null,
        currentMsgShopName: '',
        allGoods: [],
    };

    function $(id) { return document.getElementById(id); }

    // =================================================================
    // 逛逛数据库操作 (GDB)
    // =================================================================
    const GDB = {
        async getWallet() {
            try { return await window.DB.getSetting('gg_wallet_balance', 0); } catch (e) { return 0; }
        },
        async setWallet(amount) {
            try { await window.DB.setSetting('gg_wallet_balance', amount); } catch (e) {}
        },
        async getCart() {
            try { return await window.DB.getAll('guangguang_cart'); } catch (e) { return []; }
        },
        async addToCart(item) {
            try {
                const cart = await GDB.getCart();
                const exists = cart.find(c => c.goodsId === item.goodsId);
                if (exists) {
                    exists.quantity = (exists.quantity || 1) + 1;
                    await window.DB.put('guangguang_cart', exists);
                } else {
                    item.quantity = 1;
                    item.id = 'cart_' + Date.now();
                    await window.DB.put('guangguang_cart', item);
                }
                window._ggCartVisited = false;
                window.showStatus('✅ 已加入购物车', 'success');
            } catch (e) {
                window.showStatus('❌ 加入购物车失败', 'error');
            }
        },
        async removeFromCart(id) {
            try { await window.DB.delete('guangguang_cart', id); } catch (e) {}
        },
        async clearCart() {
            try {
                const cart = await GDB.getCart();
                for (const item of cart) { await window.DB.delete('guangguang_cart', item.id); }
            } catch (e) {}
        },
        async getOrders() {
            try { return await window.DB.getAll('guangguang_orders'); } catch (e) { return []; }
        },
        async addOrder(order) {
            try {
                order.id = 'order_' + Date.now();
                order.createdAt = Date.now();
                await window.DB.put('guangguang_orders', order);
                return order;
            } catch (e) { return null; }
        },
        async getMsgConversations() {
            try { return await window.DB.getAll('guangguang_msg_convs'); } catch (e) { return []; }
        },
        async getOrCreateMsgConv(shopId, shopName) {
            try {
                const convs = await GDB.getMsgConversations();
                let conv = convs.find(c => c.shopId === shopId);
                if (!conv) {
                    window._ggMsgVisited = false;
                    conv = {
                        id: 'ggconv_' + Date.now(),
                        shopId,
                        shopName,
                        lastMessage: '',
                        updatedAt: Date.now()
                    };
                    await window.DB.put('guangguang_msg_convs', conv);
                }
                return conv;
            } catch (e) { return null; }
        },
        async getMessages(convId) {
            try {
                const msgs = await window.DB.getAll('guangguang_messages');
                return msgs.filter(m => m.conversationId === convId).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            } catch (e) { return []; }
        },
        async addMessage(msg) {
            try {
                msg.id = 'ggmsg_' + Date.now();
                msg.timestamp = Date.now();
                await window.DB.put('guangguang_messages', msg);
                return msg;
            } catch (e) { return null; }
        },
    };

    // =================================================================
    // 逛逛子页面切换
    // =================================================================
    function switchGGPage(pageId) {
        ['gg-home', 'gg-cart', 'gg-messages', 'gg-mine', 'gg-detail', 'gg-purchase', 'gg-msg-detail'].forEach(id => {
            const el = $(id);
            if (el) { el.classList.remove('active');
                el.style.display = 'none'; }
        });
        const target = $(pageId);
        if (target) { target.classList.add('active');
            target.style.display = 'flex'; }

        if (['gg-home', 'gg-cart', 'gg-messages', 'gg-mine'].includes(pageId)) {
            const navMap = { 'gg-home': 'home', 'gg-cart': 'cart', 'gg-messages': 'messages', 'gg-mine': 'mine' };
            document.querySelectorAll('.gg-nav-item').forEach(item => {
                const isActive = item.dataset.ggNav === navMap[pageId];
                item.classList.toggle('active', isActive);
                item.style.color = isActive ? '#ff4400' : '#999';
                const iconDiv = item.querySelector('div:first-child');
                if (iconDiv) {
                    iconDiv.style.background = isActive ? '#ff4400' : 'transparent';
                    iconDiv.style.color = isActive ? '#fff' : '';
                    iconDiv.style.borderRadius = isActive ? '50%' : '0';
                }
            });
            const bottomNav = document.querySelector('#page-guangguang > div:last-child');
            if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
        }
        if (pageId === 'gg-cart') { window._ggCartVisited = true;
            renderCart(); }
        if (pageId === 'gg-messages') { window._ggMsgVisited = true;
            renderMsgList(); }
        if (pageId === 'gg-mine') renderMine();
    }

    // =================================================================
    // 首页：搜索商品
    // =================================================================
    async function searchGoods(keyword) {
        if (!keyword || !keyword.trim()) { window.showStatus('请输入搜索关键词', 'info'); return; }
        window.showStatus('🔍 正在搜索...', 'info');
        window.recordApiPending();
        try {
            const prompt = `你是一个电商搜索助手。用户搜索"${keyword.trim()}"，请生成6个相关商品，严格按以下JSON格式返回（不要其他文字）：\n{\n  "goods": [\n    {\n      "id": "商品唯一ID",\n      "name": "商品名称",\n      "image": "https://picsum.photos/400/400?random=数字(1-100)",\n      "price": 价格数字(元),\n      "detail": "商品详情描述(50-100字)",\n      "shopName": "店铺名称",\n      "shopId": "shop_数字"\n    }\n  ]\n}`;
            const response = await window.callLLM([{ role: 'user', content: prompt }]);
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('AI返回格式异常');
            const data = JSON.parse(jsonMatch[0]);
            if (!data.goods || !Array.isArray(data.goods)) throw new Error('商品数据为空');
            GG.allGoods = data.goods;
            renderGoodsGrid(GG.allGoods);
            window.showStatus(`✅ 找到 ${data.goods.length} 个商品`, 'success');
        } catch (e) { window.showStatus(`❌ 搜索失败: ${e.message}`, 'error'); }
    }

    function renderGoodsGrid(goods) {
        const grid = $('gg-goods-grid');
        if (!grid) return;
        if (!goods || goods.length === 0) {
            grid.innerHTML = '<div class="gg-empty">没有找到相关商品</div>';
            return;
        }
        grid.innerHTML = goods.map(g => `
            <div class="goods-card clickable" data-goods-id="${g.id}">
                <div class="goods-img" style="background-image:url('${g.image || 'https://picsum.photos/300/400?random=1'}')"></div>
                <div class="goods-info">
                    <div class="goods-name">${window.escapeHtml(g.name)}</div>
                    <div class="goods-price">¥${g.price}</div>
                </div>
            </div>
        `).join('');
        grid.querySelectorAll('.goods-card').forEach(card => {
            card.addEventListener('click', () => {
                const goods = GG.allGoods.find(g => g.id === card.dataset.goodsId);
                if (goods) openGoodsDetail(goods);
            });
        });
    }

    // =================================================================
    // 商品详情页
    // =================================================================
    function openGoodsDetail(goods) {
        GG.currentDetailGoods = goods;
        $('gg-detail-image').style.backgroundImage = `url('${goods.image || 'https://picsum.photos/400/400?random=1'}')`;
        $('gg-detail-name').textContent = goods.name;
        $('gg-detail-price').textContent = '¥' + goods.price;
        $('gg-detail-desc').textContent = goods.detail || '暂无详情';
        $('gg-detail-shop').textContent = goods.shopName || '未知店铺';
        const bottomNav = document.querySelector('#page-guangguang > div:last-child');
        if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'none';
        switchGGPage('gg-detail');
    }

    // =================================================================
    // 购买页
    // =================================================================
    function openPurchase(goods, isGift = false) {
        GG.currentPurchaseGoods = goods;
        GG.currentPurchaseIsGift = isGift;
        GG.currentPurchaseGiftContactId = null;
        GG.currentPurchasePayMethod = 'self';
        GG.currentPurchaseTafuContactId = null;
        $('gg-purchase-image').style.backgroundImage = `url('${goods.image || 'https://picsum.photos/400/400?random=1'}')`;
        $('gg-purchase-name').textContent = goods.name;
        $('gg-purchase-desc').textContent = goods.detail || '';
        $('gg-purchase-price').textContent = '¥' + goods.price;
        $('gg-pay-amount').textContent = goods.price;
        $('gg-gift-toggle').textContent = isGift ? '✅ 已开启送礼' : '开启送礼 >';
        $('gg-gift-selector').style.display = isGift ? 'block' : 'none';
        updatePayButtons('self');
        $('gg-tafu-selector').style.display = 'none';
        const bottomNav = document.querySelector('#page-guangguang > div:last-child');
        if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'none';
        switchGGPage('gg-purchase');
    }

    function updatePayButtons(method) {
        document.querySelectorAll('.gg-pay-btn').forEach(btn => {
            const isActive = btn.dataset.pay === method;
            btn.classList.toggle('active', isActive);
            btn.style.borderColor = isActive ? '#ff4400' : '#e0e0e0';
            btn.style.background = isActive ? '#fff5f0' : '#fff';
            btn.style.color = isActive ? '#ff4400' : '#666';
        });
    }

    // =================================================================
    // 联系人选择器
    // =================================================================
    async function renderContactList(containerId, callback) {
        const container = $(containerId);
        if (!container) return;
        try {
            const conversations = await window.DB.getAll('conversations');
            if (!conversations.length) {
                container.innerHTML = '<div style="padding:10px;color:#999;">暂无可用联系人</div>';
                return;
            }
            let html = '';
            for (const conv of conversations) {
                const char = await window.DB.get('characters', conv.charId);
                const convDetail = await window.DB.get('convDetails', conv.id);
                const displayName = convDetail?.charName || char?.name || '未知';
                const displayAvatar = convDetail?.charAvatar || char?.avatar || '';
                const avatarStyle = displayAvatar ?
                    `style="background-image:url('${displayAvatar}');background-size:cover;background-position:center;"` :
                    `style="background:${window.getAvatarColor(displayName)};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:18px;"`;
                html += `
                    <div class="gg-contact-item" data-conv-id="${conv.id}" data-char-id="${conv.charId}" data-name="${window.escapeHtml(displayName)}">
                        <div class="gg-contact-avatar" ${avatarStyle}>${displayAvatar ? '' : displayName.charAt(0)}</div>
                        <span class="gg-contact-name">${window.escapeHtml(displayName)}</span>
                    </div>`;
            }
            container.innerHTML = html;
            container.querySelectorAll('.gg-contact-item').forEach(item => {
                item.addEventListener('click', () => {
                    callback({
                        convId: parseInt(item.dataset.convId) || item.dataset.convId,
                        charId: item.dataset.charId,
                        name: item.dataset.name
                    });
                });
            });
        } catch (e) {
            container.innerHTML = '<div style="padding:10px;color:#999;">加载失败</div>';
        }
    }

    // =================================================================
    // 确认支付
    // =================================================================
    async function handleSettle() {
        const goods = GG.currentPurchaseGoods;
        if (!goods) return;
        const payMethod = GG.currentPurchasePayMethod;
        const isGift = GG.currentPurchaseIsGift;

        if (payMethod === 'self' && !isGift) {
            const balance = await GDB.getWallet();
            if (balance < goods.price) { window.showStatus('❌ 余额不足，请先充值', 'error'); return; }
            await GDB.setWallet(balance - goods.price);
            await GDB.addOrder({ items: [goods], total: goods.price, status: 'paid', payMethod: 'self' });
            alert('✅ 购买成功！');
            const bottomNav1 = document.querySelector('#page-guangguang > div:last-child');
            if (bottomNav1 && bottomNav1.querySelector('.gg-nav-item')) bottomNav1.style.display = 'flex';
            switchGGPage('gg-mine');
            renderOrderList();
            renderCartBadge();
            return;
        }
        if (isGift && GG.currentPurchaseGiftContactId) { showGiftModal(goods); return; }
        if (payMethod === 'other') {
            if (!GG.currentPurchaseTafuContactId) { window.showStatus('❌ 请选择代付联系人', 'error'); return; }
            showTafuModal(goods);
        }
    }

    // =================================================================
    // 代付卡片弹窗
    // =================================================================
    function showTafuModal(goods) {
        $('gg-tafu-modal-goods').textContent = goods.name;
        $('gg-tafu-modal-price').textContent = '总价：¥' + goods.price;
        $('gg-tafu-modal-msg').value = '';
        $('gg-tafu-modal').style.display = 'flex';
    }

    function hideTafuModal() { $('gg-tafu-modal').style.display = 'none'; }

    async function confirmTafuCard() {
        const goods = GG.currentPurchaseGoods;
        if (!goods) return;
        const message = $('gg-tafu-modal-msg').value.trim() || '';
        hideTafuModal();
        await GDB.addOrder({ items: [goods], total: goods.price, status: 'pending_pay', payMethod: 'other', tafuFrom: GG.currentPurchaseTafuContactId, tafuMessage: message });
        const cardContent = buildTafuCardHTML(goods, message, 'pending');
        const conversations = await window.DB.getAll('conversations');
        const conv = conversations.find(c => c.id == GG.currentPurchaseTafuContactId);
        if (conv) {
            await window.DB.put('chats', { role: 'user', content: cardContent, messageType: 'transfer', conversationId: GG.currentPurchaseTafuContactId, charId: conv.charId, timestamp: Date.now() });
            window.showStatus('✅ 代付卡片已发送', 'success');
            await fetchTafuAIReply(conv, goods, message);
        }
        const bottomNav = document.querySelector('#page-guangguang > div:last-child');
        if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
        switchGGPage('gg-mine');
        renderOrderList();
        renderCartBadge();
    }

    function buildTafuCardHTML(goods, message, status) {
        const statusText = status === 'paid' ? '已支付' : status === 'rejected' ? '对方拒绝付款' : '待支付 · 未付款';
        const statusColor = status === 'paid' ? '#4caf50' : status === 'rejected' ? '#999' : '#e05f47';
        const cardBg = status === 'rejected' ? 'rgba(200,200,200,0.3)' : 'rgba(255,255,255,0.22)';
        const textColor = status === 'rejected' ? '#999' : '';
        return `<div style="width:88%;max-width:88%;padding:28px 28px;background:${cardBg};backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,0.35);border-radius:10px;box-shadow:0 3px 10px rgba(224,140,100,0.12);text-align:center;margin:0 auto;line-height:1.2;">
            <div style="font-size:14px;font-weight:700;color:#7a4f3b;margin-bottom:4px;">请你帮我付</div>
            <div style="font-size:11px;color:${textColor || '#6b4b3c'};margin-bottom:1px;">${window.escapeHtml(goods.name)}</div>
            <div style="font-size:12px;font-weight:600;color:${textColor || '#c26a49'};margin-bottom:4px;">总价：¥${goods.price}</div>
            ${message ? `<div style="font-size:10px;color:${textColor || '#94725f'};margin-bottom:2px;">"${window.escapeHtml(message)}"</div>` : ''}
            <div style="height:1px;background:linear-gradient(90deg,transparent,#d89b7a,transparent);margin:3px 0;opacity:0.7;"></div>
            <div style="font-size:11px;font-weight:600;color:${statusColor};">${statusText}</div>
        </div>`;
    }

    async function fetchTafuAIReply(conv, goods, message) {
        window.showStatus('🤖 等待对方回应...', 'info');
        try {
            const char = await window.DB.get('characters', conv.charId);
            const systemPrompt = `【角色设定】你是${char.name}。${char.detail || ''}\n\n【重要事件】用户向你发送了一个代付请求，请你帮他支付"${goods.name}"，价格¥${goods.price}。${message ? `留言："${message}"` : ''}\n\n请自主决定是否同意代付。先表达你的想法（同意或拒绝，理由要符合角色性格），然后明确说"我同意代付"或"我拒绝代付"。回复要简短自然。`;
            const reply = await window.callLLM([{ role: 'system', content: systemPrompt }, { role: 'user', content: `帮我付一下这个：${goods.name}，¥${goods.price}` }]);
            const agree = reply.includes('同意代付') || reply.includes('帮你付') || reply.includes('没问题') || reply.includes('好的');
            const reject = reply.includes('拒绝代付') || reply.includes('不付') || reply.includes('不行') || reply.includes('不能');
            const willPay = agree && !reject;
            const status = willPay ? 'paid' : 'rejected';
            const updatedCard = buildTafuCardHTML(goods, message, status);
            await window.DB.put('chats', { role: 'assistant', content: reply, messageType: 'text', conversationId: conv.id, charId: conv.charId, timestamp: Date.now() + 1 });
            await window.DB.put('chats', { role: 'assistant', content: updatedCard, messageType: 'transfer', conversationId: conv.id, charId: conv.charId, timestamp: Date.now() + 2 });
            if (willPay) {
                const orders = await GDB.getOrders();
                const lastOrder = orders.sort((a, b) => b.createdAt - a.createdAt)[0];
                if (lastOrder && lastOrder.status === 'pending_pay') { lastOrder.status = 'paid';
                    await window.DB.put('guangguang_orders', lastOrder); }
            }
            window.showStatus(`✅ 对方${willPay ? '已同意' : '拒绝'}代付`, 'success');
        } catch (e) { window.showStatus(`❌ ${e.message}`, 'error'); }
    }

    // =================================================================
    // 礼物卡片弹窗
    // =================================================================
    function showGiftModal(goods) {
        $('gg-gift-modal-goods').textContent = '商品名称：' + goods.name;
        $('gg-gift-modal-price').textContent = '商品价格：¥' + goods.price;
        $('gg-gift-modal').style.display = 'flex';
    }

    function hideGiftModal() { $('gg-gift-modal').style.display = 'none'; }

    async function confirmGiftCard() {
        const goods = GG.currentPurchaseGoods;
        if (!goods) return;
        hideGiftModal();
        const balance = await GDB.getWallet();
        if (balance < goods.price) { window.showStatus('❌ 余额不足，请先充值', 'error'); return; }
        await GDB.setWallet(balance - goods.price);
        await GDB.addOrder({ items: [goods], total: goods.price, status: 'gifted', payMethod: 'self', isGift: true, giftTo: GG.currentPurchaseGiftContactId });
        const cardContent = buildGiftCardHTML(goods);
        const conversations = await window.DB.getAll('conversations');
        const conv = conversations.find(c => c.id == GG.currentPurchaseGiftContactId);
        if (conv) {
            await window.DB.put('chats', { role: 'user', content: cardContent, messageType: 'transfer', conversationId: GG.currentPurchaseGiftContactId, charId: conv.charId, timestamp: Date.now() });
            window.showStatus('✅ 礼物已送出', 'success');
            await fetchGiftAIReply(conv, goods);
        }
        const bottomNav = document.querySelector('#page-guangguang > div:last-child');
        if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
        switchGGPage('gg-mine');
        renderOrderList();
        renderCartBadge();
    }

    function buildGiftCardHTML(goods) {
        return `<div style="width:88%;max-width:88%;padding:28px 28px;background:rgba(255,255,255,0.25);backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.4);border-radius:10px;box-shadow:0 4px 12px rgba(230,160,120,0.15);text-align:center;margin:0 auto;position:relative;overflow:hidden;line-height:1.2;">
            <div style="position:absolute;top:0;right:10px;width:24px;height:32px;background:linear-gradient(180deg,#f8b9a2,#f3a88c);clip-path:polygon(0 0,100% 0,100% 75%,50% 100%,0 75%);border-radius:0 0 3px 3px;opacity:0.85;"></div>
            <div style="font-size:15px;font-weight:700;color:#8c5e48;margin-bottom:6px;font-family:'Georgia','Times New Roman',serif;font-style:italic;letter-spacing:2px;">Gift</div>
            <div style="padding:5px 8px;background:rgba(255,255,255,0.15);border-radius:8px;border:1px solid rgba(255,255,255,0.3);margin-bottom:6px;text-align:left;">
                <div style="font-size:11px;color:#795847;margin-bottom:2px;">商品名称：${window.escapeHtml(goods.name)}</div>
                <div style="font-size:12px;font-weight:600;color:#d47c5e;">商品价格：¥${goods.price}</div>
            </div>
            <div style="height:1px;background:linear-gradient(90deg,transparent,#e5b8a1,transparent);margin:4px 0;opacity:0.75;"></div>
            <div style="font-size:10px;color:#94725f;">愿这份美好，温柔赠予你 ✨</div>
        </div>`;
    }

    async function fetchGiftAIReply(conv, goods) {
        window.showStatus('🤖 等待对方回应...', 'info');
        try {
            const char = await window.DB.get('characters', conv.charId);
            const systemPrompt = `【角色设定】你是${char.name}。${char.detail || ''}\n\n【重要事件】用户送了你一份礼物——"${goods.name}"，价值¥${goods.price}。请根据你的角色性格，自然地表达收到礼物后的反应。要简短自然。`;
            const reply = await window.callLLM([{ role: 'system', content: systemPrompt }, { role: 'user', content: `送你一份礼物：${goods.name}，希望你喜欢！` }]);
            await window.DB.put('chats', { role: 'assistant', content: reply, messageType: 'text', conversationId: conv.id, charId: conv.charId, timestamp: Date.now() + 1 });
            window.showStatus('✅ 对方已回应', 'success');
        } catch (e) { window.showStatus(`❌ ${e.message}`, 'error'); }
    }

    // =================================================================
    // 订单列表
    // =================================================================
    async function renderOrderList() {
        const container = $('gg-order-list');
        if (!container) return;
        const orders = await GDB.getOrders();
        if (!orders.length) { container.innerHTML = '<div class="gg-empty">暂无订单</div>'; return; }
        container.innerHTML = orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map(o => `
            <div class="gg-order-item">
                <div class="gg-order-img" style="background-image:url('${o.items[0]?.image || 'https://picsum.photos/100/100'}')"></div>
                <div class="gg-order-info">
                    <div class="gg-order-name">${window.escapeHtml(o.items.map(i => i.name).join('、'))}</div>
                    <div class="gg-order-date">${new Date(o.createdAt).toLocaleDateString()}</div>
                    <div class="gg-order-bottom">
                        <span class="gg-order-price">¥${o.total}</span>
                        <span class="gg-order-status ${o.status === 'paid' || o.status === 'gifted' ? 'paid' : o.status === 'pending_pay' ? 'pending' : 'done'}">${o.status === 'paid' ? '已支付' : o.status === 'gifted' ? '已送礼' : o.status === 'pending_pay' ? '待付款' : '已完成'}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // =================================================================
    // 购物车
    // =================================================================
    async function renderCart() {
        const list = $('gg-cart-list');
        const footer = $('gg-cart-footer');
        if (!list) return;
        const cart = await GDB.getCart();
        if (!cart.length) {
            list.innerHTML = '<div class="gg-empty">🛒 购物车是空的</div>';
            if (footer) footer.style.display = 'none';
            return;
        }
        if (footer) footer.style.display = 'flex';
        let html = '';
        let total = 0;
        cart.forEach((item, idx) => {
            const checked = item._checked !== false;
            if (checked) total += item.price * (item.quantity || 1);
            html += `
                <div class="gg-cart-item">
                    <div class="gg-cart-check ${checked ? 'checked' : 'unchecked'} clickable" data-index="${idx}">${checked ? '✓' : ''}</div>
                    <div class="gg-cart-img" style="background-image:url('${item.image || 'https://picsum.photos/200/200?random=1'}')"></div>
                    <div class="gg-cart-info">
                        <div class="gg-cart-name">${window.escapeHtml(item.name)}</div>
                        <div class="gg-cart-shop">店家：${window.escapeHtml(item.shopName)}</div>
                        <div class="gg-cart-price-row">
                            <span class="gg-cart-price">¥${item.price}</span>
                            <div class="gg-cart-qty">
                                <span class="gg-cart-qty-btn clickable" data-index="${idx}" data-delta="-1">−</span>
                                <span>${item.quantity || 1}</span>
                                <span class="gg-cart-qty-btn clickable" data-index="${idx}" data-delta="1">+</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
        list.innerHTML = html;
        const totalEl = document.querySelector('#gg-cart-total');
        if (totalEl) totalEl.textContent = '合计: ¥' + total.toFixed(2);

        list.querySelectorAll('.gg-cart-check').forEach(check => {
            check.addEventListener('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt(check.dataset.index);
                const cart = await GDB.getCart();
                if (cart[idx]) { cart[idx]._checked = cart[idx]._checked !== false ? false : true;
                    await window.DB.put('guangguang_cart', cart[idx]);
                    renderCart(); }
            });
        });
        list.querySelectorAll('.gg-cart-qty-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.index);
                const delta = parseInt(btn.dataset.delta);
                const cart = await GDB.getCart();
                if (cart[idx]) { cart[idx].quantity = Math.max(1, (cart[idx].quantity || 1) + delta);
                    await window.DB.put('guangguang_cart', cart[idx]);
                    renderCart(); }
            });
        });
        renderCartBadge();
    }

    async function cartSelectAll() {
        const cart = await GDB.getCart();
        const allChecked = cart.every(c => c._checked !== false);
        for (const item of cart) { item._checked = !allChecked;
            await window.DB.put('guangguang_cart', item); }
        renderCart();
    }

    async function cartSettle() {
        const cart = await GDB.getCart();
        const checked = cart.filter(c => c._checked !== false);
        if (!checked.length) { window.showStatus('请先选择商品', 'info'); return; }
        const total = checked.reduce((s, c) => s + c.price * (c.quantity || 1), 0);
        const merged = { id: 'merged_' + Date.now(), name: checked.map(c => c.name).join('、'), image: checked[0].image, price: total, detail: `合并购买 ${checked.length} 件商品`, shopName: checked.map(c => c.shopName).join('、'), shopId: checked[0].shopId };
        openPurchase(merged);
    }

    async function renderCartBadge() {
        const badge = $('gg-cart-badge');
        if (!badge) return;
        const cart = await GDB.getCart();
        const count = cart.reduce((s, c) => s + (c.quantity || 1), 0);
        badge.textContent = count;
        badge.style.display = (window._ggCartVisited && count > 0) ? 'none' : (count > 0 ? 'inline' : 'none');
    }

    // =================================================================
    // 消息页
    // =================================================================
    async function renderMsgList() {
        const list = $('gg-msg-list');
        if (!list) return;
        const convs = await GDB.getMsgConversations();
        convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (!convs.length) { list.innerHTML = '<div class="gg-empty">💬 暂无消息</div>'; return; }
        list.innerHTML = convs.map(c => `
            <div class="gg-msg-conv-item" data-shop-id="${c.shopId}" data-shop-name="${window.escapeHtml(c.shopName)}">
                <div class="gg-msg-avatar">🏪</div>
                <div class="gg-msg-info">
                    <div class="gg-msg-name">${window.escapeHtml(c.shopName)}</div>
                    <div class="gg-msg-preview">${window.escapeHtml(c.lastMessage || '点击开始对话')}</div>
                </div>
                <div class="gg-msg-time">${new Date(c.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        `).join('');
        list.querySelectorAll('.gg-msg-conv-item').forEach(item => {
            item.addEventListener('click', () => openMsgDetail(item.dataset.shopId, item.dataset.shopName));
        });
        renderMsgBadge();
    }

    async function openMsgDetail(shopId, shopName) {
        GG.currentMsgShopId = shopId;
        GG.currentMsgShopName = shopName;
        $('gg-msg-detail-title').textContent = shopName;
        const conv = await GDB.getOrCreateMsgConv(shopId, shopName);
        const msgs = await GDB.getMessages(conv.id);
        const container = $('gg-msg-detail-messages');
        if (!msgs.length) {
            container.innerHTML = `<div style="display:flex;align-items:flex-start;gap:8px;">
                <div style="width:36px;height:36px;border-radius:6px;background:#ff9800;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px;flex-shrink:0;">店</div>
                <div style="max-width:75%;padding:10px 14px;border-radius:18px;border-top-left-radius:4px;font-size:15px;line-height:1.6;background:#e9f2fb;color:#4a5568;box-shadow:0 1px 2px rgba(0,0,0,0.05);">👋 你好！我是${shopName}的客服，有什么可以帮您？</div>
            </div>`;
        } else {
            container.innerHTML = msgs.map(m => {
                const isSelf = m.role === 'user';
                const msgType = m.messageType || 'text';
                let bubble = '';
                if (msgType === 'image') bubble = `<div style="max-width:75%;padding:8px 12px;border-radius:18px;font-size:15px;background:#faf9f6;display:flex;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:32px;">🖼️</span><span style="font-size:12px;color:#d8b69f;">点击查看图片</span></div>`;
                else if (msgType === 'voice') bubble = `<div style="max-width:75%;padding:8px 16px;border-radius:18px;font-size:15px;background:#faf9f6;display:flex;align-items:center;gap:10px;"><span style="font-size:14px;">🔊</span><span style="font-size:14px;color:#4a5568;">7''</span></div>`;
                else bubble = `<div style="max-width:75%;padding:10px 14px;border-radius:18px;font-size:15px;line-height:1.6;background:${isSelf ? '#fde9ea' : '#e9f2fb'};color:#4a5568;box-shadow:0 1px 2px rgba(0,0,0,0.05);${isSelf ? 'border-top-right-radius:4px;' : 'border-top-left-radius:4px;'}">${window.escapeHtml(m.content || '')}</div>`;
                return `<div style="display:flex;align-items:flex-start;gap:8px;justify-content:${isSelf ? 'flex-end' : 'flex-start'};">
                    ${isSelf ? '' : '<div style="width:36px;height:36px;border-radius:6px;background:#ff9800;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px;flex-shrink:0;">店</div>'}
                    ${bubble}
                    ${isSelf ? '<div style="width:36px;height:36px;border-radius:6px;background:#e74c3c;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px;flex-shrink:0;">我</div>' : ''}
                </div>`;
            }).join('');
        }
        const bottomNav = document.querySelector('#page-guangguang > div:last-child');
        if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'none';
        switchGGPage('gg-msg-detail');
        setTimeout(() => { const mc = $('gg-msg-detail-messages'); if (mc) mc.scrollTop = mc.scrollHeight; }, 100);
    }

    async function sendMsgDetail() {
        const input = $('gg-msg-detail-input');
        const text = input.value.trim();
        if (!text || !GG.currentMsgShopId) return;
        const conv = await GDB.getOrCreateMsgConv(GG.currentMsgShopId, GG.currentMsgShopName);
        await GDB.addMessage({ conversationId: conv.id, role: 'user', content: text, messageType: 'text' });
        conv.lastMessage = text;
        conv.updatedAt = Date.now();
        await window.DB.put('guangguang_msg_convs', conv);
        input.value = '';
        await openMsgDetail(GG.currentMsgShopId, GG.currentMsgShopName);
        renderMsgBadge();
    }

    async function sendMsgDetailSpecial(type, content) {
        if (!GG.currentMsgShopId) return;
        const conv = await GDB.getOrCreateMsgConv(GG.currentMsgShopId, GG.currentMsgShopName);
        await GDB.addMessage({ conversationId: conv.id, role: 'user', content, messageType: type });
        conv.lastMessage = content;
        conv.updatedAt = Date.now();
        await window.DB.put('guangguang_msg_convs', conv);
        await openMsgDetail(GG.currentMsgShopId, GG.currentMsgShopName);
        renderMsgBadge();
    }

    async function fetchMsgDetailAIReply() {
        if (!GG.currentMsgShopId) { window.showStatus('请先进入对话', 'error'); return; }
        const goods = GG.currentDetailGoods;
        const shopName = GG.currentMsgShopName;
        window.showStatus('🤖 正在获取客服回复...', 'info');
        window.recordApiPending();
        try {
            const conv = await GDB.getOrCreateMsgConv(GG.currentMsgShopId, GG.currentMsgShopName);
            const msgs = await GDB.getMessages(conv.id);
            const recent = msgs.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
            const goodsInfo = goods ? `\n【当前咨询的商品】名称：${goods.name}，价格：¥${goods.price}，详情：${goods.detail || '暂无'}，店铺：${goods.shopName || shopName}` : '';
            const systemPrompt = `你是"${shopName}"的客服人员。${goodsInfo}\n\n【回复要求】用口语化语言，简洁专业，围绕商品和售前问题，回复简短自然。不要使用动作描写符号。`;
            const reply = await window.callLLM([{ role: 'system', content: systemPrompt }, ...recent]);
            await GDB.addMessage({ conversationId: conv.id, role: 'assistant', content: reply, messageType: 'text' });
            conv.lastMessage = reply;
            conv.updatedAt = Date.now();
            await window.DB.put('guangguang_msg_convs', conv);
            await openMsgDetail(GG.currentMsgShopId, GG.currentMsgShopName);
            window.showStatus('✅ 回复成功', 'success');
        } catch (e) { window.showStatus(`❌ ${e.message}`, 'error'); }
    }

    async function renderMsgBadge() {
        const badge = $('gg-msg-badge');
        if (!badge) return;
        const convs = await GDB.getMsgConversations();
        badge.textContent = convs.length;
        badge.style.display = (window._ggMsgVisited && convs.length > 0) ? 'none' : (convs.length > 0 ? 'inline' : 'none');
    }

    // =================================================================
    // 微信转账卡片（用户和AI共用）
    // =================================================================
    function buildWxTransferCard(amount, status) {
        const isPending = status === 'pending';
        const isReceived = status === 'received';
        const isRejected = status === 'rejected';
        return `<div class="gg-transfer-card ${status}">
            <div class="gg-transfer-label ${status}">${isReceived ? '转账已被接收' : isRejected ? '转账已被拒收' : '微信转账'}</div>
            <div class="gg-transfer-amount ${status}">¥${amount.toFixed(2)}</div>
            ${isPending ? `<div class="gg-transfer-hint pending">待对方确认收款</div>` : ''}
            ${isReceived ? `<div class="gg-transfer-hint received">已到账</div>` : ''}
            ${isRejected ? `<div class="gg-transfer-hint rejected">已退还</div>` : ''}
        </div>`;
    }

    // =================================================================
    // 微信红包卡片（用户和AI共用）
    // =================================================================
    function buildWxRedPacketCard(amount, message) {
        return `<div class="gg-redpacket-card">
            <div class="gg-redpacket-icon">🧧</div>
            <div class="gg-redpacket-msg">${window.escapeHtml(message)}</div>
            <div class="gg-redpacket-label">微信红包</div>
        </div>`;
    }

    // =================================================================
    // AI主动发起：代付卡片
    // =================================================================
    function buildTafuCardFromAI(goodsName, amount, message, status) {
        const statusText = status === 'paid' ? '已支付' : '待支付 · 未付款';
        const statusClass = status === 'paid' ? 'paid' : status === 'rejected' ? 'rejected' : '';
        return `<div class="gg-tafu-card-ai">
            <div class="gg-tafu-title">请你帮我付</div>
            <div class="gg-tafu-goods">${window.escapeHtml(goodsName)}</div>
            <div class="gg-tafu-price">总价：¥${amount}</div>
            ${message ? `<div class="gg-tafu-msg">"${window.escapeHtml(message)}"</div>` : ''}
            <div class="gg-tafu-divider"></div>
            <div class="gg-tafu-status ${statusClass}">${statusText}</div>
        </div>`;
    }

    // =================================================================
    // AI主动发起：送礼卡片
    // =================================================================
    function buildGiftCardFromAI(goodsName, amount, message) {
        return `<div class="gg-gift-card-ai">
            <div class="gg-gift-title">Gift</div>
            <div class="gg-gift-goods">${window.escapeHtml(goodsName)}</div>
            <div class="gg-gift-price">¥${amount}</div>
            ${message ? `<div class="gg-gift-msg">"${window.escapeHtml(message)}"</div>` : ''}
            <div class="gg-gift-divider"></div>
            <div class="gg-gift-bless">愿这份美好，温柔赠予你 ✨</div>
        </div>`;
    }

    // =================================================================
    // 从AI回复中提取主动发起指令
    // =================================================================
    function extractProactiveCommands(text) {
        const commands = [];
        const patterns = [
            { regex: /\[红包:([\d.]+):?([^\]]*)\]/, type: 'redpacket' },
            { regex: /\[转账:([\d.]+):?([^\]]*)\]/, type: 'transfer' },
            { regex: /\[请代付:([^:]+):([\d.]+):?([^\]]*)\]/, type: 'tafu_request' },
            { regex: /\[送礼:([^:]+):([\d.]+):?([^\]]*)\]/, type: 'gift_request' },
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match) {
                commands.push({
                    type: pattern.type,
                    amount: pattern.type === 'redpacket' || pattern.type === 'transfer' ? (parseFloat(match[1]) || 0) : (parseFloat(match[2]) || 0),
                    message: pattern.type === 'redpacket' || pattern.type === 'transfer' ? (match[2] || '') : (match[3] || ''),
                    goods: pattern.type === 'tafu_request' || pattern.type === 'gift_request' ? match[1] : null,
                    raw: match[0]
                });
                text = text.replace(match[0], '').trim();
            }
        }
        return { cleanedText: text, commands };
    }

    // =================================================================
    // 处理AI主动发起的指令
    // =================================================================
    async function handleProactiveCommands(convId, charId, commands) {
        const char = await window.DB.get('characters', charId);
        const charName = char?.name || '对方';
        for (let i = 0; i < commands.length; i++) {
            const cmd = commands[i];
            const ts = Date.now() + i * 100;
            if (cmd.type === 'redpacket') {
                const cardHTML = buildWxRedPacketCard(cmd.amount, cmd.message);
                await window.DB.put('chats', { role: 'assistant', content: cardHTML, messageType: 'transfer', conversationId: convId, charId, timestamp: ts });
            } else if (cmd.type === 'transfer') {
                const cardHTML = buildWxTransferCard(cmd.amount, 'pending');
                await window.DB.put('chats', { role: 'assistant', content: cardHTML, messageType: 'transfer', conversationId: convId, charId, timestamp: ts });
            } else if (cmd.type === 'tafu_request') {
                const cardHTML = buildTafuCardFromAI(cmd.goods, cmd.amount, cmd.message, 'pending');
                await window.DB.put('chats', { role: 'assistant', content: cardHTML, messageType: 'transfer', conversationId: convId, charId, timestamp: ts });
            } else if (cmd.type === 'gift_request') {
                const cardHTML = buildGiftCardFromAI(cmd.goods, cmd.amount, cmd.message);
                await window.DB.put('chats', { role: 'assistant', content: cardHTML, messageType: 'transfer', conversationId: convId, charId, timestamp: ts });
            }
        }
    }

    // =================================================================
    // AI判断转账接收/拒收
    // =================================================================
    async function fetchTransferAIReply(convId, amount) {
        try {
            const conv = await window.DB.get('conversations', convId);
            if (!conv) return;
            const char = await window.DB.get('characters', conv.charId);
            const systemPrompt = `【角色设定】你是${char.name}。${char.detail || ''}\n\n【重要事件】用户向你转账 ¥${amount}。请自主决定是否接收。回复要简短自然，然后明确说"我接收转账"或"我拒收转账"。`;
            const reply = await window.callLLM([{ role: 'system', content: systemPrompt }, { role: 'user', content: `向你转账 ¥${amount}` }]);
            const accept = reply.includes('接收转账') || reply.includes('收下') || reply.includes('谢谢');
            const reject = reply.includes('拒收转账') || reply.includes('不收') || reply.includes('退还');
            const willAccept = accept && !reject;
            const status = willAccept ? 'received' : 'rejected';
            const updatedCard = buildWxTransferCard(amount, status);
            await window.DB.put('chats', { role: 'assistant', content: reply, messageType: 'text', conversationId: convId, charId: conv.charId, timestamp: Date.now() });
            await window.DB.put('chats', { role: 'assistant', content: updatedCard, messageType: 'transfer', conversationId: convId, charId: conv.charId, timestamp: Date.now() + 1 });
            window.loadConversationMessages(convId);
        } catch (e) { console.error('fetchTransferAIReply 错误:', e); }
    }

    // =================================================================
    // AI领取红包
    // =================================================================
    async function fetchRedPacketAIReply(convId, amount) {
        try {
            const conv = await window.DB.get('conversations', convId);
            if (!conv) return;
            const char = await window.DB.get('characters', conv.charId);
            const charName = char?.name || '对方';
            const systemPrompt = `【角色设定】你是${char.name}。${char.detail || ''}\n\n【重要事件】用户给你发了一个红包 ¥${amount}。请表达领取红包后的反应，要简短自然。`;
            const reply = await window.callLLM([{ role: 'system', content: systemPrompt }, { role: 'user', content: '给你发了一个红包！' }]);
            await window.DB.put('chats', { role: 'assistant', content: reply, messageType: 'text', conversationId: convId, charId: conv.charId, timestamp: Date.now() });
            const noticeHTML = `${charName}已领取红包 ¥${amount}`;
            await window.DB.put('chats', { role: 'system', content: noticeHTML, messageType: 'mode_switch', conversationId: convId, charId: conv.charId, timestamp: Date.now() + 1 });
            window.loadConversationMessages(convId);
        } catch (e) { console.error('fetchRedPacketAIReply 错误:', e); }
    }

    // =================================================================
    // 发送卡片到聊天室
    // =================================================================
    async function sendCardToConversation(convId, charId, cardType, goods) {
        try {
            let content = '';
            if (cardType === 'gift') content = `🎁 送你一个礼物！\n【${goods.name}】\n价格：¥${goods.price}\n${goods.detail || ''}`;
            else if (cardType === 'tafu') content = `💌 代付请求\n【${goods.name}】\n价格：¥${goods.price}\n${goods.detail || ''}`;
            await window.DB.put('chats', { role: 'user', content, messageType: 'transfer', conversationId: parseInt(convId), charId, timestamp: Date.now() });
            window.showStatus('✅ 卡片已发送', 'success');
        } catch (e) { window.showStatus('❌ 发送失败', 'error'); }
    }

    // =================================================================
    // 我的逛逛
    // =================================================================
    async function renderMine() {
        const balance = await GDB.getWallet();
        const balEl = $('gg-wallet-balance');
        if (balEl) balEl.textContent = '¥' + Number(balance).toFixed(2);
        const savedName = await window.DB.getSetting('gg_mine_name', '仙客来');
        const savedAvatar = await window.DB.getSetting('gg_mine_avatar', '');
        const nameEl = $('gg-username-display');
        const avatarEl = $('gg-avatar-preview');
        if (nameEl) nameEl.textContent = savedName;
        if (avatarEl) {
            if (savedAvatar) { avatarEl.style.backgroundImage = `url('${savedAvatar}')`;
                avatarEl.style.backgroundColor = 'transparent';
                avatarEl.textContent = ''; } else { avatarEl.style.backgroundImage = '';
                avatarEl.style.backgroundColor = '#ff9800';
                avatarEl.textContent = '🐱'; }
        }
        renderOrderList();
    }

    async function openRechargeModal() {
        const amount = prompt('请输入充值金额：', '100');
        if (amount && !isNaN(amount) && Number(amount) > 0) {
            const current = await GDB.getWallet();
            await GDB.setWallet(current + Number(amount));
            window.showStatus(`✅ 充值成功 ¥${amount}`, 'success');
            renderMine();
        } else if (amount !== null) { window.showStatus('请输入有效金额', 'error'); }
    }

    // =================================================================
    // 事件绑定
    // =================================================================
    function bindEvents() {
        $('gg-search-btn')?.addEventListener('click', () => searchGoods($('gg-search-input').value));
        $('gg-search-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') searchGoods($('gg-search-input').value); });

        $('gg-detail-back-btn')?.addEventListener('click', () => {
            const bottomNav = document.querySelector('#page-guangguang > div:last-child');
            if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
            switchGGPage('gg-home');
        });
        $('gg-detail-service-btn')?.addEventListener('click', async () => {
            const goods = GG.currentDetailGoods;
            if (goods) { await GDB.getOrCreateMsgConv(goods.shopId, goods.shopName);
                openMsgDetail(goods.shopId, goods.shopName); }
        });
        $('gg-detail-cart-btn')?.addEventListener('click', async () => {
            const goods = GG.currentDetailGoods;
            if (goods) { await GDB.addToCart({ goodsId: goods.id, name: goods.name, image: goods.image, price: goods.price, detail: goods.detail, shopName: goods.shopName, shopId: goods.shopId });
                renderCartBadge(); }
        });
        $('gg-detail-buy-btn')?.addEventListener('click', () => { const goods = GG.currentDetailGoods; if (goods) openPurchase(goods); });

        $('gg-purchase-back-btn')?.addEventListener('click', () => {
            const bottomNav = document.querySelector('#page-guangguang > div:last-child');
            if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
            switchGGPage('gg-home');
        });
        $('gg-gift-toggle')?.addEventListener('click', async () => {
            GG.currentPurchaseIsGift = !GG.currentPurchaseIsGift;
            $('gg-gift-toggle').textContent = GG.currentPurchaseIsGift ? '✅ 已开启送礼' : '开启送礼 >';
            if (GG.currentPurchaseIsGift) { $('gg-gift-selector').style.display = 'block';
                await renderContactList('gg-gift-contact-list', contact => { GG.currentPurchaseGiftContactId = contact.convId;
                    $('gg-gift-selector').innerHTML = `<div style="padding:10px;background:#fff5f0;border-radius:8px;color:#ff4400;">✅ 已选择：${contact.name}</div>`; }); } else { $('gg-gift-selector').style.display = 'none';
                GG.currentPurchaseGiftContactId = null; }
        });
        document.querySelectorAll('.gg-pay-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const method = btn.dataset.pay;
                GG.currentPurchasePayMethod = method;
                updatePayButtons(method);
                if (method === 'other') { $('gg-tafu-selector').style.display = 'block';
                    await renderContactList('gg-tafu-contact-list', contact => { GG.currentPurchaseTafuContactId = contact.convId;
                        $('gg-tafu-selector').innerHTML = `<div style="padding:10px;background:#fff5f0;border-radius:8px;color:#ff4400;">✅ 已选择：${contact.name}</div>`; }); } else { $('gg-tafu-selector').style.display = 'none';
                    GG.currentPurchaseTafuContactId = null; }
            });
        });
        $('gg-settle-btn')?.addEventListener('click', handleSettle);

        $('gg-cart-select-all')?.addEventListener('click', cartSelectAll);
        $('gg-cart-settle-btn')?.addEventListener('click', cartSettle);
        $('gg-cart-manage-btn')?.addEventListener('click', async () => {
            const cart = await GDB.getCart();
            const checked = cart.filter(c => c._checked !== false);
            if (!checked.length) { window.showStatus('请先选择商品', 'info'); return; }
            for (const item of checked) await GDB.removeFromCart(item.id);
            window.showStatus('✅ 已删除选中商品', 'success');
            renderCart();
        });

        $('gg-msg-detail-back-btn')?.addEventListener('click', () => {
            const bottomNav = document.querySelector('#page-guangguang > div:last-child');
            if (bottomNav && bottomNav.querySelector('.gg-nav-item')) bottomNav.style.display = 'flex';
            switchGGPage('gg-messages');
        });
        $('gg-msg-detail-send-btn')?.addEventListener('click', sendMsgDetail);
        $('gg-msg-detail-fetch-btn')?.addEventListener('click', fetchMsgDetailAIReply);
        $('gg-msg-detail-input')?.addEventListener('keypress', e => { if (e.key === 'Enter') sendMsgDetail(); });
        $('gg-msg-plus-btn')?.addEventListener('click', () => {
            const menu = $('gg-msg-expand-menu');
            if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
        });
        document.querySelectorAll('#gg-msg-expand-menu .expand-menu-item').forEach(item => {
            item.addEventListener('click', async () => {
                const menu = $('gg-msg-expand-menu');
                if (menu) menu.style.display = 'none';
                const action = item.dataset.ggAction;
                if (action === 'image') { const desc = prompt('请输入图片描述：'); if (desc && desc.trim()) await sendMsgDetailSpecial('image', desc.trim()); } else if (action === 'voice') { const content = prompt('请输入语音内容：'); if (content && content.trim()) await sendMsgDetailSpecial('voice', content.trim()); }
            });
        });

        $('gg-tafu-modal-cancel')?.addEventListener('click', hideTafuModal);
        $('gg-tafu-modal-confirm')?.addEventListener('click', confirmTafuCard);
        $('gg-tafu-modal')?.addEventListener('click', e => { if (e.target === $('gg-tafu-modal')) hideTafuModal(); });
        $('gg-gift-modal-cancel')?.addEventListener('click', hideGiftModal);
        $('gg-gift-modal-confirm')?.addEventListener('click', confirmGiftCard);
        $('gg-gift-modal')?.addEventListener('click', e => { if (e.target === $('gg-gift-modal')) hideGiftModal(); });

        $('gg-avatar-preview')?.addEventListener('click', async () => {
            const choice = confirm('点击"确定"上传新头像，点击"取消"恢复默认');
            if (choice) {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async e => { const file = e.target.files[0]; if (file) { const dataUrl = await window.compressImage(file, 200, 200, 0.8);
                        await window.DB.setSetting('gg_mine_avatar', dataUrl);
                        renderMine(); } };
                input.click();
            } else { await window.DB.setSetting('gg_mine_avatar', '');
                renderMine(); }
        });
        $('gg-username-display')?.addEventListener('click', async () => {
            const newName = prompt('请输入新用户名：', $('gg-username-display').textContent);
            if (newName && newName.trim()) { await window.DB.setSetting('gg_mine_name', newName.trim());
                renderMine(); }
        });
        $('gg-all-orders-btn')?.addEventListener('click', async () => {
            const orders = await GDB.getOrders();
            if (!orders.length) { window.showStatus('暂无订单', 'info'); return; }
            alert('我的订单：\n\n' + orders.sort((a, b) => b.createdAt - a.createdAt).map(o => `${new Date(o.createdAt).toLocaleDateString()} - ${o.items.map(i => i.name).join(',')} - ¥${o.total} - ${o.status}`).join('\n'));
        });
        $('gg-recharge-btn')?.addEventListener('click', openRechargeModal);

        document.querySelectorAll('.gg-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const nav = item.dataset.ggNav;
                const pageMap = { home: 'gg-home', cart: 'gg-cart', messages: 'gg-messages', mine: 'gg-mine' };
                if (pageMap[nav]) switchGGPage(pageMap[nav]);
            });
        });
    }

    // =================================================================
    // 初始化
    // =================================================================
    renderCartBadge();
    renderMsgBadge();
    bindEvents();

    window.GG = GG;
    window.GDB = GDB;
    window.switchGGPage = switchGGPage;
    window.openGoodsDetail = openGoodsDetail;
    window.openPurchase = openPurchase;
    window.buildWxTransferCard = buildWxTransferCard;
    window.buildWxRedPacketCard = buildWxRedPacketCard;
    window.buildTafuCardFromAI = buildTafuCardFromAI;
    window.buildGiftCardFromAI = buildGiftCardFromAI;
    window.extractProactiveCommands = extractProactiveCommands;
    window.handleProactiveCommands = handleProactiveCommands;
    window.fetchTransferAIReply = fetchTransferAIReply;
    window.fetchRedPacketAIReply = fetchRedPacketAIReply;

    console.log('✅ 逛逛模块初始化完成');
})();