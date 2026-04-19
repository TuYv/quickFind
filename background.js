// 后台脚本 - Service Worker
// 处理快捷键命令
chrome.commands.onCommand.addListener((command) => {
  console.log('Pounce: Command received:', command);
  
  if (command === 'open-all-urls') {
    openAllUrls().catch(error => {
      console.error('Error executing open-all-urls command:', error);
    });
  } else if (command === 'search-tabs-bookmarks') {
    showSearchOverlay().catch(error => {
      console.error('Error executing search-tabs-bookmarks command:', error);
    });
  }
});

// 处理来自弹出窗口和配置页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTheme') {
    // 获取当前主题设置
    chrome.storage.sync.get(['theme'])
      .then((result) => {
        sendResponse({ theme: result.theme || 'system' });
      })
      .catch((error) => {
        console.error('Failed to get theme:', error);
        sendResponse({ theme: 'system' });
      });
    return true;
  } else if (request.action === 'themeChanged') {
    // 广播主题变更给所有标签页
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'themeChanged',
          theme: request.theme
        }).catch(() => {
          // 忽略错误，某些标签页可能没有content script
        });
      });
    });
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'openAllUrls') {
    openAllUrls()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to open URLs:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'getSearchData') {
    getSearchData()
      .then((searchData) => {
        sendResponse({ success: true, data: searchData });
      })
      .catch((error) => {
        console.error('Failed to get search data:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'switchToTab') {
    const doSwitch = () => chrome.tabs.update(request.tabId, { active: true })
      .then(() => chrome.tabs.get(request.tabId))
      .then((tab) => chrome.windows.update(tab.windowId, { focused: true }));
    const maybeCloseBridge = request.bridgeTabId
      ? chrome.tabs.remove(request.bridgeTabId).catch(() => {})
      : Promise.resolve();
    maybeCloseBridge.then(() => doSwitch())
      .catch((error) => {
        // Tab may have been closed since search data was fetched; fall back to opening URL
        if (request.url && error.message && error.message.includes('No tab with id')) {
          return chrome.tabs.create({ url: request.url, active: true });
        }
        throw error;
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to switch to tab:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'openBookmark') {
    const openAction = request.bridgeTabId
      ? chrome.tabs.update(request.bridgeTabId, { url: request.url, active: true })
      : chrome.tabs.create({ url: request.url, active: true });
    openAction.then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to open bookmark:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'closeBridgeTab') {
    chrome.tabs.remove(request.tabId).catch(() => {});
    sendResponse({ success: true });
    return true;
  } else if (request.action === 'showSearchOverlay') {
    showSearchOverlay()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to show search overlay:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  } else if (request.action === 'performWebSearch') {
    performWebSearch(request.query, request.bridgeTabId)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to perform web search:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  }
});

// 核心功能：打开所有配置的网址
async function openAllUrls() {
  try {
    // 从存储中获取 URL 列表
    const result = await chrome.storage.sync.get(['urls']);
    const urls = result.urls || [];
    
    if (urls.length === 0) {
      // 如果没有配置网址，显示通知
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Pounce',
        message: 'Please add URLs first before using this feature'
      });
      return;
    }
    
    // 批量打开网址
    const promises = urls.map(url => {
      return chrome.tabs.create({ url: url, active: false });
    });
    
    await Promise.all(promises);
    
    // 显示成功通知
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Pounce',
      message: `Successfully opened ${urls.length} URLs`
    });
    
  } catch (error) {
    console.error('Error occurred while opening URLs:', error);
    
    // 显示错误通知
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Pounce -Error',
      message: 'Error occurred while opening URLs, please check URL configuration'
    });
    
    throw error;
  }
}



function createFaviconUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    // 仅为 http(s) 站点拼 favicon；file://、chrome://、chrome-extension:// 等
    // 协议拼出的 URL 会被浏览器拒绝加载（"Not allowed to load local resource"）。
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname) return '';
    return `${parsed.protocol}//${parsed.hostname}/favicon.ico`;
  } catch (error) {
    return '';
  }
}

const HISTORY_CACHE_TTL_MS = 60 * 1000;
let historyDataCache = {
  fetchedAt: 0,
  value: []
};
let historyDataPromise = null;

async function getTabsData() {
  const tabs = await chrome.tabs.query({});

  return tabs
    .filter((tab) => tab.url)
    .map((tab) => ({
      type: 'tab',
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || createFaviconUrl(tab.url),
      lastAccessed: tab.lastAccessed || Date.now()
    }));
}

async function getBookmarksData() {
  const bookmarkTree = await chrome.bookmarks.getTree();
  const bookmarksData = [];

  function extractBookmarks(nodes) {
    for (const node of nodes) {
      if (node.url) {
        bookmarksData.push({
          type: 'bookmark',
          id: node.id,
          title: node.title || '',
          url: node.url,
          favIconUrl: createFaviconUrl(node.url),
          dateAdded: node.dateAdded || 0
        });
      }

      if (node.children) {
        extractBookmarks(node.children);
      }
    }
  }

  extractBookmarks(bookmarkTree);
  return bookmarksData;
}

async function fetchHistoryData() {
  try {
    const historyItems = await chrome.history.search({
      text: '',
      startTime: 0,
      maxResults: 500
    });

    return historyItems
      .filter((item) => item.url)
      .map((item) => ({
        type: 'history',
        id: item.id || `history:${item.url}`,
        title: item.title || '',
        url: item.url,
        favIconUrl: createFaviconUrl(item.url),
        lastVisitTime: item.lastVisitTime || 0,
        visitCount: item.visitCount || 0,
        typedCount: item.typedCount || 0
      }));
  } catch (error) {
    console.warn('Pounce: Unable to read history data', error);
    return [];
  }
}

