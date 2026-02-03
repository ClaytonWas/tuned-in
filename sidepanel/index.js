function getAllVisibleText() {
  // Scrape and filter visible text from the DOM
  let text = '';
  try {
    // Get all visible text nodes, excluding script/style/nav/footer/header/aside
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        // Exclude invisible, whitespace, or boilerplate text
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName.toLowerCase();
        if (["script","style","nav","footer","header","aside"].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (node.textContent.trim().length < 2) return NodeFilter.FILTER_REJECT;
        // Exclude cookie/privacy/policy banners
        if (/cookie|privacy|policy|terms|settings|help|contact|login|register|basket|cart|ad|advert/i.test(node.textContent)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      text += node.textContent.trim() + '\n';
    }
  } catch (e) {
    text = 'Unable to extract visible text.';
  }
  return text.trim();
}

// DEBUG FLAG
const DEBUG = true;
if (!DEBUG) {
  console.log = function () {};
  console.warn = function () {};
  console.error = function(){};
}

let MAX_MODEL_CHARS = 10000;

let pageContent = '';
let isAnalyzing = false;
let summaryHistory = JSON.parse(localStorage.getItem('summaryHistory') || '[]');
let maxHistoryLimit = parseInt(localStorage.getItem('historyLimit') || '20', 10);
let popularityMin = parseInt(localStorage.getItem('popularityMin') || '25', 10);
let popularityMax = parseInt(localStorage.getItem('popularityMax') || '100', 10);

const summaryElement = document.querySelector('#summary');
const warningElement = document.querySelector('#warning');
const summarizeButton = document.querySelector('#summarizeButton');

// ============================================
// Singleton Summarizer - initialized once, reused
// ============================================
let sharedSummarizer = null;
let summarizerInitializing = false;
let summarizerReady = false;

async function getSharedSummarizer() {
  // Already ready
  if (sharedSummarizer && summarizerReady) {
    return sharedSummarizer;
  }
  
  // Already initializing - wait for it
  if (summarizerInitializing) {
    while (summarizerInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    return sharedSummarizer;
  }
  
  // Initialize
  summarizerInitializing = true;
  
  try {
    const availability = await Summarizer.availability();
    console.log('Summarizer availability:', availability);
    if (availability === 'unavailable' || availability === 'no') {
      console.warn('Summarizer not available:', availability);
      summarizerInitializing = false;
      return null;
    }
    
    const options = {
      robustnessLevel: "medium",
      sharedContext: 'Analyze content and provide insights.',
      type: 'key-points',
      expectedInputLanguages: ["en", "ja", "es"],
      outputLanguage: "en",
      format: 'plain-text',
      length: 'short'
    };
    
    sharedSummarizer = await Summarizer.create(options);
    await sharedSummarizer.ready;
    summarizerReady = true;
    summarizerInitializing = false;
    
    console.log('Shared summarizer initialized');
    return sharedSummarizer;
    
  } catch (e) {
    console.error('Failed to initialize summarizer:', e);
    summarizerInitializing = false;
    return null;
  }
}

// Cache the Spotify token
let cachedToken = null;
let tokenExpiry = null;

// Update the warning area in the UI
function updateWarning(warning) {
  warningElement.textContent = warning;
  if (warning) {
    warningElement.removeAttribute('hidden');
  } else {
    warningElement.setAttribute('hidden', '');
  }
}


// No longer used: summaryElement is deprecated in favor of per-card summaries
function showSummary(text) {
  // Deprecated: do nothing
}

// Show temporary skeleton placeholders for history UI
function showSkeletonHistory() {
  const historyList = document.querySelector('#historyList');
  historyList.innerHTML = `
    <li class="history-item">
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-embed"></div>
    </li>
    <li class="history-item">
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-embed"></div>
    </li>
  `;
}

// Render full history progressively for smoother UI
async function renderHistory() {
  const historyList = document.querySelector('#historyList');
  const historyCount = document.querySelector('#historyCount');

  if (summaryHistory.length === 0) {
    historyList.innerHTML = '<li class="empty-state">No recommendations yet. Generate your first one above!</li>';
    if (historyCount) historyCount.textContent = '0';
    return;
  }

  if (historyCount) historyCount.textContent = summaryHistory.length.toString();

  historyList.innerHTML = '';

  for (let i = 0; i < summaryHistory.length; i++) {
    const item = summaryHistory[i];
    const li = document.createElement('li');
    li.classList.add('history-item');

    const spotifyEmbedUrl = `https://open.spotify.com/embed/track/${item.trackId}`;
    const albumArt = item.albumArt || '';

    li.innerHTML = `
      <div class="history-content">
        <div class="history-artwork">
          <a href="https://open.spotify.com/track/${item.trackId}" target="_blank">
            <img src="${albumArt}" alt="Album cover" />
          </a>
        </div>
        <div class="history-details">
          <div class="history-track">
            <a href="https://open.spotify.com/track/${item.trackId}" target="_blank">${item.trackName}</a>
          </div>
          <div class="history-artist">
            ${item.artistIds
              .map((id, index) =>
                `<a href="https://open.spotify.com/artist/${id}" target="_blank">${item.trackArtist.split(', ')[index]}</a>`
              ).join(', ')
            }
          </div>
          <div class="history-meta">
            <span>${item.genres.slice(0, 2).join(', ')}</span>
            <span>•</span>
            <span>${item.bpm} BPM</span>
          </div>
        </div>
      </div>

      <div class="source-link">
        <span class="source-label">Source:</span>
        <strong><a href="${item.pageUrl}" target="_blank">${item.pageTitle}</a></strong>
      </div>

      <details>
        <summary>More Info</summary>
        <div class="details-content">
          <iframe 
            src="${spotifyEmbedUrl}" 
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
            loading="lazy"
            frameBorder="0">
          </iframe>

          <div class="details-row">
            <span class="details-label">Track:</span>
            <span>
              <a href="https://open.spotify.com/track/${item.trackId}" target="_blank">
                ${item.trackName}
              </a>
            </span>
          </div>

          <div class="details-row">
            <span class="details-label">Artist:</span>
            <span>
              ${item.artistIds
                .map((id, index) =>
                  `<a href="https://open.spotify.com/artist/${id}" target="_blank">${item.trackArtist.split(', ')[index]}</a>`
                ).join(', ')
              }
            </span>
          </div>

          <div class="details-row">
            <span class="details-label">Genres:</span>
            <span>${item.genres.join(', ')}</span>
          </div>

          <div class="details-row">
            <span class="details-label">BPM:</span>
            <span>${item.bpm}</span>
          </div>
        </div>
      </details>
    `;

    historyList.appendChild(li);

    if (i < summaryHistory.length - 1 && i % 3 === 2) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

// Fetch Spotify token from your backend & cache it
async function getSpotifyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached Spotify token');
    return cachedToken;
  }

  try {
    console.log('Fetching new Spotify token from serverless function...');
    const res = await fetch('https://tuned-in-api.vercel.app/api/spotify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('Token fetch error:', res.status, text);
      throw new Error(`Failed to get token: ${res.status}`);
    }

    const data = await res.json();
    console.log('Token received from serverless function');

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;

    return cachedToken;
  } catch (e) {
    console.error('Error getting Spotify token:', e);
    throw e;
  }
}

// Map genres to Spotify's valid seed genres for Recommendations API
// Spotify has specific genre seeds - see: https://developer.spotify.com/documentation/web-api/reference/get-recommendations
function mapToSpotifyGenres(genres) {
  const spotifyGenreMap = {
    'pop': 'pop',
    'rock': 'rock',
    'hip-hop': 'hip-hop',
    'hip hop': 'hip-hop',
    'rap': 'hip-hop',
    'electronic': 'electronic',
    'edm': 'electronic',
    'indie': 'indie',
    'indie-pop': 'indie-pop',
    'jazz': 'jazz',
    'classical': 'classical',
    'ambient': 'ambient',
    'metal': 'metal',
    'folk': 'folk',
    'r-n-b': 'r-n-b',
    'r&b': 'r-n-b',
    'country': 'country',
    'reggae': 'reggae',
    'blues': 'blues',
    'soul': 'soul',
    'punk': 'punk',
    'disco': 'disco',
    'house': 'house',
    'techno': 'techno',
    'trance': 'trance',
    'dubstep': 'dubstep',
    'chill': 'chill',
    // Map mood-based genres to actual music genres
    'romantic': 'r-n-b', // Romantic mood -> R&B/Soul
    'sad': 'sad', // "sad" is a valid Spotify genre
    'happy': 'happy', // "happy" is a valid Spotify genre
    'party': 'party', // "party" is a valid Spotify genre
    'aggressive': 'metal', // Map aggressive to metal
    'lo-fi': 'chill',
    'synthwave': 'electronic',
    'trap': 'hip-hop',
    'grunge': 'rock'
  };

  // Map genres to Spotify's valid seed genres
  const validGenres = [];
  // Only include genres that are actually valid for Spotify search genre filter
  // Note: Some genres like "romantic" and "romance" may not work in search filters
  // but "sad", "happy", "party" are valid mood-based genres
  const spotifyValidGenres = [
    'acoustic', 'afrobeat', 'alt-rock', 'alternative', 'ambient', 'anime', 'black-metal',
    'bluegrass', 'blues', 'bossanova', 'brazil', 'breakbeat', 'british', 'cantopop',
    'chicago-house', 'children', 'chill', 'classical', 'club', 'comedy', 'country',
    'dance', 'dancehall', 'death-metal', 'deep-house', 'detroit-techno', 'disco',
    'disney', 'drum-and-bass', 'dub', 'dubstep', 'edm', 'electro', 'electronic',
    'emo', 'folk', 'forro', 'french', 'funk', 'garage', 'german', 'gospel', 'goth',
    'grindcore', 'groove', 'grunge', 'guitar', 'happy', 'hard-rock', 'hardcore',
    'hardstyle', 'heavy-metal', 'hip-hop', 'holidays', 'honky-tonk', 'house',
    'idm', 'indian', 'indie', 'indie-pop', 'industrial', 'iranian', 'j-dance',
    'j-idol', 'j-pop', 'j-rock', 'jazz', 'k-pop', 'kids', 'latin', 'latino',
    'malay', 'mandopop', 'metal', 'metal-misc', 'metalcore', 'minimal-techno',
    'movies', 'mpb', 'new-age', 'new-release', 'opera', 'pagode', 'party', 'philippines-opm',
    'piano', 'pop', 'pop-film', 'post-dubstep', 'power-pop', 'progressive-house',
    'psych-rock', 'punk', 'punk-rock', 'r-n-b', 'rainy-day', 'reggae', 'reggaeton',
    'road-trip', 'rock', 'rock-n-roll', 'rockabilly', 'sad',
    'salsa', 'samba', 'sertanejo', 'show-tunes', 'singer-songwriter', 'ska', 'sleep',
    'songwriter', 'soul', 'soundtracks', 'spanish', 'study', 'summer', 'swedish',
    'synth-pop', 'tango', 'techno', 'trance', 'trip-hop', 'turkish', 'work-out',
    'world-music'
  ];

  for (const genre of genres) {
    const normalized = genre.toLowerCase().trim();
    const mapped = spotifyGenreMap[normalized];
    
    if (mapped && spotifyValidGenres.includes(mapped)) {
      if (!validGenres.includes(mapped)) {
        validGenres.push(mapped);
      }
    } else if (spotifyValidGenres.includes(normalized)) {
      if (!validGenres.includes(normalized)) {
        validGenres.push(normalized);
      }
    }
  }

  // If no valid genres found, use safe defaults
  if (validGenres.length === 0) {
    validGenres.push('pop', 'chill');
  }

  return validGenres.slice(0, 5); // Spotify allows up to 5 seed genres
}

// Calculate energy and valence based on BPM and genres
function calculateAudioFeatures(bpm, genres) {
  // Energy: 0.0 to 1.0 (higher = more energetic)
  let energy = 0.5;
  if (bpm < 80) {
    energy = 0.2 + (bpm - 60) / 100; // 0.2-0.4 for slow
  } else if (bpm < 100) {
    energy = 0.3 + (bpm - 80) / 100; // 0.3-0.5 for chill
  } else if (bpm < 120) {
    energy = 0.4 + (bpm - 100) / 100; // 0.4-0.6 for moderate
  } else if (bpm < 140) {
    energy = 0.6 + (bpm - 120) / 100; // 0.6-0.8 for upbeat
  } else {
    energy = 0.7 + Math.min(0.3, (bpm - 140) / 200); // 0.7-1.0 for fast
  }
  energy = Math.max(0.0, Math.min(1.0, energy));

  // Valence: 0.0 to 1.0 (higher = more positive/happy)
  const genreStr = genres.join(' ').toLowerCase();
  let valence = 0.5;
  if (genreStr.includes('sad') || genreStr.includes('melancholic')) {
    valence = 0.2;
  } else if (genreStr.includes('romantic') || genreStr.includes('chill')) {
    valence = 0.6;
  } else if (genreStr.includes('happy') || genreStr.includes('party')) {
    valence = 0.8;
  } else if (genreStr.includes('aggressive') || genreStr.includes('metal')) {
    valence = 0.3;
  }

  return { energy, valence };
}

// Get tempo-related keywords based on BPM
function getTempoKeywords(bpm) {
  if (bpm < 70) {
    return ['slow', 'ballad', 'ambient', 'calm', 'peaceful', 'relaxing', 'meditative'];
  } else if (bpm < 90) {
    return ['chill', 'mellow', 'downtempo', 'laid-back', 'smooth', 'easy'];
  } else if (bpm < 110) {
    return ['moderate', 'steady', 'groovy', 'smooth', 'balanced'];
  } else if (bpm < 130) {
    return ['upbeat', 'lively', 'energetic', 'driving', 'pulse'];
  } else if (bpm < 150) {
    return ['fast', 'energetic', 'driving', 'intense', 'powerful', 'dynamic'];
  } else {
    return ['fast', 'intense', 'aggressive', 'high-energy', 'powerful', 'driving'];
  }
}

// Score a track based on how well it matches target criteria (without audio features)
// Since audio-features API is deprecated, we use:
// - 7.5%: Popularity (track quality indicator)
// - 85%: Genre relevance (based on track name/artist matching genres)
// - 7.5%: Tempo relevance (bonus only - not penalized since tempo keywords are inconsistent)
// Returns score from 0.0 to 1.0 (higher = better match)
function scoreTrack(track, targetBpm, targetGenres) {
  let score = 0;

  // Popularity (7.5% weight) - normalized to 0-1
  const popularityScore = track.popularity / 100;
  score += popularityScore * 0.075;

  // Genre relevance (85% weight) - check if track/artist name contains genre keywords
  const trackText = `${track.name} ${track.artists.map(a => a.name).join(' ')}`.toLowerCase();
  const genreKeywords = targetGenres.map(g => g.toLowerCase());
  
  let genreMatches = 0;
  for (const keyword of genreKeywords) {
    if (trackText.includes(keyword)) {
      genreMatches++;
    }
  }
  
  // Score based on how many genres match
  const genreScore = Math.min(1, genreMatches / Math.max(1, genreKeywords.length));
  score += genreScore * 0.85;

  // Tempo relevance (5% weight) - small bonus only, no penalty
  // Since tempo keywords in track names are inconsistent, we only give a small bonus
  // if they match, but don't penalize if they don't
  const tempoKeywords = getTempoKeywords(targetBpm);
  let tempoBonus = 0;
  
  // Check for tempo keywords in track name
  for (const keyword of tempoKeywords.slice(0, 3)) { // Only check first 3 keywords
    if (trackText.includes(keyword)) {
      tempoBonus = 0.5; // Small bonus
      break;
    }
  }
  
  // Also check for BPM numbers in track names (e.g., "120 BPM", "140bpm")
  // This is more reliable than keywords
  const bpmRounded = Math.round(targetBpm / 10) * 10; // Round to nearest 10
  const bpmPattern = new RegExp(`\\b(${bpmRounded}|${targetBpm})\\s*(bpm|b\\.p\\.m\\.)?`, 'i');
  if (bpmPattern.test(trackText)) {
    tempoBonus = 1.0; // Strong bonus if actual BPM number is in name
  }
  
  score += tempoBonus * 0.075; // 7.5% weight, and only as a bonus

  return score;
}

// Improved search using multiple genres and audio features
async function searchSpotifyTracksWithGenreFilter(genres, bpm) {
  try {
    const token = await getSpotifyToken();

    // Map to valid Spotify genres
    const validGenres = mapToSpotifyGenres(genres);
    
    if (validGenres.length === 0) {
      console.warn('No valid genres found');
      return null;
    }

    // Try multiple search strategies with different genre combinations
    // Randomly select which genre combinations to try for variety
    const searchStrategies = [];
    
    // Build all possible genre combinations
    const possibleStrategies = [];
    
    // Single genre (always include)
    possibleStrategies.push({ 
      query: `genre:${validGenres[0]}`, 
      name: `single genre: ${validGenres[0]}`,
      priority: 'high',
      genreCount: 1
    });
    
    // Dual genre (if we have 2+ genres)
    if (validGenres.length >= 2) {
      possibleStrategies.push({ 
        query: `genre:${validGenres[0]} genre:${validGenres[1]}`, 
        name: `dual genre: ${validGenres[0]} + ${validGenres[1]}`,
        priority: 'high',
        genreCount: 2
      });
    }
    
    // Triple genre (if we have 3+ genres)
    if (validGenres.length >= 3) {
      possibleStrategies.push({ 
        query: validGenres.slice(0, 3).map(g => `genre:${g}`).join(' '), 
        name: `triple genre: ${validGenres.slice(0, 3).join(' + ')}`,
        priority: 'high',
        genreCount: 3
      });
    }
    
    // Randomly select which strategies to use (occasionally use 1, 2, or 3 genres)
    // Always include at least one strategy, but vary which ones
    const random = Math.random();
    
    if (random < 0.4) {
      // 40% chance: Use all available strategies (most comprehensive)
      searchStrategies.push(...possibleStrategies);
    } else if (random < 0.7) {
      // 30% chance: Use 2 strategies (mix of single + multi-genre)
      if (possibleStrategies.length >= 2) {
        // Include single genre + one multi-genre
        searchStrategies.push(possibleStrategies[0]); // Single
        const multiGenre = possibleStrategies.filter(s => s.genreCount > 1);
        if (multiGenre.length > 0) {
          searchStrategies.push(multiGenre[Math.floor(Math.random() * multiGenre.length)]);
        }
      } else {
        searchStrategies.push(...possibleStrategies);
      }
    } else {
      // 30% chance: Use 1 strategy (randomly pick single, dual, or triple)
      const selected = possibleStrategies[Math.floor(Math.random() * possibleStrategies.length)];
      searchStrategies.push(selected);
    }
    
    // Shuffle the selected strategies for variety
    for (let i = searchStrategies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [searchStrategies[i], searchStrategies[j]] = [searchStrategies[j], searchStrategies[i]];
    }
    
    // Strategy 4: Try with tempo keywords (less reliable, but worth trying)
    // Only add tempo keywords to every 3rd search to avoid over-reliance
    const tempoKeywords = getTempoKeywords(bpm);
    const primaryTempoKeyword = tempoKeywords[0];
    
    // Add tempo-enhanced searches as additional options (not primary)
    if (validGenres.length >= 1) {
      searchStrategies.push({ 
        query: `genre:${validGenres[0]} ${primaryTempoKeyword}`, 
        name: `single genre + tempo: ${validGenres[0]} ${primaryTempoKeyword}`,
        priority: 'low' // Lower priority since tempo keywords are inconsistent
      });
    }
    
    if (validGenres.length >= 2) {
      searchStrategies.push({ 
        query: `genre:${validGenres[0]} genre:${validGenres[1]} ${primaryTempoKeyword}`, 
        name: `dual genre + tempo: ${validGenres[0]} + ${validGenres[1]} ${primaryTempoKeyword}`,
        priority: 'low'
      });
    }

    let allTracks = [];
    let allTrackIds = [];

    // Try each search strategy, prioritizing genre-only searches
    // Process high-priority (genre-only) searches first, then tempo-enhanced ones
    const highPriorityStrategies = searchStrategies.filter(s => !s.priority || s.priority !== 'low');
    const lowPriorityStrategies = searchStrategies.filter(s => s.priority === 'low');
    
    const strategiesToTry = [...highPriorityStrategies, ...lowPriorityStrategies];
    
    for (const strategy of strategiesToTry) {
      console.log(`Trying search strategy: ${strategy.name}`);
      
      const searchParams = new URLSearchParams({
        q: strategy.query,
        type: 'track',
        limit: '50'
      });

      const searchRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const tracks = searchData.tracks?.items || [];
        
        // Deduplicate tracks by ID
        for (const track of tracks) {
          if (!allTrackIds.includes(track.id)) {
            allTracks.push(track);
            allTrackIds.push(track.id);
          }
        }
        
        console.log(`Found ${tracks.length} tracks with ${strategy.name}, total unique: ${allTracks.length}`);
        
        // Continue trying all high-priority strategies to get diverse results
        // Only stop early if we have a very large pool (100+ tracks)
        // This ensures we try multi-genre searches even if single genre finds enough
        if (allTracks.length >= 100) break; // Hard limit
      }
    }

    if (allTracks.length === 0) {
      console.warn('No tracks found from genre-filtered search.');
      return null;
    }

    console.log(`Total unique tracks found: ${allTracks.length}`);

    // Filter by popularity range first
    let currentMin = popularityMin;
    let currentMax = popularityMax;
    let filteredTracks = allTracks.filter(t => t.popularity >= currentMin && t.popularity <= currentMax);
    
    // Fallback: expand range if no tracks found
    while (filteredTracks.length === 0 && (currentMin > 0 || currentMax < 100)) {
      currentMin = Math.max(0, currentMin - 10);
      currentMax = Math.min(100, currentMax + 10);
      filteredTracks = allTracks.filter(t => t.popularity >= currentMin && t.popularity <= currentMax);
      console.log(`No tracks in range ${currentMin + 10}-${currentMax - 10}, expanding to ${currentMin}-${currentMax}`);
    }
    
    if (filteredTracks.length === 0) {
      console.log(`No tracks found in any popularity range, using all tracks`);
      filteredTracks = allTracks;
    }

    // Score tracks based on popularity and genre relevance (audio features API is deprecated)
    const tracksToScore = filteredTracks
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 50); // Score top 50 tracks

    console.log(`Scoring ${tracksToScore.length} tracks based on popularity and genre match...`);
    
    // Score each track
    const scoredTracks = tracksToScore
      .map(track => {
        const score = scoreTrack(track, bpm, genres);
        return { track, score };
      })
      .filter(item => item.score > 0);

    if (scoredTracks.length > 0) {
      // Sort by score (highest first)
      scoredTracks.sort((a, b) => b.score - a.score);

      // Ensure artist diversity by grouping tracks by artist and selecting from diverse pool
      const artistGroups = new Map();
      scoredTracks.forEach(item => {
        const artistId = item.track.artists[0].id;
        if (!artistGroups.has(artistId)) {
          artistGroups.set(artistId, []);
        }
        artistGroups.get(artistId).push(item);
      });

      // Build a diverse selection pool: take top track from each artist, then fill with remaining top tracks
      const diversePool = [];
      const usedArtists = new Set();
      
      // First pass: take top track from each unique artist (up to 20 artists)
      for (const [artistId, tracks] of artistGroups.entries()) {
        if (diversePool.length >= 20) break;
        if (!usedArtists.has(artistId)) {
          diversePool.push(tracks[0]); // Top track from this artist
          usedArtists.add(artistId);
        }
      }
      
      // Second pass: add remaining top-scored tracks (even if same artist) to fill pool to 30
      for (const item of scoredTracks) {
        if (diversePool.length >= 30) break;
        if (!diversePool.includes(item)) {
          diversePool.push(item);
        }
      }
      
      // Randomly select from the diverse pool
      const selected = diversePool[Math.floor(Math.random() * diversePool.length)];

      const selectedTrack = selected.track;
      
      console.log(`Selected track: "${selectedTrack.name}" by ${selectedTrack.artists[0].name} (score: ${selected.score.toFixed(3)}, popularity: ${selectedTrack.popularity}, from pool of ${diversePool.length} diverse tracks)`);
      
      return selectedTrack;
    }

    // Fallback: Use popularity-based selection
    const popularTracks = filteredTracks
      .sort((a, b) => b.popularity - a.popularity);
    
    const randomIndex = Math.floor(Math.random() * Math.min(20, popularTracks.length));
    const selectedTrack = popularTracks[randomIndex];
    
    console.log(`Selected track (popularity fallback): "${selectedTrack.name}" by ${selectedTrack.artists[0].name} (popularity: ${selectedTrack.popularity})`);
    
    return selectedTrack;

  } catch (e) {
    console.error('Error searching Spotify with genre filter:', e);
    return null;
  }
}

