// Get DOM elements
const textarea = document.getElementById('urls');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
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

// Load current state when popup opens
sendMessage({ type: "getState" }).then(response => {
  if (response) {
    textarea.value = response.urls.join('\n');
    minTimeInput.value = response.minTime || 60;
    maxTimeInput.value = response.maxTime || 90;
    
    if (response.isRotating) {
      textarea.disabled = true;
      startButton.disabled = true;
      stopButton.disabled = false;
      statusParagraph.textContent = "Rotation is active";
    } else {
      textarea.disabled = false;
      startButton.disabled = false;
      stopButton.disabled = true;
      statusParagraph.textContent = "Rotation is stopped";
    }
  }
});

// Start rotation
startButton.addEventListener('click', () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url !== '');
  const minTime = parseInt(minTimeInput.value);
  const maxTime = parseInt(maxTimeInput.value);

  if (urls.length === 0) {
    statusParagraph.textContent = "Please enter at least one URL.";
    return;
  }
  
  if (isNaN(minTime)) {
    statusParagraph.textContent = "Invalid minimum time";
    return;
  }

  if (isNaN(maxTime)) {
    statusParagraph.textContent = "Invalid maximum time";
    return;
  }

  if (minTime >= maxTime) {
    statusParagraph.textContent = "Minimum time must be less than maximum";
    return;
  }

  if (minTime < 1 || maxTime < 1) {
    statusParagraph.textContent = "Time values must be positive";
    return;
  }

  sendMessage({ type: "start", urls, minTime, maxTime }).then(() => {
    textarea.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    statusParagraph.textContent = "Rotation is active";
  });
});

// Stop rotation
stopButton.addEventListener('click', () => {
  sendMessage({ type: "stop" }).then(() => {
    textarea.disabled = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    statusParagraph.textContent = "Rotation is stopped";
  });
});