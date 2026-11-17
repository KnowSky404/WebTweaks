// ==UserScript==
// @name         GitHub Page Tools
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.4.0
// @description  Scroll to top and copy Raw, Release, or Latest Release asset URLs via GitHub context menus.
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
  const RELEASE_MENU_LABEL = '复制 Release 文件下载链接';
  const LATEST_RELEASE_MENU_LABEL = '复制 Latest Release 下载链接';
  const FILE_SELECTOR = 'a[href*="/blob/"]';
  const RELEASE_SELECTOR = 'a[href*="/releases/download/"], a[href*="/releases/latest/download/"], a[href*="/archive/"]';
  const CONTEXT_MAX_AGE_MS = 60_000;
  const RAW_SELECTOR = 'a[data-testid="raw-button"], a[href*="/raw/"], a[href*="raw.githubusercontent.com/"]';
  let menuCommandId = null;
  let releaseMenuCommandId = null;
  let latestReleaseMenuCommandId = null;
  let lastContext = null;
  let lastReleaseContext = null;
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

  function isReleasePage() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (!repoIdentity() || parts[2] !== 'releases') return false;
    return parts.length === 3 ||
      (parts.length === 4 && parts[3] === 'latest') ||
      (parts.length >= 5 && ['tag', 'expanded_assets'].includes(parts[3]));
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

  function releaseDownloadFromHref(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      url.username || url.password) return null;

    const [, owner, repo, ...route] = url.pathname.split('/');
    if (!sameRepository(owner, repo) || route.some((part) => !part)) return null;

    const asset = route.length === 4 && route[0] === 'releases' &&
      (route[1] === 'download' ||
        (route[1] === 'latest' && route[2] === 'download'));
    const sourceArchive = route.length >= 4 && route[0] === 'archive' &&
      route[1] === 'refs' && route[2] === 'tags' &&
      /\.(?:zip|tar\.gz)$/i.test(route.at(-1));
    if (!asset && !sourceArchive) return null;

    // The native link is the stable GitHub entry point. Do not follow its
    // redirect to a short-lived storage URL or rewrite it as a Raw file URL.
    return url.href;
  }

  function latestReleaseFromHref(href) {
    const trusted = releaseDownloadFromHref(href);
    if (!trusted) return null;

    // The generated source-code ZIP/TAR links are not uploaded release assets.
    const url = new URL(trusted);
    const [, owner, repo, section, segment, next, filename, ...rest] = url.pathname.split('/');
    if (section !== 'releases' || !filename || rest.length ||
      !(segment === 'download' || (segment === 'latest' && next === 'download'))) return null;

    // The "latest" tag in /releases/download/latest/FILE is not the moving alias.
    // Keep only the encoded native asset filename. The version-specific query
    // (possibly containing an auth token) is not valid for the moving alias.
    return {
      url: 'https://github.com/' + owner + '/' + repo + '/releases/latest/download/' + filename,
      filename,
    };
  }

  function releaseFromTarget(target) {
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element?.isConnected) return null;
    const anchor = element.closest('a[href]');
    if (anchor) return releaseDownloadFromHref(anchor.getAttribute('href')) ? anchor : null;

    // A Release asset's icon can sit next to the anchor inside its list item.
    // Never use an entire Assets list when more than one download link exists.
    const row = element.closest('li, [role="listitem"], [data-testid="release-asset"]');
    if (!row) return null;
    const matches = [...row.querySelectorAll(RELEASE_SELECTOR)]
      .filter((link) => releaseDownloadFromHref(link.getAttribute('href')));
    return matches.length === 1 ? matches[0] : null;
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
    lastReleaseContext = null;
    if (isCodePage()) {
      const anchor = fileFromTarget(event.target);
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!rawFromBlobHref(href)) return;
      lastContext = { anchor, href, pageUrl: location.href, at: Date.now() };
      return;
    }
    if (!isReleasePage()) return;
    const anchor = releaseFromTarget(event.target);
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!releaseDownloadFromHref(href)) return;
    lastReleaseContext = { anchor, href, pageUrl: location.href, at: Date.now() };
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

  function copyReleaseUrl() {
    const captured = lastReleaseContext;
    lastReleaseContext = null;
    const downloadUrl = isReleasePage() && captured &&
      captured.pageUrl === location.href &&
      Date.now() - captured.at <= CONTEXT_MAX_AGE_MS &&
      captured.anchor.isConnected &&
      captured.anchor.getAttribute('href') === captured.href
      ? releaseDownloadFromHref(captured.href) : null;
    if (!downloadUrl) {
      window.alert('请在 GitHub Release 页面右键一个附件或源码归档链接后重试。');
      return;
    }
    try {
      GM_setClipboard(downloadUrl, 'text');
    } catch {
      window.alert('复制 Release 下载链接失败，请检查脚本管理器的剪贴板权限。');
    }
  }

  function copyLatestReleaseUrl() {
    const captured = lastReleaseContext;
    lastReleaseContext = null;
    const target = isReleasePage() && captured &&
      captured.pageUrl === location.href &&
      Date.now() - captured.at <= CONTEXT_MAX_AGE_MS &&
      captured.anchor.isConnected &&
      captured.anchor.getAttribute('href') === captured.href
      ? latestReleaseFromHref(captured.href) : null;
    if (!target) {
      window.alert('请右键 Release 上传的附件后重试；源码 ZIP/TAR 归档不支持 Latest 下载链接。');
      return;
    }

    // Versioned asset names are not renamed by GitHub across releases.
    // Confirm rather than falsely suggesting the generated URL is future-proof.
    let filename = target.filename;
    try { filename = decodeURIComponent(filename); } catch { /* Use encoded filename. */ }
    if (/(?:^|[-_.])v?\d+(?:\.\d+){1,3}(?=[-_.]|$)/i.test(filename) &&
      !window.confirm('附件文件名包含版本号（' + filename +
        '）。后续 Release 如果改名，该 Latest 链接会失效。仍要复制吗？')) return;

    try {
      GM_setClipboard(target.url, 'text');
    } catch {
      window.alert('复制 Latest Release 下载链接失败，请检查脚本管理器的剪贴板权限。');
    }
  }

  function reconcileMenu() {
    if (lastPageUrl !== location.href) {
      lastPageUrl = location.href;
      lastContext = null;
      lastReleaseContext = null;
    }
    if (isCodePage() && menuCommandId === null) {
      menuCommandId = GM_registerMenuCommand(MENU_LABEL, copyRawUrl);
    } else if (!isCodePage() && menuCommandId !== null) {
      GM_unregisterMenuCommand(menuCommandId);
      menuCommandId = null;
    }
    if (isReleasePage() && releaseMenuCommandId === null) {
      releaseMenuCommandId = GM_registerMenuCommand(RELEASE_MENU_LABEL, copyReleaseUrl);
    } else if (!isReleasePage() && releaseMenuCommandId !== null) {
      GM_unregisterMenuCommand(releaseMenuCommandId);
      releaseMenuCommandId = null;
    }
    if (isReleasePage() && latestReleaseMenuCommandId === null) {
      latestReleaseMenuCommandId = GM_registerMenuCommand(LATEST_RELEASE_MENU_LABEL, copyLatestReleaseUrl);
    } else if (!isReleasePage() && latestReleaseMenuCommandId !== null) {
      GM_unregisterMenuCommand(latestReleaseMenuCommandId);
      latestReleaseMenuCommandId = null;
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
          mutation.target.matches(RELEASE_SELECTOR) || href.includes('/blob/') ||
          href.includes('/raw/') || href.includes('/releases/download/') || href.includes('/archive/')) {
          scheduleReconcile();
          return;
        }
        continue;
      }
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (node.nodeType !== 1) continue;
        if (node.matches(FILE_SELECTOR) || node.matches(RAW_SELECTOR) || node.matches(RELEASE_SELECTOR) ||
          node.querySelector(FILE_SELECTOR) || node.querySelector(RAW_SELECTOR) || node.querySelector(RELEASE_SELECTOR)) {
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
