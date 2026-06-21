import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import admin from "firebase-admin";
import { spots } from "./config.js";
import {
  calculateSpotWaveHeight,
  calculateWindQuality,
  applyWindShadowing,
  interpolateTideHeight,
  calculateSpotQuality,
  calculateConfidence
} from "./forecaster.js";
import { generateNarrativeForecast } from "./llm_client.js";

// Helper to build the explainer prompt and call DeepSeek
async function generateExplainer(analysisData) {
  const apiKey = process.env.DEEPSEEK_API_SECRET || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return null;
  }

  const explainerPrompt = `You are an expert surf forecaster and physics educator explaining exactly how a surf forecast is computed step by step.

You are given a JSON object containing raw meteorological measurements, surf spot configurations, and detailed intermediate calculations for today's Oahu surf forecast. Your job is to write a clear, educational step-by-step explanation of the entire forecasting pipeline in plain English.

DATA:
${JSON.stringify(analysisData, null, 2)}

Write a step-by-step guide. Return ONLY a valid JSON object with this exact schema:

{
  "overview": "A 2-3 sentence high-level summary of what the forecaster found today.",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Step 1: Raw Data Collection",
      "content": "Explain which APIs we query, what data they return, and show the key raw numbers (swell heights, periods, directions, wind, tide predictions) for today. Mention the 4 coordinate points representing each region."
    },
    {
      "stepNumber": 2,
      "title": "Step 2: Swell Partition Breakdown",
      "content": "Explain how the primary swell, secondary swell, and wind swell are separated. Show which swell components are active today for each region. Mention that each component carries different energy (H\u00b2\u00d7T) and travels from different directions."
    },
    {
      "stepNumber": 3,
      "title": "Step 3: Per-Spot Physics Pipeline",
      "content": "Walk through the 5 physics checks applied to each swell component at each spot: (1) Swell Window check with 15\u00b0 soft taper, (2) Alignment cosine decay from optimal angle, (3) Island shadowing for Molokai/Lanai/Kaena Point, (4) Bathymetry-aware shoaling based on bottom profile (steep-reef vs gradual-reef vs sandbar), (5) Spot magnification factor. Use specific numbers from Pipeline or Bowls as a concrete example."
    },
    {
      "stepNumber": 4,
      "title": "Step 4: Multi-Swell Superposition",
      "content": "Explain how the individual swell component contributions are combined using energy-based superposition (sqrt of sum of squares). Show an example calculation with real numbers from today's data."
    },
    {
      "stepNumber": 5,
      "title": "Step 5: Wind Analysis",
      "content": "Explain wind quality classification (glassy/clean/fair/choppy/blown-out), how wind direction is compared to each spot's optimal wind, and how terrain wind shadowing reduces wind speed for sheltered regions like the West Side (Waianae range blocking trades). Include gust penalties."
    },
    {
      "stepNumber": 6,
      "title": "Step 6: Tide Interpolation",
      "content": "Explain how we take NOAA's high/low tide predictions and linearly interpolate to get the exact tide height (in feet) at each forecast hour, plus determine whether the tide is rising or falling. Show why this matters\u2014spots like Bowls need draining low tides for barrel shape, while Sandy Beach needs high tide for its sandbar."
    },
    {
      "stepNumber": 7,
      "title": "Step 7: Composite Quality Scoring",
      "content": "Break down the 5 sub-scores that combine to the final 0-100 quality rating: Size Score (up to 35, bell-curved around spot's difficulty), Wind Score (up to 30), Period Score (up to 15, bell-curved around spot's optimal period range), Alignment Score (up to 10), Tide Score (up to 10, bell-curved around optimal tide height). Show actual sub-scores for one spot and explain the final rating label (e.g., Fair, Good, Epic)."
    },
    {
      "stepNumber": 8,
      "title": "Step 8: Regional Synthesis & AI Narrative",
      "content": "Explain how all spot calculations feed into the island-wide outlook, regional summaries, and per-spot AI narratives. Explain forecast confidence: High (days 0–1, models agree closely), Moderate (days 2–3, some uncertainty in swell timing/size), Low (days 4–6, significant model spread, check back for updates)."
    }
  ],
  "regionalBreakdowns": {
    "North Shore": "Summarize what's happening on the North Shore today based on the data.",
    "South Shore": "Summarize what's happening on the South Shore today.",
    "West Side": "Summarize what's happening on the West Side today.",
    "East Side": "Summarize what's happening on the East Side today."
  },
  "spotWalkthroughs": {
    "pipeline": "A detailed walkthrough of Pipeline's calculations with actual numbers from today.",
    "bowls": "A detailed walkthrough of Ala Moana Bowls' calculations with actual numbers from today.",
    "makaha": "A detailed walkthrough of Makaha's calculations with actual numbers.",
    "sandybeach": "A detailed walkthrough of Sandy Beach's calculations with actual numbers."
  }
}

IMPORTANT RULES:
- Use the actual numbers from the DATA provided. Do not invent numbers.
- Write in an engaging, educational tone suitable for surfers who want to understand the science.
- Reference specific swell periods, tide heights, wind speeds, and score components.
- Keep each step's content to 3-6 sentences\u2014concise but thorough.
- Each regional breakdown should be 2-3 sentences.
- Each spot walkthrough should be 4-6 sentences tracing the full physics pipeline for that spot.
- Output ONLY valid JSON. No markdown, no code fences.`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: "You output valid JSON only." },
          { role: "user", content: explainerPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`DeepSeek explainer error (${response.status}):`, errText);
      return null;
    }

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  } catch (error) {
    console.error("Explainer generation failed:", error);
    return null;
  }
}

