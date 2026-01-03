if (typeof browser === 'undefined') {
  var browser = chrome;
}

let networkFilters = [];
let filterTokens = [];
let isEnabled = true;

async function loadSettings() {
  const settings = await browser.storage.local.get(['enabled', 'blockedCount']);
  isEnabled = settings.enabled !== false;
  if (settings.blockedCount === undefined) {
    await browser.storage.local.set({ blockedCount: 0 });
  }
}

async function loadFilters() {
  try {
    const response = await fetch(browser.runtime.getURL('rules.json'));
    const rules = await response.json();
    networkFilters = rules.networkFilters || [];
    filterTokens = networkFilters.map(s => String(s).toLowerCase());
  } catch (e) {
    console.error('Failed to load rules.json:', e);
  }
}

async function incrementBlockedCount() {
  const { blockedCount = 0 } = await browser.storage.local.get('blockedCount');
  await browser.storage.local.set({ blockedCount: blockedCount + 1 });
}

async function isUrlWhitelisted(url) {
  try {
    const { whitelist = [] } = await browser.storage.local.get('whitelist');
    const hostname = new URL(url).hostname;
    return whitelist.includes(hostname);
  } catch (e) {
    return false;
  }
}

const isBadUrl = (u) => {
  if (!isEnabled) return false;
  try {
    const obj = new URL(u);
    const host = obj.hostname.toLowerCase();
    const path = (obj.pathname + obj.search).toLowerCase();
    
    // Check tokens
    if (filterTokens.some(t => host.includes(t))) return true;
    
    // More precise regex for ads
    if (/(^|\.|\/)(ads?|banners?|adrec|promo|sponsor|tracking|analytics|pixel|telemetry|doubleclick|adservice|adsystem)(\.|\/|\?|$)/i.test(u)) {
      return true;
    }
    
    return false;
  } catch (e) {
    const s = String(u || '').toLowerCase();
    return filterTokens.some(t => s.includes(t)) || /(^|\b)(ad|ads|banner|promo|sponsor)(\b|$)/.test(s);
  }
};

// Initialize
loadSettings();
loadFilters();

// Context Menu
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "block-element",
    title: "Заблокировать этот элемент",
    contexts: ["all"]
  });
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "block-element") {
    browser.tabs.sendMessage(tab.id, { action: "startPicker" });
  }
});

// Message Listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setEnabled') {
    isEnabled = message.enabled;
  } else if (message.action === 'incrementBlockedCount') {
    incrementBlockedCount();
  } else if (message.action === 'startPicker') {
    // Forward to active tab
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, { action: "startPicker" });
      }
    });
  }
});

browser.webRequest.onBeforeRequest.addListener(
  async function(details) {
    if (!isEnabled) return { cancel: false };

    const url = details.url;
    
    // Check if the page itself is whitelisted (based on initiator or frame url)
    // For simplicity and effectiveness, we check the tab's current URL
    if (details.tabId !== -1) {
      try {
        const tab = await browser.tabs.get(details.tabId);
        if (tab.url && await isUrlWhitelisted(tab.url)) {
          return { cancel: false };
        }
      } catch (e) {}
    }

    // Whitelist check (essential elements)
    if (url.includes('mozilla.net') || url.includes('firefox.com') || url.includes('google.com/recaptcha')) {
      return { cancel: false };
    }

    if (isBadUrl(url)) {
      incrementBlockedCount();
      return { cancel: true };
    }
    
    return { cancel: false };
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame", "stylesheet", "script", "image", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"] },
  ["blocking"]
);

console.log("Simple AdBlock background script loaded.");
