const textarea = document.getElementById('urls');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusParagraph = document.getElementById('status');
const minTimeInput = document.getElementById('minTime');
const maxTimeInput = document.getElementById('maxTime');
const saveButton = document.getElementById('save');

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Message error:', chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// Load saved URLs and state
(async () => {
  try {
    const tab = await getCurrentTab();
    const response = await sendMessage({ type: "getState", tabId: tab.id });
    
    if (response) {
      textarea.value = response.urls?.join('\n') || '';
      minTimeInput.value = response.minTime || 60;
      maxTimeInput.value = response.maxTime || 90;

      if (response.isRotating) {
        textarea.disabled = true;
        startButton.disabled = true;
        stopButton.disabled = false;
        statusParagraph.textContent = "Rotation is active";
      } else {
        const { savedURLs } = await chrome.storage.local.get(['savedURLs']);
        if (savedURLs) textarea.value = savedURLs.join('\n');
      }
    }
  } catch (error) {
    console.log('Initialization error:', error);
  }
})();

// Save URLs
saveButton.addEventListener('click', async () => {
  const urlsToSave = textarea.value.split('\n').map(url => url.trim()).filter(url => url);
  
  if (!urlsToSave.length) {
    statusParagraph.textContent = "No URLs to save";
    return;
  }

  await chrome.storage.local.set({ savedURLs: urlsToSave });
  statusParagraph.textContent = "URLs saved!";
  setTimeout(() => statusParagraph.textContent = "", 2000);
});

// Start rotation
startButton.addEventListener('click', async () => {
  const urls = textarea.value.split('\n').map(url => url.trim()).filter(url => url);
  const minTime = parseInt(minTimeInput.value);
  const maxTime = parseInt(maxTimeInput.value);

  if (!urls.length) return statusParagraph.textContent = "Please enter URLs";
  if (isNaN(minTime)) return statusParagraph.textContent = "Invalid minimum time";
  if (isNaN(maxTime)) return statusParagraph.textContent = "Invalid maximum time";
  if (minTime >= maxTime) return statusParagraph.textContent = "Min must be < Max";

  try {
    const tab = await getCurrentTab();
    await sendMessage({
      type: "start",
      urls,
      minTime,
      maxTime,
      tabId: tab.id
    });
    
    textarea.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = false;
    statusParagraph.textContent = "Rotation is active";
  } catch (error) {
    statusParagraph.textContent = "Error starting rotation";
    console.error(error);
  }
});

// Stop rotation
stopButton.addEventListener('click', async () => {
  try {
    const tab = await getCurrentTab();
    await sendMessage({ type: "stop", tabId: tab.id });
    
    textarea.disabled = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    statusParagraph.textContent = "Rotation stopped";
  } catch (error) {
    statusParagraph.textContent = "Error stopping rotation";
    console.error(error);
  }
});