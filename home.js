
/* ========== iOS Safari / PWA 高度适配补丁 ========== */
(function () {
    var isIOS =
        /iP(ad|hone|od)/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 非 iOS 直接退出，不影响安卓和桌面。
    if (!isIOS) return;

    document.documentElement.classList.add('is-ios');

    var isStandalone =
        window.navigator.standalone ||
        window.matchMedia('(display-mode: standalone)').matches;

    if (isStandalone) {
        document.documentElement.classList.add('is-pwa');
    }

    function setIOSAppHeight() {
        // iOS PWA 独立模式：
        // 用 100vh，不用 innerHeight / visualViewport，避免冷启动高度偏小。
        if (isStandalone) {
            document.documentElement.style.setProperty('--ios-app-height', '100vh');
            document.documentElement.style.setProperty('--app-height', '100vh');
            return;
        }

        // 普通 iOS Safari：
        // 用 visualViewport 适配地址栏展开/收起。
        var vv = window.visualViewport;
        var h = vv ? vv.height : window.innerHeight;

        h = Math.round(h);

        document.documentElement.style.setProperty('--ios-app-height', h + 'px');
        document.documentElement.style.setProperty('--app-height', h + 'px');
    }

    function refreshIOSAppHeight() {
        setIOSAppHeight();

        // 只有普通 Safari 需要多次刷新。
        // PWA standalone 不重复测量，避免 cold start 被错误值覆盖。
        if (!isStandalone) {
            setTimeout(setIOSAppHeight, 60);
            setTimeout(setIOSAppHeight, 300);
            setTimeout(setIOSAppHeight, 800);
        }
    }

    refreshIOSAppHeight();

    window.addEventListener('resize', refreshIOSAppHeight);
    window.addEventListener('orientationchange', refreshIOSAppHeight);
    window.addEventListener('pageshow', refreshIOSAppHeight);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', refreshIOSAppHeight);
        window.visualViewport.addEventListener('scroll', refreshIOSAppHeight);
    }
})();



