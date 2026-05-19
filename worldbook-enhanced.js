
/* worldbook-enhanced.js v1.0
 * Utility module - exports window.wbE
 * Depends: window.DB, window.escapeHtml
 */
(function() {
    "use strict";

    var SVG_PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    var SVG_X = '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    var SVG_CODE = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

    function esc(s) {
        return window.escapeHtml ? window.escapeHtml(s)
            : String(s == null ? "" : s).replace(/[&<>"]/g, function(m) {
                return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[m];
            });
    }

    /* ========== HTML sanitizer ========== */
    function sanitize(html) {
    if (!html) return "";

    var tmp = document.createElement("div");
    tmp.innerHTML = html;

    // 禁止会执行脚本、嵌套页面、提交表单、影响页面结构的标签
    var bad = tmp.querySelectorAll(
        "script,iframe,object,embed,form,input,button,textarea,select,link,meta,base"
    );
    for (var i = 0; i < bad.length; i++) {
        bad[i].remove();
    }

    var all = tmp.querySelectorAll("*");

    for (var j = 0; j < all.length; j++) {
        var el = all[j];
        var attrs = el.attributes;

        for (var k = attrs.length - 1; k >= 0; k--) {
            var rawName = attrs[k].name;
            var n = rawName.toLowerCase();
            var v = String(attrs[k].value || "").trim().toLowerCase();

            // 移除事件属性：onclick / onload / onerror 等
            if (n.startsWith("on")) {
                el.removeAttribute(rawName);
                continue;
            }

            // 移除危险协议
            var isUrlAttr =
                n === "href" ||
                n === "src" ||
                n === "xlink:href" ||
                n === "formaction" ||
                n === "action" ||
                n === "poster";

            if (isUrlAttr) {
                if (
                    v.startsWith("javascript:") ||
                    v.startsWith("vbscript:") ||
                    v.startsWith("data:text/html")
                ) {
                    el.removeAttribute(rawName);
                    continue;
                }
            }

            // 禁止 target 直接影响顶层页面
            if (n === "target") {
                el.setAttribute("target", "_blank");
                el.setAttribute("rel", "noopener noreferrer");
                continue;
            }

            // 清理 style 属性中的危险内容
            if (n === "style") {
                var safeStyle = attrs[k].value
                    .replace(/javascript\s*:/gi, "")
                    .replace(/vbscript\s*:/gi, "")
                    .replace(/expression\s*\([^)]*\)/gi, "")
                    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]+\)/gi, "");
                el.setAttribute(rawName, safeStyle);
            }
        }

        // 所有链接强制新窗口打开，避免影响当前应用
        if (el.tagName && el.tagName.toLowerCase() === "a") {
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
        }
    }

    // 允许 style，但清理危险 CSS
    var styles = tmp.querySelectorAll("style");
    for (var s = 0; s < styles.length; s++) {
        var css = styles[s].textContent || "";
        css = css
            .replace(/@import[^;]+;/gi, "")
            .replace(/javascript\s*:/gi, "")
            .replace(/vbscript\s*:/gi, "")
            .replace(/expression\s*\([^)]*\)/gi, "")
            .replace(/url\s*\(\s*['"]?\s*javascript:[^)]+\)/gi, "");

        styles[s].textContent = css;
    }

    return tmp.innerHTML;
}

    /* ========== Keyword matching ========== */
    function matchKw(text, keywords) {
        if (!keywords || keywords.length === 0) return true;
        if (!text) return false;
        var lower = text.toLowerCase();
        for (var i = 0; i < keywords.length; i++) {
            if (keywords[i] && lower.indexOf(keywords[i].toLowerCase()) !== -1) return true;
        }
        return false;
    }

    function matchRecent(chats, keywords, lookback) {
        if (!keywords || keywords.length === 0) return true;
        lookback = lookback || 3;
        var msgs = [];
        for (var i = (chats || []).length - 1; i >= 0 && msgs.length < lookback; i--) {
            if (chats[i].role === "user") msgs.push(chats[i].content || "");
        }
        return matchKw(msgs.join(" "), keywords);
    }

    /* ========== Core: resolve worldbooks by depth + keyword ========== */
    /* opts: { charId, scene, recentChats, worldbookIds, allWorldbooks }
     * Returns: { before: "text", middle: "text", after: "text", hasHtml: bool }
     */
    function resolve(opts) {
    var result = { before: "", middle: "", after: "", hasHtml: false, htmlBooks: [] };
    var all = opts.allWorldbooks || [];
    if (!all.length) return result;

    var scene = opts.scene || "chat";
    var charId = opts.charId || null;

    // 优先级：
    // 1. 对话详情 / 群聊详情显式挂载或屏蔽
    // 2. 世界书底部挂载联系人
    // 3. 世界书底部挂载场景
    var explicitMountIds = opts.worldbookIds || [];
    var explicitOverrides = opts.worldbookMountOverrides || {};
    var skipHtml = opts.skipHtml === true;

    function isExplicitTrue(wb) {
        return explicitOverrides[wb.id] === true || explicitMountIds.indexOf(wb.id) !== -1;
    }

    function isExplicitFalse(wb) {
        return explicitOverrides[wb.id] === false;
    }

    function shouldMount(wb) {
        // 1. 显式取消：最高优先级，直接屏蔽
        if (isExplicitFalse(wb)) return false;

        // 2. 显式勾选：最高优先级，强制挂载
        if (isExplicitTrue(wb)) return true;

        // 3. 世界书底部联系人挂载
        if (charId && (wb.mountChars || []).indexOf(charId) !== -1) return true;

        // 4. 世界书底部场景挂载
        if ((wb.mountScenes || []).indexOf(scene) !== -1) return true;

        return false;
    }

    var mounted = [];
    for (var i = 0; i < all.length; i++) {
        var wb = all[i];
        if (shouldMount(wb)) mounted.push(wb);
    }

    var buckets = { before: [], middle: [], after: [] };

    for (var m = 0; m < mounted.length; m++) {
        var w = mounted[m];

        // HTML 类世界书永远收集到 htmlBooks，方便独立 HTML 路线使用
        if (w.group === "HTML") {
            result.htmlBooks.push(w);
            if (skipHtml) continue;
            result.hasHtml = true;
        }

        var kws = w.triggerKeywords || [];
        if (kws.length > 0 && !matchRecent(opts.recentChats || [], kws, 3)) continue;

        var depth = w.injectDepth || "before";
        if (!buckets[depth]) depth = "before";

        var text = "--- " + (w.title || "") + " ---\n" + w.content;
        buckets[depth].push(text);
    }

    if (buckets.before.length) result.before = buckets.before.join("\n\n");
    if (buckets.middle.length) result.middle = buckets.middle.join("\n\n");
    if (buckets.after.length) result.after = buckets.after.join("\n\n");

    return result;
}

function pickHtmlBookByKeyword(htmlBooks, latestUserText) {
    if (!htmlBooks || !htmlBooks.length || !latestUserText) return null;
    var lower = String(latestUserText).toLowerCase();
    for (var i = 0; i < htmlBooks.length; i++) {
        var kws = htmlBooks[i].triggerKeywords || [];
        if (kws.length === 0) continue;          // HTML 类必须配关键词
        for (var j = 0; j < kws.length; j++) {
            if (kws[j] && lower.indexOf(kws[j].toLowerCase()) !== -1) {
                return htmlBooks[i];
            }
        }
    }
    return null;
}
    /* ========== UI: Enhance worldbook detail page ========== */
    function enhanceDetailUI() {
        if (document.getElementById("wbDepthSelector")) return;
        var allSections = document.querySelectorAll("#page-worldbook-detail .worldbook-section");
        var insertBefore = null;
        for (var i = 0; i < allSections.length; i++) {
            var h = allSections[i].querySelector("h3, label");
            if (h && h.textContent.indexOf("Mount") !== -1) { insertBefore = allSections[i]; break; }
            if (h && h.textContent.indexOf("mount") !== -1) { insertBefore = allSections[i]; break; }
        }
        if (!insertBefore) insertBefore = allSections[allSections.length - 1];
        if (!insertBefore) return;

        var ds = document.createElement("div");
        ds.className = "worldbook-section";
        ds.innerHTML =
            '<label style="font-weight:600;margin-bottom:8px;display:block;">'
            + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
            + ' Inject Depth</label>'
            + '<div class="wb-depth-selector" id="wbDepthSelector">'
            + '<div class="wb-depth-btn active" data-depth="before"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg><div class="wb-depth-label">Before</div><div class="wb-depth-desc">Prompt top</div></div>'
            + '<div class="wb-depth-btn" data-depth="middle"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg><div class="wb-depth-label">Middle</div><div class="wb-depth-desc">After char info</div></div>'
            + '<div class="wb-depth-btn" data-depth="after"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg><div class="wb-depth-label">After</div><div class="wb-depth-desc">After rules</div></div>'
            + '</div>';
        insertBefore.parentNode.insertBefore(ds, insertBefore);

        ds.querySelectorAll(".wb-depth-btn").forEach(function(btn) {
            btn.addEventListener("click", function() {
                ds.querySelectorAll(".wb-depth-btn").forEach(function(b) { b.classList.remove("active"); });
                btn.classList.add("active");
            });
        });

        var ks = document.createElement("div");
        ks.className = "worldbook-section wb-kw-section";
        ks.innerHTML =
            '<label style="font-weight:600;margin-bottom:8px;display:block;">'
            + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
            + ' Trigger Keywords</label>'
            + '<div class="wb-kw-row"><input type="text" class="wb-kw-input" id="wbKwInput" placeholder="Type keyword, press Add"><button class="wb-kw-add" id="wbKwAddBtn">' + SVG_PLUS + ' Add</button></div>'
            + '<div class="wb-kw-tags" id="wbKwTags"></div>'
            + '<div class="wb-kw-hint">Keywords set = worldbook only activates when user mentions one. Empty = always active.</div>';
        insertBefore.parentNode.insertBefore(ks, insertBefore);

        var kwInput = document.getElementById("wbKwInput");
        var kwAddBtn = document.getElementById("wbKwAddBtn");

        function addKw() {
            var val = (kwInput.value || "").trim();
            if (!val) return;
            var tags = document.getElementById("wbKwTags");
            var existing = tags.querySelectorAll(".wb-kw-tag");
            for (var i = 0; i < existing.length; i++) {
                if ((existing[i].dataset.kw || "").toLowerCase() === val.toLowerCase()) return;
            }
            var tag = document.createElement("span");
            tag.className = "wb-kw-tag";
            tag.dataset.kw = val;
            tag.innerHTML = esc(val) + ' <span class="wb-kw-tag-x">' + SVG_X + '</span>';
            tag.querySelector(".wb-kw-tag-x").addEventListener("click", function() { tag.remove(); });
            tags.appendChild(tag);
            kwInput.value = "";
            kwInput.focus();
        }

        kwAddBtn.addEventListener("click", addKw);
        kwInput.addEventListener("keypress", function(e) { if (e.key === "Enter") { e.preventDefault(); addKw(); } });
    }

    function setDepth(d) {
        var sel = document.getElementById("wbDepthSelector");
        if (!sel) return;
        sel.querySelectorAll(".wb-depth-btn").forEach(function(b) {
            b.classList.toggle("active", b.dataset.depth === (d || "before"));
        });
    }

    function getDepth() {
        var sel = document.getElementById("wbDepthSelector");
        if (!sel) return "before";
        var a = sel.querySelector(".wb-depth-btn.active");
        return a ? a.dataset.depth : "before";
    }

    function setKeywords(kws) {
        var c = document.getElementById("wbKwTags");
        if (!c) return;
        c.innerHTML = "";
        if (!kws || !kws.length) return;
        kws.forEach(function(kw) {
            var tag = document.createElement("span");
            tag.className = "wb-kw-tag";
            tag.dataset.kw = kw;
            tag.innerHTML = esc(kw) + ' <span class="wb-kw-tag-x">' + SVG_X + '</span>';
            tag.querySelector(".wb-kw-tag-x").addEventListener("click", function() { tag.remove(); });
            c.appendChild(tag);
        });
    }

    function getKeywords() {
        var c = document.getElementById("wbKwTags");
        if (!c) return [];
        var tags = c.querySelectorAll(".wb-kw-tag");
        var r = [];
        for (var i = 0; i < tags.length; i++) {
            if (tags[i].dataset.kw) r.push(tags[i].dataset.kw);
        }
        return r;
    }

    function addBadges(wbMap) {
        var cards = document.querySelectorAll("#worldbookListContainer .worldbook-card");
        cards.forEach(function(card) {
            if (card.querySelector(".wb-badges")) return;
            var id = card.dataset.id;
            var wb = wbMap[id];
            if (!wb) return;
            var h = [];
            var d = wb.injectDepth || "before";
            h.push('<span class="wb-badge-depth">' + esc(d) + '</span>');
            if (wb.triggerKeywords && wb.triggerKeywords.length > 0) {
                h.push('<span class="wb-badge-kw">' + wb.triggerKeywords.length + ' kw</span>');
            }
            if (wb.group === "HTML") {
                h.push('<span class="wb-badge-html">' + SVG_CODE + ' HTML</span>');
            }
            var meta = card.querySelector(".worldbook-card-meta");
            if (meta && h.length) {
                var div = document.createElement("div");
                div.className = "wb-badges";
                div.innerHTML = h.join("");
                meta.after(div);
            }
        });
    }

    window.wbE = {
    sanitize: sanitize,
    matchKw: matchKw,
    matchRecent: matchRecent,
    resolve: resolve,
    pickHtmlBookByKeyword: pickHtmlBookByKeyword,   // 新增
    enhanceDetailUI: enhanceDetailUI,
    setDepth: setDepth,
    getDepth: getDepth,
    setKeywords: setKeywords,
    getKeywords: getKeywords,
    addBadges: addBadges
};

    console.log("[wb-enhanced] utility module ready");
})();

