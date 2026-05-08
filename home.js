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
    async function ensureStore() {
        const d = await DB._rawDB || await openHomeDB();
        if (!d.objectStoreNames.contains(STORE)) {
            d.close();
            const DB_NAME = 'CompanionDB_V18';
            // 通过 DB 的 put 自动创建
        }
    }

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
        el.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const dataUrl = await compressImage(file, 400, 400, 0.85);
                el.style.backgroundImage = `url('${dataUrl}')`;
                el.classList.add('has-image');
                await setHomeSetting(storageKey, dataUrl);
            };
            input.click();
        });
    }

    // ========== 加载持久化数据 ==========
    async function loadAllPersistedData() {
        // 名片背景
        const upperBg = await getHomeSetting(KEYS.namecardUpperBg, '');
        if (upperBg) {
            ncUpper.style.backgroundImage = `url('${upperBg}')`;
            ncUpper.classList.add('has-image');
        }
        // 名片头像
        const avatar = await getHomeSetting(KEYS.namecardAvatar, '');
        if (avatar) {
            ncAvatar.style.backgroundImage = `url('${avatar}')`;
            ncAvatar.classList.add('has-image');
        }
        // 名片文字
        const title = await getHomeSetting(KEYS.namecardTitle, '');
        const body = await getHomeSetting(KEYS.namecardBody, '');
        if (title) ncTitle.innerText = title;
        if (body) ncBody.innerText = body;

        // 照片 B
        const imgB = await getHomeSetting(KEYS.photoB, '');
        if (imgB) {
            photoB.style.backgroundImage = `url('${imgB}')`;
            photoB.classList.add('has-image');
        }

        // 照片 D
        const imgD = await getHomeSetting(KEYS.photoD, '');
        if (imgD) {
            photoD.style.backgroundImage = `url('${imgD}')`;
            photoD.classList.add('has-image');
        }

        // 拍立得
        const polaroidKeys = [KEYS.polaroid0, KEYS.polaroid1, KEYS.polaroid2];
        for (let i = 0; i < polaroidPhotos.length; i++) {
            const img = await getHomeSetting(polaroidKeys[i], '');
            if (img) {
                polaroidPhotos[i].style.backgroundImage = `url('${img}')`;
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
        await ensureStore();

        // 锁屏
        updateClock();
        setInterval(updateClock, 1000);
        applyLockscreenWallpaper();

        lockscreen.addEventListener('click', hideLockscreen);
        let startY = 0;
        lockscreen.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; });
        lockscreen.addEventListener('touchend', (e) => {
            const endY = e.changedTouches[0].clientY;
            if (startY - endY > 30) hideLockscreen();
        });

        // 翻页
        let touchStartX = 0;
        homeMain.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; });
        homeMain.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            if (Math.abs(dx) > 50) {
                if (dx < 0 && currentPage === 1) goToPage(2);
                if (dx > 0 && currentPage === 2) goToPage(1);
            }
        });

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

        // 加载数据
        await loadAllPersistedData();
        await renderAllIcons();
        bindNavigationEvents();

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