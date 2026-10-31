// ==UserScript==
// @name         GitHub Proxy
// @name:zh-CN   Github 代理
// @namespace    github-proxy
// @version      1.0.1
// @author       梦初雪
// @description  Add proxy-aware Git clone, Raw, Release and source archive links to GitHub.
// @match        https://github.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_BASE = 'ghp_proxy_base_url';
  const STORAGE_ENABLED = 'ghp_enhancements_enabled';
  const DEFAULT_ENABLED = true;
  const BUTTON_CLASS = 'ghp-action';
  const WRAPPER_CLASS = 'ghp-actions';
  const STYLE_ID = 'ghp-userscript-style';

  function getEnabled() {
    return GM_getValue(STORAGE_ENABLED, DEFAULT_ENABLED) !== false;
  }

  function getProxyBase() {
    return normalizeProxyBase(GM_getValue(STORAGE_BASE, ''));
  }

  function normalizeProxyBase(value) {
    if (typeof value !== 'string' || !value.trim()) return '';

    try {
      const parsed = new URL(value.trim());
      const isLocalHttp = parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

      if (parsed.protocol !== 'https:' && !isLocalHttp) return '';
      if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
      if (parsed.pathname !== '/' && parsed.pathname !== '') return '';

      return parsed.origin;
    } catch {
      return '';
    }
  }

  function notify(message) {
    GM_notification({
      title: 'GitHub Proxy Enhancement',
      text: message,
      timeout: 3000
    });
  }

  function configureProxy() {
    const current = GM_getValue(STORAGE_BASE, '');
    const value = window.prompt(
      'Enter the base URL of your deployed GitHub Proxy Worker.\n\nExample: https://your-worker.example.workers.dev\nDo not add /gh, /raw or a trailing path.',
      current
    );

    if (value === null) return;
    const normalized = normalizeProxyBase(value);
    if (!normalized) {
      window.alert('Invalid URL. Use an HTTPS origin, without a path, query or fragment.');
      return;
    }

    GM_setValue(STORAGE_BASE, normalized);
    notify('Proxy URL saved. Reloading GitHub…');
    window.location.reload();
  }

  function toggleEnhancements() {
    const next = !getEnabled();
    GM_setValue(STORAGE_ENABLED, next);
    notify(`${next ? 'Enabled' : 'Disabled'}. Reloading GitHub…`);
    window.location.reload();
  }

  GM_registerMenuCommand('GitHub Proxy: Set proxy URL', configureProxy);
  GM_registerMenuCommand(
    `GitHub Proxy: ${getEnabled() ? 'Disable' : 'Enable'} enhancements`,
    toggleEnhancements
  );

  const proxyBase = getProxyBase();
  if (!proxyBase || !getEnabled()) return;

  let scanScheduled = false;
  installStyles();
  scheduleScan();

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('urlchange', scheduleScan);

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(() => {
      scanScheduled = false;
      scanPage();
    });
  }

  function scanPage() {
    if (!getEnabled() || !getProxyBase()) return;
    cleanupOrphanRawItems();
    addCloneActions();
    addRawPageAction();
    addRawFileListActions();
    addDownloadActions();
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${WRAPPER_CLASS} {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 7px 0;
        font: 12px/1.4 system-ui, sans-serif;
      }
      .${BUTTON_CLASS} {
        display: inline-flex !important;
        align-items: center;
        gap: 4px;
        width: fit-content;
        min-height: 25px;
        margin: 3px 5px 3px 0 !important;
        padding: 3px 8px !important;
        border: 1px solid var(--borderColor-default, #d0d7de) !important;
        border-radius: 6px !important;
        background: var(--button-default-bgColor-rest, var(--bgColor-default, #fff)) !important;
        color: var(--fgColor-default, #1f2328) !important;
        font: 12px/1.4 system-ui, sans-serif !important;
        text-decoration: none !important;
        cursor: pointer;
        vertical-align: middle;
      }
      .${BUTTON_CLASS}:hover {
        background: var(--button-default-bgColor-hover, var(--bgColor-muted, #f3f4f6)) !important;
        text-decoration: none !important;
      }
      .${BUTTON_CLASS}[data-ghp-kind="copy"] { cursor: pointer; }
      .ghp-file-link { margin-left: 7px !important; padding: 1px 5px !important; min-height: 20px; }
    `;
    document.head.appendChild(style);
  }

  function buildProxyUrl(route, path, search = '') {
    const safePath = path.startsWith('/') ? path : `/${path}`;
    return `${proxyBase}/${route}${safePath}${search}`;
  }

  function parseGitHubUrl(value) {
    try {
      const url = new URL(value, window.location.origin);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
      return url;
    } catch {
      return null;
    }
  }

  function createLink(label, href, extraClass = '') {
    const link = document.createElement('a');
    link.className = `${BUTTON_CLASS} ${extraClass}`.trim();
    link.href = href;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer nofollow';
    link.referrerPolicy = 'no-referrer';
    return link;
  }

  function createCopyButton(label, value) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.dataset.ghpKind = 'copy';
    button.textContent = label;
    button.addEventListener('click', () => {
      GM_setClipboard(value);
      notify('Copied to clipboard.');
    });
    return button;
  }

  function addCloneActions() {
    const inputs = document.querySelectorAll('input');

    for (const input of inputs) {
      const rawValue = (input.value || input.getAttribute('value') || '').trim();
      const cloneValue = rawValue.replace(/^git\s+clone\s+/i, '');
      const githubUrl = parseGitHubUrl(cloneValue);
      if (!githubUrl || input.dataset.ghpCloneActions === '1') continue;

      const pathParts = githubUrl.pathname.split('/').filter(Boolean);
      if (pathParts.length !== 2 || !pathParts[1]) continue;
      if (input.closest('form') && input.type !== 'text') continue;

      const proxyUrl = buildProxyUrl('gh', githubUrl.pathname.replace(/\/$/, '') + (githubUrl.pathname.endsWith('.git') ? '' : '.git'), githubUrl.search);
      const wrapper = document.createElement('div');
      wrapper.className = WRAPPER_CLASS;
      wrapper.append(
        createCopyButton('Copy proxy URL', proxyUrl),
        createCopyButton('Copy proxy git clone command', `git clone ${proxyUrl}`),
        createLink('Open proxy URL', proxyUrl)
      );

      const anchor = input.closest('[class*="InputGroup"], [class*="input-group"]') || input.parentElement;
      if (!anchor || !anchor.parentNode) continue;
      anchor.insertAdjacentElement('afterend', wrapper);
      input.dataset.ghpCloneActions = '1';
    }
  }

  function rawPathFromBlob(pathname) {
    const marker = '/blob/';
    const index = pathname.indexOf(marker);
    if (index < 0) return '';
    return pathname.slice(0, index) + '/' + pathname.slice(index + marker.length);
  }

  // 清理 React 重新渲染后残留的孤立 Raw via Proxy Item
  function cleanupOrphanRawItems() {
    document.querySelectorAll('[data-ghp-raw-item]').forEach((node) => {
      const prev = node.previousElementSibling;
      const stillValid = prev &&
        prev.querySelector('[data-ghp-raw-action="1"]') &&
        node.parentElement &&
        node.parentElement.querySelector('[data-component="ButtonGroup"]');
      // 只要它还在 ButtonGroup 里、且前一项是当前 Raw 按钮，就保留
      if (!stillValid && !node.querySelector('[data-ghp-raw-action="1"]')) {
        // 若 Item 本身还挂在 Page 上但不属于当前 ButtonGroup，则移除
        const group = node.closest('[data-component="ButtonGroup"]');
        if (!group) node.remove();
      }
    });
  }

  function addRawPageAction() {
    const rawPath = rawPathFromBlob(window.location.pathname);
    if (!rawPath) return;

    const rawButton = document.querySelector('a[data-testid="raw-button"]') ||
      [...document.querySelectorAll('a, button')].find((element) =>
        element.textContent.trim() === 'Raw' || element.getAttribute('aria-label') === 'Raw'
      );

    if (!rawButton || rawButton.dataset.ghpRawAction === '1') return;

    const proxyUrl = buildProxyUrl('raw', rawPath, window.location.search);

    const item = rawButton.closest('.prc-ButtonGroup-Item-PqvDl');
    const group = rawButton.closest('[data-component="ButtonGroup"]');

    if (item && group && item.parentElement === group) {
      // 1. 克隆 Raw 链接 → 完整继承 GitHub 原生 LinkButton 样式
      const link = rawButton.cloneNode(true);
      link.removeAttribute('data-testid');
      link.removeAttribute('data-ghp-raw-action');
      link.href = proxyUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
      link.referrerPolicy = 'no-referrer';
      link.setAttribute('aria-label', 'Raw via Proxy');

      const label = link.querySelector('[data-component="text"]');
      if (label) {
        label.textContent = 'Raw via Proxy';
      } else {
        link.textContent = 'Raw via Proxy';
      }

      // 2. 克隆原 Item 的容器，作为独立的 ButtonGroup Item
      const newItem = document.createElement('div');
      newItem.className = item.className;
      newItem.dataset.ghpRawItem = '1';
      newItem.appendChild(link);

      // 3. 插到 Raw 所在 Item 后面（ButtonGroup 会自动重新计算圆角）
      item.after(newItem);
    } else {
      // 兜底：找不到 ButtonGroup 结构时退回原逻辑
      const link = createLink('Raw via Proxy', proxyUrl);
      rawButton.insertAdjacentElement('afterend', link);
    }

    rawButton.dataset.ghpRawAction = '1';
  }

  function addRawFileListActions() {
    // The current file page has its own Raw action; this pass is for directory listings.
    if (window.location.pathname.includes('/blob/')) return;

    const fileLinks = document.querySelectorAll('a[href*="/blob/"]');
    for (const anchor of fileLinks) {
      if (anchor.dataset.ghpRawAction === '1') continue;
      const url = parseGitHubUrl(anchor.href);
      if (!url) continue;

      const rawPath = rawPathFromBlob(url.pathname);
      if (!rawPath) continue;

      const link = createLink('☁', buildProxyUrl('raw', rawPath, url.search), 'ghp-file-link');
      link.title = 'Download this file through GitHub Proxy';
      link.setAttribute('aria-label', 'Download raw file through GitHub Proxy');
      anchor.insertAdjacentElement('afterend', link);
      anchor.dataset.ghpRawAction = '1';
    }
  }

  function addDownloadActions() {
    const links = document.querySelectorAll(
      'a[href*="/releases/download/"], a[href*="/archive/"], a[href*="codeload.github.com/"]'
    );

    for (const anchor of links) {
      if (anchor.dataset.ghpDownloadAction === '1') continue;

      let url;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        continue;
      }

      let route = '';
      if (url.hostname === 'github.com' && url.pathname.includes('/releases/download/')) {
        route = 'release';
      } else if (url.hostname === 'github.com' && url.pathname.includes('/archive/')) {
        route = 'archive';
      } else if (url.hostname === 'codeload.github.com') {
        route = 'codeload';
      }
      if (!route || url.protocol !== 'https:') continue;

      const proxyUrl = buildProxyUrl(route, url.pathname, url.search);
      const link = createLink('Proxy', proxyUrl);
      link.title = 'Download through GitHub Proxy';
      anchor.insertAdjacentElement('afterend', link);
      anchor.dataset.ghpDownloadAction = '1';
    }
  }
})();