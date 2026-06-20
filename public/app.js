// Oahu Surf Forecasting Agent - Client Controller

// State Management
let forecastData = null;
let activeRegion = 'all';
let activeTideStation = 'hnl'; // 'hnl' or 'mok'

// DOM Elements
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const outlookTextEl = document.getElementById('outlook-text');
const spotsGridEl = document.getElementById('spots-grid');
const tideListEl = document.getElementById('tide-list');
const regionSummaryContainer = document.getElementById('region-summary-container');
const regionSummaryTitle = document.getElementById('region-summary-title');
const regionSummaryText = document.getElementById('region-summary-text');
const regionTabs = document.querySelectorAll('.nav-tab');
const tideTabs = document.querySelectorAll('.tide-tab');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchForecast();
  setupEventListeners();
});

// Event Listeners Setup
function setupEventListeners() {
  // Refresh Button
  refreshBtn.addEventListener('click', () => {
    fetchForecast(true); // force refresh
  });

  // Region Filter Tabs
  regionTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      regionTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeRegion = tab.dataset.region;
      renderDashboard();
    });
  });

  // Tide Station Tabs
  tideTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      tideTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTideStation = tab.dataset.station;
      renderTides();
    });
  });
}

// Fetch Forecast Data from API
async function fetchForecast(force = false) {
  showLoading();
  try {
    let url = '/api/forecast';
    if (force) {
      url += '?force=true';
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    forecastData = await response.json();
    console.log("Forecast loaded successfully:", forecastData);
    
    renderDashboard();
  } catch (error) {
    console.error("Error fetching forecast:", error);
    showError(error.message);
  }
}

// Show Loading State
function showLoading() {
  spotsGridEl.innerHTML = `
    <div class="loading-overlay">
      <div class="spinner"></div>
      <p>Consulting physical models and generating AI forecast...</p>
    </div>
  `;
  outlookTextEl.textContent = "Updating outlook narrative...";
  lastUpdatedEl.textContent = "Fetching...";
}

// Show Error State
function showError(message) {
  spotsGridEl.innerHTML = `
    <div class="loading-overlay" style="color: #ef4444;">
      <p>Error loading forecast: ${message}</p>
      <button onclick="fetchForecast()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: var(--accent-blue); border: none; border-radius: 6px; color: white; cursor: pointer;">Try Again</button>
    </div>
  `;
}

// Render Core Components
function renderDashboard() {
  if (!forecastData) return;

  // 1. Last Updated Timestamp
  const updateDate = new Date(forecastData.updatedAt);
  lastUpdatedEl.textContent = `Updated: ${updateDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} HST`;

  // 2. Swell Outlook
  outlookTextEl.textContent = forecastData.llmForecast?.outlook || "Swell forecast summary currently unavailable.";

  // 3. Regional Summary Box
  if (activeRegion === 'all') {
    regionSummaryContainer.style.display = 'none';
  } else {
    regionSummaryContainer.style.display = 'block';
    regionSummaryTitle.textContent = `${activeRegion} Outlook`;
    regionSummaryText.textContent = forecastData.llmForecast?.regions?.[activeRegion] || "Narrative forecast unavailable for this shore.";
  }

  // 4. Render Spots and Tides
  renderSpots();
  renderTides();
}

// Render Tide Predictions Sidebar
function renderTides() {
  if (!forecastData || !forecastData.days) return;
  tideListEl.innerHTML = '';

  forecastData.days.forEach(day => {
    const dayBlock = document.createElement('div');
    dayBlock.className = 'tide-day-block';

    const dayName = document.createElement('div');
    dayName.className = 'tide-day-name';
    dayName.textContent = day.dayName;

    const listItems = document.createElement('div');
    listItems.className = 'tide-list-items';

    // Retrieve predictions for the selected station ('hnl' or 'mok')
    const predictions = day.tides[activeTideStation] || [];
    
    if (predictions.length === 0) {
      listItems.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted);">No predictions.</div>';
    } else {
      predictions.forEach(pred => {
        const item = document.createElement('div');
        item.className = 'tide-item';
        item.innerHTML = `
          <span>${pred.time}</span>
          <span class="tide-type-${pred.type.toLowerCase()}">${pred.type}: ${pred.height}</span>
        `;
        listItems.appendChild(item);
      });
    }

    dayBlock.appendChild(dayName);
    dayBlock.appendChild(listItems);
    tideListEl.appendChild(dayBlock);
  });
}

