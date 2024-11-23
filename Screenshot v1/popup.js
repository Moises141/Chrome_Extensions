// Set the default filename for the screenshot
const defaultFilename = 'screenshot.jpg';

// Get references to DOM elements
const form = document.querySelector('form');
const screenshotNameInput = document.getElementById('screenshot-name');
const screenshotPreview = document.getElementById('screenshot-preview');

// Set the default filename in the input field
screenshotNameInput.value = defaultFilename;

// Utility function to show error messages
const showError = (message, parentElement) => {
    const existingError = parentElement.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    parentElement.appendChild(errorDiv);
    
    // Auto-remove error after 5 seconds
    setTimeout(() => errorDiv.remove(), 5000);
};

// Validate filename
const validateFileName = (filename) => {
    const validFilePattern = /^[\w\-. ]+\.(jpg|jpeg|png)$/i;
    if (!validFilePattern.test(filename)) {
        throw new Error('Invalid filename. Please use .jpg, .jpeg, or .png extension');
    }
    return filename;
};

// Create screenshot tile with proper event handling and cleanup
const createScreenshotTile = (screenshotUrl, screenshotName) => {
    const screenshotTile = document.createElement('div');
    screenshotTile.className = 'preview-item'; // Add this class for styling

    // Create container for the image
    const imageContainer = document.createElement('div');
    imageContainer.className = 'screenshot-container';
    
    // Create and setup image
    const img = document.createElement('img');
    img.src = screenshotUrl;
    img.alt = 'Screenshot';
    imageContainer.appendChild(img);
    
    // Create container for controls
    const controls = document.createElement('div');
    controls.className = 'preview-controls';
    
    // Add filename
    const filename = document.createElement('p');
    filename.className = 'download-path';
    filename.textContent = screenshotName;
    controls.appendChild(filename);
    
    // Create delete button
    const deleteButton = document.createElement('button');
    deleteButton.className = 'btn-delete';
    deleteButton.textContent = 'Delete';
    controls.appendChild(deleteButton);
    
    // Add all elements to tile
    screenshotTile.appendChild(imageContainer);
    screenshotTile.appendChild(controls);
    
    const handleDelete = () => {
        screenshotTile.remove();
        URL.revokeObjectURL(screenshotUrl);
    };
    
    deleteButton.addEventListener('click', handleDelete);
    
    // Add cleanup method
    screenshotTile.cleanup = () => {
        deleteButton.removeEventListener('click', handleDelete);
        URL.revokeObjectURL(screenshotUrl);
    };
    
    return screenshotTile;
};

// Handle screenshot capture and download
const captureAndDownloadScreenshot = async (screenshotName) => {
    try {
        form.classList.add('loading');
        
        const screenshotUrl = await new Promise((resolve, reject) => {
            chrome.tabs.captureVisibleTab(null, { format: 'png' }, (url) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(url);
                }
            });
        });

        await new Promise((resolve, reject) => {
            chrome.downloads.download({
                url: screenshotUrl,
                filename: screenshotName
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(downloadId);
                }
            });
        });

        const screenshotTile = createScreenshotTile(screenshotUrl, screenshotName);
        screenshotPreview.appendChild(screenshotTile);
        
        // Reset form
        screenshotNameInput.value = defaultFilename;
        
    } catch (error) {
        showError(error.message || 'Failed to capture screenshot', form);
    } finally {
        form.classList.remove('loading');
    }
};

// Form submit handler
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    try {
        const screenshotName = validateFileName(screenshotNameInput.value.trim());
        await captureAndDownloadScreenshot(screenshotName);
    } catch (error) {
        showError(error.message, form);
    }
});

// Cleanup function for when the popup is closed
window.addEventListener('unload', () => {
    const tiles = screenshotPreview.querySelectorAll('.preview-item');
    tiles.forEach(tile => {
        if (typeof tile.cleanup === 'function') {
            tile.cleanup();
        }
    });
});

        



