/* Tesla YouTube playlist player
 * Pure vanilla JS, ES2017-friendly. Loaded after config.js, before the
 * YouTube IFrame API script in index.html.
 */
'use strict';

var STORAGE_KEY = 'tesla-playlist:v1';
var SAVE_INTERVAL_MS = 5000;
var BUILD_PLAYLIST_RETRY_MS = 400;
var BUILD_PLAYLIST_MAX_TRIES = 25;

// Sanitize the configured playlist ID. People often paste the whole
// "...&si=XYZ" tracking suffix from YouTube's Share button; strip it.
var PLAYLIST_ID = sanitizePlaylistId(typeof YOUTUBE_PLAYLIST_ID === 'string' ? YOUTUBE_PLAYLIST_ID : '');
var API_KEY     = (typeof YOUTUBE_API_KEY === 'string') ? YOUTUBE_API_KEY : '';
var SOURCES     = (typeof EXTRA_SOURCES !== 'undefined' && EXTRA_SOURCES) ? EXTRA_SOURCES : [];

var player = null;
var playlistData = [];   // [{videoId, title, thumbnail}]
var currentIndex = -1;
var saveTimer = null;
var buildTries = 0;
var pendingResume = null;
var externalMode = false;

function sanitizePlaylistId(s) {
  if (!s) return '';
  var str = String(s).trim();
  var m = str.match(/[?&]list=([^&\s#]+)/);
  if (m) str = m[1];
  m = str.match(/^[A-Za-z0-9_-]+/);
  return m ? m[0] : '';
}

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
    playlistId: PLAYLIST_ID,
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

/* ---------- YouTube IFrame API bootstrap ---------- */

window.onYouTubeIframeAPIReady = function () { initPlayer(); };

function initPlayer() {
  player = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1,
      iv_load_policy: 3,
      enablejsapi: 1
      // NB: 'fs' omitted on purpose — default is 1, which enables the
      // YouTube player's built-in fullscreen button (bottom-right).
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

function onPlayerReady() {
  if (isPlaceholder(PLAYLIST_ID) || !PLAYLIST_ID) {
    showOverlay('No playlist configured.\nEdit config.js — or paste a YouTube link below.');
    return;
  }

  pendingResume = loadState();
  var startIdx = 0;
  var startSecs = 0;
  if (pendingResume && pendingResume.playlistId === PLAYLIST_ID) {
    if (typeof pendingResume.index === 'number' && pendingResume.index >= 0) {
      startIdx = pendingResume.index;
    }
    startSecs = Math.max(0, (pendingResume.time || 0) - 2);
  }

  try {
    player.cuePlaylist({
      listType: 'playlist',
      list: PLAYLIST_ID,
      index: startIdx,
      startSeconds: startSecs
    });
    currentIndex = startIdx;
  } catch (e) {
    showOverlay('Could not load playlist.\nCheck the playlist ID in config.js.');
    return;
  }

  showOverlay('Tap Play to start');
  setTimeout(tryBuildPlaylist, BUILD_PLAYLIST_RETRY_MS);
}

function onPlayerError(ev) {
  var msg = 'Playback error (code ' + ev.data + ').';
  if (ev.data === 100) msg = 'Video not found or removed.';
  if (ev.data === 101 || ev.data === 150) msg = 'This video does not allow embedding.';
  if (ev.data === 2) msg = 'Invalid video or playlist ID — check config.js.\nMake sure the playlist is Public or Unlisted.';
  if (ev.data === 5) msg = 'HTML5 playback error.';
  showOverlay(msg);
}

function onPlayerStateChange(ev) {
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
  if (!isPlaceholder(API_KEY) && ids.length) fetchVideoTitles(ids);
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
  if (externalMode) restoreYouTubePlayer();
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
            + '&key=' + encodeURIComponent(API_KEY);
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
    }).catch(function () { /* silent */ });
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

/* ---------- URL helpers ---------- */

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

function looksLikeUrl(s) { return /^https?:\/\//i.test(s); }

function openExternal(url) {
  try {
    var w = window.open(url, '_blank');
    if (!w) { window.location.href = url; }
  } catch (e) {
    window.location.href = url;
  }
}

/* ---------- External-iframe mode (non-YouTube URLs) ---------- */

function embedExternalUrl(url) {
  if (!url) return;
  externalMode = true;

  try { if (player && player.pauseVideo) player.pauseVideo(); } catch (e) {}

  hideOverlay();

  // Remove any previous external iframe
  var existing = document.getElementById('external-iframe');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

  // Hide the YouTube player iframe (it keeps its state under the hood)
  var yt = document.getElementById('player');
  if (yt) yt.style.display = 'none';

  // Create the external iframe
  var iframe = document.createElement('iframe');
  iframe.id = 'external-iframe';
  iframe.src = url;
  iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

  var wrap = document.getElementById('player-wrap');
  if (wrap) wrap.appendChild(iframe);

  // Swap visible controls
  toggleControls(true);

  // Stash the URL on the "open in new tab" button so its handler can use it
  var openBtn = document.getElementById('btn-open-tab');
  if (openBtn) openBtn.setAttribute('data-url', url);

  // Many big sites (ČT, broadcasters, news sites) send X-Frame-Options that
  // forbid embedding — the iframe will render blank. After a short delay,
  // surface a friendly hint so the user knows what to do.
  setTimeout(function () {
    if (!externalMode) return;
    var iframeNow = document.getElementById('external-iframe');
    if (!iframeNow) return;
    showOverlay('If the page is blank, this site blocks embedding.\nTap "Open in new tab" above.');
  }, 4500);
}

function restoreYouTubePlayer() {
  externalMode = false;
  var iframe = document.getElementById('external-iframe');
  if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
  var yt = document.getElementById('player');
  if (yt) yt.style.display = '';
  toggleControls(false);
  hideOverlay();
}

function toggleControls(showExternal) {
  var ytC  = document.getElementById('yt-controls');
  var extC = document.getElementById('ext-controls');
  if (showExternal) {
    if (ytC)  ytC.className  = 'controls hidden';
    if (extC) extC.className = 'controls';
  } else {
    if (ytC)  ytC.className  = 'controls';
    if (extC) extC.className = 'controls hidden';
  }
}

/* ---------- Sources tab ---------- */

function renderSources() {
  var el = document.getElementById('source-list');
  if (!el) return;
  el.innerHTML = '';
  if (!SOURCES.length) {
    var empty = document.createElement('li');
    empty.className = 'pl-empty';
    empty.textContent = 'No extra sources configured. Add some in config.js.';
    el.appendChild(empty);
    return;
  }
  for (var i = 0; i < SOURCES.length; i++) {
    el.appendChild(makeSourceItem(SOURCES[i]));
  }
}

function makeSourceItem(src) {
  var li = document.createElement('li');
  li.className = 'source-item';

  var icon = document.createElement('div');
  icon.className = 'source-icon';
  icon.textContent = '▶';

  var text = document.createElement('div');
  text.className = 'source-text';

  var name = document.createElement('div');
  name.className = 'source-name';
  name.textContent = src && src.name ? src.name : (src && src.url ? src.url : 'Untitled');

  var urlDiv = document.createElement('div');
  urlDiv.className = 'source-url';
  urlDiv.textContent = src && src.url ? src.url : '';

  text.appendChild(name);
  text.appendChild(urlDiv);
  li.appendChild(icon);
  li.appendChild(text);

  li.addEventListener('click', function () {
    if (src && src.url) embedExternalUrl(src.url);
  });
  return li;
}

/* ---------- Tab switching ---------- */

function activateTab(name) {
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].className = (tabs[i].getAttribute('data-tab') === name) ? 'tab active' : 'tab';
  }
  var panels = [
    { name: 'playlist', el: document.getElementById('tab-panel-playlist') },
    { name: 'sources',  el: document.getElementById('tab-panel-sources')  }
  ];
  for (var j = 0; j < panels.length; j++) {
    if (!panels[j].el) continue;
    panels[j].el.className = (panels[j].name === name) ? 'tab-panel' : 'tab-panel hidden';
  }
}

/* ---------- Wire controls ---------- */

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
          list: PLAYLIST_ID,
          index: 0,
          startSeconds: 0
        });
      } catch (e2) {}
    }
  });

  document.getElementById('btn-back-yt').addEventListener('click', function () {
    restoreYouTubePlayer();
  });
  document.getElementById('btn-open-tab').addEventListener('click', function (ev) {
    var url = ev.currentTarget.getAttribute('data-url') || '';
    if (url) openExternal(url);
  });

  document.getElementById('paste-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var input = document.getElementById('paste-input');
    var raw = (input.value || '').trim();
    if (!raw) return;

    var id = extractVideoId(raw);
    if (id) {
      if (externalMode) restoreYouTubePlayer();
      if (player) try { player.loadVideoById(id); } catch (e) {}
    } else if (looksLikeUrl(raw)) {
      embedExternalUrl(raw);
    } else {
      input.value = '';
      input.placeholder = 'Not a recognised link — try again';
      return;
    }
    input.value = '';
    input.placeholder = 'Paste any YouTube URL — or any other web link…';
    input.blur();
  });

  var tabBtns = document.querySelectorAll('.tab');
  for (var i = 0; i < tabBtns.length; i++) {
    tabBtns[i].addEventListener('click', function (ev) {
      var name = ev.currentTarget.getAttribute('data-tab');
      if (name) activateTab(name);
    });
  }

  renderSources();
})();
