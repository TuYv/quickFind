const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.key = options.key;
    this.relatedTarget = options.relatedTarget || null;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.defaultPrevented = false;
    this._stopped = false;
  }

  stopPropagation() {
    this._stopped = true;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
    if (shouldAdd) this.add(value);
    else this.remove(value);
  }
}

class FakeNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.childNodes = child.parentNode.childNodes.filter((node) => node !== child);
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  addEventListener(type, handler, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ handler, capture: Boolean(options && options.capture) });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.handler !== handler));
  }

  dispatchEvent(event) {
    event.target = this;
    event.eventPhase = 1;
    if (!this._invoke(event, true)) return false;
    event.eventPhase = 3;
    return this._invoke(event, false);
  }

  _invoke(event, capture) {
    const entries = this.listeners.get(event.type) || [];
    for (const entry of entries) {
      if (entry.capture !== capture) continue;
      event.currentTarget = this;
      entry.handler(event);
      if (event._stopped) return false;
    }
    return true;
  }
}

class FakeTextNode extends FakeNode {
  constructor(ownerDocument, textContent) {
    super(ownerDocument);
    this.textContent = textContent;
  }

  contains(target) {
    return target === this;
  }
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, tagName) {
    super(ownerDocument);
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.id = '';
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.classList = new FakeClassList();
    this.value = '';
    this.shadowRoot = null;
  }

  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this.ownerDocument, this);
    return this.shadowRoot;
  }

  focus() {
    this.ownerDocument._focusElement(this);
  }

  blur() {
    const root = this.getRootNode();
    if (root instanceof FakeShadowRoot && root.activeElement === this) root.activeElement = null;
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }

  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  contains(target) {
    if (target === this) return true;
    return this.childNodes.some((child) => child.contains && child.contains(target));
  }

  closest(selector) {
    let node = this;
    while (node && node instanceof FakeElement) {
      if (selector.split(',').some((part) => node._matches(part.trim()))) return node;
      node = node.parentNode;
    }
    return null;
  }

  _matches(selector) {
    if (selector === 'dialog') return this.tagName === 'DIALOG';
    if (selector === '[role="dialog"]') return this.getAttribute('role') === 'dialog';
    if (selector === '[aria-modal="true"]') return this.getAttribute('aria-modal') === 'true';
    return false;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this[name] = value;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  getBoundingClientRect() {
    return { top: 0, bottom: 0 };
  }
}

class FakeShadowRoot extends FakeNode {
  constructor(ownerDocument, host) {
    super(ownerDocument);
    this.host = host;
    this.activeElement = null;
  }

  getElementById(id) {
    const stack = [...this.childNodes];
    while (stack.length) {
      const node = stack.shift();
      if (node.id === id) return node;
      stack.push(...node.childNodes);
    }
    return null;
  }

  elementFromPoint() {
    return null;
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.defaultView = null;
    this.readyState = 'complete';
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.activeElement = this.body;
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createTextNode(textContent) {
    return new FakeTextNode(this, textContent);
  }

  _focusElement(element) {
    const root = element.getRootNode();
    const publicTarget = root instanceof FakeShadowRoot ? root.host : element;
    const oldActive = this.activeElement;

    if (oldActive && oldActive !== publicTarget && oldActive !== this.body) {
      this.activeElement = this.body;
      this._dispatchFocusEvent('blur', oldActive, publicTarget);
      this._dispatchFocusEvent('focusout', oldActive, publicTarget);
      if (this.activeElement !== this.body && this.activeElement !== publicTarget) {
        if (root instanceof FakeShadowRoot) root.activeElement = null;
        return;
      }
    }

    if (root instanceof FakeShadowRoot) root.activeElement = element;
    this.activeElement = publicTarget;
    this._dispatchFocusEvent('focus', publicTarget, oldActive);
    this._dispatchFocusEvent('focusin', publicTarget, oldActive);
  }

  _dispatchFocusEvent(type, target, relatedTarget) {
    const event = new FakeEvent(type, { relatedTarget });
    event.target = target;
    const path = [this.defaultView, this, this.documentElement, this.body, target].filter(Boolean);

    event.eventPhase = 1;
    for (const node of path) {
      if (!node._invoke(event, true)) return;
    }

    event.eventPhase = 3;
    for (const node of path.slice().reverse()) {
      if (!node._invoke(event, false)) return;
    }
  }
}

function createContext() {
  const document = new FakeDocument();
  const window = new FakeNode(document);
  document.defaultView = window;
  window.document = document;
  window.window = window;
  window.location = { hostname: 'github.com' };
  window.navigator = { platform: 'MacIntel', userAgent: 'Macintosh' };
  window.performance = { now: () => 0 };
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.queueMicrotask = queueMicrotask;
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  window.cancelAnimationFrame = clearTimeout;
  window.console = console;
  window.ContentThemeManager = class {};
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      getURL: (resource) => `chrome-extension://pounce/${resource}`,
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async () => ({ success: true, data: [] })
    },
    storage: {
      sync: {
        get: async () => ({}),
        set: async () => {}
      },
      onChanged: { addListener() {}, removeListener() {} }
    }
  };
  window.globalThis = window;
  return { window, document };
}

function loadOverlay(window) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'search-overlay.js'), 'utf8');
  vm.runInNewContext(source, window, { filename: 'search-overlay.js' });
  return window.pounceSearchOverlay;
}

function createModalWithFocusedButton(document) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const issueButton = document.createElement('button');
  issueButton.className = 'CreateIssueDialog-module__copyClipboardButton';
  dialog.appendChild(issueButton);
  document.body.appendChild(dialog);
  issueButton.focus();
  return { dialog, issueButton };
}

test('keeps focus in Pounce when an existing modal focus trap restores focus before Pounce handlers run', async () => {
  const { window, document } = createContext();
  const { dialog, issueButton } = createModalWithFocusedButton(document);

  window.addEventListener('focusout', (event) => {
    const overlayHost = dialog.childNodes.find((node) => node.id === 'pounce-shadow-host');
    if (event.target === issueButton && event.relatedTarget !== overlayHost) {
      issueButton.focus();
    }
  }, { capture: true });

  const overlay = loadOverlay(window);
  overlay.show();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(overlay.shadowRoot.activeElement?.className, 'pounce-search-input');
  assert.equal(document.activeElement?.id, 'pounce-shadow-host');
  assert.equal(overlay.shadowHost.parentNode, dialog);
});

test('keeps Pounce visible inside a host modal and closes with Escape', async () => {
  const { window, document } = createContext();
  const { dialog } = createModalWithFocusedButton(document);
  const overlay = loadOverlay(window);

  overlay.show();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(overlay.shadowHost.parentNode, dialog);
  assert.equal(overlay.overlay.style.display, 'flex');
  assert.equal(document.body.style.overflow, 'hidden');

  document.dispatchEvent(new FakeEvent('keyup', { key: 'Escape' }));

  assert.equal(overlay.isVisible, false);
  assert.equal(overlay.overlay.style.display, 'none');
  assert.equal(document.body.style.overflow, '');
});
