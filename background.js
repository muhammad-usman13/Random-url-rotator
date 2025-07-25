// Memory efficiency constants
const MAX_SESSIONS = 50;
const MAX_URL_STATS = 200;
const CLEANUP_INTERVAL_DAYS = 7;
const MAX_URLS_PER_ROTATION = 100;

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
      // Memory efficiency: Limit URL count
      if (message.urls && message.urls.length > MAX_URLS_PER_ROTATION) {
        sendResponse({ 
          success: false, 
          error: `Too many URLs! Maximum ${MAX_URLS_PER_ROTATION} allowed` 
        });
        return true;
      }
      
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
      // Memory efficiency: Limit saved URLs
      const urlsToSave = message.urls.slice(0, MAX_URLS_PER_ROTATION);
      chrome.storage.local.set({ savedUrls: urlsToSave }).then(() => {
        // Also save statistics and trigger cleanup
        updateUrlStatistics(urlsToSave).then(() => {
          return performPeriodicCleanup();
        }).then(() => {
          sendResponse({ success: true });
        });
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

// Update URL statistics with memory efficiency
async function updateUrlStatistics(urls) {
  const result = await chrome.storage.local.get('urlStats');
  const stats = result.urlStats || {};
  
  urls.forEach(url => {
    if (!stats[url]) {
      stats[url] = { count: 0, lastUsed: null };
    }
  });
  
  // Memory efficiency: Prune old URL stats
  await pruneUrlStats(stats);
  
  await chrome.storage.local.set({ urlStats: stats });
}

// Prune URL statistics to keep memory usage low
async function pruneUrlStats(stats) {
  const entries = Object.entries(stats);
  
  if (entries.length > MAX_URL_STATS) {
    // Sort by last used date, keep most recent
    entries.sort((a, b) => {
      const aTime = a[1].lastUsed || 0;
      const bTime = b[1].lastUsed || 0;
      return bTime - aTime;
    });
    
    // Keep only the most recent MAX_URL_STATS entries
    const prunedEntries = entries.slice(0, MAX_URL_STATS);
    const prunedStats = Object.fromEntries(prunedEntries);
    
    await chrome.storage.local.set({ urlStats: prunedStats });
    console.log(`Pruned URL stats from ${entries.length} to ${MAX_URL_STATS} entries`);
  }
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

// Log session statistics with memory efficiency
async function logSessionStats(tabId, duration, rotationCount) {
  const result = await chrome.storage.local.get('sessionStats');
  const stats = result.sessionStats || [];
  
  stats.push({
    tabId,
    duration,
    rotationCount,
    timestamp: Date.now()
  });
  
  // Memory efficiency: Keep only recent sessions
  if (stats.length > MAX_SESSIONS) {
    stats.splice(0, stats.length - MAX_SESSIONS);
  }
  
  await chrome.storage.local.set({ sessionStats: stats });
}

// Periodic cleanup routine for memory efficiency
async function performPeriodicCleanup() {
  try {
    const storage = await chrome.storage.local.get();
    let cleanupPerformed = false;
    
    // Clean up old session stats (older than CLEANUP_INTERVAL_DAYS)
    if (storage.sessionStats) {
      const cutoffTime = Date.now() - (CLEANUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
      const recentSessions = storage.sessionStats.filter(session => 
        session.timestamp > cutoffTime
      );
      
      if (recentSessions.length < storage.sessionStats.length) {
        await chrome.storage.local.set({ sessionStats: recentSessions });
        cleanupPerformed = true;
        console.log(`Cleaned up ${storage.sessionStats.length - recentSessions.length} old sessions`);
      }
    }
    
    // Clean up URL stats for URLs that haven't been used recently
    if (storage.urlStats) {
      const cutoffTime = Date.now() - (CLEANUP_INTERVAL_DAYS * 2 * 24 * 60 * 60 * 1000); // 2 weeks
      const recentUrlStats = {};
      
      for (const [url, stats] of Object.entries(storage.urlStats)) {
        if (stats.lastUsed && stats.lastUsed > cutoffTime) {
          recentUrlStats[url] = stats;
        }
      }
      
      if (Object.keys(recentUrlStats).length < Object.keys(storage.urlStats).length) {
        await chrome.storage.local.set({ urlStats: recentUrlStats });
        cleanupPerformed = true;
        console.log(`Cleaned up ${Object.keys(storage.urlStats).length - Object.keys(recentUrlStats).length} old URL stats`);
      }
    }
    
    // Clean up orphaned rotation states
    for (const key of Object.keys(storage)) {
      if (key.startsWith('rotation_')) {
        const tabId = parseInt(key.replace('rotation_', ''));
        try {
          await chrome.tabs.get(tabId);
        } catch (error) {
          // Tab doesn't exist, remove orphaned state
          await chrome.storage.local.remove(key);
          cleanupPerformed = true;
          console.log(`Cleaned up orphaned rotation state for tab ${tabId}`);
        }
      }
    }
    
    if (cleanupPerformed) {
      console.log('Periodic cleanup completed');
    }
    
  } catch (error) {
    console.error('Error during periodic cleanup:', error);
  }
}

// Storage usage monitoring for memory efficiency
async function getStorageUsage() {
  try {
    const storage = await chrome.storage.local.get();
    const usage = {
      totalKeys: Object.keys(storage).length,
      rotationStates: 0,
      urlStats: Object.keys(storage.urlStats || {}).length,
      sessionStats: (storage.sessionStats || []).length,
      savedUrls: (storage.savedUrls || []).length
    };
    
    // Count rotation states
    for (const key of Object.keys(storage)) {
      if (key.startsWith('rotation_')) {
        usage.rotationStates++;
      }
    }
    
    return usage;
  } catch (error) {
    console.error('Error getting storage usage:', error);
    return null;
  }
}

// Trigger periodic cleanup based on usage
async function checkAndCleanup() {
  const usage = await getStorageUsage();
  if (usage) {
    console.log('Storage usage:', usage);
    
    // Trigger cleanup if storage is getting full
    if (usage.totalKeys > 300 || usage.urlStats > MAX_URL_STATS || usage.sessionStats > MAX_SESSIONS) {
      console.log('Storage usage high, triggering cleanup...');
      await performPeriodicCleanup();
    }
  }
}

// Schedule periodic cleanup every hour
chrome.alarms.create('periodicCleanup', { 
  delayInMinutes: 60, 
  periodInMinutes: 60 
});

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
  if (alarm.name === 'periodicCleanup') {
    await checkAndCleanup();
  } else if (alarm.name.startsWith('rotation_')) {
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

// Clean up when tabs close - enhanced with memory efficiency
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  await stopRotation(closedTabId);
  // Also remove the stored state immediately
  await chrome.storage.local.remove(`rotation_${closedTabId}`);
  console.log(`Cleaned up state for closed tab ${closedTabId}`);
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
  
  // Perform initial cleanup on install/update
  await performPeriodicCleanup();
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
