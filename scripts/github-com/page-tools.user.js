// ==UserScript==
// @name         GitHub Page Tools
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.0.0
// @description  Scroll to the top and copy the actual Raw URL from a GitHub file page.
// @author       KnowSky404
// @match        https://github.com/*
// @grant        none
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
  const COPY_ID = 'wt-gh-copy-raw-url';
  const RAW_SELECTOR = 'a[data-testid="raw-button"], a[href*="/raw/"], a[href*="raw.githubusercontent.com/"]';

  function isFilePage() {
    return /^\/[^/]+\/[^/]+\/blob\/.+\/.+/.test(location.pathname);
  }

  function currentRawLink() {
    if (!isFilePage()) return null;
    const [, owner, repo] = location.pathname.split('/');

    for (const link of document.querySelectorAll(RAW_SELECTOR)) {
      const label = (link.textContent || '').trim();
      if (link.getAttribute('data-testid') !== 'raw-button' && label !== 'Raw' && link.getAttribute('aria-label') !== 'Raw') {
        continue;
      }

      try {
        const raw = new URL(link.getAttribute('href'), location.href);
        const path = raw.pathname.split('/');
        const matchingRepo = path[1] === owner && path[2] === repo;
        const supportedHost = raw.hostname === 'raw.githubusercontent.com' ||
          (raw.hostname === 'github.com' && path[3] === 'raw');
        if (raw.protocol === 'https:' && !raw.username && !raw.password && matchingRepo && supportedHost) {
          return { link, url: raw.href };
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
      .wt-gh-scroll-top, .wt-gh-copy-raw-url {
        background: var(--button-default-bgColor-rest, var(--color-btn-bg, #f6f8fa));
        color: var(--fgColor-default, var(--color-fg-default, #24292f));
        border: 1px solid var(--button-default-borderColor-rest, var(--color-btn-border, #d0d7de));
        border-radius: 6px;
        cursor: pointer;
        font: inherit;
      }
      [data-color-mode="dark"] .wt-gh-scroll-top,
      [data-color-mode="dark"] .wt-gh-copy-raw-url {
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
      .wt-gh-copy-raw-url {
        margin-inline-start: 8px;
        padding: 4px 9px;
        font-size: 12px;
        line-height: 20px;
        white-space: nowrap;
      }
      .wt-gh-scroll-top:hover, .wt-gh-copy-raw-url:hover {
        background: var(--button-default-bgColor-hover, var(--color-btn-hover-bg, #eaeef2));
      }
      [data-color-mode="dark"] .wt-gh-scroll-top:hover,
      [data-color-mode="dark"] .wt-gh-copy-raw-url:hover {
        background: var(--button-default-bgColor-hover, var(--color-btn-hover-bg, #30363d));
      }
      .wt-gh-scroll-top:focus-visible, .wt-gh-copy-raw-url:focus-visible {
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

  async function copyRawUrl(button) {
    const raw = currentRawLink();
    if (!raw) return;

    try {
      await navigator.clipboard.writeText(raw.url);
      button.textContent = 'Copied!';
    } catch {
      button.textContent = 'Copy failed';
    }
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = 'Copy Raw URL';
    }, 1800);
  }

  function reconcileRawButton() {
    const raw = currentRawLink();
    const existing = document.getElementById(COPY_ID);
    if (!raw) {
      existing?.remove();
      return;
    }
    if (existing?.previousElementSibling === raw.link) return;
    existing?.remove();

    const button = document.createElement('button');
    button.id = COPY_ID;
    button.type = 'button';
    button.className = 'wt-gh-copy-raw-url';
    button.textContent = 'Copy Raw URL';
    button.title = 'Copy the Raw URL of this file';
    button.addEventListener('click', () => copyRawUrl(button));
    raw.link.insertAdjacentElement('afterend', button);
  }

  let scheduled = false;
  function reconcile() {
    ensureStyles();
    ensureScrollButton();
    reconcileRawButton();
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

  // GitHub also renders the file toolbar asynchronously; only react when Raw links appear.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(RAW_SELECTOR) || node.querySelector(RAW_SELECTOR)) {
          scheduleReconcile();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
