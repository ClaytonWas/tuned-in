export const ENERGY_ENUM = ['calm', 'mellow', 'moderate', 'driving', 'intense'];

export const MOOD_POOL = [
  'sad', 'melancholic', 'happy', 'energetic', 'aggressive',
  'romantic', 'dreamy', 'atmospheric', 'dark', 'epic',
  'uplifting', 'nostalgic',
];

export const STYLE_POOL = [
  'ambient', 'chill', 'lo-fi', 'electronic', 'house', 'techno', 'synthwave',
  'rock', 'indie', 'alternative', 'punk', 'metal',
  'pop', 'indie pop', 'hip-hop', 'rap', 'r&b', 'soul', 'funk',
  'jazz', 'blues', 'classical', 'piano', 'soundtrack',
  'folk', 'acoustic', 'country', 'reggae', 'latin',
];

export const SCENE_POOL = [
  'study', 'focus', 'sleep', 'workout', 'driving',
  'rainy day', 'summer', 'late night',
];

// Styles first: discoverPool only queries Last.fm with tags.slice(0, 3), and genre tags return cleaner pools than mood tags.
export function composeTags(styles, moods, scenes) {
  const seen = new Set();
  const tags = [];
  for (const t of [...styles, ...moods, ...scenes]) {
    if (seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
    if (tags.length >= 5) break;
  }
  if (tags.length === 0) tags.push('chill', 'ambient');
  return tags;
}
