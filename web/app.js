const F = window.MediaGrabFormats;

const state = {
  language: "en",
  theme: "dark",
  mediaType: "video",
  translations: {},
  advancedOpen: false,

  // Result of /api/info for the detected URL (null until detection).
  info: null,
  url: "",
  detecting: false,
  downloading: false,

  // Public settings from /api/config (Adsgram etc.).
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

/* ---------- Status line ---------- */

function setStatus(text, kind = "") {
  const line = $("#statusLine");

  if (!line) return;

  line.textContent = text || "";
  line.className = "status-line" + (kind ? " " + kind : "");
}

/* ---------- Options ---------- */

function opt(value, key, fallback) {
  return { value, label: t(key, fallback) };
}

function setOptions(select, options, selectedValue) {
  if (!select) return;

  select.innerHTML = "";

  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }

  if (selectedValue && options.some((o) => o.value === selectedValue)) {
    select.value = selectedValue;
  }
}

function placeholder(key, fallback) {
  return [{ value: "", label: t(key, fallback) }];
}

function staticFormatOptions(values) {
  return values.map((value) => ({ value, label: value.toUpperCase() }));
}

/* Quality options always come from the real formats of the detected URL. */
function qualityOptions() {
  if (!state.info) return [];

  const formats = state.info.formats || {};

  switch (state.mediaType) {
    case "video":
      return F.videoQualityOptions(
        formats.video,
        t("options.unknownQuality", "Unknown quality")
      );

    case "audio":
      return F.audioSources(formats).options;

    case "subtitles":
      return F.subtitleOptions(
        state.info.subtitle_tracks,
        t("options.autoCaption", "auto-generated")
      );

    default:
      return [
        opt("text", "options.descriptionMetadata", "Description & metadata")
      ];
  }
}

function formatOptions(qualityValue) {
  if (!state.info) return [];

  const formats = state.info.formats || {};

  switch (state.mediaType) {
    case "video":
      return F.videoFormatOptions(
        formats.video,
        qualityValue,
        t("options.mergeNote", "video + audio")
      );

    case "audio": {
      const sources = F.audioSources(formats);
      const source = sources.options.find((o) => o.value === qualityValue);

      return F.conversionOptions(
        source ? source.ext : "",
        sources.requiresConversion,
        t("options.originalFormat", "Original")
      );
    }

    case "subtitles":
      return staticFormatOptions(F.SUBTITLE_FORMATS);

    default:
      return staticFormatOptions(F.TEXT_FORMATS);
  }
}

function languageOptions() {
  if (!state.info) return [];

  if (state.mediaType !== "video" && state.mediaType !== "audio") return [];

  return F.audioLanguageOptions(
    state.info.audio_languages,
    t("options.anyLanguage", "Any Language")
  );
}

function fillSelect(select, options, emptyKey, emptyFallback, selected) {
  if (!select) return;

  if (options.length) {
    setOptions(select, options, selected);
    select.disabled = false;
  } else {
    setOptions(select, placeholder(emptyKey, emptyFallback));
    select.disabled = true;
  }
}

function refreshFormat(preserved) {
  const quality = $("#quality");
  const format = $("#format");

  const emptyKey = state.info
    ? "options.notAvailable"
    : "options.detectFirst";

  const emptyFallback = state.info
    ? "Not available for this link"
    : "Detect a link first";

  fillSelect(
    format,
    quality && quality.value ? formatOptions(quality.value) : [],
    emptyKey,
    emptyFallback,
    preserved
  );

  updateDownloadAvailability();
}

/**
 * @param {boolean} preserveSelection keep the user's current choices
 * (used when only the UI language changes, not the media type).
 */
function updateOptions(preserveSelection = false) {
  const quality = $("#quality");
  const format = $("#format");
  const audioLanguage = $("#audioLanguage");
  const mp3Bitrate = $("#mp3Bitrate");

  if (!quality || !format || !audioLanguage) return;

  const current = preserveSelection
    ? {
        quality: quality.value,
        format: format.value,
        audioLanguage: audioLanguage.value,
        mp3Bitrate: mp3Bitrate ? mp3Bitrate.value : ""
      }
    : {};

  const emptyKey = state.info
    ? "options.notAvailable"
    : "options.detectFirst";

  const emptyFallback = state.info
    ? "Not available for this link"
    : "Detect a link first";

  fillSelect(
    quality,
    qualityOptions(),
    emptyKey,
    emptyFallback,
    current.quality
  );

  refreshFormat(current.format);

  const languages = languageOptions();

  fillSelect(
    audioLanguage,
    languages,
    "options.originalLanguage",
    "Original Language",
    current.audioLanguage
  );

  if (mp3Bitrate) {
    setOptions(
      mp3Bitrate,
      F.MP3_BITRATES.map((value) =>
        opt(value, `options.${value}kbps`, `${value} kbps`)
      ),
      current.mp3Bitrate || "192"
    );
  }
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
  updateAdvancedButton();
  updateDownloadButton();
}

