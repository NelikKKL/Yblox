if (typeof browser === 'undefined') {
  var browser = chrome;
}

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('adblockToggle');
  const status = document.getElementById('statusMessage');
  const blockedCountEl = document.getElementById('blockedCount');

  // Load current state
  const { enabled = true, blockedCount = 0 } = await browser.storage.local.get(['enabled', 'blockedCount']);
  
  toggle.checked = !!enabled;
  updateStatusUI(enabled);
  blockedCountEl.textContent = blockedCount.toLocaleString();

  // Listen for changes
  toggle.addEventListener('change', async () => {
    const isEnabled = toggle.checked;
    await browser.storage.local.set({ enabled: isEnabled });
    updateStatusUI(isEnabled);
    
    // Notify background script
    try { 
      await browser.runtime.sendMessage({ action: 'setEnabled', enabled: isEnabled }); 
    } catch (e) {
      console.error('Error sending message to background:', e);
    }
  });

  function updateStatusUI(isEnabled) {
    status.textContent = isEnabled ? 'Активно' : 'Приостановлено';
    status.className = 'status-badge ' + (isEnabled ? 'status-active' : 'status-inactive');
  }

  const startPickerBtn = document.getElementById('startPickerBtn');
  const whitelistBtn = document.getElementById('whitelistBtn');
  const clearRulesBtn = document.getElementById('clearRulesBtn');

  // Load current site info
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const currentHostname = currentTab ? new URL(currentTab.url).hostname : '';

  const { whitelist = [], userRules = {} } = await browser.storage.local.get(['whitelist', 'userRules']);
  
  // Show/hide clear rules button based on if there are rules for this host
  const hostRules = userRules[currentHostname] || [];
  clearRulesBtn.style.display = hostRules.length > 0 ? 'block' : 'none';

  clearRulesBtn.addEventListener('click', async () => {
    const { userRules = {} } = await browser.storage.local.get('userRules');
    delete userRules[currentHostname];
    await browser.storage.local.set({ userRules });
    
    // Notify tab to refresh
    browser.tabs.reload(currentTab.id);
    window.close();
  });

  const isWhitelisted = whitelist.includes(currentHostname);
  updateWhitelistUI(isWhitelisted);

  whitelistBtn.addEventListener('click', async () => {
    const { whitelist = [] } = await browser.storage.local.get('whitelist');
    let newWhitelist;
    if (whitelist.includes(currentHostname)) {
      newWhitelist = whitelist.filter(h => h !== currentHostname);
    } else {
      newWhitelist = [...whitelist, currentHostname];
    }
    await browser.storage.local.set({ whitelist: newWhitelist });
    updateWhitelistUI(!whitelist.includes(currentHostname));
    
    // Notify tabs to refresh
    browser.tabs.reload(currentTab.id);
  });

  function updateWhitelistUI(whitelisted) {
    whitelistBtn.textContent = whitelisted ? 'Удалить из белого списка' : 'Добавить в белый список';
    if (whitelisted) {
      whitelistBtn.style.borderColor = '#4a9eff';
      status.textContent = 'Сайт в белом списке';
      status.className = 'status-badge status-inactive';
    } else {
      whitelistBtn.style.borderColor = '';
    }
  }

  startPickerBtn.addEventListener('click', async () => {
    try { 
      await browser.runtime.sendMessage({ action: 'startPicker' }); 
      window.close();
    } catch (e) {
      console.error('Error starting picker:', e);
    }
  });

  // Periodically update blocked count if popup stays open
  setInterval(async () => {
    const { blockedCount = 0 } = await browser.storage.local.get('blockedCount');
    blockedCountEl.textContent = blockedCount.toLocaleString();
  }, 1000);
});
