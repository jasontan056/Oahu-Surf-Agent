// Helper to check if an angle is between min and max, handling 360-degree wrap-around
export function isAngleBetween(angle, min, max) {
  if (min <= max) {
    return angle >= min && angle <= max;
  } else {
    // Crosses the 360/0 degree mark (e.g. min: 290, max: 45)
    return angle >= min || angle <= max;
  }
}

// Helper to convert "06:30 AM" or "12:45 PM" to decimal hours (0 - 24)
function parseTimeToDecimalHour(time12) {
  const match = time12.match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return 0;
  let hour = parseInt(match[1]);
  const min = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  
  return hour + (min / 60);
}

// ---------------------------------------------------------------------------
// Bathymetry-aware shoaling coefficient
// ---------------------------------------------------------------------------
function getBathymetricShoaling(bottomProfile, period) {
  const base = period / 10;
  switch (bottomProfile) {
    case "steep-reef":
      // Waves jack up suddenly on steep ledges (e.g. Pipeline, Bowls)
      return Math.pow(base, 2.0);
    case "reef-pass":
      // Focused energy in reef channels (e.g. Haleiwa, Makaha)
      return Math.pow(base, 1.7);
    case "gradual-reef":
      // Moderate shoaling on sloping reefs (e.g. Sunset, Laniakea)
      return Math.pow(base, 1.3);
    case "sandbar":
      // Lowest amplification, waves break early on sand
      return Math.pow(base, 1.0);
    default:
      return Math.pow(base, 1.2);
  }
}

// ---------------------------------------------------------------------------
// Soft refraction falloff at swell window edges (15° cosine-squared taper)
// ---------------------------------------------------------------------------
function getRefractionFactor(spot, swellDir) {
  const win = spot.swellWindow;
  
  // If inside the window, full transmission with slight edge decay
  if (isAngleBetween(swellDir, win.min, win.max)) {
    // Calculate distance from each boundary within the window
    let distFromMin, distFromMax;
    
    if (win.min <= win.max) {
      distFromMin = swellDir - win.min;
      distFromMax = win.max - swellDir;
    } else {
      // Crosses 0/360
      if (swellDir >= win.min) {
        distFromMin = swellDir - win.min;
        distFromMax = (win.max + 360) - swellDir;
      } else {
        distFromMin = (swellDir + 360) - win.min;
        distFromMax = win.max - swellDir;
      }
    }
    
    const minDist = Math.min(distFromMin, distFromMax);
    const taperZone = 15; // degrees of taper zone
    
    if (minDist >= taperZone) return 1.0;
    // Cosine-squared taper inside the window near edges
    return Math.cos(((taperZone - minDist) / taperZone) * Math.PI / 2) ** 2;
  }
  
  // Outside the window: compute distance to nearest boundary
  let distToWindow;
  
  if (win.min <= win.max) {
    if (swellDir < win.min) {
      distToWindow = win.min - swellDir;
    } else {
      distToWindow = swellDir - win.max;
    }
  } else {
    // Window crosses 0/360
    if (swellDir >= win.min) {
      distToWindow = 0; // inside
    } else if (swellDir <= win.max) {
      distToWindow = 0; // inside
    } else {
      // Outside in the gap between max and min
      distToWindow = Math.min(
        Math.abs(swellDir - win.max),
        Math.abs(swellDir - win.min),
        Math.abs((swellDir + 360) - win.min)
      );
    }
  }
  
  const taperZone = 15;
  if (distToWindow > taperZone) return 0;
  // Cosine-squared taper into the window from outside
  const factor = Math.cos((distToWindow / taperZone) * Math.PI / 2) ** 2;
  return Math.max(0, factor * 0.5); // Max 50% outside the window
}

// ---------------------------------------------------------------------------
// Island shadowing (Molokai/Lanai block certain swell directions)
// ---------------------------------------------------------------------------
export function applyIslandShadowing(spot, swellDir, swellHeight) {
  // Molokai/Lanai/Kahoolawe shadowing for South Shore
  if (spot.region === "South Shore") {
    // Swells from ~100°-145° get partially blocked by Molokai/Lanai
    if (swellDir >= 100 && swellDir <= 145) {
      // Max attenuation at 120-130° (directly behind Molokai)
      const centerAngle = 125;
      const halfWidth = 25; // 100-150 degree range
      const distFromCenter = Math.abs(swellDir - centerAngle);
      if (distFromCenter <= halfWidth) {
        const maxAttenuation = 0.65; // 65% reduction at worst
        const attenuation = maxAttenuation * Math.cos((distFromCenter / halfWidth) * Math.PI / 2);
        return swellHeight * (1 - attenuation);
      }
    }
  }

  // Kaena Point / southern shadow for West Side
  if (spot.region === "West Side") {
    if (swellDir >= 140 && swellDir <= 190) {
      const centerAngle = 165;
      const halfWidth = 25;
      const distFromCenter = Math.abs(swellDir - centerAngle);
      if (distFromCenter <= halfWidth) {
        const attenuation = 0.3 * Math.cos((distFromCenter / halfWidth) * Math.PI / 2);
        return swellHeight * (1 - attenuation);
      }
    }
  }

  return swellHeight;
}