async function loadLanguage(language) {
  const requestId = ++languageRequestId;

  try {
    const response = await fetch(`/translations/${language}.json?v=6`, {
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

/* ---------- Media types ---------- */

function setupMediaTypes() {
  $$(".media-type").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".media-type").forEach((item) => {
        item.classList.remove("active");
        item.setAttribute("aria-selected", "false");
      });

      button.classList.add("active");
      button.setAttribute("aria-selected", "true");

      state.mediaType = button.dataset.type || "video";

      // New media type: reset choices to defaults.
      updateOptions(false);
    });
  });

  const quality = $("#quality");

  if (quality) {
    quality.addEventListener("change", () => refreshFormat());
  }
}

/* ---------- Advanced options ---------- */

function updateAdvancedButton() {
  const button = $("#advancedButton");
  const options = $("#advancedOptions");

  if (!button || !options) return;

  const label = button.querySelector("[data-i18n]");

  if (label) {
    label.textContent = state.advancedOpen
      ? t("advanced.hide", "Hide Advanced Options")
      : t("advanced.show", "Advanced Options");
  }

  options.classList.toggle("open", state.advancedOpen);
  button.setAttribute("aria-expanded", String(state.advancedOpen));
}

function setupAdvanced() {
  const button = $("#advancedButton");
  const options = $("#advancedOptions");

  if (!button || !options) return;

  button.addEventListener("click", () => {
    state.advancedOpen = !state.advancedOpen;
    updateAdvancedButton();
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
        F.errorMessage(
          payload,
          t("errors.detectionFailed", "Unable to detect media from this URL.")
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

function updateDownloadButton() {
  const button = $("#downloadButton");

  if (!button) return;

  const label = button.querySelector("[data-i18n]");

  if (label) {
    label.textContent = t("download.now", "Download Now");
  }
}

function canDownload() {
  if (!state.info || state.downloading) return false;

  const quality = $("#quality");
  const format = $("#format");

  return Boolean(
    quality && format && quality.value && format.value &&
    !quality.disabled && !format.disabled
  );
}

function updateDownloadAvailability() {
  const button = $("#downloadButton");

  if (button) button.disabled = !canDownload();
}

function buildDownloadBody() {
  const quality = $("#quality").value;
  const format = $("#format").value;
  const language = $("#audioLanguage");
  const audioLanguage = language && !language.disabled && language.value
    ? language.value
    : null;

  switch (state.mediaType) {
    case "video":
      return {
        url: state.url,
        media_type: "video",
        format_id: format,
        audio_language: audioLanguage
      };

    case "audio":
      return {
        url: state.url,
        media_type: "audio",
        format_id: quality,
        audio_convert: format === "original" ? null : format,
        audio_bitrate: $("#mp3Bitrate") ? $("#mp3Bitrate").value : null,
        audio_language: audioLanguage
      };

    case "subtitles": {
      const track = F.parseSubtitleValue(quality);

      return {
        url: state.url,
        media_type: "subtitles",
        subtitle_lang: track.lang,
        subtitle_auto: track.auto,
        subtitle_format: format
      };
    }

    default:
      return {
        url: state.url,
        media_type: "text",
        text_format: format
      };
  }
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

async function startDownload() {
  if (!state.info) {
    setStatus(t("messages.detectFirst", "Detect the link first."), "error");
    return;
  }

  if (!canDownload()) return;

  const body = buildDownloadBody();

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

    setStatus(
      t("messages.preparingDownload", "Preparing your download..."),
      "busy"
    );

    const response = await fetch("/api/download", {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      let payload = null;

      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      throw new Error(
        F.errorMessage(
          payload,
          t("errors.downloadFailed", "The download could not be completed.")
        )
      );
    }

    const blob = await response.blob();

    const filename =
      F.filenameFromDisposition(response.headers.get("Content-Disposition")) ||
      "media";

    saveBlob(blob, filename);

    setStatus(t("messages.downloadStarted", "Download started."), "ok");
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
