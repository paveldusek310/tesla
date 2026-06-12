/* Tesla YouTube playlist player
 * Pure vanilla JS, ES2017-friendly. Loaded after config.js, before the
 * YouTube IFrame API script in index.html.
 */
'use strict';

var STORAGE_KEY = 'tesla-playlist:v1';
var SAVE_INTERVAL_MS = 5000;
var BUILD_PLAYLIST_RETRY_MS = 400;
var BUILD_PLAYLIST_MAX_TRIES = 25;

var player = null;
var playlistData = [];   // [{videoId, title, thumbnail}]
var currentIndex = -1;
var saveTimer = null;
var buildTries = 0;
var restoredOnce = false;
var pendingResume = null;

function isPlaceholder(s) {
  return !s || typeof s !== 'string' || s.indexOf('PASTE_') === 0;
}

function safeGet(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}

/* ---------- localStorage resume ---------- */

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function saveState() {
  if (!player) return;
  var time = safeGet(function () { return player.getCurrentTime(); }, 0) || 0;
  var idx  = safeGet(function () { return player.getPlaylistIndex(); }, currentIndex);
  var list = safeGet(function () { return player.getPlaylist(); }, null);
  var data = safeGet(function () { return player.getVideoData(); }, null);
  var videoId = (data && data.video_id) || (list && idx >= 0 ? list[idx] : null);
  var state = {
    playlistId: YOUTUBE_PLAYLIST_ID,
    index: (typeof idx === 'number') ? idx : -1,
    videoId: videoId,
    time: time,
    ts: Date.now()
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function startSaveTimer() {
  if (saveTimer) return;
  saveTimer = setInterval(saveState, SAVE_INTERVAL_MS);
}
function stopSaveTimer() {
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
}

/* ---------- YouTube IFrame API bootstrap ---------- */

// Called automatically by the YouTube IFrame API once it has loaded.
window.onYouTubeIframeAPIReady = function () {
  initPlayer();
};

function initPlayer() {
  var vars = {
    autoplay: 0,
    controls: 1,
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
    iv_load_policy: 3,
    fs: 0
  };
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: vars,
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

function onPlayerReady() {
  if (isPlaceholder(YOUTUBE_PLAYLIST_ID)) {
    showOverlay('No playlist configured.\nEdit config.js or paste a YouTube link below.');
    return;
  }
  pendingResume = loadState();

  var startIdx = 0;
  var startSecs = 0;
  if (pendingResume && pendingResume.playlistId === YOUTUBE_PLAYLIST_ID) {
    if (typeof pendingResume.index === 'number' && pendingResume.index >= 0) {
      startIdx = pendingResume.index;
    }
    startSecs = Math.max(0, (pendingResume.time || 0) - 2);
  }

  try {
    // cuePlaylist loads the playlist + seeks to position WITHOUT playing,
    // so the passenger only needs one tap on Play to resume.
    player.cuePlaylist({
      listType: 'playlist',
      list: YOUTUBE_PLAYLIST_ID,
      index: startIdx,
      startSeconds: startSecs
    });
    currentIndex = startIdx;
    restoredOnce = true;
  } catch (e) {
    showOverlay('Could not load playlist. Check the playlist ID in config.js.');
    return;
  }

  showOverlay('Tap Play to start');
  setTimeout(tryBuildPlaylist, BUILD_PLAYLIST_RETRY_MS);
}

function onPlayerError(ev) {
  // Common codes: 2 invalid param, 5 HTML5 error, 100 not found, 101/150 not embeddable
  var msg = 'Playback error (code ' + ev.data + ').';
  if (ev.data === 100) msg = 'Video not found or removed.';
  if (ev.data === 101 || ev.data === 150) msg = 'This video does not allow embedding.';
  if (ev.data === 2) msg = 'Invalid video or playlist ID — check config.js.';
  showOverlay(msg);
}

function onPlayerStateChange(ev) {
  // States: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  var btn = document.getElementById('btn-play');
  if (ev.data === YT.PlayerState.PLAYING) {
    setPlayButton(true);
    hideOverlay();
    startSaveTimer();
    syncCurrentIndex();
  } else if (ev.data === YT.PlayerState.PAUSED) {
    setPlayButton(false);
    saveState();
  } else if (ev.data === YT.PlayerState.ENDED) {
    saveState();
    // The IFrame API auto-advances inside a playlist; this is a safety net.
    var idx = safeGet(function () { return player.getPlaylistIndex(); }, currentIndex);
    var list = safeGet(function () { return player.getPlaylist(); }, []);
    if (list && idx >= 0 && idx + 1 < list.length) {
      try { player.nextVideo(); } catch (e) {}
    }
  } else if (ev.data === YT.PlayerState.CUED) {
    setPlayButton(false);
    if (currentIndex < 0) syncCurrentIndex();
  }
}

function setPlayButton(isPlaying) {
  var btn = document.getElementById('btn-play');
  if (!btn) return;
  if (isPlaying) {
    btn.textContent = '❚❚ Pause';
    btn.className = 'btn btn-primary is-playing';
  } else {
    btn.textContent = '▶ Play';
    btn.className = 'btn btn-primary';
  }
}

function syncCurrentIndex() {
  var idx = safeGet(function () { return player.getPlaylistIndex(); }, -1);
  if (typeof idx === 'number' && idx !== currentIndex) {
    currentIndex = idx;
    highlightActive();
  }
}

/* ---------- Playlist sidebar ---------- */

function tryBuildPlaylist() {
  buildTries++;
  var ids = safeGet(function () { return player.getPlaylist(); }, []) || [];
  if (!ids.length) {
    if (buildTries < BUILD_PLAYLIST_MAX_TRIES) {
      setTimeout(tryBuildPlaylist, BUILD_PLAYLIST_RETRY_MS);
    }
    return;
  }
  buildPlaylist(ids);
}

function buildPlaylist(ids) {
  playlistData = ids.map(function (id, i) {
    return {
      videoId: id,
      title: 'Video ' + (i + 1),
      thumbnail: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'
    };
  });
  renderPlaylist();
  updateCount();

  if (!isPlaceholder(YOUTUBE_API_KEY) && ids.length) {
    fetchVideoTitles(ids);
  }
}

function renderPlaylist() {
  var el = document.getElementById('playlist');
  if (!el) return;
  el.innerHTML = '';
  for (var i = 0; i < playlistData.length; i++) {
    el.appendChild(makePlaylistItem(playlistData[i], i));
  }
  highlightActive();
}

function makePlaylistItem(item, i) {
  var li = document.createElement('li');
  li.className = 'pl-item' + (i === currentIndex ? ' active' : '');
  li.setAttribute('data-index', String(i));

  var thumb = document.createElement('div');
  thumb.className = 'pl-thumb';
  thumb.style.backgroundImage = 'url("' + item.thumbnail + '")';

  var text = document.createElement('div');
  text.className = 'pl-text';

  var idxDiv = document.createElement('div');
  idxDiv.className = 'pl-index';
  idxDiv.textContent = (i + 1) + ' of ' + playlistData.length;

  var titleDiv = document.createElement('div');
  titleDiv.className = 'pl-title';
  titleDiv.textContent = item.title;

  text.appendChild(idxDiv);
  text.appendChild(titleDiv);
  li.appendChild(thumb);
  li.appendChild(text);
  li.addEventListener('click', onPlaylistItemClick);
  return li;
}

function onPlaylistItemClick(ev) {
  var li = ev.currentTarget;
  var idx = parseInt(li.getAttribute('data-index'), 10);
  if (isNaN(idx) || !player) return;
  try { player.playVideoAt(idx); } catch (e) {}
}

function highlightActive() {
  var items = document.querySelectorAll('.pl-item');
  for (var i = 0; i < items.length; i++) {
    var isActive = (i === currentIndex);
    items[i].className = 'pl-item' + (isActive ? ' active' : '');
    if (isActive && items[i].scrollIntoView) {
      try { items[i].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  }
}

function updateCount() {
  var c = document.getElementById('playlist-count');
  if (c) c.textContent = playlistData.length ? (playlistData.length + ' videos') : '';
}

/* ---------- Optional: enrich titles via YouTube Data API v3 ---------- */

function fetchVideoTitles(ids) {
  var chunks = [];
  for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  chunks.forEach(function (chunk) {
    var url = 'https://www.googleapis.com/youtube/v3/videos'
            + '?part=snippet&id=' + chunk.join(',')
            + '&key=' + encodeURIComponent(YOUTUBE_API_KEY);
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!data || !data.items) return;
      var map = {};
      data.items.forEach(function (it) {
        var thumbs = (it.snippet && it.snippet.thumbnails) || {};
        var t = thumbs.medium || thumbs.high || thumbs['default'] || {};
        map[it.id] = {
          title: (it.snippet && it.snippet.title) || null,
          thumbnail: t.url || null
        };
      });
      var changed = false;
      for (var i = 0; i < playlistData.length; i++) {
        var m = map[playlistData[i].videoId];
        if (m) {
          if (m.title)     { playlistData[i].title = m.title; changed = true; }
          if (m.thumbnail) { playlistData[i].thumbnail = m.thumbnail; changed = true; }
        }
      }
      if (changed) renderPlaylist();
    }).catch(function () {
      // Silently ignore — playlist still works, titles just stay generic.
    });
  });
}

/* ---------- Overlay ---------- */

function showOverlay(text) {
  var el = document.getElementById('player-overlay');
  var tx = document.getElementById('overlay-text');
  if (tx) tx.textContent = text;
  if (el) el.className = 'player-overlay';
}
function hideOverlay() {
  var el = document.getElementById('player-overlay');
  if (el) el.className = 'player-overlay hidden';
}

/* ---------- Paste-a-link fallback ---------- */

function extractVideoId(url) {
  if (!url) return null;
  url = String(url).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  var patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = url.match(patterns[i]);
    if (m) return m[1];
  }
  return null;
}

/* ---------- Wire controls (DOM is already parsed; scripts at end of body) ---------- */

(function wireControls() {
  document.getElementById('btn-play').addEventListener('click', function () {
    if (!player) return;
    var st = safeGet(function () { return player.getPlayerState(); }, -1);
    if (st === YT.PlayerState.PLAYING) {
      try { player.pauseVideo(); } catch (e) {}
    } else {
      try { player.playVideo(); } catch (e) {}
    }
  });

  document.getElementById('btn-next').addEventListener('click', function () {
    if (!player) return;
    try { player.nextVideo(); } catch (e) {}
  });

  document.getElementById('btn-prev').addEventListener('click', function () {
    if (!player) return;
    try { player.previousVideo(); } catch (e) {}
  });

  document.getElementById('btn-restart').addEventListener('click', function () {
    if (!player) return;
    try {
      player.playVideoAt(0);
    } catch (e) {
      try {
        player.loadPlaylist({
          listType: 'playlist',
          list: YOUTUBE_PLAYLIST_ID,
          index: 0,
          startSeconds: 0
        });
      } catch (e2) {}
    }
  });

  document.getElementById('paste-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = document.getElementById('paste-input');
    var id = extractVideoId(input.value);
    if (!id) {
      input.value = '';
      input.placeholder = 'Could not find a video ID — try again';
      return;
    }
    if (player) {
      try { player.loadVideoById(id); } catch (e) {}
    }
    input.value = '';
    input.placeholder = 'Paste any YouTube URL…';
    input.blur();
  });
})();