// ---------------------------------------------------------------------------
// Multi-swell wave height calculation
// ---------------------------------------------------------------------------
export function calculateSpotWaveHeight(spot, swellComponents, tideHeight) {
  // swellComponents: array of { height, period, direction }
  // tideHeight: actual tide height in feet for depth-limited breaking cap

  if (!swellComponents || swellComponents.length === 0) {
    return { faceHeight: 0, hawaiianHeight: 0, alignment: 0, avgPeriod: 0, components: [] };
  }

  let totalFaceHeightSq = 0; // sum of squares for energy-based superposition
  let totalEnergyWeight = 0;
  let weightedPeriodSum = 0;
  let bestAlignment = 0;
  const componentDetails = [];

  for (const swell of swellComponents) {
    if (!swell.height || swell.height <= 0.1) continue;
    if (!swell.period || swell.period <= 0) continue;

    // 1. Refraction / window edge taper
    const refractionFactor = getRefractionFactor(spot, swell.direction);
    if (refractionFactor <= 0.02) continue;

    // 2. Island shadowing
    const shadowedHeight = applyIslandShadowing(spot, swell.direction, swell.height);

    // 3. Alignment cosine decay
    let diff = Math.abs(swell.direction - spot.optimalSwell);
    if (diff > 180) diff = 360 - diff;
    const alignment = Math.max(0, Math.cos(diff * Math.PI / 180));

    // 4. Bathymetry-aware shoaling
    const shoaling = getBathymetricShoaling(spot.bottomProfile || "gradual-reef", swell.period);

    // 5. Calculate contribution
    const contribution = shadowedHeight * alignment * refractionFactor * shoaling * spot.magnification;
    totalFaceHeightSq += contribution * contribution;

    // Energy-weighted period for combined period estimate
    const energy = swell.height * swell.height * swell.period;
    weightedPeriodSum += swell.period * energy;
    totalEnergyWeight += energy;
    bestAlignment = Math.max(bestAlignment, alignment);

    componentDetails.push({
      height: Math.round(shadowedHeight * 10) / 10,
      period: Math.round(swell.period),
      direction: Math.round(swell.direction),
      contribution: Math.round(contribution * 10) / 10
    });
  }

  // Energy-based superposition: sqrt(sum of squares)
  let faceHeight = Math.sqrt(totalFaceHeightSq);

  // Depth-limited breaking cap — only applies to sandbar shorebreaks where the
  // wave genuinely runs out of water at low tide.  Reef breaks sit several feet
  // below MLLW so swell energy, not water depth, is the limiting factor — the
  // bathymetric shoaling coefficient already captures bottom-profile amplification.
  if (tideHeight !== undefined && tideHeight !== null && spot.bottomProfile === "sandbar") {
    // Sandbars have roughly 2 ft of permanent depth at MLLW, so actual water
    // depth ≈ tideHeight + 2.0 ft.  Waves break when H ≈ 1.3 × depth.
    const depthLimit = Math.max(1.0, (tideHeight + 2.0) * 1.3);
    faceHeight = Math.min(faceHeight, depthLimit);
  }

  const avgPeriod = totalEnergyWeight > 0 ? weightedPeriodSum / totalEnergyWeight : 0;

  return {
    faceHeight: Math.round(faceHeight * 2) / 2,
    hawaiianHeight: Math.round(faceHeight * 0.5 * 2) / 2,
    alignment: Math.round(bestAlignment * 100) / 100,
    avgPeriod: Math.round(avgPeriod),
    components: componentDetails
  };
}

