// ============================================
// 记账与月经预测模块 - accounting.js
// 版本：v2.2 (生理状态控制与绑防重复版)
// ============================================

(function() {
    "use strict";

    // 模块统一入口
    window.initAccountingModule = function() {
        console.log('📊 记账与月经预测模块已加载');
        accountingLoadData();
        menstrualLoadData();
        accountingLoadCollectionData();
        accountingSetActiveType('income');
        accountingRenderCalendar();
        accountingBindEvents();
    };

    // ==================== 状态库 ====================
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

    // 月经期周期数据
    let menstrualPeriods = []; // 元素结构：[{ id, startDate, endDate }]
    let menstrualSettings = { defaultInterval: 28, defaultDuration: 5 };
    let menstrualDailyLogs = {}; // 元素结构：{ 'YYYY-MM-DD': { flow, pain, sleep, digestion, log } }

    // ==================== 通用工具函数 ====================
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

    // ==================== 待办事项管理 ====================
    function accountingLoadTodos(dateStr) {
        const key = ACCOUNTING_TODO_PREFIX + dateStr;
        const stored = localStorage.getItem(key);
        if (stored) { try { return JSON.parse(stored); } catch (e) { return []; } }
        return [];
    }

    function accountingSaveTodos(dateStr, todos) {
        localStorage.setItem(ACCOUNTING_TODO_PREFIX + dateStr, JSON.stringify(todos));
    }

    // ==================== 记账收支计算 ====================
    function accountingCalcMonthExpense(year, month) {
        return accountingTransactions
            .filter(t => {
                if (t.type !== 'expense') return false;
                const d = new Date(t.date);
                return d.getFullYear() === year && d.getMonth() === month;
            })
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    }

    // ==================== 数据持久化与装载 ====================
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

    // ==================== 月经期生理预测逻辑 ====================
    function menstrualLoadData() {
        try {
            const p = localStorage.getItem('menstrual_periods_v1');
            menstrualPeriods = p ? JSON.parse(p) : [];
            const s = localStorage.getItem('menstrual_settings_v1');
            menstrualSettings = s ? JSON.parse(s) : { defaultInterval: 28, defaultDuration: 5 };
            const l = localStorage.getItem('menstrual_daily_logs_v1');
            menstrualDailyLogs = l ? JSON.parse(l) : {};
        } catch(e) {
            menstrualPeriods = [];
            menstrualSettings = { defaultInterval: 28, defaultDuration: 5 };
            menstrualDailyLogs = {};
        }
    }

    function menstrualSaveAll() {
        menstrualPeriods = menstrualMergePeriods(menstrualPeriods);
        localStorage.setItem('menstrual_periods_v1', JSON.stringify(menstrualPeriods));
        localStorage.setItem('menstrual_settings_v1', JSON.stringify(menstrualSettings));
        localStorage.setItem('menstrual_daily_logs_v1', JSON.stringify(menstrualDailyLogs));
    }

    // 生理期自动合并逻辑（若相邻两次记录的时间相隔不超过 2 天，自动合并为一个周期）
    function menstrualMergePeriods(periods) {
        if (periods.length <= 1) return periods;
        periods.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
        
        const merged = [];
        let current = JSON.parse(JSON.stringify(periods[0]));
        
        for (let i = 1; i < periods.length; i++) {
            const next = periods[i];
            const currentEnd = new Date(current.endDate);
            const nextStart = new Date(next.startDate);
            
            const diffTime = nextStart - currentEnd;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) - 1;
            
            if (diffDays <= 2) {
                if (new Date(next.endDate) > currentEnd) {
                    current.endDate = next.endDate;
                }
            } else {
                merged.push(current);
                current = JSON.parse(JSON.stringify(next));
            }
        }
        merged.push(current);
        return merged;
    }

    function menstrualIsDateInActualPeriod(dateStr) {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return menstrualPeriods.some(p => {
            const start = new Date(p.startDate);
            const end = new Date(p.endDate);
            return date >= start && date <= end;
        });
    }

    // 开始行经：自动标记今天往后共 N 天为行经状态
    function menstrualAddPeriodSequence(startDateStr, duration) {
        const start = new Date(startDateStr);
        for (let i = 0; i < duration; i++) {
            const current = new Date(start);
            current.setDate(start.getDate() + i);
            const currentStr = accountingGetDateStr(current.getFullYear(), current.getMonth(), current.getDate());
            
            if (!menstrualIsDateInActualPeriod(currentStr)) {
                menstrualPeriods.push({
                    id: accountingGenId(),
                    startDate: currentStr,
                    endDate: currentStr
                });
            }
        }
        menstrualSaveAll();
    }

    // 行经结束于今日
    function menstrualEndPeriodOnDate(dateStr) {
        const targetDate = new Date(dateStr);
        let changed = false;
        
        menstrualPeriods.forEach(p => {
            const start = new Date(p.startDate);
            const end = new Date(p.endDate);
            
            if (targetDate >= start && targetDate <= end) {
                p.endDate = dateStr;
                changed = true;
            }
        });
        
        if (changed) {
            menstrualPeriods = menstrualMergePeriods(menstrualPeriods);
            menstrualSaveAll();
            accountingRenderCalendar();
            menstrualOpenPeriodPanel();
            showStatus('✅ 经期已结束于本日', 'success');
        }
    }

    // 清除今日行经记录（智能断开碎片）
    function menstrualClearDatePeriod(dateStr) {
        menstrualSetDatePeriod(dateStr, false);
        accountingRenderCalendar();
        menstrualOpenPeriodPanel();
        showStatus('✅ 经期记录已清除', 'success');
    }

    // 智能向后推算行经期，支持连续多月向后投影
    function menstrualGetPredictedPeriodDays(year, month) {
        const predictedDays = new Set();
        if (menstrualPeriods.length === 0) return predictedDays;
        
        const sorted = [...menstrualPeriods].sort((a,b) => new Date(b.startDate) - new Date(a.startDate));
        const latest = sorted[0];
        const latestStart = new Date(latest.startDate);
        
        const interval = menstrualSettings.defaultInterval || 28;
        const duration = menstrualSettings.defaultDuration || 5;
        
        for (let i = 1; i <= 12; i++) {
            const predStart = new Date(latestStart);
            predStart.setDate(latestStart.getDate() + (i * interval));
            
            for (let d = 0; d < duration; d++) {
                const currentPredDay = new Date(predStart);
                currentPredDay.setDate(predStart.getDate() + d);
                
                if (currentPredDay.getFullYear() === year && currentPredDay.getMonth() === month) {
                    const dayStr = accountingGetDateStr(year, month, currentPredDay.getDate());
                    predictedDays.add(dayStr);
                }
            }
        }
        return predictedDays;
    }

    // 获取特定年份月份的排卵期和黄体期预测
    function menstrualGetPhasesForYearMonth(year, month) {
        const ovulationDays = new Set();
        const lutealDays = new Set();
        const interval = menstrualSettings.defaultInterval || 28;

        // 收集所有的行经开始基准点 (包括实际开始和预测的未来开始点)
        const cycleStarts = [];
        
        menstrualPeriods.forEach(p => {
            cycleStarts.push(new Date(p.startDate));
        });

        menstrualPeriods.forEach(p => {
            const start = new Date(p.startDate);
            for (let i = 1; i <= 12; i++) {
                const predStart = new Date(start);
                predStart.setDate(start.getDate() + (i * interval));
                cycleStarts.push(predStart);
            }
        });

        // 基于每一个行经点，向前计算排卵期与黄体期
        cycleStarts.forEach(start => {
            const nextStart = new Date(start);
            nextStart.setDate(start.getDate() + interval);

            // 排卵期 (Ovulation window)：下个经期前19天至前14天 (共6天)
            const ovulationStart = new Date(nextStart);
            ovulationStart.setDate(nextStart.getDate() - 19);
            const ovulationEnd = new Date(nextStart);
            ovulationEnd.setDate(nextStart.getDate() - 14);

            // 黄体期 (Luteal phase)：下个经期前13天至前1天
            const lutealStart = new Date(nextStart);
            lutealStart.setDate(nextStart.getDate() - 13);
            const lutealEnd = new Date(nextStart);
            lutealEnd.setDate(nextStart.getDate() - 1);

            for (let d = new Date(ovulationStart); d <= ovulationEnd; d.setDate(d.getDate() + 1)) {
                if (d.getFullYear() === year && d.getMonth() === month) {
                    ovulationDays.add(accountingGetDateStr(year, month, d.getDate()));
                }
            }
            for (let d = new Date(lutealStart); d <= lutealEnd; d.setDate(d.getDate() + 1)) {
                if (d.getFullYear() === year && d.getMonth() === month) {
                    lutealDays.add(accountingGetDateStr(year, month, d.getDate()));
                }
            }
        });

        return { ovulationDays, lutealDays };
    }

    function menstrualSetDatePeriod(dateStr, isPeriod) {
        if (isPeriod) {
            if (menstrualIsDateInActualPeriod(dateStr)) return;
            menstrualPeriods.push({
                id: accountingGenId(),
                startDate: dateStr,
                endDate: dateStr
            });
        } else {
            const newPeriods = [];
            const targetDate = new Date(dateStr);
            
            menstrualPeriods.forEach(p => {
                const start = new Date(p.startDate);
                const end = new Date(p.endDate);
                
                if (targetDate >= start && targetDate <= end) {
                    const leftEnd = new Date(targetDate);
                    leftEnd.setDate(targetDate.getDate() - 1);
                    if (leftEnd >= start) {
                        newPeriods.push({
                            id: accountingGenId(),
                            startDate: p.startDate,
                            endDate: accountingGetDateStr(leftEnd.getFullYear(), leftEnd.getMonth(), leftEnd.getDate())
                        });
                    }
                    const rightStart = new Date(targetDate);
                    rightStart.setDate(targetDate.getDate() + 1);
                    if (rightStart <= end) {
                        newPeriods.push({
                            id: accountingGenId(),
                            startDate: accountingGetDateStr(rightStart.getFullYear(), rightStart.getMonth(), rightStart.getDate()),
                            endDate: p.endDate
                        });
                    }
                } else {
                    newPeriods.push(p);
                }
            });
            menstrualPeriods = newPeriods;
        }
        menstrualSaveAll();
    }

    // 绑定多组生理状态打分组件的事件监听
    function menstrualSetupSelectGroups() {
        const groups = ['menstrualFlowGroup', 'menstrualPainGroup', 'menstrualSleepGroup', 'menstrualDigestionGroup'];
        groups.forEach(gId => {
            const el = document.getElementById(gId);
            if (!el) return;
            el.querySelectorAll('.select-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    el.querySelectorAll('.select-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        });
    }

    function menstrualGetSelectGroupValue(gId) {
        const el = document.getElementById(gId);
        if (!el) return null;
        const active = el.querySelector('.select-btn.active');
        return active ? active.dataset.value : null;
    }

    function menstrualSetSelectGroupValue(gId, val) {
        const el = document.getElementById(gId);
        if (!el) return;
        el.querySelectorAll('.select-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === val);
        });
    }

    function menstrualLoadDailyLogForDate(dateStr) {
        const log = menstrualDailyLogs[dateStr] || { flow: 'medium', pain: 'none', sleep: 'good', digestion: 'normal', log: '' };
        menstrualSetSelectGroupValue('menstrualFlowGroup', log.flow);
        menstrualSetSelectGroupValue('menstrualPainGroup', log.pain);
        menstrualSetSelectGroupValue('menstrualSleepGroup', log.sleep);
        menstrualSetSelectGroupValue('menstrualDigestionGroup', log.digestion);
        const textarea = document.getElementById('menstrualDailyLogText');
        if (textarea) textarea.value = log.log || '';
    }

    function menstrualUpdatePredictionCard() {
        const detailsEl = document.getElementById('menstrualPredictionDetails');
        if (!detailsEl) return;
        
        if (menstrualPeriods.length === 0) {
            detailsEl.innerHTML = '<div style="color:var(--tech-text-muted); text-align:center;">请添加行经记录以激活预测分析</div>';
            return;
        }
        
        const sorted = [...menstrualPeriods].sort((a,b) => new Date(b.startDate) - new Date(a.startDate));
        const latest = sorted[0];
        
        let totalDuration = 0;
        menstrualPeriods.forEach(p => {
            const dStart = new Date(p.startDate);
            const dEnd = new Date(p.endDate);
            const diffDays = Math.ceil((dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1;
            totalDuration += diffDays;
        });
        const avgDuration = (totalDuration / menstrualPeriods.length).toFixed(1);
        
        const latestStart = new Date(latest.startDate);
        const interval = menstrualSettings.defaultInterval || 28;
        const nextStart = new Date(latestStart);
        nextStart.setDate(latestStart.getDate() + interval);
        
        const nextStartStr = accountingGetDateStr(nextStart.getFullYear(), nextStart.getMonth(), nextStart.getDate());
        
        detailsEl.innerHTML = `
            <div class="prediction-item">
                <span class="pred-label">行经总次数</span>
                <span class="pred-val">${menstrualPeriods.length} 次记录</span>
            </div>
            <div class="prediction-item">
                <span class="pred-label">平均行经天数</span>
                <span class="pred-val">${avgDuration} 天</span>
            </div>
            <div class="prediction-item">
                <span class="pred-label">上期行经</span>
                <span class="pred-val">${latest.startDate} 至 ${latest.endDate}</span>
            </div>
            <div class="prediction-item future-highlight">
                <span class="pred-label">下期行经预测</span>
                <span class="pred-val">${nextStartStr} 起</span>
            </div>
        `;
    }

    function menstrualOpenPeriodPanel() {
        if (!accountingSelectedDateStr) return;
        const display = document.getElementById('menstrualDateLabel');
        if (display) display.textContent = accountingSelectedDateStr;
        
        const inPeriod = menstrualIsDateInActualPeriod(accountingSelectedDateStr);
        const statusText = document.getElementById('menstrualStatusText');
        const btnContainer = document.getElementById('menstrualButtonContainer');
        const logCard = document.getElementById('menstrualLogFormCard');
        
        if (btnContainer) {
            if (inPeriod) {
                if (statusText) statusText.textContent = '今日处于行经状态';
                btnContainer.innerHTML = `
                    <button id="menstrualEndTodayBtn" class="menstrual-action-btn" style="flex:1; background: var(--tech-pink-primary); color: var(--tech-pink-dark);">结束于今日</button>
                    <button id="menstrualClearTodayBtn" class="menstrual-action-btn" style="flex:1; background: rgba(0,0,0,0.05); color: var(--tech-text-dark); border: 1px solid var(--tech-border-blue);">清除今日记录</button>
                `;
                if (logCard) logCard.style.display = 'block';
                
                // 绑定多功能状态切换按钮 (动态覆盖旧事件)
                document.getElementById('menstrualEndTodayBtn').addEventListener('click', () => {
                    menstrualEndPeriodOnDate(accountingSelectedDateStr);
                });
                document.getElementById('menstrualClearTodayBtn').addEventListener('click', () => {
                    menstrualClearDatePeriod(accountingSelectedDateStr);
                });
            } else {
                if (statusText) statusText.textContent = '今日非行经状态';
                btnContainer.innerHTML = `
                    <button id="menstrualStartBtn" class="menstrual-action-btn primary" style="flex:1;">开始行经</button>
                `;
                if (logCard) logCard.style.display = 'none';
                
                document.getElementById('menstrualStartBtn').addEventListener('click', () => {
                    const duration = menstrualSettings.defaultDuration || 5;
                    menstrualAddPeriodSequence(accountingSelectedDateStr, duration);
                    menstrualOpenPeriodPanel(); // 刷新内部按钮绑定状态
                    accountingRenderCalendar(); // 刷新日历
                });
            }
        }
        
        menstrualLoadDailyLogForDate(accountingSelectedDateStr);
        
        const intervalInput = document.getElementById('menstrualIntervalInput');
        const durationInput = document.getElementById('menstrualDurationInput');
        if (intervalInput) intervalInput.value = menstrualSettings.defaultInterval;
        if (durationInput) durationInput.value = menstrualSettings.defaultDuration;
        
        menstrualUpdatePredictionCard();
        
        const panel = document.getElementById('accountingReservedDetailPanel');
        if (panel) panel.style.display = 'block';
    }

    // ==================== UI 概要更新 ====================
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

    // ==================== 日历核心渲染 ====================
    function accountingRenderCalendar() {
        const year = accountingCurrentYear, month = accountingCurrentMonth;
        const firstDay = new Date(year, month, 1);
        let startDayOfWeek = firstDay.getDay();
        startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const prevMonthDays = new Date(year, month, 0).getDate();
        let cellsHtml = '';

        // 当前月份的经期行经预测映射
        const predictedDays = menstrualGetPredictedPeriodDays(year, month);
        // 获取排卵期与黄体期
        const phases = menstrualGetPhasesForYearMonth(year, month);

        // 补全上月
        for (let i = startDayOfWeek - 1; i >= 0; i--) {
            const d = prevMonthDays - i;
            const dateStr = accountingGetDateStr(year, month - 1, d);
            const totals = accountingGetDayTotal(dateStr);
            
            let periodClass = 'other-month';
            if (menstrualIsDateInActualPeriod(dateStr)) {
                periodClass += ' period-actual';
                const log = menstrualDailyLogs[dateStr];
                if (log && log.flow) periodClass += ` period-actual-${log.flow}`;
                else periodClass += ' period-actual-medium';
            }
            
            cellsHtml += `<div class="calendar-day ${periodClass}" data-date="${dateStr}">
                <div class="day-number">${d}</div>
                <div class="day-indicators">
                    <div class="day-income">${totals.income > 0 ? '+' + totals.income.toFixed(0) : ''}</div>
                    <div class="day-expense">${totals.expense > 0 ? '-' + totals.expense.toFixed(0) : ''}</div>
                </div>
            </div>`;
        }

        // 渲染本月天数
        const todayStr = accountingGetDateStr(new Date());
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = accountingGetDateStr(year, month, d);
            const totals = accountingGetDayTotal(dateStr);
            const isToday = (dateStr === todayStr) ? 'today-cell' : '';
            
            let periodClass = '';
            if (menstrualIsDateInActualPeriod(dateStr)) {
                periodClass = 'period-actual';
                const log = menstrualDailyLogs[dateStr];
                if (log && log.flow) periodClass += ` period-actual-${log.flow}`;
                else periodClass += ' period-actual-medium';
            } else if (predictedDays.has(dateStr)) {
                periodClass = 'period-predicted';
            } else if (phases.ovulationDays.has(dateStr)) {
                periodClass = 'period-ovulation';
            } else if (phases.lutealDays.has(dateStr)) {
                periodClass = 'period-luteal';
            }

            cellsHtml += `<div class="calendar-day ${isToday} ${periodClass}" data-date="${dateStr}">
                <div class="day-number">${d}</div>
                <div class="day-indicators">
                    <div class="day-income">${totals.income > 0 ? '+' + totals.income.toFixed(0) : ''}</div>
                    <div class="day-expense">${totals.expense > 0 ? '-' + totals.expense.toFixed(0) : ''}</div>
                </div>
            </div>`;
        }

        // 补全下月占位
        const totalCells = 42;
        const rendered = startDayOfWeek + daysInMonth;
        for (let i = rendered; i < totalCells; i++) {
            const nextD = i - rendered + 1;
            const dateStr = accountingGetDateStr(year, month + 1, nextD);
            const totals = accountingGetDayTotal(dateStr);
            
            let periodClass = 'other-month';
            if (menstrualIsDateInActualPeriod(dateStr)) {
                periodClass += ' period-actual';
                const log = menstrualDailyLogs[dateStr];
                if (log && log.flow) periodClass += ` period-actual-${log.flow}`;
                else periodClass += ' period-actual-medium';
            }
            
            cellsHtml += `<div class="calendar-day ${periodClass}" data-date="${dateStr}">
                <div class="day-number">${nextD}</div>
                <div class="day-indicators">
                    <div class="day-income">${totals.income > 0 ? '+' + totals.income.toFixed(0) : ''}</div>
                    <div class="day-expense">${totals.expense > 0 ? '-' + totals.expense.toFixed(0) : ''}</div>
                </div>
            </div>`;
        }

        const container = document.getElementById('accountingCalendarDaysContainer');
        if (container) container.innerHTML = cellsHtml;

        const monthDisplay = document.getElementById('accountingCurrentMonthDisplay');
        if (monthDisplay) monthDisplay.textContent = `${year}年 ${month + 1}月`;

        accountingUpdateSummary();

        // 绑定天数点击
        document.querySelectorAll('#accountingCalendarDaysContainer .calendar-day').forEach(el => {
            el.addEventListener('click', function() {
                accountingOpenTransitionPanel(this.dataset.date);
            });
        });
    }

    // ==================== 面板导航交互 ====================
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

    function accountingOpenCollectionPanel() {
        const panel = document.getElementById('accountingCollectionPanel');
        if (panel) panel.style.display = 'block';
        accountingSwitchCollectionTab('api');
        accountingRefreshCollectionViews();
    }

    // ==================== 收支表单处理 ====================
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
            listEl.innerHTML = '<li class="accounting-empty-msg" style="text-align:center; padding:12px; color:var(--tech-text-muted);">暂无收支明细</li>';
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
                    <button class="accounting-delete-btn" data-id="${t.id}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
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

    // ==================== 待办渲染逻辑 ====================
    function accountingRenderTodoList() {
        if (!accountingSelectedDateStr) return;
        const todos = accountingLoadTodos(accountingSelectedDateStr);
        const sorted = [...todos].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0));
        const container = document.getElementById('accountingTodoListContainer');
        if (!container) return;

        if (sorted.length === 0) {
            container.innerHTML = '<li class="accounting-empty-msg" style="text-align:center; padding:12px; color:var(--tech-text-muted);">当前日期暂无待办</li>';
            return;
        }

        let html = '';
        sorted.forEach(todo => {
            const checkedAttr = todo.completed ? 'checked' : '';
            const completedClass = todo.completed ? 'accounting-todo-completed' : '';
            html += `<li class="accounting-todo-item ${completedClass}" data-id="${todo.id}">
                <input type="checkbox" class="accounting-todo-check" ${checkedAttr}>
                <span class="accounting-todo-text">${escapeHtml(todo.text)}</span>
                <button class="accounting-todo-delete-btn">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
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

    // ==================== 添加记账记录 ====================
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

    // ==================== 收藏室渲染 ====================
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
            container.innerHTML = '<div class="accounting-empty-message" style="text-align:center; padding:12px; color:var(--tech-text-muted);">暂无配置的API</div>';
            return;
        }
        let html = '';
        accountingApiItems.forEach(item => {
            html += `<div class="accounting-item-card ${item.expanded ? 'expanded' : ''}" data-api-id="${item.id}">
                <div class="accounting-item-header" data-action="toggle-api" data-id="${item.id}" style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="accounting-item-name">${escapeHtml(item.name) || '未命名'}</span>
                    <div style="display:flex; align-items:center;">
                        <button class="accounting-delete-btn" data-action="delete-api" data-id="${item.id}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
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
            container.innerHTML = '<div class="accounting-empty-message" style="text-align:center; padding:12px; color:var(--tech-text-muted);">暂无网页收藏</div>';
            return;
        }
        let html = '';
        accountingWebItems.forEach(item => {
            html += `<div class="accounting-item-card ${item.expanded ? 'expanded' : ''}" data-web-id="${item.id}">
                <div class="accounting-item-header" data-action="toggle-web" data-id="${item.id}" style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="accounting-item-name">${escapeHtml(item.name) || '未命名'}</span>
                    <div style="display:flex; align-items:center;">
                        <button class="accounting-delete-btn" data-action="delete-web" data-id="${item.id}">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
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
                if (e.target.closest('.accounting-delete-btn')) return;
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
                if (confirm(`删除当前项目？`)) {
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

    // ==================== 全局 DOM 事件绑定 (带防重复绑定守卫) ====================
    window.accountingEventsBound = window.accountingEventsBound || false;

    function accountingBindEvents() {
        if (window.accountingEventsBound) {
            console.log('📊 记账模块事件已经绑定，跳过重复绑定机制');
            return;
        }
        window.accountingEventsBound = true;

        // 月份导航
        const prevBtn = document.getElementById('accountingPrevMonthBtn');
        prevBtn?.addEventListener('click', () => {
            if (accountingCurrentMonth === 0) { accountingCurrentMonth = 11; accountingCurrentYear--; } 
            else { accountingCurrentMonth--; }
            accountingRenderCalendar();
        });

        const nextBtn = document.getElementById('accountingNextMonthBtn');
        nextBtn?.addEventListener('click', () => {
            if (accountingCurrentMonth === 11) { accountingCurrentMonth = 0; accountingCurrentYear++; } 
            else { accountingCurrentMonth++; }
            accountingRenderCalendar();
        });

        const todayBtn = document.getElementById('accountingTodayBtn');
        todayBtn?.addEventListener('click', () => {
            const today = new Date();
            accountingCurrentYear = today.getFullYear();
            accountingCurrentMonth = today.getMonth();
            accountingRenderCalendar();
            const y = today.getFullYear();
            const m = String(today.getMonth() + 1).padStart(2, '0');
            const d = String(today.getDate()).padStart(2, '0');
            accountingOpenTransitionPanel(`${y}-${m}-${d}`);
        });

        // 预算管理
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

        // 经期生理参数设置
        document.getElementById('menstrualSaveSettingsBtn')?.addEventListener('click', () => {
            const interval = parseInt(document.getElementById('menstrualIntervalInput').value);
            const duration = parseInt(document.getElementById('menstrualDurationInput').value);
            if (interval > 0 && duration > 0) {
                menstrualSettings.defaultInterval = interval;
                menstrualSettings.defaultDuration = duration;
                menstrualSaveAll();
                accountingRenderCalendar();
                menstrualUpdatePredictionCard();
                alert('生理周期参数已成功更新');
            }
        });

        // 生理日志保存
        document.getElementById('menstrualSaveLogBtn')?.addEventListener('click', () => {
            const dateStr = accountingSelectedDateStr;
            if (!dateStr) return;
            
            menstrualDailyLogs[dateStr] = {
                flow: menstrualGetSelectGroupValue('menstrualFlowGroup'),
                pain: menstrualGetSelectGroupValue('menstrualPainGroup'),
                sleep: menstrualGetSelectGroupValue('menstrualSleepGroup'),
                digestion: menstrualGetSelectGroupValue('menstrualDigestionGroup'),
                log: document.getElementById('menstrualDailyLogText').value.trim()
            };
            menstrualSaveAll();
            alert('生理状态日志保存成功');
            // 数据有变时，日记要进行深度重绘以显示血量对应的色彩深度
            accountingRenderCalendar();
        });

        // 返回日历
        document.getElementById('accountingBackToCalendarFromTransition')?.addEventListener('click', () => {
            accountingCloseAllPanels();
            accountingRenderCalendar();
        });

        // 过渡面板事件分发
        document.querySelectorAll('.accounting-transition-card').forEach(card => {
            card.addEventListener('click', () => {
                const target = card.dataset.target;
                const panel = document.getElementById('accountingTransitionPanel');
                if (panel) panel.style.display = 'none';
                
                if (target === 'ledger') accountingOpenLedgerPanel();
                else if (target === 'todo') accountingOpenTodoPanel();
                else if (target === 'reserved') menstrualOpenPeriodPanel();
                else if (target === 'collection') accountingOpenCollectionPanel();
            });
        });

        // 返回过渡面板
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

        // 收藏室
        document.getElementById('accountingCollectionEntranceBtn')?.addEventListener('click', () => {
            accountingOpenCollectionPanel();
        });

        // 记账表单
        document.getElementById('accountingAddTransactionBtn')?.addEventListener('click', accountingAddTransaction);
        document.getElementById('accountingAmountInput')?.addEventListener('keypress', e => { 
            if (e.key === 'Enter') accountingAddTransaction(); 
        });

        // 收支类型
        document.querySelectorAll('.accounting-type-btn').forEach(btn => {
            btn.addEventListener('click', () => accountingSetActiveType(btn.dataset.type));
        });

        // 待办添加
        document.getElementById('accountingAddTodoBtn')?.addEventListener('click', accountingAddTodo);
        document.getElementById('accountingNewTodoInput')?.addEventListener('keypress', e => { 
            if (e.key === 'Enter') accountingAddTodo(); 
        });

        // 收藏室选项卡
        document.querySelectorAll('.accounting-collection-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => accountingSwitchCollectionTab(btn.dataset.collectionTab));
        });

        // 新建 API 配置
        document.getElementById('accountingShowApiFormBtn')?.addEventListener('click', () => {
            document.getElementById('accountingApiCreateCard').style.display = 'block';
        });
        document.getElementById('accountingCancelApiBtn')?.addEventListener('click', () => {
            document.getElementById('accountingApiCreateCard').style.display = 'none';
        });
        document.getElementById('accountingSaveApiBtn')?.addEventListener('click', () => {
            const name = document.getElementById('accountingApiNameInput').value.trim();
            if (!name) { alert('请填写名称'); return; }
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

        // 新建网页
        document.getElementById('accountingShowWebFormBtn')?.addEventListener('click', () => {
            document.getElementById('accountingWebCreateCard').style.display = 'block';
        });
        document.getElementById('accountingCancelWebBtn')?.addEventListener('click', () => {
            document.getElementById('accountingWebCreateCard').style.display = 'none';
        });
        document.getElementById('accountingSaveWebBtn')?.addEventListener('click', () => {
            const name = document.getElementById('accountingWebNameInput').value.trim();
            if (!name) { alert('请填写名称'); return; }
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

        // 绑定打分按钮组 (只需在此绑定一次)
        menstrualSetupSelectGroups();
    }

    console.log('📊 记账与月经预测模块脚本就绪，等待 initAccountingModule() 被触发调用');
})();