<div align="center">

# Pounce

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/clgpmlhecjlekgipngaopglbfdkonjdf?label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)
[![GitHub stars](https://img.shields.io/github/stars/TuYv/pounce?style=flat&color=yellow)](https://github.com/TuYv/pounce/stargazers)
[![License](https://img.shields.io/github/license/TuYv/pounce)](LICENSE)

🌐 **English** · [中文](README.zh-CN.md)

### One keystroke to find anything in your browser.

Press `⌘K` to open a unified search overlay across your open tabs, bookmarks, history, and top sites.<br>
Keyboard-first, doesn't leave your current page.

<img src="hero.png" alt="Pounce — find anything with ⌘K" width="820">

<img src="demo-v2.gif" alt="Pounce demo" width="680">

**[→ Install from Chrome Web Store](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)**

</div>

> The name *Pounce* — to leap and seize. 🐾
>
> When you need it, it pounces in and finds what you really want.

## Features

- 🔍 **Unified search** — one `⌘K`, search open tabs + bookmarks + history + top sites at once
- ⌨️ **Keyboard-first navigation** — arrows to move, Enter to jump, Esc to close; no mouse needed
- 🎨 **Built-in dark mode** — Light / Dark / System, switchable from the popup or settings
- 📚 **Batch open URLs** *(bonus)* — save a list of URLs, press `⌘⇧U` to open them all

## Keyboard Shortcuts

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Open search overlay | `⌘K` | `Alt+K` |
| Batch open saved URLs | `⌘⇧U` | `Ctrl+Shift+U` |
| Navigate results | `↑` / `↓` | `↑` / `↓` |
| Open selected result | `Enter` | `Enter` |
| Quick-pick result 1–9 | `⌥1`–`⌥9` | `Alt+1`–`Alt+9` |
| Close overlay | `Esc` | `Esc` |

> The overlay cannot be injected into `chrome://`, `chrome-extension://`, or `about:` pages. This is a Chrome-wide security restriction that applies to every extension.

## Permissions

All permissions are used only for core search functionality. **No data ever leaves your browser.**

| Permission | Purpose |
|------------|---------|
| `tabs` | Read open tab titles and URLs |
| `bookmarks` | Search bookmark titles and URLs |
| `history` | Include browser history in results |
| `topSites` | Include frequently visited sites |
| `storage` | Save your URL list and theme preference |
| `scripting` | Inject the search overlay into the current page |
| `activeTab` | Access the current tab when you trigger the overlay |

## License

MIT — see [LICENSE](LICENSE)

## Changelog

### 1.5.5
- Onboarding: Settings page now opens with a hero card showing the primary shortcut (⌘K on Mac, Alt+K elsewhere) and a one-line pitch — first-time users immediately know what Pounce is and how to use it. The "Batch Open URLs" section moved below the search preferences.
- Fix: search overlay no longer shows two highlighted rows at the same time. This happened when the cursor sat on a result while the keyboard-selected row was different — typically right after opening the overlay with the cursor already over the list, or when an async history fetch rerendered results, or when scrolling the list. The hovered row now becomes the truly selected one, and CSS `:hover` is gated until you actually move the mouse.

### 1.5.4
- Fix: ⌘K now works on pages whose modal libraries trap focus (e.g. OpenObserve's log detail panel using Quasar QDialog). The overlay's input would open but stay unfocused, swallowing keystrokes — focus is now shielded from the host page's focus-trap watchers.
- Privacy: stripped success-path `console.log` calls from content scripts so internal Pounce activity no longer leaks into the host page's DevTools console. Error logging is preserved for diagnosing real failures.

### 1.5.3
- Fix: search dialog corners turned into a pill shape on sites that scale `<html>` font-size (e.g. baidu.com sets it to 100px). The Shadow DOM doesn't isolate `rem` from the host document, so the radius variable was being multiplied. Switched to fixed pixels.

### 1.5.2
- Better history recall: previously, frequently-typed work URLs could fall out of the candidate pool and look "missing" to the search overlay. The history pool now spans 1,000 entries instead of 50, so the ranker can surface high-`typedCount` URLs that aren't recently visited.
- New setting: choose how many results to show (10 / 20 / 50, default 10).
- Fix: ⌘K now works on tabs that failed to load (DNS / network errors). Falls back to the same bridge tab used for `chrome://` pages.
- Match highlighting is always on; the toggle has been removed.

### 1.5.1
- Renamed to "Find Anything with ⌘K" — better matches the actual search scope (tabs + bookmarks + history + top sites).
- Fix: extension's own `bridge.html` no longer leaks into search results via the history source.

### 1.5.0
- Added Simplified Chinese localization across popup, options, search overlay, and system notifications. Auto-detects browser language; manual override in Settings → Language.

### 1.4.7
- Search Chinese-titled tabs / bookmarks / history by pinyin: type `bd` or `baidu` to find 百度. Mixed Chinese + Latin queries (`百d搜`) also work.
- Setting toggle to turn pinyin matching off (default on). English titles never enter the pinyin path, so non-Chinese users pay no runtime cost.
- Pinyin-matched characters in titles get the same primary-color highlight as literal matches.

### 1.4.6
- Add match highlighting in search results, with a setting to turn it off.
- Add a setting to turn quick-pick shortcuts on or off.
- Add GitHub issue links in the popup and settings page for faster feedback.
- Polish the settings page layout and footer hierarchy.

### 1.4.5
- Change: digit keys `1`–`9` now type into the search box; use `Alt + 1–9` (`⌥1–⌥9` on macOS) to quick-pick a result. Fixes [#1](https://github.com/TuYv/pounce/issues/1)
- Fix: extension updates now replace the stale overlay on already-open tabs instead of stranding the old keyboard behavior until reload

### 1.4.4
- Press 1–9 to instantly jump to a search result without using arrow keys

### 1.4.3
- Fix: history now queries dynamically as you type, matching Chrome address bar behavior

### 1.4.1
- Search overlay migrated to Shadow DOM — host page styles can no longer bleed in
- Fix: favicon loading skipped for non-http(s) pages to avoid console errors
- Fix: IME composition input (CJK) no longer triggers unintended search
- Fix: Esc now exits the overlay in a single keypress in all cases

### 1.3.1
- Theme toggle in popup header (Light / Dark / System), real-time sync with settings
- Fix: tab switching falls back to opening a new tab when the target was closed
- Fix: popup and settings theme stay in sync when both are open
- Fix: settings theme radio now shows the correct saved preference on first open

### 1.3.0
- Search overlay UI and icon improvements

### 1.2.0
- Initial release — Manifest V3, Chrome 88+
