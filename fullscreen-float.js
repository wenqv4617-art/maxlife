/* =========================================================
 * fullscreen-float.js
 * 长按 API 悬浮窗：进入浏览器全屏 / 撑开模式
 * 依赖：#apiStatusFloat, .phone-mock
 * ========================================================= */
(function initFullscreenFloat() {
    "use strict";

    const LONG_PRESS_MS = 650;
    const MOVE_CANCEL_PX = 10;

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let longPressed = false;

    function isStandalonePWA() {
        return (
            window.matchMedia?.("(display-mode: standalone)")?.matches ||
            window.navigator.standalone === true
        );
    }

    function getPoint(e) {
        if (e.touches && e.touches[0]) return e.touches[0];
        if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
        return e;
    }

    function clearPressTimer() {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    }

    function ensureModal() {
        let modal = document.getElementById("floatFullscreenModal");
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = "floatFullscreenModal";
        modal.className = "float-fullscreen-modal";

        modal.innerHTML = `
            <div class="float-fullscreen-card">
                <div class="float-fullscreen-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
                        <path d="M16 3h3a2 2 0 0 1 2 2v3"/>
                        <path d="M8 21H5a2 2 0 0 1-2-2v-3"/>
                        <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
                    </svg>
                    <span>浏览器全屏</span>
                </div>
                <div class="float-fullscreen-desc" id="floatFullscreenDesc">
                    当前在浏览器中打开时，首页底部 Dock 可能遮挡第二页应用。进入全屏后页面会自动撑开，保持原本样式。
                </div>
                <div class="float-fullscreen-actions">
                    <button class="float-fullscreen-btn secondary" id="floatFullscreenCancelBtn">取消</button>
                    <button class="float-fullscreen-btn primary" id="floatFullscreenConfirmBtn">进入全屏</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener("click", function(e) {
            if (e.target === modal) closeModal();
        });

        modal.querySelector("#floatFullscreenCancelBtn").addEventListener("click", closeModal);
        modal.querySelector("#floatFullscreenConfirmBtn").addEventListener("click", async function() {
            closeModal();
            await enterBrowserFullscreen();
        });

        return modal;
    }

    function openModal() {
        const modal = ensureModal();
        const desc = modal.querySelector("#floatFullscreenDesc");
        const confirmBtn = modal.querySelector("#floatFullscreenConfirmBtn");

        if (isStandalonePWA()) {
            desc.textContent = "当前已经是安装后的 PWA 应用模式，一般不需要再手动全屏。";
            confirmBtn.textContent = "知道了";
            confirmBtn.onclick = closeModal;
        } else {
            desc.textContent = "当前在浏览器中打开时，首页底部 Dock 可能遮挡第二页应用。进入全屏后页面会自动撑开，保持原本样式。";
            confirmBtn.textContent = "进入全屏";
            confirmBtn.onclick = async function() {
                closeModal();
                await enterBrowserFullscreen();
            };
        }

        modal.classList.add("active");
    }

    function closeModal() {
        const modal = document.getElementById("floatFullscreenModal");
        if (modal) modal.classList.remove("active");
    }

    async function enterBrowserFullscreen() {
        const target = document.querySelector(".phone-mock") || document.documentElement;

        try {
            if (target.requestFullscreen) {
                await target.requestFullscreen();
                document.body.classList.remove("browser-fullscreen-fallback");
                return;
            }

            if (target.webkitRequestFullscreen) {
                target.webkitRequestFullscreen();
                document.body.classList.remove("browser-fullscreen-fallback");
                return;
            }

            // iOS Safari 通常不支持普通元素 requestFullscreen。
            // 这里启用 fallback：撑满可见区域。
            document.body.classList.add("browser-fullscreen-fallback");
        } catch (e) {
            console.warn("[fullscreen-float] requestFullscreen failed:", e);
            document.body.classList.add("browser-fullscreen-fallback");
        }
    }

    function exitFallbackIfNativeFullscreenExited() {
        const fsEl =
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            null;

        if (!fsEl) {
            // 原生全屏退出后不一定要关闭 fallback；
            // 这里只清理 native 状态，不影响用户手动 fallback。
        }
    }

    function bind() {
        const floatBtn = document.getElementById("apiStatusFloat");
        if (!floatBtn) {
            setTimeout(bind, 500);
            return;
        }

        // 捕获 click：长按后阻止原来的“点击打开 API 状态卡”
        document.addEventListener("click", function(e) {
            if (!longPressed) return;
            if (e.target.closest("#apiStatusFloat")) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                longPressed = false;
            }
        }, true);

        floatBtn.addEventListener("touchstart", function(e) {
            const p = getPoint(e);
            startX = p.clientX;
            startY = p.clientY;
            longPressed = false;
            clearPressTimer();

            pressTimer = setTimeout(function() {
                longPressed = true;
                window.__apiFloatLongPressed = true;
                openModal();
                setTimeout(function() {
                    window.__apiFloatLongPressed = false;
                }, 800);
            }, LONG_PRESS_MS);
        }, { passive: true });

        floatBtn.addEventListener("touchmove", function(e) {
            if (!pressTimer) return;
            const p = getPoint(e);
            const dx = Math.abs(p.clientX - startX);
            const dy = Math.abs(p.clientY - startY);
            if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearPressTimer();
        }, { passive: true });

        floatBtn.addEventListener("touchend", clearPressTimer, { passive: true });
        floatBtn.addEventListener("touchcancel", clearPressTimer, { passive: true });

        floatBtn.addEventListener("mousedown", function(e) {
            if (e.button !== 0) return;
            startX = e.clientX;
            startY = e.clientY;
            longPressed = false;
            clearPressTimer();

            pressTimer = setTimeout(function() {
                longPressed = true;
                window.__apiFloatLongPressed = true;
                openModal();
                setTimeout(function() {
                    window.__apiFloatLongPressed = false;
                }, 800);
            }, LONG_PRESS_MS);
        });

        floatBtn.addEventListener("mousemove", function(e) {
            if (!pressTimer) return;
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearPressTimer();
        });

        floatBtn.addEventListener("mouseup", clearPressTimer);
        floatBtn.addEventListener("mouseleave", clearPressTimer);

        document.addEventListener("fullscreenchange", exitFallbackIfNativeFullscreenExited);
        document.addEventListener("webkitfullscreenchange", exitFallbackIfNativeFullscreenExited);

        console.log("[fullscreen-float] ready");
    }

    window.exitBrowserFullscreenFallback = function() {
        document.body.classList.remove("browser-fullscreen-fallback");

        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind);
    } else {
        bind();
    }
})();