// Constants
const customizeBtn = document.getElementById("customizeBtn");
const changeBackgroundButton = document.getElementById("changeBackground");
const addSiteBtn = document.getElementById("addSiteBtn");
const removeLastSiteBtn = document.getElementById("removeLastSiteBtn");
const settingsMenu = document.getElementById("settingsMenu");
const backgroundInput = document.getElementById('backgroundInput');
const backgroundImage = document.getElementById('backgroundImage');
const topSitesList = document.getElementById('topSitesList');
const clock = document.getElementById('clock');
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const soundToggle = document.getElementById("soundToggle");
const customSoundOpenInput = document.getElementById("customSoundOpenInput");
const customSoundCloseInput = document.getElementById("customSoundCloseInput");

// Event listener for changeBackgroundButton
if (changeBackgroundButton) {
  changeBackgroundButton.addEventListener('click', openBackgroundChooser);
}

function openBackgroundChooser() {
  backgroundInput.click();
}

// Function to handle background change
function setBackground(event) {
  const file = event.target.files[0];

  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      // Set the background image of the body
      document.body.style.backgroundImage = `url('${e.target.result}')`;

      // Remove the hidden class from backgroundImage once the image is loaded
      backgroundImage.addEventListener('load', () => {
        backgroundImage.classList.remove('hidden');
      }, { once: true });

      // Set the src attribute of backgroundImage
      backgroundImage.src = e.target.result;

      // Store the background image in localStorage
      localStorage.setItem('backgroundImage', e.target.result);
    };

    reader.readAsDataURL(file);
  }
}

// Initialize background on page load
function initBackground() {
  const savedBackground = localStorage.getItem('backgroundImage');

  if (savedBackground) {
    // Set the background image of the body
    document.body.style.backgroundImage = `url('${savedBackground}')`;

    // Remove the hidden class from backgroundImage once the image is loaded
    backgroundImage.addEventListener('load', () => {
      backgroundImage.classList.remove('hidden');
    }, { once: true });

    // Set the src attribute of backgroundImage
    backgroundImage.src = savedBackground;
  }
}

// Event listener for background input change
backgroundInput.addEventListener('change', setBackground);

// Initialize background when the window loads
window.addEventListener('load', () => {
  initBackground(); // Set background image first
  document.body.style.display = 'block'; // Display body content after background image is set
});

// Clock Functionality
function updateClock() {
  const now = new Date();
  let hours = now.getHours() % 12 || 12; // Convert 0 to 12
  const minutes = now.getMinutes().toString().padStart(2, '0'); // Add leading zero if needed
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  const timeString = hours + ':' + minutes + ' ' + ampm;
  clock.textContent = timeString;
}

setInterval(updateClock, 1000);
updateClock();

// Top Sites Functionality
function loadTopSites() {
  const savedTopSites = localStorage.getItem('topSites');
  if (savedTopSites) {
    topSitesList.innerHTML = savedTopSites;
  }
}

function saveTopSites() {
  localStorage.setItem('topSites', topSitesList.innerHTML);
}

function addSite() {
  const urlInput = prompt("Enter the website URL:");
  const nameInput = prompt("Enter the website name:");

  if (urlInput && nameInput && urlInput.trim() !== "" && nameInput.trim() !== "") {
    let url = urlInput.trim();
    // Check if the URL includes the protocol, if not, prepend "https://"
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const name = nameInput.trim();
    const listItem = document.createElement('li');
    const img = document.createElement('img');
    const anchor = document.createElement('a');

    img.src = `https://www.google.com/s2/favicons?domain=${url}&sz=128`;
    img.classList.add('favicon');
    img.setAttribute('data-url', url);
    img.onerror = function() {
      console.error("Failed to load favicon for:", url);
      img.src = 'default-favicon.png'; // Provide a fallback image
    };

    anchor.href = url;
    anchor.textContent = name;

    listItem.appendChild(img); // Append the image to the list item
    listItem.appendChild(anchor); // Append the anchor (title) to the list item
    topSitesList.appendChild(listItem);

    // Add event listener to the image to navigate to the website
    img.addEventListener('click', function() {
      window.location.href = url;
    });

    saveTopSites();
    // Hide the settings menu
    settingsMenu.style.display = "none";
  } else {
    alert("Please enter a valid website URL and name.");
  }
}