/* ========== 首页模块 ========== */
window.initHomeModule = function({ DB, showStatus, switchPage, refreshConversationList, getAvatarColor, compressImage }) {

    // ========== 存储 key 常量 ==========
    const STORE = 'homeSettings';
    const KEYS = {
        namecardUpperBg: 'namecard_upperBg',
        namecardAvatar: 'namecard_avatar',
        namecardTitle: 'namecard_title',
        namecardBody: 'namecard_body',
        photoB: 'photo_b',
        photoD: 'photo_d',
        polaroid0: 'polaroid_0',
        polaroid1: 'polaroid_1',
        polaroid2: 'polaroid_2'
    };

    // ========== 初始化 DB store ==========
    async function getHomeSetting(key, def = null) {
        try {
            const val = await DB.get(STORE, key);
            return val ? val.value : def;
        } catch (e) {
            return def;
        }
    }

    async function setHomeSetting(key, value) {
        await DB.put(STORE, { key, value });
    }

    // ========== DOM 引用 ==========
    const lockscreen = document.getElementById('lockscreen');
    const homeMain = document.getElementById('homeMain');
    const pagesTrack = document.getElementById('pagesTrack');
    const dot1 = document.getElementById('dot1');
    const dot2 = document.getElementById('dot2');

    const ncUpper = document.getElementById('ncUpper');
    const ncAvatar = document.getElementById('ncAvatar');
    const ncTitle = document.getElementById('ncTitle');
    const ncBody = document.getElementById('ncBody');
    const photoB = document.getElementById('photoB');
    const photoD = document.getElementById('photoD');
    const polaroidPhotos = document.querySelectorAll('.polaroid-photo');

    let currentPage = 1;
    let isLocked = true;

    // ========== 锁屏逻辑 ==========
    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const dateStr = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;

        const timeEl = document.getElementById('lsTime');
        const dateEl = document.getElementById('lsDate');
        if (timeEl) timeEl.textContent = `${hours}:${minutes}`;
        if (dateEl) dateEl.textContent = dateStr;
    }

    function hideLockscreen() {
        if (!isLocked) return;
        isLocked = false;
        lockscreen.classList.add('hide');
        const blurBg = lockscreen.querySelector('.lockscreen-bg');
        if (blurBg) blurBg.style.display = 'none';
    }

    function applyLockscreenWallpaper() {
        // 复用 themeSettings 中的壁纸
        const wallpaperData = localStorage.getItem('themeSettings_wallpaper');
        let bgStyle = 'background-color: #d8c8b8;';
        if (wallpaperData) {
            try {
                const parsed = JSON.parse(wallpaperData);
                const val = parsed.value || parsed;
                if (val && val !== 'default') {
                    if (val.startsWith('data:') || val.startsWith('http')) {
                        bgStyle = `background-image: url('${val}'); background-size: cover; background-position: center;`;
                    } else if (val === 'warm') {
                        bgStyle = 'background: linear-gradient(135deg, #f5e6d3 0%, #e8d5c4 100%);';
                    } else if (val === 'cool') {
                        bgStyle = 'background: linear-gradient(135deg, #d3e0f5 0%, #c4d4e8 100%);';
                    } else if (val === 'dark') {
                        bgStyle = 'background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);';
                    }
                }
            } catch (e) {}
        }
        const bgEl = lockscreen.querySelector('.lockscreen-bg');
        if (bgEl) bgEl.setAttribute('style', bgStyle);
    }

    // ========== 翻页逻辑 ==========
    function goToPage(n) {
        currentPage = n;
        if (n === 2) {
            pagesTrack.classList.add('page2');
            dot1.classList.remove('active');
            dot2.classList.add('active');
        } else {
            pagesTrack.classList.remove('page2');
            dot1.classList.add('active');
            dot2.classList.remove('active');
        }
    }

    // ========== 照片上传通用函数 ==========
    function setupPhotoUpload(el, storageKey) {
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.isContentEditable || e.target.closest('[contenteditable]')) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (ev) => {
            const file = ev.target.files[0];
            if (!file) return;
            const dataUrl = await compressImage(file, 800, 800, 0.9);
            el.style.backgroundImage = `url('${dataUrl}')`;
            el.classList.add('has-image');
            await setHomeSetting(storageKey, dataUrl);
        };
        input.click();
    });
}

    // ========== 加载持久化数据 ==========
    async function loadAllPersistedData() {
    const [upperBg, avatar, title, body, imgB, imgD, p0, p1, p2] = await Promise.all([
        getHomeSetting(KEYS.namecardUpperBg, ''),
        getHomeSetting(KEYS.namecardAvatar, ''),
        getHomeSetting(KEYS.namecardTitle, ''),
        getHomeSetting(KEYS.namecardBody, ''),
        getHomeSetting(KEYS.photoB, ''),
        getHomeSetting(KEYS.photoD, ''),
        getHomeSetting(KEYS.polaroid0, ''),
        getHomeSetting(KEYS.polaroid1, ''),
        getHomeSetting(KEYS.polaroid2, '')
    ]);

    if (upperBg) { ncUpper.style.backgroundImage = `url('${upperBg}')`; ncUpper.classList.add('has-image'); }
    if (avatar) { ncAvatar.style.backgroundImage = `url('${avatar}')`; ncAvatar.classList.add('has-image'); }
    if (title) ncTitle.innerText = title;
    if (body) ncBody.innerText = body;
    if (imgB) { photoB.style.backgroundImage = `url('${imgB}')`; photoB.classList.add('has-image'); }
    if (imgD) { photoD.style.backgroundImage = `url('${imgD}')`; photoD.classList.add('has-image'); }

    const polaroidData = [p0, p1, p2];
    for (let i = 0; i < polaroidPhotos.length; i++) {
        if (polaroidData[i]) {
            polaroidPhotos[i].style.backgroundImage = `url('${polaroidData[i]}')`;
            polaroidPhotos[i].classList.add('has-image');
        }
    }
}

    // ========== 名片文字自动保存 ==========
    function setupEditableSave(el, storageKey, defaultText) {
        el.addEventListener('blur', async () => {
            const text = el.innerText.trim();
            if (!text) {
                el.innerText = defaultText;
                await setHomeSetting(storageKey, '');
            } else {
                await setHomeSetting(storageKey, text);
            }
        });
    }

    // ========== 图标渲染 ==========
    async function renderAllIcons() {
        const navIconSettings = await DB.getAll('navIconSettings');

        function applyIcon(el, navId) {
            const setting = navIconSettings.find(s => s.navId === navId);
            if (!setting) return;
            if (setting.image) {
                el.style.backgroundImage = `url('${setting.image}')`;
                el.style.backgroundColor = 'transparent';
                el.classList.add('has-custom-image');
                const emojiEl = el.querySelector('.app-icon-emoji, .dock-icon-emoji');
                if (emojiEl) emojiEl.style.display = 'none';
            }
        }

        // 应用图标
        document.querySelectorAll('.app-icon-item[data-nav]').forEach(item => {
            const navId = item.dataset.nav;
            const box = item.querySelector('.app-icon-box');
            if (box) applyIcon(box, navId);
        });

        // Dock 图标
        document.querySelectorAll('.dock-item[data-nav]').forEach(item => {
            const navId = item.dataset.nav;
            const box = item.querySelector('.dock-icon');
            if (box) applyIcon(box, navId);
        });

        // 短信占位
        const smsIcon = document.querySelector('.dock-item.disabled .dock-icon');
        if (smsIcon) applyIcon(smsIcon, 'sms');
    }

    // ========== 点击事件绑定 ==========
    function bindNavigationEvents() {
        document.querySelectorAll('.app-icon-item[data-nav]').forEach(el => {
            el.addEventListener('click', () => {
                const nav = el.dataset.nav;
                handleNavigation(nav);
            });
        });

        document.querySelectorAll('.dock-item[data-nav]').forEach(el => {
            el.addEventListener('click', () => {
                const nav = el.dataset.nav;
                handleNavigation(nav);
            });
        });
    }

    function handleNavigation(nav) {
        // 隐藏首页桌面
    document.getElementById('homeMain').style.display = 'none';
    document.querySelector('.home-dock').style.display = 'none';
    document.querySelector('.page-indicator').style.display = 'none';
    document.querySelector('.app-main').style.display = '';
        const pageMap = {
            'chat': 'chat',
            'worldbook': 'worldbook',
            'datamanager': 'datamanager',
            'settings': 'settings',
            'reunion': 'reunion',
            'forum': 'forum',
            'guangguang': 'guangguang',
            'accounting': 'accounting',
            'diary': 'diary',
            'theme': 'theme'
        };
        const pageId = pageMap[nav];
        if (pageId) {
            switchPage(pageId);
        }
    }

    // ========== 初始化 ==========
