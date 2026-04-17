// Pounce Search Overlay - Content Script
(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.pounceSearchOverlay) {
    return;
  }
  
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
      this.bridgeTabId = null;
      
      this.init();
    }
    
    init() {
      this.createOverlay();
      this.bindEvents();
      this.initTheme();
    }
    
    initTheme() {
      // 初始化内容脚本主题管理器
      try {
        this.themeManager = new ContentThemeManager();
      } catch (error) {
        console.error('Failed to initialize theme manager:', error);
      }
    }
    
    createOverlay() {
      // Create overlay container
      this.overlay = document.createElement('div');
      this.overlay.className = 'pounce-search-overlay';
      
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
      
      // Add to document
      document.body.appendChild(this.overlay);
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
      
      // Overlay click to close
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.hide();
        }
      });
      
      // Global escape key — capture:true 确保在浏览器退出全屏之前拦截
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isVisible) {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
        }
      }, { capture: true });

      document.getElementById('pounce-close-icon').addEventListener('click', (e) => {
        this.hide();
        e.preventDefault();
        e.stopPropagation();
      });
      
      // Prevent overlay from being affected by page scripts
      this.overlay.addEventListener('click', (e) => {
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

      // 如果是跳板页且用户未选择结果，直接关闭该标签页
      if (this.bridgeTabId) {
        const tabId = this.bridgeTabId;
        this.bridgeTabId = null;
        chrome.runtime.sendMessage({ action: 'closeBridgeTab', tabId }).catch(() => {});
        return;
      }

      this.isVisible = false;
      this.overlay.style.display = 'none';
      this.searchInput.blur();
      this.currentResults = [];
      this.selectedIndex = -1;
      
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

      if (window.PounceSearchUtils && typeof window.PounceSearchUtils.rankResults === 'function') {
        this.currentResults = window.PounceSearchUtils.rankResults(this.allData, query, 10);
      } else {
        this.currentResults = this.getFallbackResults(query);
      }
      
      this.selectedIndex = -1;
      this.renderResults();
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
          e.preventDefault();
          this.hide();
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
