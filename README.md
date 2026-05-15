<div align="center">

# Pounce

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/clgpmlhecjlekgipngaopglbfdkonjdf?label=Chrome%20Web%20Store&color=4285F4)](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)
[![Users](https://img.shields.io/chrome-web-store/users/clgpmlhecjlekgipngaopglbfdkonjdf?label=users&color=4285F4)](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)
[![Rating](https://img.shields.io/chrome-web-store/rating/clgpmlhecjlekgipngaopglbfdkonjdf?label=rating&color=brightgreen)](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf/reviews)
[![GitHub stars](https://img.shields.io/github/stars/TuYv/pounce?style=flat&color=yellow)](https://github.com/TuYv/pounce/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/TuYv/pounce?color=informational)](https://github.com/TuYv/pounce/commits/master)
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

See [CHANGELOG.md](CHANGELOG.md) for the full release history.
