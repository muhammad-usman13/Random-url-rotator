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

// State variables
let isRotating = false;
let rotatingTabId = null;
let urls = [];
let minTime = 60;
let maxTime = 90;
let timeoutId = null;

// Load URLs and time range from storage on startup
browserAPI.storage.local.get(['urls', 'minTime', 'maxTime']).then(result => {
  if (result.urls) urls = result.urls;
  if (result.minTime) minTime = result.minTime;
  if (result.maxTime) maxTime = result.maxTime;
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getState") {
    sendResponse({ isRotating, urls, minTime, maxTime });
  } else if (message.type === "start") {
    if (!isRotating) {
      browserAPI.storage.local.set({ 
        urls: message.urls,
        minTime: message.minTime,
        maxTime: message.maxTime
      });
      urls = message.urls;
      minTime = message.minTime;
      maxTime = message.maxTime;
      browserAPI.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length > 0) {
          rotatingTabId = tabs[0].id;
          isRotating = true;
          rotateTab();
        }
      });
    }
  } else if (message.type === "stop") {
    stopRotation();
  }
});

function rotateTab() {
  if (!isRotating || !rotatingTabId || urls.length === 0) return;

  const randomIndex = Math.floor(Math.random() * urls.length);
  const randomUrl = urls[randomIndex];
  browserAPI.tabs.update(rotatingTabId, { url: randomUrl }).then(() => {
    const seconds = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
    timeoutId = setTimeout(rotateTab, seconds * 1000);
  }).catch(stopRotation);
}

function stopRotation() {
  if (isRotating) {
    clearTimeout(timeoutId);
    timeoutId = null;
    isRotating = false;
    rotatingTabId = null;
  }
}

browserAPI.tabs.onRemoved.addListener((tabId) => {
  if (tabId === rotatingTabId) stopRotation();
});