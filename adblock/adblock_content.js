if (typeof browser === 'undefined') {
  var browser = chrome;
}

function injectCss(selectors) {
  if (!selectors || selectors.length === 0) return;
  const style = document.createElement('style');
  style.textContent = selectors.map(s => `${s} { display: none !important; visibility: hidden !important; height: 0 !important; width: 0 !important; opacity: 0 !important; pointer-events: none !important; }`).join('\n');
  (document.head || document.documentElement).appendChild(style);
}

function getPageLanguage() {
  return document.documentElement.lang.split('-')[0].toLowerCase();
}

function autoSkipVideoAds() {
  const trySkip = (root = document) => {
    const skipBtn = root.querySelector('.ytp-ad-skip-button');
    if (skipBtn) {
      skipBtn.click();
    }
    const closeBtns = root.querySelectorAll('.ytp-ad-overlay-close-button, .ytp-ad-overlay-slot .close-button');
    closeBtns.forEach(btn => btn.click());
  };
  return trySkip;
}

function guardWindowOpen() {
  let lastUserEventTs = 0;
  const markUserEvent = () => { lastUserEventTs = Date.now(); };
  ['click','mousedown','touchstart','keydown'].forEach(evt => {
    window.addEventListener(evt, markUserEvent, { capture: true, passive: true });
  });
  const origOpen = window.open;
  try {
    window.open = function(...args) {
      const now = Date.now();
      const userInitiated = (now - lastUserEventTs) < 1000;
      const url = args[0];
      if (!userInitiated || (url && isBadUrl(url))) {
        return null;
      }
      return origOpen.apply(window, args);
    };
  } catch (e) {}
}

function deepSanitize(o) {
  if (!o || typeof o !== 'object') return o;
  Object.keys(o).forEach(k => {
    const nk = k.toLowerCase();
    if (nk.includes('ad')) {
      const v = o[k];
      if (Array.isArray(v)) o[k] = [];
      else if (typeof v === 'object') o[k] = {};
      else o[k] = null;
    } else {
      deepSanitize(o[k]);
    }
  });
  return o;
}

function hookInitialPlayerResponse() {
  let val;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return val; },
      set(v) { val = deepSanitize(v); }
    });
  } catch (e) {}
  let dataVal;
  try {
    Object.defineProperty(window, 'ytInitialData', {
      configurable: true,
      get() { return dataVal; },
      set(v) { dataVal = deepSanitize(v); }
    });
  } catch (e) {}
}

function patchFetch() {
  const orig = window.fetch;
  if (!orig) return;
  window.fetch = async function(...args) {
    const req = args[0];
    const url = typeof req === 'string' ? req : (req && req.url);
    const r = await orig.apply(this, args);
    try {
      if (url && /\/youtubei\/.+\/(player|next)/.test(url)) {
        const clone = r.clone();
        const json = await clone.json();
        const cleaned = deepSanitize(json);
        const headers = new Headers(r.headers);
        headers.set('content-type', 'application/json');
        return new Response(JSON.stringify(cleaned), { status: r.status, statusText: r.statusText, headers });
      }
    } catch (e) {}
    return r;
  };
}

let isEnabled = true;
const WHITELIST = [
  'login', 'signin', 'auth', 'account', 'captcha', 'verify', 'payment', 'checkout', 'cart',
  'submit', 'button', 'menu', 'nav', 'header', 'footer', 'content', 'main', 'article'
];

function isWhitelisted(el) {
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toString().toLowerCase();
  const tag = el.tagName.toLowerCase();
  
  if (WHITELIST.some(w => id === w || cls === w)) return true;
  
  // Don't block very small elements that might be icons or structural
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.width < 10 && rect.height > 0 && rect.height < 10) return true;
  
  return false;
}

