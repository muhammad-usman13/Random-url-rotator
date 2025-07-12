// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || sender.tab?.id;

  switch (message.type) {
    case "getState":
      getTabState(tabId).then(tabState => {
        chrome.storage.local.get('savedUrls').then(storage => {
          sendResponse({
            ...tabState,
            savedUrls: storage.savedUrls || []
          });
        });
      });
      return true; // Indicate async response

    case "start":
      startRotation(tabId, message.urls, message.minTime, message.maxTime).then(() => {
        sendResponse({ success: true });
      });
      return true;

    case "stop":
      stopRotation(tabId).then(() => {
        sendResponse({ success: true });
      });
      return true;

    case "saveUrls":
      chrome.storage.local.set({ savedUrls: message.urls }).then(() => {
        // Also save statistics
        updateUrlStatistics(message.urls);
        sendResponse({ success: true });
      });
      return true; // Indicate async response
  }
});

// Get tab state from storage
async function getTabState(tabId) {
  const result = await chrome.storage.local.get(`rotation_${tabId}`);
  return result[`rotation_${tabId}`] || {
    isRotating: false,
    urls: [],
    minTime: 60,
    maxTime: 90,
    rotationCount: 0,
    lastRotationTime: null
  };
}

// Save tab state to storage
async function saveTabState(tabId, state) {
  await chrome.storage.local.set({ [`rotation_${tabId}`]: state });
}

// Update URL statistics
async function updateUrlStatistics(urls) {
  const result = await chrome.storage.local.get('urlStats');
  const stats = result.urlStats || {};
  
  urls.forEach(url => {
    if (!stats[url]) {
      stats[url] = { count: 0, lastUsed: null };
    }
  });
  
  await chrome.storage.local.set({ urlStats: stats });
}

// Start rotation for a tab
async function startRotation(tabId, urls, minTime, maxTime) {
  // Save state to storage
  const state = {
    isRotating: true,
    urls: urls,
    minTime: minTime,
    maxTime: maxTime,
    rotationCount: 0,
    lastRotationTime: null,
    startTime: Date.now()
  };
  await saveTabState(tabId, state);
  
  // Schedule the first rotation immediately
  await performRotation(tabId);
}

// Stop rotation for a tab
async function stopRotation(tabId) {
  // Clear alarm
  await chrome.alarms.clear(`rotation_${tabId}`);
  
  // Update state
  const state = await getTabState(tabId);
  state.isRotating = false;
  state.stopTime = Date.now();
  await saveTabState(tabId, state);
  
  // Log session statistics
  if (state.startTime) {
    const sessionDuration = Date.now() - state.startTime;
    await logSessionStats(tabId, sessionDuration, state.rotationCount);
  }
}

// Log session statistics
async function logSessionStats(tabId, duration, rotationCount) {
  const result = await chrome.storage.local.get('sessionStats');
  const stats = result.sessionStats || [];
  
  stats.push({
    tabId,
    duration,
    rotationCount,
    timestamp: Date.now()
  });
  
  // Keep only last 50 sessions
  if (stats.length > 50) {
    stats.splice(0, stats.length - 50);
  }
  
  await chrome.storage.local.set({ sessionStats: stats });
}

// Schedule the next rotation using alarms
async function scheduleNextRotation(tabId) {
  const state = await getTabState(tabId);
  
  if (!state.isRotating || !state.urls || state.urls.length === 0) {
    return;
  }
  
  // Calculate random delay
  const min = state.minTime;
  const max = state.maxTime;
  const delayInMinutes = (Math.floor(Math.random() * (max - min + 1)) + min) / 60;
  
  // Schedule alarm
  await chrome.alarms.create(`rotation_${tabId}`, {
    delayInMinutes: delayInMinutes
  });
  
  // Update state with next rotation time estimate
  state.nextRotationTime = Date.now() + (delayInMinutes * 60 * 1000);
  await saveTabState(tabId, state);
}

// Handle alarm events
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('rotation_')) {
    const tabId = parseInt(alarm.name.replace('rotation_', ''));
    await performRotation(tabId);
  }
});