async function init() {
    // 锁屏
    updateClock();
    setInterval(updateClock, 1000);
    applyLockscreenWallpaper();

    lockscreen.addEventListener('click', hideLockscreen);
    let startY = 0;
    lockscreen.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
    lockscreen.addEventListener('touchend', (e) => {
        const endY = e.changedTouches[0].clientY;
        if (startY - endY > 30) hideLockscreen();
    }, { passive: true });

    // 翻页
    let touchStartX = 0;
    homeMain.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    homeMain.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
            if (dx < 0 && currentPage === 1) goToPage(2);
            if (dx > 0 && currentPage === 2) goToPage(1);
        }
    }, { passive: true });

    // 照片上传
    setupPhotoUpload(ncUpper, KEYS.namecardUpperBg);
    setupPhotoUpload(ncAvatar, KEYS.namecardAvatar);
    setupPhotoUpload(photoB, KEYS.photoB);
    setupPhotoUpload(photoD, KEYS.photoD);

    polaroidPhotos.forEach((el, idx) => {
        const keys = [KEYS.polaroid0, KEYS.polaroid1, KEYS.polaroid2];
        setupPhotoUpload(el, keys[idx]);
    });

    // 名片文字
    setupEditableSave(ncTitle, KEYS.namecardTitle, '晨曦海岸');
    setupEditableSave(ncBody, KEYS.namecardBody, '每一帧都是壁纸级的风景');

    // 先绑定导航事件，确保页面可点击
    bindNavigationEvents();

    // DB读取放在 try-catch 里，失败不阻塞页面
    try {
        await Promise.race([
            loadAllPersistedData(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB读取超时')), 5000))
        ]);
    } catch (e) {
        console.warn('⚠️ 首页数据加载失败或超时:', e.message);
    }

    try {
        await Promise.race([
            renderAllIcons(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('图标渲染超时')), 5000))
        ]);
    } catch (e) {
        console.warn('⚠️ 图标渲染失败或超时:', e.message);
    }

    // 监听壁纸变化，更新锁屏
    const origSetWallpaper = window._setThemeWallpaper;
    window._setThemeWallpaper = function(val) {
        if (origSetWallpaper) origSetWallpaper(val);
        localStorage.setItem('themeSettings_wallpaper', JSON.stringify({ key: 'wallpaper', value: val }));
        applyLockscreenWallpaper();
    };

    console.log('✅ 首页模块初始化完成');
}

    // ========== 暴露方法 ==========
    return {
        init,
        goToPage,
        hideLockscreen,
        refreshIcons: renderAllIcons
    };
};


