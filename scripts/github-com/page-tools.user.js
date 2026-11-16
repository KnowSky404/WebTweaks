// ==UserScript==
// @name         GitHub Page Tools
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.1.0
// @description  Scroll to the top and copy a GitHub file's Raw URL from the userscript menu.
// @author       KnowSky404
// @match        https://github.com/*
// @noframes
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @run-at       document-idle
// @homepageURL  https://github.com/KnowSky404/WebTweaks
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/github-com/page-tools.user.js
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'wt-gh-page-tools-style';
  const TOP_ID = 'wt-gh-scroll-top';
  const MENU_LABEL = '复制当前文件的 Raw 链接';
  const RAW_SELECTOR = 'a[data-testid="raw-button"], a[href*="/raw/"], a[href*="raw.githubusercontent.com/"]';
  let menuCommandId = null;

  function isFilePage() {
    return /^\/[^/]+\/[^/]+\/blob\/.+\/.+/.test(location.pathname);
  }

  function currentRawLink() {
    if (!isFilePage()) return null;
    const [, owner, repo] = location.pathname.split('/');
    const blobSuffix = location.pathname.split('/').slice(4).join('/');

    for (const link of document.querySelectorAll(RAW_SELECTOR)) {
      const label = (link.textContent || '').trim();
      if (link.getAttribute('data-testid') !== 'raw-button' && label !== 'Raw' && link.getAttribute('aria-label') !== 'Raw') {
        continue;
      }

      try {
        const raw = new URL(link.getAttribute('href'), location.href);
        const path = raw.pathname.split('/');
        const matchingRepo = path[1] === owner && path[2] === repo;
        const fromRawHost = raw.hostname === 'raw.githubusercontent.com';
        const fromGitHub = raw.hostname === 'github.com' && path[3] === 'raw';
        // Validate the file path without reconstructing URLs or guessing ref boundaries.
        // GitHub may prefix Raw refs with refs/heads/ or refs/tags/.
        const rawSuffix = path.slice(fromRawHost ? 3 : 4).join('/');
        const matchingFile = rawSuffix === blobSuffix ||
          rawSuffix.replace(/^refs\/(?:heads|tags)\//, '') === blobSuffix;
        if (raw.protocol === 'https:' && !raw.username && !raw.password &&
          matchingRepo && (fromRawHost || fromGitHub) && matchingFile) {
          return raw.href;
        }
      } catch {
        // Ignore a malformed or unrecognized GitHub control.
      }
    }
    return null;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .wt-gh-scroll-top {
        background: var(--button-default-bgColor-rest, var(--color-btn-bg, #f6f8fa));
        color: var(--fgColor-default, var(--color-fg-default, #24292f));
        border: 1px solid var(--button-default-borderColor-rest, var(--color-btn-border, #d0d7de));
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }
      [data-color-mode="dark"] .wt-gh-scroll-top {
        background: var(--button-default-bgColor-rest, var(--color-btn-bg, #21262d));
        color: var(--fgColor-default, var(--color-fg-default, #e6edf3));
        border-color: var(--button-default-borderColor-rest, var(--color-btn-border, #30363d));
      }
      .wt-gh-scroll-top {
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 40px;
        height: 40px;
        font-size: 23px;
        line-height: 1;
        z-index: 20;
        box-shadow: 0 2px 8px rgba(0, 0, 0, .15);
      }
      .wt-gh-scroll-top:hover {
        background: var(--button-default-bgColor-hover, var(--color-btn-hover-bg, #eaeef2));
      }
      [data-color-mode="dark"] .wt-gh-scroll-top:hover {
        background: var(--button-default-bgColor-hover, var(--color-btn-hover-bg, #30363d));
      }
      .wt-gh-scroll-top:focus-visible {
        outline: 2px solid var(--focus-outlineColor, #0969da);
        outline-offset: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureScrollButton() {
    if (document.getElementById(TOP_ID)) return;
    const button = document.createElement('button');
    button.id = TOP_ID;
    button.className = 'wt-gh-scroll-top';
    button.type = 'button';
    button.title = 'Scroll to top';
    button.setAttribute('aria-label', 'Scroll to top');
    button.textContent = '↑';
    button.addEventListener('click', () => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    document.body.appendChild(button);
  }

  function copyRawUrl() {
    // A saved command callback must recheck the current file when invoked.
    const rawUrl = currentRawLink();
    if (!rawUrl) {
      window.alert('未找到当前文件的 Raw 链接，请在文件页面加载完成后重试。');
      return;
    }
    try {
      GM_setClipboard(rawUrl, 'text');
    } catch {
      window.alert('复制 Raw 链接失败，请检查脚本管理器的剪贴板权限。');
    }
  }

  function reconcileMenu() {
    const available = currentRawLink() !== null;
    if (available && menuCommandId === null) {
      menuCommandId = GM_registerMenuCommand(MENU_LABEL, copyRawUrl);
    } else if (!available && menuCommandId !== null) {
      GM_unregisterMenuCommand(menuCommandId);
      menuCommandId = null;
    }
  }

  let scheduled = false;
  function reconcile() {
    ensureStyles();
    ensureScrollButton();
    reconcileMenu();
  }
  function scheduleReconcile() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      reconcile();
    });
  }

  reconcile();
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) {
    document.addEventListener(event, scheduleReconcile);
  }
  window.addEventListener('popstate', scheduleReconcile);

  // GitHub may replace or update its Raw link asynchronously after a soft navigation.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const href = mutation.oldValue || '';
        if (mutation.target.matches(RAW_SELECTOR) || href.includes('/raw/') || href.includes('raw.githubusercontent.com/')) {
          scheduleReconcile();
          return;
        }
        continue;
      }
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (node.nodeType !== 1) continue;
        if (node.matches(RAW_SELECTOR) || node.querySelector(RAW_SELECTOR)) {
          scheduleReconcile();
          return;
        }
      }
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
    attributeOldValue: true,
  });
})();
