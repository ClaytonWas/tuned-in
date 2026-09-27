// Tag descriptions the page text is compared against. Their embeddings are precomputed at build
// time (tools/embed-prototypes.mjs) so the side panel doesn't spend ~30s embedding them on open.
export const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX';
// EmbeddingGemma was trained with task prefixes; this one scored best for tag matching.
export const TASK_PREFIX = 'task: classification | query: ';

// Descriptions are written as the kind of content each tag suits, since they're compared to page text.
export const ENERGY_PROTOS = {
  calm: 'quiet, peaceful, still, gentle, restful, meditative, slow reflection',
  mellow: 'relaxed, easygoing, cozy, soft, casual and laid-back everyday life',
  moderate: 'informative, balanced, practical, steady, neutral explanation and news',
  driving: 'fast-paced, ambitious, competitive, momentum, progress, business and technology racing forward',
  intense: 'violent, urgent, explosive, dramatic conflict, war, crisis, danger, rage and adrenaline',
};

export const MOOD_PROTOS = {
  sad: 'grief, loss, death, heartbreak, tragedy, loneliness, tears and sorrow',
  melancholic: 'wistful, bittersweet longing, quiet regret, fading memories, reflective sadness',
  happy: 'joy, fun, celebration, cheerful good news, laughter, playful and lighthearted',
  energetic: 'exciting, lively, action-packed, sports, dancing, high energy and enthusiasm',
  aggressive: 'anger, fighting, violence, outrage, conflict, attack, hostility and rebellion',
  romantic: 'love, dating, relationships, weddings, passion, affection and intimacy',
  dreamy: 'surreal, whimsical, imaginative, fantasy, floating, hazy and ethereal',
  atmospheric: 'vast landscapes, space, nature, mysterious ambience, immersive worlds',
  dark: 'horror, crime, death, sinister secrets, dread, menace, the macabre',
  epic: 'heroic battles, grand adventures, legends, triumph, history-changing events',
  uplifting: 'hope, inspiration, overcoming adversity, kindness, motivation and recovery',
  nostalgic: 'childhood, the past, retro memories, old times, vintage and remembering',
};

export const STYLE_PROTOS = {
  ambient: 'space, nature, meditation, calm science, slow drifting soundscapes',
  chill: 'relaxing, laid-back lifestyle, coffee, weekends, easy browsing',
  'lo-fi': 'studying, homework, cozy rooms, anime, rainy afternoons, notes and reading',
  electronic: 'technology, computers, software, AI, gadgets, the internet and the future',
  house: 'parties, nightlife, clubs, fashion, dancing all night',
  techno: 'industrial, machines, warehouses, hypnotic repetition, Berlin nightlife',
  synthwave: 'retro 1980s neon, sports cars, cyberpunk, arcade video games',
  rock: 'rebellion, road trips, guitars, loud stadiums, working class grit',
  indie: 'independent creators, art school, quirky personal stories, small bands',
  alternative: 'angst, outsiders, counterculture, introspective frustration',
  punk: 'protest, anti-establishment anger, DIY, fast and raw rebellion',
  metal: 'war, darkness, mythology, brutal violence, heavy intensity',
  pop: 'celebrities, trends, social media, entertainment, catchy mainstream culture',
  'indie pop': 'sweet crushes, youthful optimism, bright quirky everyday moments',
  'hip-hop': 'street life, cities, hustle, success, money, culture and swagger',
  rap: 'bragging, rivalry, wordplay, struggle, ambition and street stories',
  'r&b': 'smooth romance, late night relationships, sensual love and heartbreak',
  soul: 'deep emotion, gospel, heartfelt struggle, civil rights and resilience',
  funk: 'grooves, good times, 1970s style, dancing and celebration',
  jazz: 'cafes, sophistication, improvisation, cities at night, art and conversation',
  blues: 'hardship, heartbreak, poverty, the American South, trouble and bad luck',
  classical: 'history, art, philosophy, literature, science, elegance and timeless ideas',
  piano: 'intimate reflection, memories, quiet emotion, solitude',
  soundtrack: 'movies, games, storytelling, epic scenes, drama and adventure',
  folk: 'rural life, tradition, storytelling, farms, small towns and heritage',
  acoustic: 'simple honest feelings, campfires, singer-songwriters, unplugged moments',
  country: 'trucks, ranches, family, faith, small-town America, whiskey and heartbreak',
  reggae: 'islands, beaches, peace, unity, the Caribbean and laid-back sunshine',
  latin: 'Spanish-speaking culture, Latin America, fiesta, salsa, passion and heat',
};

export const SCENE_PROTOS = {
  study: 'learning, tutorials, homework, exams, education, research and documentation',
  focus: 'productivity, work, coding, deep concentration, getting things done',
  sleep: 'bedtime, rest, insomnia, dreams, winding down at night',
  workout: 'fitness, gym, running, training, exercise, sports performance',
  driving: 'cars, roads, travel, commuting, road trips and highways',
  'rainy day': 'rain, storms, grey weather, staying indoors, cozy and gloomy',
  summer: 'summer, beach, sun, vacation, heat, pools and holidays',
  'late night': 'midnight, insomnia, city lights, nightlife, the small hours',
};

export const PROTOTYPE_SETS = {
  energy: ENERGY_PROTOS,
  moods: MOOD_PROTOS,
  styles: STYLE_PROTOS,
  scenes: SCENE_PROTOS,
};

export function prototypeText(tag, description) {
  return `${tag}: ${description}`;
}
