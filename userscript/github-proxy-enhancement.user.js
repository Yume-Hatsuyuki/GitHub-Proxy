// ==UserScript==
// @name         GitHub Proxy
// @name:zh-CN   Github 代理
// @namespace    github-proxy
// @version      1.0.4
// @author       梦初雪
// @description  Add proxy-aware Git clone, Raw, Release and source archive links to GitHub.
// @match        https://github.com/*
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABGdBTUEAALGPC/xhBQAAAAFzUkdCAK7OHOkAAACEUExURUxpcRgWFhsYGBgWFhcWFh8WFhoYGBgWFiUlJRcVFRkWFhgVFRgWFhgVFRsWFhgWFigeHhkWFv////////////r6+h4eHv///xcVFfLx8SMhIUNCQpSTk/r6+jY0NCknJ97e3ru7u+fn51BOTsPCwqGgoISDg6empmpoaK2srNDQ0FhXV3eXcCcAAAAXdFJOUwCBIZXMGP70BuRH2Ze/LpIMUunHkpQR34sfygAAAVpJREFUOMt1U+magjAMDAVb5BDU3W25b9T1/d9vaYpQKDs/rF9nSNJkArDA9ezQZ8wPbc8FE6eAiQUsOO1o19JolFibKCdHGHC0IJezOMD5snx/yE+KOYYr42fPSufSZyazqDoseTPw4lGJNOu6LBXVUPBG3lqYAOv/5ZwnNUfUifzBt8gkgfgINmjxOpgqUA147QWNaocLniqq3QsSVbQHNp45N/BAwoYQz9oUJEiE4GMGfoBSMj5gjeWRIMMqleD/CAzUHFqTLyjOA5zjNnwa4UCEZ2YK3khEcBXHjVBtEFeIZ6+NxYbPqWp1DLKV42t6Ujn2ydyiPi9nX0TTNAkVVZ/gozsl6FbrktkwaVvL2TRK0C8Ca7Hck7f5OBT6FFbLATkL2ugV0tm0RLM9fedDvhWstl8Wp9AFDjFX7yOY/lJrv8AkYuz7fuP8dv9izCYH+x3/LBnj9fYPBTpJDNzX+7cAAAAASUVORK5CYII=
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_notification
// @run-at       document-idle
// @license      AGPL-3.0 license
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
    cleanupStaleNodes();
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

  function cleanupStaleNodes() {
    // 清理 Clone 代理克隆框
    document.querySelectorAll('[data-ghp-proxy-clone]').forEach(item => {
      const prev = item.previousElementSibling;
      const input = prev && prev.querySelector('input[id^="clone-with-"]');
      if (!input || (!input.value.startsWith('git clone http') && !input.value.startsWith('http'))) {
        item.remove();
      }
    });

    // 清理老版本残留的 Clone 按钮组
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(wrapper => {
      const prev = wrapper.previousElementSibling;
      const hasInput = prev && (prev.tagName === 'INPUT' || prev.querySelector('input'));
      if (!hasInput) {
        wrapper.remove();
      }
    });

    // 清理 Download 代理按钮（原生 ActionList 样式）
    document.querySelectorAll('[data-ghp-download-item]').forEach(item => {
      const prev = item.previousElementSibling;
      if (!prev || !prev.tagName || prev.tagName.toLowerCase() !== 'li') {
        item.remove();
        return;
      }
      const html = prev.innerHTML;
      if (!html.includes('/releases/download/') && !html.includes('/archive/') && !html.includes('codeload.github.com/')) {
        item.remove();
      }
    });

    // 清理 Download 代理按钮（兜底样式）
    document.querySelectorAll('.ghp-download-proxy').forEach(link => {
      const prev = link.previousElementSibling;
      const isValidDownload = prev && prev.tagName === 'A' && (
        prev.href.includes('/releases/download/') ||
        prev.href.includes('/archive/') ||
        prev.href.includes('codeload.github.com/')
      );
      if (!isValidDownload) {
        link.remove();
      }
    });

    // 清理 File List 代理按钮
    document.querySelectorAll('.ghp-file-link').forEach(link => {
      const prev = link.previousElementSibling;
      const isValidBlob = prev && prev.tagName === 'A' && prev.href.includes('/blob/');
      if (!isValidBlob) {
        link.remove();
      }
    });

    // 清理 Raw via Proxy 独立 Item
    document.querySelectorAll('[data-ghp-raw-item]').forEach(item => {
      const prev = item.previousElementSibling;
      if (!prev || !prev.querySelector('[data-ghp-raw-action="1"]')) {
        item.remove();
      }
    });
  }

  function addCloneActions() {
    const inputs = document.querySelectorAll('input[id^="clone-with-"]');
    
    for (const input of inputs) {
      let rawValue = input.value.trim();
      if (!rawValue.startsWith('http') && !rawValue.startsWith('git clone http')) continue;
      
      const urlToParse = rawValue.replace(/^git\s+clone\s+/i, '');
      const githubUrl = parseGitHubUrl(urlToParse);
      if (!githubUrl) continue;
      
      const container = input.parentElement;
      if (!container) continue;
      
      // 1. 将原生输入框的值修改为带 git clone 前缀
      if (!input.value.startsWith('git clone ')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(input, `git clone ${input.value}`);
      }
      
      // 2. 劫持原生复制按钮，确保复制出来的值为完整命令
      const copyBtn = container.querySelector('button');
      if (copyBtn && copyBtn.dataset.ghpCloneBound !== '1') {
        copyBtn.dataset.ghpCloneBound = '1';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          let val = input.value;
          if (val.startsWith('http')) {
            val = `git clone ${val}`;
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeSetter.call(input, val);
          }
          GM_setClipboard(val);
          notify('Copied to clipboard.');
        }, true);
      }
      
      // 3. 生成代理 URL 及命令
      const proxyUrl = buildProxyUrl('gh', githubUrl.pathname.replace(/\/$/, '') + (githubUrl.pathname.endsWith('.git') ? '' : '.git'), githubUrl.search);
      const proxyCommand = `git clone ${proxyUrl}`;
      
      // 4. 查重与清理旧节点
      let existing = container.nextElementSibling;
      if (existing && existing.hasAttribute('data-ghp-proxy-clone')) {
        const existingInput = existing.querySelector('input');
        if (existingInput && existingInput.value === proxyCommand) {
          continue;
        }
      }
      
      let sibling = container.nextElementSibling;
      while (sibling && sibling.hasAttribute('data-ghp-proxy-clone')) {
        const toRemove = sibling;
        sibling = sibling.nextElementSibling;
        toRemove.remove();
      }
      
      // 5. 克隆原生容器
      const newContainer = container.cloneNode(true);
      newContainer.setAttribute('data-ghp-proxy-clone', '1');
      
      const newInput = newContainer.querySelector('input');
      if (newInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeSetter.call(newInput, proxyCommand);
        newInput.id = 'clone-with-proxy';
      }
      
      const label = newContainer.querySelector('label');
      if (label) label.remove();
      
      // 6. 替换克隆的复制按钮，剥离 React 事件并绑定自定义复制
      const oldBtn = newContainer.querySelector('button');
      if (oldBtn) {
        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = oldBtn.className;
        newBtn.innerHTML = oldBtn.innerHTML;
        newBtn.title = 'Copy proxy clone command';
        
        newBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          GM_setClipboard(proxyCommand);
          notify('Copied to clipboard.');
        });
        
        for (const attr of [...newBtn.attributes]) {
          if (attr.name.startsWith('data-') || attr.name === 'aria-labelledby') {
            newBtn.removeAttribute(attr.name);
          }
        }
        
        oldBtn.replaceWith(newBtn);
      }
      
      container.after(newContainer);
    }
  }

  function rawPathFromBlob(pathname) {
    const marker = '/blob/';
    const index = pathname.indexOf(marker);
    if (index < 0) return '';
    return pathname.slice(0, index) + '/' + pathname.slice(index + marker.length);
  }

  function addRawPageAction() {
    const rawPath = rawPathFromBlob(window.location.pathname);
    if (!rawPath) return;

    const rawButton = document.querySelector('a[data-testid="raw-button"]') ||
      [...document.querySelectorAll('a, button')].find((element) =>
        element.textContent.trim() === 'Raw' || element.getAttribute('aria-label') === 'Raw'
      );

    if (!rawButton) return;

    const proxyUrl = buildProxyUrl('raw', rawPath, window.location.search);
    const item = rawButton.closest('.prc-ButtonGroup-Item-PqvDl');
    const group = rawButton.closest('[data-component="ButtonGroup"]');

    if (item && group && item.parentElement === group) {
      rawButton.dataset.ghpRawAction = '1';

      let existing = item.nextElementSibling;
      if (existing && existing.hasAttribute('data-ghp-raw-item')) {
        const link = existing.querySelector('a');
        if (link && link.getAttribute('href') === proxyUrl) {
          return;
        }
      }

      let sibling = item.nextElementSibling;
      while (sibling && sibling.hasAttribute('data-ghp-raw-item')) {
        const toRemove = sibling;
        sibling = sibling.nextElementSibling;
        toRemove.remove();
      }

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

      const newItem = document.createElement('div');
      newItem.className = item.className;
      newItem.dataset.ghpRawItem = '1';
      newItem.appendChild(link);

      item.after(newItem);
    } else {
      rawButton.dataset.ghpRawAction = '1';
      
      let existing = rawButton.nextElementSibling;
      if (existing && existing.classList.contains('ghp-raw-fallback') && existing.getAttribute('href') === proxyUrl) {
        return;
      }
      
      let sibling = rawButton.nextElementSibling;
      while (sibling && sibling.classList.contains('ghp-raw-fallback')) {
        const toRemove = sibling;
        sibling = sibling.nextElementSibling;
        toRemove.remove();
      }
      
      const link = createLink('Raw via Proxy', proxyUrl);
      link.classList.add('ghp-raw-fallback');
      rawButton.insertAdjacentElement('afterend', link);
    }
  }

  function addRawFileListActions() {
    if (window.location.pathname.includes('/blob/')) return;

    const fileLinks = document.querySelectorAll('a[href*="/blob/"]');
    for (const anchor of fileLinks) {
      const url = parseGitHubUrl(anchor.href);
      if (!url) continue;

      const rawPath = rawPathFromBlob(url.pathname);
      if (!rawPath) continue;

      const proxyUrl = buildProxyUrl('raw', rawPath, url.search);

      let existing = anchor.nextElementSibling;
      if (existing && existing.classList.contains('ghp-file-link') && existing.getAttribute('href') === proxyUrl) {
        continue;
      }

      let sibling = anchor.nextElementSibling;
      while (sibling && sibling.classList.contains('ghp-file-link')) {
        const toRemove = sibling;
        sibling = sibling.nextElementSibling;
        toRemove.remove();
      }

      const link = createLink('☁', proxyUrl, 'ghp-file-link');
      link.title = 'Download this file through GitHub Proxy';
      link.setAttribute('aria-label', 'Download raw file through GitHub Proxy');
      anchor.insertAdjacentElement('afterend', link);
    }
  }

  function addDownloadActions() {
    const links = document.querySelectorAll(
      'a[href*="/releases/download/"], a[href*="/archive/"], a[href*="codeload.github.com/"]'
    );

    for (const anchor of links) {
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
      
      const actionListItem = anchor.closest('li[data-component="ActionList.Item"]');
      
      if (actionListItem) {
        let existing = actionListItem.nextElementSibling;
        if (existing && existing.hasAttribute('data-ghp-download-item')) {
          const existingLink = existing.querySelector('a');
          if (existingLink && existingLink.href === proxyUrl) {
            continue;
          }
        }

        let sibling = actionListItem.nextElementSibling;
        while (sibling && sibling.hasAttribute('data-ghp-download-item')) {
          const toRemove = sibling;
          sibling = sibling.nextElementSibling;
          toRemove.remove();
        }

        const newLi = actionListItem.cloneNode(true);
        newLi.setAttribute('data-ghp-download-item', '1');
        
        newLi.querySelectorAll('.ghp-action, .ghp-download-proxy').forEach(el => el.remove());

        const newAnchor = newLi.querySelector('a');
        if (newAnchor) {
          newAnchor.href = proxyUrl;
          newAnchor.target = '_blank';
          newAnchor.rel = 'noopener noreferrer nofollow';
          newAnchor.referrerPolicy = 'no-referrer';
          newAnchor.removeAttribute('id');
          newAnchor.removeAttribute('aria-labelledby');
          newAnchor.setAttribute('title', 'Download through GitHub Proxy');

          const label = newAnchor.querySelector('[data-component="ActionList.Item.Label"]');
          if (label) {
            label.textContent = `${label.textContent} (Proxy)`;
          } else {
            newAnchor.textContent = 'Download via Proxy';
          }
        }
        
        actionListItem.after(newLi);

      } else {
        let existing = anchor.nextElementSibling;
        if (existing && existing.classList.contains('ghp-download-proxy') && existing.getAttribute('href') === proxyUrl) {
          continue;
        }

        let sibling = anchor.nextElementSibling;
        while (sibling && sibling.classList.contains('ghp-download-proxy')) {
          const toRemove = sibling;
          sibling = sibling.nextElementSibling;
          toRemove.remove();
        }

        const link = createLink('Proxy', proxyUrl);
        link.classList.add('ghp-download-proxy');
        link.title = 'Download through GitHub Proxy';
        anchor.insertAdjacentElement('afterend', link);
      }
    }
  }
})();