/* ==================== APK键盘黑条修复补丁 ==================== */
(function() {
    "use strict";

    let baseHeight = window.innerHeight;
    let isKeyboardOpen = false;

    // 探测当前是否有活跃的输入框
    function checkInputFocused() {
        const activeEl = document.activeElement;
        return activeEl && (
            activeEl.tagName === 'INPUT' || 
            activeEl.tagName === 'TEXTAREA' || 
            activeEl.hasAttribute('contenteditable') ||
            activeEl.closest('[contenteditable]')
        );
    }

    // 记录非输入状态下的正常视口高度
    function updateBaseHeight() {
        if (!checkInputFocused()) {
            baseHeight = window.innerHeight;
        }
    }

    window.addEventListener('resize', () => {
        const activeEl = document.activeElement;
        const isFocused = checkInputFocused();

        if (isFocused) {
            isKeyboardOpen = true;
            // 键盘弹起时，强制维持原先的页面可视高度，防止 --app-height 突变坍塌
            document.documentElement.style.setProperty('--app-height', baseHeight + 'px');
            
            // 延迟将输入框平滑滚动至可视区域中央，防止其被软键盘完全遮挡
            setTimeout(() => {
                activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 150);
        } else {
            isKeyboardOpen = false;
            updateBaseHeight();
            document.documentElement.style.setProperty('--app-height', baseHeight + 'px');
        }
    });

    // 监听全局焦点进入事件
    document.addEventListener('focusin', (e) => {
        const target = e.target;
        const isInput = target && (
            target.tagName === 'INPUT' || 
            target.tagName === 'TEXTAREA' || 
            target.hasAttribute('contenteditable') || 
            target.closest('[contenteditable]')
        );

        if (isInput) {
            isKeyboardOpen = true;
            // 立即锁定容器高度，不给系统缩水 WebView 并产生黑底的机会
            document.documentElement.style.setProperty('--app-height', baseHeight + 'px');
            
            setTimeout(() => {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 80);
        }
    });

    // 监听全局焦点离开事件
    document.addEventListener('focusout', () => {
        isKeyboardOpen = false;
        setTimeout(() => {
            // 稍作延迟，确认没有新的输入框获得焦点后，恢复真实的屏幕尺寸计算
            if (!checkInputFocused()) {
                baseHeight = window.innerHeight;
                document.documentElement.style.setProperty('--app-height', baseHeight + 'px');
            }
        }, 150);
    });
})();