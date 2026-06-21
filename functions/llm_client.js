// Narrative generation service client for generating surf forecast texts
export async function generateNarrativeForecast(dataSummary) {
  const apiKey = process.env.DEEPSEEK_API_SECRET || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("API key is not defined. Skipping narrative forecast generation.");
    return {
      outlook: "Forecast narrative key not configured. Showing raw mathematical calculations only.",
      regions: {
        "North Shore": "N/A",
        "South Shore": "N/A",
        "West Side": "N/A",
        "East Side": "N/A",
      },
      spots: {},
    };
  }

  const systemPrompt = `You are an expert surf forecaster for the island of Oahu, Hawaii, with deep local knowledge of every break. You output responses in valid JSON.`;

  const localKnowledge = `
LOCAL KNOWLEDGE — OAHU SPOT REFERENCE:
- Pipeline / Backdoor (North Shore): Steep-reef, barreling left (Pipeline) + fast right (Backdoor). Works on NW swells 290-45° with SE offshore winds. Loves mid-tide ~1.0ft for perfect barrel shape. Closes out above 12ft face. Rising tide is best.
- Waimea Bay (North Shore): Gradual-reef big-wave arena. Needs massive NW swells 300-360° with SE offshore. Breaks best on medium tide ~0.5ft. Handles 20-50ft faces.
- Sunset Beach (North Shore): Gradual-reef, wide shifty right-hander. Handles NW swell 300-45° with SSE offshore. Holds 15-30ft. Medium tide ~1.0ft optimal.
- Haleiwa / Ali'i Beach (North Shore): Reef-pass right-hander. Best on NW swells 280-350° with ESE offshore. Very tide-sensitive — dead low ~0.0ft exposes the shallow reef shelf. Rising tide best.
- Laniakea (North Shore): Gradual-reef right-hander. NW 290-360° with SE offshore. Mid-tide ~1.0ft. Strong currents.
- Chun's Reef (North Shore): Gradual-reef, forgiving longboard right. NW 290-40° with SE offshore. Mid-tide ~1.0ft. Maxes out around 8ft.
- Rocky Point (North Shore): Steep-reef, consistent lefts/rights. NW 290-45° with SE offshore. Low-mid tide ~0.5ft best. Shallow reef. Crowded.
- Ala Moana Bowls (South Shore): Steep-reef, fast hollow left. South swell 160-220° with NE offshore. LOVES dead low tide ~-0.2ft (draining reef). Tide-sensitive — works on falling tide. Max 12ft.
- Kaiser's (South Shore): Steep-reef, short punchy right. South swell 160-220° with NE offshore. Mid-tide ~0.5ft optimal. Max 8ft.
- Queens (South Shore): Gradual-reef, beautiful peeling right. South swell 150-220° with NE-ENE offshore. Mid-tide ~1.0ft. Historic longboarding wave. Max 6ft.
- Canoes (South Shore): Gradual-reef, gentle beginner wave. South swell 150-220° with NE-ENE offshore. Any tide works (~1.5ft). Soft rolling peaks. Max 5ft.
- Diamond Head / Cliffs (South Shore): Gradual-reef, shifty peaks. Wide swell window 140-240° with NE offshore. Any tide. Often windy. Max 10ft.
- White Plains Beach (South Shore): Sandbar, soft longboard wave. South swell 160-220° with N-NE offshore. Any tide. Beginner-friendly. Max 6ft.
- Secrets / Aina Haina (South Shore): Steep-reef, fast hollow. South swell 160-220° with NE offshore. Low tide ~-0.2ft best (draining). Falling tide ideal. Max 8ft.
- Toes / Aina Haina (South Shore): Gradual-reef, gentle longboard wave. South swell 160-220° with NE offshore. Any tide (~1.0ft). Max 6ft.
- Makaha (West Side): Reef-pass, legendary right-hander point break. Picks up NW + S swells 180-330° with E offshore (trade-sheltered). Mid-tide ~1.0ft. Holds huge size up to 20ft.
- Tracks / Kahe Point (West Side): Gradual-reef, fun peaks. NW-W swell 180-310° with E offshore. Mid-tide ~1.0ft. Max 8ft.
- Yokohama Bay (West Side): Sandbar, heavy dangerous shorebreak. NW swells 220-330° with E offshore. Low tide ~-0.2ft. Rising tide best. Expert only. Max 10ft.
- Makapuu Beach (East Side): Sandbar, heavy shorebreak. ENE windswell 0-180° with rare SW offshore (Kona winds). Mid-high tide ~1.5ft. Famous bodysurfing. Max 8ft.
- Sandy Beach (East Side): Sandbar, infamous shorebreak. S-ESE swell 90-220° with NE trades sideshore. HIGH tide ~2.5ft critical for sandbar to work. Very dangerous, breaks in inches of water. Max 6ft.
- Flat Island / Kailua (East Side): Gradual-reef, soft slow wave. NE swell 0-90° with SW offshore. Mid-tide ~1.0ft. Beginner longboard spot. Max 5ft.

Trade winds (NE-E 45-115°) strengthen mid-morning. South Shore gets offshore trades; North Shore gets offshore from SE; West Side is trade-sheltered; East Side is onshore in trades — only good in rare Kona (SW) winds.
`;

  const promptText = `You are given a JSON object containing detailed surf forecast data for 19 spots across 4 regions of Oahu over the next 7 days.

The data includes: calculated wave heights (face and Hawaiian scale), tide heights in feet with rising/falling trends, wind speeds with gust data, multi-swell breakdowns (primary, secondary, and wind-swell components separated), spot quality scores out of 100, and forecast confidence levels (High/Moderate/Low).

${localKnowledge}

Here is the calculated surf forecast data:
${JSON.stringify(dataSummary, null, 2)}

Please write a highly detailed, professional surf forecast report. Return ONLY a valid JSON object with these keys:

1. "outlook": A paragraph summarizing the island-wide swell outlook for the next 7 days. Mention which shores are active, swell sources (N/NW vs S vs windswell), timing of peaks, confidence in the forecast, and overall recommendations.

2. "regions": Object with keys "North Shore", "South Shore", "West Side", "East Side". Each value is a paragraph describing the regional outlook for the week — which spots are favored, wind patterns, tide timing advice (including actual tide heights and whether rising/falling matters), and best days/times to surf.

3. "spots": Object with keys for each spot ID (e.g., "pipeline", "bowls", "makaha", "sandybeach"). Each value contains:
   - "ratingRefined": (String) Revised quality rating. You may adjust the calculated score up to ±10 points based on cross-swell interactions, critical tide heights, localized wind effects, or island shadowing.
   - "scoreRefined": (Number) Revised score out of 100 matching ratingRefined.
   - "waveShape": (String) 1-3 words describing wave form at peak (e.g., "Hollow Barrels", "Soft Peeling Walls", "Peaky A-Frames", "Fat/Slow slope", "Closed-out dump").
   - "safetyRisk": (String) Current safety hazard level (e.g., "Low", "Moderate", "High - shallow reef & heavy rip").
   - "recommendedBoard": (String) Best surfboard for conditions (e.g., "Step-up shortboard", "Standard shortboard", "Fish / Groveler", "Longboard").
   - "crowdFactor": (String) Estimated crowd intensity (e.g., "Intense / Heavy crowd", "Moderate", "Light").
   - "tideNote": (String) 1 sentence about how the tide (including actual height) affects the spot this week.
   - "swellTrendNote": (String) 1 sentence noting if the swell for this spot is building, steady, or fading through the week.
   - "analysis": (String) 4-5 sentences explaining exactly how swell components, wind (including gusts), tide (height + trend), and spot characteristics will interact. Justify your refined score. Recommend the absolute best day(s) and time(s) of day.

Your tone should be authoritative, local, and focused on wave quality. Reference specific tide heights, swell periods, and confidence levels. Do not use placeholders.`;

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
          { role: "system", content: systemPrompt },
          { role: "user", content: promptText },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 8192,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DeepSeek API error (${response.status}): ${errText}`);
    }

    const result = await response.json();
    const contentText = result.choices[0].message.content;
    return JSON.parse(contentText);
  } catch (error) {
    console.error("Error communicating with narrative forecast service:", error);
    return {
      outlook: `Failed to generate narrative forecast: ${error.message}. Showing mathematical calculations only.`,
      regions: {
        "North Shore": "Error generating narrative.",
        "South Shore": "Error generating narrative.",
        "West Side": "Error generating narrative.",
        "East Side": "Error generating narrative.",
      },
      spots: {},
    };
  }
}
