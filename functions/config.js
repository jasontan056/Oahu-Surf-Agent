// Surf spots database for Oahu
export const spots = [
  // North Shore
  {
    id: "pipeline",
    name: "Pipeline / Backdoor",
    region: "North Shore",
    latitude: 21.6640,
    longitude: -158.0530,
    swellWindow: { min: 290, max: 45 },
    optimalSwell: 315,
    optimalWind: 120, // SE (offshore)
    magnification: 1.8,
    type: "Reefbreak",
    difficulty: "Expert",
    description: "The world's most famous, heavy barrel. Breaking over a shallow, jagged reef. Pipeline is a steep left, while Backdoor is the fast right.",
    optimalTide: "medium",
    tideSensitivity: 0.6
  },
  {
    id: "waimea",
    name: "Waimea Bay",
    region: "North Shore",
    latitude: 21.6360,
    longitude: -158.0650,
    swellWindow: { min: 300, max: 360 },
    optimalSwell: 330,
    optimalWind: 120, // SE (offshore)
    magnification: 2.2,
    type: "Reefbreak",
    difficulty: "Expert",
    description: "The birthplace of big wave riding. Needs massive swells to start breaking properly. Heavy shorebreak and long, scaling walls.",
    optimalTide: "medium",
    tideSensitivity: 0.5
  },
  {
    id: "sunset",
    name: "Sunset Beach",
    region: "North Shore",
    latitude: 21.6780,
    longitude: -158.0300,
    swellWindow: { min: 300, max: 45 },
    optimalSwell: 325,
    optimalWind: 135, // SE to SSE (offshore)
    magnification: 1.5,
    type: "Reefbreak",
    difficulty: "Advanced",
    description: "A wide, shifty arena with massive waves and strong currents. Sunset is a powerful right-hand reef break.",
    optimalTide: "medium",
    tideSensitivity: 0.4
  },
  {
    id: "haleiwa",
    name: "Haleiwa (Ali'i Beach)",
    region: "North Shore",
    latitude: 21.5970,
    longitude: -158.1110,
    swellWindow: { min: 280, max: 350 },
    optimalSwell: 310,
    optimalWind: 110, // ESE (offshore)
    magnification: 1.4,
    type: "Reef / Point",
    difficulty: "Advanced",
    description: "A high-performance right-hander that breaks over a shallow reef shelf. Heavy current and a challenging rip.",
    optimalTide: "low",
    tideSensitivity: 0.8
  },
  {
    id: "laniakea",
    name: "Laniakea",
    region: "North Shore",
    latitude: 21.6190,
    longitude: -158.0850,
    swellWindow: { min: 290, max: 360 },
    optimalSwell: 320,
    optimalWind: 120, // SE (offshore)
    magnification: 1.3,
    type: "Reef / Point",
    difficulty: "Advanced",
    description: "A long, walling right-hander that is highly popular and can hold size. Watch out for the strong current and turtles.",
    optimalTide: "medium",
    tideSensitivity: 0.5
  },
  {
    id: "chuns",
    name: "Chun's Reef",
    region: "North Shore",
    latitude: 21.6250,
    longitude: -158.0800,
    swellWindow: { min: 290, max: 40 },
    optimalSwell: 320,
    optimalWind: 120, // SE (offshore)
    magnification: 1.1,
    type: "Reefbreak",
    difficulty: "Intermediate",
    description: "A friendly, long right-hander popular with longboarders, but can get hollow and fast when the swell is up.",
    optimalTide: "medium",
    tideSensitivity: 0.4
  },
  {
    id: "rockypoint",
    name: "Rocky Point",
    region: "North Shore",
    latitude: 21.6700,
    longitude: -158.0430,
    swellWindow: { min: 290, max: 45 },
    optimalSwell: 315,
    optimalWind: 120, // SE (offshore)
    magnification: 1.2,
    type: "Reefbreak",
    difficulty: "Advanced",
    description: "Highly consistent, offering both high-performance lefts and rights. Shallow, sharp reef and a very crowded peak.",
    optimalTide: "medium",
    tideSensitivity: 0.7
  },

  // South Shore
  {
    id: "bowls",
    name: "Ala Moana Bowls",
    region: "South Shore",
    latitude: 21.2840,
    longitude: -157.8420,
    swellWindow: { min: 160, max: 220 },
    optimalSwell: 185,
    optimalWind: 45, // NE (offshore)
    magnification: 1.3,
    type: "Reefbreak",
    difficulty: "Advanced",
    description: "Oahu's premier south shore wave. A fast, hollow left-hander that breaks along the edge of the yacht harbor channel.",
    optimalTide: "low",
    tideSensitivity: 0.8
  },
  {
    id: "kaisers",
    name: "Kaiser's",
    region: "South Shore",
    latitude: 21.2820,
    longitude: -157.8380,
    swellWindow: { min: 160, max: 220 },
    optimalSwell: 185,
    optimalWind: 45, // NE (offshore)
    magnification: 1.1,
    type: "Reefbreak",
    difficulty: "Advanced",
    description: "A short, fast, punchy right-hander that is highly popular and breaks over a shallow reef.",
    optimalTide: "medium",
    tideSensitivity: 0.7
  },
  {
    id: "queens",
    name: "Queens",
    region: "South Shore",
    latitude: 21.2720,
    longitude: -157.8260,
    swellWindow: { min: 150, max: 220 },
    optimalSwell: 180,
    optimalWind: 60, // NE to ENE (offshore)
    magnification: 1.0,
    type: "Reefbreak",
    difficulty: "Intermediate",
    description: "A beautiful, peeling right-hander in Waikiki. Highly historical and the home of modern longboarding.",
    optimalTide: "medium",
    tideSensitivity: 0.5
  },
  {
    id: "canoes",
    name: "Canoes",
    region: "South Shore",
    latitude: 21.2730,
    longitude: -157.8280,
    swellWindow: { min: 150, max: 220 },
    optimalSwell: 180,
    optimalWind: 60, // NE to ENE (offshore)
    magnification: 0.7,
    type: "Reefbreak",
    difficulty: "Beginner",
    description: "A gentle, rolling wave perfect for beginners, surf schools, and outrigger canoes. Breaks over a deep, sandy reef.",
    optimalTide: "any",
    tideSensitivity: 0.2
  },
  {
    id: "cliffs",
    name: "Diamond Head (Cliffs)",
    region: "South Shore",
    latitude: 21.2520,
    longitude: -157.8100,
    swellWindow: { min: 140, max: 240 },
    optimalSwell: 180,
    optimalWind: 45, // NE (offshore-ish, very windy site)
    magnification: 1.1,
    type: "Reefbreak",
    difficulty: "Intermediate",
    description: "Consistently catches any swell. Offers multiple shifty peaks with deep-water channels. Often windy.",
    optimalTide: "any",
    tideSensitivity: 0.3
  },
  {
    id: "whiteplains",
    name: "White Plains Beach",
    region: "South Shore",
    latitude: 21.3010,
    longitude: -158.0250,
    swellWindow: { min: 160, max: 220 },
    optimalSwell: 185,
    optimalWind: 20, // N to NE (offshore)
    magnification: 0.8,
    type: "Beach / Reef",
    difficulty: "Beginner",
    description: "A fun, soft longboard wave on the Ewa plain. Ideal for beginners and families.",
    optimalTide: "any",
    tideSensitivity: 0.2
  },
  {
    id: "secrets",
    name: "Secrets (Aina Haina)",
    region: "South Shore",
    latitude: 21.2720,
    longitude: -157.7560,
    swellWindow: { min: 160, max: 220 },
    optimalSwell: 190,
    optimalWind: 45, // NE (offshore-ish)
    magnification: 1.1,
    type: "Reefbreak",
    difficulty: "Advanced",
    description: "A fast, hollow reef break in Aina Haina. It works on solid south swells but can get very shallow and sharp at low tide.",
    optimalTide: "low",
    tideSensitivity: 0.8
  },
  {
    id: "toes",
    name: "Toes (Aina Haina)",
    region: "South Shore",
    latitude: 21.2740,
    longitude: -157.7540,
    swellWindow: { min: 160, max: 220 },
    optimalSwell: 190,
    optimalWind: 45, // NE (offshore-ish)
    magnification: 0.8,
    type: "Reefbreak",
    difficulty: "Intermediate",
    description: "A long, gentle wave popular for longboarding in Aina Haina. It has a soft, peeling profile and breaks over a deep reef.",
    optimalTide: "any",
    tideSensitivity: 0.3
  },

  // West Side
  {
    id: "makaha",
    name: "Makaha",
    region: "West Side",
    latitude: 21.4750,
    longitude: -158.2250,
    swellWindow: { min: 180, max: 330 }, // Super wide! Picks up both N and S swells
    optimalSwell: 300, // NW swell
    optimalWind: 90, // East (offshore)
    magnification: 1.4,
    type: "Point / Reef",
    difficulty: "Advanced",
    description: "A legendary, powerful right-hand point break that can hold huge winter swells and nice summer south swells.",
    optimalTide: "medium",
    tideSensitivity: 0.5
  },
  {
    id: "tracks",
    name: "Tracks (Kahe Point)",
    region: "West Side",
    latitude: 21.3530,
    longitude: -158.1300,
    swellWindow: { min: 180, max: 310 },
    optimalSwell: 260,
    optimalWind: 90, // East (offshore)
    magnification: 1.0,
    type: "Reefbreak",
    difficulty: "Intermediate",
    description: "Located near the power plant. Offers fun, peeling lefts and rights over a mix of reef and sand.",
    optimalTide: "medium",
    tideSensitivity: 0.5
  },
  {
    id: "yokohama",
    name: "Yokohama Bay",
    region: "West Side",
    latitude: 21.5720,
    longitude: -158.2430,
    swellWindow: { min: 220, max: 330 },
    optimalSwell: 290,
    optimalWind: 90, // East (offshore)
    magnification: 1.3,
    type: "Beachbreak",
    difficulty: "Expert",
    description: "A heavy, fast shorebreak that breaks in shallow water. Beautiful but highly dangerous.",
    optimalTide: "low",
    tideSensitivity: 0.8
  },

  // East Side (Windward)
  {
    id: "makapuu",
    name: "Makapuu Beach",
    region: "East Side",
    latitude: 21.3130,
    longitude: -157.6530,
    swellWindow: { min: 0, max: 180 }, // Picks up East and NE windswells, and South swells
    optimalSwell: 70, // ENE windswell
    optimalWind: 240, // SW (offshore - rare Kona winds)
    magnification: 1.2,
    type: "Beachbreak",
    difficulty: "Intermediate",
    description: "Famous bodysurfing and bodyboarding spot. A heavy shorebreak breaking on sand, with scenic cliffs behind.",
    optimalTide: "medium",
    tideSensitivity: 0.4
  },
  {
    id: "sandybeach",
    name: "Sandy Beach",
    region: "East Side",
    latitude: 21.2850,
    longitude: -157.6720,
    swellWindow: { min: 90, max: 220 },
    optimalSwell: 160,
    optimalWind: 45, // NE (trades are sideshore/offshore)
    magnification: 1.0,
    type: "Beachbreak",
    difficulty: "Advanced",
    description: "Infamous shorebreak that breaks in inches of water directly on sand. Very dangerous, popular for bodyboarding.",
    optimalTide: "high",
    tideSensitivity: 0.9
  },
  {
    id: "flatisland",
    name: "Kailua Beach (Flat Island)",
    region: "East Side",
    latitude: 21.4010,
    longitude: -157.7320,
    swellWindow: { min: 0, max: 90 },
    optimalSwell: 60,
    optimalWind: 220, // SW (offshore)
    magnification: 0.6,
    type: "Reefbreak",
    difficulty: "Beginner",
    description: "A soft, slow wave that breaks off Flat Island in Kailua Bay. Great for longboarding and kayak-surfing.",
    optimalTide: "medium",
    tideSensitivity: 0.3
  }
];
