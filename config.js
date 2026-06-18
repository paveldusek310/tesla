// =====================================================================
// EDIT THESE LINES.
// =====================================================================

// REQUIRED. The ID of your YouTube playlist.
// Tip: from a URL like
//   https://youtube.com/playlist?list=PLTi1aAV_a8GodRC1GejQ3C_VHVuSKhuen&si=XYZ
// the ID is only the part after "list=" and BEFORE the "&". You can
// paste the whole URL or query string here — the app will clean it up.
const YOUTUBE_PLAYLIST_ID = "PLTi1aAV_a8GodRC1GejQ3C_VHVuSKhuen";

// OPTIONAL. A YouTube Data API v3 key. Only used to fetch nicer titles
// and thumbnails for the playlist sidebar. Leave the placeholder as-is
// if you don't have one — the app will still play the playlist fine.
const YOUTUBE_API_KEY = "PASTE_KEY_HERE";

// OPTIONAL. Extra shortcut buttons shown in the "Sources" sidebar tab.
// Each entry has a name and a URL. Tapping the button opens the URL in
// a new browser tab. Use it for non-YouTube sites — live TV streams,
// catch-up players, news sites, etc.
//
// Add, remove or rearrange entries here. The list can be empty: [].
const EXTRA_SOURCES = [
  { name: "TeslaTelek (YT via Telegram)", url: "https://teslatelek.com" },
  { name: "ČT24 — Live",   url: "https://ct24.ceskatelevize.cz/video/zive-vysilani" },
  { name: "ČT iVysílání",  url: "https://www.ceskatelevize.cz/ivysilani/" }
];
