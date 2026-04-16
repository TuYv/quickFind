// 配置页面逻辑
document.addEventListener('DOMContentLoaded', () => {
  // 模拟chrome.storage API用于预览
  if (typeof chrome === 'undefined' || !chrome.storage) {
    window.chrome = {
      storage: {
        sync: {
          get: (keys) => Promise.resolve({ urls: ['https://github.com', 'https://stackoverflow.com', 'https://developer.mozilla.org'] }),
          set: (data) => Promise.resolve()
        }
      },
      runtime: {
        sendMessage: (message) => Promise.resolve({ success: true })
      }
    };
  }
  // 读取实际配置的快捷键并渲染
  loadShortcuts();

  async function loadShortcuts() {
    const searchKeyEl = document.getElementById('shortcut-search');
    const batchKeyEl = document.getElementById('shortcut-batch');

    try {
      const commands = await chrome.commands.getAll();
      const map = {};
      commands.forEach(cmd => { map[cmd.name] = cmd.shortcut; });

      if (searchKeyEl) renderShortcut(searchKeyEl, map['search-tabs-bookmarks']);
      if (batchKeyEl)  renderShortcut(batchKeyEl,  map['open-all-urls']);
    } catch (e) {
      // 降级：平台推断
      const isMac = navigator.platform.toUpperCase().includes('MAC') ||
        navigator.userAgent.toUpperCase().includes('MAC');
      if (searchKeyEl) renderShortcut(searchKeyEl, isMac ? 'Command+K' : 'Alt+K');
      if (batchKeyEl)  renderShortcut(batchKeyEl,  isMac ? 'Command+Shift+U' : 'Ctrl+Shift+U');
    }
  }

  // 将 "Command+Shift+K" 这类字符串拆成多个 <kbd> 片段
  function renderShortcut(container, shortcut) {
    if (!shortcut) {
      container.innerHTML = '<span style="color:var(--muted);font-size:11px;">Not set</span>';
      return;
    }
    const KEY_MAP = {
      'Command': '⌘', 'Ctrl': '⌃', 'Alt': '⌥', 'Shift': '⇧',
      'MacCtrl': '⌃', 'Up': '↑', 'Down': '↓', 'Left': '←', 'Right': '→',
      'Space': 'Space', 'Escape': 'Esc', 'Return': '↵'
    };
    const parts = shortcut.split('+').map(k => KEY_MAP[k] || k);
    // 单键直接替换容器内容（保持父级 <kbd> 不变）
    if (container.tagName === 'KBD') {
      container.textContent = parts.join('');
      return;
    }
    // 多键：渲染为一排 <kbd> 标签
    container.innerHTML = parts.map(k => `<kbd>${k}</kbd>`).join('');
  }

  const urlInput = document.getElementById('urlInput');
  const addBtn = document.getElementById('addBtn');
  const urlList = document.getElementById('urlList');
  const urlCount = document.getElementById('urlCount');
  const emptyState = document.getElementById('emptyState');
  const inputError = document.getElementById('inputError');
  const inputSuccess = document.getElementById('inputSuccess');
  const openAllBtn = document.getElementById('openAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const themeSelect = document.getElementById('themeSelect');

  let urls = [];
  let themeManager;

  // "Manage →" 按钮：引导用户到快捷键设置页
  const manageShortcutsBtn = document.getElementById('manageShortcutsBtn');
  if (manageShortcutsBtn) {
    manageShortcutsBtn.addEventListener('click', () => {
      // chrome://extensions/shortcuts 无法通过 tabs.create 打开
      // 导航当前标签页是唯一可行方式
      chrome.tabs.getCurrent(tab => {
        if (tab) chrome.tabs.update(tab.id, { url: 'chrome://extensions/shortcuts' });
      });
    });
  }

  // 初始化加载数据
  loadUrls();
  
  // 初始化主题管理器
  initThemeManager();

  // 动态设置版本号
  try {
    const manifestData = chrome.runtime.getManifest();
    const versionElement = document.querySelector('.footer-card div:first-child div:last-child');
    if (versionElement) {
      versionElement.textContent = `Version ${manifestData.version}`;
    }
  } catch (error) {
    console.error('Failed to set version:', error);
  }

  // 添加按钮事件
  addBtn.addEventListener('click', addUrl);
  
  // 回车键添加
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addUrl();
    }
  });

  // 打开所有URL按钮事件
  openAllBtn.addEventListener('click', async () => {
    if (urls.length === 0) {
      showError('No URLs to open');
      return;
    }
    
    openAllBtn.disabled = true;
    const buttonText = openAllBtn.querySelector('span:not(.button-icon)');
    const originalText = buttonText ? buttonText.textContent : 'Open All';
    if (buttonText) buttonText.textContent = 'Opening...';
    
    try {
      await chrome.runtime.sendMessage({ action: 'openAllUrls' });
      showSuccess('All URLs opened successfully');
    } catch (error) {
      showError('Failed to open: ' + error.message);
    } finally {
      openAllBtn.disabled = false;
      if (buttonText) buttonText.textContent = originalText;
    }
  });

  // 清空所有按钮事件
  clearAllBtn.addEventListener('click', () => {
    if (urls.length === 0) {
      showError('No URLs to clear');
      return;
    }
    
    if (confirm('Are you sure you want to clear all URLs? This action cannot be undone.')) {
      urls = [];
      saveUrls();
      renderUrlList();
      showSuccess('All URLs cleared');
    }
  });

  // 从存储加载 URL 列表
  async function loadUrls() {
    try {
      const result = await chrome.storage.sync.get(['urls']);
      urls = result.urls || [];
      renderUrlList();
    } catch (error) {
      console.error('Failed to load data:', error);
      showError('Failed to load data');
    }
  }

  // 保存 URL 列表到存储
  async function saveUrls() {
    try {
      await chrome.storage.sync.set({ urls: urls });
    } catch (error) {
      console.error('Failed to save data:', error);
      showError('Failed to save data');
    }
  }

  // 验证和规范化 URL
  function validateAndNormalizeUrl(input) {
    if (!input || !input.trim()) {
      throw new Error('Please enter a URL');
    }

    let url = input.trim();
    
    // 自动补全协议前缀
    if (!url.match(/^https?:\/\//i)) {
      url = 'https://' + url;
    }

    // 验证 URL 格式
    try {
      const urlObj = new URL(url);
      
      // 检查协议
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are supported');
      }
      
      // 检查主机名
      if (!urlObj.hostname) {
        throw new Error('Invalid URL format');
      }
      
      return urlObj.href;
    } catch (e) {
      if (e.message.includes('Invalid URL')) {
        throw new Error('Invalid URL format');
      }
      throw e;
    }
  }

  // 添加 URL
  async function addUrl() {
    hideMessages();
    
    try {
      const normalizedUrl = validateAndNormalizeUrl(urlInput.value);
      
      // 检查是否已存在
      if (urls.includes(normalizedUrl)) {
        throw new Error('This URL already exists');
      }
      
      // 添加到列表
      urls.push(normalizedUrl);
      await saveUrls();
      
      // 更新界面
      renderUrlList();
      urlInput.value = '';
      showSuccess('URL added successfully');
      
    } catch (error) {
      showError(error.message);
    }
  }

  // 删除 URL
  async function removeUrl(index) {
    if (index >= 0 && index < urls.length) {
      urls.splice(index, 1);
      await saveUrls();
      renderUrlList();
      showSuccess('URL removed successfully');
    }
  }

  // 渲染 URL 列表
  function renderUrlList() {
    urlCount.textContent = urls.length;
    
    if (urls.length === 0) {
      urlList.innerHTML = '<div class="empty-state" id="emptyState">No URLs configured for batch opening<br>Click Add above to add URLs</div>';
      return;
    }

    const openIcon = `<svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10.9297 2H14.9297V6" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M7.59631 9.33333L14.9296 2" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M12.9297 8.66667V12.6667C12.9297 13.0203 12.7892 13.3594 12.5392 13.6095C12.2891 13.8595 11.95 14 11.5964 14H4.26302C3.9094 14 3.57026 13.8595 3.32021 13.6095C3.07016 13.3594 2.92969 13.0203 2.92969 12.6667V5.33333C2.92969 4.97971 3.07016 4.64057 3.32021 4.39052C3.57026 4.14048 3.9094 4 4.26302 4H8.26302" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    const deleteIcon = `<svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.50256 7.33333V11.3333" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M10.1693 7.33333V11.3333" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.5026 4V13.3333C13.5026 13.687 13.3622 14.0261 13.1121 14.2761C12.8621 14.5262 12.5229 14.6667 12.1693 14.6667H5.50264C5.14902 14.6667 4.80988 14.5262 4.55984 14.2761C4.30979 14.0261 4.16931 13.687 4.16931 13.3333V4" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2.83594 4H14.8359" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M6.16931 3.99999V2.66666C6.16931 2.31304 6.30979 1.9739 6.55984 1.72385C6.80988 1.4738 7.14902 1.33333 7.50264 1.33333H10.1693C10.5229 1.33333 10.8621 1.4738 11.1121 1.72385C11.3622 1.9739 11.5026 2.31304 11.5026 2.66666V3.99999" stroke="currentColor" stroke-width="1.33333" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    const listHtml = urls.map((url, index) => `
      <div class="url-item">
        <span class="url-index">${index + 1}</span>
        <span class="url-text">${escapeHtml(url)}</span>
        <button class="open-btn" data-url="${escapeHtml(url)}" title="Open URL">${openIcon}</button>
        <button class="delete-btn" data-index="${index}" title="Remove URL">${deleteIcon}</button>
      </div>
    `).join('');

    urlList.innerHTML = listHtml;

    // 为打开按钮添加事件监听器
    const openButtons = urlList.querySelectorAll('.open-btn');
    openButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const url = e.currentTarget.dataset.url;
        chrome.tabs.create({ url, active: true });
      });
    });

    // 为删除按钮添加事件监听器
    const deleteButtons = urlList.querySelectorAll('.delete-btn');
    deleteButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.dataset.index);
        removeUrl(index);
      });
    });
  }

  // 移除全局函数，现在使用事件监听器
  // window.removeUrlAt = removeUrl;

  // 显示错误消息
  function showError(message) {
    hideMessages();
    inputError.textContent = message;
    inputError.style.display = 'block';
    setTimeout(hideMessages, 5000);
  }

  // 显示成功消息
  function showSuccess(message) {
    hideMessages();
    inputSuccess.textContent = message;
    inputSuccess.style.display = 'block';
    setTimeout(hideMessages, 3000);
  }

  // 隐藏消息
  function hideMessages() {
    inputError.style.display = 'none';
    inputSuccess.style.display = 'none';
  }

  // HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 初始化主题管理器
  async function initThemeManager() {
    try {
      themeManager = new ThemeManager();

      // 直接从 storage 读取已保存主题，避免 ThemeManager async init 未完成时 getCurrentTheme() 返回默认值
      const { theme: savedTheme } = await chrome.storage.sync.get(['theme']);
      themeSelect.value = savedTheme || 'system';

      // 监听主题选择变化
      themeSelect.addEventListener('change', async (e) => {
        await themeManager.setTheme(e.target.value);
        showSuccess('Theme updated successfully');
      });

      // 监听来自其他页面的主题变更（storage onChanged 比消息传递更可靠）
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.theme) {
          themeSelect.value = changes.theme.newValue || 'system';
        }
      });
      
    } catch (error) {
      console.error('Failed to initialize theme manager:', error);
    }
  }
});