// ---------------------------------------------------------------------------
// Wind quality determination
// ---------------------------------------------------------------------------
export function calculateWindQuality(spot, windSpeedKnots, windDir) {
  if (windSpeedKnots < 5) {
    return {
      label: "Glassy",
      class: "glassy",
      description: "Light and glassy wind conditions."
    };
  }

  let diff = Math.abs(windDir - spot.optimalWind);
  if (diff > 180) diff = 360 - diff;

  if (diff <= 45) {
    return {
      label: "Clean (Offshore)",
      class: "clean",
      description: "Clean conditions with offshore winds grooming the wave faces."
    };
  } else if (diff <= 90) {
    return {
      label: "Fair (Sideshore)",
      class: "fair",
      description: "Sideshore wind creating texture on the water."
    };
  } else {
    if (windSpeedKnots >= 15) {
      return {
        label: "Blown Out",
        class: "blown-out",
        description: "Strong onshore winds destroying the wave shape."
      };
    } else {
      return {
        label: "Choppy (Onshore)",
        class: "choppy",
        description: "Onshore wind creating bumpy and crumbly conditions."
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Wind shadowing based on local terrain features of Oahu
// ---------------------------------------------------------------------------
export function applyWindShadowing(spot, windSpeedKnots, windDir) {
  const isTradeWind = windDir >= 45 && windDir <= 115;

  if (spot.region === "West Side" && isTradeWind) {
    return Math.round(windSpeedKnots * 0.4);
  }

  if (spot.region === "South Shore" && windDir >= 30 && windDir <= 60) {
    return Math.round(windSpeedKnots * 0.7);
  }

  return windSpeedKnots;
}

// ---------------------------------------------------------------------------
// Tide height interpolation from NOAA high/low predictions
// ---------------------------------------------------------------------------
export function interpolateTideHeight(tideEvents, targetHourStr) {
  if (!tideEvents || tideEvents.length === 0) {
    return { heightFt: 1.0, trend: "steady", stage: "medium" };
  }

  const targetHour = parseFloat(targetHourStr.split(":")[0]);

  // Parse all events with their decimal hours and heights
  const parsed = tideEvents.map(e => ({
    hour: parseTimeToDecimalHour(e.time),
    height: parseFloat(e.height),
    type: e.type
  })).sort((a, b) => a.hour - b.hour);

  // Find events that bracket the target hour
  let before = null;
  let after = null;
  for (const evt of parsed) {
    if (evt.hour <= targetHour) {
      if (!before || evt.hour > before.hour) before = evt;
    }
    if (evt.hour >= targetHour) {
      if (!after || evt.hour < after.hour) after = evt;
    }
  }

  // Interpolate height
  let interpolatedHeight;
  if (before && after && before.hour !== after.hour) {
    const fraction = (targetHour - before.hour) / (after.hour - before.hour);
    interpolatedHeight = before.height + fraction * (after.height - before.height);
  } else if (before && after && before.hour === after.hour) {
    interpolatedHeight = before.height;
  } else if (before) {
    interpolatedHeight = before.height;
  } else if (after) {
    interpolatedHeight = after.height;
  } else {
    interpolatedHeight = 1.0;
  }

  // Determine trend
  let trend = "steady";
  if (before && after && before !== after) {
    if (after.height > before.height) trend = "rising";
    else if (after.height < before.height) trend = "falling";
  } else if (before && before.type === "Low") {
    trend = "rising";
  } else if (before && before.type === "High") {
    trend = "falling";
  }

  // Determine stage
  let stage = "medium";
  const closest = parsed.reduce((prev, curr) => 
    Math.abs(curr.hour - targetHour) < Math.abs(prev.hour - targetHour) ? curr : prev
  );
  const distToClosest = Math.abs(closest.hour - targetHour);
  
  if (distToClosest <= 2.5) {
    stage = closest.type.toLowerCase();
  }

  return {
    heightFt: Math.round(interpolatedHeight * 10) / 10,
    trend,
    stage
  };
}

// ---------------------------------------------------------------------------
// Forecast confidence based on day index (0-6 = today through day 6)
// ---------------------------------------------------------------------------
export function calculateConfidence(dayIndex) {
  if (dayIndex <= 1) return "High";
  if (dayIndex <= 3) return "Moderate";
  return "Low";
}

// ---------------------------------------------------------------------------
// Overall spot quality rating (0-100) with enhanced scoring
// ---------------------------------------------------------------------------
export function calculateSpotQuality(spot, waveMetrics, windSpeed, windDir, period, tideInfo, windGustKnots) {
  const height = waveMetrics.faceHeight;

  // If flat, quality is automatically Flat / 0
  if (height === 0) {
    return {
      score: 0,
      label: "Flat",
      class: "rating-flat"
    };
  }

  // 1. Wave Size Score (up to 35 points)
  let sizeScore = 0;
  let optMin = 2, optMax = 4;

  if (spot.difficulty === "Intermediate") { optMin = 3; optMax = 6; }
  else if (spot.difficulty === "Advanced") { optMin = 4; optMax = 10; }
  else if (spot.difficulty === "Expert") { optMin = 6; optMax = 20; }

  if (height >= optMin && height <= optMax) {
    sizeScore = 35;
  } else if (height < optMin) {
    sizeScore = 35 * (height / optMin);
  } else {
    if (spot.difficulty === "Beginner" || spot.difficulty === "Intermediate") {
      sizeScore = Math.max(5, 35 - (height - optMax) * 6);
    } else {
      const limit = spot.maxHoldingSize || (spot.difficulty === "Expert" ? 30 : 18);
      if (height > limit) {
        sizeScore = Math.max(10, 35 - (height - optMax) * 1.5);
      } else {
        sizeScore = 35;
      }
    }
  }

  // 2. Wind Score (up to 30 points) with gust penalty
  const windQual = calculateWindQuality(spot, windSpeed, windDir);
  let windScore = 0;
  switch (windQual.class) {
    case "glassy": windScore = 30; break;
    case "clean": windScore = 30; break;
    case "fair": windScore = 15; break;
    case "choppy": windScore = 5; break;
    case "blown-out": windScore = 0; break;
    default: windScore = 5;
  }

  // Gust penalty: strong gusts reduce the effective wind score
  if (windGustKnots && windGustKnots > windSpeed * 1.5 && windGustKnots > 15) {
    const gustPenalty = Math.min(5, (windGustKnots - windSpeed) * 0.3);
    windScore = Math.max(0, windScore - gustPenalty);
  }

  // 3. Period Score (up to 15 points) — bell-curve around spot's optimal range
  let periodScore = 0;
  const periodMin = spot.optimalPeriodMin || 7;
  const periodMax = spot.optimalPeriodMax || 18;
  const periodMid = (periodMin + periodMax) / 2;
  const periodHalfRange = (periodMax - periodMin) / 2;

  if (periodHalfRange > 0) {
    periodScore = Math.round(15 * Math.exp(-0.5 * Math.pow((period - periodMid) / periodHalfRange, 2)));
  } else {
    // Fallback to staircase
    if (period >= 14) periodScore = 15;
    else if (period >= 11) periodScore = 12;
    else if (period >= 8) periodScore = 7;
    else periodScore = 2;
  }

  // 4. Alignment Score (up to 10 points)
  const alignScore = Math.round(waveMetrics.alignment * 10);

  // 5. Tide Score (up to 10 points) — bell-curve around spot's optimal tide height
  let tideScore = 10;
  const optimalTideHeight = spot.optimalTideHeight;
  const tideHeight = tideInfo ? tideInfo.heightFt : null;

  if (optimalTideHeight !== undefined && optimalTideHeight !== null && tideHeight !== null && tideHeight !== undefined) {
    // For spots with low tide sensitivity (any tide works), give full score
    if (spot.tideSensitivity < 0.25) {
      tideScore = 10;
    } else {
      const diff = Math.abs(tideHeight - optimalTideHeight);
      const sigma = spot.tideSensitivity * 2.5 || 1.5;
      tideScore = Math.round(10 * Math.exp(-0.5 * Math.pow(diff / sigma, 2)));
    }

    // Trend bonus/penalty
    if (tideInfo.trend && spot.prefersRising !== undefined) {
      if (spot.prefersRising && tideInfo.trend === "rising") tideScore = Math.min(10, tideScore + 1);
      else if (spot.prefersRising && tideInfo.trend === "falling") tideScore = Math.max(0, tideScore - 1);
      else if (!spot.prefersRising && tideInfo.trend === "falling") tideScore = Math.min(10, tideScore + 1);
    }
  } else if (spot.optimalTide && spot.optimalTide !== "any" && spot.optimalTide !== "all") {
    // Fallback to old binary matching
    const tideStage = tideInfo ? tideInfo.stage : "medium";
    if (tideStage === spot.optimalTide) tideScore = 10;
    else if (tideStage === "medium") tideScore = 7;
    else tideScore = Math.max(0, 10 - (spot.tideSensitivity * 8));
  }

  let finalScore = Math.round(sizeScore + windScore + periodScore + alignScore + tideScore);

  // Apply realistic quality caps based on unfavorable wind or wave size
  if (windQual.class === "blown-out") {
    finalScore = Math.min(finalScore, 34);
  } else if (windQual.class === "choppy") {
    finalScore = Math.min(finalScore, 54);
  }

  if (height < 1.5) {
    if (spot.difficulty === "Advanced" || spot.difficulty === "Expert") {
      finalScore = Math.min(finalScore, 14);
    } else {
      finalScore = Math.min(finalScore, 34);
    }
  }

  // Map score to label & CSS class
  let label = "Poor";
  let ratingClass = "rating-poor";

  if (finalScore < 15) {
    label = "Very Poor";
    ratingClass = "rating-very-poor";
  } else if (finalScore < 35) {
    label = "Poor";
    ratingClass = "rating-poor";
  } else if (finalScore < 50) {
    label = "Poor to Fair";
    ratingClass = "rating-poor-to-fair";
  } else if (finalScore < 70) {
    label = "Fair";
    ratingClass = "rating-fair";
  } else if (finalScore < 85) {
    label = "Fair to Good";
    ratingClass = "rating-fair-to-good";
  } else if (finalScore < 95) {
    label = "Good";
    ratingClass = "rating-good";
  } else {
    label = "Epic";
    ratingClass = "rating-epic";
  }

  return {
    score: finalScore,
    label,
    class: ratingClass
  };
}
