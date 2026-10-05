const state = {
  language: "en",
  theme: "dark",
  mediaType: "video",
  translations: {},
  advancedOpen: false
};

let languageRequestId = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

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

function getOptionSets() {
  const anyOrOriginalLanguage = [
    opt("any", "options.anyLanguage", "Any Language"),
    opt("original", "options.originalLanguage", "Original Language")
  ];

  // The first item of each list is the default value.
  switch (state.mediaType) {
    case "video":
      return {
        quality: [
          opt("best", "options.bestAvailable", "Best Available"),
          opt("original", "options.originalQuality", "Original Quality"),
          opt("2160p", "options.2160p", "2160p (4K)"),
          opt("1440p", "options.1440p", "1440p"),
          opt("1080p", "options.1080p", "1080p"),
          opt("720p", "options.720p", "720p"),
          opt("480p", "options.480p", "480p"),
          opt("360p", "options.360p", "360p")
        ],
        format: [
          opt("mp4", "options.mp4", "MP4"),
          opt("webm", "options.webm", "WEBM"),
          opt("mkv", "options.mkv", "MKV")
        ],
        audioLanguage: anyOrOriginalLanguage
      };

    case "audio":
      return {
        quality: [
          opt("original", "options.originalAudio", "Original Audio"),
          opt("320", "options.320kbps", "320 kbps"),
          opt("256", "options.256kbps", "256 kbps"),
          opt("192", "options.192kbps", "192 kbps"),
          opt("128", "options.128kbps", "128 kbps")
        ],
        format: [
          opt("mp3", "options.mp3", "MP3"),
          opt("m4a", "options.m4a", "M4A"),
          opt("opus", "options.opus", "OPUS")
        ],
        audioLanguage: anyOrOriginalLanguage
      };

    case "subtitles":
      return {
        quality: [
          opt("available", "options.availableLanguages", "Available Languages")
        ],
        format: [
          opt("srt", "options.srt", "SRT"),
          opt("vtt", "options.vtt", "VTT"),
          opt("txt", "options.txt", "TXT")
        ],
        audioLanguage: anyOrOriginalLanguage
      };

    default:
      return {
        quality: [opt("original", "options.original", "Original")],
        format: [
          opt("txt", "options.txt", "TXT"),
          opt("json", "options.json", "JSON"),
          opt("html", "options.html", "HTML")
        ],
        audioLanguage: [opt("any", "options.anyLanguage", "Any Language")]
      };
  }
}

/**
 * @param {boolean} preserveSelection keep the user's current choices
 * (used when only the UI language changes, not the media type).
 */
function updateOptions(preserveSelection = false) {
  const quality = $("#quality");
  const format = $("#format");
  const audioLanguage = $("#audioLanguage");

  if (!quality || !format || !audioLanguage) return;

  const current = preserveSelection
    ? {
        quality: quality.value,
        format: format.value,
        audioLanguage: audioLanguage.value
      }
    : {};

  const sets = getOptionSets();

  setOptions(quality, sets.quality, current.quality || sets.quality[0].value);
  setOptions(format, sets.format, current.format || sets.format[0].value);
  setOptions(
    audioLanguage,
    sets.audioLanguage,
    current.audioLanguage || sets.audioLanguage[0].value
  );
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
  updateAdvancedButton();
  updateDownloadButton();
}

async function loadLanguage(language) {
  const requestId = ++languageRequestId;

  try {
    const response = await fetch(`/translations/${language}.json?v=5`, {
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

  options.hidden = !state.advancedOpen;
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

function setupUrl() {
  const input = $("#urlInput");
  const clear = $("#clearUrl");

  if (!input) return;

  const updateClear = () => {
    if (clear) {
      clear.style.display = input.value.trim() ? "" : "none";
    }
  };

  input.addEventListener("input", updateClear);

  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      input.focus();
      updateClear();
    });
  }

  updateClear();
}

/* ---------- Theme ---------- */

function setupTheme() {
  const button = $("#themeButton");

  const saved = storageGet("mediagrab-theme");

  if (saved === "light" || saved === "dark") {
    state.theme = saved;
  }

  document.documentElement.dataset.theme = state.theme;

  if (!button) return;

  button.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    storageSet("mediagrab-theme", state.theme);
  });
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

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function setupDownload() {
  const button = $("#downloadButton");
  const input = $("#urlInput");

  if (!button || !input) return;

  button.addEventListener("click", () => {
    const url = input.value.trim();

    if (!url) {
      alert(t("messages.urlRequired", "Please enter a valid media URL."));
      input.focus();
      return;
    }

    if (!isValidHttpUrl(url)) {
      alert(t("errors.invalidUrl", "Please enter a valid URL."));
      input.focus();
      return;
    }

    alert(
      t(
        "messages.backendComingSoon",
        "The download backend will be connected in the next step."
      )
    );
  });
}

/* ---------- Init ---------- */

function initialize() {
  setupLanguage();
  setupMediaTypes();
  setupAdvanced();
  setupUrl();
  setupTheme();
  setupDownload();

  const language = storageGet("mediagrab-language") === "ar" ? "ar" : "en";

  // Render defaults immediately so the UI works even if the
  // translation file fails to load.
  state.language = language;
  applyLanguage();

  loadLanguage(language);
}

document.addEventListener("DOMContentLoaded", initialize);
          
