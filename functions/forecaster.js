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
