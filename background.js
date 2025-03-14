// State variables
let isRotating = false;
let rotatingTabId = null;
let urls = [];
let timeoutId = null;

// Load URLs from storage on startup
browser.storage.local.get('urls').then(result => {
  if (result.urls) {
    urls = result.urls;
  }
});

// Handle messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getState") {
    sendResponse({ isRotating, urls });
  } else if (message.type === "start") {
    if (!isRotating) {
      browser.storage.local.set({ urls: message.urls });
      urls = message.urls;
      browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
        if (tabs.length > 0) {
          rotatingTabId = tabs[0].id;
          isRotating = true;
          rotateTab(); // Start immediately
        }
      });
    }
  } else if (message.type === "stop") {
    stopRotation();
  }
});

// Rotate to a random URL and schedule the next rotation
function rotateTab() {
  if (!isRotating || !rotatingTabId || urls.length === 0) return;

  const randomIndex = Math.floor(Math.random() * urls.length);
  const randomUrl = urls[randomIndex];
  browser.tabs.update(rotatingTabId, { url: randomUrl }).then(() => {
    // Schedule the next rotation
    const seconds = Math.floor(Math.random() * 31) + 60; // 60-90 seconds
    const delay = seconds * 1000;
    timeoutId = setTimeout(rotateTab, delay);
  }).catch(error => {
    console.error("Error updating tab:", error);
    stopRotation();
  });
}

// Stop rotation
function stopRotation() {
  if (isRotating) {
    clearTimeout(timeoutId);
    timeoutId = null;
    isRotating = false;
    rotatingTabId = null;
  }
}

// Stop rotation if the tab is closed
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === rotatingTabId) {
    stopRotation();
  }
});