function injectAntiAntiAdblock() {
  // Hide adblocker presence from common scripts
  try {
    // 1. Fake successful ad load
    window.ya_direct_done = true;
    window.yandex_ad_done = true;
    
    // 2. Mock common ad variables
    const noop = () => {};
    const mockAdObject = {
      render: noop,
      init: noop,
      destroy: noop,
      get: () => ({})
    };
    
    window.Ya = window.Ya || {};
    window.Ya.Context = window.Ya.Context || { AdvManager: mockAdObject };
    window.Ya.adfoxCode = window.Ya.adfoxCode || mockAdObject;
    
    // 3. Prevent detection of blocked scripts
    const origCreateElement = document.createElement;
    document.createElement = function(tag) {
      const el = origCreateElement.call(document, tag);
      if (tag.toLowerCase() === 'script') {
        const origSetAttribute = el.setAttribute;
        el.setAttribute = function(name, value) {
          if (name === 'src' && (value.includes('an.yandex.ru') || value.includes('adfox.ru'))) {
            // If site tries to load ad script, pretend it's okay but don't load
            console.log('Anti-Anti-Adblock: Blocked ad script creation', value);
            setTimeout(() => {
              const event = new Event('load');
              el.dispatchEvent(event);
            }, 1);
            return;
          }
          return origSetAttribute.call(el, name, value);
        };
      }
      return el;
    };
    
    // 4. Override some common anti-adblock functions
    window.checkAdBlock = () => Promise.resolve(false);
    window.hasAdBlock = false;
    
  } catch (e) {}
}

async function main() {
  const settings = await browser.storage.local.get(['enabled', 'whitelist']);
  const whitelist = settings.whitelist || [];
  const isWhitelisted = whitelist.includes(location.hostname);
  
  // Initialize picker messaging FIRST so it's always available
  setupPickerMessaging();

  isEnabled = settings.enabled !== false && !isWhitelisted;
  
  injectAntiAntiAdblock();

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'setEnabled' || msg.action === 'whitelistChanged') {
      location.reload();
    }
  });

  if (!isEnabled) {
    return;
  }

  let allElementHidingSelectors = [];
  try {
    let rules;
    if (window.adblockRules) {
      rules = window.adblockRules;
    } else {
      const response = await fetch(browser.runtime.getURL('rules.json'));
      rules = await response.json();
    }
    const globalSelectors = rules.globalElementHidingSelectors || [];
    const pageLanguage = getPageLanguage();
    const languageSpecificSelectors = rules.languageSpecificElementHidingSelectors[pageLanguage] || [];
    allElementHidingSelectors = [...globalSelectors, ...languageSpecificSelectors];
    const nf = rules.networkFilters || [];
    if (Array.isArray(nf) && nf.length) {
      hosts = nf.map(s => String(s).toLowerCase());
    }
  } catch (e) {
    console.error('Failed to load rules.json:', e);
  }
  
  injectCss(allElementHidingSelectors);
  guardWindowOpen();
  hookInitialPlayerResponse();
  patchFetch();
  await applyUserRules();
  observeDOMChanges();
}

main();

async function applyUserRules() {
  try {
    const { userRules = {} } = await browser.storage.local.get('userRules');
    const host = location.hostname;
    const selectors = userRules[host] || [];
    if (selectors.length) {
      const style = document.createElement('style');
      style.textContent = selectors.map(s => `${s} { display: none !important; }`).join('\n');
      (document.head || document.documentElement).appendChild(style);
    }
  } catch (e) {}
}

