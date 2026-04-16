# QuickFind — Tab & Bookmark Search

A Chrome extension that lets you instantly search open tabs, bookmarks, history, and top sites with a keyboard shortcut — without leaving your current page.

## Features

- **Instant search overlay** — press `⌘K` (Mac) / `Alt+K` (Windows/Linux) on any page to open a fuzzy search overlay
- **Unified search** — searches across open tabs, bookmarks, browser history, and top sites simultaneously
- **Batch open URLs** — save a list of URLs and open them all at once with `⌘⇧U` / `Ctrl+Shift+U`
- **Keyboard-first navigation** — `↑↓` to move, `Enter` to jump, `Esc` to close
- **Theme toggle in popup** — switch Light / Dark / System directly from the popup header; syncs in real-time with the settings page

## Keyboard Shortcuts

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Open search overlay | `⌘K` | `Alt+K` |
| Batch open URLs | `⌘⇧U` | `Ctrl+Shift+U` |
| Navigate results | `↑` / `↓` | `↑` / `↓` |
| Open selected result | `Enter` | `Enter` |
| Close overlay | `Esc` | `Esc` |

> **Note:** The search overlay cannot be injected into `chrome://`, `chrome-extension://`, or `about:` pages. This is a Chrome security restriction that applies to all extensions.

## Installation

### From Chrome Web Store
Install directly from the Chrome Web Store listing.

### Load Unpacked (Development)
1. Open `chrome://extensions` in Chrome
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select this directory
4. Reload the extension after any source changes

## Project Structure

```
quickFind/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker — handles shortcuts & data fetching
├── search-overlay.js      # Content script — search UI injected into pages
├── search-overlay.css     # Styles for the search overlay
├── search-ranking.js      # Fuzzy search and result scoring logic
├── theme-manager.js       # Light/dark theme management
├── popup.html / popup.js  # Extension popup
├── options.html / options.js  # Settings page (URL management, theme)
└── icons/                 # SVG and PNG icons
```

## Development

No build step required. Edit source files directly.

- Preview popup UI: open `popup.html` in a browser (`popup.js` includes a mock `chrome` fallback)
- Preview settings page: open `options.html` in a browser
- After editing: go to `chrome://extensions` and click the reload button for QuickFind

## Permissions

| Permission | Purpose |
|------------|---------|
| `tabs` | Read open tab titles and URLs for search |
| `bookmarks` | Search bookmark titles and URLs |
| `history` | Include browser history in search results |
| `topSites` | Include frequently visited sites |
| `storage` | Persist saved URLs and theme preference |
| `scripting` | Inject search overlay into pages |
| `activeTab` | Access the current tab when triggered |
| `notifications` | (Reserved for future use) |

## License

MIT — see [LICENSE](LICENSE)

## Changelog

### 1.3.1
- **feat:** theme toggle button in popup header (☀️ Light / 🌙 Dark / ⊙ System), syncs in real-time with settings page
- **fix:** tab switching now falls back to opening a new tab when the target tab was closed since the search data was fetched
- **fix:** popup and settings page theme now stay in sync when both are open simultaneously (switched to `chrome.storage.onChanged` for reliable cross-page sync)
- **fix:** settings page theme radio always showed "System" on first open regardless of saved preference

### 1.3.0
- Search overlay UI and icon improvements

### 1.2.0
- Initial release — Manifest V3, Chrome 88+
