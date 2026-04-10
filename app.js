// Application State
let currentPlaylist = [];
let savedLibrary = JSON.parse(localStorage.getItem('neon_library')) || [];
let currentTrackIndex = -1;
let isPlaying = false;
let isLibraryView = false;
let isShuffle = false;
let isLoop = false;

// ----- IndexedDB for Offline Blob Storage -----
const DB_NAME = 'NeonMusicOffline';
const STORE_NAME = 'downloads';
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e);
    });
}

function saveOffline(track, blob) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const { audioBlob, ...safeTrack } = track; // Avoid nesting
        const request = store.put({ ...safeTrack, audioBlob: blob });
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

function getOfflineTracks() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e);
    });
}

function deleteOffline(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e);
    });
}

// DOM Elements
const searchInput = document.getElementById('search-input');
const loader = document.getElementById('loader');
const resultsGrid = document.getElementById('results-grid');
const viewTitle = document.getElementById('view-title');
const libToggleBtn = document.getElementById('library-toggle');

const audio = document.getElementById('audio-player');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const loopBtn = document.getElementById('loop-btn');

const coverArt = document.getElementById('cover-art');
const trackName = document.getElementById('track-name');
const trackArtist = document.getElementById('track-artist');
const saveBtn = document.getElementById('save-btn');
const downloadBtn = document.getElementById('download-btn');

const seekBar = document.getElementById('seek-bar');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const volumeBar = document.getElementById('volume-bar');

