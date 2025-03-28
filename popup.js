// Get DOM elements
const textarea = document.getElementById('urls');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const saveButton = document.getElementById('save');
const statusParagraph = document.getElementById('status');
const minTimeInput = document.getElementById('minTime');
const maxTimeInput = document.getElementById('maxTime');

// Cross-browser message sending
function sendMessage(message) {
  if (typeof browser !== 'undefined') {
    return browser.runtime.sendMessage(message);
  } else {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }
}

// Cross-browser tabs query
function getCurrentTab() {
  if (typeof browser !== 'undefined') {
    return browser.tabs.query({ active: true, currentWindow: true });
  }
  return new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
}

// Load current state for this specific tab when popup opens
getCurrentTab().then(tabs => {
  if (tabs.length > 0) {
    const tabId = tabs[0].id;
    sendMessage({ type: "getState", tabId }).then(response => {
      if (response) {
        if (response.isRotating) {
          textarea.value = response.urls.join('\n');
          textarea.disabled = true;
          startButton.disabled = true;
          stopButton.disabled = false;
          saveButton.disabled = true;
          statusParagraph.textContent = "Rotation is active";
        } else {
          textarea.value = response.savedUrls.join('\n');
          textarea.disabled = false;
          startButton.disabled = false;
          stopButton.disabled = true;
          saveButton.disabled = false;
          statusParagraph.textContent = "Rotation is stopped";
        }
        minTimeInput.value = response.minTime || 60;
        maxTimeInput.value = response.maxTime || 90;
      }
    });
  }
});

// Start rotation for current tab
startButton.addEventListener('click', () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  const minTime = parseInt(minTimeInput.value);
  const maxTime = parseInt(maxTimeInput.value);

  if (urls.length === 0) {
    statusParagraph.textContent = "Please enter at least one URL.";
    return;
  }
  
  if (isNaN(minTime) || minTime < 1) {
    statusParagraph.textContent = "Invalid minimum time";
    return;
  }

  if (isNaN(maxTime) || maxTime < 1) {
    statusParagraph.textContent = "Invalid maximum time";
    return;
  }

  if (minTime >= maxTime) {
    statusParagraph.textContent = "Minimum time must be less than maximum";
    return;
  }

  getCurrentTab().then(tabs => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      sendMessage({ 
        type: "start", 
        urls, 
        minTime, 
        maxTime,
        tabId 
      }).then(() => {
        textarea.disabled = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        saveButton.disabled = true;
        statusParagraph.textContent = "Rotation is active";
      });
    }
  });
});

// Stop rotation for current tab
stopButton.addEventListener('click', () => {
  getCurrentTab().then(tabs => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      sendMessage({ type: "stop", tabId }).then(() => {
        return sendMessage({ type: "getState", tabId });
      }).then(response => {
        textarea.value = response.savedUrls.join('\n');
        textarea.disabled = false;
        startButton.disabled = false;
        stopButton.disabled = true;
        saveButton.disabled = false;
        statusParagraph.textContent = "Rotation is stopped";
      });
    }
  });
});

// Save URLs
saveButton.addEventListener('click', () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  sendMessage({ type: "saveUrls", urls }).then(() => {
    statusParagraph.textContent = "URLs saved successfully";
  });
});