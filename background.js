// Cross-browser API helper
const browserAPI = {
  tabs: {
    query: (query) => {
      if (typeof browser !== 'undefined') {
        return browser.tabs.query(query);
      }
      return new Promise(resolve => chrome.tabs.query(query, resolve));
    },
    update: (tabId, updateProperties) => {
      if (typeof browser !== 'undefined') {
        return browser.tabs.update(tabId, updateProperties);
      }
      return new Promise(resolve => chrome.tabs.update(tabId, updateProperties, resolve));
    },
    onRemoved: {
      addListener: (callback) => {
        const api = typeof browser !== 'undefined' ? browser.tabs.onRemoved : chrome.tabs.onRemoved;
        api.addListener(callback);
      }
    }
  },
  storage: {
    local: {
      set: (items) => {
        if (typeof browser !== 'undefined') {
          return browser.storage.local.set(items);
        }
        return new Promise(resolve => chrome.storage.local.set(items, resolve));
      },
      get: (keys) => {
        if (typeof browser !== 'undefined') {
          return browser.storage.local.get(keys);
        }
        return new Promise(resolve => chrome.storage.local.get(keys, resolve));
      }
    }
  }
};

// State storage for all tabs
const activeRotations = {};

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  switch (message.type) {
    case "getState":
      browserAPI.storage.local.get('savedUrls').then(storage => {
        const tabState = activeRotations[tabId] || {
          isRotating: false,
          urls: [],
          minTime: 60,
          maxTime: 90
        };
        sendResponse({
          ...tabState,
          savedUrls: storage.savedUrls || []
        });
      });
      return true; // Indicate async response

    case "start":
      if (!activeRotations[tabId]) {
        activeRotations[tabId] = {
          isRotating: true,
          urls: message.urls,
          minTime: message.minTime,
          maxTime: message.maxTime,
          timeoutId: null
        };
        
        startRotation(tabId);
      }
      sendResponse({ success: true });
      break;

    case "stop":
      if (activeRotations[tabId]) {
        stopRotation(tabId);
      }
      sendResponse({ success: true });
      break;

    case "saveUrls":
      browserAPI.storage.local.set({ savedUrls: message.urls }).then(() => {
        sendResponse({ success: true });
      });
      return true; // Indicate async response
  }
});

function startRotation(tabId) {
  if (!activeRotations[tabId] || !activeRotations[tabId].isRotating) return;

  const state = activeRotations[tabId];
  const randomIndex = Math.floor(Math.random() * state.urls.length);
  const randomUrl = state.urls[randomIndex];

  browserAPI.tabs.update(tabId, { url: randomUrl }).then(() => {
    const min = state.minTime;
    const max = state.maxTime;
    const delay = (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
    
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    
    state.timeoutId = setTimeout(() => {
      if (activeRotations[tabId] && activeRotations[tabId].isRotating) {
        startRotation(tabId);
      }
    }, delay);

  }).catch(() => stopRotation(tabId));
}

function stopRotation(tabId) {
  if (activeRotations[tabId]) {
    clearTimeout(activeRotations[tabId].timeoutId);
    activeRotations[tabId].timeoutId = null;
    delete activeRotations[tabId];

  }
}

// Clean up when tabs close
browserAPI.tabs.onRemoved.addListener((closedTabId) => {
  if (activeRotations[closedTabId]) {
    stopRotation(closedTabId);
  }
});