// Fallback: Search for tracks using genre-based search with text query (works when genre filters fail)
async function searchSpotifyTracks(genres, bpm) {
  try {
    const token = await getSpotifyToken();

    // Use multiple genres in text search query
    // Only add tempo keywords occasionally (not always) since they're inconsistent
    const seedGenres = mapToSpotifyGenres(genres);
    
    // Build query - try genre-only first, tempo is handled in scoring
    let searchQuery;
    if (seedGenres.length >= 2) {
      // Combine multiple genres in search
      searchQuery = seedGenres.slice(0, 3).join(' ');
    } else {
      searchQuery = seedGenres[0] || genres[0] || 'pop';
    }

    console.log(`Fallback: Searching Spotify with query: "${searchQuery}"`);

    const searchParams = new URLSearchParams({
      q: searchQuery,
      type: 'track',
      limit: '50'
    });

    const searchRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!searchRes.ok) {
      const text = await searchRes.text();
      console.error('Spotify search error:', searchRes.status, text);
      return null;
    }

    const searchData = await searchRes.json();
    const tracks = searchData.tracks?.items || [];

    if (tracks.length === 0) {
      console.warn('No tracks found from search.');
      return null;
    }

    console.log(`Found ${tracks.length} tracks from search`);

    // Score tracks based on popularity and genre relevance
    const tracksToScore = tracks.slice(0, 50);
    if (tracksToScore.length > 0) {
      const scoredTracks = tracksToScore
        .map(track => {
          const score = scoreTrack(track, bpm, genres);
          return { track, score };
        })
        .filter(item => item.score > 0);

        if (scoredTracks.length > 0) {
          scoredTracks.sort((a, b) => b.score - a.score);
          
          // Ensure artist diversity
          const artistGroups = new Map();
          scoredTracks.forEach(item => {
            const artistId = item.track.artists[0].id;
            if (!artistGroups.has(artistId)) {
              artistGroups.set(artistId, []);
            }
            artistGroups.get(artistId).push(item);
          });

          const diversePool = [];
          const usedArtists = new Set();
          
          // Take top track from each unique artist (up to 20 artists)
          for (const [artistId, tracks] of artistGroups.entries()) {
            if (diversePool.length >= 20) break;
            if (!usedArtists.has(artistId)) {
              diversePool.push(tracks[0]);
              usedArtists.add(artistId);
            }
          }
          
          // Add remaining top tracks to fill pool to 30
          for (const item of scoredTracks) {
            if (diversePool.length >= 30) break;
            if (!diversePool.includes(item)) {
              diversePool.push(item);
            }
          }
          
          const selected = diversePool[Math.floor(Math.random() * diversePool.length)];
          console.log(`Selected track: "${selected.track.name}" by ${selected.track.artists[0].name} (score: ${selected.score.toFixed(3)}, from ${diversePool.length} diverse tracks)`);
          return selected.track;
        }
    }

    // Fallback to popularity-based selection
    let currentMin = popularityMin;
    let currentMax = popularityMax;
    let filteredTracks = tracks.filter(t => t.popularity >= currentMin && t.popularity <= currentMax);
    
    while (filteredTracks.length === 0 && (currentMin > 0 || currentMax < 100)) {
      currentMin = Math.max(0, currentMin - 10);
      currentMax = Math.min(100, currentMax + 10);
      filteredTracks = tracks.filter(t => t.popularity >= currentMin && t.popularity <= currentMax);
    }
    
    if (filteredTracks.length === 0) {
      filteredTracks = tracks;
    }
    
    const popularTracks = filteredTracks
      .sort((a, b) => b.popularity - a.popularity);

    // Ensure artist diversity in fallback selection
    const artistGroups = new Map();
    popularTracks.forEach(track => {
      const artistId = track.artists[0].id;
      if (!artistGroups.has(artistId)) {
        artistGroups.set(artistId, []);
      }
      artistGroups.get(artistId).push(track);
    });

    const diversePool = [];
    const usedArtists = new Set();
    
    // Take top track from each unique artist (up to 20 artists)
    for (const [artistId, artistTracks] of artistGroups.entries()) {
      if (diversePool.length >= 20) break;
      if (!usedArtists.has(artistId)) {
        diversePool.push(artistTracks[0]); // Top track from this artist
        usedArtists.add(artistId);
      }
    }
    
    // Add remaining top tracks to fill pool
    for (const track of popularTracks) {
      if (diversePool.length >= 30) break;
      if (!diversePool.includes(track)) {
        diversePool.push(track);
      }
    }

    const randomIndex = Math.floor(Math.random() * diversePool.length);
    const selectedTrack = diversePool[randomIndex];

    if (!selectedTrack) {
      console.warn('No track selected');
      return null;
    }

    console.log(`Selected track: "${selectedTrack.name}" by ${selectedTrack.artists[0].name} (popularity: ${selectedTrack.popularity}, from ${diversePool.length} diverse tracks)`);
    return selectedTrack;

  } catch (e) {
    console.error('Error searching Spotify:', e);
    return null;
  }
}

