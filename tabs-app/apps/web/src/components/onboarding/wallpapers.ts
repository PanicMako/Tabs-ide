export type WallpaperCategory =
  | "All"
  | "Sky"
  | "Sunset"
  | "Night"
  | "Nature"
  | "Pastel"
  | "Places"
  | "Scenery";

export interface WallpaperOption {
  readonly id: string;
  readonly label: string;
  readonly category: Exclude<WallpaperCategory, "All">;
  readonly url: string;
  readonly accentColor: string;
  readonly description: string;
}

export const WALLPAPER_CATEGORIES: readonly WallpaperCategory[] = [
  "All",
  "Sky",
  "Sunset",
  "Night",
  "Nature",
  "Pastel",
  "Places",
  "Scenery",
];

export const WALLPAPERS: readonly WallpaperOption[] = [
  {
    id: "wp2394184",
    label: "Azure Sky",
    category: "Sky",
    url: "/wallpapers/wp2394184-anime-sky-wallpapers.jpg",
    accentColor: "#38bdf8",
    description: "Expansive summer clouds & infinite blue",
  },
  {
    id: "wp2771912",
    label: "Scenic Valley",
    category: "Scenery",
    url: "/wallpapers/wp2771912-anime-background-wallpaper.jpg",
    accentColor: "#60a5fa",
    description: "Winding country roads & rolling mountains",
  },
  {
    id: "wp3595708",
    label: "Verdant Hills",
    category: "Nature",
    url: "/wallpapers/wp3595708-anime-nature-wallpapers.jpg",
    accentColor: "#34d399",
    description: "Sun-drenched hillsides & lush green fields",
  },
  {
    id: "wp3595716",
    label: "Forest Canopy",
    category: "Nature",
    url: "/wallpapers/wp3595716-anime-nature-wallpapers.jpg",
    accentColor: "#10b981",
    description: "Sunlight filtering through deep ancient woods",
  },
  {
    id: "wp4776536",
    label: "Sakura Dream",
    category: "Pastel",
    url: "/wallpapers/wp4776536-aesthetic-pink-anime-wallpapers.jpg",
    accentColor: "#f472b6",
    description: "Soft pink twilight & drifting cherry blossoms",
  },
  {
    id: "wp4811383",
    label: "Pastel Horizon",
    category: "Pastel",
    url: "/wallpapers/wp4811383-pastel-aesthetic-landscape-wallpapers.jpg",
    accentColor: "#fb7185",
    description: "Gentle lavender gradients & calm pastel waters",
  },
  {
    id: "wp4946045",
    label: "Coastal Town",
    category: "Places",
    url: "/wallpapers/wp4946045-anime-places-wallpapers.jpg",
    accentColor: "#38bdf8",
    description: "Quiet coastal avenue overlooking the bay",
  },
  {
    id: "wp4979803",
    label: "Dreamy Vista",
    category: "Scenery",
    url: "/wallpapers/wp4979803-scenery-anime-aesthetic-wallpapers.png",
    accentColor: "#a78bfa",
    description: "Ethereal anime vista bathed in celestial violet",
  },
  {
    id: "wp5076799",
    label: "Romantic Night",
    category: "Night",
    url: "/wallpapers/wp5076799-anime-alone-romantic-dark-wallpapers.jpg",
    accentColor: "#818cf8",
    description: "Solitary rooftop under a canopy of stars",
  },
  {
    id: "wp5089549",
    label: "Mountain Shrine",
    category: "Scenery",
    url: "/wallpapers/wp5089549-scenery-anime-wallpapers.jpg",
    accentColor: "#fb923c",
    description: "Traditional hilltop path overlooking the valley",
  },
  {
    id: "wp5125451",
    label: "Aesthetic Lake",
    category: "Nature",
    url: "/wallpapers/wp5125451-anime-aesthetic-landscapes-wallpapers.jpg",
    accentColor: "#2dd4bf",
    description: "Mirror-still alpine lake & crystal skies",
  },
  {
    id: "wp5250028",
    label: "Violet Twilight",
    category: "Pastel",
    url: "/wallpapers/wp5250028-anime-white-and-purple-landscape-wallpapers.jpg",
    accentColor: "#c084fc",
    description: "Quiet pastel twilight with lavender clouds",
  },
  {
    id: "wp5306638",
    label: "Starlit Station",
    category: "Night",
    url: "/wallpapers/wp5306638-anime-pc-wallpapers.jpg",
    accentColor: "#6366f1",
    description: "Midnight train platform under glowing nebulae",
  },
  {
    id: "wp5330661",
    label: "Whispering Grass",
    category: "Nature",
    url: "/wallpapers/wp5330661-anime-grass-scenery-wallpapers.jpg",
    accentColor: "#4ade80",
    description: "Summer breeze dancing across high mountain meadows",
  },
  {
    id: "wp5475487",
    label: "Lakeside Sunset",
    category: "Sunset",
    url: "/wallpapers/wp5475487-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#f97316",
    description: "Golden rays bouncing over crystalline lake waters",
  },
  {
    id: "wp5475488",
    label: "Golden Hour Rails",
    category: "Sunset",
    url: "/wallpapers/wp5475488-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#fbbf24",
    description: "Sunset casting warm shadows on railway tracks",
  },
  {
    id: "wp5475495",
    label: "Coastal Windmills",
    category: "Scenery",
    url: "/wallpapers/wp5475495-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#38bdf8",
    description: "Seaside breeze turning wind turbines along the coast",
  },
  {
    id: "wp5475501",
    label: "Blossom Path",
    category: "Nature",
    url: "/wallpapers/wp5475501-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#f43f5e",
    description: "Fallen cherry blossoms lining a sunlit walkway",
  },
  {
    id: "wp5475510",
    label: "Metropolis Glow",
    category: "Places",
    url: "/wallpapers/wp5475510-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#06b6d4",
    description: "Vibrant city lights reflecting in evening raindrops",
  },
  {
    id: "wp5475521",
    label: "Twilight Crossing",
    category: "Sunset",
    url: "/wallpapers/wp5475521-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#e11d48",
    description: "Crimson evening horizon over a train crossing",
  },
  {
    id: "wp5475526",
    label: "Neon Evening",
    category: "Night",
    url: "/wallpapers/wp5475526-anime-scenery-4k-wallpapers.jpg",
    accentColor: "#8b5cf6",
    description: "Cyberpunk neon accents in a tranquil rainy dusk",
  },
  {
    id: "wp5493782",
    label: "Radiant Sunset",
    category: "Sunset",
    url: "/wallpapers/wp5493782-4k-scenery-sunset-anime-wallpapers.jpg",
    accentColor: "#ea580c",
    description: "Fiery orange sunset glowing across vast cumulus clouds",
  },
  {
    id: "wp5683329",
    label: "Summer Horizon",
    category: "Sky",
    url: "/wallpapers/wp5683329-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#0ea5e9",
    description: "Bright blue summer skies with towering stormheads",
  },
  {
    id: "wp5683360",
    label: "Summer Classroom",
    category: "Places",
    url: "/wallpapers/wp5683360-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#f59e0b",
    description: "Nostalgic after-school sunlight through classroom windows",
  },
  {
    id: "wp5683361",
    label: "Sunset Harbor",
    category: "Sunset",
    url: "/wallpapers/wp5683361-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#d97706",
    description: "Anchored boats resting in a warm amber sunset",
  },
  {
    id: "wp5683381",
    label: "Misty Mountain",
    category: "Nature",
    url: "/wallpapers/wp5683381-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#14b8a6",
    description: "Dense pine peaks shrouded in morning mountain mist",
  },
  {
    id: "wp5683395",
    label: "Emerald Meadow",
    category: "Nature",
    url: "/wallpapers/wp5683395-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#22c55e",
    description: "Vibrant grassland under a sunlit blue atmosphere",
  },
  {
    id: "wp5683420",
    label: "Celestial Stars",
    category: "Night",
    url: "/wallpapers/wp5683420-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#a855f7",
    description: "The Milky Way galaxy glowing across a crystal night",
  },
  {
    id: "wp5683421",
    label: "Starlight Bridge",
    category: "Night",
    url: "/wallpapers/wp5683421-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#6366f1",
    description: "Suspension bridge illuminated under a celestial sky",
  },
  {
    id: "wp5683436",
    label: "Solar Flare Sky",
    category: "Sky",
    url: "/wallpapers/wp5683436-4k-anime-scenery-wallpapers.jpg",
    accentColor: "#38bdf8",
    description: "Sunburst through dramatic high-altitude anime clouds",
  },
];

const WALLPAPER_STORAGE_KEY = "tabs:wallpaper";

/**
 * Wallpapers suitable for the startup wizard — bright/light only, no Night category.
 * These pop visually against the wizard's dark-glass UI.
 */
export const BRIGHT_WALLPAPERS: readonly WallpaperOption[] = WALLPAPERS.filter(
  (w) => w.category !== "Night",
);

export function getInitialWallpaper(): WallpaperOption {
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (saved) {
      const match = WALLPAPERS.find((w) => w.url === saved);
      if (match) return match;
    }
  } catch {}
  return BRIGHT_WALLPAPERS[0]!;
}

export function saveWallpaperPreference(url: string): void {
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, url);
  } catch {}
}