function removeLastSite() {
  const list = document.getElementById('topSitesList');
  const lastItem = list.lastElementChild;
  if (lastItem) {
    list.removeChild(lastItem);
    saveTopSites();
  }
}

// Event listeners for buttons
addSiteBtn.addEventListener("click", addSite);
removeLastSiteBtn.addEventListener("click", removeLastSite);
customizeBtn.addEventListener("click", customize);

window.addEventListener('load', loadTopSites);

window.addEventListener('storage', function(e) {
  if (e.key === 'topSites') {
    loadTopSites();
  }
});

// Google Search Functionality
function searchGoogle() {
  const searchTerm = searchInput.value.trim();
  if (searchTerm !== "") {
    const googleSearchUrl = "https://www.google.com/search?q=" + encodeURIComponent(searchTerm);
    window.location.href = googleSearchUrl;
  }
}

searchButton.addEventListener("click", searchGoogle);

searchInput.addEventListener("keydown", function(event) {
  if (event.key === "Enter") {
    searchGoogle();
  }
});

// Variables to store default sound paths
const defaultOpenSoundPath = "sounds/open_tab_sound.mp3";
const defaultCloseSoundPath = "sounds/close_tab_sound.mp3";

// Function to sync the sound state between tabs
function syncSoundState() {
  // Get the current state from localStorage or default to false if not set
  const isSoundOn = localStorage.getItem("isSoundOn") === "true";

  // Update the checkbox state based on the stored value
  soundToggle.checked = isSoundOn;

  // Update the sound state based on the checkbox state
  updateSoundState();
}

// Function to update the sound state based on the checkbox state
function updateSoundState() {
  const isSoundOn = soundToggle.checked;

  // Update the checkbox state based on the sound state
  soundToggle.checked = isSoundOn;

  // Update the sound state in localStorage only if the toggle is checked
  if (isSoundOn) {
    localStorage.setItem("isSoundOn", isSoundOn);
  } else {
    localStorage.removeItem("isSoundOn"); // Remove the sound state from localStorage if the toggle is unchecked
  }

  // If sound is enabled, attach visibility change event listeners
  if (isSoundOn) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  } else {
    // Remove visibility change event listeners if sound is disabled
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
}
// Function to handle visibility change
function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
      // Tab is hidden (closed)
      playSound(customSoundCloseInput.files.length > 0 ? customSoundCloseInput.files[0] : defaultCloseSoundPath);
  } else {
      // Tab is visible (opened)
      playSound(customSoundOpenInput.files.length > 0 ? customSoundOpenInput.files[0] : defaultOpenSoundPath);
  }
}

// Function to play a sound
function playSound(soundFile) {
  const audio = new Audio();
  audio.src = soundFile instanceof File ? URL.createObjectURL(soundFile) : soundFile;
  audio.play();
}
// Function to handle custom sound change
function handleCustomSoundChange(type) {
  const input = type === 'open' ? customSoundOpenInput : customSoundCloseInput;
  const file = input.files[0];
  
  if (file) {
      // Check if the selected file is an audio file
      if (!file.type.startsWith('audio/')) {
          alert("Please select an audio file.");
          input.value = ''; // Clear the input field
          return;
      }
      
      // Update the sound state
      updateSoundState();
  }
}
// Sync the sound state when the page loads
syncSoundState();

// Add event listener to soundToggle checkbox for change events
soundToggle.addEventListener("change", updateSoundState);

// Add event listeners to custom sound inputs for change events
customSoundOpenInput.addEventListener("change", () => handleCustomSoundChange('open'));
customSoundCloseInput.addEventListener("change", () => handleCustomSoundChange('close'));

function customize() {
  // Your customization logic here
  settingsMenu.style.display = settingsMenu.style.display === "none" ? "block" : "none";
}