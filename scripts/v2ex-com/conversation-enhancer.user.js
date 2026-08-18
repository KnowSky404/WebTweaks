// ==UserScript==
// @name         V2EX Conversation Enhancer
// @name:zh-CN   V2EX 会话增强
// @namespace    https://github.com/KnowSky404/WebTweaks
// @version      1.0.0
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
    scrollButton: null,
    scrollFrame: 0,
    nativeReplyListenerAttached: false
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

  function parseReply(element, page, context) {
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
      id: idMatch ? idMatch[1] : `${page}-${floor || Math.random().toString(36).slice(2)}`,
      floor,
      page,
      author,
      normalizedAuthor: normalizeName(author),
      avatarUrl: safeUrl(firstMatch(element, SELECTORS.replyAvatar)?.getAttribute('src'), 'image'),
      timeText: firstMatch(element, SELECTORS.replyTime)?.getAttribute('title') || firstMatch(element, SELECTORS.replyTime)?.textContent.trim() || '',
      contentHtml: sanitizeContent(content),
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
      originalUrl: new URL(`/t/${context.id}?p=${page}#r_${encodeURIComponent(idMatch ? idMatch[1] : '')}`, location.origin).href
    };
  }

  function parseReplies(root, page, context) {
    const elements = root instanceof Document ? allMatches(root, SELECTORS.reply) : allMatches(root, SELECTORS.reply);
    return elements.map((element) => parseReply(element, page, context)).filter(Boolean);
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
          const replies = parseReplies(parsed, page, topic.context);
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

  function createTopicToolbar(topic) {
    const toolbar = document.createElement('div');
    toolbar.className = 'wt-v2ex-thread-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML = `
      <div class="wt-v2ex-thread-toolbar-title">会话视图</div>
      <div class="wt-v2ex-thread-toolbar-actions">
        <button type="button" class="wt-v2ex-thread-action" data-view="threaded" aria-label="切换到楼中楼" aria-pressed="false">楼中楼</button>
        <button type="button" class="wt-v2ex-thread-action" data-view="original" aria-label="切换到原始顺序" aria-pressed="false">原始顺序</button>
        <button type="button" class="wt-v2ex-thread-action" data-expand="all" aria-label="展开全部分支">全部展开</button>
        <button type="button" class="wt-v2ex-thread-action" data-expand="none" aria-label="折叠全部分支">全部折叠</button>
        <button type="button" class="wt-v2ex-thread-action wt-v2ex-load-pages" hidden aria-label="加载全部分页">加载全部分页</button>
      </div>
      <div class="wt-v2ex-thread-status" role="status" aria-live="polite">准备构建楼中楼</div>`;
    toolbar.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !toolbar.contains(button)) return;
      if (button.dataset.view) {
        runtime.settings.preferredView = button.dataset.view;
        saveSettings();
        applyTopicView(topic, button.dataset.view);
      } else if (button.dataset.expand) {
        setAllBranches(topic, button.dataset.expand === 'all');
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
    return toolbar;
  }

  function setTopicStatus(topic, message) {
    const status = topic.toolbar?.querySelector('.wt-v2ex-thread-status');
    if (status) status.textContent = message;
  }

  function updateTopicToolbar(topic) {
    topic.toolbar.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === topic.view;
      button.setAttribute('aria-pressed', String(active));
    });
    const loadButton = topic.toolbar.querySelector('.wt-v2ex-load-pages');
    if (loadButton) {
      loadButton.hidden = !topic.incomplete || topic.loading;
      loadButton.textContent = topic.loading ? '正在加载…' : `加载全部 ${topic.maxPage} 页并构建楼中楼`;
    }
  }

  function relationshipLabel(reply) {
    if (reply.relationshipConfidence === 'exact') return `回复 #${reply.explicitReplyFloor}`;
    if (reply.relationshipConfidence === 'inferred') return '推断回复';
    if (reply.relationshipConfidence === 'unresolved') return '关系未确定';
    return '';
  }

  function createReplyCard(reply, depth) {
    const article = document.createElement('article');
    article.className = `wt-v2ex-reply-card wt-v2ex-depth-${Math.min(depth, 6)}`;
    article.dataset.replyId = reply.id;
    article.setAttribute('aria-label', `第 ${reply.floor || '未知'} 楼，${reply.author || '未知用户'}`);
    const avatar = document.createElement('img');
    avatar.className = 'wt-v2ex-reply-avatar';
    avatar.alt = reply.author ? `${reply.author} 的头像` : '用户头像';
    avatar.loading = 'lazy';
    if (reply.avatarUrl) avatar.src = reply.avatarUrl;
    else avatar.hidden = true;
    const body = document.createElement('div');
    body.className = 'wt-v2ex-reply-body';
    const header = document.createElement('div');
    header.className = 'wt-v2ex-reply-header';
    const identity = document.createElement('span');
    identity.className = 'wt-v2ex-reply-identity';
    identity.textContent = reply.author || '未知用户';
    const floor = document.createElement('span');
    floor.className = 'wt-v2ex-reply-floor';
    floor.textContent = `#${reply.floor || '?'}`;
    header.append(identity, floor);
    if (reply.page > 1) {
      const page = document.createElement('span');
      page.className = 'wt-v2ex-reply-page';
      page.textContent = `第 ${reply.page} 页`;
      header.append(page);
    }
    const time = document.createElement('time');
    time.className = 'wt-v2ex-reply-time';
    time.textContent = reply.timeText;
    if (reply.timeText) time.dateTime = reply.timeText;
    header.append(time);
    const relation = relationshipLabel(reply);
    if (relation) {
      const badge = document.createElement('span');
      badge.className = `wt-v2ex-relation wt-v2ex-relation-${reply.relationshipConfidence}`;
      badge.textContent = relation;
      if (reply.unresolvedReason) badge.title = reply.unresolvedReason;
      header.append(badge);
    }
    const content = document.createElement('div');
    content.className = 'wt-v2ex-reply-content';
    content.innerHTML = reply.contentHtml;
    const actions = document.createElement('div');
    actions.className = 'wt-v2ex-reply-actions';
    const replyButton = document.createElement('button');
    replyButton.type = 'button';
    replyButton.className = 'wt-v2ex-reply-action';
    replyButton.textContent = '回复';
    replyButton.setAttribute('aria-label', `回复 ${reply.author || '该用户'} 第 ${reply.floor || ''} 楼`);
    replyButton.dataset.replyUser = reply.author;
    replyButton.dataset.replyFloor = String(reply.floor || '');
    const original = document.createElement('a');
    original.className = 'wt-v2ex-original-link';
    original.href = reply.originalUrl;
    original.textContent = '定位原楼';
    original.target = '_self';
    actions.append(replyButton, original);
    body.append(header, content, actions);
    article.append(avatar, body);
    if (reply.children.length) {
      const branchButton = document.createElement('button');
      branchButton.type = 'button';
      branchButton.className = 'wt-v2ex-branch-toggle';
      branchButton.textContent = `折叠 ${reply.children.length} 条回复`;
      branchButton.setAttribute('aria-expanded', 'true');
      branchButton.setAttribute('aria-label', `展开或折叠第 ${reply.floor || ''} 楼的回复`);
      const children = document.createElement('div');
      children.className = 'wt-v2ex-thread-children';
      children.dataset.expanded = 'true';
      branchButton.addEventListener('click', () => {
        const expanded = children.dataset.expanded === 'true';
        children.dataset.expanded = String(!expanded);
        children.hidden = expanded;
        branchButton.setAttribute('aria-expanded', String(!expanded));
        branchButton.textContent = `${expanded ? '展开' : '折叠'} ${reply.children.length} 条回复`;
      });
      body.append(branchButton);
      return { article, children };
    }
    return { article, children: null };
  }

  function renderThreadedView(topic) {
    topic.threadedView.replaceChildren();
    const fragment = document.createDocumentFragment();
    const stack = [...topic.roots].reverse().map((reply) => ({ reply, target: fragment, depth: 0 }));
    while (stack.length) {
      const { reply, target, depth } = stack.pop();
      const rendered = createReplyCard(reply, depth);
      target.append(rendered.article);
      if (reply.children.length && rendered.children) {
        rendered.article.querySelector('.wt-v2ex-reply-body').append(rendered.children);
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
    topic.nativeReplies.forEach((reply) => reply.classList.toggle('wt-v2ex-native-hidden', view === 'threaded'));
    updateTopicToolbar(topic);
  }

  function setAllBranches(topic, expanded) {
    topic.threadedView.querySelectorAll('.wt-v2ex-thread-children').forEach((children) => {
      children.hidden = !expanded;
      children.dataset.expanded = String(expanded);
    });
    topic.threadedView.querySelectorAll('.wt-v2ex-branch-toggle').forEach((button) => {
      button.setAttribute('aria-expanded', String(expanded));
      const count = button.textContent.match(/\d+/)?.[0] || '';
      button.textContent = `${expanded ? '折叠' : '展开'} ${count} 条回复`;
    });
  }

  async function loadAllTopicPages(topic) {
    if (topic.loading || !topic.incomplete) return;
    topic.loading = true;
    updateTopicToolbar(topic);
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
    updateTopicToolbar(topic);
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
    const topic = {
      context,
      key: context.key,
      nativeReplies,
      toolbar: null,
      threadedView,
      pages: discoverPages(context).pages,
      maxPage: discoverPages(context).maxPage,
      loadedPages: new Set([context.page]),
      replies: parseReplies(document, context.page, context),
      models: [],
      roots: [],
      view: 'original',
      loading: false,
      incomplete: false,
      failed: false,
      duplicateIds: 0
    };
    // The toolbar event closures need the completed topic object.
    topic.toolbar = createTopicToolbar(topic);
    firstReply.before(topic.toolbar, threadedView);
    runtime.topic = topic;
    topic.models = inferRelationships(topic.replies);
    topic.roots = topic.models.filter((reply) => !reply.parentId);
    renderThreadedView(topic);
    if (topic.maxPage > 10) {
      topic.incomplete = true;
      setTopicStatus(topic, `当前显示第 ${context.page} 页；完整关系需要加载全部 ${topic.maxPage} 页`);
      updateTopicToolbar(topic);
    } else if (topic.pages.length > 1) {
      topic.incomplete = true;
      updateTopicToolbar(topic);
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
    topic.threadedView.addEventListener('click', (event) => {
      const button = event.target.closest('.wt-v2ex-reply-action');
      if (button) insertReplyPrefix(findEditor(), button.dataset.replyUser, Number(button.dataset.replyFloor));
    });
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
    document.body.append(button);
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
      .wt-v2ex-thread-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:10px 0; padding:10px 12px; border:1px solid rgba(127,127,127,.24); border-radius:6px; background:var(--v2ex-background-color,#fff); color:var(--v2ex-text-color,#333); }
      .wt-v2ex-thread-toolbar-title { font-weight:600; margin-right:auto; }
      .wt-v2ex-thread-toolbar-actions { display:flex; flex-wrap:wrap; gap:6px; }
      .wt-v2ex-thread-action, .wt-v2ex-reply-action, .wt-v2ex-original-link, .wt-v2ex-upload-button, .wt-v2ex-configure-imgur, .wt-v2ex-branch-toggle { border:1px solid rgba(127,127,127,.35); border-radius:4px; padding:5px 9px; background:transparent; color:inherit; cursor:pointer; font:inherit; text-decoration:none; }
      .wt-v2ex-thread-action:hover, .wt-v2ex-reply-action:hover, .wt-v2ex-original-link:hover, .wt-v2ex-upload-button:hover, .wt-v2ex-configure-imgur:hover, .wt-v2ex-branch-toggle:hover { background:rgba(127,127,127,.12); }
      .wt-v2ex-thread-action:focus-visible, .wt-v2ex-reply-action:focus-visible, .wt-v2ex-original-link:focus-visible, .wt-v2ex-upload-button:focus-visible, .wt-v2ex-configure-imgur:focus-visible, .wt-v2ex-branch-toggle:focus-visible, .wt-v2ex-scroll-top:focus-visible { outline:2px solid #1677ff; outline-offset:2px; }
      .wt-v2ex-thread-action[aria-pressed="true"] { background:rgba(22,119,255,.14); border-color:#1677ff; }
      .wt-v2ex-thread-status { flex-basis:100%; color:#666; font-size:12px; }
      .wt-v2ex-threaded-view { margin:10px 0; }
      .wt-v2ex-native-hidden { display:none; }
      .wt-v2ex-reply-card { display:flex; gap:10px; margin:8px 0; padding:10px; border:1px solid rgba(127,127,127,.22); border-radius:6px; background:var(--v2ex-background-color,#fff); color:var(--v2ex-text-color,#333); }
      .wt-v2ex-reply-avatar { flex:0 0 40px; width:40px; height:40px; border-radius:4px; object-fit:cover; background:rgba(127,127,127,.12); }
      .wt-v2ex-reply-body { min-width:0; flex:1; }
      .wt-v2ex-reply-header { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-bottom:7px; font-size:12px; }
      .wt-v2ex-reply-identity { font-weight:600; }
      .wt-v2ex-reply-floor, .wt-v2ex-reply-page, .wt-v2ex-reply-time { color:#777; }
      .wt-v2ex-relation { padding:2px 5px; border-radius:3px; font-size:11px; border:1px solid rgba(127,127,127,.3); }
      .wt-v2ex-relation-exact { color:#176b3a; }
      .wt-v2ex-relation-inferred { color:#805b00; }
      .wt-v2ex-relation-unresolved { color:#9b2c2c; }
      .wt-v2ex-reply-content { overflow-wrap:anywhere; line-height:1.55; }
      .wt-v2ex-reply-content img { max-width:100%; height:auto; }
      .wt-v2ex-reply-content pre { overflow:auto; }
      .wt-v2ex-reply-actions { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
      .wt-v2ex-thread-children { margin-top:8px; padding-left:10px; border-left:2px solid rgba(22,119,255,.28); }
      .wt-v2ex-depth-6 { border-left:3px solid rgba(127,127,127,.4); }
      .wt-v2ex-branch-toggle { margin-top:8px; font-size:12px; }
      .wt-v2ex-editor-tools { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin:6px 0 10px; padding:5px 0; color:inherit; font-size:12px; }
      .wt-v2ex-file-input { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); }
      .wt-v2ex-upload-status { color:#666; }
      .wt-v2ex-upload-status-error { color:#a33; }
      .wt-v2ex-upload-status-success { color:#176b3a; }
      .wt-v2ex-privacy-note { flex-basis:100%; color:#805b00; }
      .wt-v2ex-editor-dragging { outline:2px dashed #1677ff; outline-offset:3px; }
      .wt-v2ex-scroll-top { position:fixed; z-index:1000; right:max(16px, env(safe-area-inset-right)); bottom:max(16px, env(safe-area-inset-bottom)); width:42px; height:42px; border:1px solid rgba(127,127,127,.4); border-radius:50%; background:var(--v2ex-background-color,#fff); color:inherit; box-shadow:0 3px 12px rgba(0,0,0,.16); cursor:pointer; font-size:20px; line-height:1; }
      @media (max-width:600px) { .wt-v2ex-scroll-top { right:max(10px, env(safe-area-inset-right)); bottom:max(10px, env(safe-area-inset-bottom)); } .wt-v2ex-reply-card { padding:8px; } .wt-v2ex-reply-avatar { flex-basis:32px; width:32px; height:32px; } }
      @media (prefers-color-scheme:dark) { .wt-v2ex-thread-toolbar, .wt-v2ex-reply-card, .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); } .wt-v2ex-thread-status, .wt-v2ex-reply-floor, .wt-v2ex-reply-page, .wt-v2ex-reply-time, .wt-v2ex-upload-status { color:#aaa; } }
      html.night .wt-v2ex-thread-toolbar, html.night .wt-v2ex-reply-card, html.night .wt-v2ex-scroll-top, body.night .wt-v2ex-thread-toolbar, body.night .wt-v2ex-reply-card, body.night .wt-v2ex-scroll-top, [data-theme="dark"] .wt-v2ex-thread-toolbar, [data-theme="dark"] .wt-v2ex-reply-card, [data-theme="dark"] .wt-v2ex-scroll-top { background:#202124; color:#e7e7e7; border-color:rgba(255,255,255,.2); }
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
    try { await initializeTopic(); } catch (error) { if (runtime.topic) { runtime.topic.failed = true; applyTopicView(runtime.topic, 'original'); } logError(error); }
    try { observeEditors(); } catch (error) { logError(error); }
    try { if (runtime.settings.scrollTopEnabled) initializeScrollToTop(); } catch (error) { logError(error); }
  }

  initialize();
})();