// Search using genre-themed playlists as a fallback
async function searchFromGenrePlaylists(genres, bpm) {
  try {
    const token = await getSpotifyToken();

    // Use multiple genres in playlist search
    // Use tempo keywords sparingly - only for mood-based genres
    const validGenres = mapToSpotifyGenres(genres);
    const genreQuery = validGenres.slice(0, 2).join(' ');
    
    // Only add tempo keywords if we have mood-based genres (chill, upbeat, etc.)
    // For concrete genres (pop, rock), tempo keywords are less useful
    const hasMoodGenre = validGenres.some(g => ['chill', 'happy', 'sad', 'party'].includes(g));
    let playlistQuery = genreQuery;
    
    if (hasMoodGenre) {
      // If we already have mood genres, don't add tempo keywords
      playlistQuery = genreQuery;
    } else {
      // For concrete genres, occasionally add tempo keywords
      const tempoKeywords = getTempoKeywords(bpm);
      const primaryTempoKeyword = tempoKeywords[0];
      playlistQuery = `${genreQuery} ${primaryTempoKeyword}`;
    }

    console.log(`Searching playlists with query: "${playlistQuery}"`);

    const searchParams = new URLSearchParams({
      q: playlistQuery,
      type: 'playlist',
      limit: '10'
    });

    const playlistRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!playlistRes.ok) return null;

    const playlistData = await playlistRes.json();
    const playlists = playlistData.playlists?.items || [];

    if (playlists.length === 0) return null;

    const randomPlaylist = playlists[Math.floor(Math.random() * playlists.length)];

    console.log(`Getting tracks from playlist: "${randomPlaylist.name}"`);

    const tracksRes = await fetch(`https://api.spotify.com/v1/playlists/${randomPlaylist.id}/tracks?limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!tracksRes.ok) return null;

    const tracksData = await tracksRes.json();
    const tracks = tracksData.items
      .filter(item => item.track && item.track.id)
      .map(item => item.track);

    if (tracks.length === 0) return null;

    // Score tracks based on popularity and genre relevance
    const tracksToScore = tracks.slice(0, 50);
    if (tracksToScore.length > 0) {
      const scoredTracks = tracksToScore
        .map(track => {
          const score = scoreTrack(track, bpm, genres);
          return { track, score };
        })
        .filter(item => item.score > 0);

      if (scoredTracks.length > 0) {
        scoredTracks.sort((a, b) => b.score - a.score);
        
        // Ensure artist diversity
        const artistGroups = new Map();
        scoredTracks.forEach(item => {
          const artistId = item.track.artists[0].id;
          if (!artistGroups.has(artistId)) {
            artistGroups.set(artistId, []);
          }
          artistGroups.get(artistId).push(item);
        });

        const diversePool = [];
        const usedArtists = new Set();
        
        // Take top track from each unique artist (up to 15 artists)
        for (const [artistId, tracks] of artistGroups.entries()) {
          if (diversePool.length >= 15) break;
          if (!usedArtists.has(artistId)) {
            diversePool.push(tracks[0]);
            usedArtists.add(artistId);
          }
        }
        
        // Add remaining top tracks to fill pool to 20
        for (const item of scoredTracks) {
          if (diversePool.length >= 20) break;
          if (!diversePool.includes(item)) {
            diversePool.push(item);
          }
        }
        
        const selected = diversePool[Math.floor(Math.random() * diversePool.length)];
        console.log(`Found scored track from playlist "${randomPlaylist.name}": "${selected.track.name}" (score: ${selected.score.toFixed(3)}, from ${diversePool.length} diverse tracks)`);
        return selected.track;
      }
    }

    // Fallback to random selection with artist diversity
    // Group tracks by artist and select from diverse pool
    const artistGroups = new Map();
    tracks.forEach(track => {
      const artistId = track.artists[0].id;
      if (!artistGroups.has(artistId)) {
        artistGroups.set(artistId, []);
      }
      artistGroups.get(artistId).push(track);
    });

    const diversePool = [];
    const usedArtists = new Set();
    
    // Take one random track from each unique artist
    for (const [artistId, artistTracks] of artistGroups.entries()) {
      if (diversePool.length >= 20) break;
      if (!usedArtists.has(artistId)) {
        const randomTrack = artistTracks[Math.floor(Math.random() * artistTracks.length)];
        diversePool.push(randomTrack);
        usedArtists.add(artistId);
      }
    }
    
    // If we still need more, add random tracks
    while (diversePool.length < 20 && diversePool.length < tracks.length) {
      const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];
      if (!diversePool.includes(randomTrack)) {
        diversePool.push(randomTrack);
      }
    }
    
    const randomTrack = diversePool[Math.floor(Math.random() * diversePool.length)];

    console.log(`Found track from playlist "${randomPlaylist.name}": "${randomTrack.name}" (from ${diversePool.length} diverse tracks)`);
    return randomTrack;

  } catch (e) {
    console.error('Error searching playlists:', e);
    return null;
  }
}

// Decide recommendation using improved strategies: genre-filtered search → multi-genre search → playlist → simple fallback
async function getRecommendedTrack(genres, bpm) {
  // Strategy 1: Genre-filtered search (most accurate with current API)
  console.log('Trying genre-filtered search...');
  let track = await searchSpotifyTracksWithGenreFilter(genres, bpm);
  if (track) {
    return track;
  }

  // Strategy 2: Multi-genre search with combined query
  console.log('Trying multi-genre search...');
  track = await searchSpotifyTracks(genres, bpm);
  if (track) {
    return track;
  }

  // Strategy 3: Try playlist-based search
  console.log('Trying playlist-based search...');
  track = await searchFromGenrePlaylists(genres, bpm);
  if (track) {
    return track;
  }

  // Strategy 4: Simple fallback search
  console.log('Falling back to simple search...');
  const seedGenres = mapToSpotifyGenres(genres);
  const fallbackQuery = seedGenres[0] || genres[0] || 'pop';

  const token = await getSpotifyToken();
  const searchParams = new URLSearchParams({
    q: fallbackQuery,
    type: 'track',
    limit: '20'
  });

  const searchRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!searchRes.ok) {
    return null;
  }

  const searchData = await searchRes.json();
  const tracks = searchData.tracks?.items || [];

  if (tracks.length === 0) {
    return null;
  }

  return tracks[Math.floor(Math.random() * tracks.length)];
}

// Split long text into chunks for multi-pass summarizing
function chunkText(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// Generate a summary using shared on-device Summarizer
async function generateSummary(text, fullTextMode, onProgress) {
  try {
    const summarizer = await getSharedSummarizer();
    
    if (!summarizer) {
      showSummary("This feature requires Chrome's on-device AI model (Gemini Nano). Please upgrade to a new version of Chrome.");
      return 'Error: Summarizer not available';
    }

    if (fullTextMode && text.length > MAX_MODEL_CHARS) {
      const chunks = chunkText(text, MAX_MODEL_CHARS);
      console.log(`Processing ${chunks.length} chunks in full text mode`);

      const summaries = [];
      for (let i = 0; i < chunks.length; i++) {
        if (onProgress) {
          onProgress(Math.round(((i + 1) / chunks.length) * 50));
        }
        showSummary(`Processing chunk ${i + 1} of ${chunks.length}...`);
        const chunkSummary = await summarizer.summarize(chunks[i]);
        summaries.push(chunkSummary);
      }

      const combinedSummary = summaries.join('\n\n');

      if (combinedSummary.length > MAX_MODEL_CHARS) {
        showSummary('Creating final summary...');
        if (onProgress) onProgress(50);
        const finalSummary = await summarizer.summarize(combinedSummary.slice(0, MAX_MODEL_CHARS));
        return finalSummary;
      }

      if (onProgress) onProgress(50);
      return combinedSummary;
    } else {
      text = text.slice(0, MAX_MODEL_CHARS);
      const finalSummary = await summarizer.summarize(text);
      if (onProgress) onProgress(50);
      return finalSummary;
    }

  } catch (e) {
    console.error('Summary generation failed', e);
    return 'Error: ' + e.message;
  }
}

// Analyze the summary text to extract genres + BPM recommendation
async function analyzeMusicGenre(summaryText) {
  try {
    const summarizer = await getSharedSummarizer();
    
    if (!summarizer) {
      console.warn('Summarizer not available for genre analysis.');
      return {
        bpm: 100,
        genres: ['ambient', 'electronic']
      };
    }

    const prompt = `Analyze this text and suggest MUSIC GENRES and tempo that would match its mood and energy.

IMPORTANT: Use ONLY real music genres like:
- Moods: ambient, chill, sad, happy, party, romantic, aggressive
- Styles: pop, rock, indie, electronic, hip-hop, jazz, classical, folk, country, r-n-b, soul, blues, reggae, metal
- Sub-genres: lo-fi, synthwave, trap, techno, house, disco, punk, grunge

DO NOT use content genres like "thriller", "drama", "documentary", "historical".

Output ONLY in this exact format:
bpm: 120
genres: ["genre1", "genre2", "genre3"]

Rules:
- Use 2-3 MUSIC genres that match the content's mood/energy
- BPM: 60-90 (slow/sad), 90-120 (medium/neutral), 120-180 (fast/energetic)
- Genres must be lowercase, no spaces (use hyphens: "hip-hop", "r-n-b")

Text to analyze:
"""${summaryText}"""`;

    const reply = await summarizer.summarize(prompt);
    console.log('Music analysis reply:\n', reply);

    let genres = [];
    let bpm = 100;

    try {
      const clean = reply.replace(/\*/g, '').trim();

      const genresMatch = clean.match(/genres:\s*\[([^\]]+)\]/i);
      if (genresMatch) {
        const genresStr = genresMatch[1];
        genres = genresStr
          .split(',')
          .map(g => g.trim().replace(/['"]/g, '').toLowerCase())
          .filter(g => g.length > 0);
      }

      const bpmMatch = clean.match(/bpm:\s*(\d+)/i);
      if (bpmMatch) {
        bpm = parseInt(bpmMatch[1], 10);
        bpm = Math.max(60, Math.min(180, bpm));
      }

    } catch (e) {
      console.error('Error parsing music analysis:', e);
    }

    if (!Array.isArray(genres) || genres.length === 0) {
      genres = ['ambient', 'electronic'];
    }

    genres = [...new Set(genres)].slice(0, 3);

    const result = { genres, bpm };
    console.log('Parsed music analysis:', result);
    return result;

  } catch (e) {
    console.error('Music analysis failed:', e);
    return {
      bpm: 100,
      genres: ['ambient', 'electronic']
    };
  }
}

// Settings panel toggle (expands from Dynamic Island)
const settingsButton = document.querySelector('#settingsButton');
const settingsPanel = document.querySelector('#settingsPanel');
const dynamicIsland = document.querySelector('#dynamicIsland');

if (settingsButton && settingsPanel) {
  settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = settingsPanel.hasAttribute('hidden');
    if (isHidden) {
      settingsPanel.removeAttribute('hidden');
      dynamicIsland?.classList.add('settings-open');
    } else {
      settingsPanel.setAttribute('hidden', '');
      dynamicIsland?.classList.remove('settings-open');
    }
  });
}

// Close settings when clicking outside
document.addEventListener('click', (e) => {
  if (settingsPanel && !settingsPanel.hasAttribute('hidden') && 
      !dynamicIsland?.contains(e.target)) {
    settingsPanel.setAttribute('hidden', '');
    dynamicIsland?.classList.remove('settings-open');
  }
});

// Apply selected color theme across UI elements
const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;
const savedTheme = localStorage.getItem('themeMode') || 'light';
root.classList.add(`theme-${savedTheme}`);

if (themeToggle) {
  themeToggle.textContent = savedTheme === 'dark' ? '🌚 Dark Mode' : '🌞 Light Mode';
  themeToggle.addEventListener('click', () => {
    const current = root.classList.contains('theme-dark') ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    root.classList.remove(`theme-${current}`);
    root.classList.add(`theme-${next}`);
    localStorage.setItem('themeMode', next);
    themeToggle.textContent = next === 'dark' ? '🌚 Dark Mode' : '🌞 Light Mode';
  });
}

// Set character limit UI and sync with localStorage
const charLimitInput = document.querySelector('#charLimit');
const charLimitValue = document.querySelector('#charLimitValue');
const savedCharLimit = localStorage.getItem('charLimit') || '10000';
charLimitInput.value = savedCharLimit;
charLimitValue.textContent = savedCharLimit;
MAX_MODEL_CHARS = parseInt(savedCharLimit, 10);

charLimitInput.addEventListener('input', (e) => {
  const value = e.target.value;
  charLimitValue.textContent = value;
  MAX_MODEL_CHARS = parseInt(value, 10);
  localStorage.setItem('charLimit', value);
  onContentChange();
});

// Full text mode switch handling
const fullTextCheckbox = document.querySelector('#fullTextMode');
const savedFullText = localStorage.getItem('fullTextMode') === 'true';
fullTextCheckbox.checked = savedFullText;

fullTextCheckbox.addEventListener('change', (e) => {
  localStorage.setItem('fullTextMode', e.target.checked);
  onContentChange();
});

// Initialize all settings
const historyLimitInput = document.querySelector('#historyLimit');
const exportHistoryBtn = document.querySelector('#exportHistory');
const clearHistoryBtn = document.querySelector('#clearHistory');
const showScrollbarCheckbox = document.querySelector('#showScrollbar');

// Scrollbar visibility
let showScrollbar = localStorage.getItem('showScrollbar') === 'true';
if (showScrollbarCheckbox) {
  showScrollbarCheckbox.checked = showScrollbar;
  if (showScrollbar) {
    document.documentElement.classList.add('show-scrollbar');
  }
  showScrollbarCheckbox.addEventListener('change', (e) => {
    showScrollbar = e.target.checked;
    localStorage.setItem('showScrollbar', showScrollbar.toString());
    if (showScrollbar) {
      document.documentElement.classList.add('show-scrollbar');
    } else {
      document.documentElement.classList.remove('show-scrollbar');
    }
  });
}

// History Limit
if (historyLimitInput) {
  historyLimitInput.value = maxHistoryLimit;
  historyLimitInput.addEventListener('change', (e) => {
    let value = parseInt(e.target.value, 10);
    if (value <= 3) {
      value = 3;
      historyLimitInput.value = 3;
    } else if (value >= 1000) {
      value = 1000;
      historyLimitInput.value = 1000;
    }
    maxHistoryLimit = value;
    localStorage.setItem('historyLimit', value.toString());
    
    // Trim history if it exceeds new limit
    if (summaryHistory.length > maxHistoryLimit) {
      summaryHistory = summaryHistory.slice(0, maxHistoryLimit);
      localStorage.setItem('summaryHistory', JSON.stringify(summaryHistory));
      renderHistory();
    }
  });
}

// Popularity Range Slider
const popularityMinInput = document.querySelector('#popularityMin');
const popularityMaxInput = document.querySelector('#popularityMax');
const popularityMinValue = document.querySelector('#popularityMinValue');
const popularityMaxValue = document.querySelector('#popularityMaxValue');
const rangeFill = document.querySelector('.range-fill');

function updateRangeSlider() {
  const min = parseInt(popularityMinInput.value, 10);
  const max = parseInt(popularityMaxInput.value, 10);
  
  // Ensure min doesn't exceed max and vice versa
  if (min > max) {
    if (this === popularityMinInput) {
      popularityMinInput.value = max;
    } else {
      popularityMaxInput.value = min;
    }
  }
  
  const minVal = parseInt(popularityMinInput.value, 10);
  const maxVal = parseInt(popularityMaxInput.value, 10);
  
  // Update display values
  popularityMinValue.textContent = minVal;
  popularityMaxValue.textContent = maxVal;
  
  // Update fill bar position
  const percent1 = minVal;
  const percent2 = maxVal;
  rangeFill.style.left = percent1 + '%';
  rangeFill.style.width = (percent2 - percent1) + '%';
  
  // Save to state and localStorage
  popularityMin = minVal;
  popularityMax = maxVal;
  localStorage.setItem('popularityMin', minVal.toString());
  localStorage.setItem('popularityMax', maxVal.toString());
  console.log(`Popularity range updated to: ${popularityMin}-${popularityMax}`);
}

if (popularityMinInput && popularityMaxInput) {
  // Initialize values from state
  popularityMinInput.value = popularityMin;
  popularityMaxInput.value = popularityMax;
  popularityMinValue.textContent = popularityMin;
  popularityMaxValue.textContent = popularityMax;
  
  // Initialize fill bar
  rangeFill.style.left = popularityMin + '%';
  rangeFill.style.width = (popularityMax - popularityMin) + '%';
  
  // Add event listeners
  popularityMinInput.addEventListener('input', updateRangeSlider);
  popularityMaxInput.addEventListener('input', updateRangeSlider);
}

// Export History
if (exportHistoryBtn) {
  exportHistoryBtn.addEventListener('click', () => {
    const dataStr = JSON.stringify(summaryHistory, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tuned-in-history-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
}

// Clear History
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
      summaryHistory = [];
      localStorage.setItem('summaryHistory', JSON.stringify(summaryHistory));
      renderHistory();
    }
  });
}

// Summarize button click → summarize → analyze → recommend
summarizeButton.addEventListener('click', async () => {
    console.log('Summarize button clicked');
  // Always create a process card for every submission
  isAnalyzing = true;

  // Track the page title/URL at click time
  let currentPageTitle, currentPageUrl;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentPageTitle = activeTab.title;
    currentPageUrl = activeTab.url;
  } catch (e) {
    console.error('Error getting page title:', e);
    currentPageTitle = 'Unknown Page';
    currentPageUrl = '#';
  }

  updateWarning('');
  const musicInfoEl = document.querySelector('#musicInfo');
  if (musicInfoEl) musicInfoEl.setAttribute('hidden', '');

  const fullTextMode = fullTextCheckbox.checked;

  // Add a new process item for this request (shows page title, progress, status)
  const processId = window.addProcessCard('recommend', 'Generating Recommendation', currentPageTitle);

  // Always use fresh content for summarization
  let contentToSummarize = null;
  // Always reset Summarizer context before generating a summary
  if (typeof Summarizer !== 'undefined' && Summarizer && typeof Summarizer.reset === 'function') {
    Summarizer.reset();
  }
  if (pageContent && typeof pageContent === 'string' && pageContent.trim().length > 0) {
    contentToSummarize = pageContent;
  } else {
    // Request visible text from content script in active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const scrapedText = await new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTab.id, { type: 'EXTRACT_VISIBLE_TEXT' }, (response) => {
        resolve(response && response.text ? response.text : 'No visible text found on this page.');
      });
    });
    contentToSummarize = scrapedText && scrapedText.trim().length > 0 ? scrapedText : 'No visible text found on this page.';
  }

  // Use true progress for summarization
  let unifiedProgress = 0;
  window.updateProcessCard(processId, { progress: unifiedProgress, status: 'running' });
  let summaryRaw = '';
  const summary = await generateSummary(contentToSummarize, fullTextMode, (progress) => {
    unifiedProgress = progress;
    window.updateProcessCard(processId, { progress: unifiedProgress, status: 'running' });
  });
  summaryRaw = summary;
  unifiedProgress = 50;
  window.updateProcessCard(processId, { progress: unifiedProgress, status: 'running' });

  if (summary.startsWith('Error:')) {
    window.updateProcessCard(processId, { progress: 100, status: 'error' });
    return;
  }

  // Animate analysis progress from 50 to 100% while analysis is running
  let analysisDone = false;
  let analysisProgress = 50;
  const analysisInterval = setInterval(() => {
    if (!analysisDone) {
      analysisProgress += 2;
      if (analysisProgress > 100) analysisProgress = 100;
      window.updateProcessCard(processId, { progress: analysisProgress, status: 'running' });
    }
  }, 100);

  const analysis = await analyzeMusicGenre(summaryRaw);
  analysisDone = true;
  clearInterval(analysisInterval);
  window.updateProcessCard(processId, {
    progress: 100,
    status: 'done'
  });

  const musicInfo = document.querySelector('#musicInfo');
  const bpmElem = document.querySelector('#musicBpm');
  const genresElem = document.querySelector('#musicGenres');
  const trackInfo = document.querySelector('#trackInfo');
  const trackName = document.querySelector('#trackName');
  const trackArtist = document.querySelector('#trackArtist');
  const albumCover = document.querySelector('#albumCover');
  const albumCoverLink = document.querySelector('#albumCoverLink');
  const spotifyLink = document.querySelector('#spotifyLink');

  if (bpmElem) bpmElem.textContent = analysis.bpm;
  if (genresElem) genresElem.textContent = analysis.genres.join(', ');
  if (albumCover) albumCover.src = '';
  if (albumCoverLink) {
    albumCoverLink.href = '#';
  }
  // Theme is now handled globally via CSS class; no per-element update needed
  if (musicInfo) musicInfo.removeAttribute('hidden');

  showSummary('Searching for a matching track...');

  try {
    const track = await getRecommendedTrack(analysis.genres, analysis.bpm);
    isAnalyzing = false;

    if (track) {
      // Set track name with marquee scrolling (like old car radio)
      const trackNameText = track.name;
      trackName.textContent = '';
      const trackNameSpan = document.createElement('span');
      trackNameSpan.textContent = trackNameText;
      trackNameSpan.className = 'track-name-scroll';
      trackName.appendChild(trackNameSpan);
      
      // Set scroll duration based on text length (longer text = slower scroll)
      const nameDuration = Math.max(8, Math.min(20, trackNameText.length * 0.4));
      trackNameSpan.style.setProperty('--marquee-duration', `${nameDuration}s`);
      
      // Set artist with marquee scrolling
      const artistText = track.artists.map(a => a.name).join(', ');
      trackArtist.textContent = '';
      const artistSpan = document.createElement('span');
      artistSpan.textContent = artistText;
      artistSpan.className = 'track-artist-scroll';
      trackArtist.appendChild(artistSpan);
      
      // Set scroll duration based on text length
      const artistDuration = Math.max(8, Math.min(20, artistText.length * 0.4));
      artistSpan.style.setProperty('--marquee-duration', `${artistDuration}s`);
      
      spotifyLink.href = track.external_urls.spotify;

      if (track.album?.images?.[0]?.url) {
        albumCover.src = track.album.images[0].url;
        albumCover.removeAttribute('hidden');
      }

      if (albumCoverLink) {
        albumCoverLink.href = track.external_urls.spotify;
      }

      trackInfo.removeAttribute('hidden');

      summaryHistory.unshift({
        trackName: track.name,
        trackArtist: track.artists.map(a => a.name).join(', '),
        artistIds: track.artists.map(a => a.id),
        albumArt: track.album?.images?.[0]?.url || '',
        genres: analysis.genres,
        bpm: analysis.bpm,
        trackId: track.id,
        pageUrl: currentPageUrl,
        pageTitle: currentPageTitle
      });

      // Limit history based on user setting
      if (summaryHistory.length > maxHistoryLimit) {
        summaryHistory = summaryHistory.slice(0, maxHistoryLimit);
        localStorage.setItem('summaryHistory', JSON.stringify(summaryHistory));
      }
      localStorage.setItem('summaryHistory', JSON.stringify(summaryHistory));
      renderHistory();

      if (summaryElement) {
        summaryElement.setAttribute('hidden', '');
      }
    } else {
      if (albumCoverLink) {
        albumCoverLink.href = `https://open.spotify.com/search/${encodeURIComponent(analysis.genres.join(' '))}`;
      }
      if (summaryElement) {
        summaryElement.removeAttribute('hidden');
      }
      showSummary("Could not find a matching track");
    }

  } catch (e) {
    isAnalyzing = false;
    console.error('Error fetching track:', e);
    const albumCoverLink = document.querySelector('#albumCoverLink');
    if (albumCoverLink) {
      albumCoverLink.href = '#';
    }
    if (summaryElement) {
      summaryElement.removeAttribute('hidden');
    }
    showSummary("Error fetching track");
  }
});