function setupPickerMessaging() {
  let pickerEnabled = false;
  let hoverEl = null;
  let hoverBox = null;
  let menu = null;

  // Listen for the startPicker message INSIDE the function where picker logic lives
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'startPicker') {
      enablePicker();
    }
  });

  const makeHoverBox = () => {
    const d = document.createElement('div');
    d.style.position = 'absolute';
    d.style.pointerEvents = 'none';
    d.style.border = '2px solid #00a64f';
    d.style.zIndex = '2147483646';
    d.style.background = 'rgba(0,166,79,0.06)';
    return d;
  };

  const makeMenu = () => {
    const m = document.createElement('div');
    m.style.position = 'absolute';
    m.style.zIndex = '2147483647';
    m.style.background = '#2c2c2c';
    m.style.border = '1px solid #444';
    m.style.borderRadius = '8px';
    m.style.boxShadow = '0 4px 20px rgba(0,0,0,0.4)';
    m.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
    m.style.fontSize = '13px';
    m.style.color = '#e0e0e0';
    m.style.padding = '10px';
    m.style.display = 'flex';
    m.style.flexDirection = 'column';
    m.style.gap = '8px';
    m.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.textContent = 'Блокировка элемента';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '4px';
    title.style.color = '#4a9eff';
    m.appendChild(title);

    const btnHide = document.createElement('button');
    btnHide.textContent = 'Заблокировать навсегда';
    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Отмена';

    [btnHide, btnCancel].forEach(b => { 
      b.style.padding = '8px 12px'; 
      b.style.border = '1px solid #444'; 
      b.style.borderRadius = '6px'; 
      b.style.background = '#383838'; 
      b.style.color = '#e0e0e0';
      b.style.cursor = 'pointer'; 
      b.style.fontSize = '12px';
      b.style.transition = 'background 0.2s';
      b.onmouseover = () => b.style.background = '#444';
      b.onmouseout = () => b.style.background = '#383838';
    });

    btnHide.style.background = '#4a9eff';
    btnHide.style.border = 'none';
    btnHide.style.color = '#fff';
    btnHide.onmouseover = () => btnHide.style.background = '#357abd';
    btnHide.onmouseout = () => btnHide.style.background = '#4a9eff';

    m.appendChild(btnHide); 
    m.appendChild(btnCancel);

    btnHide.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!hoverEl) return;
      const selector = buildSelector(hoverEl);
      if (!selector) { disablePicker(); return; }
      injectRule(selector);
      await saveRule(selector);
      disablePicker();
    });

    btnCancel.addEventListener('click', (e) => { 
      e.stopPropagation();
      disablePicker(); 
    });

    return m;
  };

  const positionBox = (el) => {
    if (!hoverBox) return;
    const r = el.getBoundingClientRect();
    hoverBox.style.left = `${r.left + window.scrollX}px`;
    hoverBox.style.top = `${r.top + window.scrollY}px`;
    hoverBox.style.width = `${r.width}px`;
    hoverBox.style.height = `${r.height}px`;
  };

  const injectRule = (selector) => {
    const style = document.createElement('style');
    style.textContent = `${selector} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };

  const saveRule = async (selector) => {
    const { userRules = {} } = await browser.storage.local.get('userRules');
    const host = location.hostname;
    const arr = userRules[host] || [];
    if (!arr.includes(selector)) arr.push(selector);
    userRules[host] = arr;
    await browser.storage.local.set({ userRules });
  };

  const buildSelector = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0,2);
    if (cls.length) return `${el.tagName.toLowerCase()}.${cls.map(c => CSS.escape(c)).join('.')}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      const tag = node.tagName.toLowerCase();
      let nth = 1, sib = node;
      while ((sib = sib.previousElementSibling) && sib.tagName.toLowerCase() === tag) nth++;
      parts.unshift(`${tag}:nth-of-type(${nth})`);
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : null;
  };

  const enablePicker = () => {
    if (pickerEnabled) return;
    if (document.visibilityState !== 'visible') return;
    pickerEnabled = true;
    hoverBox = makeHoverBox();
    document.documentElement.appendChild(hoverBox);
    menu = makeMenu();
    document.documentElement.appendChild(menu);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);
  };

  let isLocked = false;

  const disablePicker = () => {
    pickerEnabled = false;
    isLocked = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    hoverBox = null; menu = null; hoverEl = null;
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (isLocked) {
        isLocked = false;
        const hint = document.getElementById('picker-lock-hint');
        if (hint) hint.remove();
        if (menu) menu.style.border = '1px solid #444';
      } else {
        disablePicker();
      }
    }
  };

  const onMove = (e) => {
    if (!pickerEnabled || isLocked) return;
    const el = e.target;
    // Don't hover over our own UI
    if (el === hoverBox || el === menu || menu?.contains(el)) return;
    hoverEl = el;
    positionBox(el);
    if (menu) {
      menu.style.left = `${e.pageX + 8}px`;
      menu.style.top = `${e.pageY + 8}px`;
    }
  };

  const onClick = (e) => {
    if (!pickerEnabled) return;
    
    // If clicking on our menu, let it handle the event
    if (menu?.contains(e.target)) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    if (!isLocked) {
      isLocked = true;
      if (menu) {
        menu.style.border = '2px solid #4a9eff';
        const lockHint = document.createElement('div');
        lockHint.id = 'picker-lock-hint';
        lockHint.textContent = 'Выбор зафиксирован. Нажмите на кнопку или Esc.';
        lockHint.style.fontSize = '10px';
        lockHint.style.color = '#aaa';
        lockHint.style.marginTop = '4px';
        menu.appendChild(lockHint);
      }
    } else {
      // If already locked and clicked outside menu, unlock
      isLocked = false;
      const hint = document.getElementById('picker-lock-hint');
      if (hint) hint.remove();
      if (menu) menu.style.border = '1px solid #444';
    }
  };

  const onContextMenu = (e) => {
    if (!pickerEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    disablePicker();
  };
}

