// Narrative generation service client for generating surf forecast texts
export async function generateNarrativeForecast(dataSummary) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("DEEPSEEK_API_KEY is not defined. Skipping narrative forecast generation.");
    return {
      outlook: "Forecast narrative key not configured. Showing raw mathematical calculations only.",
      regions: {
        "North Shore": "N/A",
        "South Shore": "N/A",
        "West Side": "N/A",
        "East Side": "N/A"
      },
      spots: {}
    };
  }

  const prompt = `
You are an expert surf forecaster for the island of Oahu, Hawaii.
You are given a JSON object containing raw meteorological data and calculated wave heights (face height and traditional Hawaiian scale) and wind quality for 19 spots across 4 regions of Oahu (North Shore, South Shore, West Side, East Side) over the next 7 days.

Here is the calculated surf forecast data:
${JSON.stringify(dataSummary, null, 2)}

Please write a highly detailed, professional surf forecast report. The report must be returned in JSON format with the following keys:
1. "outlook": A paragraph summarizing the island-wide swell outlook for the next 7 days (which shores are active, swell sources, timing of peaks, and overall recommendations).
2. "regions": An object where keys are the 4 regions ("North Shore", "South Shore", "West Side", "East Side") and values are paragraphs describing the regional outlook for the week, which spots are favored, wind patterns, and general recommendations for the best days/times to surf.
3. "spots": An object where keys are the spot IDs (e.g., "pipeline", "bowls", "makaha", "sandybeach") and values are 3-4 sentences explaining exactly how the swell and wind will interact at that specific spot over the 7 days, and specifically recommend the absolute best day(s) and time(s) of day to surf this spot (e.g., "Best time: Day 1 Morning during the swell peak and offshore winds").

Your tone should be authoritative, local, and focused on wave quality, swell angle, wind impact, tide timing, and safety. Do not use placeholders. Return ONLY a valid JSON object matching the requested schema.
`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          {
            role: "system",
            content: "You are an expert Oahu surf forecaster that outputs responses in valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7
      })
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
        "East Side": "Error generating narrative."
      },
      spots: {}
    };
  }
}
