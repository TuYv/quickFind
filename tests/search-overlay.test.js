const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const preferences = require('../preferences.js');

class FakeTextNode {
  constructor(text) {
    this.textContent = text;
    this.parentNode = null;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.eventListeners = {};
    this.className = '';
    this.id = '';
    this.value = '';
    this.textContent = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot();
    return this.shadowRoot;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) {
      this.eventListeners[type] = [];
    }
    this.eventListeners[type].push(handler);
  }

  focus() {
    this.focused = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  querySelectorAll(selector) {
    const results = [];
    const matches = (element) => {
      if (!(element instanceof FakeElement)) return false;
      if (selector.startsWith('.')) {
        return element.className.split(/\s+/).includes(selector.slice(1));
      }
      return element.tagName.toLowerCase() === selector.toLowerCase();
    };
    const visit = (element) => {
      if (!(element instanceof FakeElement)) return;
      if (matches(element)) results.push(element);
      element.children.forEach(visit);
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      if (child instanceof FakeElement) {
        const found = child.getElementById(id);
        if (found) return found;
      }
    }
    return null;
  }
}

class FakeShadowRoot extends FakeElement {
  constructor() {
    super('#shadow-root');
    this.activeElement = null;
  }
}

function createOverlayHarness() {
  const document = {
    readyState: 'complete',
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    eventListeners: {},
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => new FakeTextNode(text),
    addEventListener(type, handler) {
      if (!this.eventListeners[type]) {
        this.eventListeners[type] = [];
      }
      this.eventListeners[type].push(handler);
    },
    removeEventListener() {}
  };
  document.body.style = {};

  const context = {
    console,
    clearTimeout,
    setTimeout,
    requestAnimationFrame: (handler) => handler(),
    performance: { now: () => 1000 },
    navigator: { platform: 'MacIntel', userAgent: 'Macintosh' },
    document,
    PouncePreferences: preferences,
    ContentThemeManager: class ContentThemeManager {},
    chrome: {
      runtime: {
        getManifest: () => ({ version: 'test' }),
        getURL: (file) => `chrome-extension://pounce/${file}`,
        onMessage: {
          addListener() {},
          removeListener() {}
        },
        sendMessage: () => Promise.resolve({ success: true })
      },
      storage: {
        sync: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve()
        },
        onChanged: {
          addListener() {},
          removeListener() {}
        }
      }
    }
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'search-overlay.js'), 'utf8'),
    context,
    { filename: 'search-overlay.js' }
  );

  return context.window.pounceSearchOverlay;
}

test('overlay fallback results honor the configured results limit', () => {
  const overlay = createOverlayHarness();
  overlay.searchPreferences = preferences.normalizeSearchPreferences({ resultsLimit: 20 });
  overlay.allData = Array.from({ length: 25 }, (_, index) => ({
    type: 'history',
    id: `history:${index}`,
    title: `Result ${index}`,
    url: `https://example.com/${index}`,
    typedCount: 1,
    visitCount: 1,
    lastVisitTime: index
  }));

  const results = overlay.getFallbackResults('');

  assert.equal(results.length, 20);
});

test('Esc closes the overlay when the results limit select has focus', () => {
  const overlay = createOverlayHarness();
  let hideCalls = 0;
  overlay.isVisible = true;
  overlay.hide = () => {
    hideCalls += 1;
  };

  overlay.docKeyUpHandler({
    key: 'Escape',
    target: overlay.resultsLimitSelect,
    composedPath: () => [overlay.resultsLimitSelect],
    preventDefault() {},
    stopPropagation() {}
  });

  assert.equal(hideCalls, 1);
});

test('changing the results limit returns focus to the search input', () => {
  const overlay = createOverlayHarness();
  overlay.isVisible = true;
  overlay.resultsLimitSelect.value = '20';
  overlay.updateResultsLimitPreference = () => {};

  overlay.handleResultsLimitSelectChange();

  assert.equal(overlay.searchInput.focused, true);
});
