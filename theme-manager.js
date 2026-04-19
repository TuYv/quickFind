// Pounce Theme Manager
// 管理应用的主题设置：跟随系统/白天模式/夜间模式

class ThemeManager {
  constructor() {
    this.themes = {
      'system': 'Follow System',
      'light': 'Light Mode', 
      'dark': 'Dark Mode'
    };
    this.currentTheme = 'system';
    this.systemPreference = null;
    this.init();
  }

  async init() {
    // 加载保存的主题设置
    try {
      const result = await chrome.storage.sync.get(['theme']);
      this.currentTheme = result.theme || 'system';
    } catch (error) {
      console.error('Failed to load theme setting:', error);
    }

    // 监听系统主题变化
    if (window.matchMedia) {
      this.systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemPreference.addListener(() => {
        if (this.currentTheme === 'system') {
          this.applyTheme();
        }
      });
    }

    // 应用当前主题
    this.applyTheme();
  }

  async setTheme(theme) {
    if (!this.themes[theme]) {
      console.error('Invalid theme:', theme);
      return;
    }

    this.currentTheme = theme;
    
    // 保存到存储
    try {
      await chrome.storage.sync.set({ theme: theme });
    } catch (error) {
      console.error('Failed to save theme setting:', error);
    }

    // 应用主题
    this.applyTheme();

    // 通知其他页面主题已更改
    this.broadcastThemeChange(theme);
  }

  applyTheme() {
    const root = document.documentElement;
    
    // 清除所有主题相关的类名和属性
    root.classList.remove('theme-light', 'theme-dark', 'theme-system');
    root.removeAttribute('data-theme');
    
    // 确定实际应用的主题
    let effectiveTheme;
    if (this.currentTheme === 'system') {
      effectiveTheme = (this.systemPreference && this.systemPreference.matches) ? 'dark' : 'light';
    } else {
      effectiveTheme = this.currentTheme;
    }
    
    // 应用主题属性 - 与CSS中的选择器匹配
    root.setAttribute('data-theme', effectiveTheme);
    
    console.log(`Pounce: Applied theme: ${this.currentTheme} -> ${effectiveTheme}`);
  }

  getEffectiveTheme() {
    if (this.currentTheme === 'system') {
      // 跟随系统设置
      if (this.systemPreference && this.systemPreference.matches) {
        return 'dark';
      } else {
        return 'light';
      }
    }
    return this.currentTheme;
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  getThemes() {
    return this.themes;
  }

  // 广播主题变更给其他页面
  broadcastThemeChange(theme) {
    // 发送消息给background script，让它通知其他页面
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({
        action: 'themeChanged',
        theme: theme
      }).catch(() => {
        // 忽略错误，可能是某些页面没有监听器
      });
    }
  }

  // 监听来自其他页面的主题变更
  onThemeChanged(callback) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'themeChanged') {
          this.currentTheme = message.theme;
          this.applyTheme();
          if (callback) callback(message.theme);
        }
      });
    }
  }
}

// Content Script 版本（用于搜索覆盖层）
// 主题 class 挂在传入的 targetElement 上（通常是 overlay 容器），
// 不碰 document.documentElement，避免被宿主页（如 juejin.cn）的主题脚本/SPA 抹掉。
class ContentThemeManager {
  constructor(targetElement) {
    if (!targetElement) {
      throw new Error('ContentThemeManager requires a targetElement');
    }
    this.targetElement = targetElement;
    this.currentTheme = 'system';
    this.systemPreference = null;
    this.init();
  }

  async init() {
    // 先同步准备 matchMedia 并立即应用一次，避免异步获取期间的 FOUC
    if (window.matchMedia) {
      this.systemPreference = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemPreference.addListener(() => {
        if (this.currentTheme === 'system') {
          this.applyTheme();
        }
      });
    }
    this.applyTheme();

    // 再异步从 background 拉取用户设置的主题
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getTheme'
      });
      if (response && response.theme && response.theme !== this.currentTheme) {
        this.currentTheme = response.theme;
        this.applyTheme();
      }
    } catch (error) {
      console.error('Failed to get current theme:', error);
    }

    // 监听主题变更消息
    if (chrome && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'themeChanged') {
          this.currentTheme = message.theme;
          this.applyTheme();
        }
      });
    }
  }

  applyTheme() {
    const root = this.targetElement;

    // 只清理我们自己的 class，不触碰 data-theme 等宿主页属性
    root.classList.remove('pn-theme-light', 'pn-theme-dark');

    let effectiveTheme;
    if (this.currentTheme === 'system') {
      effectiveTheme = (this.systemPreference && this.systemPreference.matches) ? 'dark' : 'light';
    } else {
      effectiveTheme = this.currentTheme;
    }

    root.classList.add(`pn-theme-${effectiveTheme}`);

    console.log(`Pounce: Applied theme: ${this.currentTheme} -> ${effectiveTheme}`);
  }

  getEffectiveTheme() {
    if (this.currentTheme === 'system') {
      if (this.systemPreference && this.systemPreference.matches) {
        return 'dark';
      } else {
        return 'light';
      }
    }
    return this.currentTheme;
  }
}

// 根据环境选择合适的管理器
if (typeof window !== 'undefined' && window.chrome && window.chrome.extension) {
  // Extension context (popup, options)
  window.ThemeManager = ThemeManager;
} else if (typeof window !== 'undefined') {
  // Content script context
  window.ContentThemeManager = ContentThemeManager;
}