// Perform rotation and schedule next one
async function performRotation(tabId) {
  try {
    const state = await getTabState(tabId);
    
    if (!state.isRotating || !state.urls || state.urls.length === 0) {
      return;
    }
    
    // Check if tab still exists
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      // Tab doesn't exist, clean up
      await stopRotation(tabId);
      return;
    }
    
    // Pick random URL with weighted selection for better user experience
    const randomIndex = Math.floor(Math.random() * state.urls.length);
    const randomUrl = state.urls[randomIndex];
    
    // Validate URL before navigating
    if (!isValidUrl(randomUrl)) {
      console.warn(`Invalid URL skipped: ${randomUrl}`);
      // Remove invalid URL and continue
      state.urls.splice(randomIndex, 1);
      if (state.urls.length === 0) {
        await stopRotation(tabId);
        return;
      }
      await saveTabState(tabId, state);
      await scheduleNextRotation(tabId);
      return;
    }
    
    // Update tab
    await chrome.tabs.update(tabId, { url: randomUrl });
    
    // Update statistics
    await updateUrlUsageStats(randomUrl);
    
    // Update rotation count and last rotation time
    state.rotationCount = (state.rotationCount || 0) + 1;
    state.lastRotationTime = Date.now();
    state.lastUrl = randomUrl;
    await saveTabState(tabId, state);
    
    // Schedule next rotation
    await scheduleNextRotation(tabId);
    
  } catch (error) {
    console.error('Error performing rotation:', error);
    // If there's an error, stop rotation for this tab
    await stopRotation(tabId);
  }
}

// URL validation function
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Update URL usage statistics
async function updateUrlUsageStats(url) {
  const result = await chrome.storage.local.get('urlStats');
  const stats = result.urlStats || {};
  
  if (!stats[url]) {
    stats[url] = { count: 0, lastUsed: null };
  }
  
  stats[url].count++;
  stats[url].lastUsed = Date.now();
  
  await chrome.storage.local.set({ urlStats: stats });
}

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  await stopRotation(closedTabId);
  // Also remove the stored state
  await chrome.storage.local.remove(`rotation_${closedTabId}`);
});

// Restore active rotations when service worker starts
chrome.runtime.onStartup.addListener(async () => {
  await restoreActiveRotations();
});

chrome.runtime.onInstalled.addListener(async () => {
  await restoreActiveRotations();
  
  // Create context menu items
  chrome.contextMenus.create({
    id: "addCurrentUrl",
    title: "Add current page to URL rotator",
    contexts: ["page"]
  });
  
  chrome.contextMenus.create({
    id: "startRotationHere",
    title: "Start rotation on this tab",
    contexts: ["page"]
  });
  
  // Initialize default settings if not exists
  const result = await chrome.storage.local.get(['savedUrls', 'urlStats', 'sessionStats']);
  
  if (!result.savedUrls) {
    await chrome.storage.local.set({ savedUrls: [] });
  }
  
  if (!result.urlStats) {
    await chrome.storage.local.set({ urlStats: {} });
  }
  
  if (!result.sessionStats) {
    await chrome.storage.local.set({ sessionStats: [] });
  }
});

// Restore rotations from storage
async function restoreActiveRotations() {
  try {
    const storage = await chrome.storage.local.get();
    
    for (const key of Object.keys(storage)) {
      if (key.startsWith('rotation_')) {
        const tabId = parseInt(key.replace('rotation_', ''));
        const state = storage[key];
        
        if (state.isRotating) {
          // Check if tab still exists
          try {
            await chrome.tabs.get(tabId);
            // Tab exists, restart rotation
            await scheduleNextRotation(tabId);
          } catch (error) {
            // Tab doesn't exist, clean up
            await chrome.storage.local.remove(key);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error restoring rotations:', error);
  }
}

// Context menu action handlers
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addCurrentUrl") {
    // Add current tab URL to rotator
    const tabId = tab.id;
    const url = tab.url;
    
    // Get current state
    const state = await getTabState(tabId);
    
    // Add URL if not already present
    if (!state.urls.includes(url)) {
      state.urls.push(url);
      await saveTabState(tabId, state);
      
      // Update statistics
      await updateUrlStatistics([url]);
      
      // Notify user
      chrome.tabs.sendMessage(tabId, {
        type: "showNotification",
        message: `Added to rotator: ${url}`
      });
    }
  } else if (info.menuItemId === "startRotationHere") {
    // Start rotation on current tab
    const tabId = tab.id;
    
    // Get current state
    const state = await getTabState(tabId);
    
    if (!state.isRotating) {
      // Start rotation with existing URLs
      await startRotation(tabId, state.urls, state.minTime, state.maxTime);
      
      // Notify user
      chrome.tabs.sendMessage(tabId, {
        type: "showNotification",
        message: `Rotation started on this tab.`
      });
    }
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case "addCurrentUrl":
      const result = await chrome.storage.local.get('savedUrls');
      const savedUrls = result.savedUrls || [];
      
      if (!savedUrls.includes(tab.url)) {
        savedUrls.push(tab.url);
        await chrome.storage.local.set({ savedUrls });
        
        // Show notification (if we had notifications permission)
        console.log(`Added ${tab.url} to saved URLs`);
      }
      break;
      
    case "startRotationHere":
      const tabState = await getTabState(tab.id);
      if (!tabState.isRotating && tabState.urls.length > 0) {
        await startRotation(tab.id, tabState.urls, tabState.minTime, tabState.maxTime);
      }
      break;
  }
});
