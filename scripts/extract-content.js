(function () {
  const MAX_OUTPUT = 20000;
  const MIN_BLOCK_LEN = 40;

  const BLOCK_TAGS = new Set([
    'p', 'article', 'section', 'main', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre',
  ]);
  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed',
    'nav', 'header', 'footer', 'aside', 'form', 'button', 'input', 'select',
    'textarea', 'svg', 'canvas', 'video', 'audio',
  ]);
  const JUNK_PATTERN = /^(cookie|privacy|policy|terms|consent|advert|sponsored|share|subscribe|sign\s?up|log\s?in|register|menu|search|skip\s+to|related\s+articles|read\s+more|comments?)\b/i;
  const NEGATIVE_CLASS = /\b(nav|menu|sidebar|footer|header|comment|cookie|consent|banner|promo|advert|ad-|popup|modal|share|social|related|recommend|hidden|tooltip|breadcrumb)\b/i;
  const POSITIVE_CLASS = /\b(article|content|post|story|entry|main|body|prose|markdown)\b/i;

  function clip(text) {
    return text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) : text;
  }

  function safeText(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\s+/g, ' ').trim();
  }

  function getMeta() {
    const pick = (selector) => {
      const el = document.querySelector(selector);
      return el ? safeText(el.getAttribute('content') || '') : '';
    };
    return {
      title: safeText(document.title || ''),
      ogTitle: pick('meta[property="og:title"]'),
      ogDescription: pick('meta[property="og:description"]'),
      ogType: pick('meta[property="og:type"]'),
      description: pick('meta[name="description"]'),
      keywords: pick('meta[name="keywords"]'),
    };
  }

  function getJsonLd() {
    const blocks = [];
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const parsed = JSON.parse(s.textContent || '');
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const fields = [];
          if (typeof item.headline === 'string') fields.push(item.headline);
          if (typeof item.name === 'string') fields.push(item.name);
          if (typeof item.description === 'string') fields.push(item.description);
          if (typeof item.articleBody === 'string') fields.push(item.articleBody);
          if (fields.length) blocks.push(fields.map(safeText).join('. '));
        }
      } catch {}
    }
    return blocks.join('\n');
  }

  function classScore(el) {
    const sig = `${el.className || ''} ${el.id || ''}`.toLowerCase();
    if (!sig.trim()) return 0;
    if (NEGATIVE_CLASS.test(sig)) return -25;
    if (POSITIVE_CLASS.test(sig)) return 25;
    return 0;
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return true;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  function blockText(el) {
    const linkLen = Array.from(el.querySelectorAll('a'))
      .reduce((n, a) => n + (a.textContent || '').length, 0);
    const txt = safeText(el.textContent || '');
    if (txt.length < MIN_BLOCK_LEN) return '';
    if (linkLen / Math.max(1, txt.length) > 0.5) return '';
    return txt;
  }

  function densityExtract() {
    const root = document.body;
    if (!root) return '';

    const candidates = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const tag = node.tagName.toLowerCase();
        if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
        if (!isVisible(node)) return NodeFilter.FILTER_REJECT;
        if (BLOCK_TAGS.has(tag)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = blockText(node);
      if (!text) continue;
      let parent = node.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        const prev = candidates.get(parent) || 0;
        candidates.set(parent, prev + text.length + classScore(parent));
        parent = parent.parentElement;
        depth++;
      }
    }

    let bestEl = null;
    let bestScore = 0;
    for (const [el, score] of candidates) {
      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }
    if (!bestEl) return '';

    const chunks = [];
    const inner = document.createTreeWalker(bestEl, NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (SKIP_TAGS.has(n.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        if (!BLOCK_TAGS.has(n.tagName.toLowerCase())) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let b;
    while ((b = inner.nextNode())) {
      const t = blockText(b);
      if (t && !JUNK_PATTERN.test(t)) chunks.push(t);
    }
    return chunks.join('\n');
  }

  function semanticExtract() {
    const article = document.querySelector('article, main, [role="main"]');
    if (!article) return '';
    const chunks = [];
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (SKIP_TAGS.has(n.tagName.toLowerCase())) return NodeFilter.FILTER_REJECT;
        if (!BLOCK_TAGS.has(n.tagName.toLowerCase())) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      const t = blockText(n);
      if (t && !JUNK_PATTERN.test(t)) chunks.push(t);
    }
    return chunks.join('\n');
  }

  function extractYouTube() {
    const title = safeText(document.querySelector('h1.ytd-watch-metadata, h1.title')?.textContent || '');
    const desc = safeText(document.querySelector('#description-inline-expander, ytd-text-inline-expander')?.textContent || '');
    if (!title && !desc) return '';
    return [title, desc].filter(Boolean).join('\n');
  }

  function extractReddit() {
    const post = safeText(document.querySelector('shreddit-post, [data-testid="post-container"]')?.textContent || '');
    const comments = Array.from(document.querySelectorAll('shreddit-comment, [data-testid="comment"]'))
      .slice(0, 5)
      .map(c => safeText(c.textContent || ''))
      .filter(t => t.length > 30)
      .join('\n');
    return [post, comments].filter(Boolean).join('\n');
  }

  function siteRoute() {
    const host = location.hostname;
    if (/(^|\.)youtube\.com$/.test(host)) return extractYouTube();
    if (/(^|\.)reddit\.com$/.test(host)) return extractReddit();
    return '';
  }

  function buildOutput() {
    const meta = getMeta();
    const header = [meta.ogTitle || meta.title, meta.ogDescription || meta.description]
      .filter(Boolean)
      .join('\n');

    const routed = siteRoute();
    if (routed && routed.length > 200) return clip(`${header}\n\n${routed}`);

    const jsonLd = getJsonLd();
    const semantic = semanticExtract();
    const dense = semantic.length >= 400 ? semantic : densityExtract();

    const body = [jsonLd, dense].filter(b => b && b.length > 100).join('\n\n');
    const combined = [header, body].filter(Boolean).join('\n\n').trim();
    return clip(combined);
  }

  function getExtracted() {
    try {
      return buildOutput();
    } catch {
      return '';
    }
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === 'EXTRACT_VISIBLE_TEXT') {
      sendResponse({ text: getExtracted() });
    }
  });
})();
