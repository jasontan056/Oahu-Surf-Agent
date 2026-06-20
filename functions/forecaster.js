// Helper to check if an angle is between min and max, handling 360-degree wrap-around
export function isAngleBetween(angle, min, max) {
  if (min <= max) {
    return angle >= min && angle <= max;
  } else {
    // Crosses the 360/0 degree mark (e.g. min: 290, max: 45)
    return angle >= min || angle <= max;
  }
}

// Calculate the breaking wave height (face and Hawaiian scale) for a spot
export function calculateSpotWaveHeight(spot, deepwaterHeight, period, direction) {
  // 1. Swell window check
  if (!isAngleBetween(direction, spot.swellWindow.min, spot.swellWindow.max)) {
    return { faceHeight: 0, hawaiianHeight: 0, alignment: 0 };
  }

  // 2. Swell alignment factor (cosine decay)
  let diff = Math.abs(direction - spot.optimalSwell);
  if (diff > 180) diff = 360 - diff;
  
  // Alignment is 1.0 when perfectly aligned, decaying to 0.0 at 90 degrees off
  const alignment = Math.max(0, Math.cos(diff * Math.PI / 180));

  // 3. Shoaling factor based on period (T / 10)^1.2
  // Long period waves carry exponentially more energy and shoal more.
  const shoaling = Math.pow(period / 10, 1.2);

  // 4. Calculate breaking height face
  const calculatedFace = deepwaterHeight * alignment * shoaling * spot.magnification;

  // Round to nearest 0.5 feet
  const faceHeight = Math.round(calculatedFace * 2) / 2;
  const hawaiianHeight = Math.round(calculatedFace * 0.5 * 2) / 2;

  return {
    faceHeight,
    hawaiianHeight,
    alignment: Math.round(alignment * 100) / 100
  };
}

// Determine wind quality based on wind speed (knots) and wind direction
export function calculateWindQuality(spot, windSpeedKnots, windDir) {
  // If wind is super light, it is glassy regardless of direction
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

// Apply wind shadowing based on local terrain features of Oahu
export function applyWindShadowing(spot, windSpeedKnots, windDir) {
  // Trade winds are typically NE to ESE (45 to 115 degrees)
  const isTradeWind = windDir >= 45 && windDir <= 115;

  if (spot.region === "West Side" && isTradeWind) {
    // West Side is sheltered by the massive Waianae mountain range during trades
    // Reduce wind speed by 60%
    return Math.round(windSpeedKnots * 0.4);
  }

  if (spot.region === "South Shore" && windDir >= 30 && windDir <= 60) {
    // Certain parts of the South Shore (e.g. Bowls) are sheltered from NNE trade winds
    // Reduce wind speed by 30%
    return Math.round(windSpeedKnots * 0.7);
  }

  return windSpeedKnots;
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

// Estimate tide stage ("low", "medium", "high") based on closest high/low predictions
export function determineTideStage(tideEvents, targetHourStr) {
  if (!tideEvents || tideEvents.length === 0) {
    return "medium"; // default fallback
  }

  // targetHourStr is e.g. "06:00"
  const targetHour = parseFloat(targetHourStr.split(":")[0]);
  
  let closestEvent = null;
  let minDiff = Infinity;
  
  for (const event of tideEvents) {
    const eventHour = parseTimeToDecimalHour(event.time);
    const diff = Math.abs(eventHour - targetHour);
    if (diff < minDiff) {
      minDiff = diff;
      closestEvent = event;
    }
  }
  
  // If the closest event is within 2.5 hours, classify the tide as its type (low/high)
  // Otherwise, classify it as "medium" (transitioning)
  if (minDiff <= 2.5) {
    return closestEvent.type.toLowerCase();
  } else {
    return "medium";
  }
}

// Calculate an overall quality rating from 0 to 100 and return a categorical rating
export function calculateSpotQuality(spot, waveMetrics, windSpeed, windDir, period, tideStage) {
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
    sizeScore = 35; // Perfect range
  } else if (height < optMin) {
    sizeScore = 35 * (height / optMin); // Decays linearly to 0
  } else {
    // Too big
    if (spot.difficulty === "Beginner" || spot.difficulty === "Intermediate") {
      // Small/moderate spots close out and become dangerous quickly when oversized
      sizeScore = Math.max(5, 35 - (height - optMax) * 6);
    } else {
      // Advanced/Expert breaks can hold large swells
      const limit = spot.difficulty === "Expert" ? 30 : 18;
      if (height > limit) {
        sizeScore = Math.max(10, 35 - (height - optMax) * 1.5);
      } else {
        sizeScore = 35; // Perfectly within holding capacity
      }
    }
  }

  // 2. Wind Score (up to 30 points)
  const windQual = calculateWindQuality(spot, windSpeed, windDir);
  let windScore = 0;
  switch (windQual.class) {
    case "glassy":
      windScore = 30;
      break;
    case "clean":
      windScore = 30;
      break;
    case "fair":
      windScore = 15;
      break;
    case "choppy":
      windScore = 5;
      break;
    case "blown-out":
      windScore = 0;
      break;
    default:
      windScore = 5;
  }

  // 3. Period Score (up to 15 points)
  let periodScore = 0;
  if (period >= 14) periodScore = 15;
  else if (period >= 11) periodScore = 12;
  else if (period >= 8) periodScore = 7;
  else periodScore = 2;

  // 4. Alignment Score (up to 10 points)
  const alignScore = waveMetrics.alignment * 10;

  // 5. Tide Match Score (up to 10 points)
  let tideScore = 10;
  const optimalTide = spot.optimalTide || "any";
  const sensitivity = spot.tideSensitivity || 0.5;

  if (optimalTide !== "any" && optimalTide !== "all") {
    if (tideStage === optimalTide) {
      tideScore = 10;
    } else if (tideStage === "medium") {
      tideScore = 7; // transitioning is okay but not optimal
    } else {
      // Opposite tide stage
      tideScore = Math.max(0, 10 - (sensitivity * 8));
    }
  }

  let finalScore = Math.round(sizeScore + windScore + periodScore + alignScore + tideScore);

  // Apply realistic quality caps based on unfavorable wind or wave size
  if (windQual.class === "blown-out") {
    finalScore = Math.min(finalScore, 34); // Capped at Poor
  } else if (windQual.class === "choppy") {
    finalScore = Math.min(finalScore, 54); // Capped at Poor to Fair
  }

  if (height < 1.5) {
    if (spot.difficulty === "Advanced" || spot.difficulty === "Expert") {
      finalScore = Math.min(finalScore, 14); // Capped at Very Poor
    } else {
      finalScore = Math.min(finalScore, 34); // Capped at Poor
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