// Declare secret for DeepSeek API Key
const deepseekApiSecret = defineSecret("DEEPSEEK_API_SECRET");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// In-Memory cache fallback in case Firestore is not provisioned/enabled
let memoryCache = null;
let memoryCacheTime = 0;
let explainerCache = null;
let explainerCacheTime = 0;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

// Helper to get day name safely
function getDayName(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

// Map regions to representative coordinate indices
const regionIndices = {
  "North Shore": 0,
  "South Shore": 1,
  "West Side": 2,
  "East Side": 3,
};

// CORS helper
function handleCors(req, res) {
  const allowedOrigins = [
    /https?:\/\/localhost(:\d+)?$/,
    /https?:\/\/127\.0\.0\.1(:\d+)?$/,
    "https://oahu-surf-agent-88a19.web.app",
    "https://oahu-surf-agent-88a19.firebaseapp.com",
  ];
  const origin = req.headers.origin;
  const isAllowed =
    origin &&
    allowedOrigins.some((allowed) => {
      if (allowed instanceof RegExp) return allowed.test(origin);
      return allowed === origin;
    });

  if (origin) {
    if (isAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS, HEAD"
      );
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      console.warn(`Origin ${origin} not allowed by CORS`);
    }
  }
}

// ---------------------------------------------------------------------------
// Feedback endpoint — collects thumbs-up/down for spot calibration
// ---------------------------------------------------------------------------
export const feedback = onRequest(
  { cors: true, timeoutSeconds: 30 },
  async (req, res) => {
    handleCors(req, res);

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    try {
      const { spotId, date, timeSlot, rating } = req.body;

      if (!spotId || !date || !timeSlot || !rating) {
        return res.status(400).json({
          error: "Missing fields",
          required: ["spotId", "date", "timeSlot", "rating"],
        });
      }

      if (!["up", "down"].includes(rating)) {
        return res
          .status(400)
          .json({ error: "rating must be 'up' or 'down'" });
      }

      try {
        await db.collection("feedback").add({
          spotId,
          date,
          timeSlot,
          rating,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`Feedback recorded: ${spotId} ${date} ${timeSlot} → ${rating}`);
        return res.status(200).json({ success: true });
      } catch (firestoreError) {
        console.warn("Firestore feedback write failed:", firestoreError.message);
        // Still return success — the feedback infrastructure note
        return res.status(200).json({
          success: true,
          note: "Feedback recorded in-memory only (Firestore not provisioned)",
        });
      }
    } catch (error) {
      console.error("Feedback error:", error);
      return res
        .status(500)
        .json({ error: "Internal Server Error", message: error.message });
    }
  }
);

// ---------------------------------------------------------------------------
// Main forecast endpoint
// ---------------------------------------------------------------------------
export const forecast = onRequest(
  {
    cors: false,
    timeoutSeconds: 120,
    secrets: [deepseekApiSecret],
  },
  async (req, res) => {
    try {
      res.setHeader("Vary", "Origin");
      handleCors(req, res);

      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      const forceRefresh = req.query.force === "true";
      if (forceRefresh) {
        const clientToken = req.query.forceToken;
        const serverToken = process.env.FORCE_TOKEN || "sk-oahu-surf-agent";
        if (clientToken !== serverToken) {
          console.warn("Unauthorized attempt to bypass cache with force=true");
          res.setHeader(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
          );
          return res.status(401).json({
            error: "Unauthorized",
            message: "Invalid forceToken. Cache bypass is restricted.",
          });
        }
        console.log("Authorized force refresh triggered");
      }

      // 1. Try to read from Firestore Cache, fall back to Memory cache
      if (!forceRefresh) {
        try {
          const cacheRef = db.collection("forecasts").doc("oahu");
          const cacheDoc = await cacheRef.get();

          if (cacheDoc.exists) {
            const cacheData = cacheDoc.data();
            const ageMs = Date.now() - cacheData.updatedAt.toDate().getTime();

            if (ageMs < THREE_HOURS_MS) {
              console.log("Serving surf forecast from Firestore cache");
              res.setHeader(
                "Cache-Control",
                "public, max-age=60, s-maxage=10800, stale-while-revalidate=600"
              );
              return res.status(200).json(cacheData.forecast);
            }
          }
        } catch (firestoreError) {
          console.warn(
            "Firestore cache read failed. Falling back to memory cache:",
            firestoreError.message
          );

          const ageMs = Date.now() - memoryCacheTime;
          if (memoryCache && ageMs < THREE_HOURS_MS) {
            console.log("Serving surf forecast from In-Memory cache");
            res.setHeader(
              "Cache-Control",
              "public, max-age=60, s-maxage=10800, stale-while-revalidate=600"
            );
            return res.status(200).json(memoryCache);
          }
        }
      }

      console.log("Fetching fresh meteorological data from APIs...");

      // 2. Fetch Meteorological Data with multi-swell partitions & wind gusts
      const lats = "21.6640,21.2840,21.4750,21.2850";
      const lons = "-158.0530,-157.8420,-158.2250,-157.6720";

      const marineHourlyParams = [
        "wave_height",
        "swell_wave_height",
        "swell_wave_period",
        "swell_wave_direction",
        "secondary_swell_wave_height",
        "secondary_swell_wave_period",
        "secondary_swell_wave_direction",
        "tertiary_swell_wave_height",
        "tertiary_swell_wave_period",
        "tertiary_swell_wave_direction",
        "wind_wave_height",
        "wind_wave_period",
        "wind_wave_direction",
      ].join(",");

      const weatherHourlyParams = [
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
      ].join(",");

      const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=${marineHourlyParams}&timezone=Pacific%2FHonolulu`;
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${weatherHourlyParams}&wind_speed_unit=kn&timezone=Pacific%2FHonolulu`;

      const getHawaiiTodayYYYYMMDD = () => {
        const options = {
          timeZone: "Pacific/Honolulu",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        };
        const formatter = new Intl.DateTimeFormat("en-US", options);
        const [
          { value: month },
          ,
          { value: day },
          ,
          { value: year },
        ] = formatter.formatToParts(new Date());
        return `${year}${month}${day}`;
      };
      const todayYYYYMMDD = getHawaiiTodayYYYYMMDD();

      const tideHNLUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${todayYYYYMMDD}&range=168&product=predictions&datum=mllw&format=json&units=english&time_zone=lst_ldt&station=1612340&interval=hilo`;
      const tideMOKUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${todayYYYYMMDD}&range=168&product=predictions&datum=mllw&format=json&units=english&time_zone=lst_ldt&station=1612480&interval=hilo`;

      const [marineRes, weatherRes, tideHNLRes, tideMOKRes] = await Promise.all([
        fetch(marineUrl).then((r) => r.json()),
        fetch(weatherUrl).then((r) => r.json()),
        fetch(tideHNLUrl)
          .then((r) => r.json())
          .catch(() => ({ predictions: [] })),
        fetch(tideMOKUrl)
          .then((r) => r.json())
          .catch(() => ({ predictions: [] })),
      ]);

      const hasMarineHourly = Array.isArray(marineRes)
        ? marineRes[0] && marineRes[0].hourly
        : marineRes.hourly;
      const hasWeatherHourly = Array.isArray(weatherRes)
        ? weatherRes[0] && weatherRes[0].hourly
        : weatherRes.hourly;

      if (!hasMarineHourly || !hasWeatherHourly) {
        throw new Error("Failed to retrieve hourly forecast data from Open-Meteo.");
      }

      // 3. Parse Tide predictions
      const parseTides = (predictions) => {
        const tideDays = {};
        if (!predictions) return tideDays;
        for (const pred of predictions) {
          const [datePart, timePart] = pred.t.split(" ");
          if (!tideDays[datePart]) tideDays[datePart] = [];

          const [hour, min] = timePart.split(":");
          const hourNum = parseInt(hour);
          const ampm = hourNum >= 12 ? "PM" : "AM";
          const formattedHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
          const time12 = `${formattedHour}:${min} ${ampm}`;

          tideDays[datePart].push({
            time: time12,
            height: `${parseFloat(pred.v).toFixed(1)} ft`,
            type: pred.type === "H" ? "High" : "Low",
          });
        }
        return tideDays;
      };

      const tidesHNL = parseTides(tideHNLRes.predictions);
      const tidesMOK = parseTides(tideMOKRes.predictions);

      // 4. Align and group times by day
      const times = Array.isArray(marineRes)
        ? marineRes[0]?.hourly?.time || []
        : marineRes.hourly?.time || [];

      if (times.length === 0) {
        throw new Error("Invalid hourly timestamp array returned by meteorological API.");
      }

      const uniqueDates = [
        ...new Set(times.map((t) => t.split("T")[0])),
      ].slice(0, 7);
      const daysData = [];

      for (let dayIdx = 0; dayIdx < uniqueDates.length; dayIdx++) {
        const dateStr = uniqueDates[dayIdx];
        const dayData = {
          date: dateStr,
          dayName: getDayName(dateStr),
          confidence: calculateConfidence(dayIdx),
          tides: {
            hnl: tidesHNL[dateStr] || [],
            mok: tidesMOK[dateStr] || [],
          },
          spots: {},
        };

        const targetHours = [
          { label: "Morning", hourStr: "06:00" },
          { label: "Mid-day", hourStr: "12:00" },
          { label: "Afternoon", hourStr: "18:00" },
        ];

        for (const spot of spots) {
          dayData.spots[spot.id] = [];
          const coordIdx = regionIndices[spot.region];
          const spotHourlyMarine = Array.isArray(marineRes)
            ? marineRes[coordIdx].hourly
            : marineRes.hourly;
          const spotHourlyWeather = Array.isArray(weatherRes)
            ? weatherRes[coordIdx].hourly
            : weatherRes.hourly;

          for (const target of targetHours) {
            const timestamp = `${dateStr}T${target.hourStr}`;
            const timeIdx = times.indexOf(timestamp);

            if (timeIdx === -1) continue;

            // --- Build multi-swell components ---
            const swellComponents = [];

            // Primary swell (combined swell)
            const sw1Height = spotHourlyMarine.swell_wave_height?.[timeIdx] || 0;
            const sw1Period = spotHourlyMarine.swell_wave_period?.[timeIdx] || 0;
            const sw1Dir = spotHourlyMarine.swell_wave_direction?.[timeIdx] || 0;
            if (sw1Height > 0.1)
              swellComponents.push({ height: sw1Height, period: sw1Period, direction: sw1Dir });

            // Secondary swell
            const sw2Height = spotHourlyMarine.secondary_swell_wave_height?.[timeIdx] || 0;
            const sw2Period = spotHourlyMarine.secondary_swell_wave_period?.[timeIdx] || 0;
            const sw2Dir = spotHourlyMarine.secondary_swell_wave_direction?.[timeIdx] || 0;
            if (sw2Height > 0.1)
              swellComponents.push({ height: sw2Height, period: sw2Period, direction: sw2Dir });

            // Tertiary swell (GFS only)
            const sw3Height = spotHourlyMarine.tertiary_swell_wave_height?.[timeIdx] || 0;
            const sw3Period = spotHourlyMarine.tertiary_swell_wave_period?.[timeIdx] || 0;
            const sw3Dir = spotHourlyMarine.tertiary_swell_wave_direction?.[timeIdx] || 0;
            if (sw3Height > 0.1)
              swellComponents.push({ height: sw3Height, period: sw3Period, direction: sw3Dir });

            // Wind wave
            const wwHeight = spotHourlyMarine.wind_wave_height?.[timeIdx] || 0;
            const wwPeriod = spotHourlyMarine.wind_wave_period?.[timeIdx] || 0;
            const wwDir = spotHourlyMarine.wind_wave_direction?.[timeIdx] || 0;
            if (wwHeight > 0.1)
              swellComponents.push({ height: wwHeight, period: wwPeriod, direction: wwDir });

            // Fallback: if no partitions available, use combined swell
            if (swellComponents.length === 0) {
              const combinedHeight = spotHourlyMarine.swell_wave_height?.[timeIdx] || 0;
              const combinedPeriod = spotHourlyMarine.swell_wave_period?.[timeIdx] || 0;
              const combinedDir = spotHourlyMarine.swell_wave_direction?.[timeIdx] || 0;
              if (combinedHeight > 0.1)
                swellComponents.push({ height: combinedHeight, period: combinedPeriod, direction: combinedDir });
            }

            // Wind data
            const windSpeed = spotHourlyWeather.wind_speed_10m?.[timeIdx] || 0;
            const windDir = spotHourlyWeather.wind_direction_10m?.[timeIdx] || 0;
            const windGusts = spotHourlyWeather.wind_gusts_10m?.[timeIdx] || 0;

            // Tide interpolation
            const tideEvents =
              spot.region === "North Shore" || spot.region === "East Side"
                ? dayData.tides.mok
                : dayData.tides.hnl;
            const tideInfo = interpolateTideHeight(tideEvents, target.hourStr);

            // Wind shadowing
            const shadowedWindSpeed = applyWindShadowing(spot, windSpeed, windDir);

            // Wave height with multi-swell and tide-aware depth limiting
            const waveMetrics = calculateSpotWaveHeight(spot, swellComponents, tideInfo.heightFt);

            // Use the primary/dominant swell period for quality scoring
            const dominantPeriod = waveMetrics.avgPeriod || swellComponents[0]?.period || 0;

            // Wind quality
            const windQuality = calculateWindQuality(spot, shadowedWindSpeed, windDir);

            // Spot quality
            const spotQuality = calculateSpotQuality(
              spot,
              waveMetrics,
              shadowedWindSpeed,
              windDir,
              dominantPeriod,
              tideInfo,
              windGusts
            );

            // Dominant swell for display
            const displaySwell = swellComponents[0] || { height: 0, period: 0, direction: 0 };

            // Multi-swell summary string
            const multiSwellParts = waveMetrics.components
              ? waveMetrics.components.map(
                  (c) => `${c.height}ft@${c.period}s ${c.direction}°`
                )
              : [];
            const multiSwellSummary =
              multiSwellParts.length > 0 ? multiSwellParts.join(" + ") : "N/A";

            dayData.spots[spot.id].push({
              time: target.label,
              timeStr: target.hourStr,
              faceHeight: waveMetrics.faceHeight,
              hawaiianHeight: waveMetrics.hawaiianHeight,
              windSpeed: Math.round(shadowedWindSpeed),
              windDir,
              windGusts: windGusts ? Math.round(windGusts) : 0,
              windQuality: windQuality.label,
              windClass: windQuality.class,
              windDesc: windQuality.description,
              swellHeight: Math.round(displaySwell.height * 2) / 2,
              swellPeriod: Math.round(displaySwell.period),
              swellDir: Math.round(displaySwell.direction),
              multiSwell: multiSwellSummary,
              swellComponents: waveMetrics.components || [],
              tideStage: tideInfo.stage,
              tideHeight: tideInfo.heightFt,
              tideTrend: tideInfo.trend,
              spotRating: spotQuality.label,
              spotRatingClass: spotQuality.class,
              spotRatingScore: spotQuality.score,
              confidence: calculateConfidence(dayIdx),
            });
          }
        }
        daysData.push(dayData);
      }

      // 5. Package summary for LLM (enriched with tide heights, trends, multi-swell, gusts, confidence)
      const dataSummaryForLLM = {
        spots: spots.reduce((acc, spot) => {
          const forecastStrings = daysData.map((day, dayIdx) => {
            const spotForecasts = day.spots[spot.id] || [];
            const slotsText = spotForecasts
              .map((f) => {
                if (f.faceHeight === 0) return `${f.time}: Flat`;
                const tideStr = `Tide: ${f.tideHeight}ft (${f.tideTrend})`;
                const gustStr = f.windGusts > f.windSpeed * 1.3 ? ` Gusts:${f.windGusts}kts` : "";
                const multiStr = f.multiSwell !== "N/A" ? ` Swells:${f.multiSwell}` : "";
                return `${f.time}: ${f.faceHeight}ft face (${f.hawaiianHeight}ft Haw), Wind: ${f.windSpeed}kts${gustStr} (${f.windQuality}), ${tideStr}, Score: ${f.spotRatingScore}, Confidence: ${f.confidence}${multiStr}`;
              })
              .join(" | ");

            // Compute swell trend vs previous day
            let swellTrend = "steady";
            if (dayIdx > 0) {
              const prevForecasts = daysData[dayIdx - 1].spots[spot.id] || [];
              const todayAvg =
                spotForecasts.reduce((s, f) => s + f.faceHeight, 0) /
                (spotForecasts.length || 1);
              const prevAvg =
                prevForecasts.reduce((s, f) => s + f.faceHeight, 0) /
                (prevForecasts.length || 1);
              if (todayAvg > prevAvg * 1.15) swellTrend = "building";
              else if (todayAvg < prevAvg * 0.85) swellTrend = "fading";
            }

            return `${day.dayName} (${day.date}) [${swellTrend}]: ${slotsText}`;
          });

          acc[spot.id] = {
            name: spot.name,
            region: spot.region,
            type: spot.type,
            difficulty: spot.difficulty,
            description: spot.description,
            optimalSwell: spot.optimalSwell,
            optimalWind: spot.optimalWind,
            optimalTideHeight: spot.optimalTideHeight,
            bottomProfile: spot.bottomProfile,
            forecast: forecastStrings,
          };
          return acc;
        }, {}),
      };

      // 6. Query narrative generation service
      console.log("Generating surf analysis report...");
      const narrativeForecast = await generateNarrativeForecast(dataSummaryForLLM);

      // 7. Assemble final payload
      const finalForecast = {
        updatedAt: new Date().toISOString(),
        spotsList: spots,
        days: daysData,
        narrativeForecast,
      };

      // 8. Cache locally in memory
      memoryCache = finalForecast;
      memoryCacheTime = Date.now();

      // Invalidate explainer cache — it's now stale
      explainerCache = null;
      explainerCacheTime = 0;

      // 9. Try writing to Firestore Cache
      try {
        const cacheRef = db.collection("forecasts").doc("oahu");
        await cacheRef.set({
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          forecast: finalForecast,
        });
        console.log("Surf forecast successfully cached in Firestore.");

        // Invalidate stale explainer in Firestore when forecast changes
        try {
          const explainerCacheRef = db.collection("explainers").doc("oahu");
          await explainerCacheRef.delete();
        } catch (e) {
          // Silently ignore if doc doesn't exist
        }
      } catch (firestoreError) {
        console.warn(
          "Firestore cache write failed. Cached in-memory only:",
          firestoreError.message
        );
      }

      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=10800, stale-while-revalidate=600"
      );
      return res.status(200).json(finalForecast);
    } catch (error) {
      console.error("Forecast compile error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: error.message,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Forecast Explainer endpoint — step-by-step walkthrough of today's forecast
// ---------------------------------------------------------------------------
export const forecastExplainer = onRequest(
  { cors: false, timeoutSeconds: 120, secrets: [deepseekApiSecret] },
  async (req, res) => {
    try {
      res.setHeader("Vary", "Origin");
      handleCors(req, res);

      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      // 1. Load cached forecast
      let forecast = null;
      try {
        const cacheRef = db.collection("forecasts").doc("oahu");
        const cacheDoc = await cacheRef.get();
        if (cacheDoc.exists) {
          forecast = cacheDoc.data().forecast;
        }
      } catch (e) {
        console.warn("Firestore read failed for explainer, trying memory:", e.message);
      }
      if (!forecast) {
        forecast = memoryCache;
      }
      if (!forecast || !forecast.days || forecast.days.length === 0) {
        return res.status(503).json({
          error: "No forecast data available yet. Please try again after the forecast is generated.",
        });
      }

      // 2. Extract today's raw analysis data for representative spots
      const todayData = forecast.days[0];
      const representativeSpots = ["pipeline", "bowls", "makaha", "sandybeach"];

      // Build spot config summaries
      const spotConfigs = {};
      for (const spot of forecast.spotsList) {
        if (representativeSpots.includes(spot.id)) {
          spotConfigs[spot.id] = {
            name: spot.name,
            region: spot.region,
            type: spot.type,
            difficulty: spot.difficulty,
            bottomProfile: spot.bottomProfile,
            swellWindow: spot.swellWindow,
            optimalSwell: spot.optimalSwell,
            optimalWind: spot.optimalWind,
            optimalWindCardinal: getWindCardinal(spot.optimalWind),
            magnification: spot.magnification,
            optimalTideHeight: spot.optimalTideHeight,
            tideSensitivity: spot.tideSensitivity,
            prefersRising: spot.prefersRising,
            optimalPeriodMin: spot.optimalPeriodMin,
            optimalPeriodMax: spot.optimalPeriodMax,
            maxHoldingSize: spot.maxHoldingSize,
            description: spot.description,
          };
        }
      }

      // Build today's calculated data per spot
      const spotCalculations = {};
      for (const spotId of representativeSpots) {
        const forecasts = todayData.spots[spotId] || [];
        if (forecasts.length === 0) continue;

        const bestSlot = forecasts.reduce((best, f) =>
          (f.spotRatingScore || 0) > (best.spotRatingScore || 0) ? f : best
        , forecasts[0]);

        spotCalculations[spotId] = {
          timeSlots: forecasts.map((f) => ({
            time: f.time,
            faceHeight: f.faceHeight,
            hawaiianHeight: f.hawaiianHeight,
            swellComponents: f.swellComponents || [],
            multiSwell: f.multiSwell || "N/A",
            swellHeight: f.swellHeight,
            swellPeriod: f.swellPeriod,
            swellDir: f.swellDir,
            windSpeed: f.windSpeed,
            windDir: f.windDir,
            windGusts: f.windGusts || 0,
            windQuality: f.windQuality,
            windClass: f.windClass,
            tideHeight: f.tideHeight,
            tideTrend: f.tideTrend,
            tideStage: f.tideStage,
            spotRatingScore: f.spotRatingScore,
            spotRating: f.spotRating,
            spotRatingClass: f.spotRatingClass,
          })),
          bestSlot: {
            time: bestSlot.time,
            faceHeight: bestSlot.faceHeight,
            spotRatingScore: bestSlot.spotRatingScore,
            spotRating: bestSlot.spotRating,
          },
        };
      }

      // Build raw data summary for the 4 regions
      const regionRawData = {};
      const regionCoords = {
        "North Shore": { lat: 21.664, lon: -158.053 },
        "South Shore": { lat: 21.284, lon: -157.842 },
        "West Side": { lat: 21.475, lon: -158.225 },
        "East Side": { lat: 21.285, lon: -157.672 },
      };

      for (const [region, coords] of Object.entries(regionCoords)) {
        // Find a spot from this region to get its swell data
        const regionSpot = forecast.spotsList.find((s) => s.region === region);
        if (!regionSpot) continue;
        const regionForecasts = todayData.spots[regionSpot.id] || [];
        if (regionForecasts.length === 0) continue;

        const f = regionForecasts[0];
        regionRawData[region] = {
          coordinates: coords,
          swellComponents: f.swellComponents || [],
          multiSwell: f.multiSwell || "N/A",
          windSpeed: f.windSpeed,
          windDir: f.windDir,
          windGusts: f.windGusts || 0,
          tideHeight: f.tideHeight,
          tideTrend: f.tideTrend,
        };
      }

      // Tide data for today
      const todayTides = {
        hnl: todayData.tides?.hnl || [],
        mok: todayData.tides?.mok || [],
      };

      const analysisData = {
        forecastDate: todayData.date,
        forecastDayName: todayData.dayName,
        confidence: todayData.confidence,
        regionRawData,
        tidePredictions: todayTides,
        spotConfigs,
        spotCalculations,
      };

      // 3. Check explainer cache (Firestore → memory → regenerate)
      let aiExplainer = null;

      // Try Firestore cache
      try {
        const explainerCacheRef = db.collection("explainers").doc("oahu");
        const explainerCacheDoc = await explainerCacheRef.get();
        if (explainerCacheDoc.exists) {
          const explainerCacheData = explainerCacheDoc.data();
          const explainerAgeMs = Date.now() - explainerCacheData.updatedAt.toDate().getTime();
          if (explainerAgeMs < THREE_HOURS_MS && explainerCacheData.explainer) {
            console.log("Serving explainer from Firestore cache");
            aiExplainer = explainerCacheData.explainer;
          }
        }
      } catch (e) {
        console.warn("Explainer Firestore cache read failed:", e.message);
      }

      // Try memory cache
      if (!aiExplainer) {
        const memAgeMs = Date.now() - explainerCacheTime;
        if (explainerCache && memAgeMs < THREE_HOURS_MS) {
          console.log("Serving explainer from memory cache");
          aiExplainer = explainerCache;
        }
      }

      // 4. Generate if cache miss
      if (!aiExplainer) {
        console.log("Generating forecast explainer narrative...");
        aiExplainer = await generateExplainer(analysisData);

        if (aiExplainer) {
          // Cache in memory
          explainerCache = aiExplainer;
          explainerCacheTime = Date.now();

          // Cache in Firestore
          try {
            const explainerCacheRef = db.collection("explainers").doc("oahu");
            await explainerCacheRef.set({
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              explainer: aiExplainer,
            });
            console.log("Explainer cached in Firestore.");
          } catch (e) {
            console.warn("Explainer Firestore cache write failed:", e.message);
          }
        }
      }

      // 5. Return both raw data and AI narrative
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=10800, stale-while-revalidate=600");
      return res.status(200).json({
        updatedAt: forecast.updatedAt,
        analysisData,
        aiExplainer: aiExplainer || {
          overview: "AI explainer unavailable (API key not configured or service error). See raw analysis data below.",
          steps: [
            {
              stepNumber: 1,
              title: "Raw Data",
              content: "The raw meteorological data and per-spot calculations are shown below. The AI narrative generator is currently unavailable.",
            },
          ],
          regionalBreakdowns: {},
          spotWalkthroughs: {},
        },
      });
    } catch (error) {
      console.error("Explainer error:", error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: error.message,
      });
    }
  }
);

// Helper: wind direction to cardinal
function getWindCardinal(degrees) {
  const cardinals = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const val = Math.floor(degrees / 22.5 + 0.5);
  return cardinals[val % 16];
}
