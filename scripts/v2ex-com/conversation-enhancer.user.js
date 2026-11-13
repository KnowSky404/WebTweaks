// ==UserScript==
// @name         V2EX Conversation Enhancer
// @name:zh-CN   V2EX 会话增强
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.7.0
// @description  Threaded cross-page replies with native thanks/hiding, image previews, unified settings, and always-visible scroll-to-top for V2EX.
// @description:zh-CN 为 V2EX 提供跨页楼中楼、原生感谢与隐藏、图片预览、统一设置和常显返回顶部。
// @author       KnowSky404
// @match        https://v2ex.com/*
// @match        https://*.v2ex.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-idle
// @homepageURL  https://github.com/KnowSky404/WebTweaks/tree/main/scripts/v2ex-com
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js
// ==/UserScript==

(() => {
  'use strict';

  const LOG_PREFIX = '[WebTweaks:V2EX]';
  const SETTINGS_VERSION = 3;
  const SETTINGS_KEY = 'wt-v2ex-settings';
  const MAX_PAGE_REQUESTS = 3;
  const PAGE_TIMEOUT_MS = 12_000;
  const THANK_TIMEOUT_MS = 12_000;
  const IMAGE_CONTENT_SELECTOR = '.topic_content, .reply_content';
  const IMAGE_EXTENSION_PATTERN = /\.(?:jpe?g|png|gif|webp|avif)$/i;
  const IMAGE_URL_TOKEN_PATTERN = /https?:\/\/[^\s<>"']+/gi;
  const SETTING_KEYS = new Set([
    'version',
    'preferredView',
    'scrollTopEnabled',
    'imagePreviewEnabled',
    'imageLightboxEnabled'
  ]);

  // Flex headers verified against public V2EX HTML on 2026-11-13; retain legacy headers.
  const SELECTORS = Object.freeze({
    reply: ['#Main .cell[id^="r_"]', '#Wrapper .cell[id^="r_"]', '.cell[id^="r_"]'],
    replyContent: ['.reply_content'],
    replyAuthor: ['strong a.dark', 'strong a[href^="/member/"]'],
    replyAvatar: ['img.avatar'],
    replyFloor: ['.no'],
    replyTime: ['.ago'],
    replyThanks: ['.small.fade img[alt="❤️"]'],
    pagination: ['.ps_container a[href*="?p="]', '.ps_container a[href*="&p="]'],
    pageInput: ['.ps_container input.page_input'],
    editor: ['#reply_content', '#topic_content', 'textarea[name="content"]'],
    nativeReplyAction: ['a.reply', '.reply a', '[data-action="reply"]']
  });

  const runtime = {
    settings: loadSettings(),
    topic: null,
    waitingReplyObserver: null,
    controlDock: null,
    settingsToggle: null,
    settingsPanel: null,
    panelDismissalAttached: false,
    scrollButton: null,
    navigationAttached: false,
    navigationSchedule: 0,
    navigationSync: false,
    navigationRevision: 0,
    observedTopicKey: null,
    thanksRequest: null,
    thanksResults: new Map(),
    ignoredReplies: new Set(),
    thanksBlockedTokens: new Set(),
    imageDelegationAttached: false,
    imageLightbox: null,
    imageLightboxImage: null,
    imageLightboxLink: null,
    imageLightboxClose: null,
    imageLightboxOpener: null,
    imageLightboxFocusFrame: 0,
    imageScrollLock: null
  };

  function logError(error) {
    if (error && error.name === 'AbortError') return;
    console.error(LOG_PREFIX, error instanceof Error ? error.message : error);
  }

  function safeGet(key, fallback) {
    try {
      return typeof GM_getValue === 'function' ? GM_getValue(key, fallback) : fallback;
    } catch (error) {
      logError(error);
      return fallback;
    }
  }

  function safeSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (error) {
      logError(error);
    }
  }

  function loadSettings() {
    const stored = safeGet(SETTINGS_KEY, {});
    const value = stored && typeof stored === 'object' ? stored : {};
    const settings = {
      version: SETTINGS_VERSION,
      preferredView: value.preferredView === 'original' ? 'original' : 'threaded',
      scrollTopEnabled: value.scrollTopEnabled !== false,
      imagePreviewEnabled: value.imagePreviewEnabled !== false,
      imageLightboxEnabled: value.imageLightboxEnabled !== false
    };
    if (value.version !== SETTINGS_VERSION || Object.keys(value).some((key) => !SETTING_KEYS.has(key))) {
      safeSet(SETTINGS_KEY, settings);
    }
    return settings;
  }

  function saveSettings() {
    safeSet(SETTINGS_KEY, { ...runtime.settings, version: SETTINGS_VERSION });
  }

  function setFeatureSetting(key, enabled) {
    runtime.settings[key] = enabled;
    saveSettings();
    if (key === 'imagePreviewEnabled') {
      if (enabled) scanImageContent(document);
      else {
        if (runtime.imageLightboxOpener?.classList.contains('wt-v2ex-inline-image')) closeImageLightbox();
        resetImagePreviews(document);
      }
    } else if (key === 'imageLightboxEnabled') {
      if (enabled) scanImageContent(document);
      else { closeImageLightbox(); resetLightboxTargets(document); }
    } else if (key === 'scrollTopEnabled') {
      if (enabled) initializeScrollToTop();
      updateScrollButton();
    }
  }

  function firstMatch(root, selectors) {
    for (const selector of selectors) {
      const match = root.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  function allMatches(root, selectors) {
    const seen = new Set();
    const matches = [];
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((element) => {
        if (!seen.has(element)) {
          seen.add(element);
          matches.push(element);
        }
      });
    }
    return matches;
  }

  function topicContext() {
    const match = location.pathname.match(/^\/t\/(\d+)\/?$/);
    if (!match) return null;
    const rawPage = new URL(location.href).searchParams.get('p');
    const parsedPage = Number.parseInt(rawPage || '1', 10);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    return { id: match[1], page, key: `${location.origin}/t/${match[1]}?p=${page}` };
  }

  function topicSnapshotMatches(topic, context, navigationRevision = runtime.navigationRevision) {
    return Boolean(
      topic
      && context
      && topic.navigationRevision === navigationRevision
      && context.key === topic.key
      && context.page === topic.currentPage
    );
  }

  function isCurrentTopic(topic, context = topicContext()) {
    return runtime.topic === topic && topicSnapshotMatches(topic, context);
  }

  function topicDomMatchesContext(context) {
    if (!context || !allMatches(document, SELECTORS.reply).length) return false;
    const currentPage = firstMatch(document, ['.ps_container .page_current']);
    if (!currentPage) return true;
    return parseFloor(currentPage.textContent) === context.page;
  }

  function waitForTopicDom(context, timeoutMs = 2_000) {
    if (topicDomMatchesContext(context)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(ready);
      };
      const check = () => {
        const liveContext = topicContext();
        if (liveContext?.key !== context.key) finish(false);
        else if (topicDomMatchesContext(context)) finish(true);
      };
      const observer = new MutationObserver(check);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      const timer = window.setTimeout(() => finish(false), timeoutMs);
      check();
    });
  }

  function topicStateMatchesLocation(context = topicContext()) {
    return runtime.topic ? isCurrentTopic(runtime.topic, context) : !context;
  }

  function discoverPages(context) {
    const pageNumbers = new Set([context.page]);
    const links = allMatches(document, SELECTORS.pagination);
    links.forEach((link) => {
      const page = Number(new URL(link.href, location.href).searchParams.get('p'));
      if (Number.isInteger(page) && page > 0) pageNumbers.add(page);
    });
    const pageInput = firstMatch(document, SELECTORS.pageInput);
    const inputMax = Number(pageInput?.max);
    if (Number.isInteger(inputMax) && inputMax > 0) pageNumbers.add(inputMax);
    const pages = [...pageNumbers].sort((a, b) => a - b);
    return { pages, maxPage: Math.max(...pages) };
  }

  function pageUrl(context, page) {
    const url = new URL(location.href);
    url.pathname = `/t/${context.id}`;
    url.search = page === 1 ? '' : `?p=${page}`;
    url.hash = '';
    return url.href;
  }

  function normalizeName(value) {
    return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
  }

  function parseFloor(value) {
    const match = String(value || '').match(/\d+/);
    const floor = match ? Number(match[0]) : NaN;
    return Number.isInteger(floor) && floor > 0 ? floor : null;
  }

  function parseLeadingPrefix(content) {
    const text = (content.textContent || '').replace(/\u00a0/g, ' ');
    let rest = text.replace(/^\s+/, '');
    const mentions = [];
    let explicitReplyFloor = null;
    const memberLinks = [...content.querySelectorAll('a[href^="/member/"]')];
    let memberIndex = 0;
    while (rest.startsWith('@')) {
      const match = rest.match(/^@([^\s#@]+)(?:\s+#(\d+))?/);
      if (!match) break;
      const name = match[1];
      const linked = memberLinks[memberIndex];
      if (linked && normalizeName(linked.textContent) !== normalizeName(name)) break;
      mentions.push({ name, normalized: normalizeName(name) });
      memberIndex += 1;
      explicitReplyFloor = match[2] ? Number(match[2]) : null;
      rest = rest.slice(match[0].length).replace(/^\s+/, '');
      if (!rest.startsWith('@')) break;
    }
    return {
      mentionedUsers: mentions.map((mention) => mention.name),
      normalizedMentions: mentions,
      explicitReplyFloor: mentions.length === 1 ? explicitReplyFloor : null,
      hasMultipleStructuralMentions: mentions.length > 1,
      hasStructuralMention: mentions.length > 0
    };
  }

  function safeUrl(raw, kind, base = location.href) {
    if (!raw) return null;
    try {
      const url = new URL(raw, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (kind === 'image' && !['http:', 'https:'].includes(url.protocol)) return null;
      return url.href;
    } catch (error) {
      return null;
    }
  }

  function imagePreviewUrl(raw, base = location.href) {
    const safe = safeUrl(raw, 'image', base);
    if (!safe) return null;
    try {
      const url = new URL(safe);
      return IMAGE_EXTENSION_PATTERN.test(url.pathname) ? url.href : null;
    } catch (error) {
      return null;
    }
  }

  function imageUrlsInText(value, base = location.href) {
    const urls = [];
    const seen = new Set();
    for (const match of String(value || '').matchAll(IMAGE_URL_TOKEN_PATTERN)) {
      const candidate = match[0].replace(/[)\]},.;!?，。；！？]+$/u, '');
      const url = imagePreviewUrl(candidate, base);
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    return urls;
  }

  function sanitizeContent(element, base = location.href) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, form, object, embed, template, base, meta, link, input, select, textarea, button').forEach((node) => node.remove());
    clone.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || name === 'id' || name === 'srcset' || name === 'srcdoc' || name === 'style') node.removeAttribute(attribute.name);
        if ((name === 'href' || name === 'src' || name === 'action') && !safeUrl(value, name === 'src' ? 'image' : 'link', base)) {
          node.removeAttribute(attribute.name);
        }
        if (name === 'href' || name === 'src') {
          const safe = safeUrl(value, name === 'src' ? 'image' : 'link', base);
          if (safe) node.setAttribute(name, safe);
        }
      });
      if (node.matches('a')) {
        const href = safeUrl(node.getAttribute('href'), 'link', base);
        if (!href) node.removeAttribute('href');
        else if (new URL(href).origin !== location.origin) node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.matches('img')) {
        const src = safeUrl(node.getAttribute('src'), 'image', base);
        if (!src) node.remove();
        else {
          node.setAttribute('src', src);
          node.setAttribute('loading', 'lazy');
        }
      }
    });
    return clone.innerHTML;
  }

  function sanitizeReplyTemplate(element, base = location.href) {
    const clone = element.cloneNode(true);
    // Keep the native header positions while extracting controls separately.
    const replyId = String(clone.id || '').match(/^r_([1-9]\d*)$/)?.[1] || '';
    const { image } = nativeReplyThanksNodes(clone, replyId);
    if (image) {
      const slot = document.createElement('span');
      slot.className = 'wt-v2ex-native-thank-count-slot';
      image.parentElement.replaceWith(slot);
    }
    const group = nativeReplyGroup(clone);
    if (group) {
      const slot = document.createElement('span');
      slot.className = 'wt-v2ex-native-reply-slot';
      group.replaceWith(slot);
    }
    clone.removeAttribute('id');
    clone.querySelectorAll('script, style, iframe, form, object, embed, template, base, meta, link, input, select, textarea, button, [data-action], a.reply, .reply a, .thank, .thank_area, .thanked, [id^="thank_area_"], .ignore, .moderate').forEach((node) => node.remove());
    clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    clone.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || name === 'srcset' || name === 'srcdoc' || name === 'style' || name === 'formaction') {
          node.removeAttribute(attribute.name);
          return;
        }
        if (name === 'href' || name === 'src') {
          const safe = safeUrl(value, name === 'src' ? 'image' : 'link', base);
          if (!safe) node.removeAttribute(attribute.name);
          else node.setAttribute(name, safe);
        }
      });
      if (node.matches('a')) {
        const href = safeUrl(node.getAttribute('href'), 'link', base);
        if (!href) node.removeAttribute('href');
        else if (new URL(href).origin !== location.origin) node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.matches('img')) {
        const src = safeUrl(node.getAttribute('src'), 'image', base);
        if (!src) node.remove();
        else node.setAttribute('loading', 'lazy');
      }
    });
    return clone;
  }

  function nativeReplyImage(group) {
    return [...group.querySelectorAll('img')].find((image) => {
      const alt = (image.getAttribute('alt') || '').trim().toLocaleLowerCase();
      const rawSrc = image.getAttribute('src') || '';
      try {
        const url = new URL(rawSrc, location.href);
        const filename = url.pathname.split('/').pop() || '';
        return isV2exAssetUrl(url) && (alt === 'reply' || /^reply(?:[._-]|$)/i.test(filename));
      } catch (error) {
        return false;
      }
    });
  }

  function isV2exAssetUrl(raw, base = location.href) {
    try {
      const url = raw instanceof URL ? raw : new URL(raw, base);
      return url.hostname === 'v2ex.com' || url.hostname.endsWith('.v2ex.com');
    } catch (error) {
      return false;
    }
  }

  function hasNativeReplyHandler(element) {
    return [...element.attributes].some((attribute) => {
      if (!attribute.name.toLowerCase().startsWith('on') && attribute.name.toLowerCase() !== 'href') return false;
      return /(?:replyOne|reply(?:Action|Reply))\s*\(/i.test(attribute.value);
    });
  }

  function nativeReplyAction(group) {
    const image = nativeReplyImage(group);
    if (image) {
      const clickable = image.closest('a, button, [role="button"]');
      if (clickable && group.contains(clickable)) return clickable;
    }
    for (const selector of SELECTORS.nativeReplyAction) {
      const match = group.querySelector(selector);
      if (match) return match.closest('a, button, [role="button"]') || match;
    }
    return [...group.querySelectorAll('a, button, [role="button"]')].find(hasNativeReplyHandler) || null;
  }

  function nativeReplyHeader(root) {
    const content = firstMatch(root, SELECTORS.replyContent);
    const container = content?.closest('td') || content?.parentElement;
    if (!container) return null;
    return [...container.children].find((node) => node.matches('.flex-one-row')
      && node.querySelector('strong a[href^="/member/"]') && node.querySelector('.ago')) || container;
  }

  function nativeReplyGroup(root) {
    const header = nativeReplyHeader(root);
    if (!header) return null;
    const groups = [...header.querySelectorAll('.flex-one-row, .fr')]
      .filter((node) => !node.closest('.reply_content') && !node.querySelector('strong'));
    return groups.find((group) => nativeReplyAction(group))
      || groups.find((group) => group.querySelector('.no')) || null;
  }

  function sanitizeNativeControlNode(node, base, restrictImages = false) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script, style, iframe, object, embed, form, input, select, textarea, template, base, meta, link').forEach((unsafeNode) => unsafeNode.remove());
    const nodes = [clone, ...clone.querySelectorAll('*')];
    nodes.forEach((current) => {
      [...current.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith('on') || name === 'id' || name === 'srcset' || name === 'srcdoc' || name === 'data-action' || name === 'formaction') {
          current.removeAttribute(attribute.name);
          return;
        }
        if (name === 'href' || name === 'src') {
          if (!safeUrl(value, name === 'src' ? 'image' : 'link', base) || (restrictImages && name === 'src' && current.matches('img') && !isV2exAssetUrl(value, base))) current.removeAttribute(attribute.name);
          else current.setAttribute(name, value);
        }
      });
    });
    return clone;
  }

  function nativeIgnoreControl(root, replyId) {
    if (!root || !/^[1-9]\d*$/.test(replyId)) return null;
    for (const action of root.querySelectorAll('a, button, [role="button"]')) {
      if (action.closest('.reply_content')) continue;
      for (const name of ['onclick', 'href']) {
        const match = (action.getAttribute(name) || '').match(/(?:^|[^\w$.])ignoreReply\s*\(\s*(['"]?)([1-9]\d*)\1\s*,\s*(?:'([\w-]+)'|"([\w-]+)"|(\d+))\s*\)/);
        if (match?.[2] === replyId) return { action, token: match[3] || match[4] || match[5] };
      }
    }
    return null;
  }

  function ignoreSession() {
    try { return typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.ignoreReply === 'function' ? unsafeWindow : null; }
    catch (error) { return null; }
  }

  function prepareIgnoreControl(action) {
    action.classList.add('wt-v2ex-ignore-action');
    action.setAttribute('role', 'button');
    action.setAttribute('tabindex', '0');
    if (action.matches('a')) action.setAttribute('href', '#');
    if (action.matches('button')) action.setAttribute('type', 'button');
  }

  function extractNativeReplyControls(element, base = location.href) {
    const group = nativeReplyGroup(element);
    if (!group) return null;
    const controls = group.cloneNode(true);
    let action = nativeReplyAction(controls);
    const floor = controls.querySelector('.no');
    const replyId = String(element.id || '').match(/^r_([1-9]\d*)$/)?.[1];
    const area = replyId ? controls.querySelector('[id="thank_area_' + replyId + '"]') : null;
    const ignore = nativeIgnoreControl(controls, replyId)?.action;
    if (ignore && !area?.contains(ignore)) prepareIgnoreControl(ignore);
    const thanksSlot = area ? document.createElement('span') : null;
    if (thanksSlot) {
      thanksSlot.className = 'wt-v2ex-native-thank-area-slot';
      area.replaceWith(thanksSlot);
    }
    controls.classList.add('wt-v2ex-native-reply-controls');
    if (action) {
      const actionClone = sanitizeNativeControlNode(action, base, true);
      actionClone.classList.add('wt-v2ex-native-reply-action');
      actionClone.dataset.wtV2exNativeReplyAction = 'true';
      if (actionClone.matches('a')) actionClone.setAttribute('href', '#');
      if (actionClone.matches('button')) actionClone.setAttribute('type', 'button');
      actionClone.setAttribute('role', 'button');
      if (!actionClone.hasAttribute('tabindex')) actionClone.setAttribute('tabindex', '0');
      action.replaceWith(actionClone);
      action = actionClone;
    }
    // Retain source spacing/wrappers only around the recognized controls.
    const retained = [action, floor, thanksSlot, ignore && controls.contains(ignore) ? ignore : null].filter(Boolean);
    [...controls.querySelectorAll('*')].reverse().forEach((node) => {
      if (!retained.some((control) => control === node || control.contains(node) || node.contains(control))) node.remove();
    });
    return retained.length ? sanitizeNativeControlNode(controls, base, true) : null;
  }

  function nativeReplyThanksNodes(element, replyId) {
    const inHeader = (node) => !node.closest('.reply_content')
      && node.closest('.cell[id^="r_"]') === element;
    const image = allMatches(element, SELECTORS.replyThanks).find(inHeader);
    const area = /^[1-9]\d*$/.test(replyId)
      ? [...element.querySelectorAll('[id]')].find((node) => node.id === 'thank_area_' + replyId && inHeader(node))
      : null;
    const action = area && [...area.querySelectorAll('a, button, [role="button"]')].find((node) => {
      if (!inHeader(node)) return false;
      return ['onclick', 'href'].some((name) => {
        const match = (node.getAttribute(name) || '').match(/(?:^|[^\w$.])thankReply\s*\(\s*(['"]?)([1-9]\d*)\1\s*\)/);
        return match?.[2] === replyId;
      });
    });
    return { image, area, action };
  }

  // Capability comes from this reply's own header, never from a reusable template.
  function readReplyThanks(element, replyId) {
    const { image, area, action } = nativeReplyThanksNodes(element, replyId);
    const rawCount = image?.parentElement?.textContent.trim() || '';
    const count = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(rawCount) ? Number(rawCount.replaceAll(',', '')) : NaN;
    const thanked = Boolean(area?.classList.contains('thanked'));
    return {
      count: Number.isSafeInteger(count) && count >= 0 ? count : null,
      canThank: Boolean(action) && !thanked,
      thanked,
      nativeKnown: Boolean(area),
      phase: 'idle',
      message: ''
    };
  }

  function extractNativeThanksPresentation(element, replyId, base = location.href) {
    const { image, area, action } = nativeReplyThanksNodes(element, replyId);
    const areaClone = area?.cloneNode(true);
    const ignore = nativeIgnoreControl(areaClone, replyId)?.action;
    if (ignore) prepareIgnoreControl(ignore);
    const thank = action && [...areaClone.querySelectorAll('a, button, [role="button"]')].find((node) =>
      node.getAttribute('onclick') === action.getAttribute('onclick') && node.getAttribute('href') === action.getAttribute('href'));
    thank?.classList.add('wt-v2ex-native-thanks-slot');
    areaClone?.querySelectorAll('a, button, [role="button"]').forEach((node) => {
      if (node !== ignore && node !== thank) node.remove();
    });
    return {
      count: image ? sanitizeNativeControlNode(image.parentElement, base, true) : null,
      area: areaClone ? sanitizeNativeControlNode(areaClone, base, true) : null,
      action: action ? sanitizeNativeControlNode(action, base, true) : null
    };
  }

  function thanksKey(topic, reply) {
    return location.origin + '/t/' + topic.context.id + '/reply/' + reply.id;
  }

  function rememberThanks(topic, reply, state) {
    const previous = runtime.thanksResults.get(thanksKey(topic, reply));
    if (previous?.state === 'thanked' && state !== 'thanked') return;
    runtime.thanksResults.set(thanksKey(topic, reply), {
      state, count: reply.thanks.count,
      countTemplate: reply.nativeThanksPresentation?.count || previous?.countTemplate || null
    });
  }

  function reconcileThanks(topic, reply) {
    const state = reply.thanks;
    if (!state) return;
    const result = runtime.thanksResults.get(thanksKey(topic, reply));
    if (!result) return;
    if (reply.nativeThanksPresentation && !reply.nativeThanksPresentation.count && result.countTemplate) {
      reply.nativeThanksPresentation.count = result.countTemplate;
    }
    if (result.count !== null) state.count = Math.max(state.count ?? 0, result.count);
    if (result.state === 'thanked') {
      state.thanked = true;
      state.canThank = false;
      state.phase = 'idle';
    } else if (!state.thanked && state.phase !== 'checking') {
      state.phase = result.state === 'pending' && runtime.thanksRequest?.topic === topic ? 'pending' : 'unknown';
    }
    reply.thankCount = state.count;
  }

  function validThanksToken(value) {
    return (typeof value === 'string' || typeof value === 'number') && /^[0-9]+$/.test(String(value));
  }

  function thanksSession() {
    try {
      if (typeof unsafeWindow === 'undefined' || typeof unsafeWindow.thankReply !== 'function') return null;
      const token = unsafeWindow.once;
      if (!validThanksToken(token) || runtime.thanksBlockedTokens.has(String(token))) return null;
      return { page: unsafeWindow, token };
    } catch (error) {
      return null;
    }
  }

  function nativeThanksReply(topic, reply) {
    return topic.nativeReplies.find((cell) => cell.id === 'r_' + reply.id && cell.isConnected) || null;
  }

  function thanksSourceUrl(topic, reply) {
    const url = new URL(pageUrl(topic.context, reply.page));
    url.hash = 'wt-v2ex-thank-' + reply.id;
    return url.href;
  }

  function updateThanksControl(topic, reply, control) {
    if (!['.wt-v2ex-thank-count', '.wt-v2ex-thank-area', '.wt-v2ex-thank-action', '.wt-v2ex-thank-check', '.wt-v2ex-thank-source', '.wt-v2ex-thank-status']
      .every((selector) => control.querySelector(selector))) return;
    reconcileThanks(topic, reply);
    const state = reply.thanks;
    const uncertain = state.phase === 'unknown' || state.phase === 'checking';
    const direct = reply.page === topic.currentPage && state.canThank && Boolean(reply.nativeThanksPresentation?.action) && Boolean(thanksSession());
    let count = control.querySelector('.wt-v2ex-thank-count');
    const template = reply.nativeThanksPresentation?.count;
    if (!count.querySelector('img') && template) {
      const replacement = template.cloneNode(true);
      replacement.classList.add('wt-v2ex-thank-count');
      count.replaceWith(replacement);
      count = replacement;
    }
    count.hidden = state.count === null || !count.querySelector('img');
    if (!count.hidden && Number(count.textContent.trim().replaceAll(',', '')) !== state.count) {
      const walker = document.createTreeWalker(count, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (/^\s*[\d,]+\s*$/.test(text.data)) {
          text.data = text.data.replace(/[\d,]+/, String(state.count));
          break;
        }
      }
    }
    count.setAttribute('aria-label', '收到 ' + (state.count ?? '未知数量的') + ' 次感谢');
    const action = control.querySelector('.wt-v2ex-thank-action');
    action.hidden = !direct || state.thanked || uncertain;
    action.disabled = Boolean(runtime.thanksRequest) || state.phase === 'pending';
    action.setAttribute('aria-disabled', String(action.disabled));
    action.setAttribute('aria-label', '感谢 ' + (reply.author || '该用户') + ' 的第 ' + (reply.floor || '') + ' 楼回复，消耗 10 铜币');
    const check = control.querySelector('.wt-v2ex-thank-check');
    check.hidden = !uncertain || state.thanked;
    check.disabled = state.phase === 'checking' || Boolean(runtime.thanksRequest);
    check.setAttribute('aria-disabled', String(check.disabled));
    const source = control.querySelector('.wt-v2ex-thank-source');
    source.hidden = state.thanked || state.phase === 'pending' || (!uncertain && (!state.canThank || direct));
    source.href = thanksSourceUrl(topic, reply);
    source.textContent = uncertain ? '到原页核对' : '到原页感谢';
    const recovery = control.querySelector('.wt-v2ex-thank-recovery');
    if (recovery) recovery.hidden = check.hidden && source.hidden;
    const status = control.querySelector('.wt-v2ex-thank-status');
    status.textContent = state.thanked ? ''
      : state.phase === 'pending' ? '发送中…'
      : state.phase === 'checking' ? '正在核对…'
      : state.phase === 'unknown' ? state.message || '结果未确认，请核对状态'
      : state.message;
    if (status.textContent && !state.thanked && (!action.hidden || !check.hidden || !source.hidden)) {
      status.textContent = ' ' + status.textContent;
    }
    status.hidden = !status.textContent;
    const area = control.querySelector('.wt-v2ex-thank-area');
    area.classList.toggle('thanked', state.thanked);
    const completed = area.querySelector('.wt-v2ex-thank-completed');
    completed.hidden = !state.thanked;
    area.hidden = action.hidden && !state.thanked && !area.querySelector('.wt-v2ex-ignore-action:not([hidden])');
    area.tabIndex = area.hidden || state.thanked ? -1 : 0;
  }

  function createThanksControl(topic, reply, header, controls) {
    if (!reply.thanks) return null;
    reconcileThanks(topic, reply);
    if (reply.thanks.count === null && !reply.thanks.canThank && !reply.thanks.thanked
      && reply.thanks.phase === 'idle' && !reply.thanks.message
      && !reply.nativeThanksPresentation?.area?.querySelector('.wt-v2ex-ignore-action')) return null;
    const presentation = reply.nativeThanksPresentation;
    const count = presentation?.count?.cloneNode(true) || document.createElement('span');
    count.classList.add('wt-v2ex-thank-count');
    const countSlot = header.querySelector('.wt-v2ex-native-thank-count-slot');
    if (countSlot) countSlot.replaceWith(count);
    else {
      const time = header.querySelector('.ago');
      if (time?.closest('.flex-one-row')) time.after(count);
      else header.append(count);
    }

    const area = presentation?.area?.cloneNode(true) || document.createElement('span');
    area.classList.add('wt-v2ex-thank-area');
    const completed = document.createElement('span');
    completed.className = 'wt-v2ex-thank-completed';
    if (presentation?.area?.classList.contains('thanked')) completed.append(...area.childNodes);
    else completed.textContent = '感谢已发送'; // Native thankReply success text, verified in V2EX's JS.
    const action = presentation?.action?.cloneNode(true) || document.createElement('span');
    action.classList.add('wt-v2ex-thank-action');
    if (action.matches('a')) action.setAttribute('href', '#');
    if (action.matches('button')) action.setAttribute('type', 'button');
    if (presentation?.action) {
      action.setAttribute('role', 'button');
      if (!action.hasAttribute('tabindex')) action.setAttribute('tabindex', '0');
    }
    const check = document.createElement('a');
    check.className = 'wt-v2ex-thank-check';
    check.href = '#';
    check.setAttribute('role', 'button');
    check.textContent = '核对状态';
    const source = document.createElement('a');
    source.className = 'wt-v2ex-thank-source';
    const status = document.createElement('span');
    status.className = 'wt-v2ex-thank-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    [action, check, source].forEach((node) => { node.dataset.replyId = reply.id; });
    // Hidden fallback controls must not add whitespace to the native action.
    const recovery = document.createElement('span');
    recovery.className = 'wt-v2ex-thank-recovery';
    recovery.append(check, ' ', source);
    const thankSlot = area.querySelector('.wt-v2ex-native-thanks-slot');
    if (presentation?.area?.classList.contains('thanked')) area.replaceChildren(action, completed);
    else if (thankSlot) thankSlot.replaceWith(action, completed);
    else area.append(action, completed);
    const areaSlot = controls?.querySelector('.wt-v2ex-native-thank-area-slot');
    if (areaSlot) areaSlot.replaceWith(area);
    else header.append(area);
    header.append(recovery, status);
    header.classList.add('wt-v2ex-thanks');
    // Both native positions stay under the same trusted, per-reply header.
    topic.thanksControls.set(header, reply.id);
    updateThanksControl(topic, reply, header);
    return header;
  }

  function updateThanksViews(topic) {
    if (!isCurrentTopic(topic)) return;
    const byId = new Map(topic.allReplies.map((reply) => [reply.id, reply]));
    topic.thanksControls?.forEach((replyId, control) => {
      if (!topic.threadedView.contains(control) || control.closest('.reply_content')) return;
      const reply = byId.get(replyId);
      if (reply?.thanks) updateThanksControl(topic, reply, control);
    });
  }

  function markNativeThanked(topic, reply) {
    const cell = nativeThanksReply(topic, reply);
    const area = cell && [...cell.querySelectorAll('[id]')].find((node) => node.id === 'thank_area_' + reply.id
      && !node.closest('.reply_content') && node.closest('.cell[id^="r_"]') === cell);
    if (area && !area.classList.contains('thanked')) {
      area.classList.add('thanked');
      area.textContent = '感谢已发送';
    }
  }

  async function refreshReplyThanks(topic, reply, checking = false) {
    if (!isCurrentTopic(topic) || !/^[1-9]\d*$/.test(reply.id)) return;
    const state = reply.thanks;
    if (checking) { state.phase = 'checking'; updateThanksViews(topic); }
    const controller = new AbortController();
    topic.thanksReads.add(controller);
    const timer = window.setTimeout(() => controller.abort(), THANK_TIMEOUT_MS);
    try {
      const url = pageUrl(topic.context, reply.page);
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const finalUrl = new URL(response.url || url);
      if (!response.ok || finalUrl.origin !== location.origin || finalUrl.pathname !== '/t/' + topic.context.id
        || Number(finalUrl.searchParams.get('p') || 1) !== reply.page) throw new Error('无法核对原页');
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (!isCurrentTopic(topic)) return;
      const marker = parsed.querySelector('.ps_container .page_current');
      if ((marker && parseFloor(marker.textContent) !== reply.page) || (!marker && reply.page !== 1)) throw new Error('分页不匹配');
      const cell = allMatches(parsed, SELECTORS.reply).find((node) => node.id === 'r_' + reply.id);
      if (!cell) throw new Error('原页未找到该回复');
      const snapshot = readReplyThanks(cell, reply.id);
      if (snapshot.count !== null) state.count = Math.max(state.count ?? 0, snapshot.count);
      if (snapshot.count !== null && reply.nativeThanksPresentation && !reply.nativeThanksPresentation.count) {
        reply.nativeThanksPresentation.count = extractNativeThanksPresentation(cell, reply.id, url).count;
      }
      if (snapshot.thanked) {
        state.thanked = true;
        state.canThank = false;
        state.phase = 'idle';
        state.message = '';
        rememberThanks(topic, reply, 'thanked');
        markNativeThanked(topic, reply);
      } else if (checking) {
        // A GET can race a delayed POST. Absence of .thanked never licenses a retry.
        state.phase = 'unknown';
        state.message = '原页尚未确认，请稍后核对或打开原页';
      }
      if (state.thanked) rememberThanks(topic, reply, 'thanked');
      reply.thankCount = state.count;
    } catch (error) {
      if (checking && isCurrentTopic(topic)) {
        state.phase = 'unknown';
        state.message = '暂时无法核对，请稍后重试核对';
      }
    } finally {
      window.clearTimeout(timer);
      topic.thanksReads.delete(controller);
      updateThanksViews(topic);
    }
  }

  function synchronizeNativeThanks(topic) {
    if (!isCurrentTopic(topic)) return;
    topic.allReplies.forEach((reply) => {
      if (!reply.thanks || reply.page !== topic.currentPage) return;
      const cell = nativeThanksReply(topic, reply);
      if (!cell) return;
      const snapshot = readReplyThanks(cell, reply.id);
      const becameThanked = snapshot.thanked && !reply.thanks.thanked;
      reply.thanks.canThank = snapshot.canThank && !reply.thanks.thanked;
      if (snapshot.count !== null) reply.thanks.count = Math.max(reply.thanks.count ?? 0, snapshot.count);
      if (snapshot.thanked) {
        reply.thanks.thanked = true;
        reply.thanks.phase = 'idle';
        rememberThanks(topic, reply, 'thanked');
        if (becameThanked) void refreshReplyThanks(topic, reply);
      }
    });
    updateIgnoreControls(topic);
    updateThanksViews(topic);
  }

  function attachThanksObserver(topic) {
    topic.thanksReads ||= new Set();
    topic.thanksObserver?.disconnect();
    if (typeof MutationObserver !== 'function') return;
    topic.thanksObserver = new MutationObserver(() => synchronizeNativeThanks(topic));
    topic.nativeReplies.forEach((cell) => {
      const id = cell.id.match(/^r_([1-9]\d*)$/)?.[1];
      if (!id) return;
      cell.querySelectorAll('[id]').forEach((area) => {
        if (area.id === 'thank_area_' + id && !area.closest('.reply_content')
          && area.closest('.cell[id^="r_"]') === cell) {
          topic.thanksObserver.observe(area, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
        }
      });
    });
  }

  function attachReplyObserver(topic) {
    const root = topic.nativeReplies[0]?.closest('#topic-replies') || topic.nativeReplies[0]?.parentElement;
    if (!root || typeof MutationObserver !== 'function') return;
    topic.replyObserver = new MutationObserver((records) => {
      if (!isCurrentTopic(topic)) return;
      const changed = records.some((record) => {
        if (record.target.closest?.('.wt-v2ex-threaded-view')) return false;
        return [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === 1
          && (node.matches('.cell[id^="r_"], .wt-v2ex-threaded-view') || node.querySelector('.cell[id^="r_"]')))
          || record.target.closest?.('.cell[id^="r_"]');
      });
      if (!changed) return;
      if (!topic.threadedView.isConnected || topic.nativeReplies.some((cell) => !cell.isConnected)) {
        scheduleTopicSynchronization();
        return;
      }
      const cells = allMatches(root, SELECTORS.reply).filter((cell) => !cell.closest('.wt-v2ex-threaded-view'));
      const known = new Set(topic.nativeReplies.map((cell) => cell.id));
      const added = cells.filter((cell) => !known.has(cell.id))
        .map((cell, index) => ({ cell, reply: parseReply(cell, topic.currentPage, index) }))
        .filter(({ reply }) => reply);
      if (!added.length) return;
      const models = new Map(topic.allReplies.map((reply) => [reply.id, reply]));
      added.forEach(({ cell, reply }) => { topic.nativeReplies.push(cell); models.set(reply.id, reply); });
      topic.allReplies = [...models.values()];
      attachThanksObserver(topic);
      topic.models = inferRelationships(topic.allReplies);
      topic.visibleThread = deriveVisibleThread(topic);
      renderThreadedView(topic);
      applyTopicView(topic, topic.view);
      setTopicStatus(topic, `已加载 ${topic.models.length} 条关系数据；当前线程投影包含 ${topic.visibleThread.visibleReplies.length} 条回复（含必要跨页上下文）`);
      scanImageContent(root);
    });
    topic.replyObserver.observe(root, { childList: true, subtree: true });
  }

  function disposeThanks(topic) {
    topic.replyObserver?.disconnect();
    topic.thanksObserver?.disconnect();
    topic.thanksReads?.forEach((controller) => controller.abort());
    if (runtime.thanksRequest?.topic === topic) runtime.thanksRequest.controller.abort();
  }

  async function sendReplyThanks(topic, reply) {
    if (!isCurrentTopic(topic) || runtime.thanksRequest || reply.page !== topic.currentPage || !reply.thanks) return;
    reconcileThanks(topic, reply);
    if (reply.thanks.thanked || reply.thanks.phase !== 'idle' || !/^[1-9]\d*$/.test(reply.id)) return;
    const cell = nativeThanksReply(topic, reply);
    if (!cell || !readReplyThanks(cell, reply.id).canThank || !thanksSession()) return;
    if (!window.confirm('感谢 ' + (reply.author || '该用户') + ' 的第 ' + (reply.floor || '') + ' 楼回复将消耗 10 铜币，是否继续？')) return;
    const session = thanksSession();
    if (!isCurrentTopic(topic) || runtime.thanksRequest || !session || !cell.isConnected || !readReplyThanks(cell, reply.id).canThank) return;
    const state = reply.thanks;
    const controller = new AbortController();
    const request = { topic, replyId: reply.id, controller };
    runtime.thanksRequest = request;
    state.phase = 'pending';
    state.message = '';
    rememberThanks(topic, reply, 'pending');
    updateThanksViews(topic);
    const timer = window.setTimeout(() => controller.abort(), THANK_TIMEOUT_MS);
    try {
      // This write deliberately does not use fetchPage(), whose GET retries are unsafe here.
      const url = new URL('/thank/reply/' + reply.id, location.origin);
      url.searchParams.set('once', String(session.token));
      const response = await fetch(url.href, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) throw new Error('感谢结果未确认');
      const data = await response.json();
      if (!data || typeof data.success !== 'boolean') throw new Error('感谢结果未确认');
      if (isCurrentTopic(topic)) {
        // Other native operations may have rotated once while this request was in flight.
        try {
          if (String(session.page.once) === String(session.token)) {
            if (validThanksToken(data.once)) session.page.once = data.once;
            else runtime.thanksBlockedTokens.add(String(session.token));
          }
        } catch (error) {
          runtime.thanksBlockedTokens.add(String(session.token));
        }
      } else {
        runtime.thanksBlockedTokens.add(String(session.token));
      }
      if (data.success === true) {
        if (!state.thanked && state.count !== null) state.count += 1;
        state.thanked = true;
        state.canThank = false;
        state.phase = 'idle';
        rememberThanks(topic, reply, 'thanked');
        if (isCurrentTopic(topic)) {
          markNativeThanked(topic, reply);
          try {
            if (typeof session.page.refreshMoney === 'function') session.page.refreshMoney();
          } catch (error) { /* Balance refresh must not undo a confirmed successful thank. */ }
          void refreshReplyThanks(topic, reply);
        }
      } else {
        state.phase = 'idle';
        state.message = typeof data.message === 'string' ? data.message.slice(0, 200) : '感谢未发送，请检查登录状态或余额';
        if (runtime.thanksResults.get(thanksKey(topic, reply))?.state !== 'thanked') {
          runtime.thanksResults.delete(thanksKey(topic, reply));
        }
        reconcileThanks(topic, reply);
      }
      reply.thankCount = state.count;
    } catch (error) {
      state.phase = 'unknown';
      state.message = '结果未确认，请核对状态';
      rememberThanks(topic, reply, 'unknown');
      reconcileThanks(topic, reply);
      // Remember uncertainty even after navigation, without touching the new page's once.
      runtime.thanksBlockedTokens.add(String(session.token));
    } finally {
      window.clearTimeout(timer);
      if (runtime.thanksRequest === request) runtime.thanksRequest = null;
      // Read the current view's own IDs; never apply the old topic's DOM or token.
      if (runtime.topic) updateThanksViews(runtime.topic);
    }
  }

  function focusNativeThanks(area) {
    if (!area) return;
    area.classList.add('wt-v2ex-thanks-focus');
    if (!area.hasAttribute('tabindex')) area.tabIndex = -1;
    // Native links are hidden until the area is hovered; focus reveals them too.
    area.focus({ preventScroll: true });
    const cell = area.closest('.cell[id^="r_"]');
    const replyId = cell?.id.match(/^r_([1-9]\d*)$/)?.[1];
    if (cell && replyId) nativeReplyThanksNodes(cell, replyId).action?.focus({ preventScroll: true });
  }

  function showNativeThanks(topic, reply) {
    topic.keepThanksSourceView = true;
    applyTopicView(topic, 'original');
    const cell = nativeThanksReply(topic, reply);
    cell?.scrollIntoView({ block: 'center', behavior: 'auto' });
    const area = cell && [...cell.querySelectorAll('[id]')].find((node) => node.id === 'thank_area_' + reply.id && !node.closest('.reply_content'));
    focusNativeThanks(area);
  }

  function activateThanks(topic, event) {
    if (!(event.target instanceof Element) || !isCurrentTopic(topic)) return;
    const action = event.target.closest('.wt-v2ex-thank-action, .wt-v2ex-thank-check, .wt-v2ex-thank-source');
    if (!action || !topic.threadedView.contains(action)) return;
    const control = action.closest('.wt-v2ex-thanks');
    if (control?.closest('.reply_content') || topic.thanksControls?.get(control) !== action.dataset.replyId) return;
    const reply = topic.allReplies.find((item) => item.id === action.dataset.replyId);
    if (!reply?.thanks) return;
    if (event.type === 'keydown') {
      if (event.key !== ' ' || !action.matches('a[role="button"]')) return;
      event.preventDefault();
      if (event.repeat) return;
    }
    if (action.classList.contains('wt-v2ex-thank-source')) {
      if (reply.page === topic.currentPage && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        showNativeThanks(topic, reply);
      }
      return;
    }
    event.preventDefault();
    if (action.disabled || action.getAttribute('aria-disabled') === 'true') return;
    if (action.classList.contains('wt-v2ex-thank-check')) void refreshReplyThanks(topic, reply, true);
    else void sendReplyThanks(topic, reply);
  }

  function parseReply(element, page, index = 0, base = location.href) {
    const content = firstMatch(element, SELECTORS.replyContent);
    if (!content) return null;
    const idMatch = String(element.id || '').match(/^r_(.+)$/);
    const header = nativeReplyHeader(element);
    const floorNode = header && [...header.querySelectorAll('.no')].find((node) => !node.closest('.reply_content'));
    const floor = parseFloor(floorNode?.textContent);
    const authorElement = firstMatch(element, SELECTORS.replyAuthor);
    const author = (authorElement?.textContent || '').trim();
    const thanks = readReplyThanks(element, idMatch?.[1] || '');
    const prefix = parseLeadingPrefix(content);
    return {
      id: idMatch ? idMatch[1] : `fallback-${page}-${floor || 'unknown'}-${index}`,
      floor,
      page,
      author,
      normalizedAuthor: normalizeName(author),
      avatarUrl: safeUrl(firstMatch(element, SELECTORS.replyAvatar)?.getAttribute('src'), 'image', base),
      timeText: firstMatch(element, SELECTORS.replyTime)?.getAttribute('title') || firstMatch(element, SELECTORS.replyTime)?.textContent.trim() || '',
      contentHtml: sanitizeContent(content, base),
      contentText: (content.textContent || '').trim(),
      thankCount: thanks.count,
      thanks,
      mentionedUsers: prefix.mentionedUsers,
      normalizedMentions: prefix.normalizedMentions,
      explicitReplyFloor: prefix.explicitReplyFloor,
      hasMultipleStructuralMentions: prefix.hasMultipleStructuralMentions,
      hasStructuralMention: prefix.hasStructuralMention,
      parentId: null,
      relationshipConfidence: 'root',
      unresolvedReason: '',
      children: [],
      nativeTemplate: sanitizeReplyTemplate(element, base),
      nativeThanksPresentation: extractNativeThanksPresentation(element, idMatch?.[1] || '', base),
      nativeReplyControlsTemplate: extractNativeReplyControls(element, base)
    };
  }

  function parseReplies(root, page, base = location.href) {
    const elements = root instanceof Document ? allMatches(root, SELECTORS.reply) : allMatches(root, SELECTORS.reply);
    return elements.map((element, index) => parseReply(element, page, index, base)).filter(Boolean);
  }

  function inferRelationships(replies) {
    const sorted = [...replies].sort((a, b) => (a.floor ?? Number.MAX_SAFE_INTEGER) - (b.floor ?? Number.MAX_SAFE_INTEGER));
    const replyByFloor = new Map();
    const earlierRepliesByNormalizedAuthor = new Map();
    const duplicateFloors = new Set();
    sorted.forEach((reply) => {
      reply.children = [];
      reply.parentId = null;
      if (reply.floor !== null) {
        if (replyByFloor.has(reply.floor)) duplicateFloors.add(reply.floor);
        else replyByFloor.set(reply.floor, reply);
      }
    });
    sorted.forEach((reply) => {
      const mention = reply.normalizedMentions[0];
      let parent = null;
      if (reply.hasMultipleStructuralMentions) {
        reply.relationshipConfidence = 'unresolved';
        reply.unresolvedReason = '开头包含多个用户，无法确定唯一父楼层';
      } else if (reply.explicitReplyFloor !== null) {
        const target = replyByFloor.get(reply.explicitReplyFloor);
        if (duplicateFloors.has(reply.explicitReplyFloor)) {
          reply.relationshipConfidence = 'unresolved';
          reply.unresolvedReason = `引用的 #${reply.explicitReplyFloor} 不唯一`;
        } else if (!target) {
          reply.relationshipConfidence = 'unresolved';
          reply.unresolvedReason = `引用的 #${reply.explicitReplyFloor} 不存在`;
        } else if (target.floor >= reply.floor) {
          reply.relationshipConfidence = 'unresolved';
          reply.unresolvedReason = '引用了当前或未来楼层';
        } else if (!mention || target.normalizedAuthor !== mention.normalized) {
          reply.relationshipConfidence = 'unresolved';
          reply.unresolvedReason = '引用楼层作者与用户前缀不一致';
        } else {
          parent = target;
          reply.relationshipConfidence = 'exact';
        }
      } else if (reply.hasStructuralMention && mention) {
        parent = earlierRepliesByNormalizedAuthor.get(mention.normalized) || null;
        if (parent) reply.relationshipConfidence = 'inferred';
        else {
          reply.relationshipConfidence = 'unresolved';
          reply.unresolvedReason = '没有找到更早的同名作者楼层';
        }
      } else {
        reply.relationshipConfidence = 'root';
      }
      if (parent && parent !== reply && parent.floor < reply.floor) {
        reply.parentId = parent.id;
        parent.children.push(reply);
      } else if (parent) {
        reply.relationshipConfidence = 'unresolved';
        reply.unresolvedReason = '父楼层必须早于当前楼层';
      }
      if (reply.normalizedAuthor) earlierRepliesByNormalizedAuthor.set(reply.normalizedAuthor, reply);
    });
    return sorted;
  }

  function deriveVisibleThread(topic) {
    const allReplies = topic.models;
    const replyById = new Map(allReplies.map((reply) => [reply.id, reply]));
    const currentPageReplies = allReplies.filter((reply) => reply.page === topic.currentPage);
    const visibleIds = new Set(currentPageReplies.map((reply) => reply.id));

    currentPageReplies.forEach((reply) => {
      const visited = new Set([reply.id]);
      let parentId = reply.parentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = replyById.get(parentId);
        if (!parent) break;
        visibleIds.add(parent.id);
        parentId = parent.parentId;
      }
    });

    const childrenByParent = new Map();
    const roots = [];
    const rootIds = new Set();
    allReplies.forEach((reply) => {
      if (!visibleIds.has(reply.id)) return;
      if (reply.parentId && visibleIds.has(reply.parentId)) {
        const children = childrenByParent.get(reply.parentId) || [];
        children.push(reply);
        childrenByParent.set(reply.parentId, children);
      } else if (!rootIds.has(reply.id)) {
        rootIds.add(reply.id);
        roots.push(reply);
      }
    });

    const firstCurrentFloorByRoot = new Map();
    currentPageReplies.forEach((reply) => {
      let root = reply;
      const visited = new Set();
      while (root.parentId && visibleIds.has(root.parentId)) {
        if (visited.has(root.id)) {
          if (!rootIds.has(root.id)) {
            rootIds.add(root.id);
            roots.push(root);
          }
          break;
        }
        visited.add(root.id);
        const parent = replyById.get(root.parentId);
        if (!parent) break;
        root = parent;
      }
      const floor = reply.floor === null ? Number.MAX_SAFE_INTEGER : reply.floor;
      const previous = firstCurrentFloorByRoot.get(root.id);
      if (previous === undefined || floor < previous) firstCurrentFloorByRoot.set(root.id, floor);
    });

    roots.sort((left, right) => {
      const leftFloor = firstCurrentFloorByRoot.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightFloor = firstCurrentFloorByRoot.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftFloor - rightFloor || (left.floor ?? Number.MAX_SAFE_INTEGER) - (right.floor ?? Number.MAX_SAFE_INTEGER);
    });

    return {
      currentPageReplies,
      visibleIds,
      visibleReplies: allReplies.filter((reply) => visibleIds.has(reply.id)),
      roots,
      childrenByParent
    };
  }

  async function fetchPage(url, retry = 0) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) {
        if (retry < 1 && response.status >= 500) return fetchPage(url, retry + 1);
        throw new Error(`页面加载失败（HTTP ${response.status}）`);
      }
      return await response.text();
    } catch (error) {
      if (retry < 1 && (error.name === 'TypeError' || error.name === 'AbortError')) return fetchPage(url, retry + 1);
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadPages(topic, pages, onProgress) {
    const results = [];
    let nextIndex = 0;
    let completed = 0;
    async function worker() {
      while (nextIndex < pages.length) {
        const index = nextIndex;
        nextIndex += 1;
        const page = pages[index];
        try {
          const html = await fetchPage(pageUrl(topic.context, page));
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const replies = parseReplies(parsed, page, pageUrl(topic.context, page));
          if (!replies.length) throw new Error('分页中未找到可解析的回复');
          results[index] = { page, replies };
        } catch (error) {
          results[index] = { page, error };
        } finally {
          completed += 1;
          onProgress(completed, pages.length);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PAGE_REQUESTS, pages.length) }, worker));
    return results;
  }

  function ensureControlDock() {
    if (runtime.controlDock?.isConnected) return runtime.controlDock;
    const dock = document.createElement('div');
    dock.id = 'wt-v2ex-control-dock';
    dock.className = 'wt-v2ex-control-dock';
    dock.setAttribute('aria-label', 'V2EX 页面工具');
    document.body.append(dock);
    runtime.controlDock = dock;
    return dock;
  }

  function setSettingsPanelOpen(open, restoreFocus = false) {
    const panel = runtime.settingsPanel;
    const toggle = runtime.settingsToggle;
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭 WebTweaks 设置' : '打开 WebTweaks 设置');
    if (open) [...panel.querySelectorAll('input:not([disabled])')]
      .find((input) => !input.closest('[hidden]'))?.focus({ preventScroll: true });
    else if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  function ensureSettingsControl() {
    if (runtime.settingsToggle?.isConnected) return;
    const dock = ensureControlDock();
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wt-v2ex-settings-toggle';
    toggle.textContent = '设置';
    toggle.setAttribute('aria-label', '打开 WebTweaks 设置');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'wt-v2ex-settings-panel');
    const panel = document.createElement('div');
    panel.id = 'wt-v2ex-settings-panel';
    panel.className = 'wt-v2ex-settings-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'WebTweaks 设置');
    panel.hidden = true;
    panel.innerHTML = `
      <fieldset class="wt-v2ex-settings-topic" hidden>
        <legend>会话视图</legend>
        <div class="wt-v2ex-settings-panel-group">
          <label><input type="radio" name="wt-v2ex-view" data-view="threaded"> 楼中楼</label>
          <label><input type="radio" name="wt-v2ex-view" data-view="original"> 原始顺序</label>
        </div>
        <button type="button" class="wt-v2ex-panel-action wt-v2ex-load-pages" hidden>加载全部分页</button>
        <div class="wt-v2ex-thread-status" role="status" aria-live="polite"></div>
      </fieldset>
      <fieldset><legend>图片增强</legend>
        <label><input type="checkbox" role="switch" data-setting="imagePreviewEnabled"> 评论图片自动展开</label>
        <label><input type="checkbox" role="switch" data-setting="imageLightboxEnabled"> 图片点击放大</label>
      </fieldset>
      <fieldset><legend>页面工具</legend>
        <label><input type="checkbox" role="switch" data-setting="scrollTopEnabled"> 返回顶部</label>
      </fieldset>`;
    panel.querySelectorAll('[data-setting]').forEach((input) => {
      input.checked = runtime.settings[input.dataset.setting];
    });
    panel.addEventListener('change', (event) => {
      const input = event.target;
      if (input.matches('[data-setting]')) setFeatureSetting(input.dataset.setting, input.checked);
      else if (input.matches('[data-view]')) {
        const topic = runtime.topic;
        if (!isCurrentTopic(topic)) return;
        topic.keepThanksSourceView = false;
        runtime.settings.preferredView = input.dataset.view;
        saveSettings();
        applyTopicView(topic, input.dataset.view);
      }
    });
    panel.addEventListener('click', (event) => {
      const topic = runtime.topic;
      if (!event.target.closest('.wt-v2ex-load-pages') || !isCurrentTopic(topic)) return;
      void loadAllTopicPages(topic).catch((error) => {
        if (!isCurrentTopic(topic)) return;
        topic.loading = false;
        topic.failed = true;
        setTopicStatus(topic, '分页解析失败，已保留原始顺序');
        applyTopicView(topic, 'original');
        logError(error);
      });
    });
    toggle.addEventListener('click', () => setSettingsPanelOpen(panel.hidden));
    dock.prepend(panel, toggle);
    runtime.settingsToggle = toggle;
    runtime.settingsPanel = panel;
    if (!runtime.panelDismissalAttached) {
      document.addEventListener('pointerdown', (event) => {
        if (!runtime.controlDock?.contains(event.target)) setSettingsPanelOpen(false);
      }, true);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !runtime.settingsPanel?.hidden) {
          event.preventDefault();
          setSettingsPanelOpen(false, true);
        }
      });
      document.addEventListener('focusin', (event) => {
        if (!runtime.controlDock?.contains(event.target)) setSettingsPanelOpen(false);
      });
      runtime.panelDismissalAttached = true;
    }
  }

  function setTopicStatus(topic, message) {
    topic.statusMessage = message;
    const status = topic.panel?.querySelector('.wt-v2ex-thread-status');
    if (status) status.textContent = message;
  }

  function updateTopicPanel(topic) {
    const panel = topic.panel;
    if (!panel) return;
    panel.querySelector('.wt-v2ex-settings-topic').hidden = false;
    panel.querySelectorAll('[data-view]').forEach((input) => {
      input.checked = input.dataset.view === topic.view;
    });
    const loadButton = panel.querySelector('.wt-v2ex-load-pages');
    if (loadButton) {
      loadButton.hidden = !topic.incomplete || topic.loading;
      loadButton.textContent = topic.loading ? '正在加载…' : `加载全部 ${topic.maxPage} 页并构建楼中楼`;
    }
    const status = panel.querySelector('.wt-v2ex-thread-status');
    if (status) status.textContent = topic.statusMessage || '准备构建楼中楼';
  }

  function relationshipLabel(reply) {
    if (reply.relationshipConfidence === 'exact') return `回复 #${reply.explicitReplyFloor}`;
    if (reply.relationshipConfidence === 'inferred') return '推断回复';
    if (reply.relationshipConfidence === 'unresolved') return '关系未确定';
    return '';
  }

  function createReplyCard(reply, depth, hasVisibleChildren, topic) {
    const cell = reply.nativeTemplate?.cloneNode(true) || document.createElement('div');
    if (!cell.classList.contains('cell')) cell.classList.add('cell');
    cell.classList.add('wt-v2ex-threaded-reply', `wt-v2ex-depth-${Math.min(depth, 6)}`);
    cell.removeAttribute('id');
    cell.dataset.wtV2exReplyId = reply.id;
    cell.setAttribute('aria-label', `第 ${reply.floor || '未知'} 楼，${reply.author || '未知用户'}`);
    const content = firstMatch(cell, SELECTORS.replyContent);
    const contentCell = content?.closest('td') || cell;
    const separator = [...contentCell.children].find((element) => element.classList.contains('sep5'));
    const header = document.createElement('div');
    header.className = 'wt-v2ex-reply-header';
    const headerNodes = [];
    for (let node = contentCell.firstChild; node && node !== separator && node !== content; node = node.nextSibling) {
      headerNodes.push(node);
    }
    if (headerNodes.length) {
      contentCell.insertBefore(header, headerNodes[0]);
      headerNodes.forEach((node) => header.append(node));
    } else {
      contentCell.insertBefore(header, separator || content || contentCell.firstChild);
    }
    const controls = reply.nativeReplyControlsTemplate?.cloneNode(true);
    if (controls) {
      const nativeAction = controls.querySelector('[data-wt-v2ex-native-reply-action="true"]');
      const nativeFloor = controls.querySelector('.no');
      if (nativeFloor) {
        if (reply.floor) nativeFloor.textContent = String(reply.floor);
        else nativeFloor.remove();
      }
      if (nativeAction && !reply.floor) nativeAction.remove();
      else if (nativeAction) {
        nativeAction.dataset.replyUser = reply.author;
        nativeAction.dataset.replyFloor = String(reply.floor || '');
        nativeAction.setAttribute('aria-label', `回复 ${reply.author || '该用户'} 第 ${reply.floor || ''} 楼`);
      }
      const controlsSlot = header.querySelector('.wt-v2ex-native-reply-slot');
      if (controlsSlot) controlsSlot.replaceWith(controls);
      else header.prepend(controls);
    }
    if (topic) {
      createThanksControl(topic, reply, header, controls);
      header.querySelectorAll('.wt-v2ex-ignore-action').forEach((action) => {
        const native = nativeThanksReply(topic, reply);
        if (reply.page !== topic.currentPage || !nativeIgnoreControl(native, reply.id) || !ignoreSession()) action.remove();
        else topic.ignoreControls.set(action, reply.id);
      });
      if (reply.thanks) updateThanksControl(topic, reply, header);
      if (runtime.ignoredReplies.has(topic.context.id + ':' + reply.id)) {
        cell.classList.add('wt-v2ex-ignored-reply');
        cell.removeAttribute('aria-label');
      }
    }
    const relation = relationshipLabel(reply);
    if (relation) {
      const badge = document.createElement('span');
      badge.className = `wt-v2ex-relation wt-v2ex-relation-${reply.relationshipConfidence}`;
      badge.textContent = relation;
      if (reply.unresolvedReason) badge.title = reply.unresolvedReason;
      header.append(badge);
    }
    if (hasVisibleChildren) {
      const children = document.createElement('div');
      children.className = `wt-v2ex-thread-children wt-v2ex-child-depth-${Math.min(depth + 1, 6)}`;
      cell.append(children);
      return { cell, children };
    }
    return { cell, children: null };
  }

  function captureThreadedScrollAnchor(topic) {
    if (topic.view !== 'threaded' || topic.threadedView.hidden) return null;
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight || 0;
    const anchor = [...topic.threadedView.querySelectorAll('[data-wt-v2ex-reply-id]')].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < viewportBottom;
    });
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    return { id: anchor.dataset.wtV2exReplyId, top: rect.top };
  }

  function restoreThreadedScrollAnchor(topic, anchor) {
    if (!anchor || typeof window.scrollBy !== 'function') return;
    const replacement = [...topic.threadedView.querySelectorAll('[data-wt-v2ex-reply-id]')]
      .find((element) => element.dataset.wtV2exReplyId === anchor.id);
    if (!replacement) return;
    const delta = replacement.getBoundingClientRect().top - anchor.top;
    if (Number.isFinite(delta) && Math.abs(delta) > 0.5) window.scrollBy(0, delta);
  }

  function renderThreadedView(topic) {
    const lightboxUrl = runtime.imageLightboxOpener && topic.threadedView.contains(runtime.imageLightboxOpener)
      ? lightboxUrlForImage(runtime.imageLightboxOpener)
      : null;
    if (lightboxUrl) closeImageLightbox(false);
    const scrollAnchor = captureThreadedScrollAnchor(topic);
    topic.thanksControls = new Map();
    topic.threadedView.replaceChildren();
    topic.ignoreControls = new Map();
    const fragment = document.createDocumentFragment();
    const visibleThread = topic.visibleThread || deriveVisibleThread(topic);
    const stack = [...visibleThread.roots].reverse().map((reply) => ({ reply, target: fragment, depth: 0 }));
    const renderedReplyIds = new Set();
    while (stack.length) {
      const { reply, target, depth } = stack.pop();
      if (renderedReplyIds.has(reply.id)) {
        console.warn(`${LOG_PREFIX} skipped duplicate threaded reply`, reply.id);
        continue;
      }
      renderedReplyIds.add(reply.id);
      const children = visibleThread.childrenByParent.get(reply.id) || [];
      const rendered = createReplyCard(reply, depth, children.length > 0, topic);
      target.append(rendered.cell);
      if (children.length && rendered.children) {
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({ reply: children[index], target: rendered.children, depth: depth + 1 });
        }
      }
    }
    topic.threadedView.append(fragment);
    restoreThreadedScrollAnchor(topic, scrollAnchor);
    scanImageContent(topic.threadedView);
    if (lightboxUrl) {
      const replacement = [...topic.threadedView.querySelectorAll('img')].find((image) => lightboxUrlForImage(image) === lightboxUrl);
      replacement?.focus({ preventScroll: true });
    }
  }

  function updateIgnoreControls(topic) {
    topic.ignoreControls?.forEach((replyId, action) => {
      const cell = topic.nativeReplies.find((node) => node.id === 'r_' + replyId && node.isConnected);
      action.hidden = !nativeIgnoreControl(cell, replyId) || !ignoreSession();
    });
  }

  function activateIgnore(topic, event) {
    if (!isCurrentTopic(topic) || !(event.target instanceof Element)) return;
    const action = event.target.closest('.wt-v2ex-ignore-action');
    const replyId = topic.ignoreControls?.get(action);
    if (!replyId || !topic.threadedView.contains(action) || action.hidden) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const key = topic.context.id + ':' + replyId;
    if (runtime.ignoredReplies.has(key)) return;
    const cell = topic.nativeReplies.find((node) => node.id === 'r_' + replyId && node.isConnected);
    const native = nativeIgnoreControl(cell, replyId);
    const page = ignoreSession();
    if (!native || !page) return;
    if (!window.confirm('确定隐藏这条回复吗？')) return;
    const current = nativeIgnoreControl(cell, replyId);
    if (!isCurrentTopic(topic) || !cell.isConnected || !current || current.action !== native.action
      || current.token !== native.token || runtime.ignoredReplies.has(key)) return;
    const restoreFocus = action.contains(document.activeElement);
    runtime.ignoredReplies.add(key);
    // shortcut: native ignoreReply exposes no result; add a result-aware adapter if server reconciliation is needed.
    try { page.ignoreReply(replyId, current.token); }
    catch (error) { logError(new Error('原生隐藏操作结果未确认')); }
    const card = action.closest('.wt-v2ex-threaded-reply');
    card.classList.add('wt-v2ex-ignored-reply');
    card.removeAttribute('aria-label');
    cell.classList.add('wt-v2ex-native-ignored');
    if (restoreFocus) runtime.settingsToggle?.focus({ preventScroll: true });
  }

  function applyTopicView(topic, view) {
    if (topic.thanksObserver) synchronizeNativeThanks(topic);
    const targetId = !topic.thanksTargetHandled && location.hash?.match(/^#wt-v2ex-thank-([1-9]\d*)$/)?.[1];
    const targetReply = targetId && topic.allReplies.find((reply) => reply.id === targetId && reply.page === topic.currentPage);
    if (targetReply) { topic.thanksTargetHandled = true; topic.keepThanksSourceView = true; }
    if (topic.keepThanksSourceView) view = 'original';
    if (view === 'threaded' && (!topic.threadedView.childElementCount || topic.failed)) {
      view = 'original';
    }
    topic.view = view;
    topic.threadedView.hidden = view !== 'threaded';
    topic.threadedView.setAttribute('aria-hidden', String(view !== 'threaded'));
    const clonesById = new Map([...topic.threadedView.querySelectorAll('[data-wt-v2ex-reply-id]')]
      .map((node) => [node.dataset.wtV2exReplyId, node]));
    topic.nativeReplies.forEach((reply) => {
      const key = topic.context.id + ':' + reply.id.slice(2);
      if (reply.style?.display === 'none' || reply.hidden) runtime.ignoredReplies.add(key);
      const ignored = runtime.ignoredReplies.has(key);
      reply.classList.toggle('wt-v2ex-native-ignored', ignored);
      const clone = clonesById.get(reply.id.slice(2));
      if (ignored && clone) { clone.classList.add('wt-v2ex-ignored-reply'); clone.removeAttribute('aria-label'); }
      const hidden = view === 'threaded';
      reply.classList.toggle('wt-v2ex-native-hidden', hidden);
      if (hidden) reply.setAttribute('aria-hidden', 'true');
      else reply.removeAttribute('aria-hidden');
    });
    updateTopicPanel(topic);
    if (targetReply) {
      const cell = nativeThanksReply(topic, targetReply);
      cell?.scrollIntoView({ block: 'center', behavior: 'auto' });
      focusNativeThanks(cell?.querySelector('[id^="thank_area_"]'));
    }
  }

  async function loadAllTopicPages(topic, pageLoader = loadPages) {
    if (topic.loading || !topic.incomplete || !isCurrentTopic(topic)) return;
    topic.loading = true;
    updateTopicPanel(topic);
    setTopicStatus(topic, `正在加载 0 / ${topic.maxPage} 页`);
    const pages = topic.pages.filter((page) => !topic.loadedPages.has(page));
    const results = await pageLoader(topic, pages, (completed, total) => {
      if (isCurrentTopic(topic)) setTopicStatus(topic, `正在加载 ${completed} / ${total} 页`);
    });
    if (!isCurrentTopic(topic)) {
      topic.loading = false;
      return;
    }
    let failures = 0;
    results.forEach((result) => {
      if (result?.error) failures += 1;
      else if (result) {
        topic.loadedPages.add(result.page);
        topic.allReplies.push(...result.replies);
      }
    });
    const byId = new Map();
    const deduped = [];
    topic.allReplies.forEach((reply) => {
      if (byId.has(reply.id)) {
        topic.duplicateIds += 1;
        return;
      }
      byId.set(reply.id, reply);
      deduped.push(reply);
    });
    topic.allReplies = deduped;
    topic.incomplete = failures > 0;
    topic.loading = false;
    topic.failed = topic.allReplies.length === 0;
    topic.models = inferRelationships(topic.allReplies);
    topic.visibleThread = deriveVisibleThread(topic);
    renderThreadedView(topic);
    const visibleCount = topic.visibleThread.visibleReplies.length;
    const visibleSummary = `当前线程投影包含 ${visibleCount} 条回复（含必要跨页上下文）`;
    if (failures) setTopicStatus(topic, `部分分页加载失败，已加载 ${topic.models.length} 条关系数据；${visibleSummary}，原始顺序仍可用`);
    else if (topic.duplicateIds) setTopicStatus(topic, `已加载 ${topic.models.length} 条关系数据；${visibleSummary}（忽略 ${topic.duplicateIds} 个重复 ID）`);
    else setTopicStatus(topic, `已加载 ${topic.models.length} 条关系数据；${visibleSummary}，关系为启发式重建`);
    updateTopicPanel(topic);
    if (failures || topic.failed) applyTopicView(topic, 'original');
    else if (runtime.settings.preferredView === 'threaded') applyTopicView(topic, 'threaded');
  }

  async function initializeTopic() {
    const context = topicContext();
    if (!context) return;
    if (runtime.topic?.key === context.key) return;
    const nativeReplies = allMatches(document, SELECTORS.reply);
    if (!nativeReplies.length) {
      const list = document.querySelector('#topic-replies');
      if (list && !runtime.waitingReplyObserver && typeof MutationObserver === 'function') {
        runtime.waitingReplyObserver = new MutationObserver(() => {
          if (topicContext()?.key !== context.key || !allMatches(list, SELECTORS.reply).length) return;
          runtime.waitingReplyObserver.disconnect();
          runtime.waitingReplyObserver = null;
          scheduleTopicSynchronization();
        });
        runtime.waitingReplyObserver.observe(list, { childList: true, subtree: true });
      }
      return;
    }
    runtime.waitingReplyObserver?.disconnect();
    runtime.waitingReplyObserver = null;
    const firstReply = nativeReplies[0];
    const threadedView = document.createElement('section');
    threadedView.className = 'wt-v2ex-threaded-view';
    threadedView.setAttribute('aria-label', '楼中楼视图');
    const discoveredPages = discoverPages(context);
    const topic = {
      context,
      key: context.key,
      currentPage: context.page,
      navigationRevision: runtime.navigationRevision,
      nativeReplies,
      panel: runtime.settingsPanel,
      threadedView,
      pages: discoveredPages.pages,
      maxPage: discoveredPages.maxPage,
      loadedPages: new Set([context.page]),
      allReplies: parseReplies(document, context.page, location.href),
      models: [],
      view: 'original',
      loading: false,
      incomplete: false,
      failed: false,
      duplicateIds: 0,
      statusMessage: '准备构建楼中楼'
    };
    firstReply.before(threadedView);
    runtime.topic = topic;
    attachThanksObserver(topic);
    attachReplyObserver(topic);
    topic.models = inferRelationships(topic.allReplies);
    topic.visibleThread = deriveVisibleThread(topic);
    renderThreadedView(topic);
    applyTopicView(topic, 'original');
    if (topic.maxPage > 10) {
      topic.incomplete = true;
      setTopicStatus(topic, `当前显示第 ${topic.currentPage} 页；完整关系需要加载全部 ${topic.maxPage} 页`);
      updateTopicPanel(topic);
    } else if (topic.pages.length > 1) {
      topic.incomplete = true;
      updateTopicPanel(topic);
      setTopicStatus(topic, `正在加载 0 / ${topic.pages.length - 1} 页`);
      void loadAllTopicPages(topic).catch((error) => {
        if (!isCurrentTopic(topic)) return;
        topic.loading = false;
        topic.failed = true;
        setTopicStatus(topic, '分页解析失败，已保留原始顺序');
        applyTopicView(topic, 'original');
        logError(error);
      });
    } else {
      setTopicStatus(topic, `已加载 ${topic.models.length} 条回复，关系为启发式重建`);
      applyTopicView(topic, runtime.settings.preferredView);
    }
    const activateThreadedReply = (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest('.wt-v2ex-native-reply-action');
      if (!action || !topic.threadedView.contains(action)) return;
      if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      insertReplyPrefix(findEditor(), action.dataset.replyUser, Number(action.dataset.replyFloor));
    };
    topic.threadedView.addEventListener('click', activateThreadedReply);
    topic.threadedView.addEventListener('keydown', activateThreadedReply);
    topic.threadedView.addEventListener('click', (event) => activateThanks(topic, event));
    topic.threadedView.addEventListener('keydown', (event) => activateThanks(topic, event));
    topic.threadedView.addEventListener('click', (event) => activateIgnore(topic, event));
    topic.threadedView.addEventListener('keydown', (event) => activateIgnore(topic, event));
  }

  function resetSettingsTopic() {
    const focused = runtime.settingsPanel?.contains(document.activeElement);
    setSettingsPanelOpen(false, focused);
    const section = runtime.settingsPanel?.querySelector('.wt-v2ex-settings-topic');
    if (section) section.hidden = true;
  }

  async function synchronizeTopicPage() {
    if (runtime.navigationSync) {
      scheduleTopicSynchronization();
      return;
    }
    const context = topicContext();
    const synchronizationRevision = runtime.navigationRevision;
    if (topicStateMatchesLocation(context) && (!runtime.topic || (runtime.topic.threadedView.isConnected
      && runtime.topic.nativeReplies.every((cell) => cell.isConnected)))) {
      scanImageContent(document);
      return;
    }
    runtime.navigationSync = true;
    try {
      if (context && !await waitForTopicDom(context)) {
        if (
          synchronizationRevision !== runtime.navigationRevision
          || topicContext()?.key !== context.key
        ) scheduleTopicSynchronization();
        else {
          closeImageLightbox();
          if (runtime.topic) {
            disposeThanks(runtime.topic);
            applyTopicView(runtime.topic, 'original');
            runtime.topic.threadedView.remove();
            runtime.topic = null;
          }
          resetSettingsTopic();
          scanImageContent(document);
        }
        return;
      }
      if (
        synchronizationRevision !== runtime.navigationRevision
        || context?.key !== topicContext()?.key
      ) {
        scheduleTopicSynchronization();
        return;
      }
      closeImageLightbox();
      if (runtime.topic) {
        disposeThanks(runtime.topic);
        applyTopicView(runtime.topic, 'original');
        runtime.topic.threadedView.remove();
        runtime.topic = null;
      }
      resetSettingsTopic();
      if (context) {
        await initializeTopic();
        if (runtime.topic) { runtime.topic.panel = runtime.settingsPanel; updateTopicPanel(runtime.topic); }
      }
      scanImageContent(document);
    } finally {
      runtime.navigationSync = false;
      if (runtime.topic && !isCurrentTopic(runtime.topic)) scheduleTopicSynchronization();
    }
  }

  function scheduleTopicSynchronization() {
    if (runtime.navigationSchedule) return;
    runtime.navigationSchedule = window.setTimeout(() => {
      runtime.navigationSchedule = 0;
      void synchronizeTopicPage().catch(logError);
    }, 0);
  }

  function handleTopicNavigation() {
    const nextTopicKey = topicContext()?.key || null;
    if (nextTopicKey !== runtime.observedTopicKey) {
      runtime.waitingReplyObserver?.disconnect();
      runtime.waitingReplyObserver = null;
      runtime.observedTopicKey = nextTopicKey;
      runtime.navigationRevision += 1;
    }
    scheduleTopicSynchronization();
  }

  function observeNavigation() {
    if (runtime.navigationAttached) return;
    runtime.navigationAttached = true;
    runtime.observedTopicKey = topicContext()?.key || null;
    ['pushState', 'replaceState'].forEach((method) => {
      const original = window.history[method];
      if (typeof original !== 'function') return;
      window.history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('wt-v2ex-navigation'));
        return result;
      };
    });
    window.addEventListener('popstate', handleTopicNavigation);
    window.addEventListener('wt-v2ex-navigation', handleTopicNavigation);
  }

  function findEditor() {
    const candidates = allMatches(document, SELECTORS.editor);
    return candidates.find(isSupportedEditor) || null;
  }

  function isSupportedEditor(editor) {
    if (!(editor instanceof HTMLTextAreaElement)) return false;
    const id = (editor.id || '').toLowerCase();
    const name = (editor.name || '').toLowerCase();
    if (!['reply_content', 'topic_content'].includes(id) && name !== 'content') return false;
    const form = editor.closest('form');
    const action = form?.getAttribute('action') || '';
    const nearbyEditor = editor.closest('#reply-box, #new-topic, #topic-editor, [id*="reply"], [id*="topic"]');
    return id === 'reply_content' || id === 'topic_content' || /\/t\/\d+/.test(action) || /(?:^|\/)new(?:$|[/?#])/.test(action) || Boolean(nearbyEditor);
  }

  function insertAtSelection(editor, text) {
    if (!editor) return false;
    const start = editor.selectionStart ?? editor.value.length;
    const end = editor.selectionEnd ?? start;
    editor.focus();
    if (typeof editor.setRangeText === 'function') {
      editor.setRangeText(text, start, end, 'end');
    } else {
      editor.value = `${editor.value.slice(0, start)}${text}${editor.value.slice(end)}`;
      editor.selectionStart = editor.selectionEnd = start + text.length;
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function insertReplyPrefix(editor, username, floor) {
    if (!editor || !username || !Number.isInteger(floor)) return;
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixPattern = new RegExp(`^\\s*@${escaped}\\b(?:\\s+#${floor}\\b)?\\s*`, 'i');
    if (prefixPattern.test(editor.value)) {
      if (!new RegExp(`^\\s*@${escaped}\\s+#${floor}\\b`, 'i').test(editor.value)) {
        editor.value = editor.value.replace(new RegExp(`^(\\s*@${escaped}\\b)`, 'i'), `$1 #${floor}`);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      editor.focus();
      return;
    }
    insertAtSelection(editor, `@${username} #${floor} `);
  }

  function imageContentContainers(root = document) {
    const containers = [];
    const seen = new Set();
    if (root instanceof Element && root.matches(IMAGE_CONTENT_SELECTOR)) {
      seen.add(root);
      containers.push(root);
    }
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll(IMAGE_CONTENT_SELECTOR).forEach((container) => {
        if (!seen.has(container)) {
          seen.add(container);
          containers.push(container);
        }
      });
    }
    return containers;
  }

  function createInlineImage(url) {
    const image = document.createElement('img');
    image.className = 'wt-v2ex-inline-image';
    image.src = url;
    image.alt = '来自 ' + new URL(url).hostname + ' 的图片预览';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.wtV2exImageUrl = url;
    return image;
  }

  function adjacentImageMatches(source, url) {
    const sibling = source.nextElementSibling;
    if (!(sibling instanceof HTMLImageElement)) return false;
    const siblingUrl = safeUrl(sibling.currentSrc || sibling.getAttribute('src'), 'image', sibling.baseURI);
    return siblingUrl === url;
  }

  function enhanceLinkedImages(container) {
    container.querySelectorAll('a[href]').forEach((anchor) => {
      if (anchor.dataset.wtV2exImageEnhanced === 'true') return;
      anchor.dataset.wtV2exImageEnhanced = 'true';
      if (anchor.querySelector('img')) return;
      const url = imagePreviewUrl(anchor.getAttribute('href'), anchor.baseURI);
      if (!url || adjacentImageMatches(anchor, url)) return;
      anchor.insertAdjacentElement('afterend', createInlineImage(url));
    });
  }

  function enhanceTextImages(container) {
    if (container.dataset.wtV2exImageTextEnhanced === 'true') return;
    container.dataset.wtV2exImageTextEnhanced = 'true';
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !/https?:\/\//i.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('a, code, pre, textarea, script, style, .wt-v2ex-image-lightbox')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node);
    textNodes.forEach((textNode) => {
      let insertionPoint = textNode;
      imageUrlsInText(textNode.nodeValue, textNode.baseURI).forEach((url) => {
        const image = createInlineImage(url);
        insertionPoint.parentNode.insertBefore(image, insertionPoint.nextSibling);
        insertionPoint = image;
      });
    });
  }

  function prepareLightboxTarget(image) {
    if (!(image instanceof HTMLImageElement) || image.classList.contains('avatar') || image.closest('.wt-v2ex-image-lightbox')) return;
    if (!lightboxUrlForImage(image)) return;
    if (image.dataset.wtV2exLightboxReady === 'true') return;
    image.dataset.wtV2exLightboxReady = 'true';
    image.classList.add('wt-v2ex-lightbox-target');
    if (!image.hasAttribute('tabindex') || image.tabIndex < 0) {
      image.dataset.wtV2exOriginalTabindex = image.hasAttribute('tabindex') ? image.getAttribute('tabindex') : '';
      image.tabIndex = 0;
      image.dataset.wtV2exManagedTabindex = 'true';
    }
    if (!image.hasAttribute('role')) {
      image.setAttribute('role', 'button');
      image.dataset.wtV2exAddedRole = 'true';
    }
    if (!image.hasAttribute('aria-label')) {
      image.setAttribute('aria-label', image.alt ? '打开图片预览：' + image.alt : '打开图片预览');
      image.dataset.wtV2exAddedAriaLabel = 'true';
    }
  }

  function prepareLightboxTargets(container) {
    container.querySelectorAll('img').forEach(prepareLightboxTarget);
  }

  function processImageContent(container) {
    if (runtime.settings.imagePreviewEnabled) {
      enhanceLinkedImages(container);
      enhanceTextImages(container);
    }
    if (runtime.settings.imageLightboxEnabled) prepareLightboxTargets(container);
  }

  function scanImageContent(root = document) {
    if (!runtime.settings.imagePreviewEnabled && !runtime.settings.imageLightboxEnabled) return;
    imageContentContainers(root).forEach(processImageContent);
  }

  function resetImagePreviews(root = document) {
    if (root instanceof Element && root.matches('.wt-v2ex-inline-image')) root.remove();
    if (typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('.wt-v2ex-inline-image').forEach((image) => image.remove());
    root.querySelectorAll('[data-wt-v2ex-image-enhanced]').forEach((source) => {
      delete source.dataset.wtV2exImageEnhanced;
    });
    root.querySelectorAll('[data-wt-v2ex-image-text-enhanced]').forEach((container) => {
      delete container.dataset.wtV2exImageTextEnhanced;
    });
  }

  function resetLightboxTarget(image) {
    if (!(image instanceof HTMLImageElement)) return;
    image.classList.remove('wt-v2ex-lightbox-target');
    if (image.dataset.wtV2exManagedTabindex === 'true') {
      if (image.dataset.wtV2exOriginalTabindex) image.setAttribute('tabindex', image.dataset.wtV2exOriginalTabindex);
      else image.removeAttribute('tabindex');
    }
    if (image.dataset.wtV2exAddedRole === 'true') image.removeAttribute('role');
    if (image.dataset.wtV2exAddedAriaLabel === 'true') image.removeAttribute('aria-label');
    delete image.dataset.wtV2exLightboxReady;
    delete image.dataset.wtV2exManagedTabindex;
    delete image.dataset.wtV2exOriginalTabindex;
    delete image.dataset.wtV2exAddedRole;
    delete image.dataset.wtV2exAddedAriaLabel;
  }

  function resetLightboxTargets(root = document) {
    if (root instanceof HTMLImageElement && root.dataset.wtV2exLightboxReady === 'true') resetLightboxTarget(root);
    if (typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img[data-wt-v2ex-lightbox-ready="true"]').forEach(resetLightboxTarget);
  }

  function lightboxUrlForImage(image) {
    if (!(image instanceof HTMLImageElement)) return null;
    const linkedImageUrl = imagePreviewUrl(image.closest('a[href]')?.getAttribute('href'), image.baseURI);
    return linkedImageUrl || safeUrl(image.currentSrc || image.getAttribute('src'), 'image', image.baseURI);
  }

  function ensureImageLightbox() {
    if (runtime.imageLightbox?.isConnected) return runtime.imageLightbox;
    const overlay = document.createElement('div');
    overlay.className = 'wt-v2ex-image-lightbox';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片预览');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'wt-v2ex-image-lightbox-close';
    closeButton.setAttribute('aria-label', '关闭图片预览');
    closeButton.textContent = '×';

    const image = document.createElement('img');
    image.className = 'wt-v2ex-image-lightbox-image';
    image.alt = '图片全屏预览';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';

    const originalLink = document.createElement('a');
    originalLink.className = 'wt-v2ex-image-lightbox-link';
    originalLink.target = '_blank';
    originalLink.rel = 'noopener noreferrer';
    originalLink.textContent = '在新标签页打开原图';

    overlay.append(closeButton, image, originalLink);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeImageLightbox();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [closeButton, originalLink].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const currentIndex = focusable.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      focusable[nextIndex].focus();
    });
    closeButton.addEventListener('click', () => closeImageLightbox());
    document.body.append(overlay);
    runtime.imageLightbox = overlay;
    runtime.imageLightboxImage = image;
    runtime.imageLightboxLink = originalLink;
    runtime.imageLightboxClose = closeButton;
    return overlay;
  }

  function openImageLightbox(opener) {
    if (!runtime.settings.imageLightboxEnabled || !(opener instanceof HTMLImageElement)) return false;
    if (opener.complete && opener.naturalWidth === 0) return false;
    const url = lightboxUrlForImage(opener);
    if (!url) return false;
    const overlay = ensureImageLightbox();
    runtime.imageLightboxOpener = opener;
    runtime.imageLightboxImage.src = url;
    runtime.imageLightboxImage.alt = opener.alt || '图片全屏预览';
    runtime.imageLightboxLink.href = url;
    if (!runtime.imageScrollLock) {
      runtime.imageScrollLock = {
        documentOverflow: document.documentElement.style.overflow,
        bodyOverflow: document.body.style.overflow,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      };
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    }
    overlay.hidden = false;
    if (runtime.imageLightboxFocusFrame) cancelAnimationFrame(runtime.imageLightboxFocusFrame);
    runtime.imageLightboxFocusFrame = requestAnimationFrame(() => {
      runtime.imageLightboxFocusFrame = 0;
      if (!overlay.hidden) runtime.imageLightboxClose?.focus({ preventScroll: true });
    });
    return true;
  }

  function closeImageLightbox(restoreFocus = true) {
    if (runtime.imageLightboxFocusFrame) {
      cancelAnimationFrame(runtime.imageLightboxFocusFrame);
      runtime.imageLightboxFocusFrame = 0;
    }
    const overlay = runtime.imageLightbox;
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    runtime.imageLightboxImage?.removeAttribute('src');
    runtime.imageLightboxLink?.removeAttribute('href');
    if (runtime.imageScrollLock) {
      const scrollLock = runtime.imageScrollLock;
      document.documentElement.style.overflow = scrollLock.documentOverflow;
      document.body.style.overflow = scrollLock.bodyOverflow;
      runtime.imageScrollLock = null;
      window.scrollTo(scrollLock.scrollX, scrollLock.scrollY);
    }
    const opener = runtime.imageLightboxOpener;
    runtime.imageLightboxOpener = null;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  }

  function contentImageFromEvent(event) {
    if (!(event.target instanceof HTMLImageElement)) return null;
    const image = event.target;
    if (!image.closest(IMAGE_CONTENT_SELECTOR) || image.classList.contains('avatar') || image.closest('.wt-v2ex-image-lightbox')) return null;
    return image;
  }

  function activateContentImage(event) {
    if (!runtime.settings.imageLightboxEnabled || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (event.type === 'click' && event.button !== 0) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    const image = contentImageFromEvent(event);
    if (!image || !openImageLightbox(image)) return;
    event.preventDefault();
  }

  function handleImageKeydown(event) {
    if (event.key === 'Escape' && runtime.imageLightbox && !runtime.imageLightbox.hidden) {
      event.preventDefault();
      closeImageLightbox();
      return;
    }
    activateContentImage(event);
  }

  function handleImageLoadFailure(event) {
    if (!(event.target instanceof HTMLImageElement)) return;
    if (event.target === runtime.imageLightboxImage) {
      closeImageLightbox();
      return;
    }
    if (event.target.classList.contains('wt-v2ex-inline-image')) event.target.remove();
  }

  function initializeImageEnhancement() {
    if (!runtime.imageDelegationAttached) {
      runtime.imageDelegationAttached = true;
      document.addEventListener('click', activateContentImage);
      document.addEventListener('keydown', handleImageKeydown);
      document.addEventListener('error', handleImageLoadFailure, true);
    }
    scanImageContent(document);
  }

  function updateScrollButton() {
    if (!runtime.scrollButton) return;
    runtime.scrollButton.hidden = !runtime.settings.scrollTopEnabled;
  }

  function initializeScrollToTop() {
    if (runtime.scrollButton) return;
    const dock = ensureControlDock();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wt-v2ex-scroll-top';
    button.textContent = '↑';
    button.setAttribute('aria-label', '返回顶部');
    button.title = '返回顶部';
    button.addEventListener('click', () => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    dock.append(button);
    runtime.scrollButton = button;
    updateScrollButton();
  }

  function addStyles() {
    const css = `
      .wt-v2ex-control-dock { position:fixed; z-index:1000; right:max(16px, env(safe-area-inset-right)); bottom:max(16px, env(safe-area-inset-bottom)); display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
      .wt-v2ex-settings-toggle, .wt-v2ex-scroll-top { border:1px solid rgba(127,127,127,.4); background:var(--v2ex-background-color,#fff); color:inherit; box-shadow:0 3px 12px rgba(0,0,0,.16); cursor:pointer; }
      .wt-v2ex-settings-toggle { min-width:42px; min-height:34px; border-radius:17px; padding:5px 10px; }
      .wt-v2ex-scroll-top { width:42px; height:42px; border-radius:50%; font-size:20px; line-height:1; }
      .wt-v2ex-settings-panel { position:absolute; right:0; bottom:calc(100% + 8px); box-sizing:border-box; width:min(320px, calc(100vw - 24px)); max-height:min(70vh, 560px); overflow:auto; display:grid; gap:9px; padding:12px; border:1px solid rgba(127,127,127,.28); border-radius:7px; background:var(--v2ex-background-color,#fff); color:var(--v2ex-text-color,#333); box-shadow:0 5px 20px rgba(0,0,0,.2); }
      .wt-v2ex-settings-panel [hidden], .wt-v2ex-settings-panel[hidden] { display:none !important; }
      .wt-v2ex-settings-panel fieldset { min-width:0; margin:0; padding:8px; border:1px solid rgba(127,127,127,.25); border-radius:4px; }
      .wt-v2ex-settings-panel legend { font-weight:600; }
      .wt-v2ex-settings-panel label { display:flex; align-items:center; gap:6px; min-height:36px; cursor:pointer; }
      .wt-v2ex-settings-panel input { accent-color:#1677ff; }
      .wt-v2ex-reply-header > .flex-one-row { flex-wrap:wrap; gap:6px; }
      .wt-v2ex-reply-header > .flex-one-row > .flex-one-row { flex-wrap:wrap; min-width:0; }
      .wt-v2ex-reply-header strong { overflow-wrap:anywhere; }
      .wt-v2ex-settings-panel-group { display:flex; flex-wrap:wrap; gap:6px; }
      .wt-v2ex-panel-action { border:1px solid rgba(127,127,127,.35); border-radius:4px; padding:5px 8px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
      .wt-v2ex-panel-action:hover, .wt-v2ex-panel-action[aria-pressed="true"] { background:rgba(127,127,127,.12); }
      .wt-v2ex-thread-status { color:#666; font-size:12px; }
      .wt-v2ex-threaded-view { margin:10px 0; }
      #Main .cell[id^="r_"].wt-v2ex-native-hidden, #Wrapper .cell[id^="r_"].wt-v2ex-native-hidden { display:none !important; }
      .wt-v2ex-threaded-reply { position:relative; }
      .wt-v2ex-threaded-reply > table { table-layout:fixed; }
      .wt-v2ex-native-ignored { display:none !important; }
      .wt-v2ex-ignored-reply { padding:0; border:0; }
      .wt-v2ex-ignored-reply > :not(.wt-v2ex-thread-children) { display:none; }
      .wt-v2ex-ignore-action:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
      .wt-v2ex-thanks [hidden] { display:none !important; }
      .wt-v2ex-thank-area:focus-within > a, .wt-v2ex-thanks-focus:focus-within > a { visibility:visible; }
      @media (hover:none) { .wt-v2ex-thank-area > a { visibility:visible; } }
      .wt-v2ex-thank-status { overflow-wrap:anywhere; }
      .wt-v2ex-inline-image { display:block; max-width:100%; height:auto; margin:8px 0; cursor:zoom-in; }
      .wt-v2ex-lightbox-target { cursor:zoom-in; }
      .wt-v2ex-image-lightbox { position:fixed; z-index:2147483646; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; box-sizing:border-box; padding:24px; overflow:auto; background:rgba(0,0,0,.88); }
      .wt-v2ex-image-lightbox[hidden] { display:none !important; }
      .wt-v2ex-image-lightbox-image { display:block; max-width:92vw; max-height:90vh; width:auto; height:auto; object-fit:contain; }
      .wt-v2ex-image-lightbox-close { position:fixed; top:max(14px, env(safe-area-inset-top)); right:max(16px, env(safe-area-inset-right)); width:42px; height:42px; border:1px solid rgba(255,255,255,.55); border-radius:50%; background:rgba(0,0,0,.58); color:#fff; cursor:pointer; font:32px/1 sans-serif; }
      .wt-v2ex-image-lightbox-link { color:#fff; text-decoration:underline; }
      .wt-v2ex-image-lightbox-close:focus-visible, .wt-v2ex-image-lightbox-link:focus-visible, .wt-v2ex-lightbox-target:focus-visible { outline:2px solid #69a8ff; outline-offset:3px; }
      .wt-v2ex-relation { padding:1px 4px; border:1px solid rgba(127,127,127,.3); border-radius:3px; font-size:11px; }
      .wt-v2ex-relation-exact { color:#176b3a; }
      .wt-v2ex-relation-inferred { color:#805b00; }
      .wt-v2ex-relation-unresolved { color:#9b2c2c; }
      .wt-v2ex-thread-children { margin-top:6px; padding-left:10px; border-left:2px solid rgba(22,119,255,.28); }
      .wt-v2ex-child-depth-1 { margin-left:4px; }
      .wt-v2ex-child-depth-2 { margin-left:8px; }
      .wt-v2ex-child-depth-3 { margin-left:12px; }
      .wt-v2ex-child-depth-4 { margin-left:16px; }
      .wt-v2ex-child-depth-5 { margin-left:20px; }
      .wt-v2ex-child-depth-6 { margin-left:24px; }
      .wt-v2ex-child-depth-6 .wt-v2ex-child-depth-6 { margin-left:0; padding-left:0; border-left:0; }
      .wt-v2ex-panel-action:focus-visible, .wt-v2ex-settings-toggle:focus-visible, .wt-v2ex-scroll-top:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
      @media (max-width:600px) { .wt-v2ex-control-dock { right:max(10px, env(safe-area-inset-right)); bottom:max(10px, env(safe-area-inset-bottom)); } .wt-v2ex-settings-panel { max-height:60vh; } .wt-v2ex-threaded-view { width:calc(100vw - 40px); max-width:calc(100vw - 40px); overflow-x:hidden; } .wt-v2ex-threaded-reply { box-sizing:border-box; max-width:100%; min-width:0; overflow:hidden; } .wt-v2ex-threaded-reply table { width:100%; max-width:100%; table-layout:fixed; } .wt-v2ex-threaded-reply .wt-v2ex-reply-header { min-width:0; } .wt-v2ex-threaded-reply .wt-v2ex-native-reply-controls { max-width:100%; } }
      @media (prefers-color-scheme:dark) { .wt-v2ex-settings-panel, .wt-v2ex-settings-toggle, .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); } .wt-v2ex-thread-status { color:#aaa; } }
      html.night .wt-v2ex-settings-panel, html.night .wt-v2ex-settings-toggle, html.night .wt-v2ex-scroll-top, body.night .wt-v2ex-settings-panel, body.night .wt-v2ex-settings-toggle, body.night .wt-v2ex-scroll-top, [data-theme="dark"] .wt-v2ex-settings-panel, [data-theme="dark"] .wt-v2ex-settings-toggle, [data-theme="dark"] .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); }
      @media (prefers-reduced-motion:reduce) { .wt-v2ex-scroll-top { scroll-behavior:auto; } }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }
  }

  function claimInitialization() {
    if (document.documentElement.dataset.wtV2exInitialized === 'true') return false;
    document.documentElement.dataset.wtV2exInitialized = 'true';
    return true;
  }

  async function initialize() {
    if (!claimInitialization()) return;
    addStyles();
    ensureSettingsControl();
    initializeImageEnhancement();
    observeNavigation();
    try {
      await initializeTopic();
      if (runtime.topic) { runtime.topic.panel = runtime.settingsPanel; updateTopicPanel(runtime.topic); }
    } catch (error) {
      if (runtime.topic) {
        runtime.topic.failed = true;
        applyTopicView(runtime.topic, 'original');
        runtime.topic.panel = runtime.settingsPanel;
        updateTopicPanel(runtime.topic);
      }
      logError(error);
    }
    try { if (runtime.settings.scrollTopEnabled) initializeScrollToTop(); } catch (error) { logError(error); }
  }

  initialize();
})();
