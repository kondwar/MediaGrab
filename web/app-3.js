const F = window.MediaGrabFormats;

const state = {
  language: "en",
  theme: "dark",
  translations: {},

  // Result of /api/info for the detected URL (null until detection).
  info: null,
  url: "",
  detecting: false,
  downloading: false,

  // Public settings from /api/config (download mode, Adsgram, ...).
  config: null
};

let languageRequestId = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const tg = window.Telegram && window.Telegram.WebApp;

/* ---------- Telegram Mini App ---------- */

function initTelegram() {
  if (!tg) return;

  try {
    tg.ready();
    tg.expand();
  } catch (error) {
    console.warn("Telegram WebApp init failed:", error);
  }
}

/* The signed initData is verified by the backend; it is never trusted here. */
function requestHeaders() {
  const headers = { "Content-Type": "application/json" };

  if (tg && tg.initData) {
    headers["X-Telegram-Init-Data"] = tg.initData;
  }

  return headers;
}

/* ---------- Safe storage ---------- */

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: ignore */
  }
}

/* ---------- Translations ---------- */

function t(key, fallback = key) {
  const parts = key.split(".");
  let value = state.translations;

  for (const part of parts) {
    if (value && Object.prototype.hasOwnProperty.call(value, part)) {
      value = value[part];
    } else {
      return fallback;
    }
  }

  return typeof value === "string" ? value : fallback;
}

/* Turns a failed API response into a message in the current language. */
function apiError(payload, fallbackKey, fallbackText) {
  const detail = payload && payload.detail;

  if (detail && detail.type === "UnsupportedPlatform") {
    return t(
      "errors.unsupportedPlatform",
      "Only Facebook, Instagram and X (Twitter) links are supported."
    );
  }

  return F.errorMessage(payload, t(fallbackKey, fallbackText));
}

/* ---------- Status line ---------- */

function setStatus(text, kind = "") {
  const line = $("#statusLine");

  if (!line) return;

  line.textContent = text || "";
  line.className = "status-line" + (kind ? " " + kind : "");
}

/* ---------- Mode ---------- */

/* "direct" (default): the user's device downloads from the source; the
   server only supplies the real direct link.
   "server": this server downloads, merges and sends the file. */
function isDirect() {
  const mode =
    (state.info && state.info.mode) ||
    (state.config && state.config.download_mode) ||
    "direct";

  return mode === "direct";
}

function availableVideo() {
  const video =
    (state.info && state.info.formats && state.info.formats.video) || [];

  return isDirect() ? video.filter((f) => f.direct && f.direct_url) : video;
}

/* ---------- Quality ---------- */

function qualityChoices() {
  return state.info
    ? F.videoChoices(
        availableVideo(),
        t("options.unknownQuality", "Unknown quality")
      )
    : [];
}

function emptyMessage() {
  if (!state.info) {
    return t("options.detectFirst", "Detect a link first");
  }

  return isDirect()
    ? t("options.notAvailableDirect", "No direct download for this link")
    : t("options.notAvailable", "Not available for this link");
}

function updateOptions(preserveSelection = false) {
  const select = $("#quality");

  if (!select) return;

  const previous = preserveSelection ? select.value : "";
  const choices = qualityChoices();

  select.innerHTML = "";

  if (choices.length) {
    for (const choice of choices) {
      const el = document.createElement("option");
      el.value = choice.value;
      el.textContent = choice.label;
      select.appendChild(el);
    }

    if (previous && choices.some((c) => c.value === previous)) {
      select.value = previous;
    }

    select.disabled = false;
  } else {
    const el = document.createElement("option");
    el.value = "";
    el.textContent = emptyMessage();
    select.appendChild(el);
    select.disabled = true;
  }

  updateDownloadAvailability();
}

/* ---------- Media info card ---------- */

function renderMediaInfo() {
  const card = $("#mediaInfo");

  if (!card) return;

  if (!state.info) {
    card.hidden = true;
    return;
  }

  const info = state.info;

  const thumbnail = $("#mediaThumb");

  if (thumbnail) {
    if (info.thumbnail && /^https?:\/\//i.test(info.thumbnail)) {
      thumbnail.src = info.thumbnail;
      thumbnail.hidden = false;
    } else {
      thumbnail.removeAttribute("src");
      thumbnail.hidden = true;
    }
  }

  $("#mediaTitle").textContent = info.title || "";

  const parts = [];

  if (info.platform) parts.push(info.platform);
  if (info.uploader) parts.push(info.uploader);

  const duration = F.formatDuration(info.duration);

  if (duration) parts.push(duration);

  if (typeof info.view_count === "number") {
    parts.push(
      info.view_count.toLocaleString(state.language) +
        " " +
        t("info.views", "views")
    );
  }

  $("#mediaMeta").textContent = parts.join(" • ");

  card.hidden = false;
}

