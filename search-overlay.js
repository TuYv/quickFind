// Pounce Search Overlay - Content Script
(function() {
  'use strict';

  // Prevent multiple injections
  if (window.pounceSearchOverlay) {
    return;
  }

  // compositionend 之后 Chrome/macOS IME 偶发多发一次 Enter keydown（isComposing=false），
  // 此窗口内收到的 Enter 一律视为 IME trailing，避免误触发 selectResult。
  const IME_TRAILING_ENTER_GUARD_MS = 120;
  
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

      this.init();
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
      searchIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="11" cy="11" r="7.5" stroke="currentColor" stroke-width="1.75"/>
          <path d="M20 20L16.5 16.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
      `;
      
      // Create search input
      this.searchInput = document.createElement('input');
      this.searchInput.className = 'pounce-search-input';
      this.searchInput.type = 'text';
      this.searchInput.placeholder = 'Search tabs, history, bookmarks, and top sites...';
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
      leftContainer.textContent = '0 results';
      this.resultsCounter = leftContainer; // 保存引用以便后续更新
      bottomContainer.appendChild(leftContainer);
      const rightContainer = document.createElement('div');
      rightContainer.className = 'pounce-hints';
      rightContainer.innerHTML = `
        <span class="pounce-hint">
          <span class="pounce-hint-key">↑</span><span class="pounce-hint-key">↓</span> Navigate
        </span>
        <span class="pounce-hint">
          <span class="pounce-hint-key">↵</span> Select
        </span>
        <span class="pounce-hint">
          <span class="pounce-hint-key">Esc</span> Close
        </span>
      `;
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
    
    bindEvents() {
      // Listen for messages from background script
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'showSearchOverlay') {
          this.bridgeTabId = message.bridgeTabId ?? null;
          this.show();
          sendResponse({ success: true });
        }
      });
      
      // Search input events
      this.searchInput.addEventListener('input', (e) => {
        this.handleSearch(e.target.value);
      });

      this.searchInput.addEventListener('keydown', (e) => {
        this.handleKeyDown(e);
      });

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
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isVisible) {
          // keydown 只拦截默认行为，不做关闭动作
          e.preventDefault();
          e.stopPropagation();
        }
      }, { capture: true });
      document.addEventListener('keyup', (e) => {
        if (e.key === 'Escape' && this.isVisible) {
          this.hide();
        }
      }, { capture: true });

      this.shadowRoot.getElementById('pounce-close-icon').addEventListener('click', (e) => {
        this.hide();
        e.preventDefault();
        e.stopPropagation();
      });

      this.overlay.addEventListener('keydown', (e) => {
        e.stopPropagation();
      });
    }
    
    show() {
      if (this.isVisible) return;
      
      this.isVisible = true;
      this.overlay.style.display = 'flex';
      this.searchInput.value = '';
      this.searchInput.focus();
      this.selectedIndex = -1;
      
      // Load initial data
      this.loadSearchData();
      
      // Prevent page scrolling
      document.body.style.overflow = 'hidden';
    }
    
    hide() {
      if (!this.isVisible) return;
      this.isVisible = false; // 先置 false，阻止重复触发

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
    
    async loadSearchData() {
      try {
        console.log('Pounce: Requesting search data...');
        // Request search data from background script
        const response = await chrome.runtime.sendMessage({
          action: 'getSearchData'
        });
        
        console.log('Pounce: Received response:', response);
        
        if (response && response.success) {
          this.allData = response.data;
          console.log('Pounce: Loaded data:', this.allData.length, 'items');
          this.handleSearch(this.searchInput.value);
        } else {
          console.error('Pounce: Response indicates failure:', response);
          this.showError('Failed to load search data: ' + (response?.error || 'Unknown error'));
        }
      } catch (error) {
        console.error('Pounce: Error loading search data:', error);
        this.showError('Failed to load search data: ' + error.message);
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

      if (window.PounceSearchUtils && typeof window.PounceSearchUtils.rankResults === 'function') {
        this.currentResults = window.PounceSearchUtils.rankResults(merged, query, 10);
      } else {
        this.currentResults = this.getFallbackResults(query);
      }

      this.selectedIndex = -1;
      this.renderResults();
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

      const results = filteredItems.slice(0, 10).map((item) => {
        const sourceLabel = item.type === 'history'
          ? 'History'
          : item.type === 'topSite'
            ? 'Top Site'
            : item.type === 'bookmark'
              ? 'Bookmark'
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
          displayTitle: item.title || item.url || 'Untitled',
          displayUrl,
          sourceLabel,
          iconFallback
        };
      });

      if (!trimmedQuery) {
        return results;
      }

      const openResult = this.createOpenFallbackResult(trimmedQuery);
      const searchResult = {
        type: 'search',
        id: 'web-search',
        title: `Search for "${trimmedQuery}"`,
        url: `search:${trimmedQuery}`,
        displayTitle: `Search for "${trimmedQuery}"`,
        displayUrl: 'Search with default search engine',
        sourceLabel: 'Search',
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
          displayTitle: `Open ${normalizedUrl}`,
          displayUrl: normalizedUrl,
          sourceLabel: 'Open',
          iconFallback: 'O',
          isOpenOption: true
        };
      } catch (error) {
        return null;
      }
    }
    
    renderResults() {
      if (!this.currentResults.length) {
        this.showEmpty();
        return;
      }
      
      this.resultsContainer.innerHTML = '';
      
      this.currentResults.forEach((item, index) => {
        const resultElement = this.createResultElement(item, index);
        this.resultsContainer.appendChild(resultElement);
      });
      
      // 自动选中第一项
      if (this.currentResults.length > 0) {
        this.selectedIndex = 0;
        this.updateSelection();
      }
      
      // 更新结果计数显示（排除搜索选项）
      const actualResultsCount = this.currentResults.filter(item => item.type !== 'search').length;
      this.updateResultsCount(actualResultsCount);
    }
    
    createResultElement(item, index) {
      const element = document.createElement('div');
      element.className = 'pounce-search-result';
      if (index === this.selectedIndex) {
        element.classList.add('selected');
      }
      
      // Icon
      const icon = document.createElement('div');
      icon.className = `pounce-result-icon ${item.type}`;
      
      // Special handling for synthetic options.
      if (item.type === 'search') {
        icon.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 21L16.514 16.506L21 21ZM19 10.5C19 15.194 15.194 19 10.5 19C5.806 19 2 15.194 2 10.5C2 5.806 5.806 2 10.5 2C15.194 2 19 5.806 19 10.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
        element.classList.add('search-option');
      } else if (item.type === 'open') {
        icon.textContent = item.iconFallback || '?';
        element.classList.add('open-option');
      } else if (item.favIconUrl && item.favIconUrl !== '' && !item.favIconUrl.startsWith('chrome://')) {
        // 使用实际的网页图标（跳过 chrome:// 图标，浏览器会阻止加载）
        const img = document.createElement('img');
        img.src = item.favIconUrl;
        img.alt = item.displayTitle || item.title || 'Website icon';
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
      
      // Content
      const content = document.createElement('div');
      content.className = 'pounce-result-content';
      
      const title = document.createElement('div');
      title.className = 'pounce-result-title';
      title.textContent = item.displayTitle || item.title || 'Untitled';
      
      const url = document.createElement('div');
      url.className = 'pounce-result-url';
      url.textContent = item.displayUrl || item.url || '';
      
      content.appendChild(title);
      content.appendChild(url);
      
      // Badge
      const badge = document.createElement('div');
      badge.className = `pounce-result-badge pounce-result-badge-${item.type}`;
      badge.textContent = item.sourceLabel || '';
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
      this.resultsContainer.innerHTML = `
        <div class="pounce-search-loading">
          Loading search data...
        </div>
      `;
      // 加载时显示加载状态
      if (this.resultsCounter) {
        this.resultsCounter.textContent = 'Loading...';
      }
    }
    
    showEmpty() {
      this.resultsContainer.innerHTML = `
        <div class="pounce-search-empty">
          No matching tabs, history, bookmarks, or top sites found
        </div>
      `;
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
        const text = count === 1 ? '1 result' : `${count} results`;
        this.resultsCounter.textContent = text;
      }
    }
  }
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.pounceSearchOverlay = new PounceSearchOverlay();
    });
  } else {
    window.pounceSearchOverlay = new PounceSearchOverlay();
  }
})();