// Render Surf Spots Cards
function renderSpots() {
  if (!forecastData || !forecastData.spotsList || !forecastData.days) return;
  spotsGridEl.innerHTML = '';

  // Filter spots by region
  const filteredSpots = activeRegion === 'all' 
    ? forecastData.spotsList 
    : forecastData.spotsList.filter(s => s.region === activeRegion);

  if (filteredSpots.length === 0) {
    spotsGridEl.innerHTML = '<div class="loading-overlay"><p>No spots found in this region.</p></div>';
    return;
  }

  filteredSpots.forEach(spot => {
    // Get Day 1 calculations for primary card display
    const todayForecast = forecastData.days[0]?.spots[spot.id] || [];
    
    // Find the peak conditions (max wave size) for Today
    let peakFace = 0;
    let peakHawaiian = 0;
    let bestWindClass = 'choppy';
    let bestWindQuality = 'Onshore';
    
    // Default to the first time slot (Morning) if no clear peak is found
    if (todayForecast.length > 0) {
      peakFace = todayForecast[0].faceHeight;
      peakHawaiian = todayForecast[0].hawaiianHeight;
      bestWindClass = todayForecast[0].windClass;
      bestWindQuality = todayForecast[0].windQuality;
      
      // Look for the absolute max wave height today
      todayForecast.forEach(slot => {
        if (slot.faceHeight > peakFace) {
          peakFace = slot.faceHeight;
          peakHawaiian = slot.hawaiianHeight;
        }
      });
    }

    // Determine the overall wave height label
    const waveHeightStr = peakFace === 0 
      ? "Flat" 
      : `${peakHawaiian}-${Math.max(peakHawaiian, Math.round(peakFace * 0.7))} ft`;

    // AI Prediction text for this spot
    const aiSpotText = forecastData.llmForecast?.spots?.[spot.id] || "No spot-specific predictions generated.";

    const card = document.createElement('div');
    card.className = 'card spot-card animate-fade-in';
    card.id = `spot-card-${spot.id}`;

    // Spot Card HTML structure
    card.innerHTML = `
      <div class="spot-header">
        <div class="spot-title-area">
          <span class="spot-name">${spot.name}</span>
          <span class="spot-region">${spot.region}</span>
        </div>
      </div>
      
      <div class="spot-badges">
        <span class="badge badge-difficulty" data-diff="${spot.difficulty}">${spot.difficulty}</span>
        <span class="badge badge-type">${spot.type}</span>
      </div>

      <div class="spot-overview">
        <div class="overview-box">
          <div class="overview-label">Hawaiian Size</div>
          <div class="overview-val">${waveHeightStr}</div>
          <div class="overview-val-sub">${peakFace}ft face peak</div>
        </div>
        <div class="overview-box">
          <div class="overview-label">Wind Quality</div>
          <div class="overview-quality-badge ${bestWindClass}">${bestWindQuality}</div>
          <div class="overview-val-sub">Today's winds</div>
        </div>
      </div>

      <div class="spot-ai-forecast">
        <div class="ai-label">AI Spot Analysis</div>
        <p class="ai-text">${aiSpotText}</p>
      </div>

      <button class="details-toggle" data-spot="${spot.id}">
        <span>Show 3-Day Details</span>
        <svg class="toggle-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div class="spot-details-panel" id="panel-${spot.id}">
        <!-- Populated day-by-day table -->
        ${renderThreeDayDetails(spot.id)}
      </div>
    `;

    // Hook up expandable detail toggle
    const toggleBtn = card.querySelector('.details-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = card.classList.toggle('expanded');
      toggleBtn.querySelector('span').textContent = isExpanded ? 'Hide 3-Day Details' : 'Show 3-Day Details';
    });

    spotsGridEl.appendChild(card);
  });
}

// Render the 3-day morning/mid-day/afternoon tables inside card
function renderThreeDayDetails(spotId) {
  let html = '';
  
  forecastData.days.forEach(day => {
    const spotForecasts = day.spots[spotId] || [];
    if (spotForecasts.length === 0) return;

    html += `
      <div class="detail-row">
        <div class="detail-row-header">${day.dayName} (${day.date.substring(5)})</div>
        <div style="display: flex; flex-direction: column; gap: 0.25rem;">
    `;

    spotForecasts.forEach(slot => {
      // Swell text
      const swellText = slot.faceHeight === 0 
        ? "Flat" 
        : `${slot.swellHeight}ft @ ${slot.swellPeriod}s from ${slot.swellDir}°`;
      
      // Wind text
      const windText = `${slot.windSpeed}kts ${getWindCardinal(slot.windDir)}`;
      
      // Wave size text
      const surfText = slot.faceHeight === 0
        ? "0ft"
        : `${slot.hawaiianHeight}ft (${slot.faceHeight}ft face)`;

      html += `
        <div class="detail-grid">
          <div class="detail-metric"><strong>${slot.time}:</strong> ${surfText}</div>
          <div class="detail-metric">💨 ${windText}</div>
          <div class="detail-metric">🌊 ${swellText}</div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  return html;
}

// Convert wind direction degrees to cardinal letters
function getWindCardinal(degrees) {
  const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const val = Math.floor((degrees / 22.5) + 0.5);
  return cardinals[val % 16];
}
