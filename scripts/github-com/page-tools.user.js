// ==UserScript==
// @name         GitHub Page Tools
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.2.1
// @description  Scroll to top and copy a right-clicked GitHub file's direct Raw URL.
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
  const MENU_LABEL = '复制右键文件的 Raw 链接';
  const FILE_SELECTOR = 'a[href*="/blob/"]';
  const CONTEXT_MAX_AGE_MS = 60_000;
  const RAW_SELECTOR = 'a[data-testid="raw-button"], a[href*="/raw/"], a[href*="raw.githubusercontent.com/"]';
  let menuCommandId = null;
  let lastContext = null;
  let lastPageUrl = location.href;

  function repoIdentity() {
    const segments = location.pathname.split('/');
    if (segments.length < 3 || !segments[1] || !segments[2]) return null;
    if (['settings', 'features', 'marketplace', 'topics', 'orgs', 'organizations',
      'search', 'notifications', 'login', 'signup', 'explore'].includes(segments[1])) return null;
    return { owner: segments[1], repo: segments[2] };
  }

  function isCodePage() {
    const segments = location.pathname.split('/');
    return repoIdentity() !== null &&
      (segments.length === 3 || (segments.length === 4 && !segments[3]) ||
        (['blob', 'tree'].includes(segments[3]) && segments.length >= 5));
  }

  function isFilePage() {
    return isCodePage() && location.pathname.split('/')[3] === 'blob';
  }

  function sameRepository(owner, repo) {
    const current = repoIdentity();
    return current && owner && repo &&
      owner.toLowerCase() === current.owner.toLowerCase() &&
      repo.toLowerCase() === current.repo.toLowerCase();
  }

  function rawFromBlobHref(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== 'github.com') return null;
    const [, owner, repo, action, ...suffix] = url.pathname.split('/');
    if (!owner || !repo || action !== 'blob' || !sameRepository(owner, repo) ||
      suffix.length < 2 || suffix.some((part) => !part)) return null;
    // Preserve GitHub's complete ref + file suffix. Slash-containing branches
    // and explicit refs/heads/ or refs/tags/ paths must not be guessed apart.
    return 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + suffix.join('/');
  }

  function fileFromTarget(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element?.isConnected) return null;
    const anchor = element.closest('a[href]');
    if (anchor) return rawFromBlobHref(anchor.getAttribute('href')) ? anchor : null;
    // A right-click on a row icon is valid only when that row has one file link.
    const row = element.closest('[role="row"], tr, [data-testid="file-row"]');
    if (!row) return null;
    const matches = [...row.querySelectorAll(FILE_SELECTOR)]
      .filter((link) => rawFromBlobHref(link.getAttribute('href')));
    return matches.length === 1 ? matches[0] : null;
  }

  function rememberContextMenu(event) {
    lastContext = null;
    if (!isCodePage()) return;
    const anchor = fileFromTarget(event.target);
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!rawFromBlobHref(href)) return;
    lastContext = { anchor, href, pageUrl: location.href, at: Date.now() };
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
          // A private file's native Raw URL may contain a temporary auth token.
          // Keep its query while normalizing the direct Raw host; do not log it.
          return 'https://raw.githubusercontent.com/' + path[1] + '/' + path[2] + '/' + rawSuffix + raw.search;
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
    let rawUrl = null;
    const captured = lastContext;
    lastContext = null;
    if (captured && captured.pageUrl === location.href &&
      Date.now() - captured.at <= CONTEXT_MAX_AGE_MS &&
      captured.anchor.isConnected && captured.anchor.getAttribute('href') === captured.href) {
      rawUrl = rawFromBlobHref(captured.href);
    }
    // Keep the v1.1 file-page command usable from the manager toolbar popup.
    if (!rawUrl) rawUrl = currentRawLink();
    if (!rawUrl) {
      window.alert('请在 GitHub 文件列表中右键具体文件后重试，或打开文件详情页。');
      return;
    }
    try {
      GM_setClipboard(rawUrl, 'text');
    } catch {
      window.alert('复制 Raw 链接失败，请检查脚本管理器的剪贴板权限。');
    }
  }

  function reconcileMenu() {
    if (lastPageUrl !== location.href) {
      lastPageUrl = location.href;
      lastContext = null;
    }
    if (isCodePage() && menuCommandId === null) {
      menuCommandId = GM_registerMenuCommand(MENU_LABEL, copyRawUrl);
    } else if (!isCodePage() && menuCommandId !== null) {
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

  // Capture a selected file without preventing GitHub's native right-click menu.
  document.addEventListener('contextmenu', rememberContextMenu, true);
  reconcile();
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) {
    document.addEventListener(event, scheduleReconcile);
  }
  window.addEventListener('popstate', scheduleReconcile);

  // GitHub renders repository file lists and file toolbars asynchronously.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        const href = mutation.oldValue || '';
        if (mutation.target.matches(FILE_SELECTOR) || mutation.target.matches(RAW_SELECTOR) ||
          href.includes('/blob/') || href.includes('/raw/')) {
          scheduleReconcile();
          return;
        }
        continue;
      }
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (node.nodeType !== 1) continue;
        if (node.matches(FILE_SELECTOR) || node.matches(RAW_SELECTOR) ||
          node.querySelector(FILE_SELECTOR) || node.querySelector(RAW_SELECTOR)) {
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