function injectAntiAntiAdblock() {
  const code = `
    (function() {
      // 1. Protection for common anti-adblock bait properties
      const spoofProperty = (proto, prop) => {
        const original = Object.getOwnPropertyDescriptor(proto, prop);
        if (!original) return;
        
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: true,
          get: function() {
            const val = original.get.call(this);
            // If the element looks like a bait (hidden or 0 size) but has ad-related classes
            if (val === 0 || (typeof val === 'string' && val === 'none')) {
              const className = (this.className || '').toLowerCase();
              const id = (this.id || '').toLowerCase();
              if (/(ad|ads|adsbox|banner|sponsor|promo)/i.test(className + id)) {
                return prop.includes('Height') ? 100 : (prop.includes('Width') ? 300 : 'block');
              }
            }
            return val;
          }
        });
      };

      try {
        spoofProperty(HTMLElement.prototype, 'offsetHeight');
        spoofProperty(HTMLElement.prototype, 'offsetWidth');
        spoofProperty(HTMLElement.prototype, 'clientHeight');
        spoofProperty(HTMLElement.prototype, 'clientWidth');
        spoofProperty(CSSStyleDeclaration.prototype, 'display');
      } catch(e) {}

      // 2. Timer Interception (Anti-Anti-Adblock)
      const wrapTimer = (name) => {
        const original = window[name];
        window[name] = function(callback, delay, ...args) {
          if (typeof callback === 'function') {
            const fnStr = callback.toString();
            // Detect if the timer is checking for adblock
            if (/(adblock|blocked|adsbox|offsetHeight|clientHeight)/i.test(fnStr)) {
              // If it's a very short timer typical of checks, delay it or neutralize it
              if (delay < 500) {
                const newCallback = function() {
                  // Run the original callback but try to catch its detection logic
                  return callback.apply(this, args);
                };
                return original.call(this, newCallback, delay + 1000, ...args);
              }
            }
          }
          return original.call(this, callback, delay, ...args);
        };
        // Protect toString
        window[name].toString = () => original.toString();
      };

      try {
        wrapTimer('setTimeout');
        wrapTimer('setInterval');
      } catch(e) {}

      // 3. Protection against script-based detection
      const origGetElementById = document.getElementById;
      document.getElementById = function(id) {
        const el = origGetElementById.call(this, id);
        if (!el && /(ad|ads|adsbox|banner|sponsor|promo)/i.test(id)) {
          // If a script is looking for a bait element we might have removed, 
          // we could potentially return a fake one, but usually hiding is enough.
        }
        return el;
      };
      document.getElementById.toString = () => origGetElementById.toString();

      // 4. Script Stubs (Yandex Metrica & Hotjar)
      const createStub = (objPath, props = {}) => {
        let parts = objPath.split('.');
        let current = window;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) current[parts[i]] = {};
          current = current[parts[i]];
        }
        const last = parts[parts.length - 1];
        if (!current[last]) {
          current[last] = function() { return current[last]; };
          Object.assign(current[last], props);
          // Make it look like a real function
          current[last].toString = () => 'function ' + last + '() { [native code] }';
        }
      };

      // Yandex Metrica Stubs
      createStub('ym');
      createStub('Ya.Metrika');
      createStub('Ya.Metrika2');
      
      // Hotjar Stubs
      createStub('hj');
      createStub('_hjSettings', { hjid: 0, hjsv: 0 });

      // Yandex Direct (RSI) Stubs
      createStub('Ya.Context.AdvManager.render');
      createStub('Ya.adfoxCode.create');

      console.log('Smart Anti-Anti-Adblock System initialized');
    })();
  `;

  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

function hideGifAds() {
  const scan = (root = document) => {
    const nodes = root.querySelectorAll('img[src$=".gif"], picture source[srcset*=".gif"], iframe[src*=".gif"], [style*=".gif"]');
    nodes.forEach(n => { checkEl(n); });
  };
  return scan;
}



function hidePopupsAndModals() {
  const popupSelectors = [
    '.popup', '.modal', '.ad-popup', '.ad-modal', '.overlay', '.backdrop', '.dialog',
    '[class*="-popup"]', '[class*="-modal"]', '[class*="-overlay"]', '[class*="-dialog"]',
    '[id*="-popup"]', '[id*="-modal"]', '[id*="-overlay"]', '[id*="-dialog"]',
    'div[aria-modal="true"]', 'div[role="dialog"]',
    'div[data-qa="modal"]', 'div[data-testid="modal"]',
    'div[data-adblock-popup]'
  ];

  const scan = (root = document) => {
    const allPopupElements = root.querySelectorAll(popupSelectors.join(', '));
    allPopupElements.forEach(el => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) { // Only hide visible elements
        hideEl(el);
      }
    });

    // Remove overflow: hidden from body if present (common for modals)
    if (root === document) { // Only apply to document body/documentElement
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
      }
      if (document.documentElement.style.overflow === 'hidden') {
        document.documentElement.style.overflow = '';
      }
    }
  };

  return scan;
}