// Handle whenever content changes (updates warnings + preview)
function onContentChange() {
  if (isAnalyzing) {
    return;
  }

  if (summaryElement) {
    summaryElement.removeAttribute('hidden');
  }

  if (!pageContent) {
    // Try to scrape all visible text if Readability fails
    const fallbackText = getAllVisibleText();
    pageContent = fallbackText;
    showSummary("Music Generation Not Currently Possible (There's nothing to summarize)");
    updateWarning('');
    return;
  }

  const fullTextMode = fullTextCheckbox.checked;

  if (pageContent.length > MAX_MODEL_CHARS) {
    if (fullTextMode) {
      const chunks = Math.ceil(pageContent.length / MAX_MODEL_CHARS);
      updateWarning(
        `⚠️ Full text mode enabled. Text will be processed in ${chunks} chunks (${pageContent.length.toLocaleString()} characters total). This will take longer.`
      );
    } else {
      updateWarning(
        `⚠️ Text is very long (${pageContent.length.toLocaleString()} characters). Only the first ${MAX_MODEL_CHARS.toLocaleString()} characters will be analyzed. Enable "Full Text" to process the entire page (takes longer).`
      );
    }
  } else {
    updateWarning('');
  }

  // Restore old summary wording as an indicator
  showSummary("Music Generation Possible");
}

