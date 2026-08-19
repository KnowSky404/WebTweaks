// ==UserScript==
// @name         V2EX Conversation Enhancer
// @name:zh-CN   V2EX 会话增强
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.2.1
// @description  Threaded cross-page replies, Imgur image uploads, and navigation improvements for V2EX.
// @description:zh-CN 为 V2EX 提供跨页楼中楼、Imgur 图片上传和返回顶部功能。
// @author       KnowSky404
// @match        https://v2ex.com/*
// @match        https://*.v2ex.com/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.imgur.com
// @run-at       document-idle
// @homepageURL  https://github.com/KnowSky404/WebTweaks/tree/main/scripts/v2ex-com
// @supportURL   https://github.com/KnowSky404/WebTweaks/issues
// @updateURL    https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/KnowSky404/WebTweaks/main/scripts/v2ex-com/conversation-enhancer.user.js
// ==/UserScript==

(() => {
  'use strict';

  const LOG_PREFIX = '[WebTweaks:V2EX]';
  const SETTINGS_VERSION = 1;
  const SETTINGS_KEY = 'wt-v2ex-settings';
  const MAX_PAGE_REQUESTS = 3;
  const PAGE_TIMEOUT_MS = 12_000;
  const UPLOAD_TIMEOUT_MS = 30_000;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const SCROLL_THRESHOLD = 600;

  // Verified against public V2EX HTML on 2026-08-18. Fallbacks are intentionally narrow.
  const SELECTORS = Object.freeze({
    reply: ['#Main .cell[id^="r_"]', '#Wrapper .cell[id^="r_"]', '.cell[id^="r_"]'],
    replyContent: ['.reply_content'],
    replyAuthor: ['strong a.dark', 'strong a[href^="/member/"]'],
    replyAvatar: ['img.avatar'],
    replyFloor: ['.no'],
    replyTime: ['.ago'],
    replyThanks: ['.small.fade img[alt="❤️"]'],
    nativeReplyFloor: ['.fr .no', '.no'],
    pagination: ['.ps_container a[href*="?p="]', '.ps_container a[href*="&p="]'],
    pageInput: ['.ps_container input.page_input'],
    editor: ['#reply_content', '#topic_content', 'textarea[name="content"]'],
    nativeReplyAction: ['a.reply', '.reply a', '[data-action="reply"]']
  });

  const runtime = {
    settings: loadSettings(),
    topic: null,
    enhancedEditors: new WeakSet(),
    editorObserver: null,
    editorScanFrame: 0,
    controlDock: null,
    conversationToggle: null,
    conversationPanel: null,
    panelDismissalAttached: false,
    scrollButton: null,
    scrollFrame: 0,
    nativeReplyListenerAttached: false,
    navigationAttached: false,
    navigationSync: false
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

  function safeDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') GM_deleteValue(key);
    } catch (error) {
      logError(error);
    }
  }

  function loadSettings() {
    const stored = safeGet(SETTINGS_KEY, {});
    const value = stored && typeof stored === 'object' ? stored : {};
    return {
      version: SETTINGS_VERSION,
      preferredView: value.preferredView === 'original' ? 'original' : 'threaded',
      imgurClientId: typeof value.imgurClientId === 'string' ? value.imgurClientId.trim() : '',
      scrollTopEnabled: value.scrollTopEnabled !== false,
      uploaderEnabled: value.uploaderEnabled !== false
    };
  }

  function saveSettings() {
    safeSet(SETTINGS_KEY, { ...runtime.settings, version: SETTINGS_VERSION });
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('设置 Imgur Client ID', configureClientId);
    GM_registerMenuCommand('清除 Imgur Client ID', () => {
      runtime.settings.imgurClientId = '';
      safeDelete(`${SETTINGS_KEY}.imgurClientId`);
      saveSettings();
      updateAllEditorStatuses('Imgur Client ID 已清除');
    });
    GM_registerMenuCommand('开启/关闭图片上传', () => {
      runtime.settings.uploaderEnabled = !runtime.settings.uploaderEnabled;
      saveSettings();
      updateAllEditorStatuses(runtime.settings.uploaderEnabled ? '图片上传已开启' : '图片上传已关闭');
      scanEditors();
    });
    GM_registerMenuCommand('开启/关闭返回顶部', () => {
      runtime.settings.scrollTopEnabled = !runtime.settings.scrollTopEnabled;
      saveSettings();
      if (runtime.settings.scrollTopEnabled) initializeScrollToTop();
      updateScrollButton();
    });
    GM_registerMenuCommand('默认使用楼中楼/原始顺序', () => {
      runtime.settings.preferredView = runtime.settings.preferredView === 'threaded' ? 'original' : 'threaded';
      saveSettings();
      if (runtime.topic) applyTopicView(runtime.topic, runtime.settings.preferredView);
    });
  }

  function configureClientId() {
    const current = runtime.settings.imgurClientId;
    const value = window.prompt('请输入 Imgur API Client ID（只需要 Client ID，不要输入 Client Secret）：', current);
    if (value === null) return;
    const clientId = value.trim();
    if (!clientId || /\s/.test(clientId)) {
      updateAllEditorStatuses('Client ID 不能为空且不能包含空格');
      return;
    }
    runtime.settings.imgurClientId = clientId;
    saveSettings();
    updateAllEditorStatuses('Imgur Client ID 已保存，可以上传图片');
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
    const page = Math.max(1, Number(new URL(location.href).searchParams.get('p') || 1));
    return { id: match[1], page, key: `${location.origin}${location.pathname}?p=${page}` };
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
    clone.removeAttribute('id');
    clone.querySelectorAll('script, style, iframe, form, object, embed, template, base, meta, link, input, select, textarea, button, [data-action], a.reply, .reply a, .thank, .ignore, .moderate, .small.fade').forEach((node) => node.remove());
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

  function nativeReplyGroup(root) {
    const groups = [...root.querySelectorAll('.fr')];
    return groups.find((group) => nativeReplyAction(group)) || groups.find((group) => group.querySelector('.no')) || null;
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

  function extractNativeReplyControls(element, base = location.href) {
    const group = nativeReplyGroup(element);
    if (!group) return null;
    const action = nativeReplyAction(group);
    const floor = group.querySelector('.no');
    if (!action && !floor) return null;
    const controls = document.createElement('div');
    controls.className = 'fr wt-v2ex-native-reply-controls';
    if (action) {
      const actionClone = sanitizeNativeControlNode(action, base, true);
      const hasReplyImage = actionClone.matches('img') || actionClone.querySelector('img');
      if (hasReplyImage) {
        const interactive = actionClone.matches('a, button, [role="button"]')
          ? actionClone
          : actionClone.querySelector('a, button, [role="button"]');
        if (interactive) {
          interactive.classList.add('wt-v2ex-native-reply-action');
          interactive.dataset.wtV2exNativeReplyAction = 'true';
          if (interactive.matches('a') && !interactive.getAttribute('href')) interactive.setAttribute('href', '#');
          if (interactive.matches('[role="button"]') && !interactive.hasAttribute('tabindex')) interactive.setAttribute('tabindex', '0');
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'wt-v2ex-native-reply-action';
          button.dataset.wtV2exNativeReplyAction = 'true';
          button.append(actionClone);
          controls.append(button);
        }
        if (interactive) controls.append(actionClone);
      }
    }
    if (floor) controls.append(sanitizeNativeControlNode(floor, base));
    return controls.childElementCount ? controls : null;
  }

  function parseReply(element, page, index = 0, base = location.href) {
    const content = firstMatch(element, SELECTORS.replyContent);
    if (!content) return null;
    const idMatch = String(element.id || '').match(/^r_(.+)$/);
    const floor = parseFloor(firstMatch(element, SELECTORS.replyFloor)?.textContent);
    const authorElement = firstMatch(element, SELECTORS.replyAuthor);
    const author = (authorElement?.textContent || '').trim();
    const thanksImage = firstMatch(element, SELECTORS.replyThanks);
    const thanksText = thanksImage?.parentElement?.textContent || '';
    const thankCount = thanksText.match(/\d+/)?.[0];
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
      thankCount: thankCount ? Number(thankCount) : null,
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
          replies.forEach((reply) => {
            if (!reply.nativeReplyControlsTemplate && topic.nativeReplyControlsTemplate) {
              reply.nativeReplyControlsTemplate = topic.nativeReplyControlsTemplate.cloneNode(true);
            }
          });
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

  function setConversationPanelOpen(topic, open) {
    const panel = topic.panel || runtime.conversationPanel;
    const toggle = runtime.conversationToggle;
    if (!panel || !toggle) return;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭会话视图控制面板' : '打开会话视图控制面板');
  }

  function createConversationControl(topic) {
    const dock = ensureControlDock();
    if (runtime.conversationToggle?.isConnected) {
      topic.panel = runtime.conversationPanel;
      updateTopicPanel(topic);
      return;
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wt-v2ex-conversation-toggle';
    toggle.textContent = '会话';
    toggle.setAttribute('aria-label', '打开会话视图控制面板');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'wt-v2ex-conversation-panel');
    const panel = document.createElement('div');
    panel.id = 'wt-v2ex-conversation-panel';
    panel.className = 'wt-v2ex-conversation-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', '会话视图');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="wt-v2ex-conversation-panel-title">会话视图</div>
      <div class="wt-v2ex-conversation-panel-group" role="group" aria-label="视图模式">
        <button type="button" class="wt-v2ex-panel-action" data-view="threaded" aria-pressed="false">楼中楼</button>
        <button type="button" class="wt-v2ex-panel-action" data-view="original" aria-pressed="false">原始顺序</button>
      </div>
      <button type="button" class="wt-v2ex-panel-action wt-v2ex-load-pages" hidden>加载全部分页</button>
      <div class="wt-v2ex-thread-status" role="status" aria-live="polite">准备构建楼中楼</div>`;
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !panel.contains(button)) return;
      if (button.dataset.view) {
        runtime.settings.preferredView = button.dataset.view;
        saveSettings();
        applyTopicView(topic, button.dataset.view);
      } else if (button.classList.contains('wt-v2ex-load-pages')) {
        void loadAllTopicPages(topic).catch((error) => {
          topic.loading = false;
          topic.failed = true;
          setTopicStatus(topic, '分页解析失败，已保留原始顺序');
          applyTopicView(topic, 'original');
          logError(error);
        });
      }
    });
    toggle.addEventListener('click', () => setConversationPanelOpen(topic, panel.hidden));
    dock.prepend(panel, toggle);
    runtime.conversationToggle = toggle;
    runtime.conversationPanel = panel;
    topic.panel = panel;
    if (!runtime.panelDismissalAttached) {
      document.addEventListener('pointerdown', (event) => {
        if (!runtime.conversationPanel || runtime.conversationPanel.hidden || !runtime.controlDock?.contains(event.target)) {
          if (runtime.topic) setConversationPanelOpen(runtime.topic, false);
        }
      }, true);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && runtime.topic) setConversationPanelOpen(runtime.topic, false);
      });
      runtime.panelDismissalAttached = true;
    }
    updateTopicPanel(topic);
  }

  function setTopicStatus(topic, message) {
    topic.statusMessage = message;
    const status = topic.panel?.querySelector('.wt-v2ex-thread-status');
    if (status) status.textContent = message;
  }

  function updateTopicPanel(topic) {
    const panel = topic.panel;
    if (!panel) return;
    panel.querySelectorAll('[data-view]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === topic.view));
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

  function removeClonedNativeHeaderControls(header) {
    const groups = [...header.querySelectorAll('.fr')];
    let removedControlGroup = false;
    groups.forEach((group) => {
      if (nativeReplyAction(group) || group.querySelector('.no')) {
        group.remove();
        removedControlGroup = true;
      }
    });
    allMatches(header, SELECTORS.nativeReplyAction).forEach((action) => action.remove());
    if (removedControlGroup) allMatches(header, SELECTORS.nativeReplyFloor).forEach((floor) => floor.remove());
    else firstMatch(header, SELECTORS.nativeReplyFloor)?.remove();
    [...header.querySelectorAll('.reply, .fr')].reverse().forEach((wrapper) => {
      if (!wrapper.children.length && !wrapper.textContent.trim()) wrapper.remove();
    });
  }

  function createReplyCard(reply, depth) {
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
    removeClonedNativeHeaderControls(header);
    const relation = relationshipLabel(reply);
    if (relation) {
      const badge = document.createElement('span');
      badge.className = `wt-v2ex-relation wt-v2ex-relation-${reply.relationshipConfidence}`;
      badge.textContent = relation;
      if (reply.unresolvedReason) badge.title = reply.unresolvedReason;
      header.append(badge);
    }
    const controls = reply.nativeReplyControlsTemplate?.cloneNode(true);
    if (controls) {
      const nativeAction = controls.querySelector('[data-wt-v2ex-native-reply-action="true"]');
      const nativeFloor = controls.querySelector('.no');
      if (nativeFloor) {
        if (reply.floor) nativeFloor.textContent = String(reply.floor);
        else nativeFloor.remove();
      }
      if (nativeAction) {
        nativeAction.dataset.replyUser = reply.author;
        nativeAction.dataset.replyFloor = String(reply.floor || '');
        nativeAction.setAttribute('aria-label', `回复 ${reply.author || '该用户'} 第 ${reply.floor || ''} 楼`);
      }
      if (controls.childElementCount) header.append(controls);
    }
    if (reply.children.length) {
      const children = document.createElement('div');
      children.className = `wt-v2ex-thread-children wt-v2ex-child-depth-${Math.min(depth + 1, 6)}`;
      cell.append(children);
      return { cell, children };
    }
    return { cell, children: null };
  }

  function renderThreadedView(topic) {
    topic.threadedView.replaceChildren();
    const fragment = document.createDocumentFragment();
    const stack = [...topic.roots].reverse().map((reply) => ({ reply, target: fragment, depth: 0 }));
    const renderedReplyIds = new Set();
    while (stack.length) {
      const { reply, target, depth } = stack.pop();
      if (renderedReplyIds.has(reply.id)) {
        console.warn(`${LOG_PREFIX} skipped duplicate threaded reply`, reply.id);
        continue;
      }
      renderedReplyIds.add(reply.id);
      const rendered = createReplyCard(reply, depth);
      target.append(rendered.cell);
      if (reply.children.length && rendered.children) {
        for (let index = reply.children.length - 1; index >= 0; index -= 1) {
          stack.push({ reply: reply.children[index], target: rendered.children, depth: depth + 1 });
        }
      }
    }
    topic.threadedView.append(fragment);
  }

  function applyTopicView(topic, view) {
    if (view === 'threaded' && (!topic.threadedView.childElementCount || topic.failed)) {
      view = 'original';
    }
    topic.view = view;
    topic.threadedView.hidden = view !== 'threaded';
    topic.threadedView.setAttribute('aria-hidden', String(view !== 'threaded'));
    topic.nativeReplies.forEach((reply) => {
      const hidden = view === 'threaded';
      reply.classList.toggle('wt-v2ex-native-hidden', hidden);
      if (hidden) reply.setAttribute('aria-hidden', 'true');
      else reply.removeAttribute('aria-hidden');
    });
    updateTopicPanel(topic);
  }

  async function loadAllTopicPages(topic) {
    if (topic.loading || !topic.incomplete) return;
    topic.loading = true;
    updateTopicPanel(topic);
    setTopicStatus(topic, `正在加载 0 / ${topic.maxPage} 页`);
    const pages = topic.pages.filter((page) => !topic.loadedPages.has(page));
    const results = await loadPages(topic, pages, (completed, total) => setTopicStatus(topic, `正在加载 ${completed} / ${total} 页`));
    let failures = 0;
    results.forEach((result) => {
      if (result?.error) failures += 1;
      else if (result) {
        topic.loadedPages.add(result.page);
        topic.replies.push(...result.replies);
      }
    });
    const byId = new Map();
    const deduped = [];
    topic.replies.forEach((reply) => {
      if (byId.has(reply.id)) {
        topic.duplicateIds += 1;
        return;
      }
      byId.set(reply.id, reply);
      deduped.push(reply);
    });
    topic.replies = deduped;
    topic.incomplete = failures > 0;
    topic.loading = false;
    topic.failed = topic.replies.length === 0;
    topic.models = inferRelationships(topic.replies);
    topic.roots = topic.models.filter((reply) => !reply.parentId);
    renderThreadedView(topic);
    if (failures) setTopicStatus(topic, `部分分页加载失败，已显示 ${topic.models.length} 条回复；原始顺序仍可用`);
    else if (topic.duplicateIds) setTopicStatus(topic, `已加载 ${topic.models.length} 条回复（忽略 ${topic.duplicateIds} 个重复 ID）`);
    else setTopicStatus(topic, `已加载 ${topic.models.length} 条回复，关系为启发式重建`);
    updateTopicPanel(topic);
    if (failures || topic.failed) applyTopicView(topic, 'original');
    else if (runtime.settings.preferredView === 'threaded') applyTopicView(topic, 'threaded');
  }

  async function initializeTopic() {
    const context = topicContext();
    if (!context) return;
    if (runtime.topic?.key === context.key) return;
    const nativeReplies = allMatches(document, SELECTORS.reply);
    if (!nativeReplies.length) return;
    const firstReply = nativeReplies[0];
    const threadedView = document.createElement('section');
    threadedView.className = 'wt-v2ex-threaded-view';
    threadedView.setAttribute('aria-label', '楼中楼视图');
    const discoveredPages = discoverPages(context);
    const topic = {
      context,
      key: context.key,
      nativeReplies,
      panel: null,
      threadedView,
      pages: discoveredPages.pages,
      maxPage: discoveredPages.maxPage,
      loadedPages: new Set([context.page]),
      replies: parseReplies(document, context.page, location.href),
      nativeReplyControlsTemplate: null,
      models: [],
      roots: [],
      view: 'original',
      loading: false,
      incomplete: false,
      failed: false,
      duplicateIds: 0,
      statusMessage: '准备构建楼中楼'
    };
    topic.nativeReplyControlsTemplate = topic.replies.find((reply) => reply.nativeReplyControlsTemplate)?.nativeReplyControlsTemplate || null;
    firstReply.before(threadedView);
    runtime.topic = topic;
    topic.models = inferRelationships(topic.replies);
    topic.roots = topic.models.filter((reply) => !reply.parentId);
    renderThreadedView(topic);
    if (topic.maxPage > 10) {
      topic.incomplete = true;
      setTopicStatus(topic, `当前显示第 ${context.page} 页；完整关系需要加载全部 ${topic.maxPage} 页`);
      updateTopicPanel(topic);
    } else if (topic.pages.length > 1) {
      topic.incomplete = true;
      updateTopicPanel(topic);
      setTopicStatus(topic, `正在加载 0 / ${topic.pages.length - 1} 页`);
      void loadAllTopicPages(topic).catch((error) => {
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
  }

  function removeConversationControl() {
    if (runtime.conversationPanel) runtime.conversationPanel.hidden = true;
    if (runtime.conversationToggle) {
      runtime.conversationToggle.setAttribute('aria-expanded', 'false');
      runtime.conversationToggle.setAttribute('aria-label', '打开会话视图控制面板');
    }
    runtime.conversationPanel?.remove();
    runtime.conversationToggle?.remove();
    runtime.conversationPanel = null;
    runtime.conversationToggle = null;
  }

  async function synchronizeTopicPage() {
    if (runtime.navigationSync) return;
    const context = topicContext();
    if (runtime.topic?.key === context?.key) return;
    runtime.navigationSync = true;
    try {
      if (runtime.topic) {
        applyTopicView(runtime.topic, 'original');
        runtime.topic.threadedView.remove();
        runtime.topic = null;
      }
      removeConversationControl();
      if (context) {
        await initializeTopic();
        if (runtime.topic) createConversationControl(runtime.topic);
      }
    } finally {
      runtime.navigationSync = false;
    }
  }

  function scheduleTopicSynchronization() {
    window.setTimeout(() => {
      void synchronizeTopicPage().catch(logError);
    }, 0);
  }

  function observeNavigation() {
    if (runtime.navigationAttached) return;
    runtime.navigationAttached = true;
    ['pushState', 'replaceState'].forEach((method) => {
      const original = window.history[method];
      if (typeof original !== 'function') return;
      window.history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('wt-v2ex-navigation'));
        return result;
      };
    });
    window.addEventListener('popstate', scheduleTopicSynchronization);
    window.addEventListener('wt-v2ex-navigation', scheduleTopicSynchronization);
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

  function enhanceNativeReplyAction(event) {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest(SELECTORS.nativeReplyAction.join(','));
    if (!action) return;
    const reply = action.closest('.cell[id^="r_"]');
    if (!reply) return;
    const author = firstMatch(reply, SELECTORS.replyAuthor)?.textContent.trim();
    const floor = parseFloor(firstMatch(reply, SELECTORS.replyFloor)?.textContent);
    if (!author || !floor) return;
    window.setTimeout(() => {
      const editor = findEditor();
      if (editor) insertReplyPrefix(editor, author, floor);
    }, 0);
  }

  function attachNativeReplyEnhancer() {
    if (runtime.nativeReplyListenerAttached) return;
    runtime.nativeReplyListenerAttached = true;
    document.addEventListener('click', enhanceNativeReplyAction, true);
  }

  function isMarkdownMode(editor) {
    const form = editor.closest('form');
    const explicit = form?.querySelector('[data-markdown="true"], [data-mode="markdown"], input[name*="markdown"]:checked, input[id*="markdown"]:checked');
    if (explicit) return true;
    const activeButton = [...(form?.querySelectorAll('button, a, label') || [])].find((node) => node.classList.contains('active') && /markdown/i.test(node.textContent));
    if (activeButton) return true;
    return editor.id === 'topic_content' && !editor.closest('form')?.querySelector('[data-mode="plain"]');
  }

  function updateAllEditorStatuses(message) {
    document.querySelectorAll('.wt-v2ex-upload-status').forEach((status) => {
      status.textContent = message;
    });
    document.querySelectorAll('.wt-v2ex-editor-tools').forEach((tools) => {
      tools.hidden = !runtime.settings.uploaderEnabled;
      const configure = tools.querySelector('.wt-v2ex-configure-imgur');
      if (configure) configure.hidden = Boolean(runtime.settings.imgurClientId);
    });
  }

  function setUploadStatus(editor, message, type = '') {
    const status = editor.parentElement?.querySelector('.wt-v2ex-upload-status');
    if (!status) return;
    status.className = `wt-v2ex-upload-status ${type ? `wt-v2ex-upload-status-${type}` : ''}`.trim();
    status.textContent = message;
  }

  function describeUploadError(error) {
    if (error.code === 'client-id') return 'Imgur Client ID 无效';
    if (error.code === 'quota') return 'Imgur 上传额度已用尽';
    if (error.code === 'too-large') return '图片过大，未上传';
    if (error.code === 'timeout') return '网络超时';
    if (error.code === 'network' || error.code === 'server') return 'Imgur 暂时不可用';
    return error.message || '响应格式异常';
  }

  function requestImgur(file, retry = 0) {
    return new Promise((resolve, reject) => {
      if (!runtime.settings.imgurClientId) {
        reject(Object.assign(new Error('需要 Client ID'), { code: 'client-id' }));
        return;
      }
      const form = new FormData();
      form.append('image', file, file.name || 'image');
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.imgur.com/3/image',
        headers: { Authorization: `Client-ID ${runtime.settings.imgurClientId}` },
        data: form,
        timeout: UPLOAD_TIMEOUT_MS,
        onload(response) {
          let payload;
          try {
            payload = JSON.parse(response.responseText || '{}');
          } catch (error) {
            reject(Object.assign(new Error('响应格式异常'), { code: 'format' }));
            return;
          }
          if (response.status === 401 || response.status === 403) {
            reject(Object.assign(new Error('Imgur Client ID 无效'), { code: 'client-id' }));
            return;
          }
          if (response.status === 429) {
            reject(Object.assign(new Error('Imgur 上传额度已用尽'), { code: 'quota' }));
            return;
          }
          if (response.status === 413) {
            reject(Object.assign(new Error('图片过大'), { code: 'too-large' }));
            return;
          }
          if (response.status >= 500 && retry < 1) {
            requestImgur(file, retry + 1).then(resolve, reject);
            return;
          }
          const link = payload?.data?.link;
          const successfulStatus = response.status >= 200 && response.status < 300;
          if (!successfulStatus || payload?.success === false || !/^https:\/\//i.test(link || '')) {
            reject(Object.assign(new Error('响应格式异常'), { code: response.status >= 500 ? 'server' : 'format' }));
            return;
          }
          resolve(link);
        },
        onerror() {
          if (retry < 1) requestImgur(file, retry + 1).then(resolve, reject);
          else reject(Object.assign(new Error('网络不可用'), { code: 'network' }));
        },
        ontimeout() {
          if (retry < 1) requestImgur(file, retry + 1).then(resolve, reject);
          else reject(Object.assign(new Error('网络超时'), { code: 'timeout' }));
        }
      });
    });
  }

  function validateImage(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return Object.assign(new Error('只支持图片文件'), { code: 'type' });
    if (file.size > MAX_IMAGE_BYTES) return Object.assign(new Error('图片超过 10 MiB，未上传'), { code: 'too-large' });
    return null;
  }

  async function uploadFiles(editor, files, control) {
    const validFiles = [...files];
    if (!validFiles.length) return;
    if (!runtime.settings.imgurClientId) {
      setUploadStatus(editor, '需要 Imgur Client ID，图片未发送。', 'error');
      return;
    }
    if (control) control.disabled = true;
    const notice = editor.parentElement?.querySelector('.wt-v2ex-privacy-note');
    if (notice) notice.hidden = false;
    let inserted = 0;
    for (let index = 0; index < validFiles.length; index += 1) {
      const file = validFiles[index];
      const validationError = validateImage(file);
      if (validationError) {
        setUploadStatus(editor, describeUploadError(validationError), 'error');
        continue;
      }
      setUploadStatus(editor, `正在上传 ${index + 1} / ${validFiles.length}`);
      try {
        const link = await requestImgur(file);
        const insertion = isMarkdownMode(editor) ? `![image](${link})` : link;
        const separator = editor.value && !/[\n\r]$/.test(editor.value) ? '\n' : '';
        insertAtSelection(editor, `${separator}${insertion}\n`);
        inserted += 1;
        setUploadStatus(editor, `上传成功 ${inserted} / ${validFiles.length}`, 'success');
      } catch (error) {
        setUploadStatus(editor, describeUploadError(error), 'error');
      }
    }
    if (control) control.disabled = false;
  }

  function editorFilesFromPaste(event) {
    return [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  function addEditorUpload(editor) {
    if (!runtime.settings.uploaderEnabled || runtime.enhancedEditors.has(editor) || !isSupportedEditor(editor)) return;
    runtime.enhancedEditors.add(editor);
    const tools = document.createElement('div');
    tools.className = 'wt-v2ex-editor-tools';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wt-v2ex-upload-button';
    button.textContent = '上传图片';
    button.setAttribute('aria-label', '上传图片到 Imgur');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.className = 'wt-v2ex-file-input';
    input.setAttribute('aria-label', '选择要上传的图片');
    const status = document.createElement('div');
    status.className = 'wt-v2ex-upload-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = runtime.settings.imgurClientId ? '准备上传' : '未设置 Imgur Client ID';
    const privacy = document.createElement('div');
    privacy.className = 'wt-v2ex-privacy-note';
    privacy.hidden = true;
    privacy.textContent = '图片会发送到第三方 Imgur；匿名上传不等于私密存储，请勿上传敏感内容。';
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      void uploadFiles(editor, input.files, button).finally(() => { input.value = ''; });
    });
    editor.addEventListener('paste', (event) => {
      if (!runtime.settings.uploaderEnabled) return;
      const files = editorFilesFromPaste(event);
      if (!files.length) return;
      event.preventDefault();
      void uploadFiles(editor, files, button);
    });
    editor.addEventListener('dragover', (event) => {
      if (!runtime.settings.uploaderEnabled) return;
      if ([...(event.dataTransfer?.types || [])].includes('Files')) {
        event.preventDefault();
        tools.classList.add('wt-v2ex-editor-dragging');
      }
    });
    editor.addEventListener('dragleave', () => tools.classList.remove('wt-v2ex-editor-dragging'));
    editor.addEventListener('drop', (event) => {
      if (!runtime.settings.uploaderEnabled) return;
      tools.classList.remove('wt-v2ex-editor-dragging');
      const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      void uploadFiles(editor, files, button);
    });
    const configure = document.createElement('button');
    configure.type = 'button';
    configure.className = 'wt-v2ex-configure-imgur';
    configure.textContent = '设置 Client ID';
    configure.setAttribute('aria-label', '设置 Imgur Client ID');
    configure.hidden = Boolean(runtime.settings.imgurClientId);
    configure.addEventListener('click', configureClientId);
    tools.append(button, input, status, configure, privacy);
    editor.insertAdjacentElement('afterend', tools);
  }

  function scanEditors() {
    document.querySelectorAll('.wt-v2ex-editor-tools').forEach((tools) => {
      tools.hidden = !runtime.settings.uploaderEnabled;
    });
    if (!runtime.settings.uploaderEnabled) return;
    allMatches(document, SELECTORS.editor).filter(isSupportedEditor).forEach(addEditorUpload);
  }

  function observeEditors() {
    scanEditors();
    if (!document.body || runtime.editorObserver) return;
    runtime.editorObserver = new MutationObserver(() => {
      if (runtime.editorScanFrame) return;
      runtime.editorScanFrame = requestAnimationFrame(() => {
        runtime.editorScanFrame = 0;
        scanEditors();
      });
    });
    const editorRoot = document.querySelector('#Main, #Wrapper') || document.body;
    runtime.editorObserver.observe(editorRoot, { childList: true, subtree: true });
  }

  function updateScrollButton() {
    if (!runtime.scrollButton) return;
    runtime.scrollButton.hidden = !runtime.settings.scrollTopEnabled || window.scrollY < SCROLL_THRESHOLD;
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
    window.addEventListener('scroll', () => {
      if (runtime.scrollFrame) return;
      runtime.scrollFrame = requestAnimationFrame(() => {
        runtime.scrollFrame = 0;
        updateScrollButton();
      });
    }, { passive: true });
    updateScrollButton();
  }

  function addStyles() {
    const css = `
      .wt-v2ex-control-dock { position:fixed; z-index:1000; right:max(16px, env(safe-area-inset-right)); bottom:max(16px, env(safe-area-inset-bottom)); display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
      .wt-v2ex-conversation-toggle, .wt-v2ex-scroll-top { border:1px solid rgba(127,127,127,.4); background:var(--v2ex-background-color,#fff); color:inherit; box-shadow:0 3px 12px rgba(0,0,0,.16); cursor:pointer; }
      .wt-v2ex-conversation-toggle { min-width:42px; min-height:34px; border-radius:17px; padding:5px 10px; }
      .wt-v2ex-scroll-top { width:42px; height:42px; border-radius:50%; font-size:20px; line-height:1; }
      .wt-v2ex-conversation-panel { position:absolute; right:0; bottom:calc(100% + 8px); width:min(320px, calc(100vw - 24px)); max-height:min(70vh, 560px); overflow:auto; display:grid; gap:9px; padding:12px; border:1px solid rgba(127,127,127,.28); border-radius:7px; background:var(--v2ex-background-color,#fff); color:var(--v2ex-text-color,#333); box-shadow:0 5px 20px rgba(0,0,0,.2); }
      .wt-v2ex-conversation-panel[hidden] { display:none !important; }
      .wt-v2ex-conversation-panel-title { font-weight:600; }
      .wt-v2ex-conversation-panel-group { display:flex; flex-wrap:wrap; gap:6px; }
      .wt-v2ex-panel-action { border:1px solid rgba(127,127,127,.35); border-radius:4px; padding:5px 8px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
      .wt-v2ex-panel-action:hover, .wt-v2ex-panel-action[aria-pressed="true"] { background:rgba(127,127,127,.12); }
      .wt-v2ex-upload-button, .wt-v2ex-configure-imgur { border:1px solid rgba(127,127,127,.35); border-radius:4px; padding:5px 9px; background:transparent; color:inherit; cursor:pointer; font:inherit; }
      .wt-v2ex-upload-button:hover, .wt-v2ex-configure-imgur:hover { background:rgba(127,127,127,.12); }
      .wt-v2ex-thread-status { color:#666; font-size:12px; }
      .wt-v2ex-threaded-view { margin:10px 0; }
      #Main .cell[id^="r_"].wt-v2ex-native-hidden, #Wrapper .cell[id^="r_"].wt-v2ex-native-hidden { display:none !important; }
      .wt-v2ex-threaded-reply { position:relative; }
      .wt-v2ex-threaded-reply .wt-v2ex-reply-header { display:flex; flex-wrap:wrap; align-items:baseline; gap:0 7px; margin-bottom:5px; }
      .wt-v2ex-threaded-reply .wt-v2ex-native-reply-controls { float:none; order:999; display:inline-flex; flex:0 0 auto; align-items:center; gap:5px; margin-left:auto; white-space:nowrap; }
      .wt-v2ex-threaded-reply .wt-v2ex-native-reply-action:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
      .wt-v2ex-threaded-reply .wt-v2ex-native-reply-action:hover { opacity:.72; }
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
      .wt-v2ex-panel-action:focus-visible, .wt-v2ex-upload-button:focus-visible, .wt-v2ex-configure-imgur:focus-visible, .wt-v2ex-conversation-toggle:focus-visible, .wt-v2ex-scroll-top:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
      .wt-v2ex-editor-tools { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin:6px 0 10px; padding:5px 0; color:inherit; font-size:12px; }
      .wt-v2ex-file-input { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); }
      .wt-v2ex-upload-status { color:#666; }
      .wt-v2ex-upload-status-error { color:#a33; }
      .wt-v2ex-upload-status-success { color:#176b3a; }
      .wt-v2ex-privacy-note { flex-basis:100%; color:#805b00; }
      .wt-v2ex-editor-dragging { outline:2px dashed #1677ff; outline-offset:3px; }
      @media (max-width:600px) { .wt-v2ex-control-dock { right:max(10px, env(safe-area-inset-right)); bottom:max(10px, env(safe-area-inset-bottom)); } .wt-v2ex-conversation-panel { max-height:60vh; } .wt-v2ex-threaded-view { width:calc(100vw - 40px); max-width:calc(100vw - 40px); overflow-x:hidden; } .wt-v2ex-threaded-reply { box-sizing:border-box; max-width:100%; min-width:0; overflow:hidden; } .wt-v2ex-threaded-reply table { width:100%; max-width:100%; table-layout:fixed; } .wt-v2ex-threaded-reply .wt-v2ex-reply-header { min-width:0; } .wt-v2ex-threaded-reply .wt-v2ex-native-reply-controls { max-width:100%; } }
      @media (prefers-color-scheme:dark) { .wt-v2ex-conversation-panel, .wt-v2ex-conversation-toggle, .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); } .wt-v2ex-thread-status, .wt-v2ex-upload-status { color:#aaa; } }
      html.night .wt-v2ex-conversation-panel, html.night .wt-v2ex-conversation-toggle, html.night .wt-v2ex-scroll-top, body.night .wt-v2ex-conversation-panel, body.night .wt-v2ex-conversation-toggle, body.night .wt-v2ex-scroll-top, [data-theme="dark"] .wt-v2ex-conversation-panel, [data-theme="dark"] .wt-v2ex-conversation-toggle, [data-theme="dark"] .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); }
      @media (prefers-reduced-motion:reduce) { .wt-v2ex-scroll-top { scroll-behavior:auto; } }
    `;
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const style = document.createElement('style'); style.textContent = css; document.head.append(style); }
  }

  async function initialize() {
    if (document.documentElement.dataset.wtV2exInitialized === 'true') return;
    document.documentElement.dataset.wtV2exInitialized = 'true';
    addStyles();
    registerMenuCommands();
    attachNativeReplyEnhancer();
    observeNavigation();
    try {
      await initializeTopic();
      if (runtime.topic) createConversationControl(runtime.topic);
    } catch (error) {
      if (runtime.topic) {
        runtime.topic.failed = true;
        applyTopicView(runtime.topic, 'original');
        createConversationControl(runtime.topic);
      }
      logError(error);
    }
    try { observeEditors(); } catch (error) { logError(error); }
    try { if (runtime.settings.scrollTopEnabled) initializeScrollToTop(); } catch (error) { logError(error); }
  }

  initialize();
})();
