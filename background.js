const activeRotations = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  switch (message.type) {
    case "getState":
      sendResponse(activeRotations[tabId] || {
        isRotating: false,
        urls: [],
        minTime: 60,
        maxTime: 90
      });
      break;

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
      break;

    case "stop":
      if (activeRotations[tabId]) {
        clearTimeout(activeRotations[tabId].timeoutId);
        delete activeRotations[tabId];
      }
      break;
  }

  return true; // Keep the message channel open for async response
});

function startRotation(tabId) {
  if (!activeRotations[tabId] || !activeRotations[tabId].isRotating) return;

  const state = activeRotations[tabId];
  const randomIndex = Math.floor(Math.random() * state.urls.length);
  const randomUrl = state.urls[randomIndex];

  chrome.tabs.update(tabId, { url: randomUrl }, () => {
    const delay = (Math.floor(Math.random() * (state.maxTime - state.minTime + 1)) + state.minTime) * 1000;
    activeRotations[tabId].timeoutId = setTimeout(() => startRotation(tabId), delay);
  });
}

chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (activeRotations[closedTabId]) {
    clearTimeout(activeRotations[closedTabId].timeoutId);
    delete activeRotations[closedTabId];
  }
});