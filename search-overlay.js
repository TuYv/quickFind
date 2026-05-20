// Pounce Search Overlay - Content Script
(function() {
  'use strict';

  // 版本守卫：扩展更新后旧的 content script 仍残留在页面上，重新注入会被早退守卫卡死，
  // 老 keyboard 行为继续生效到用户刷新页面为止。这里用 manifest 版本对比，
  // 同版本短路返回；不同版本先 destroy 旧实例再重新初始化。
  let POUNCE_OVERLAY_VERSION = 'unknown';
  try {
    POUNCE_OVERLAY_VERSION = chrome.runtime.getManifest().version;
  } catch (e) {
    // chrome.runtime 在某些边缘场景可能失效；fallback 使版本检查失败 → 强制替换
  }

  if (window.pounceSearchOverlay) {
    const existing = window.pounceSearchOverlay;
    if (existing.version === POUNCE_OVERLAY_VERSION) {
      return;
    }
    try {
      if (typeof existing.destroy === 'function') existing.destroy();
    } catch (err) {
      console.warn('Pounce: failed to destroy stale overlay instance', err);
    }
    window.pounceSearchOverlay = null;
  }

  // compositionend 之后 Chrome/macOS IME 偶发多发一次 Enter keydown（isComposing=false），
  // 此窗口内收到的 Enter 一律视为 IME trailing，避免误触发 selectResult。
  const IME_TRAILING_ENTER_GUARD_MS = 120;
  const HIGHLIGHTABLE_TYPES = ['tab', 'history', 'topSite', 'bookmark'];
  const PREFERENCES = globalThis.PouncePreferences || {};
  const DEFAULT_SEARCH_PREFERENCES = PREFERENCES.DEFAULT_SEARCH_PREFERENCES || {
    quickPickEnabled: true,
    pinyinMatchingEnabled: true,
    resultsLimit: 10
  };
  const ALLOWED_RESULTS_LIMITS = PREFERENCES.ALLOWED_RESULTS_LIMITS || [10, 20, 50];
  const SEARCH_PREFERENCE_KEYS = PREFERENCES.SEARCH_PREFERENCE_KEYS || Object.keys(DEFAULT_SEARCH_PREFERENCES);
  const normalizeResultsLimit = PREFERENCES.normalizeResultsLimit || ((value) => {
    const num = Number(value);
    return ALLOWED_RESULTS_LIMITS.includes(num) ? num : DEFAULT_SEARCH_PREFERENCES.resultsLimit;
  });
  const normalizeSearchPreferences = PREFERENCES.normalizeSearchPreferences || ((values) => {
    const source = values && typeof values === 'object' ? values : {};
    return SEARCH_PREFERENCE_KEYS.reduce((preferences, key) => {
      if (key === 'resultsLimit') {
        preferences[key] = normalizeResultsLimit(source[key]);
      } else {
        preferences[key] = typeof source[key] === 'boolean'
          ? source[key]
          : DEFAULT_SEARCH_PREFERENCES[key];
      }
      return preferences;
    }, {});
  });

  class PounceSearchOverlay {
    constructor() {
      this.overlay = null;
      this.searchInput = null;
      this.resultsContainer = null;
      this.resultsCounter = null;
      this.currentResults = [];
      this.selectedIndex = -1;
      this.isVisible = false;
      this.themeManager = null;
      this.dynamicHistoryItems = [];
      this.historyFetchTimer = null;
      this.historyFetchRequestId = 0;
      this.bridgeTabId = null;
      this.visibleResultIndices = [];
      this.searchPreferences = normalizeSearchPreferences({});
      this.quickPickHint = null;
      this.resultsLimitSelect = null;

      // 版本标记 + destroy 状态，供扩展更新时旧实例替换逻辑使用
      this.version = POUNCE_OVERLAY_VERSION;
      this.isDestroyed = false;
      this.shadowHost = null;
      this.docKeyDownHandler = null;
      this.docKeyUpHandler = null;
      this.focusShieldHandler = null;
      this.focusRestoreFrame = null;
      this.focusRestoreTimer = null;
      this.runtimeMessageHandler = null;
      this.storageChangeHandler = null;
      this.languageChangeHandler = null;

      // 静态文本节点引用，用于语言切换时实时刷新
      this.resultsCounterStaticKey = 'overlay_zeroResults';
      this.navigateHintEl = null;
      this.selectHintEl = null;
      this.quickPickHintLabelEl = null;
      this.closeHintEl = null;

      // 鼠标真实移动跟踪：Cmd+K 弹出时若光标恰好压在某项上，
      // CSS :hover 会立刻点亮那一项，与键盘默认选中的第 1 项形成"两个高亮"。
      // 通过门控 :hover（CSS 用 .pn-mouse-active 父类），只有用户真正移动鼠标
      // 超过阈值后才允许 hover 生效，并同步把 selectedIndex 推到光标所在项。
      this._mouseActive = false;
      this._mouseBaselineX = null;
      this._mouseBaselineY = null;
      this._lastMouseX = null;
      this._lastMouseY = null;

      // Mac 用 ⌥ 符号，其他平台用 Alt+ 前缀
      const isMac = navigator.platform.toUpperCase().includes('MAC') ||
        navigator.userAgent.toUpperCase().includes('MAC');
      this.shortcutPrefix = isMac ? '⌥' : 'Alt+';
      this.shortcutKeyLabel = isMac ? '⌥' : 'Alt';

      this.init();
    }

    getSearchIconSvg() {
      return `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="7.5" stroke="currentColor" stroke-width="1.75"/>
          <path d="M20 20L16.5 16.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
      `;
    }

    getFaviconUrl(pageUrl) {
      const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
      faviconUrl.searchParams.set('pageUrl', pageUrl);
      faviconUrl.searchParams.set('size', '32');
      return faviconUrl.toString();
    }

    isSafeIconUrl(value) {
      if (!value || typeof value !== 'string') return false;
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' ||
          parsed.protocol === 'https:' ||
          parsed.protocol === 'chrome-extension:';
      } catch (error) {
        return false;
      }
    }

    getSafeFaviconUrl(item) {
      if (!item || item.type === 'search' || !item.url) {
        return '';
      }
      if (this.isSafeIconUrl(item.favIconUrl)) {
        return item.favIconUrl;
      }
      return this.getFaviconUrl(item.url);
    }

    init() {
      this.createOverlay();
      this.bindEvents();
      this.initTheme();
    }
    
    initTheme() {
      // 把主题 class 挂在 overlay 自身上，避免被宿主页（如 juejin.cn）抢占 <html>
      try {
        this.themeManager = new ContentThemeManager(this.overlay);
      } catch (error) {
        console.error('Failed to initialize theme manager:', error);
      }
    }
    
    createOverlay() {
      // Shadow DOM 用于彻底隔离宿主页的 input/svg/button 全局样式（如 juejin.cn 污染）。
      const shadowHost = document.createElement('div');
      shadowHost.id = 'pounce-shadow-host';
      // 0 尺寸 host：不占位、不拦截交互；overlay 自己 position:fixed 盖满视窗。
      shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
      this.shadowHost = shadowHost;
      this.shadowRoot = shadowHost.attachShadow({ mode: 'open' });

      const cssLink = document.createElement('link');
      cssLink.rel = 'stylesheet';
      cssLink.href = chrome.runtime.getURL('search-overlay.css');
      this.shadowRoot.appendChild(cssLink);

      // Create overlay container
      this.overlay = document.createElement('div');
      this.overlay.className = 'pounce-search-overlay';
      // CSS 通过 <link> 异步加载，先用内联 display:none 避免首帧 FOUC。
      this.overlay.style.display = 'none';
      
      // Create search container
      const container = document.createElement('div');
      container.className = 'pounce-search-container';
      
      // Create search input container (this was missing!)
      const inputContainer = document.createElement('div');
      inputContainer.className = 'pounce-search-input-container';
      
      // Create search icon — proper currentColor SVG
      const searchIcon = document.createElement('div');
      searchIcon.className = 'pounce-search-icon';
      searchIcon.innerHTML = this.getSearchIconSvg();
      
      // Create search input
      this.searchInput = document.createElement('input');
      this.searchInput.className = 'pounce-search-input';
      this.searchInput.type = 'text';
      this.searchInput.placeholder = window.i18n
        ? window.i18n.t('overlay_searchPlaceholder')
        : 'Search tabs, history, bookmarks, and top sites...';
      this.searchInput.autocomplete = 'off';
      this.searchInput.spellcheck = false;

      // create close icon — proper currentColor SVG
      const closeIcon = document.createElement('div');
      closeIcon.className = 'pounce-close-icon';
      closeIcon.id = 'pounce-close-icon';
      closeIcon.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      
      // Create results container
      this.resultsContainer = document.createElement('div');
      this.resultsContainer.className = 'pounce-search-results';

      // 底部区域
      const bottomContainer = document.createElement('div');
      bottomContainer.className = 'pounce-search-bottom';

      const leftContainer = document.createElement('div');
      leftContainer.className = 'pounce-search-bottom-left';
      const resultsCounter = document.createElement('span');
      resultsCounter.className = 'pounce-results-counter';
      resultsCounter.textContent = window.i18n
        ? window.i18n.t('overlay_zeroResults')
        : '0 results';
      this.resultsCounter = resultsCounter; // 保存引用以便后续更新
      this.resultsLimitSelect = this.createResultsLimitSelect();
      leftContainer.appendChild(resultsCounter);
      leftContainer.appendChild(this.resultsLimitSelect);
      bottomContainer.appendChild(leftContainer);
      const rightContainer = document.createElement('div');
      rightContainer.className = 'pounce-hints';
      // 用 DOM 构造而非 innerHTML，以便保留文本节点引用做语言切换刷新
      const navigateHint = document.createElement('span');
      navigateHint.className = 'pounce-hint';
      const navUpKey = document.createElement('span');
      navUpKey.className = 'pounce-hint-key';
      navUpKey.textContent = '↑';
      const navDownKey = document.createElement('span');
      navDownKey.className = 'pounce-hint-key';
      navDownKey.textContent = '↓';
      const navigateLabel = document.createTextNode(' ' + (window.i18n ? window.i18n.t('overlay_navigate') : 'Navigate'));
      navigateHint.appendChild(navUpKey);
      navigateHint.appendChild(navDownKey);
      navigateHint.appendChild(navigateLabel);
      this.navigateHintEl = navigateLabel;

      const selectHint = document.createElement('span');
      selectHint.className = 'pounce-hint';
      const selectKey = document.createElement('span');
      selectKey.className = 'pounce-hint-key';
      selectKey.textContent = '↵';
      const selectLabel = document.createTextNode(' ' + (window.i18n ? window.i18n.t('overlay_select') : 'Select'));
      selectHint.appendChild(selectKey);
      selectHint.appendChild(selectLabel);
      this.selectHintEl = selectLabel;

      const quickPickHint = document.createElement('span');
      quickPickHint.className = 'pounce-hint';
      quickPickHint.setAttribute('data-pounce-quick-pick-hint', '');
      const quickPickModKey = document.createElement('span');
      quickPickModKey.className = 'pounce-hint-key';
      quickPickModKey.textContent = this.shortcutKeyLabel;
      const quickPickRangeKey = document.createElement('span');
      quickPickRangeKey.className = 'pounce-hint-key';
      quickPickRangeKey.textContent = '1-9';
      const quickPickLabel = document.createTextNode(' ' + (window.i18n ? window.i18n.t('overlay_quickPick') : 'Quick pick'));
      quickPickHint.appendChild(quickPickModKey);
      quickPickHint.appendChild(quickPickRangeKey);
      quickPickHint.appendChild(quickPickLabel);
      this.quickPickHintLabelEl = quickPickLabel;

      const closeHint = document.createElement('span');
      closeHint.className = 'pounce-hint';
      const closeKey = document.createElement('span');
      closeKey.className = 'pounce-hint-key';
      closeKey.textContent = 'Esc';
      const closeLabel = document.createTextNode(' ' + (window.i18n ? window.i18n.t('overlay_close') : 'Close'));
      closeHint.appendChild(closeKey);
      closeHint.appendChild(closeLabel);
      this.closeHintEl = closeLabel;

      rightContainer.appendChild(navigateHint);
      rightContainer.appendChild(selectHint);
      rightContainer.appendChild(quickPickHint);
      rightContainer.appendChild(closeHint);
      this.quickPickHint = quickPickHint;
      bottomContainer.appendChild(rightContainer);
      
      // Assemble the overlay with correct structure
      inputContainer.appendChild(searchIcon);
      inputContainer.appendChild(this.searchInput);
      inputContainer.appendChild(closeIcon);
      container.appendChild(inputContainer);
      container.appendChild(this.resultsContainer);
      container.appendChild(bottomContainer);
      this.overlay.appendChild(container);

      this.shadowRoot.appendChild(this.overlay);
      (document.body || document.documentElement).appendChild(shadowHost);
    }

    getResultsLimitLabel() {
      return window.i18n ? window.i18n.t('options_resultsLimit') : 'Results shown';
    }

    createResultsLimitSelect() {
      const select = document.createElement('select');
      select.className = 'pounce-results-limit-select';

      ALLOWED_RESULTS_LIMITS.forEach((limit) => {
        const option = document.createElement('option');
        option.value = String(limit);
        option.textContent = String(limit);
        select.appendChild(option);
      });

      this.syncResultsLimitSelectLabel(select);
      return select;
    }

    syncResultsLimitSelectLabel(select = this.resultsLimitSelect) {
      if (!select) return;
      const label = this.getResultsLimitLabel();
      select.title = label;
      select.setAttribute('aria-label', label);
    }

    syncResultsLimitSelectValue() {
      if (!this.resultsLimitSelect) return;
      this.resultsLimitSelect.value = String(this.searchPreferences.resultsLimit);
    }

    isResultsLimitSelectEvent(event) {
      if (!this.resultsLimitSelect || !event) return false;
      if (event.target === this.resultsLimitSelect) return true;
      return typeof event.composedPath === 'function' &&
        event.composedPath().includes(this.resultsLimitSelect);
    }
    
    bindEvents() {
      // Listen for messages from background script
      // 用实例属性保存 handler 引用，destroy() 时才能 removeListener
      this.runtimeMessageHandler = (message, sender, sendResponse) => {
        if (this.isDestroyed) return;
        if (message.action === 'showSearchOverlay') {
          this.bridgeTabId = message.bridgeTabId ?? null;
          this.show();
          sendResponse({ success: true });
        }
      };
      chrome.runtime.onMessage.addListener(this.runtimeMessageHandler);
      
      // Search input events
      this.searchInput.addEventListener('input', (e) => {
        this._resetMouseActivation();
        this.handleSearch(e.target.value);
      });

      this.searchInput.addEventListener('keydown', (e) => {
        // 任何键盘动作都视为"用户在用键盘"，重置鼠标激活状态。
        // 这样键盘选完后，trackpad 微小抖动（<5px）不会再把选中抢走。
        this._resetMouseActivation();
        this.handleKeyDown(e);
      });

      if (this.resultsLimitSelect) {
        this.resultsLimitSelect.addEventListener('change', () => {
          this.handleResultsLimitSelectChange();
        });
      }

      // 自维护 IME 组词状态：Shadow DOM + 部分 IME 下 e.isComposing 不可靠。
      this.isComposing = false;
      this.compositionEndedAt = 0;
      this.searchInput.addEventListener('compositionstart', () => {
        this.isComposing = true;
      });
      this.searchInput.addEventListener('compositionend', () => {
        this.isComposing = false;
        this.compositionEndedAt = performance.now();
        // Shadow DOM 边缘 case：compositionend 后输入框偶发失焦，光标消失。
        if (this.isVisible && this.shadowRoot.activeElement !== this.searchInput) {
          this.searchInput.focus();
        }
      });
      
      // 阻止点击冒泡到宿主页，同时点背板（overlay 本身）关闭弹窗
      this.overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target === this.overlay) this.hide();
      });
      
      // ESC 关闭走 keyup 而不是 keydown——
      // 原因：在 ESC keydown handler 里关掉跳板页（当前激活 tab）会让 Chrome
      // 的 "press and hold ESC to exit fullscreen" 保护被 bypass，单按 ESC
      // 就退 macOS Space。改到 keyup 之后，Chrome 已经判定过"短按、不退"，
      // 此时再 tabs.remove 和全屏状态无关。
      // handler 存为实例属性，扩展更新替换旧实例时 destroy() 才能清掉。
      this.docKeyDownHandler = (e) => {
        if (e.key === 'Escape' && this.isVisible) {
          // keydown 只拦截默认行为，不做关闭动作
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (this.isResultsLimitSelectEvent(e)) return;
      };
      this.docKeyUpHandler = (e) => {
        if (e.key === 'Escape' && this.isVisible) {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
          return;
        }
        if (this.isResultsLimitSelectEvent(e)) return;
      };
      document.addEventListener('keydown', this.docKeyDownHandler, { capture: true });
      document.addEventListener('keyup', this.docKeyUpHandler, { capture: true });

      // 屏蔽宿主页的 focus trap：浮层显示期间，"焦点进入 Pounce shadowHost"
      // 这一类 focusin 在 document capture 阶段就 stopPropagation，不让事件继续
      // 传到 body 及更下层。背景：Quasar QDialog 等 a11y 模态库会在 body 上挂
      // bubble 阶段 focusin，发现焦点跑出 dialog 就把焦点拽回 dialog 内第一个
      // [tabindex>=0] 元素（如关闭按钮）。从源头拦掉事件，它们不再触发抢回逻辑，
      // 避免和我们形成 ping-pong。仅当 target 是 shadowHost 时才拦，宿主自己内部
      // 的 focus 移动事件原样冒泡，不影响宿主自身的 focus 管理。
      // 验证场景：OpenObserve（QA 部署版本未带 allow-focus-outside），打开日志
      // 详情后按 Cmd+K，焦点会被关闭按钮抢走 → 此守卫接住。
      this.focusShieldHandler = (e) => {
        if (this.isDestroyed || !this.isVisible) return;
        if (e.target === this.shadowHost) {
          e.stopPropagation();
        }
      };
      document.addEventListener('focusin', this.focusShieldHandler, { capture: true });

      this.shadowRoot.getElementById('pounce-close-icon').addEventListener('click', (e) => {
        this.hide();
        e.preventDefault();
        e.stopPropagation();
      });

      this.overlay.addEventListener('keydown', (e) => {
        e.stopPropagation();
      });

      this.resultsContainer.addEventListener('scroll', () => {
        this.updateNumberBadges();
        // 滚轮滚动列表时，CSS :hover 会自动跟着光标位置走（光标不动但内容滚走，
        // 命中行变成新一项），但浏览器不会触发 mousemove → selectedIndex 与 hover
        // 行错位 → 又出现"两个高亮"。这里同步一次。
        this._syncSelectionToMouse();
      });

      // 真实鼠标移动判定：>5px 才认为是有意移动，避免 trackpad 误触；
      // 一旦激活，每次 mousemove 都把 selectedIndex 推到光标所在项，
      // 让"hover 高亮"和"键盘选中"始终是同一项。
      this.resultsContainer.addEventListener('mousemove', (e) => {
        // 缓存最近一次鼠标位置，用于异步重建结果列表后续上 hover 同步。
        this._lastMouseX = e.clientX;
        this._lastMouseY = e.clientY;
        if (!this._mouseActive) {
          if (this._mouseBaselineX === null) {
            this._mouseBaselineX = e.clientX;
            this._mouseBaselineY = e.clientY;
            return;
          }
          const dx = e.clientX - this._mouseBaselineX;
          const dy = e.clientY - this._mouseBaselineY;
          if (dx * dx + dy * dy < 25) return; // 5px 阈值
          this._mouseActive = true;
          if (this.overlay) this.overlay.classList.add('pn-mouse-active');
        }
        const item = e.target && e.target.closest ? e.target.closest('.pounce-search-result') : null;
        if (!item || !item.dataset || item.dataset.index === undefined) return;
        const idx = Number(item.dataset.index);
        if (Number.isFinite(idx) && idx !== this.selectedIndex) {
          this.selectedIndex = idx;
          this.updateSelection();
        }
      });

      this.storageChangeHandler = (changes, area) => {
        if (area !== 'sync') return;
        if (!SEARCH_PREFERENCE_KEYS.some(key => changes[key])) return;

        this.searchPreferences = normalizeSearchPreferences({
          quickPickEnabled: changes.quickPickEnabled ? changes.quickPickEnabled.newValue : this.searchPreferences.quickPickEnabled,
          pinyinMatchingEnabled: changes.pinyinMatchingEnabled ? changes.pinyinMatchingEnabled.newValue : this.searchPreferences.pinyinMatchingEnabled,
          resultsLimit: changes.resultsLimit ? changes.resultsLimit.newValue : this.searchPreferences.resultsLimit
        });
        this.applySearchPreferences();
      };
      chrome.storage.onChanged.addListener(this.storageChangeHandler);

      // 语言切换：reload 词典后重渲染静态文案
      this.languageChangeHandler = async (changes, area) => {
        if (this.isDestroyed) return;
        if (area !== 'sync' || !changes.language || !window.i18n) return;
        try {
          await window.i18n.reload();
        } catch (e) {
          console.warn('Pounce: failed to reload i18n', e);
          return;
        }
        this.rerenderStaticOverlayText();
      };
      chrome.storage.onChanged.addListener(this.languageChangeHandler);
    }

    rerenderStaticOverlayText() {
      if (this.isDestroyed || !window.i18n) return;
      if (this.searchInput) {
        this.searchInput.placeholder = window.i18n.t('overlay_searchPlaceholder');
      }
      if (this.navigateHintEl) {
        this.navigateHintEl.textContent = ' ' + window.i18n.t('overlay_navigate');
      }
      if (this.selectHintEl) {
        this.selectHintEl.textContent = ' ' + window.i18n.t('overlay_select');
      }
      if (this.quickPickHintLabelEl) {
        this.quickPickHintLabelEl.textContent = ' ' + window.i18n.t('overlay_quickPick');
      }
      if (this.closeHintEl) {
        this.closeHintEl.textContent = ' ' + window.i18n.t('overlay_close');
      }
      this.syncResultsLimitSelectLabel();
      // 重新渲染当前结果（含 sourceLabel 等动态文本）和计数
      if (this.currentResults && this.currentResults.length) {
        this.renderResults(this.searchInput ? this.searchInput.value : '');
      } else {
        // 0 结果：刷新计数和（若已挂出）空态文案
        if (this.resultsCounter) {
          this.resultsCounter.textContent = window.i18n.t('overlay_zeroResults');
        }
        if (this.resultsContainer) {
          const emptyEl = this.resultsContainer.querySelector('.pounce-search-empty');
          if (emptyEl) {
            emptyEl.textContent = window.i18n.t('overlay_noResults');
          }
        }
      }
    }
    
    _resetMouseActivation() {
      this._mouseActive = false;
      this._mouseBaselineX = null;
      this._mouseBaselineY = null;
      this._lastMouseX = null;
      this._lastMouseY = null;
      if (this.overlay) this.overlay.classList.remove('pn-mouse-active');
    }

    _syncSelectionToMouse() {
      if (!this._mouseActive) return;
      if (this._lastMouseX === null || this._lastMouseY === null) return;
      if (!this.shadowRoot || typeof this.shadowRoot.elementFromPoint !== 'function') return;
      const hit = this.shadowRoot.elementFromPoint(this._lastMouseX, this._lastMouseY);
      if (!hit || !hit.closest) return;
      const item = hit.closest('.pounce-search-result');
      if (!item || !item.dataset || item.dataset.index === undefined) return;
      const idx = Number(item.dataset.index);
      if (Number.isFinite(idx) && idx !== this.selectedIndex) {
        this.selectedIndex = idx;
        this.updateSelection();
      }
    }

    _placeShadowHostForFocus() {
      const activeDialog = document.activeElement?.closest?.('dialog, [role="dialog"], [aria-modal="true"]');
      const parent = activeDialog || document.body;
      if (this.shadowHost && this.shadowHost.parentNode !== parent) {
        parent.appendChild(this.shadowHost);
      }
    }

    _focusSearchInput() {
      if (this.isDestroyed || !this.isVisible || !this.searchInput) return;
      if (this.shadowRoot?.activeElement !== this.searchInput) {
        this.searchInput.focus();
      }
    }

    _scheduleFocusRestore() {
      queueMicrotask(() => this._focusSearchInput());
      this.focusRestoreFrame = requestAnimationFrame(() => {
        this.focusRestoreFrame = null;
        this._focusSearchInput();
      });
      this.focusRestoreTimer = setTimeout(() => {
        this.focusRestoreTimer = null;
        this._focusSearchInput();
      }, 0);
    }

    _cancelFocusRestore() {
      if (this.focusRestoreFrame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.focusRestoreFrame);
      }
      if (this.focusRestoreTimer !== null) {
        clearTimeout(this.focusRestoreTimer);
      }
      this.focusRestoreFrame = null;
      this.focusRestoreTimer = null;
    }

    show() {
      if (this.isVisible) return;

      this.isVisible = true;
      this._placeShadowHostForFocus();
      this.overlay.style.display = 'flex';
      this.searchInput.value = '';
      this._focusSearchInput();
      this._scheduleFocusRestore();
      this.selectedIndex = -1;
      this._resetMouseActivation();
      this.loadSearchPreferences();
      
      // Load initial data
      this.loadSearchData();
      
      // Prevent page scrolling
      document.body.style.overflow = 'hidden';
    }
    
    hide() {
      if (!this.isVisible) return;
      this.isVisible = false; // 先置 false，阻止重复触发
      this._cancelFocusRestore();

      // 如果是跳板页且用户未选择结果，直接关闭该标签页。
      // 关键：用 setTimeout 把 tabs.remove 推出当前 keydown 事件栈。
      // 原因：在 ESC keydown handler 同步调用链里关掉当前激活 tab，会让
      // Chrome 的 "press and hold ESC to exit fullscreen" 计时器失效，
      // 单按 ESC 就会退出 macOS Space。推到下一个 task 后，keydown 已结束，
      // Chrome 完成短按判定不退 Space，之后再关 tab，两者不再互相干扰。
      if (this.bridgeTabId) {
        const tabId = this.bridgeTabId;
        this.bridgeTabId = null;
        setTimeout(() => {
          chrome.runtime.sendMessage({ action: 'closeBridgeTab', tabId }).catch(() => {});
        }, 0);
        return;
      }

      this.overlay.style.display = 'none';
      this.searchInput.blur();
      this.currentResults = [];
      this.selectedIndex = -1;
      this.cancelHistoryFetch();
      this.dynamicHistoryItems = [];

      // Restore page scrolling
      document.body.style.overflow = '';
    }
    
    destroy() {
      // 扩展更新后，旧实例若被 background 重新注入路径碰到，需要先彻底清理：
      // - 标记 isDestroyed，让残存回调短路
      // - 清 timer / 解绑文档级 listeners / 摘除 shadow host / 复原 body 滚动
      // 缺一不可：少摘 shadow host 会留两份 overlay，少解 listener 老 ESC 仍会触发旧逻辑。
      if (this.isDestroyed) return;
      this.isDestroyed = true;

      if (this.historyFetchTimer) {
        clearTimeout(this.historyFetchTimer);
        this.historyFetchTimer = null;
      }
      this._cancelFocusRestore();

      if (this.docKeyDownHandler) {
        document.removeEventListener('keydown', this.docKeyDownHandler, { capture: true });
        this.docKeyDownHandler = null;
      }
      if (this.docKeyUpHandler) {
        document.removeEventListener('keyup', this.docKeyUpHandler, { capture: true });
        this.docKeyUpHandler = null;
      }
      if (this.focusShieldHandler) {
        document.removeEventListener('focusin', this.focusShieldHandler, { capture: true });
        this.focusShieldHandler = null;
      }

      try {
        if (this.runtimeMessageHandler && chrome.runtime?.onMessage?.removeListener) {
          chrome.runtime.onMessage.removeListener(this.runtimeMessageHandler);
        }
      } catch (e) {
        // chrome.runtime 可能已失效（extension context invalidated），忽略
      }
      this.runtimeMessageHandler = null;

      try {
        if (this.storageChangeHandler && chrome.storage?.onChanged?.removeListener) {
          chrome.storage.onChanged.removeListener(this.storageChangeHandler);
        }
      } catch (e) {
        // chrome.runtime 可能已失效（extension context invalidated），忽略
      }
      this.storageChangeHandler = null;

      try {
        if (this.languageChangeHandler && chrome.storage?.onChanged?.removeListener) {
          chrome.storage.onChanged.removeListener(this.languageChangeHandler);
        }
      } catch (e) {
        // chrome.runtime 可能已失效（extension context invalidated），忽略
      }
      this.languageChangeHandler = null;

      if (this.shadowHost && this.shadowHost.parentNode) {
        this.shadowHost.parentNode.removeChild(this.shadowHost);
      }
      this.shadowHost = null;
      this.shadowRoot = null;
      this.overlay = null;
      this.searchInput = null;
      this.resultsContainer = null;
      this.resultsLimitSelect = null;

      if (this.isVisible) {
        document.body.style.overflow = '';
      }
      this.isVisible = false;
    }

    async loadSearchPreferences() {
      try {
        const savedPreferences = await chrome.storage.sync.get(SEARCH_PREFERENCE_KEYS);
        if (this.isDestroyed) return;
        this.searchPreferences = normalizeSearchPreferences(savedPreferences);
        this.applySearchPreferences();
      } catch (error) {
        console.warn('Pounce: failed to load search preferences', error);
      }
    }

    applySearchPreferences() {
      if (window.PounceSearchUtils && typeof window.PounceSearchUtils.setPinyinMatchingEnabled === 'function') {
        window.PounceSearchUtils.setPinyinMatchingEnabled(this.searchPreferences.pinyinMatchingEnabled);
      }

      this.syncResultsLimitSelectValue();

      if (this.overlay) {
        this.overlay.classList.toggle('pounce-quick-pick-disabled', !this.searchPreferences.quickPickEnabled);
      }

      if (this.quickPickHint) {
        this.quickPickHint.style.display = this.searchPreferences.quickPickEnabled ? 'flex' : 'none';
      }

      if (this.allData) {
        this.rerankAndRender(this.searchInput ? this.searchInput.value : '');
        return;
      }

      this.updateNumberBadges();
    }

    handleResultsLimitSelectChange() {
      this.updateResultsLimitPreference(this.resultsLimitSelect.value);
      if (this.isVisible && this.searchInput) {
        this.searchInput.focus();
      }
    }

    async updateResultsLimitPreference(value) {
      const nextPreferences = normalizeSearchPreferences({
        ...this.searchPreferences,
        resultsLimit: value
      });
      const nextLimit = nextPreferences.resultsLimit;

      if (nextLimit === this.searchPreferences.resultsLimit) {
        this.syncResultsLimitSelectValue();
        return;
      }

      const previousPreferences = this.searchPreferences;
      this.searchPreferences = nextPreferences;
      this.applySearchPreferences();

      try {
        await this.saveResultsLimitPreference(nextLimit);
      } catch (error) {
        console.warn('Pounce: failed to save results limit preference', error);
        this.searchPreferences = previousPreferences;
        this.applySearchPreferences();
      }
    }

    saveResultsLimitPreference(resultsLimit) {
      return chrome.storage.sync.set({ resultsLimit });
    }

    async loadSearchData() {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'getSearchData'
        });

        if (response && response.success) {
          this.allData = response.data;
          this.handleSearch(this.searchInput.value);
        } else {
          console.error('Pounce: Response indicates failure:', response);
          const base = window.i18n ? window.i18n.t('overlay_loadError') : 'Failed to load search data';
          const unknownErr = window.i18n ? window.i18n.t('overlay_unknownError') : 'Unknown error';
          this.showError(base + ': ' + (response?.error || unknownErr));
        }
      } catch (error) {
        console.error('Pounce: Error loading search data:', error);
        const base = window.i18n ? window.i18n.t('overlay_loadError') : 'Failed to load search data';
        this.showError(base + ': ' + error.message);
      }
    }
    
    handleSearch(query) {
      if (!this.allData) {
        this.showLoading();
        return;
      }

      const trimmed = String(query || '').trim();
      if (trimmed) {
        this.scheduleHistoryFetch(trimmed);
      } else {
        this.cancelHistoryFetch();
        this.dynamicHistoryItems = [];
      }

      this.rerankAndRender(query);
    }

    rerankAndRender(query) {
      const merged = Array.isArray(this.dynamicHistoryItems) && this.dynamicHistoryItems.length
        ? [...this.allData, ...this.dynamicHistoryItems]
        : this.allData;

      const limit = this.searchPreferences.resultsLimit || DEFAULT_SEARCH_PREFERENCES.resultsLimit;
      if (window.PounceSearchUtils && typeof window.PounceSearchUtils.rankResults === 'function') {
        this.currentResults = window.PounceSearchUtils.rankResults(merged, query, limit);
      } else {
        this.currentResults = this.getFallbackResults(query);
      }

      this.selectedIndex = -1;
      this.renderResults(query);
    }

    cancelHistoryFetch() {
      if (this.historyFetchTimer) {
        clearTimeout(this.historyFetchTimer);
        this.historyFetchTimer = null;
      }
      this.historyFetchRequestId += 1;
    }

    scheduleHistoryFetch(query) {
      this.cancelHistoryFetch();
      const requestId = this.historyFetchRequestId;

      this.historyFetchTimer = setTimeout(async () => {
        this.historyFetchTimer = null;
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'searchHistory',
            query
          });

          if (requestId !== this.historyFetchRequestId) return;
          if (!this.isVisible) return;
          if (String(this.searchInput.value || '').trim() !== query) return;

          this.dynamicHistoryItems = response && response.success && Array.isArray(response.data)
            ? response.data
            : [];
          this.rerankAndRender(this.searchInput.value);
        } catch (error) {
          console.warn('Pounce: dynamic history fetch failed', error);
        }
      }, 120);
    }

    getFallbackResults(query) {
      const trimmedQuery = String(query || '').trim();
      const normalizedQuery = trimmedQuery.toLowerCase();
      const sourcePriority = {
        tab: 0,
        history: 1,
        topSite: 2,
        bookmark: 3
      };
      const items = Array.isArray(this.allData) ? this.allData.slice() : [];
      const filteredItems = normalizedQuery
        ? items.filter((item) => {
          const title = String(item.title || '').toLowerCase();
          const url = String(item.url || '').toLowerCase();
          return title.includes(normalizedQuery) || url.includes(normalizedQuery);
        })
        : items;

      filteredItems.sort((a, b) => {
        const sourceDiff = (sourcePriority[a.type] ?? 99) - (sourcePriority[b.type] ?? 99);
        if (sourceDiff !== 0) {
          return sourceDiff;
        }

        if (a.type === 'tab' && b.type === 'tab') {
          return (b.lastAccessed || 0) - (a.lastAccessed || 0);
        }

        if (a.type === 'history' && b.type === 'history') {
          const typedDiff = (b.typedCount || 0) - (a.typedCount || 0);
          if (typedDiff !== 0) {
            return typedDiff;
          }

          const visitDiff = (b.visitCount || 0) - (a.visitCount || 0);
          if (visitDiff !== 0) {
            return visitDiff;
          }

          return (b.lastVisitTime || 0) - (a.lastVisitTime || 0);
        }

        const aTitle = String(a.title || '').toLowerCase();
        const bTitle = String(b.title || '').toLowerCase();
        return aTitle.localeCompare(bTitle);
      });

      const tr = (key, fallback) => (window.i18n ? window.i18n.t(key) : fallback);
      const limit = this.searchPreferences.resultsLimit || DEFAULT_SEARCH_PREFERENCES.resultsLimit;
      const results = filteredItems.slice(0, limit).map((item) => {
        const sourceLabel = item.type === 'history'
          ? tr('overlay_sourceHistory', 'History')
          : item.type === 'topSite'
            ? tr('overlay_sourceTopSite', 'Top Site')
            : item.type === 'bookmark'
              ? tr('overlay_sourceBookmark', 'Bookmark')
              : '';
        const iconFallback = item.type === 'tab'
          ? 'T'
          : item.type === 'history'
            ? 'H'
            : item.type === 'topSite'
              ? 'S'
              : item.type === 'bookmark'
                ? 'B'
                : '?';
        let displayUrl = item.url || '';

        if (item.type !== 'search' && item.url) {
          try {
            const parsedUrl = new URL(item.url);
            const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
            const pathname = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/+$/, '');
            displayUrl = `${hostname}${pathname}${parsedUrl.search}`;
          } catch (error) {
            displayUrl = item.url;
          }
        }

        return {
          ...item,
          displayTitle: item.title || item.url || tr('overlay_untitled', 'Untitled'),
          displayUrl,
          sourceLabel,
          iconFallback
        };
      });

      if (!trimmedQuery) {
        return results;
      }

      const openResult = this.createOpenFallbackResult(trimmedQuery);
      const searchTitle = window.i18n
        ? window.i18n.t('overlay_searchForQuery', [trimmedQuery])
        : `Search for "${trimmedQuery}"`;
      const searchResult = {
        type: 'search',
        id: 'web-search',
        title: searchTitle,
        url: `search:${trimmedQuery}`,
        displayTitle: searchTitle,
        displayUrl: tr('overlay_searchDefault', 'Search with default search engine'),
        sourceLabel: tr('overlay_sourceSearch', 'Search'),
        iconFallback: 'S',
        isSearchOption: true
      };

      return openResult ? [...results, openResult, searchResult] : [...results, searchResult];
    }

    createOpenFallbackResult(query) {
      if (!query || /\s/.test(query)) {
        return null;
      }

      let url = null;

      if (/^https?:\/\//i.test(query)) {
        url = query;
      } else {
        const hostMatch = query.match(
          /^(localhost(?::\d+)?|(?:\d{1,3}\.){3}\d{1,3}|(?:\[[0-9a-f:.]+\]))(?:[/?#].*)?$/i
        );

        if (hostMatch) {
          url = `http://${query}`;
        } else {
          const domainPattern = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i;
          if (domainPattern.test(query)) {
            url = `https://${query}`;
          }
        }
      }

      if (!url) {
        return null;
      }

      try {
        const parsedUrl = new URL(url);
        const normalizedUrl = parsedUrl.href;
        return {
          type: 'open',
          id: 'direct-open',
          title: normalizedUrl,
          url: normalizedUrl,
          displayTitle: window.i18n ? window.i18n.t('overlay_openUrl', [normalizedUrl]) : `Open ${normalizedUrl}`,
          displayUrl: normalizedUrl,
          sourceLabel: window.i18n ? window.i18n.t('overlay_sourceOpen') : 'Open',
          iconFallback: 'O',
          isOpenOption: true
        };
      } catch (error) {
        return null;
      }
    }
    renderHighlightedText(textEl, text, ranges) {
      // Always reset the element first.
      textEl.textContent = '';

      const safeText = typeof text === 'string' ? text : '';
      const safeRanges = Array.isArray(ranges) ? ranges : [];

      if (safeRanges.length === 0) {
        textEl.textContent = safeText;
        return;
      }

      let cursor = 0;
      for (const range of safeRanges) {
        const start = range[0];
        const end = range[1];
        if (start > cursor) {
          textEl.appendChild(document.createTextNode(safeText.slice(cursor, start)));
        }
        const span = document.createElement('span');
        span.className = 'pounce-highlight';
        span.textContent = safeText.slice(start, end);
        textEl.appendChild(span);
        cursor = end;
      }

      if (cursor < safeText.length) {
        textEl.appendChild(document.createTextNode(safeText.slice(cursor)));
      }
    }

    renderResults(query = '') {
      if (!this.currentResults.length) {
        this.showEmpty();
        return;
      }

      this.resultsContainer.innerHTML = '';

      this.currentResults.forEach((item, index) => {
        const resultElement = this.createResultElement(item, index, query);
        this.resultsContainer.appendChild(resultElement);
      });
      
      // 自动选中第一项
      if (this.currentResults.length > 0) {
        this.selectedIndex = 0;
        this.updateSelection();
      }

      // 列表异步重建（如 history 拉取回来后 rerankAndRender）若鼠标仍在某项上
      // 但未触发新 mousemove，selectedIndex 已被重置为 0 而 .pn-mouse-active 还在，
      // CSS :hover 会让光标下那条也高亮 → 又出现"两个选中"。
      // 这里用缓存的鼠标坐标 + shadowRoot.elementFromPoint 续上同步。
      this._syncSelectionToMouse();

      // 初始编号（异步等 layout 稳定后再算）
      requestAnimationFrame(() => this.updateNumberBadges());
      
      // 更新结果计数显示（排除搜索选项）
      const actualResultsCount = this.currentResults.filter(item => item.type !== 'search').length;
      this.updateResultsCount(actualResultsCount);
    }
    
    createResultElement(item, index, query = '') {
      const element = document.createElement('div');
      element.className = 'pounce-search-result';
      element.dataset.index = String(index);
      if (index === this.selectedIndex) {
        element.classList.add('selected');
      }
      
      // Icon
      const icon = document.createElement('div');
      icon.className = `pounce-result-icon ${item.type}`;
      
      // Special handling for synthetic options.
      if (item.type === 'search') {
        icon.innerHTML = this.getSearchIconSvg();
        element.classList.add('search-option');
      } else if (item.type === 'open') {
        element.classList.add('open-option');
      }

      const favIconUrl = this.getSafeFaviconUrl(item);

      if (item.type !== 'search') {
        if (favIconUrl && !favIconUrl.startsWith('chrome://')) {
          // 使用实际的网页图标（跳过 chrome:// 图标，浏览器会阻止加载）
          const img = document.createElement('img');
          img.src = favIconUrl;
          img.alt = item.displayTitle || item.title || (window.i18n ? window.i18n.t('overlay_websiteIconAlt') : 'Website icon');
          img.onerror = function() {
            // 如果图标加载失败，显示默认文字
            icon.innerHTML = '';
            icon.textContent = item.iconFallback || '?';
          };
          icon.appendChild(img);
        } else {
          // 没有图标URL时显示默认文字
          icon.textContent = item.iconFallback || '?';
        }
      }
      
      // Content
      const content = document.createElement('div');
      content.className = 'pounce-result-content';
      
      const titleText = item.displayTitle || item.title || (window.i18n ? window.i18n.t('overlay_untitled') : 'Untitled');
      const urlText = item.displayUrl || item.url || '';
      const isHighlightable = HIGHLIGHTABLE_TYPES.includes(item.type) &&
        typeof query === 'string' &&
        query.trim().length > 0;
      const ranger = (typeof globalThis !== 'undefined' && globalThis.PounceSearchUtils && globalThis.PounceSearchUtils.getHighlightRanges) || null;

      const title = document.createElement('div');
      title.className = 'pounce-result-title';
      if (isHighlightable && ranger) {
        this.renderHighlightedText(title, titleText, ranger(titleText, query));
      } else {
        title.textContent = titleText;
      }

      const url = document.createElement('div');
      url.className = 'pounce-result-url';
      if (isHighlightable && ranger) {
        this.renderHighlightedText(url, urlText, ranger(urlText, query));
      } else {
        url.textContent = urlText;
      }
      
      content.appendChild(title);
      content.appendChild(url);
      
      // Badge
      const badge = document.createElement('div');
      badge.className = `pounce-result-badge pounce-result-badge-${item.type}`;
      badge.textContent = item.sourceLabel || '';
      const num = document.createElement('div');
      num.className = 'pounce-result-number';
      element.appendChild(num);
      element.appendChild(icon);
      element.appendChild(content);
      if (item.sourceLabel) {
        element.appendChild(badge);
      }
      
      // Click handler
      element.addEventListener('click', () => {
        this.selectResult(index);
      });
      
      return element;
    }
    
    handleKeyDown(e) {
      // IME 组词期间 Enter/方向键属于输入法候选操作；keyCode 229 兜底浏览器不报 isComposing 的场景。
      if (this.isComposing || e.keyCode === 229) return;

      if (e.key === 'Enter' && performance.now() - this.compositionEndedAt < IME_TRAILING_ENTER_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.moveSelection(1);
          break;
          
        case 'ArrowUp':
          e.preventDefault();
          this.moveSelection(-1);
          break;
          
        case 'Enter':
          e.preventDefault();
          if (this.selectedIndex >= 0 && this.selectedIndex < this.currentResults.length) {
            this.selectResult(this.selectedIndex);
          }
          break;
          
        case 'Escape':
          // 关闭由 document 级 keyup handler 负责，此处仅防默认行为。
          // 不要在 keydown 里 hide() —— 见文件里 keyup 分支的注释。
          e.preventDefault();
          break;

        default:
          // Alt+1..9 触发快速跳转。用 e.code 而非 e.key —— Mac 上 Alt+1 的 e.key 是 ¡ 等特殊字符，
          // 只有 e.code='Digit1' 跨平台稳定。同时排除 Ctrl/Meta 组合，避免误触浏览器原生快捷键。
          // preventDefault 提到外层：即使对应位置没有结果（比如只搜到 3 条但按 Alt+5），
          // 也要吞掉默认行为，否则 Mac 上 Option+5 的 ∞ 等特殊字符会污染搜索框。
          if (this.searchPreferences.quickPickEnabled && e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code)) {
            e.preventDefault();
            const pos = parseInt(e.code.slice(5), 10) - 1;
            if (this.visibleResultIndices && pos < this.visibleResultIndices.length) {
              this.selectResult(this.visibleResultIndices[pos]);
            }
          }
      }
    }
    
    moveSelection(direction) {
      if (!this.currentResults.length) return;
      
      const newIndex = this.selectedIndex + direction;
      
      if (newIndex >= 0 && newIndex < this.currentResults.length) {
        this.selectedIndex = newIndex;
      } else if (newIndex < 0) {
        this.selectedIndex = this.currentResults.length - 1;
      } else {
        this.selectedIndex = 0;
      }
      
      this.updateSelection();
    }
    
    updateSelection() {
      const results = this.resultsContainer.querySelectorAll('.pounce-search-result');
      results.forEach((result, index) => {
        if (index === this.selectedIndex) {
          result.classList.add('selected');
          result.scrollIntoView({ block: 'nearest' });
        } else {
          result.classList.remove('selected');
        }
      });
      // scrollIntoView 可能改变可视区域，等 layout 后重算编号
      requestAnimationFrame(() => this.updateNumberBadges());
    }
    
    updateNumberBadges() {
      if (!this.searchPreferences.quickPickEnabled) {
        this.visibleResultIndices = [];
        this.resultsContainer.querySelectorAll('.pounce-result-number').forEach((numEl) => {
          numEl.textContent = '';
        });
        return;
      }

      const containerRect = this.resultsContainer.getBoundingClientRect();
      const results = Array.from(this.resultsContainer.querySelectorAll('.pounce-search-result'));
      this.visibleResultIndices = [];

      results.forEach((result, index) => {
        const numEl = result.querySelector('.pounce-result-number');
        if (!numEl) return;
        const rect = result.getBoundingClientRect();
        const visible = rect.top < containerRect.bottom && rect.bottom > containerRect.top;
        if (visible && this.visibleResultIndices.length < 9) {
          this.visibleResultIndices.push(index);
          numEl.textContent = `${this.shortcutPrefix}${this.visibleResultIndices.length}`;
        } else {
          numEl.textContent = '';
        }
      });
    }

    async selectResult(index) {
      if (index < 0 || index >= this.currentResults.length) return;
      
      const item = this.currentResults[index];
      
      try {
        if (item.type === 'search') {
          const searchQuery = item.url.replace('search:', '');
          await chrome.runtime.sendMessage({
            action: 'performWebSearch',
            query: searchQuery,
            bridgeTabId: this.bridgeTabId
          });
        } else if (item.type === 'open') {
          await chrome.runtime.sendMessage({
            action: 'openBookmark',
            url: item.url,
            bridgeTabId: this.bridgeTabId
          });
        } else if (item.type === 'tab') {
          // Switch to existing tab; if bridge tab exists, close it first
          await chrome.runtime.sendMessage({
            action: 'switchToTab',
            tabId: item.id,
            url: item.url,
            bridgeTabId: this.bridgeTabId
          });
        } else {
          // Open bookmark/history/top site — navigate bridge tab or open new tab
          await chrome.runtime.sendMessage({
            action: 'openBookmark',
            url: item.url,
            bridgeTabId: this.bridgeTabId
          });
        }

        // Bridge is now owned by background (reused as destination or already closed);
        // clear so hide() won't re-close the freshly-loaded tab.
        this.bridgeTabId = null;
        this.hide();
      } catch (error) {
        console.error('Pounce: Error selecting result:', error);
      }
    }
    
    showLoading() {
      const loadingText = window.i18n ? window.i18n.t('overlay_loading') : 'Loading...';
      this.resultsContainer.innerHTML = '';
      const loadingEl = document.createElement('div');
      loadingEl.className = 'pounce-search-loading';
      loadingEl.textContent = loadingText;
      this.resultsContainer.appendChild(loadingEl);
      // 加载时显示加载状态
      if (this.resultsCounter) {
        this.resultsCounter.textContent = loadingText;
      }
    }
    
    showEmpty() {
      this.resultsContainer.innerHTML = '';
      const emptyEl = document.createElement('div');
      emptyEl.className = 'pounce-search-empty';
      emptyEl.textContent = window.i18n
        ? window.i18n.t('overlay_noResults')
        : 'No matching tabs, history, bookmarks, or top sites found';
      this.resultsContainer.appendChild(emptyEl);
      // 更新计数为0
      this.updateResultsCount(0);
    }
    
    showError(message) {
      this.resultsContainer.innerHTML = `
        <div class="pounce-search-empty">
          ${message}
        </div>
      `;
      // 错误时显示0结果
      this.updateResultsCount(0);
    }
    
    updateResultsCount(count) {
      if (this.resultsCounter) {
        const text = window.i18n
          ? (count === 1 ? window.i18n.t('overlay_resultsCountOne') : window.i18n.t('overlay_resultsCount', [String(count)]))
          : (count === 1 ? '1 result' : `${count} results`);
        this.resultsCounter.textContent = text;
      }
    }
  }
  
  // Initialize when DOM is ready.
  // 关键时序：先 new 出 overlay 注册 onMessage 监听，再异步加载 i18n。
  // 否则 background.js 在 bridge 标签页加载完 50ms 后发送 showSearchOverlay
  // 时监听器还没就绪，消息会丢失。i18n.init 完成后再刷新一次静态文本。
  const bootstrap = () => {
    const overlay = new PounceSearchOverlay();
    window.pounceSearchOverlay = overlay;
    if (window.i18n) {
      window.i18n.init().then(() => {
        overlay.rerenderStaticOverlayText();
      }).catch((e) => {
        console.warn('Pounce: i18n init failed, falling back to English literals', e);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
