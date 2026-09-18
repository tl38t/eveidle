(function () {
  "use strict";
  var STORAGE_KEY = "deep-space-idle.locale";
  // de / ru 目录**仅 Steam（Electron）端**随包发布并由 index.html 条件注入。
  // 非 Steam 端（微信 / TapTap）不会加载这两个 <script>，全局不存在 ⇒ 不加入 supported，
  // 语言下拉也不出现，玩家无法选到，体积不受影响。
  var hasDe = !!window.I18N_CATALOG_DE;
  var hasRu = !!window.I18N_CATALOG_RU;
  var supported = ["zh-CN", "zh-TW", "en-US"].concat(hasDe ? ["de"] : []).concat(hasRu ? ["ru"] : []);
  function normalizeLocale(value) {
    var code = String(value || "").toLowerCase().replace(/_/g, "-");
    if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(code)) return "zh-TW";
    if (["schinese", "zh-cn", "zh-sg", "zh-hans"].includes(code)) return "zh-CN";
    if (["english", "en", "en-us", "en-gb"].includes(code)) return "en-US";
    return value;
  }
  // Steam 界面语言已发行 5 种：简中 / 繁中 / 英文 / 德语 / 俄语，而客户端语言代码有近三十种。
  // 这 5 种做精确映射，其余（日、法、西……）一律收敛到英文——非中文玩家看英文远比看中文可读。
  // 不能沿用 normalizeLocale 的「未识别则原样返回」：那会让日语之类的代码一路落到
  // 浏览器语言的兜底分支上（非 en、非 tw 即判为 zh-CN）。
  // 德语 / 俄语目录只在 Steam 端随包发布；非 Steam 端 hasDe / hasRu 为假，
  // 这两个 code 不在 supported 里，会被下面的 supported.includes 挡掉并回落浏览器语言。
  function normalizeSteamLocale(value) {
    var code = String(value || "").toLowerCase().replace(/_/g, "-");
    if (!code) return "";
    if (["schinese", "zh-cn", "zh-sg", "zh-hans"].includes(code)) return "zh-CN";
    if (["tchinese", "zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(code)) return "zh-TW";
    if (["german", "de", "de-de", "de-at", "de-ch"].includes(code)) return "de";
    if (["russian", "ru", "ru-ru"].includes(code)) return "ru";
    return "en-US";
  }
  var queryLocale = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  var steamLocale = normalizeSteamLocale(window.STEAM_LOCALE || window.steamLanguage);
  var browserCode = String(navigator.language || "").toLowerCase();
  var browserLocale = browserCode.startsWith("en") ? "en-US" : (browserCode.includes("tw") ? "zh-TW" : "zh-CN");
  var storedLocale = "";
  try { storedLocale = normalizeLocale(localStorage.getItem(STORAGE_KEY) || ""); } catch (error) { /* sandboxed storage */ }
  // 定序：URL 显式指定 > 玩家在设置里的手动选择 > Steam 客户端语言 > 浏览器语言。
  // 手动选择优先于 Steam：否则玩家在设置里切成英文，重启后又被客户端语言顶回中文。
  var locale = supported.includes(queryLocale) ? queryLocale : (supported.includes(storedLocale) ? storedLocale : (supported.includes(steamLocale) ? steamLocale : browserLocale));
  var catalogs = { "en-US": window.I18N_CATALOG_EN || new Map(), "zh-TW": window.I18N_CATALOG_ZH_TW || new Map() };
  if (hasDe) catalogs["de"] = window.I18N_CATALOG_DE;
  if (hasRu) catalogs["ru"] = window.I18N_CATALOG_RU;
  var catalog = new Map();
  var catalogSources = [];
  var originals = new WeakMap();
  var IDEOGRAPH = /[\u3400-\u9FFF\uF900-\uFAFF]/;
  function cjkCount(s) { var m = String(s || "").match(/[\u3400-\u9FFF\uF900-\uFAFF]/g); return m ? m.length : 0; }
  var ATTRIBUTES = ["title", "aria-label", "placeholder"];
  var translateCache = new Map();
  var catalogUsesIdeographs = false;
  // 模板键：source 里含 {0} {1} … 占位符的键。
  // 用于「源码把变量拼进句子中间」的场景（如 '累计科研时长 ' + X + ' 小时'）：
  //   整句带变量 ⇒ 精确查表永不命中；而片段键又会被变量里的数字/单位切断，
  //   替换后残留孤儿汉字 ⇒ 触发整段回退 ⇒ 整句显示中文。
  //   故在「精确查表之后、片段替换之前」插一层模板匹配：把 {n} 编译成
  //   「不含汉字」的捕获组并整段锚定（^…$）。必须锚定：不锚定就无法处理
  //   匹配区间之外残留的文本（那部分仍是中文）。
  var templateRules = [];
  var templateCache = new Map();
  var RE_ESCAPE = /[.*+?^${}()|[\]\\]/g;
  function escapeRegExpSource(value) { return String(value).replace(RE_ESCAPE, "\\$&"); }
  // 单个「全角/CJK 标点」也能作为子串键：`：` `，` 等在中英混排里是纯装饰字符，
  // 换成 ASCII 后既不会残留汉字（不触发整段回退），又能消除「Standard pump：Disabled」
  // 这类半翻译中间态。其它单字符键（`的` `位` …）一律仍被拒绝，避免过度替换。
  var SINGLE_PUNCT = /^[\u3000-\u303F\uFF01-\uFF65\u00B7\u2018\u2019\u201C\u201D]$/;
  function isSubstringSource(source) {
    if (typeof source !== "string" || !source || /[<>]/.test(source)) return false;
    return source.length >= 2 || SINGLE_PUNCT.test(source);
  }
  // 出口标点归一化：仅对「译文不含汉字」的目录（en / de / ru）生效，且只在**本段确实
  // 发生了翻译**（translated !== source）时才套用——否则整段仍是中文原文，单把标点换成
  // 半角只会得到「中文句子配英文标点」的新怪相。
  //
  // 中文标点漏进英文界面有两条路径，都不是单一词条能覆盖的：
  //   ① 源码胶水：`'… · 已关闭（每次冶炼不消耗' + fuel + '，库存' + n + '）'`
  //      —— 片段键能译出 'Closed（No refining cost per cycle'，但结尾 '）' 无键可查；
  //   ② 词条译文本身沿用全角括号 / 冒号（宽表里的机器草稿常见形态）。
  // 英德俄界面里这些都是恒定的缺陷，故在出口统一收敛为 ASCII，并顺手修掉映射自身
  // 引入的空格粘连（` （` → ` (`, `Bonux： ` → `Bonus: `, `…cycle(` 保持不动）。
  var PUNCT_RE = /[\u3000\u3001\u3002\uFF01\uFF08\uFF09\uFF0C\uFF1A\uFF1B\uFF1F\uFF5E\uFF0E\uFF5B\uFF5D\u3010\u3011\u300A\u300B\u3008\u3009\u300C\u300D\u300E\u300F]/g;
  var PUNCT_MAP = {
    "\u3000": " ", "\u3001": ", ", "\u3002": ". ", "\uFF01": "!", "\uFF08": " (",
    "\uFF09": ")", "\uFF0C": ", ", "\uFF1A": ":", "\uFF1B": "; ", "\uFF1F": "?",
    "\uFF5E": "~", "\uFF0E": ".", "\uFF5B": "{", "\uFF5D": "}",
    "\u3010": "[", "\u3011": "]", "\u300A": "<", "\u300B": ">", "\u3008": "<", "\u3009": ">",
    "\u300C": "\"", "\u300D": "\"", "\u300E": "'", "\u300F": "'"
  };
  function normalizePunctuation(value) {
    var out = String(value).replace(PUNCT_RE, function (ch) { return PUNCT_MAP[ch] || ch; });
    // 空格修整：只在单行内折叠连续空格，避免破坏含换行的说明文本缩进。
    if (out.indexOf("\n") === -1) out = out.replace(/[ \t]{2,}/g, " ");
    out = out.replace(/\s+([,.;:!?)\]])/g, "$1");
    out = out.replace(/([(\[])[ \t]+/g, "$1");
    return out;
  }

  function setActiveCatalog() {
    catalog = catalogs[locale] || new Map();
    // 子串键应用顺序：汉字个数降序 → 字符长度降序。
    // 只按字符长度降序会让「跨词边界的片段键」压过正常词：
    //   "· 总"(3 字符/1 汉字) 先于 "总部"(2 字符/2 汉字) 被应用 ⇒ 总部 被切成 "total 部"。
    // 汉字数优先可保证「完整词恒优于片段键」，从根上消除这类切词。
    catalogSources = Array.from(catalog.keys()).filter(function (source) { return isSubstringSource(source) && source.indexOf("{") === -1; }).sort(function (a, b) { return cjkCount(b) - cjkCount(a) || b.length - a.length; });
    // 目标目录的译文是否本身就是汉字（如 zh-TW）。是的话，子串替换属于「字形/用词转换」，
    // 不能按「中英混排」处理，否则会把合法的繁体输出回退成简体。
    catalogUsesIdeographs = false;
    catalog.forEach(function (value) { if (typeof value === "string" && IDEOGRAPH.test(value)) catalogUsesIdeographs = true; });
    // 模板键仅对「译文不含汉字」的目录建立（en / de / ru）。
    // zh-TW 的译文本身就是汉字，模板替换属于字形转换、不含变量语义，故跳过。
    templateRules = [];
    if (!catalogUsesIdeographs) {
      catalog.forEach(function (value, source) {
        if (typeof value !== "string" || !value) return;
        if (source.indexOf("{") === -1) return;
        // 调用方一律用 trim() 后的文本做查表/匹配（见 translateText），所以模板键的
        // **首尾空白永远匹配不到**；而译文里那些空白恰恰是用来与前后文拼接的。
        // 处理：把源键首尾空白剥掉，并按同样的「剥掉几个字符」从译文两端各剥同样多，
        // 于是「源键的空白」与「译文的空白」成对抵消，拼接结果与原文空格数完全一致。
        var lead = source.length - source.trimStart().length;
        var tail = source.length - source.trimEnd().length;
        var core = source.trim();
        var text = value;
        if (lead + tail > 0) {
          if (value.length <= lead + tail) return;
          text = value.slice(lead, value.length - tail);
        }
        var pattern = "^" + escapeRegExpSource(core).replace(/\\\{(\d+)\\\}/g, "([^\u3400-\u9FFF\uF900-\uFAFF]{0,200}?)") + "$";
        try { templateRules.push({ re: new RegExp(pattern), value: text }); } catch (error) { /* 非法模板一律丢弃，绝不影响常规翻译 */ }
      });
      // 长模板优先：同一句话可能同时命中「带尾缀」与「不带尾缀」两条模板。
      templateRules.sort(function (a, b) { return b.re.source.length - a.re.source.length; });
    }
    translateCache.clear();
    templateCache.clear();
  }
  /** 整段锚定匹配模板键；未命中返回 null。 */
  function translateFromTemplate(text) {
    if (templateCache.has(text)) return templateCache.get(text);
    var hit = null;
    for (var i = 0; i < templateRules.length; i += 1) {
      var rule = templateRules[i];
      var m = text.match(rule.re);
      if (!m) continue;
      hit = rule.value.replace(/\{(\d+)\}/g, function (whole, index) {
        var captured = m[Number(index) + 1];
        return captured === undefined ? whole : captured;
      });
      break;
    }
    templateCache.set(text, hit);
    return hit;
  }
  // 语言名称是「自名（endonym）」：无论界面语言为何，这一项都必须显示该语言自身的写法
  // （简体中文 / 繁體中文 / English / Deutsch / Русский）。它一旦被 catalog 当作普通文案
  // 翻译，俄语界面下的选项就会变成「Упрощенный китайский / Традиционный китайский」，
  // 玩家在下拉里认不出自己要选的语言 —— 语言选择器是唯一不能本地化的控件。
  // `[data-i18n-skip]` 是同类的显式标记（如「语言 / Language」双语标头）。
  function skip(element) {
    if (!element) return true;
    if (/^(SCRIPT|STYLE|CODE|PRE)$/.test(element.tagName)) return true;
    if (element.tagName === "OPTION" && element.closest && element.closest("#setting-language")) return true;
    return !!element.closest?.('#achievements-panel, [data-deferred-i18n], [data-i18n-skip]');
  }
  var LANGUAGE_LABELS = { "zh-CN": "简体中文", "zh-TW": "繁體中文", "en-US": "English", "de": "Deutsch", "ru": "Русский" };
  // 按 value 强制回写标签。skip() 已保证新值不会被再翻译；这里额外做一次值级校正，
  // 使「语言名永不被本地化」不依赖 skip 判据本身（并顺手纠正任何历史被译值），且幂等。
  function syncLanguageOptions() {
    var control = document.getElementById("setting-language");
    if (!control || !control.options) return;
    Array.prototype.forEach.call(control.options, function (option) {
      var label = LANGUAGE_LABELS[option.value];
      if (label && option.textContent !== label) option.textContent = label;
    });
  }
  // 接缝补空格。中文没有词间空格、英德俄有 —— 这正是片段替换的**系统性**缺陷：
  //   源码 `'…' + 名称 + '蓝图'` 两段各自译对（`Star Spear-class` / `blueprint`），
  //   但拼接处两个字母直接相邻 ⇒ `Star Spear-classblueprint`；
  //   同理出现 TitanComponents / Miningindustry / Equipment EngineeringXP+8 /
  //   Если он принадлежит, то конвертируется вBrain… / cycleplasma。
  // 中文侧不留空格是**正确**的，所以只能在出口按目标语言补，不能靠改词条
  // （词条侧要么枚举几十个舰级名、要么把所有片段键预先加上尾随空格，都会随新增
  //   内容持续回归）。判据只看「字母↔字母」边界，数字、百分号、括号、汉字一律不动。
  // 仅对「译文不含汉字」的目录生效：zh-TW 的输出必须保持逐字节不变。
  var SEAM_LETTER = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
  function translateFromCatalog(text) {
    if (!IDEOGRAPH.test(text)) return text;
    if (translateCache.has(text)) return translateCache.get(text);
    var result = text;
    for (var s = 0; s < catalogSources.length; s += 1) {
      var source = catalogSources[s];
      var idx = result.indexOf(source);
      if (idx === -1) continue;
      var value = catalog.get(source);
      if (typeof value !== "string") continue;
      while (idx !== -1) {
        var padLeft = !catalogUsesIdeographs && idx > 0 && SEAM_LETTER.test(result.charAt(idx - 1)) && SEAM_LETTER.test(value.charAt(0)) ? " " : "";
        result = result.slice(0, idx) + padLeft + value + result.slice(idx + source.length);
        var end = idx + padLeft.length + value.length;
        if (!catalogUsesIdeographs && SEAM_LETTER.test(value.charAt(value.length - 1)) && SEAM_LETTER.test(result.charAt(end))) {
          result = result.slice(0, end) + " " + result.slice(end);
          end += 1;
        }
        idx = result.indexOf(source, end);
      }
    }
    // 半截替换（替换后仍残留汉字）宁可整段不译，避免出现中英混排的句子。
    // 仅对「译文不含汉字」的目录（如 en-US）生效：目录中不存在含汉字的英文译文，故不会误伤合法全译。
    // 译文本身是汉字的目录（如 zh-TW）走的是字形转换，不适用此回退。
    if (!catalogUsesIdeographs && result !== text && IDEOGRAPH.test(result)) result = text;
    translateCache.set(text, result);
    return result;
  }
  function translateText(node) {
    if (skip(node.parentElement)) return;
    var raw = node.nodeValue || "";
    var sourceRaw = originals.has(node) ? originals.get(node) : raw;
    if (locale === "zh-CN") { if (sourceRaw !== raw) node.nodeValue = sourceRaw; return; }
    var trimmed = sourceRaw.trim();
    if (!trimmed || !IDEOGRAPH.test(trimmed)) return;
    if (!originals.has(node)) originals.set(node, sourceRaw);
    var translated = catalog.get(trimmed) || translateFromTemplate(trimmed) || translateFromCatalog(trimmed);
    if (!catalogUsesIdeographs && translated !== trimmed) translated = normalizePunctuation(translated);
    var start = sourceRaw.indexOf(trimmed);
    var value = sourceRaw.slice(0, start) + translated + sourceRaw.slice(start + trimmed.length);
    if (value !== raw) node.nodeValue = value;
  }
  function translateAttributes(element) {
    if (skip(element)) return;
    ATTRIBUTES.forEach(function (attribute) {
      var value = element.getAttribute(attribute); if (!value) return;
      var saved = originals.has(element) ? originals.get(element) : {};
      var sourceValue = saved[attribute] || value;
      var trimmedValue = String(sourceValue).trim();
      var translated = locale === "zh-CN" ? sourceValue : (catalog.get(trimmedValue) || translateFromTemplate(trimmedValue) || translateFromCatalog(sourceValue));
      if (!catalogUsesIdeographs && translated !== sourceValue) translated = normalizePunctuation(translated);
      if (locale !== "zh-CN" && translated !== value) { saved[attribute] = sourceValue; originals.set(element, saved); }
      if (translated !== value) element.setAttribute(attribute, translated);
    });
  }
  function apply(root) {
    if (!root) return;
    var elements = root.nodeType === 1 ? [root].concat(Array.from(root.querySelectorAll("*"))) : Array.from(root.querySelectorAll("*"));
    elements.forEach(function (element) { if (skip(element)) return; Array.from(element.childNodes).forEach(function (node) { if (node.nodeType === 3) translateText(node); }); });
    elements.forEach(translateAttributes);
  }
  // 窗口 / 标签页标题：中文两个 locale 用「深空放置」，英文用品牌英文名；
  // de / ru 取本语言目录里与游戏内顶栏左上角品牌名同源的那条键（保证「窗口标题 == 顶栏标题」），
  // 取不到时回落英文品牌名。document.documentElement.lang 直接写 locale 值，
  // "de" / "ru" / "en-US" / "zh-TW" 都是合法 BCP47 代码。
  var WINDOW_TITLES = { "zh-CN": "深空放置", "zh-TW": "深空放置", "en-US": "Deep Space Idle" };
  function applyNav() {
    apply(document.body);
    syncLanguageOptions();
    document.documentElement.lang = locale;
    document.title = WINDOW_TITLES[locale] || catalog.get("深空放置 · 边疆纪元") || "Deep Space Idle";
  }
  function broadcastLocale() {
    var frame = document.getElementById("legion-starmap-frame");
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ type: "deep-space-idle/locale", locale: locale }, "*");
  }
  // persist 仅在玩家于设置里主动选择时为真。平台（Steam）驱动与父页广播传入的
  // locale 不能落盘：那不是玩家的选择，一旦写进本地存储就会在下次启动时压过
  // Steam 语言，导致玩家改客户端语言后界面不再跟随。
  function setLocale(next, persist) {
    if (!supported.includes(next)) return;
    locale = next; setActiveCatalog();
    if (persist !== false) { try { localStorage.setItem(STORAGE_KEY, next); } catch (error) { /* sandboxed storage */ } }
    applyNav();
    var control = document.getElementById("setting-language"); if (control) control.value = locale;
    window.dispatchEvent(new CustomEvent("localechange", { detail: { locale: locale } }));
    broadcastLocale();
  }
  // 桌面壳（Steam）正常会由 preload 同步注入 window.STEAM_LOCALE，此处兜底
  // 「首帧拿不到语言」的情形：壳层的 Steam 初始化由游戏按需触发，可能晚于首帧，
  // 所以退避重试几次，等初始化完成后把界面切过去。
  function followPlatformLocale(attempt) {
    if (steamLocale) return;
    var bridge = window.SteamBridge;
    if (!bridge || typeof bridge.getLanguage !== "function") return;
    var tries = typeof attempt === "number" ? attempt : 0;
    Promise.resolve(bridge.getLanguage()).then(function (result) {
      var next = normalizeSteamLocale(result && result.language);
      if (!next) {
        // 空语言 = 壳层还没初始化完（或环境里根本没有 Steam）。有限次重试后放弃，
        // 保持当前语言，绝不因为平台信号缺失而卡住或反复重绘。
        if (tries < 4) window.setTimeout(function () { followPlatformLocale(tries + 1); }, 700);
        return;
      }
      if (!supported.includes(next)) return;
      steamLocale = next;
      var explicit = "";
      try { explicit = localStorage.getItem(STORAGE_KEY) || ""; } catch (error) { /* sandboxed storage */ }
      // 玩家在设置里的手动选择和 URL 显式指定都优先于平台语言。
      if (queryLocale || explicit || next === locale) return;
      setLocale(next, false);
    }).catch(function () { /* 壳层未提供语言时保持当前语言 */ });
  }
  setActiveCatalog();
  // iframe 子页拿不到 preload 注入的 STEAM_LOCALE（preload 只注入主 frame，
  // webPreferences 未开 nodeIntegrationInSubFrames），它按浏览器语言自算，
  // 所以启动后主动向父页请求一次真实语言。
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "deep-space-idle/locale-request") return;
    broadcastLocale();
  });
  window.I18N = {
    getLocale: function () { return locale; },
    setLocale: function (next, options) { setLocale(next, options && options.persist); },
    // 精确查表（不参与片段替换）：调用方给的已是整句键。命中后同样过一遍标点归一化，
    // 保证「同一句话在 DOM 路径与 I18N.t 路径下渲染结果一致」。
    t: function (key) {
      if (locale === "zh-CN") return key;
      var hit = catalog.get(key);
      if (hit === undefined) return key;
      return (!catalogUsesIdeographs && hit !== key) ? normalizePunctuation(hit) : hit;
    }
  };
  document.addEventListener("DOMContentLoaded", function () {
    applyNav();
    var control = document.getElementById("setting-language");
    if (control) {
      control.value = locale;
      // 仅当对应目录全局存在（即 Steam 端）才向语言下拉追加 de / ru 选项。
      if (window.I18N_CATALOG_DE) { var od = document.createElement("option"); od.value = "de"; od.textContent = LANGUAGE_LABELS.de; control.appendChild(od); }
      if (window.I18N_CATALOG_RU) { var or = document.createElement("option"); or.value = "ru"; or.textContent = LANGUAGE_LABELS.ru; control.appendChild(or); }
      syncLanguageOptions();
      control.addEventListener("change", function () { setLocale(control.value); });
    }
    followPlatformLocale();
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === "characterData") translateText(mutation.target);
        else if (mutation.type === "attributes") translateAttributes(mutation.target);
        else Array.from(mutation.addedNodes).forEach(function (node) { if (node.nodeType === 1) apply(node); else if (node.nodeType === 3) translateText(node); });
      });
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES, subtree: true });
  });
})();
