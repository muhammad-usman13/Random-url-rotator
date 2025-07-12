// Get DOM elements
const textarea = document.getElementById('urls');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const saveButton = document.getElementById('save');
const statusParagraph = document.getElementById('status');
const minTimeInput = document.getElementById('minTime');
const maxTimeInput = document.getElementById('maxTime');
const urlCountElement = document.getElementById('urlCount');
const urlValidation = document.getElementById('urlValidation');
const validationIcon = document.getElementById('validationIcon');
const validationText = document.getElementById('validationText');
const nextRotationElement = document.getElementById('nextRotation');

// URL presets
const urlPresets = {
  news: [
    'https://news.google.com',
    'https://www.bbc.com/news',
    'https://www.reuters.com',
    'https://apnews.com',
    'https://www.npr.org'
  ],
  social: [
    'https://twitter.com',
    'https://www.reddit.com',
    'https://www.linkedin.com',
    'https://www.facebook.com'
  ],
  tech: [
    'https://techcrunch.com',
    'https://arstechnica.com',
    'https://www.theverge.com',
    'https://hacker-news.firebaseio.com/v0/topstories.json',
    'https://github.com/trending'
  ]
};

// Chrome message sending
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

// Chrome tabs query
function getCurrentTab() {
  return new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, resolve));
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

// Update URL count and validation
function updateUrlInfo() {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  urlCountElement.textContent = `${urls.length} URL${urls.length !== 1 ? 's' : ''}`;
  
  if (urls.length > 0) {
    const validUrls = urls.filter(isValidUrl);
    const isAllValid = validUrls.length === urls.length;
    
    urlValidation.style.display = 'flex';
    
    if (isAllValid) {
      validationIcon.className = 'validation-icon validation-valid';
      validationText.textContent = `All ${urls.length} URLs are valid`;
    } else {
      validationIcon.className = 'validation-icon validation-invalid';
      validationText.textContent = `${validUrls.length}/${urls.length} URLs are valid`;
    }
  } else {
    urlValidation.style.display = 'none';
  }
}

// Update status with better styling
function updateStatus(message, type = 'normal') {
  statusParagraph.textContent = message;
  statusParagraph.className = '';
  
  switch (type) {
    case 'active':
      statusParagraph.classList.add('status-active');
      break;
    case 'stopped':
      statusParagraph.classList.add('status-stopped');
      break;
    case 'error':
      statusParagraph.classList.add('status-error');
      break;
  }
}

// Handle preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    if (preset === 'custom') {
      textarea.value = '';
      textarea.focus();
    } else if (urlPresets[preset]) {
      textarea.value = urlPresets[preset].join('\n');
      updateUrlInfo();
    }
  });
});

// Add event listeners for real-time validation
textarea.addEventListener('input', updateUrlInfo);
minTimeInput.addEventListener('input', validateTimeInputs);
maxTimeInput.addEventListener('input', validateTimeInputs);

function validateTimeInputs() {
  const minTime = parseInt(minTimeInput.value);
  const maxTime = parseInt(maxTimeInput.value);
  
  if (minTime >= maxTime && minTime > 0 && maxTime > 0) {
    minTimeInput.style.borderColor = '#ea4335';
    maxTimeInput.style.borderColor = '#ea4335';
  } else {
    minTimeInput.style.borderColor = '';
    maxTimeInput.style.borderColor = '';
  }
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
          updateStatus("🔄 Rotation is active", 'active');
          
          // Show next rotation info if available
          if (response.nextRotationTime) {
            const timeLeft = Math.max(0, response.nextRotationTime - Date.now());
            if (timeLeft > 0) {
              nextRotationElement.style.display = 'block';
              updateNextRotationDisplay(timeLeft);
            }
          }
        } else {
          textarea.value = response.savedUrls.join('\n');
          textarea.disabled = false;
          startButton.disabled = false;
          stopButton.disabled = true;
          saveButton.disabled = false;
          updateStatus("⏸️ Rotation is stopped", 'stopped');
          nextRotationElement.style.display = 'none';
        }
        minTimeInput.value = response.minTime || 60;
        maxTimeInput.value = response.maxTime || 90;
        updateUrlInfo();
      }
    });
  }
});

// Update next rotation display
function updateNextRotationDisplay(timeLeft) {
  const minutes = Math.floor(timeLeft / 60000);
  const seconds = Math.floor((timeLeft % 60000) / 1000);
  nextRotationElement.textContent = `Next rotation in: ${minutes}m ${seconds}s`;
}

// Start rotation for current tab
startButton.addEventListener('click', () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  const minTime = parseInt(minTimeInput.value);
  const maxTime = parseInt(maxTimeInput.value);

  // Enhanced validation
  if (urls.length === 0) {
    updateStatus("❌ Please enter at least one URL", 'error');
    return;
  }

  const validUrls = urls.filter(isValidUrl);
  if (validUrls.length === 0) {
    updateStatus("❌ No valid URLs found", 'error');
    return;
  }

  if (validUrls.length < urls.length) {
    updateStatus(`⚠️ Only ${validUrls.length}/${urls.length} URLs are valid. Continue?`, 'error');
    // Use only valid URLs
    textarea.value = validUrls.join('\n');
    updateUrlInfo();
    return;
  }
  
  if (isNaN(minTime) || minTime < 5) {
    updateStatus("❌ Minimum time must be at least 5 seconds", 'error');
    minTimeInput.focus();
    return;
  }

  if (isNaN(maxTime) || maxTime < 5) {
    updateStatus("❌ Maximum time must be at least 5 seconds", 'error');
    maxTimeInput.focus();
    return;
  }

  if (minTime >= maxTime) {
    updateStatus("❌ Minimum time must be less than maximum time", 'error');
    return;
  }

  getCurrentTab().then(tabs => {
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      sendMessage({ 
        type: "start", 
        urls: validUrls, 
        minTime, 
        maxTime,
        tabId 
      }).then(() => {
        textarea.disabled = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        saveButton.disabled = true;
        updateStatus("🚀 Starting rotation...", 'active');
        nextRotationElement.style.display = 'block';
        
        // Estimate next rotation time
        const avgTime = (minTime + maxTime) / 2;
        setTimeout(() => {
          updateStatus("🔄 Rotation is active", 'active');
        }, 1000);
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
        updateStatus("⏹️ Rotation stopped", 'stopped');
        nextRotationElement.style.display = 'none';
        updateUrlInfo();
      });
    }
  });
});

// Save URLs
saveButton.addEventListener('click', () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  const validUrls = urls.filter(isValidUrl);
  
  if (validUrls.length === 0) {
    updateStatus("❌ No valid URLs to save", 'error');
    return;
  }
  
  // Save only valid URLs
  sendMessage({ type: "saveUrls", urls: validUrls }).then(() => {
    updateStatus(`💾 Saved ${validUrls.length} valid URLs`, 'stopped');
    if (validUrls.length < urls.length) {
      textarea.value = validUrls.join('\n');
      updateUrlInfo();
    }
  });
});