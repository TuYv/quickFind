// 弹出面板逻辑
document.addEventListener('DOMContentLoaded', async () => {
  // 模拟chrome API用于预览
  if (typeof chrome === 'undefined') {
    window.chrome = {
      storage: {
        sync: {
          get: (keys) => Promise.resolve({ urls: ['https://github.com', 'https://stackoverflow.com', 'https://developer.mozilla.org'] })
        }
      },
      runtime: {
        sendMessage: (message) => Promise.resolve({ success: true }),
        openOptionsPage: () => window.open('options.html', '_blank')
      },
      tabs: {
        query: (queryInfo) => Promise.resolve([{ id: 1, url: 'http://localhost:8000', status: 'complete' }])
      },
      scripting: {
        insertCSS: (details) => Promise.resolve(),
        executeScript: (details) => Promise.resolve()
      }
    };
  }
  // 平台检测：Mac 显示 ⌘K，其他平台显示 Alt+K
  const isMac = navigator.platform.toUpperCase().includes('MAC') ||
    navigator.userAgent.toUpperCase().includes('MAC');
  const shortcutLabel = isMac ? '⌘K' : 'Alt+K';

  document.querySelectorAll('.kbd-hint').forEach(el => {
    el.textContent = shortcutLabel;
  });
  document.querySelectorAll('.shortcut-hint kbd').forEach(el => {
    el.textContent = shortcutLabel;
  });

  const loadingEl = document.getElementById('loading');
  const hasUrlsEl = document.getElementById('hasUrls');
  const emptyStateEl = document.getElementById('emptyState');
  const urlCountEl = document.getElementById('urlCount');
  const openAllBtn = document.getElementById('openAllBtn');
  const searchBtn = document.getElementById('searchBtn');
  const searchBtnEmpty = document.getElementById('searchBtnEmpty');
  const settingsButton = document.getElementById('settingsLink');
  
  let themeManager;

  // 初始化主题管理器
  try {
    themeManager = new ThemeManager();
  } catch (error) {
    console.error('Failed to initialize theme manager:', error);
  }

  // 主题切换按钮
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const themeLabels = { system: 'Auto (System)', light: 'Light Mode', dark: 'Dark Mode' };
    const themeOrder = ['system', 'light', 'dark'];
    try {
      const tResult = await chrome.storage.sync.get(['theme']);
      const initTheme = tResult.theme || 'system';
      themeToggle.setAttribute('data-p', initTheme);
      themeToggle.title = themeLabels[initTheme] || 'Auto (System)';
    } catch (e) {
      themeToggle.setAttribute('data-p', 'system');
    }
    themeToggle.addEventListener('click', async () => {
      const cur = themeToggle.getAttribute('data-p') || 'system';
      const next = themeOrder[(themeOrder.indexOf(cur) + 1) % themeOrder.length];
      themeToggle.setAttribute('data-p', next);
      themeToggle.title = themeLabels[next];
      if (themeManager) await themeManager.setTheme(next);
    });

    // 监听设置页面的主题变更，实时同步按钮状态
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.theme) {
        const newTheme = changes.theme.newValue || 'system';
        themeToggle.setAttribute('data-p', newTheme);
        themeToggle.title = themeLabels[newTheme] || 'Auto (System)';
      }
    });
  }

  // 动态设置版本号
  try {
    const manifestData = chrome.runtime.getManifest();
    const versionElement = document.getElementById('versionText') || document.querySelector('.version');
    if (versionElement) {
      versionElement.textContent = `v${manifestData.version}`;
    }
  } catch (error) {
    console.error('Failed to set version:', error);
  }

  try {
    // 从存储中获取 URL 列表
    const result = await chrome.storage.sync.get(['urls']);
    const urls = result.urls || [];
    
    loadingEl.style.display = 'none';
    
    if (urls.length > 0) {
      // 显示 URL 数量和打开按钮
      hasUrlsEl.style.display = 'block';
      urlCountEl.textContent = `${urls.length}`;
      
      // 绑定打开所有网址按钮
      openAllBtn.addEventListener('click', async () => {
        openAllBtn.disabled = true;
        const buttonText = openAllBtn.querySelector('.batch-label') || openAllBtn.querySelector('.button-content span');
        if (buttonText) buttonText.textContent = 'Opening...';
        
        try {
          // 发送消息给后台脚本执行打开操作
          await chrome.runtime.sendMessage({ action: 'openAllUrls' });
          window.close(); // 关闭弹出窗口
        } catch (error) {
          console.error('Failed to open URLs:', error);
          openAllBtn.disabled = false;
          const buttonText = openAllBtn.querySelector('.batch-label') || openAllBtn.querySelector('.button-content span');
          if (buttonText) buttonText.textContent = 'Batch Open URLs';
        }
      });
      
      // 绑定搜索按钮
      searchBtn.addEventListener('click', async () => {
        await triggerSearchViaBackground();
      });
    } else {
      // 显示空状态
      emptyStateEl.style.display = 'block';
      
      searchBtnEmpty.addEventListener('click', async () => {
        await triggerSearchViaBackground();
      });

      const emptyHintBtn = document.getElementById('emptyHintBtn');
      if (emptyHintBtn) {
        emptyHintBtn.addEventListener('click', () => {
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            chrome.runtime.openOptionsPage();
            window.close();
          }
        });
      }
    }
  } catch (error) {
    console.error('Failed to load data:', error);
    loadingEl.textContent = 'Loading failed';
  }

  // 设置按钮点击事件
  settingsButton.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.openOptionsPage();
      window.close();
    } else {
      window.open('options.html', '_blank');
    }
  });

  // 通过background script触发搜索功能
  async function triggerSearchViaBackground() {
    try {
      // 直接调用background script的showSearchOverlay函数
      const response = await chrome.runtime.sendMessage({ action: 'showSearchOverlay' });
      if (response?.success !== true) {
        throw new Error(response?.error || 'Background launch did not complete');
      }
      window.close();
    } catch (error) {
      console.error('Failed to trigger search via background:', error);
      // 如果background方式失败，回退到直接注入方式
      await triggerSearch();
    }
  }

  // 触发搜索功能（备用方法）
  async function triggerSearch() {
    try {
      // 获取当前活动标签页
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!activeTab) {
        alert('Unable to get current tab');
        return;
      }

      // 检查是否是受限制的页面
      if (activeTab.url.startsWith('chrome://') ||
          activeTab.url.startsWith('chrome-extension://') ||
          activeTab.url.startsWith('edge://') ||
          activeTab.url.startsWith('about:') ||
          activeTab.url.startsWith('https://chromewebstore.google.com') ||
          activeTab.url.startsWith('https://chrome.google.com/webstore')) {
        alert('Search function cannot be used on this page. Please switch to a regular webpage (like google.com) and try again.');
        return;
      }

      // 检查页面是否已加载完成
      if (activeTab.status !== 'complete') {
        alert('Page is still loading. Please wait for it to finish loading and try again.');
        return;
      }
      
      // 先注入CSS样式
       await chrome.scripting.insertCSS({
         target: { tabId: activeTab.id },
         files: ['search-overlay.css']
       });

       await chrome.scripting.executeScript({
         target: { tabId: activeTab.id },
         files: ['theme-manager.js']
       });

       await chrome.scripting.executeScript({
         target: { tabId: activeTab.id },
         files: ['preferences.js']
       });

       await chrome.scripting.executeScript({
         target: { tabId: activeTab.id },
         files: ['search-ranking.js']
       });

       // 再注入JS脚本
       await chrome.scripting.executeScript({
         target: { tabId: activeTab.id },
         files: ['search-overlay.js']
       });

       // 最后执行显示搜索覆盖层的代码
       await chrome.scripting.executeScript({
         target: { tabId: activeTab.id },
         func: () => {
           // 检查搜索覆盖层是否已存在
           if (window.pounceSearchOverlay) {
             window.pounceSearchOverlay.show();
           } else {
             // 如果还没有初始化，等待一下再试
             setTimeout(() => {
               if (window.pounceSearchOverlay) {
                 window.pounceSearchOverlay.show();
               } else {
                 alert('Search function initialization failed, please try again');
               }
             }, 100);
           }
         }
       });
      
      // 关闭弹出窗口
      window.close();
    } catch (error) {
      console.error('Failed to trigger search:', error);
      
      // 提供更友好的错误信息
      let errorMessage = 'Failed to start search function';
      if (error.message.includes('Cannot access a chrome:// URL')) {
        errorMessage = 'Search function cannot be used on Chrome internal pages. Please switch to a regular webpage and try again';
      } else if (error.message.includes('The extensions gallery cannot be scripted')) {
        errorMessage = 'Search function cannot be used on Chrome Web Store pages. Please switch to another webpage and try again';
      } else {
        errorMessage += ': ' + error.message;
      }
      
      alert(errorMessage);
    }
  }
});
