// Set the default filename for the screenshot
const defaultFilename = 'screenshot.jpg';

// Get a reference to the form and the screenshot name input field
const form = document.querySelector('form');
const screenshotNameInput = document.getElementById('screenshot-name');
const screenshotPreview = document.getElementById('screenshot-preview');


// Set the default filename in the input field
screenshotNameInput.value = defaultFilename;

// Add an event listener to the form's submit event
form.addEventListener('submit', (event) => {
  event.preventDefault();

  // Get the screenshot name from the input field
  const screenshotName = screenshotNameInput.value;

  // Use the chrome.tabs API to capture a screenshot of the current tab
  chrome.tabs.captureVisibleTab((screenshotUrl) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError.message);
      return;
    }

    // Use the chrome.downloads API to initiate a download of the screenshot
    chrome.downloads.download({
      url: screenshotUrl,
      filename: screenshotName
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        return;
      }
      // Add a preview tile for the screenshot to the preview area
      const screenshotTile = document.createElement('div');
      screenshotTile.innerHTML = `
        <div>
          <img src="${screenshotUrl}" alt="Screenshot">
          <p class="download-path">${screenshotName}</p>
          <button class="delete">Delete</button>
        </div>
      `;
      screenshotPreview.appendChild(screenshotTile);
      screenshotTile.addEventListener('click', function(event) {
        if (event.target.className === 'delete') {
          // Delete the screenshot preview element from the page
          screenshotTile.remove();
        }
      });      
    });
  });
});
document.querySelector('#delete-button').addEventListener('click', () => {
    const screenshotImage = document.querySelector('.default-image');
    screenshotImage.parentNode.removeChild(screenshotImage);
    document.querySelector('#delete-button').style.display = 'none';
  });
  
  
        