function resetInfo() {
  state.info = null;
  state.url = "";

  renderMediaInfo();
  updateOptions(false);
}

/* ---------- Language ---------- */

function applyLanguage() {
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.language === "ar" ? "rtl" : "ltr";

  $$("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const value = t(key);

    if (value !== key) {
      element.textContent = value;
    }
  });

  $$("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    const value = t(key);

    if (value !== key) {
      element.placeholder = value;
    }
  });

  const languageButton = $("#languageButton");

  if (languageButton) {
    const text = state.language === "ar" ? "العربية" : "English";
    const label = languageButton.querySelector("[data-language-label]");

    if (label) {
      label.textContent = text;
    } else {
      languageButton.setAttribute("aria-label", text);
    }
  }

  updateOptions(true);
  renderMediaInfo();
}

async function loadLanguage(language) {
  const requestId = ++languageRequestId;

  try {
    const response = await fetch(`/translations/${language}.json?v=7`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Translation HTTP ${response.status}`);
    }

    const translations = await response.json();

    // Ignore stale responses if the user clicked again meanwhile.
    if (requestId !== languageRequestId) return;

    state.translations = translations;
    state.language = language;
    storageSet("mediagrab-language", language);

    applyLanguage();
  } catch (error) {
    console.error("Translation loading failed:", error);
  }
}

function setupLanguage() {
  const button = $("#languageButton");

  if (!button) return;

  button.addEventListener("click", () => {
    loadLanguage(state.language === "en" ? "ar" : "en");
  });
}

/* ---------- URL input ---------- */

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function setupUrl() {
  const input = $("#urlInput");
  const clear = $("#clearUrl");

  if (!input) return;

  const updateClear = () => {
    if (clear) {
      clear.style.display = input.value.trim() ? "" : "none";
    }
  };

  input.addEventListener("input", () => {
    updateClear();

    // The URL changed after detection: the old formats no longer apply.
    if (state.info && input.value.trim() !== state.url) {
      resetInfo();
    }
  });

  // Pasting a link starts detection right away.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      if (isValidHttpUrl(input.value.trim())) detect();
    }, 0);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      detect();
    }
  });

  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      input.focus();
      updateClear();
      resetInfo();
      setStatus("");
    });
  }

  updateClear();
}

/* ---------- Theme ---------- */

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle("light-theme", state.theme === "light");
}

function setupTheme() {
  const button = $("#themeButton");

  const saved = storageGet("mediagrab-theme");

  if (saved === "light" || saved === "dark") {
    state.theme = saved;
  } else if (tg && (tg.colorScheme === "light" || tg.colorScheme === "dark")) {
    // Inside Telegram, follow its color scheme until the user picks one.
    state.theme = tg.colorScheme;
  }

  applyTheme();

  if (!button) return;

  button.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    storageSet("mediagrab-theme", state.theme);
  });
}

/* ---------- Detect ---------- */

async function detect() {
  const input = $("#urlInput");
  const button = $("#detectButton");

  if (!input || state.detecting) return;

  const url = input.value.trim();

  if (!url) {
    setStatus(
      t("messages.urlRequired", "Please enter a valid media URL."),
      "error"
    );
    input.focus();
    return;
  }

  if (!isValidHttpUrl(url)) {
    setStatus(t("errors.invalidUrl", "Please enter a valid URL."), "error");
    input.focus();
    return;
  }

  state.detecting = true;

  if (button) button.disabled = true;

  setStatus(t("messages.detecting", "Detecting media..."), "busy");

  try {
    const response = await fetch("/api/info", {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({ url })
    });

    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || !payload.success) {
      throw new Error(
        apiError(
          payload,
          "errors.detectionFailed",
          "Unable to detect media from this URL."
        )
      );
    }

    state.info = payload;
    state.url = url;

    renderMediaInfo();
    updateOptions(false);
    setStatus("");
  } catch (error) {
    resetInfo();

    setStatus(
      error instanceof TypeError
        ? t("errors.network", "Network error. Check your connection and try again.")
        : error.message,
      "error"
    );
  } finally {
    state.detecting = false;

    if (button) button.disabled = false;
  }
}

function setupDetect() {
  const button = $("#detectButton");

  if (button) button.addEventListener("click", detect);
}

/* ---------- Adsgram (optional) ---------- */

async function loadConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });

    if (response.ok) {
      state.config = await response.json();
    }
  } catch (error) {
    console.warn("Config could not be loaded:", error);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Ad script failed to load"));

    document.head.appendChild(script);
  });
}

/*
 * Returns true when the download may continue.
 *   Adsgram disabled (default) -> true, nothing is loaded.
 *   Adsgram enabled            -> the ad must be shown first. If it
 *     cannot be shown, ADSGRAM_FAIL_MODE decides: "allow" continues,
 *     "block" stops with an error.
 * This gate runs in the browser, so it is a UX flow, not enforcement.
 */
async function runAdGate() {
  const ads = state.config && state.config.adsgram;

  if (!ads || !ads.enabled) return true;

  try {
    if (!window.Adsgram) {
      await loadScript(ads.sdk_url);
    }

    const controller = window.Adsgram.init({ blockId: ads.block_id });

    await controller.show();

    return true;
  } catch (error) {
    console.warn("Adsgram failed:", error);

    return ads.fail_mode === "allow";
  }
}

/* ---------- Download ---------- */

function canDownload() {
  if (!state.info || state.downloading) return false;

  const quality = $("#quality");

  return Boolean(quality && quality.value && !quality.disabled);
}

function updateDownloadAvailability() {
  const button = $("#downloadButton");

  if (button) button.disabled = !canDownload();
}

function saveBlob(blob, filename) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);

  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

/* Direct mode only: the user's own device downloads the file. */
function openExternal(url) {
  if (tg && typeof tg.openLink === "function") {
    try {
      tg.openLink(url);
      return;
    } catch (error) {
      console.warn("Telegram openLink failed:", error);
    }
  }

  const link = document.createElement("a");

  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();
}

function trackDirect(formatId, quality) {
  try {
    fetch("/api/track", {
      method: "POST",
      headers: requestHeaders(),
      keepalive: true,
      body: JSON.stringify({
        url: state.url,
        media_type: "video",
        format_id: formatId || null,
        quality: quality || null,
        platform: state.info ? state.info.platform : null
      })
    }).catch(() => {});
  } catch {
    /* analytics must never break the download */
  }
}

async function startDirectDownload(formatId) {
  const item = availableVideo().find((f) => f.format_id === formatId);

  if (!item || !item.direct_url) {
    setStatus(
      t("errors.noDirectLink", "This option has no direct link. Detect the link again."),
      "error"
    );
    return;
  }

  openExternal(item.direct_url);

  setStatus(
    t(
      "messages.directStarted",
      "Opening the file. If it plays instead of saving, use your browser menu to save it."
    ),
    "ok"
  );

  trackDirect(item.format_id, item.quality);
}

async function startServerDownload(formatId) {
  setStatus(
    t("messages.preparingDownload", "Preparing your download..."),
    "busy"
  );

  const response = await fetch("/api/download", {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      url: state.url,
      media_type: "video",
      format_id: formatId
    })
  });

  if (!response.ok) {
    let payload = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    throw new Error(
      apiError(
        payload,
        "errors.downloadFailed",
        "The download could not be completed."
      )
    );
  }

  const blob = await response.blob();

  const filename =
    F.filenameFromDisposition(response.headers.get("Content-Disposition")) ||
    "video.mp4";

  saveBlob(blob, filename);

  setStatus(t("messages.downloadStarted", "Download started."), "ok");
}

async function startDownload() {
  if (!state.info) {
    setStatus(t("messages.detectFirst", "Detect the link first."), "error");
    return;
  }

  if (!canDownload()) return;

  const formatId = $("#quality").value;

  state.downloading = true;
  updateDownloadAvailability();

  try {
    const allowed = await runAdGate();

    if (!allowed) {
      setStatus(
        t("errors.adFailed", "The ad could not be shown. Please try again."),
        "error"
      );
      return;
    }

    if (isDirect()) {
      await startDirectDownload(formatId);
    } else {
      await startServerDownload(formatId);
    }
  } catch (error) {
    setStatus(
      error instanceof TypeError
        ? t("errors.network", "Network error. Check your connection and try again.")
        : error.message,
      "error"
    );
  } finally {
    state.downloading = false;
    updateDownloadAvailability();
  }
}

function setupDownload() {
  const button = $("#downloadButton");

  if (!button) return;

  button.addEventListener("click", startDownload);
}

/* ---------- Init ---------- */

function initialize() {
  initTelegram();

  setupLanguage();
  setupUrl();
  setupTheme();
  setupDetect();
  setupDownload();

  const language = storageGet("mediagrab-language") === "ar" ? "ar" : "en";

  // Render defaults immediately so the UI works even if the
  // translation file fails to load.
  state.language = language;
  applyLanguage();

  loadLanguage(language);
  loadConfig();
}

document.addEventListener("DOMContentLoaded", initialize);