// ========== INITIALIZATION ==========

// Show skeleton history immediately
showSkeletonHistory();
showSummary("Loading...");

// Trim history on load if it exceeds the limit
if (summaryHistory.length > maxHistoryLimit) {
  summaryHistory = summaryHistory.slice(0, maxHistoryLimit);
  localStorage.setItem('summaryHistory', JSON.stringify(summaryHistory));
}

// Render actual history asynchronously
setTimeout(() => {
  renderHistory().then(() => {
    console.log('History loaded');
  });
}, 0);

// Load page content from chrome.storage.session after initial load
setTimeout(() => {
  chrome.storage.session.get('pageContent', ({ pageContent: storedContent }) => {
    if (storedContent) {
      pageContent = storedContent;
      onContentChange();
      
      // Note: Auto-generate is disabled because Summarizer API requires user activation
      // The setting is kept for future use or if API changes
      // if (autoGenerate && !isAnalyzing && summarizeButton) {
      //   setTimeout(() => {
      //     summarizeButton.click();
      //   }, 500);
      // }
    } else {
      showSummary("Music Generation Not Currently Possible (There's nothing to summarize)");
    }
  });
}, 0);

// Update page content whenever the active tab sends new data
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes['pageContent']) {
    pageContent = changes['pageContent'].newValue;
    onContentChange();
    
    // Note: Auto-generate is disabled because Summarizer API requires user activation
    // if (autoGenerate && !isAnalyzing && summarizeButton && pageContent) {
    //   setTimeout(() => {
    //     summarizeButton.click();
    //   }, 500);
    // }
  }
});