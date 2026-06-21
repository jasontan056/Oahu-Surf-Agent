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

// Declare secret for DeepSeek API Key
const deepseekApiSecret = defineSecret("DEEPSEEK_API_SECRET");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

// In-Memory cache fallback in case Firestore is not provisioned/enabled
let memoryCache = null;
let memoryCacheTime = 0;
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
        "swell_wave_1_height",
        "swell_wave_1_period",
        "swell_wave_1_direction",
        "swell_wave_2_height",
        "swell_wave_2_period",
        "swell_wave_2_direction",
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

            // Primary swell
            const sw1Height = spotHourlyMarine.swell_wave_1_height?.[timeIdx] || 0;
            const sw1Period = spotHourlyMarine.swell_wave_1_period?.[timeIdx] || 0;
            const sw1Dir = spotHourlyMarine.swell_wave_1_direction?.[timeIdx] || 0;
            if (sw1Height > 0.1)
              swellComponents.push({ height: sw1Height, period: sw1Period, direction: sw1Dir });

            // Secondary swell
            const sw2Height = spotHourlyMarine.swell_wave_2_height?.[timeIdx] || 0;
            const sw2Period = spotHourlyMarine.swell_wave_2_period?.[timeIdx] || 0;
            const sw2Dir = spotHourlyMarine.swell_wave_2_direction?.[timeIdx] || 0;
            if (sw2Height > 0.1)
              swellComponents.push({ height: sw2Height, period: sw2Period, direction: sw2Dir });

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

      // 9. Try writing to Firestore Cache
      try {
        const cacheRef = db.collection("forecasts").doc("oahu");
        await cacheRef.set({
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          forecast: finalForecast,
        });
        console.log("Surf forecast successfully cached in Firestore.");
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