async function getHistoryData() {
  const now = Date.now();

  if (now - historyDataCache.fetchedAt < HISTORY_CACHE_TTL_MS) {
    return historyDataCache.value;
  }

  if (historyDataPromise) {
    return historyDataPromise;
  }

  historyDataPromise = fetchHistoryData()
    .then((historyData) => {
      historyDataCache = {
        fetchedAt: Date.now(),
        value: historyData
      };

      return historyData;
    })
    .finally(() => {
      historyDataPromise = null;
    });

  return historyDataPromise;
}

async function getTopSitesData() {
  try {
    const topSites = await chrome.topSites.get();

    return topSites
      .filter((site) => site.url)
      .map((site) => ({
        type: 'topSite',
        id: `top-site:${site.url}`,
        title: site.title || '',
        url: site.url,
        favIconUrl: createFaviconUrl(site.url)
      }));
  } catch (error) {
    console.warn('Pounce: Unable to read top sites', error);
    return [];
  }
}

// 获取搜索数据（标签页、书签、历史和常用网站）
async function getSearchData() {
  try {
    console.log('Pounce: Starting to get search data...');

    const [tabsData, bookmarksData, historyData, topSitesData] = await Promise.all([
      getTabsData(),
      getBookmarksData(),
      getHistoryData(),
      getTopSitesData()
    ]);

    const allData = [...tabsData, ...bookmarksData, ...historyData, ...topSitesData];

    console.log('Pounce: Search data ready', {
      tabs: tabsData.length,
      bookmarks: bookmarksData.length,
      history: historyData.length,
      topSites: topSitesData.length,
      total: allData.length
    });

    return allData;
  } catch (error) {
    console.error('Pounce: Error getting search data:', error);
    throw error;
  }
}

// 无法注入 content script 的受保护 URL 前缀
const PROTECTED_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'about:', 'edge://',
  'https://chromewebstore.google.com',
  'https://chrome.google.com/webstore'
];

function isProtectedUrl(url) {
  if (!url) return true;
  return PROTECTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

// 显示搜索覆盖层
async function showSearchOverlay() {
  async function requestOverlayShow(tabId) {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'showSearchOverlay'
    });

    if (response?.success !== true) {
      throw new Error(response?.error || 'Overlay launch was not acknowledged');
    }
  }

  // 获取当前活动标签页
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error('No active tab found');
  }

  // chrome:// 等受保护页面无法注入 content script，新开 google.com 作为跳板页
  if (isProtectedUrl(activeTab.url)) {
    console.debug('Pounce: Protected URL, opening bridge tab:', activeTab.url);
    const bridgeTab = await chrome.tabs.create({ url: chrome.runtime.getURL('bridge.html'), active: true });
    if (bridgeTab.status !== 'complete') {
      await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
          if (tabId === bridgeTab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        });
      });
    }
    // bridge.html 已内嵌所有脚本，直接发消息即可，无需 executeScript
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await chrome.tabs.sendMessage(bridgeTab.id, {
      action: 'showSearchOverlay',
      bridgeTabId: bridgeTab.id
    });
    if (response?.success !== true) {
      throw new Error(response?.error || 'Bridge overlay launch failed');
    }
    return;
  }

  try {
    await requestOverlayShow(activeTab.id);
    return;
  } catch (error) {
    console.debug('Pounce: Content script not ready, will inject:', error.message);
  }

  await injectAndShow(activeTab.id, null);
}

// 注入 content script 并显示搜索覆盖层
async function injectAndShow(tabId, bridgeTabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['theme-manager.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['search-ranking.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['search-overlay.js'] });
    // CSS 不再注入宿主页：overlay 已迁至 Shadow DOM，search-overlay.js 内部自己 link 样式表
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'showSearchOverlay',
      bridgeTabId: bridgeTabId ?? null
    });
    if (response?.success !== true) {
      throw new Error(response?.error || 'Overlay launch was not acknowledged');
    }
  } catch (injectionError) {
    console.error('Failed to inject content script:', injectionError);
    throw injectionError;
  }
}

// 执行网页搜索
async function performWebSearch(query, bridgeTabId) {
  try {
    if (!query || !query.trim()) {
      throw new Error('Search query is empty');
    }

    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;

    if (bridgeTabId) {
      await chrome.tabs.update(bridgeTabId, { url: searchUrl, active: true });
    } else {
      await chrome.tabs.create({ url: searchUrl, active: true });
    }
    
    console.log('Pounce: Performed web search for:', query);
    
  } catch (error) {
    console.error('Error performing web search:', error);
    
    // 显示错误通知
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Pounce -Search Error',
      message: 'Failed to perform web search'
    });
    
    throw error;
  }
}

// 插件安装时的初始化
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const platformInfo = await chrome.runtime.getPlatformInfo();
    const isMac = platformInfo.os === 'mac';
    const searchShortcut = isMac ? '⌘K' : 'Alt+K';
    const batchShortcut = isMac ? '⌘⇧U' : 'Ctrl+Shift+U';
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Pounce Installed Successfully',
      message: `Press ${searchShortcut} to search tabs & bookmarks. Use ${batchShortcut} to batch open URLs.`
    });
    
    // 打开配置页面
    chrome.runtime.openOptionsPage();
  }
});
