import { onRequest } from "firebase-functions/v2/https";
import admin from "firebase-admin";
import { spots } from "./config.js";
import { calculateSpotWaveHeight, calculateWindQuality } from "./forecaster.js";
import { generateLLMForecast } from "./llm_client.js";

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// Helper to get day name safely
function getDayName(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// Map regions to the representative Open-Meteo coordinate indices:
// Index 0: North Shore
// Index 1: South Shore
// Index 2: West Side
// Index 3: East Side
const regionIndices = {
  "North Shore": 0,
  "South Shore": 1,
  "West Side": 2,
  "East Side": 3
};

export const forecast = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
  try {
    // 1. Check Firestore Cache
    const cacheRef = db.collection("forecasts").doc("oahu");
    const cacheDoc = await cacheRef.get();
    
    if (cacheDoc.exists) {
      const cacheData = cacheDoc.data();
      const ageMs = Date.now() - cacheData.updatedAt.toDate().getTime();
      const threeHours = 3 * 60 * 60 * 1000;
      
      // If cache is fresh and not forced, return it
      if (ageMs < threeHours && req.query.force !== "true") {
        console.log("Serving surf forecast from Firestore cache");
        res.setHeader("Cache-Control", "public, max-age=10800");
        return res.status(200).json(cacheData.forecast);
      }
    }

    console.log("Cache expired or missing. Fetching fresh meteorological data...");

    // 2. Fetch Meteorological Data
    // Representative lat/lons: Pipeline (NS), Ala Moana Bowls (SS), Makaha (WS), Sandy Beach (ES)
    const lats = "21.6640,21.2840,21.4750,21.2850";
    const lons = "-158.0530,-157.8420,-158.2250,-157.6720";
    
    const marineUrl = `https://api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction&timezone=Pacific%2FHonolulu`;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=Pacific%2FHonolulu`;
    
    // NOAA Tides: Honolulu (Station 1612340) for South/West/North, Mokuoloe (Station 1612480) for East
    const tideHNLUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&product=predictions&datum=mllw&format=json&units=english&time_zone=lst_ldt&station=1612340&range=72&interval=hilo`;
    const tideMOKUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&product=predictions&datum=mllw&format=json&units=english&time_zone=lst_ldt&station=1612480&range=72&interval=hilo`;

    const [marineRes, weatherRes, tideHNLRes, tideMOKRes] = await Promise.all([
      fetch(marineUrl).then(r => r.json()),
      fetch(weatherUrl).then(r => r.json()),
      fetch(tideHNLUrl).then(r => r.json()).catch(err => ({ predictions: [] })),
      fetch(tideMOKUrl).then(r => r.json()).catch(err => ({ predictions: [] }))
    ]);

    // Validate responses
    if (!marineRes.hourly || !weatherRes.hourly) {
      throw new Error("Failed to fetch weather or marine data from Open-Meteo.");
    }

    // 3. Parse Tide Data by Day
    const parseTides = (predictions) => {
      const tideDays = {};
      if (!predictions) return tideDays;
      for (const pred of predictions) {
        // Date format: "2026-06-20 04:30"
        const [datePart, timePart] = pred.t.split(" ");
        if (!tideDays[datePart]) tideDays[datePart] = [];
        
        // Format time to 12h
        const [hour, min] = timePart.split(":");
        const hourNum = parseInt(hour);
        const ampm = hourNum >= 12 ? "PM" : "AM";
        const formattedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
        const time12 = `${formattedHour}:${min} ${ampm}`;
        
        tideDays[datePart].push({
          time: time12,
          height: `${parseFloat(pred.v).toFixed(1)} ft`,
          type: pred.type === "H" ? "High" : "Low"
        });
      }
      return tideDays;
    };

    const tidesHNL = parseTides(tideHNLRes.predictions);
    const tidesMOK = parseTides(tideMOKRes.predictions);

    // 4. Group Forecast Data into 3 Days
    // We'll extract 3 distinct dates from the Open-Meteo hourly timestamps
    const times = marineRes[0]?.hourly?.time || marineRes.hourly?.time || [];
    if (times.length === 0) {
      throw new Error("Invalid hourly time arrays in Open-Meteo response.");
    }

    // Find the unique dates in the forecast
    const uniqueDates = [...new Set(times.map(t => t.split("T")[0]))].slice(0, 3);
    
    const daysData = [];

    for (const dateStr of uniqueDates) {
      const dayData = {
        date: dateStr,
        dayName: getDayName(dateStr),
        tides: {
          hnl: tidesHNL[dateStr] || [],
          mok: tidesMOK[dateStr] || []
        },
        spots: {}
      };

      // Key times of the day to evaluate (6 AM, 12 PM, 6 PM)
      const targetHours = [
        { label: "Morning", hourStr: "06:00" },
        { label: "Mid-day", hourStr: "12:00" },
        { label: "Afternoon", hourStr: "18:00" }
      ];

      for (const spot of spots) {
        dayData.spots[spot.id] = [];
        
        // Determine which Open-Meteo coordinate index to use for this spot
        const coordIdx = regionIndices[spot.region];
        const spotHourlyMarine = Array.isArray(marineRes) ? marineRes[coordIdx].hourly : marineRes.hourly;
        const spotHourlyWeather = Array.isArray(weatherRes) ? weatherRes[coordIdx].hourly : weatherRes.hourly;

        for (const target of targetHours) {
          // Find the index matching this date and hour
          const timestamp = `${dateStr}T${target.hourStr}`;
          const timeIdx = times.indexOf(timestamp);
          
          if (timeIdx === -1) continue;

          // Retrieve physical variables
          const deepwaterHeight = spotHourlyMarine.swell_wave_height[timeIdx];
          const period = spotHourlyMarine.swell_wave_period[timeIdx];
          const direction = spotHourlyMarine.swell_wave_direction[timeIdx];
          const windSpeed = spotHourlyWeather.wind_speed_10m[timeIdx];
          const windDir = spotHourlyWeather.wind_direction_10m[timeIdx];

          // Compute surf metrics
          const waveMetrics = calculateSpotWaveHeight(spot, deepwaterHeight, period, direction);
          const windQuality = calculateWindQuality(spot, windSpeed, windDir);

          // Get tide height at this general hour
          // We can find the closest predicted tide height for simplicity or show the tide peak summary
          dayData.spots[spot.id].push({
            time: target.label,
            timeStr: target.hourStr,
            faceHeight: waveMetrics.faceHeight,
            hawaiianHeight: waveMetrics.hawaiianHeight,
            windSpeed: Math.round(windSpeed),
            windDir,
            windQuality: windQuality.label,
            windClass: windQuality.class,
            windDesc: windQuality.description,
            swellHeight: Math.round(deepwaterHeight * 2) / 2,
            swellPeriod: Math.round(period),
            swellDir: Math.round(direction)
          });
        }
      }
      daysData.push(dayData);
    }

    // 5. Structure data summary to send to LLM (keep it compact)
    const dataSummaryForLLM = daysData.map(day => ({
      date: day.date,
      dayName: day.dayName,
      spots: Object.keys(day.spots).reduce((acc, spotId) => {
        const spotDetails = spots.find(s => s.id === spotId);
        acc[spotId] = {
          name: spotDetails.name,
          region: spotDetails.region,
          forecast: day.spots[spotId].map(f => ({
            time: f.time,
            surf: `${f.hawaiianHeight}ft Hawaiian (${f.faceHeight}ft face)`,
            wind: `${f.windSpeed}kts from ${f.windDir}° (${f.windQuality})`,
            swell: `${f.swellHeight}ft @ ${f.swellPeriod}s from ${f.swellDir}°`
          }))
        };
        return acc;
      }, {})
    }));

    // 6. Generate DeepSeek LLM Narrative Predictions
    console.log("Requesting surf analysis from DeepSeek v4 Flash...");
    const llmForecast = await generateLLMForecast(dataSummaryForLLM);

    // 7. Consolidate and cache final forecast
    const finalForecast = {
      updatedAt: new Date().toISOString(),
      spotsList: spots,
      days: daysData,
      llmForecast
    };

    await cacheRef.set({
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      forecast: finalForecast
    });

    console.log("Forecast successfully compiled and cached in Firestore.");
    res.setHeader("Cache-Control", "public, max-age=10800");
    return res.status(200).json(finalForecast);

  } catch (error) {
    console.error("Forecast function error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error.message
    });
  }
});