function hideFlashObjects() {
  const scan = (root = document) => {
    const objs = root.querySelectorAll('object, embed');
    objs.forEach(el => {
      const data = (el.getAttribute('data') || el.getAttribute('src') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const bad = data.endsWith('.swf') || type.includes('flash');
      const mark = /(ad|ads|banner|promo|sponsor)/.test(data);
      if (bad && mark) {
        el.remove();
      }
    });
  };
  return scan;
}

let hosts = [];

const sizes = [
  [728,90],[970,250],[300,250],[336,280],[320,50],[160,600],[300,600],[468,60],[980,120],
  [970,90],[970,200],[300,100],[320,100],[240,400],[234,60],[120,600],[180,150]
];
const near = (a,b)=>Math.abs(a-b)<=6;
const isAdSize = (el)=>{
  const r = el.getBoundingClientRect();
  return sizes.some(([w,h])=>near(r.width,w)&&near(r.height,h));
};
const hasMark = (s)=>/(^|\b)(ad|ads|adv|advert|advertising|banner|sponsor|promo)(\b|$)/.test(s) || /(реклам|баннер)/.test(s);
const hasAncestorMark = (el, depth=4)=>{
  let node = el ? el.parentElement : null;
  let d = 0;
  while (node && d < depth) {
    const id = (node.id || '').toLowerCase();
    const cls = (node.className + '').toLowerCase();
    if (hasMark(id) || hasMark(cls)) return true;
    node = node.parentElement; d++;
  }
  return false;
};
const isGif = (s)=>/\.gif(\?|#|$)/.test(String(s||'').toLowerCase());
const isBadUrl = (u)=>{
  const s = String(u||'').toLowerCase();
  return hosts.some(h=>s.includes(h)) || /(^|\b)(ad|ads|banner|promo|sponsor)(\b|$)/.test(s);
};
const hideEl = (el) => { 
  if (!isEnabled || isWhitelisted(el)) return;
  
  if (el.style.display !== 'none') {
    el.style.display = 'none'; 
    el.style.visibility = 'hidden'; 
    el.style.opacity = '0'; 
    el.style.pointerEvents = 'none'; 
    
    // Notify background to increment counter
    browser.runtime.sendMessage({ action: 'incrementBlockedCount' }).catch(() => {});
    
    cleanupParent(el); 
  }
};
function cleanupParent(el){
  const p = el && el.parentElement;
  if (!p) return;
  const id = (p.id||'').toLowerCase();
  const cls = (p.className+'').toLowerCase();
  if (hasMark(id) || hasMark(cls)){
    const kids = Array.from(p.children);
    if (kids.length && kids.every(c=>getComputedStyle(c).display==='none')){
      p.style.display='none'; p.style.visibility='hidden'; p.style.opacity='0'; p.style.pointerEvents='none';
    }
  }
}

const checkEl = (el)=>{
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName.toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (el.className + '').toLowerCase();
  const styleAttr = el.getAttribute('style') || '';

  // 1. Check for common ad markers in id, class, and inline style (cheap)
  if (hasMark(id) || hasMark(cls) || hasMark(styleAttr)) { hideEl(el); return true; }

  // 2. Check specific tags and their attributes (medium cost)
  if (tag === 'iframe' || tag === 'img' || tag === 'ins' || tag === 'source' || tag === 'picture' || tag === 'a') {
    const src = el.getAttribute('src') || '';
    const href = el.getAttribute('href') || '';
    if (isBadUrl(src) || isBadUrl(href)) { hideEl(el); return true; }
  }

  // 3. Visual and size-based checks (higher cost)
  if (tag === 'div' || tag === 'section' || tag === 'aside' || tag === 'ins' || tag === 'iframe' || tag === 'img') {
    if (isAdSize(el)) {
      if (hasAncestorMark(el) || tag === 'ins' || tag === 'iframe') {
        hideEl(el); return true;
      }
    }
  }

  // 3. Check for data-* attributes (medium cost)
  for (const attr of el.attributes) {
    if (attr.name.startsWith('data-') && isBadUrl(attr.value)) { hideEl(el); return true; }
  }

  // 4. Check for noscript tags (medium cost)
  if (tag === 'noscript') {
    const noscriptContent = el.textContent || '';
    if (hasMark(noscriptContent) || hosts.some(h => noscriptContent.includes(h))) { hideEl(el); return true; }
  }

  // Defer expensive checks: Only perform these if the element is potentially visible and not already hidden by cheaper checks.
  // Check for offsetParent to quickly discard elements not in the rendered tree.
  if (el.offsetParent !== null) {
    // 5. Check for ad sizes (potentially expensive due to getBoundingClientRect)
    if (isAdSize(el)) { hideEl(el); return true; }

    // 6. Check for background images (expensive due to window.getComputedStyle)
    const computedStyle = window.getComputedStyle(el);
    const backgroundImage = computedStyle.getPropertyValue('background-image');
    if (backgroundImage && backgroundImage !== 'none') {
      const urlMatch = backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (urlMatch && urlMatch[1]) {
        const u = urlMatch[1];
        if (isBadUrl(u) || isGif(u)) {
          if (hasAncestorMark(el) || isAdSize(el)) { hideEl(el); return true; }
        }
      }
    }
  }

  // 7. Check for nested iframes, images, ins (expensive due to querySelector)
  const ifr = el.querySelector('iframe, img, ins');
  if (ifr) {
    const s1 = ifr.getAttribute('src') || '';
    const s2 = ifr.getAttribute('data-src') || '';
    const s3 = ifr.getAttribute('srcset') || '';
    if (isBadUrl(s1) || isBadUrl(s2) || isBadUrl(s3) || isAdSize(ifr)) { hideEl(ifr); return true; }
    if (isAdSize(el) && (hasAncestorMark(el) || el.matches('div,section,aside,header,figure'))) { hideEl(el); return true; }
  }
  return false;
};

function enhancedFindHideAds() {
  const scan = (root = document)=>{
    const nodes = root.querySelectorAll('iframe, img, ins, div, section, aside');
    nodes.forEach(n=>{ checkEl(n); });
  };
  return scan;
}

function observeDOMChanges() {
  const scanGif = hideGifAds();
  const scanPopups = hidePopupsAndModals();
  const scanFlash = hideFlashObjects();
  const scanEnhanced = enhancedFindHideAds();
  const scanVideoAds = autoSkipVideoAds();

  const fullScan = () => {
    scanGif();
    scanPopups();
    scanFlash();
    scanEnhanced();
    scanVideoAds();
  };

  const obs = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) { // Element node
            checkEl(node);
            node.querySelectorAll('*').forEach(checkEl);
            scanGif(node);
            scanPopups(node);
            scanFlash(node);
            scanEnhanced(node);
            scanVideoAds(node);
          }
        }
      }
      if (mutation.type === 'attributes') {
        const t = mutation.target;
        if (t && t.nodeType === 1) {
          checkEl(t);
          if (mutation.attributeName && ['src','data-src','srcset','data-srcset','style','class'].includes(mutation.attributeName)) {
            scanGif(t);
          }
        }
      }
    }
  });

  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','data-src','srcset','data-srcset','style','class'] });
  fullScan();

  document.addEventListener('load', (e)=>{
    const el = e.target;
    if (el && el.nodeType === 1) {
      if (el.tagName === 'IMG' || el.tagName === 'IFRAME') {
        checkEl(el);
        scanGif(el);
      }
    }
  }, true);
}
