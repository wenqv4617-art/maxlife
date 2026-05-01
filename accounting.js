// ============================================
// 记账模块 - accounting.js
// 版本：v1.0
// 说明：提供日历记账、待办清单、收藏室功能
// ============================================

(function() {
    "use strict";

    window.initAccountingModule = function() {
        console.log('📊 记账模块已加载');
        accountingLoadData();
        accountingLoadCollectionData();
        accountingSetActiveType('income');
        accountingRenderCalendar();
        accountingBindEvents();
    };

    // ==================== 模块内部状态 ====================
    let accountingTransactions = [];
    let accountingMonthlyBudget = 3000;
    const ACCOUNTING_STORAGE_KEY = 'calendar_ledger_v2';
    const ACCOUNTING_BUDGET_KEY = 'calendar_budget_v2';
    const ACCOUNTING_TODO_PREFIX = 'calendar_todos_';
    
    let accountingCurrentYear = new Date().getFullYear();
    let accountingCurrentMonth = new Date().getMonth();
    let accountingSelectedDateStr = null;
    let accountingCurrentType = 'income';
    
    let accountingApiItems = [];
    let accountingWebItems = [];
    const ACCOUNTING_API_KEY = 'collection_api_v1';
    const ACCOUNTING_WEB_KEY = 'collection_web_v1';

    // ==================== 工具函数 ====================
    function accountingFormatCurrency(val) { 
        return '¥' + (Number(val) || 0).toFixed(2); 
    }

    function accountingGetDateStr(year, month, day) {
        const d = new Date(year, month, day);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const da = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${da}`;
    }

    function accountingExtractDateStr(isoString) {
        const d = new Date(isoString);
        return accountingGetDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function accountingGenId() { 
        return Date.now() + '-' + Math.random().toString(36).substr(2, 8); 
    }

    function escapeHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
    }

    // ==================== 待办管理 ====================
    function accountingLoadTodos(dateStr) {
        const key = ACCOUNTING_TODO_PREFIX + dateStr;
        const stored = localStorage.getItem(key);
        if (stored) { try { return JSON.parse(stored); } catch (e) { return []; } }
        return [];
    }

    function accountingSaveTodos(dateStr, todos) {
        localStorage.setItem(ACCOUNTING_TODO_PREFIX + dateStr, JSON.stringify(todos));
    }

    // ==================== 收支计算 ====================
    function accountingCalcMonthExpense(year, month) {
        return accountingTransactions
            .filter(t => {
                if (t.type !== 'expense') return false;
                const d = new Date(t.date);
                return d.getFullYear() === year && d.getMonth() === month;
            })
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    }

    // ==================== 数据持久化 ====================
    function accountingSaveAll() {
        localStorage.setItem(ACCOUNTING_STORAGE_KEY, JSON.stringify(accountingTransactions));
        localStorage.setItem(ACCOUNTING_BUDGET_KEY, accountingMonthlyBudget);
    }

    function accountingLoadData() {
        const stored = localStorage.getItem(ACCOUNTING_STORAGE_KEY);
        if (stored) { try { accountingTransactions = JSON.parse(stored); } catch (e) {} }
        const b = localStorage.getItem(ACCOUNTING_BUDGET_KEY);
        if (b) accountingMonthlyBudget = Number(b) || 3000;
        const budgetInput = document.getElementById('accountingBudgetAmountInput');
        if (budgetInput) budgetInput.value = accountingMonthlyBudget;
        
        // 如果没有数据，添加示例数据
        if (!accountingTransactions.length) {
            const today = new Date();
            const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
            accountingTransactions.push(
                { id: Date.now() - 200000, description: '买菜', amount: 89.5, type: 'expense', date: new Date(y, m, d, 10, 30).toISOString() },
                { id: Date.now() - 500000, description: '工资', amount: 7000, type: 'income', date: new Date(y, m, d, 9, 0).toISOString() },
                { id: Date.now() - 800000, description: '聚餐', amount: 210, type: 'expense', date: new Date(y, m, d - 1, 19, 0).toISOString() }
            );
            accountingSaveAll();
        }
    }

    function accountingLoadCollectionData() {
        try {
            const savedApi = localStorage.getItem(ACCOUNTING_API_KEY);
            if (savedApi) accountingApiItems = JSON.parse(savedApi);
            const savedWeb = localStorage.getItem(ACCOUNTING_WEB_KEY);
            if (savedWeb) accountingWebItems = JSON.parse(savedWeb);
        } catch (e) {}
    }

    function accountingSaveApiStorage() { 
        localStorage.setItem(ACCOUNTING_API_KEY, JSON.stringify(accountingApiItems)); 
    }

    function accountingSaveWebStorage() { 
        localStorage.setItem(ACCOUNTING_WEB_KEY, JSON.stringify(accountingWebItems)); 
    }

    // ==================== UI更新 ====================
    function accountingUpdateSummary() {
        const monthExp = accountingCalcMonthExpense(accountingCurrentYear, accountingCurrentMonth);
        const monthTotalEl = document.getElementById('accountingMonthTotalExpense');
        const budgetRemainEl = document.getElementById('accountingBudgetRemainDisplay');
        if (monthTotalEl) monthTotalEl.textContent = accountingFormatCurrency(monthExp);
        if (budgetRemainEl) {
            const remain = Math.max(0, accountingMonthlyBudget - monthExp);
            budgetRemainEl.textContent = accountingFormatCurrency(remain);
        }
    }

    function accountingGetDayTotal(dateStr) {
        let income = 0, expense = 0;
        accountingTransactions.forEach(t => {
            if (accountingExtractDateStr(t.date) === dateStr) {
                if (t.type === 'income') income += Number(t.amount) || 0;
                else expense += Number(t.amount) || 0;
            }
        });
        return { income, expense };
    }

    // ==================== 日历渲染 ====================
    function accountingRenderCalendar() {
        const year = accountingCurrentYear, month = accountingCurrentMonth;
        const firstDay = new Date(year, month, 1);
        let startDayOfWeek = firstDay.getDay();
        startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();
        let cellsHtml = '';

        // 上个月的天数
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            const d = prevMonthDays - i;
            const dateStr = accountingGetDateStr(year, month - 1, d);
            const totals = accountingGetDayTotal(dateStr);
            cellsHtml += `<div class="calendar-day other-month" data-date="${dateStr}">
                <div class="day-number">${d}</div>
                <div class="day-income">${totals.income > 0 ? '+' + accountingFormatCurrency(totals.income) : ''}</div>
                <div class="day-expense">${totals.expense > 0 ? '-' + accountingFormatCurrency(totals.expense) : ''}</div>
            </div>`;
        }

        // 当前月的天数
        const todayStr = accountingGetDateStr(new Date());
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = accountingGetDateStr(year, month, d);
            const totals = accountingGetDayTotal(dateStr);
            const isToday = (dateStr === todayStr) ? 'today-cell' : '';
            cellsHtml += `<div class="calendar-day ${isToday}" data-date="${dateStr}">
                <div class="day-number">${d}</div>
                <div class="day-income">${totals.income > 0 ? '+' + accountingFormatCurrency(totals.income) : ''}</div>
                <div class="day-expense">${totals.expense > 0 ? '-' + accountingFormatCurrency(totals.expense) : ''}</div>
            </div>`;
        }

        // 下个月的天数（填充到42格）
        const totalCells = 42;
        const rendered = startDayOfWeek + daysInMonth;
        for (let i = rendered; i < totalCells; i++) {
            const nextD = i - rendered + 1;
            const dateStr = accountingGetDateStr(year, month + 1, nextD);
            const totals = accountingGetDayTotal(dateStr);
            cellsHtml += `<div class="calendar-day other-month" data-date="${dateStr}">
                <div class="day-number">${nextD}</div>
                <div class="day-income">${totals.income > 0 ? '+' + accountingFormatCurrency(totals.income) : ''}</div>
                <div class="day-expense">${totals.expense > 0 ? '-' + accountingFormatCurrency(totals.expense) : ''}</div>
            </div>`;
        }

        const container = document.getElementById('accountingCalendarDaysContainer');
        if (container) container.innerHTML = cellsHtml;

        const monthDisplay = document.getElementById('accountingCurrentMonthDisplay');
        if (monthDisplay) monthDisplay.textContent = `${year}年 ${month + 1}月`;

        accountingUpdateSummary();

        // 绑定日期点击事件
        document.querySelectorAll('#accountingCalendarDaysContainer .calendar-day').forEach(el => {
            el.addEventListener('click', function() {
                accountingOpenTransitionPanel(this.dataset.date);
            });
        });
    }

    // ==================== 面板导航 ====================
    function accountingOpenTransitionPanel(dateStr) {
        accountingSelectedDateStr = dateStr;
        const label = document.getElementById('accountingTransitionDateLabel');
        if (label) label.textContent = dateStr;
        const panel = document.getElementById('accountingTransitionPanel');
        if (panel) panel.style.display = 'block';
    }

    function accountingCloseAllPanels() {
        const panels = [
            'accountingTransitionPanel', 'accountingLedgerDetailPanel',
            'accountingTodoDetailPanel', 'accountingReservedDetailPanel', 
            'accountingCollectionPanel'
        ];
        panels.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function accountingOpenLedgerPanel() {
        if (!accountingSelectedDateStr) return;
        const display = document.getElementById('accountingLedgerDateDisplay');
        if (display) display.textContent = accountingSelectedDateStr;
        accountingRenderLedgerContent();
        const panel = document.getElementById('accountingLedgerDetailPanel');
        if (panel) panel.style.display = 'block';
    }

    function accountingOpenTodoPanel() {
        if (!accountingSelectedDateStr) return;
        const display = document.getElementById('accountingTodoDateDisplay');
        if (display) display.textContent = accountingSelectedDateStr;
        accountingRenderTodoList();
        const panel = document.getElementById('accountingTodoDetailPanel');
        if (panel) panel.style.display = 'block';
    }

    function accountingOpenReservedPanel() {
        const panel = document.getElementById('accountingReservedDetailPanel');
        if (panel) panel.style.display = 'block';
    }

    function accountingOpenCollectionPanel() {
        const panel = document.getElementById('accountingCollectionPanel');
        if (panel) panel.style.display = 'block';
        accountingSwitchCollectionTab('api');
        accountingRefreshCollectionViews();
    }

    // ==================== 收支明细面板 ====================
    function accountingRenderLedgerContent() {
        const totals = accountingGetDayTotal(accountingSelectedDateStr);
        const incomeEl = document.getElementById('accountingDailyIncome');
        const expenseEl = document.getElementById('accountingDailyExpense');
        if (incomeEl) incomeEl.textContent = accountingFormatCurrency(totals.income);
        if (expenseEl) expenseEl.textContent = accountingFormatCurrency(totals.expense);

        const dayTrans = accountingTransactions
            .filter(t => accountingExtractDateStr(t.date) === accountingSelectedDateStr)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const listEl = document.getElementById('accountingDetailTransactionList');
        if (!listEl) return;

        if (dayTrans.length === 0) {
            listEl.innerHTML = '<li class="accounting-empty-msg">今天还没有记录</li>';
            return;
        }

        let html = '';
        dayTrans.forEach(t => {
            const amt = Number(t.amount) || 0;
            const sign = t.type === 'income' ? '' : '−';
            const cls = t.type === 'income' ? 'accounting-amount-income' : 'accounting-amount-expense';
            html += `<li class="accounting-transaction-item">
                <div><strong>${escapeHtml(t.description)}</strong></div>
                <div style="display:flex; align-items:center; gap:12px;">
                    <span class="${cls}">${sign}${accountingFormatCurrency(amt)}</span>
                    <button class="accounting-delete-btn" data-id="${t.id}">🗑️</button>
                </div>
            </li>`;
        });
        listEl.innerHTML = html;

        listEl.querySelectorAll('.accounting-delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = Number(btn.dataset.id);
                accountingTransactions = accountingTransactions.filter(t => t.id !== id);
                accountingSaveAll();
                accountingRenderCalendar();
                accountingRenderLedgerContent();
                accountingUpdateSummary();
            });
        });
    }

    // ==================== 待办清单面板 ====================
    function accountingRenderTodoList() {
        if (!accountingSelectedDateStr) return;
        const todos = accountingLoadTodos(accountingSelectedDateStr);
        const sorted = [...todos].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
        const container = document.getElementById('accountingTodoListContainer');
        if (!container) return;

        if (sorted.length === 0) {
            container.innerHTML = '<li class="accounting-empty-msg">还没有待办，创建一条吧</li>';
            return;
        }

        let html = '';
        sorted.forEach(todo => {
            const checkedAttr = todo.completed ? 'checked' : '';
            const completedClass = todo.completed ? 'accounting-todo-completed' : '';
            html += `<li class="accounting-todo-item ${completedClass}" data-id="${todo.id}">
                <input type="checkbox" class="accounting-todo-check" ${checkedAttr}>
                <span class="accounting-todo-text">${escapeHtml(todo.text)}</span>
                <button class="accounting-todo-delete-btn">🗑️</button>
            </li>`;
        });
        container.innerHTML = html;

        container.querySelectorAll('.accounting-todo-item').forEach(item => {
            const id = Number(item.dataset.id);
            const checkbox = item.querySelector('.accounting-todo-check');
            const delBtn = item.querySelector('.accounting-todo-delete-btn');
            checkbox.addEventListener('change', () => {
                const todos = accountingLoadTodos(accountingSelectedDateStr);
                const target = todos.find(t => t.id === id);
                if (target) { target.completed = checkbox.checked; }
                accountingSaveTodos(accountingSelectedDateStr, todos);
                accountingRenderTodoList();
            });
            delBtn.addEventListener('click', () => {
                let todos = accountingLoadTodos(accountingSelectedDateStr);
                todos = todos.filter(t => t.id !== id);
                accountingSaveTodos(accountingSelectedDateStr, todos);
                accountingRenderTodoList();
            });
        });
    }

    function accountingAddTodo() {
        const input = document.getElementById('accountingNewTodoInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        const todos = accountingLoadTodos(accountingSelectedDateStr);
        todos.push({ id: Date.now() + Math.floor(Math.random() * 1000), text, completed: false });
        accountingSaveTodos(accountingSelectedDateStr, todos);
        input.value = '';
        accountingRenderTodoList();
    }

    // ==================== 添加交易 ====================
    function accountingAddTransaction() {
        if (!accountingSelectedDateStr) { alert('请先选择日期'); return; }
        const descInput = document.getElementById('accountingDescInput');
        const amtInput = document.getElementById('accountingAmountInput');
        if (!descInput || !amtInput) return;
        const desc = descInput.value.trim();
        if (!desc) { alert('请填写描述'); return; }
        const amt = parseFloat(amtInput.value);
        if (isNaN(amt) || amt <= 0) { alert('金额需大于0'); return; }
        const rounded = Math.round(amt * 100) / 100;
        const [year, month, day] = accountingSelectedDateStr.split('-').map(Number);
        const recordDate = new Date(year, month - 1, day, 12, 0, 0);
        accountingTransactions.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            description: desc,
            amount: rounded,
            type: accountingCurrentType,
            date: recordDate.toISOString()
        });
        accountingSaveAll();
        descInput.value = '';
        amtInput.value = '';
        accountingRenderCalendar();
        accountingRenderLedgerContent();
        accountingUpdateSummary();
    }

    function accountingSetActiveType(type) {
        accountingCurrentType = type;
        document.querySelectorAll('.accounting-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
    }

    // ==================== 收藏室 ====================
    function accountingSwitchCollectionTab(tabId) {
        document.querySelectorAll('.accounting-collection-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.collectionTab === tabId);
        });
        document.querySelectorAll('.accounting-collection-view').forEach(v => v.style.display = 'none');
        const viewId = tabId === 'api' ? 'Api' : tabId === 'web' ? 'Web' : 'Placeholder';
        const view = document.getElementById('accountingCollectionView' + viewId);
        if (view) view.style.display = 'block';
    }

    function accountingRenderApiList() {
        const container = document.getElementById('accountingApiListContainer');
        if (!container) return;
        if (accountingApiItems.length === 0) {
            container.innerHTML = '<div class="accounting-empty-message">✨ 还没有API，点击"新建API"添加</div>';
            return;
        }
        let html = '';
        accountingApiItems.forEach(item => {
            html += `<div class="accounting-item-card ${item.expanded ? 'expanded' : ''}" data-api-id="${item.id}">
                <div class="accounting-item-header" data-action="toggle-api" data-id="${item.id}">
                    <span class="accounting-item-name">${escapeHtml(item.name) || '未命名'}</span>
                    <div style="display:flex; align-items:center;">
                        <button class="accounting-delete-btn" data-action="delete-api" data-id="${item.id}">🗑️</button>
                        <span class="accounting-expand-icon">▶</span>
                    </div>
                </div>
                <div class="accounting-item-details">
                    <div class="accounting-detail-field"><label>URL</label><input class="accounting-api-url-input" data-id="${item.id}" value="${escapeHtml(item.url || '')}"></div>
                    <div class="accounting-detail-field"><label>API Key</label><input class="accounting-api-key-input" data-id="${item.id}" value="${escapeHtml(item.apikey || '')}"></div>
                    <div class="accounting-detail-actions"><button class="accounting-btn-outline" data-action="save-api-edit" data-id="${item.id}">保存编辑</button></div>
                </div>
            </div>`;
        });
        container.innerHTML = html;

        bindCollectionCardEvents(container, 'api', accountingApiItems, accountingSaveApiStorage, accountingRenderApiList);
    }

    function accountingRenderWebList() {
        const container = document.getElementById('accountingWebListContainer');
        if (!container) return;
        if (accountingWebItems.length === 0) {
            container.innerHTML = '<div class="accounting-empty-message">📎 还没有收藏网页</div>';
            return;
        }
        let html = '';
        accountingWebItems.forEach(item => {
            html += `<div class="accounting-item-card ${item.expanded ? 'expanded' : ''}" data-web-id="${item.id}">
                <div class="accounting-item-header" data-action="toggle-web" data-id="${item.id}">
                    <span class="accounting-item-name">${escapeHtml(item.name) || '未命名'}</span>
                    <div style="display:flex; align-items:center;">
                        <button class="accounting-delete-btn" data-action="delete-web" data-id="${item.id}">🗑️</button>
                        <span class="accounting-expand-icon">▶</span>
                    </div>
                </div>
                <div class="accounting-item-details">
                    <div class="accounting-detail-field"><label>链接</label><input class="accounting-web-url-input" data-id="${item.id}" value="${escapeHtml(item.url || '')}"></div>
                    <div class="accounting-detail-field"><label>备注</label><input class="accounting-web-note-input" data-id="${item.id}" value="${escapeHtml(item.note || '')}"></div>
                    <div class="accounting-detail-actions"><button class="accounting-btn-outline" data-action="save-web-edit" data-id="${item.id}">保存编辑</button></div>
                </div>
            </div>`;
        });
        container.innerHTML = html;

        bindCollectionCardEvents(container, 'web', accountingWebItems, accountingSaveWebStorage, accountingRenderWebList);
    }

    function bindCollectionCardEvents(container, type, items, saveFn, renderFn) {
        container.querySelectorAll('.accounting-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.classList.contains('accounting-delete-btn')) return;
                const card = header.closest('.accounting-item-card');
                const id = card.dataset[type + 'Id'];
                const item = items.find(a => a.id === id);
                if (item) {
                    item.expanded = !item.expanded;
                    saveFn();
                    renderFn();
                }
            });
        });

        container.querySelectorAll('.accounting-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (confirm(`删除${type === 'api' ? 'API' : '网页'}？`)) {
                    const idx = items.findIndex(a => a.id === id);
                    if (idx >= 0) items.splice(idx, 1);
                    saveFn();
                    renderFn();
                }
            });
        });

        container.querySelectorAll('[data-action="save-' + type + '-edit"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const card = btn.closest('.accounting-item-card');
                const item = items.find(a => a.id === id);
                if (item) {
                    if (type === 'api') {
                        item.url = card.querySelector('.accounting-api-url-input').value;
                        item.apikey = card.querySelector('.accounting-api-key-input').value;
                    } else {
                        item.url = card.querySelector('.accounting-web-url-input').value;
                        item.note = card.querySelector('.accounting-web-note-input').value;
                    }
                    saveFn();
                    renderFn();
                }
            });
        });
    }

    function accountingRefreshCollectionViews() {
        accountingRenderApiList();
        accountingRenderWebList();
    }

    // ==================== 事件绑定 ====================
    function accountingBindEvents() {
        // 月份导航
        const prevBtn = document.getElementById('accountingPrevMonthBtn');
        if (prevBtn && !prevBtn.dataset.accountingBound) {
            prevBtn.dataset.accountingBound = '1';
            prevBtn.addEventListener('click', () => {
                if (accountingCurrentMonth === 0) { accountingCurrentMonth = 11; accountingCurrentYear--; } 
                else { accountingCurrentMonth--; }
                accountingRenderCalendar();
            });
        }

        const nextBtn = document.getElementById('accountingNextMonthBtn');
        if (nextBtn && !nextBtn.dataset.accountingBound) {
            nextBtn.dataset.accountingBound = '1';
            nextBtn.addEventListener('click', () => {
                if (accountingCurrentMonth === 11) { accountingCurrentMonth = 0; accountingCurrentYear++; } 
                else { accountingCurrentMonth++; }
                accountingRenderCalendar();
            });
        }

        const todayBtn = document.getElementById('accountingTodayBtn');
        if (todayBtn && !todayBtn.dataset.accountingBound) {
            todayBtn.dataset.accountingBound = '1';
            todayBtn.addEventListener('click', () => {
                const today = new Date();
                accountingCurrentYear = today.getFullYear();
                accountingCurrentMonth = today.getMonth();
                accountingRenderCalendar();
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                const d = String(today.getDate()).padStart(2, '0');
                accountingOpenTransitionPanel(`${y}-${m}-${d}`);
            });
        }

        // 预算设置
        document.getElementById('accountingShowBudgetInputBtn')?.addEventListener('click', () => {
            const row = document.getElementById('accountingBudgetInputRow');
            const input = document.getElementById('accountingBudgetAmountInput');
            if (row) row.style.display = 'flex';
            if (input) input.value = accountingMonthlyBudget;
        });

        document.getElementById('accountingSaveBudgetBtn')?.addEventListener('click', () => {
            const input = document.getElementById('accountingBudgetAmountInput');
            if (input) {
                let val = parseFloat(input.value);
                accountingMonthlyBudget = (!isNaN(val) && val >= 0) ? val : 0;
            }
            const row = document.getElementById('accountingBudgetInputRow');
            if (row) row.style.display = 'none';
            accountingUpdateSummary();
            accountingSaveAll();
        });

        // 返回日历
        document.getElementById('accountingBackToCalendarFromTransition')?.addEventListener('click', () => {
            accountingCloseAllPanels();
            accountingRenderCalendar();
        });

        // 过渡面板卡片点击
        document.querySelectorAll('.accounting-transition-card').forEach(card => {
            card.addEventListener('click', () => {
                const target = card.dataset.target;
                const panel = document.getElementById('accountingTransitionPanel');
                if (panel) panel.style.display = 'none';
                if (target === 'ledger') accountingOpenLedgerPanel();
                else if (target === 'todo') accountingOpenTodoPanel();
                else if (target === 'reserved') accountingOpenReservedPanel();
                else if (target === 'collection') accountingOpenCollectionPanel();
            });
        });

        // 收藏室入口
        document.getElementById('accountingCollectionEntranceBtn')?.addEventListener('click', () => {
            accountingOpenCollectionPanel();
        });

        // 各面板返回按钮
        document.getElementById('accountingBackToTransitionFromLedger')?.addEventListener('click', () => {
            document.getElementById('accountingLedgerDetailPanel').style.display = 'none';
            document.getElementById('accountingTransitionPanel').style.display = 'block';
        });
        document.getElementById('accountingBackToTransitionFromTodo')?.addEventListener('click', () => {
            document.getElementById('accountingTodoDetailPanel').style.display = 'none';
            document.getElementById('accountingTransitionPanel').style.display = 'block';
        });
        document.getElementById('accountingBackToTransitionFromReserved')?.addEventListener('click', () => {
            document.getElementById('accountingReservedDetailPanel').style.display = 'none';
            document.getElementById('accountingTransitionPanel').style.display = 'block';
        });
        document.getElementById('accountingBackToTransitionFromCollection')?.addEventListener('click', () => {
            document.getElementById('accountingCollectionPanel').style.display = 'none';
            document.getElementById('accountingTransitionPanel').style.display = 'block';
        });

        // 添加交易
        document.getElementById('accountingAddTransactionBtn')?.addEventListener('click', accountingAddTransaction);
        document.getElementById('accountingAmountInput')?.addEventListener('keypress', e => { 
            if (e.key === 'Enter') accountingAddTransaction(); 
        });

        // 收支类型切换
        document.querySelectorAll('.accounting-type-btn').forEach(btn => {
            btn.addEventListener('click', () => accountingSetActiveType(btn.dataset.type));
        });

        // 待办
        document.getElementById('accountingAddTodoBtn')?.addEventListener('click', accountingAddTodo);
        document.getElementById('accountingNewTodoInput')?.addEventListener('keypress', e => { 
            if (e.key === 'Enter') accountingAddTodo(); 
        });

        // 收藏室标签切换
        document.querySelectorAll('.accounting-collection-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => accountingSwitchCollectionTab(btn.dataset.collectionTab));
        });

        // API收藏
        document.getElementById('accountingShowApiFormBtn')?.addEventListener('click', () => {
            document.getElementById('accountingApiCreateCard').style.display = 'block';
        });
        document.getElementById('accountingCancelApiBtn')?.addEventListener('click', () => {
            document.getElementById('accountingApiCreateCard').style.display = 'none';
        });
        document.getElementById('accountingSaveApiBtn')?.addEventListener('click', () => {
            const name = document.getElementById('accountingApiNameInput').value.trim();
            if (!name) { alert('填写名称'); return; }
            accountingApiItems.push({
                id: accountingGenId(),
                name,
                url: document.getElementById('accountingApiUrlInput').value.trim(),
                apikey: document.getElementById('accountingApiKeyInput').value.trim(),
                expanded: false
            });
            accountingSaveApiStorage();
            accountingRenderApiList();
            document.getElementById('accountingApiCreateCard').style.display = 'none';
            document.getElementById('accountingApiNameInput').value = '';
            document.getElementById('accountingApiUrlInput').value = '';
            document.getElementById('accountingApiKeyInput').value = '';
        });

        // 网页收藏
        document.getElementById('accountingShowWebFormBtn')?.addEventListener('click', () => {
            document.getElementById('accountingWebCreateCard').style.display = 'block';
        });
        document.getElementById('accountingCancelWebBtn')?.addEventListener('click', () => {
            document.getElementById('accountingWebCreateCard').style.display = 'none';
        });
        document.getElementById('accountingSaveWebBtn')?.addEventListener('click', () => {
            const name = document.getElementById('accountingWebNameInput').value.trim();
            if (!name) { alert('填写名称'); return; }
            accountingWebItems.push({
                id: accountingGenId(),
                name,
                url: document.getElementById('accountingWebUrlInput').value.trim(),
                note: document.getElementById('accountingWebNoteInput').value.trim(),
                expanded: false
            });
            accountingSaveWebStorage();
            accountingRenderWebList();
            document.getElementById('accountingWebCreateCard').style.display = 'none';
            document.getElementById('accountingWebNameInput').value = '';
            document.getElementById('accountingWebUrlInput').value = '';
            document.getElementById('accountingWebNoteInput').value = '';
        });
    }

    console.log('📊 记账模块脚本已就绪，等待 initAccountingModule() 调用');
})();