// ----- Music API Fetching (Aggressive Multi-Endpoint with ITunes Fallback) -----
async function fetchSongs(query) {
    loader.classList.remove('hidden');
    resultsGrid.innerHTML = '';
    
    // Top 3 most reliable public open-source JioSaavn instances
    const apis = [
        `https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodeURIComponent(query)}`,
        `https://saavn.me/search/songs?query=${encodeURIComponent(query)}`,
        `https://saavn.dev/api/search/songs?query=${encodeURIComponent(query)}`
    ];

    let success = false;

    for (const apiUrl of apis) {
        try {
            const res = await fetch(apiUrl);
            const data = await res.json();
            
            // Differing structures between saavn API v4 vs v3
            const results = data.data?.results || data.results || data.data || [];
            
            if (results && results.length > 0) {
                const tracks = results.map(t => ({
                    id: t.id,
                    title: t.name || t.title,
                    artist: t.primaryArtists || t.singers || t.artists?.primary?.[0]?.name || "Unknown Artist",
                    image: t.image?.[2]?.link || t.image?.[2]?.url || t.image?.[1]?.url || t.image?.[0]?.link || "https://via.placeholder.com/300",
                    url: t.downloadUrl?.find(d => d.quality === '320kbps')?.link || 
                         t.downloadUrl?.find(d => d.quality === '160kbps')?.link ||
                         t.downloadUrl?.[4]?.link || t.downloadUrl?.[4]?.url || 
                         t.downloadUrl?.[0]?.link || t.downloadUrl?.[0]?.url
                })).filter(t => t.url);
                
                if (tracks.length > 0) {
                    currentPlaylist = tracks;
                    renderGrid(tracks);
                    success = true;
                    loader.classList.add('hidden');
                    return; // Super! We found full songs without error.
                }
            }
        } catch (err) {
            console.warn(`Failed to connect to ${apiUrl}, moving to next...`);
            continue; 
        }
    }

    if (!success) {
        console.warn("All Full-Song APIs blocked by CORS. Switching to 30s iTunes preivew.");
        try {
            const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&limit=20`);
            const itunesData = await itunesRes.json();
            
            if (itunesData.results && itunesData.results.length > 0) {
                 const tracks = itunesData.results.map(t => ({
                    id: t.trackId.toString(),
                    title: t.trackName,
                    artist: t.artistName,
                    image: t.artworkUrl100.replace('100x100bb', '300x300bb'),
                    url: t.previewUrl // 30s preview
                 })).filter(t => t.url);
                 
                 currentPlaylist = tracks;
                 renderGrid(tracks);
                 
                 if(!window.warned30s) {
                     alert("NOTE: Opening this file directly (file:///) blocks connections to Full-Song servers. Playing 30-second previews. To get FULL SONGS, please open the folder in VS Code and use 'Live Server'!");
                     window.warned30s = true;
                 }
            } else {
                 resultsGrid.innerHTML = '<p style="color:var(--text-muted)">No results found for your search.</p>';
            }
        } catch (fallbackErr) {
             resultsGrid.innerHTML = '<p style="color:var(--text-muted)">Critical Error fetching API.</p>';
        }
    }
    loader.classList.add('hidden');
}

function renderGrid(tracks) {
    resultsGrid.innerHTML = '';
    tracks.forEach((track, idx) => {
        const card = document.createElement('div');
        card.className = 'song-card';
        card.innerHTML = `
            <img src="${track.image}" alt="cover">
            <h3>${track.title}</h3>
            <p>${track.artist}</p>
            <div class="play-overlay"><i class="fa-solid fa-play"></i></div>
            ${track.audioBlob ? '<div style="position:absolute; top:8px; right:8px; color:var(--theme-color);"><i class="fa-solid fa-circle-check"></i></div>' : ''}
        `;
        card.addEventListener('click', () => {
            currentTrackIndex = idx;
            loadTrack(track);
            playTrack();
        });
        resultsGrid.appendChild(card);
    });
}

// ----- Player Control Logic -----
async function loadTrack(track) {
    // 1. Check Offline status first!
    const offlineTracks = await getOfflineTracks();
    const offlineItem = offlineTracks.find(t => t.id === track.id);
    
    if (offlineItem && offlineItem.audioBlob) {
        // PLAYING LOCALLY OFFLINE!
        audio.src = URL.createObjectURL(offlineItem.audioBlob);
        
        downloadBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        downloadBtn.classList.add('active');
        trackName.innerHTML = `${track.title} <i class="fa-solid fa-circle-arrow-down" style="color:var(--theme-color); font-size:10px; margin-left:4px;" title="Offline Mode"></i>`;
    } else {
        // STREAMING
        audio.src = track.url;
        
        downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
        downloadBtn.classList.remove('active');
        trackName.textContent = track.title;
    }
    
    coverArt.src = track.image;
    trackArtist.textContent = track.artist;
    
    // Check if this song is saved in library
    if(savedLibrary.find(t => t.id === track.id)) {
        saveBtn.classList.add('active');
        saveBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    } else {
        saveBtn.classList.remove('active');
        saveBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
    
    // Hardware Media Keys
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            artwork: [{ src: track.image, sizes: '500x500', type: 'image/jpeg' }]
        });
        navigator.mediaSession.setActionHandler('play', playTrack);
        navigator.mediaSession.setActionHandler('pause', pauseTrack);
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }
}

function playTrack() {
    audio.play();
    isPlaying = true;
    playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
}

function pauseTrack() {
    audio.pause();
    isPlaying = false;
    playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
}

function playNext() {
    if (currentPlaylist.length === 0) return;
    let nextIdx = currentTrackIndex + 1;
    if(isShuffle) {
        nextIdx = Math.floor(Math.random() * currentPlaylist.length);
    } else if (nextIdx >= currentPlaylist.length) {
        nextIdx = 0; // loop back to start
    }
    currentTrackIndex = nextIdx;
    loadTrack(currentPlaylist[currentTrackIndex]);
    playTrack();
}

function playPrev() {
    if (currentPlaylist.length === 0) return;
    let prevIdx = currentTrackIndex - 1;
    if (prevIdx < 0) prevIdx = currentPlaylist.length - 1;
    currentTrackIndex = prevIdx;
    loadTrack(currentPlaylist[currentTrackIndex]);
    playTrack();
}

// Listeners
playBtn.addEventListener('click', () => {
    if(!audio.src) return;
    isPlaying ? pauseTrack() : playTrack();
});
nextBtn.addEventListener('click', playNext);
prevBtn.addEventListener('click', playPrev);
audio.addEventListener('ended', playNext); // Auto next

shuffleBtn.addEventListener('click', () => {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle('active', isShuffle);
});

loopBtn.addEventListener('click', () => {
    isLoop = !isLoop;
    loopBtn.classList.toggle('active', isLoop);
    audio.loop = isLoop;
});

// Update Progress Bar
audio.addEventListener('timeupdate', () => {
    if(!audio.duration || isNaN(audio.duration)) return;
    const current = audio.currentTime;
    const duration = audio.duration;
    
    seekBar.value = (current / duration) * 100;
    currentTimeEl.textContent = formatTime(current);
    totalTimeEl.textContent = formatTime(duration);
});

seekBar.addEventListener('input', (e) => {
    if(!audio.duration) return;
    audio.currentTime = (e.target.value / 100) * audio.duration;
});

volumeBar.addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
});

function formatTime(s) {
    if(isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

// ----- LocalStorage Library Saving -----
saveBtn.addEventListener('click', () => {
    if(!audio.src) return;
    const track = currentPlaylist[currentTrackIndex];
    if(!track) return;
    
    const existsIdx = savedLibrary.findIndex(t => t.id === track.id);
    if(existsIdx > -1) {
        savedLibrary.splice(existsIdx, 1);
        saveBtn.classList.remove('active');
        saveBtn.innerHTML = '<i class="fa-regular fa-heart"></i>';
    } else {
        savedLibrary.push(track);
        saveBtn.classList.add('active');
        saveBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
    }
    
    localStorage.setItem('neon_library', JSON.stringify(savedLibrary));
    
    if(isLibraryView) {
        libToggleBtn.click(); libToggleBtn.click(); // Hacky layout refresh
    }
});

// Toggle between Main Search and Library
libToggleBtn.addEventListener('click', async () => {
    isLibraryView = !isLibraryView;
    if(isLibraryView) {
        libToggleBtn.innerHTML = '<i class="fa-solid fa-music"></i> Discover';
        viewTitle.textContent = 'My Saved Library & Offline Playback';
        
        // Merge Saved Library (Online) + Downloaded Blobs (Offline)
        const offlineTracks = await getOfflineTracks();
        const map = new Map();
        
        savedLibrary.forEach(t => map.set(t.id, t));
        offlineTracks.forEach(t => map.set(t.id, { ...t, isDownloaded: true })); // Overwrites with blob info
        
        currentPlaylist = Array.from(map.values());
        
        if(currentPlaylist.length === 0) resultsGrid.innerHTML = '<p style="color:var(--text-muted)">Your library is empty. Save or Download some songs!</p>';
        else renderGrid(currentPlaylist);
    } else {
        libToggleBtn.innerHTML = '<i class="fa-solid fa-layer-group"></i> My Library';
        viewTitle.textContent = `Discover Music`;
        if (navigator.onLine) {
            fetchSongs('trending hindi songs');
        } else {
            resultsGrid.innerHTML = '<p style="color:var(--text-muted)">You are Offline. Switch to "My Library" to play downloaded songs.</p>';
        }
    }
});

// Search functionality with debounce
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value;
    if(q.trim().length > 0) {
        if(isLibraryView) libToggleBtn.click(); // switch to discover mode
        if (!navigator.onLine) {
            alert("Search requires an active Wi-Fi connection!");
            return;
        }
        viewTitle.textContent = `Search results for "${q}"`;
        searchTimeout = setTimeout(() => fetchSongs(q), 700);
    }
});

// ----- In-App Offline Blob Download System -----
downloadBtn.addEventListener('click', async () => {
    if(!audio.src) return;
    const track = currentPlaylist[currentTrackIndex];
    if(!track) return;
    
    try {
        // Check if already downloaded
        const offlineTracks = await getOfflineTracks();
        const isDownloaded = offlineTracks.some(t => t.id === track.id);
        
        if (isDownloaded) {
            if(confirm("This song is already saved offline. Do you want to remove it?")) {
                await deleteOffline(track.id);
                downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
                downloadBtn.classList.remove('active');
                
                trackName.textContent = track.title; // Remove offline icon
                alert("Track removed from offline storage.");
                
                if (isLibraryView) {
                    libToggleBtn.click(); libToggleBtn.click(); // Refresh list
                }
            }
            return;
        }
        
        if (!navigator.onLine) {
            alert("You need Wi-Fi active to download this song initially!");
            return;
        }
        
        downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        
        // Fetch the mp3 data to create a local blob
        const response = await fetch(track.url);
        const blob = await response.blob();
        
        // Save into IndexedDB!
        await saveOffline(track, blob);
        
        downloadBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        downloadBtn.classList.add('active');
        
        alert(`Awesome! "${track.title}" is now successfully saved inside the App!\nYou can safely play it from "My Library" even when your Wi-Fi is completely off.`);
    } catch (err) {
        console.error("Offline Save failed:", err);
        alert("Failed to Cache the Audio. If opening locally, strict browser security prevented the save. Use Live Server.");
    } finally {
        if (!downloadBtn.classList.contains('active')) {
            downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i>';
        }
    }
});

// Boot Application
window.addEventListener('load', async () => {
    // Service Worker Registration for PWA installability
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('sw.js');
        } catch (err) {
            console.warn('ServiceWorker registration failed:', err);
        }
    }

    audio.volume = 1;
    
    // Initialize Offline DB
    await initDB();
    
    if (navigator.onLine) {
        fetchSongs('trending hindi songs'); // Initial load
    } else {
        viewTitle.textContent = "Offline Mode Active";
        resultsGrid.innerHTML = '<p style="color:var(--text-muted)">You are currently offline. Please click "My Library" to browse and play your downloaded songs.</p>';
    }
});
