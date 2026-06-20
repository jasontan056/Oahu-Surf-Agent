// Oahu Surf Forecasting Agent - Client Controller

// State Management
let forecastData = null;
let activeRegion = 'all';
let activeTideStation = 'hnl'; // 'hnl' or 'mok'
let searchQuery = '';

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

// Starred Spots Helpers
function getStarredSpots() {
  try {
    return JSON.parse(localStorage.getItem('starred_spots')) || [];
  } catch (e) {
    return [];
  }
}

function toggleStarSpot(spotId) {
  let starred = getStarredSpots();
  if (starred.includes(spotId)) {
    starred = starred.filter(id => id !== spotId);
  } else {
    starred.push(spotId);
  }
  localStorage.setItem('starred_spots', JSON.stringify(starred));
  renderSpots();
}

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

  // Search Input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderSpots();
    });
  }
}

// Fetch Forecast Data from API
async function fetchForecast(force = false) {
  showLoading();
  try {
    const url = '/api/forecast';
    // Use no-cache options if forced, bypassing local browser cache but not backend database caches
    const options = force ? { cache: 'no-cache' } : {};
    
    const response = await fetch(url, options);
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
      <p>Consulting physical models and generating forecast report...</p>
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
  outlookTextEl.textContent = forecastData.narrativeForecast?.outlook || "Swell forecast summary currently unavailable.";

  // 3. Regional Summary Box
  if (activeRegion === 'all') {
    regionSummaryContainer.style.display = 'none';
  } else {
    regionSummaryContainer.style.display = 'block';
    regionSummaryTitle.textContent = `${activeRegion} Outlook`;
    regionSummaryText.textContent = forecastData.narrativeForecast?.regions?.[activeRegion] || "Narrative forecast unavailable for this shore.";
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

  // Filter spots by region and search query
  let filteredSpots = [...forecastData.spotsList];
  
  if (activeRegion !== 'all') {
    filteredSpots = filteredSpots.filter(s => s.region === activeRegion);
  }
  
  if (searchQuery) {
    filteredSpots = filteredSpots.filter(s => 
      s.name.toLowerCase().includes(searchQuery) ||
      s.region.toLowerCase().includes(searchQuery) ||
      s.type.toLowerCase().includes(searchQuery) ||
      s.difficulty.toLowerCase().includes(searchQuery)
    );
  }

  // Sort starred spots to the top
  const starredSpots = getStarredSpots();
  filteredSpots.sort((a, b) => {
    const aStarred = starredSpots.includes(a.id) ? 1 : 0;
    const bStarred = starredSpots.includes(b.id) ? 1 : 0;
    if (aStarred !== bStarred) {
      return bStarred - aStarred; // Starred first
    }
    return 0; // Maintain original order
  });

  if (filteredSpots.length === 0) {
    spotsGridEl.innerHTML = '<div class="loading-overlay"><p>No spots found matching filters.</p></div>';
    return;
  }

  filteredSpots.forEach(spot => {
    // Get Day 1 calculations for primary card display
    const todayForecast = forecastData.days[0]?.spots[spot.id] || [];
    
    // Find the peak conditions (max wave size and best rating score) for Today
    let peakFace = 0;
    let peakHawaiian = 0;
    let bestWindClass = 'choppy';
    let bestWindQuality = 'Onshore';
    let bestRating = 'Poor';
    let bestRatingClass = 'rating-poor';
    let bestRatingScore = 0;
    
    // Default to the first time slot (Morning) if no clear peak is found
    if (todayForecast.length > 0) {
      peakFace = todayForecast[0].faceHeight;
      peakHawaiian = todayForecast[0].hawaiianHeight;
      bestWindClass = todayForecast[0].windClass;
      bestWindQuality = todayForecast[0].windQuality;
      bestRating = todayForecast[0].spotRating || 'Poor';
      bestRatingClass = todayForecast[0].spotRatingClass || 'rating-poor';
      bestRatingScore = todayForecast[0].spotRatingScore || 0;
      
      // Look for the absolute max wave height today and the highest spot rating score
      todayForecast.forEach(slot => {
        if (slot.faceHeight > peakFace) {
          peakFace = slot.faceHeight;
          peakHawaiian = slot.hawaiianHeight;
        }
        if ((slot.spotRatingScore || 0) > bestRatingScore) {
          bestRating = slot.spotRating;
          bestRatingClass = slot.spotRatingClass;
          bestRatingScore = slot.spotRatingScore;
          bestWindClass = slot.windClass;
          bestWindQuality = slot.windQuality;
        }
      });
    }

    // Determine the overall wave height label (Defaulting to Face Height)
    const waveHeightStr = peakFace === 0 
      ? "Flat" 
      : `${Math.round(peakFace * 0.7)}-${peakFace} ft`;

    // AI Spot Interpreter Data
    const spotAiData = forecastData.narrativeForecast?.spots?.[spot.id] || {};
    const spotNarrativeText = spotAiData.analysis || "No spot-specific predictions generated.";

    let finalRating = bestRating;
    let finalRatingClass = bestRatingClass;
    let finalRatingScore = bestRatingScore;

    if (spotAiData.ratingRefined && typeof spotAiData.scoreRefined === 'number') {
      finalRating = spotAiData.ratingRefined;
      finalRatingScore = spotAiData.scoreRefined;
      
      const score = spotAiData.scoreRefined;
      if (score < 15) finalRatingClass = "rating-very-poor";
      else if (score < 35) finalRatingClass = "rating-poor";
      else if (score < 50) finalRatingClass = "rating-poor-to-fair";
      else if (score < 70) finalRatingClass = "rating-fair";
      else if (score < 85) finalRatingClass = "rating-fair-to-good";
      else if (score < 95) finalRatingClass = "rating-good";
      else finalRatingClass = "rating-epic";
    }

    if (peakFace === 0) {
      finalRating = "Flat";
      finalRatingClass = "rating-flat";
      finalRatingScore = 0;
    }

    const card = document.createElement('div');
    card.className = 'card spot-card animate-fade-in';
    card.id = `spot-card-${spot.id}`;

    const isStarred = starredSpots.includes(spot.id);
    const starClass = isStarred ? 'star-btn active' : 'star-btn';

    // Spot Card HTML structure
    card.innerHTML = `
      <div class="spot-header">
        <div class="spot-title-area">
          <span class="spot-name">${spot.name}</span>
          <span class="spot-region">${spot.region}</span>
        </div>
        <button class="${starClass}" data-spot="${spot.id}" title="${isStarred ? 'Unstar this spot' : 'Star this spot'}">
          <svg class="star-icon" viewBox="0 0 24 24">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
          </svg>
        </button>
      </div>
      
      <div class="spot-badges">
        <span class="badge badge-difficulty" data-diff="${spot.difficulty}">${spot.difficulty}</span>
        <span class="badge badge-type">${spot.type}</span>
      </div>

      <div class="spot-overview">
        <div class="overview-box">
          <div class="overview-label">Face Height</div>
          <div class="overview-val">${waveHeightStr}</div>
          <div class="overview-val-sub">${peakHawaiian}ft Hawaiian peak</div>
        </div>
        <div class="overview-box">
          <div class="overview-label">Spot Rating</div>
          <div class="overview-rating-badge ${finalRatingClass}">${finalRating}</div>
          <div class="overview-val-sub">Score: ${finalRatingScore}/100</div>
        </div>
        <div class="overview-box">
          <div class="overview-label">Wind Quality</div>
          <div class="overview-quality-badge ${bestWindClass}">${bestWindQuality}</div>
          <div class="overview-val-sub">Today's winds</div>
        </div>
      </div>

      <div class="ai-insights-container">
        <div class="insight-tag">
          <span class="insight-icon">🌊</span>
          <span class="insight-label">Shape:</span>
          <span class="insight-value">${spotAiData.waveShape || 'N/A'}</span>
        </div>
        <div class="insight-tag">
          <span class="insight-icon">🏄‍♂️</span>
          <span class="insight-label">Board:</span>
          <span class="insight-value">${spotAiData.recommendedBoard || 'N/A'}</span>
        </div>
        <div class="insight-tag">
          <span class="insight-icon">👥</span>
          <span class="insight-label">Crowd:</span>
          <span class="insight-value">${spotAiData.crowdFactor || 'N/A'}</span>
        </div>
        <div class="insight-tag risk-${getRiskClass(spotAiData.safetyRisk)}">
          <span class="insight-icon">⚠️</span>
          <span class="insight-label">Safety:</span>
          <span class="insight-value">${spotAiData.safetyRisk || 'N/A'}</span>
        </div>
      </div>

      <div class="spot-narrative-forecast">
        <div class="narrative-label">AI Spot Interpretation</div>
        <p class="narrative-text">${spotNarrativeText}</p>
      </div>

      <button class="details-toggle" data-spot="${spot.id}">
        <span>Show 7-Day Details</span>
        <svg class="toggle-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div class="spot-details-panel" id="panel-${spot.id}">
        <!-- Populated day-by-day table -->
        ${renderSevenDayDetails(spot.id)}
      </div>
    `;

    // Hook up star button click
    const starBtn = card.querySelector('.star-btn');
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleStarSpot(spot.id);
    });

    // Hook up expandable detail toggle
    const toggleBtn = card.querySelector('.details-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = card.classList.toggle('expanded');
      toggleBtn.querySelector('span').textContent = isExpanded ? 'Hide 7-Day Details' : 'Show 7-Day Details';
    });

    spotsGridEl.appendChild(card);
  });
}

// Render the 7-day morning/mid-day/afternoon tables inside card
function renderSevenDayDetails(spotId) {
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

      // Spot rating text/class
      const ratingText = slot.faceHeight === 0 ? "Flat" : slot.spotRating;
      const ratingClass = slot.faceHeight === 0 ? "rating-flat" : (slot.spotRatingClass || "rating-poor");

      html += `
        <div class="detail-grid">
          <div class="detail-metric"><strong>${slot.time}:</strong> ${surfText}</div>
          <div class="detail-metric"><span class="detail-rating-badge ${ratingClass}">${ratingText}</span></div>
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

// Parse risk levels to CSS classes
function getRiskClass(safetyRisk) {
  if (!safetyRisk) return 'low';
  const risk = safetyRisk.toLowerCase();
  if (risk.includes('high')) return 'high';
  if (risk.includes('moderate') || risk.includes('medium')) return 'moderate';
  return 'low';
}
