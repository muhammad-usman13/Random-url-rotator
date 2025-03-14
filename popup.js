// Get DOM elements
const textarea = document.getElementById('urls');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const statusParagraph = document.getElementById('status');

// Load current state when popup opens
browser.runtime.sendMessage({ type: "getState" }).then(response => {
  if (response) {
    textarea.value = response.urls.join('\n');
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
  if (urls.length > 0) {
    browser.runtime.sendMessage({ type: "start", urls }).then(() => {
      textarea.disabled = true;
      startButton.disabled = true;
      stopButton.disabled = false;
      statusParagraph.textContent = "Rotation is active";
    });
  } else {
    statusParagraph.textContent = "Please enter at least one URL.";
  }
});

// Stop rotation
stopButton.addEventListener('click', () => {
  browser.runtime.sendMessage({ type: "stop" }).then(() => {
    textarea.disabled = false;
    startButton.disabled = false;
    stopButton.disabled = true;
    statusParagraph.textContent = "Rotation is stopped";
  });
});