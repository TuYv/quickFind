<div align="center">

# Pounce

[![Chrome 应用商店](https://img.shields.io/chrome-web-store/v/clgpmlhecjlekgipngaopglbfdkonjdf?label=Chrome%20%E5%95%86%E5%BA%97&color=4285F4)](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)
[![GitHub stars](https://img.shields.io/github/stars/TuYv/pounce?style=flat&color=yellow)](https://github.com/TuYv/pounce/stargazers)
[![License](https://img.shields.io/github/license/TuYv/pounce)](LICENSE)

🌐 [English](README.md) · **中文**

### 一个快捷键，找到浏览器里的任何东西。

按 `⌘K` 弹出搜索框，同时搜你的标签页、书签、历史和常用站点。<br>
全键盘操作，不打断当前页面。

<img src="demo.gif" alt="Pounce 演示" width="680">

**[→ 从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/clgpmlhecjlekgipngaopglbfdkonjdf)**

</div>

## 核心功能

- 🔍 **统一搜索** —— 一次 `⌘K`，同时搜标签页 + 书签 + 历史 + 常用站点
- ⌨️ **全键盘导航** —— 箭头移动、回车跳转、Esc 关闭，鼠标不用碰
- 🎨 **内置深色模式** —— Light / Dark / System 三档，popup 或设置页都能切
- 📚 **批量打开 URLs** *(附加功能)* —— 保存一组 URL，按 `⌘⇧U` 一键全部打开

## 快捷键

| 操作 | Mac | Windows / Linux |
|------|-----|-----------------|
| 打开搜索框 | `⌘K` | `Alt+K` |
| 批量打开已保存 URL | `⌘⇧U` | `Ctrl+Shift+U` |
| 选择结果 | `↑` / `↓` | `↑` / `↓` |
| 跳转到结果 | `Enter` | `Enter` |
| 关闭搜索框 | `Esc` | `Esc` |

> 在 `chrome://`、`chrome-extension://`、`about:` 页面上无法使用——这是 Chrome 对所有扩展的安全限制，不是 bug。

## 权限说明

所有权限都只用于核心搜索功能。**数据全部在本地浏览器中处理，不会发送到任何服务器。**

| 权限 | 用途 |
|------|------|
| `tabs` | 读取已打开标签的标题和 URL |
| `bookmarks` | 搜索书签标题和 URL |
| `history` | 让历史记录出现在搜索结果中 |
| `topSites` | 让常用站点出现在搜索结果中 |
| `storage` | 保存你的 URL 列表和主题偏好 |
| `scripting` | 在当前页面注入搜索浮层 |
| `activeTab` | 触发浮层时访问当前标签页 |

## 许可

MIT —— 见 [LICENSE](LICENSE)

## 更新日志

### 1.3.1
- Popup 顶部新增主题切换按钮（Light / Dark / System），与设置页实时同步
- 修复：目标 tab 已关闭时，点击结果会回退为新开 tab
- 修复：popup 和设置页同时打开时主题同步失效
- 修复：设置页初次打开时主题单选框显示错误

### 1.3.0
- 搜索浮层 UI 和图标优化

### 1.2.0
- 首个版本 —— Manifest V3，Chrome 88+
