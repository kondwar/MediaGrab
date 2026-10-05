const state = {
  language: "en",
  theme: "dark",
  mediaType: "video",
  translations: {},
  advancedOpen: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

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

function optionLabel(key, fallback) {
  return t(key, fallback);
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

function updateOptions() {
  const quality = $("#quality");
  const format = $("#format");
  const audioLanguage = $("#audioLanguage");

  if (!quality || !format || !audioLanguage) return;

  if (state.mediaType === "video") {
    setOptions(quality, [
      {
        value: "best",
        label: optionLabel(
          "options.bestAvailable",
          "Best Available"
        )
      },
      {
        value: "original",
        label: optionLabel(
          "options.originalQuality",
          "Original Quality"
        )
      },
      {
        value: "2160p",
        label: optionLabel("options.2160p", "2160p (4K)")
      },
      {
        value: "1440p",
        label: optionLabel("options.1440p", "1440p")
      },
      {
        value: "1080p",
        label: optionLabel("options.1080p", "1080p")
      },
      {
        value: "720p",
        label: optionLabel("options.720p", "720p")
      },
      {
        value: "480p",
        label: optionLabel("options.480p", "480p")
      },
      {
        value: "360p",
        label: optionLabel("options.360p", "360p")
      }
    ], "best");

    setOptions(format, [
      {
        value: "mp4",
        label: optionLabel("options.mp4", "MP4")
      },
      {
        value: "webm",
        label: optionLabel("options.webm", "WEBM")
      },
      {
        value: "mkv",
        label: optionLabel("options.mkv", "MKV")
      }
    ], "mp4");

    setOptions(audioLanguage, [
      {
        value: "any",
        label: optionLabel(
          "options.anyLanguage",
          "Any Language"
        )
      },
      {
        value: "original",
        label: optionLabel(
          "options.originalLanguage",
          "Original Language"
        )
      }
    ], "any");

  } else if (state.mediaType === "audio") {
    setOptions(quality, [
      {
        value: "original",
        label: optionLabel(
          "options.originalAudio",
          "Original Audio"
        )
      },
      {
        value: "320",
        label: optionLabel("options.320kbps", "320 kbps")
      },
      {
        value: "256",
        label: optionLabel("options.256kbps", "256 kbps")
      },
      {
        value: "192",
        label: optionLabel("options.192kbps", "192 kbps")
      },
      {
        value: "128",
        label: optionLabel("options.128kbps", "128 kbps")
      }
    ], "original");

    setOptions(format, [
      {
        value: "mp3",
        label: optionLabel("options.mp3", "MP3")
      },
      {
        value: "m4a",
        label: optionLabel("options.m4a", "M4A")
      },
      {
        value: "opus",
        label: optionLabel("options.opus", "OPUS")
      }
    ], "mp3");

    setOptions(audioLanguage, [
      {
        value: "any",
        label: optionLabel(
          "options.anyLanguage",
          "Any Language"
        )
      },
      {
        value: "original",
        label: optionLabel(
          "options.originalLanguage",
          "Original Language"
        )
      }
    ], "any");
      } else if (state.mediaType === "subtitles") {
    setOptions(quality, [
      {
        value: "available",
        label: optionLabel(
          "options.availableLanguages",
          "Available Languages"
        )
      }
    ], "available");

    setOptions(format, [
      {
        value: "srt",
        label: optionLabel("options.srt", "SRT")
      },
      {
        value: "vtt",
        label: optionLabel("options.vtt", "VTT")
      },
      {
        value: "txt",
        label: optionLabel("options.txt", "TXT")
      }
    ], "srt");

    setOptions(audioLanguage, [
      {
        value: "any",
        label: optionLabel(
          "options.anyLanguage",
          "Any Language"
        )
      },
      {
        value: "original",
        label: optionLabel(
          "options.originalLanguage",
          "Original Language"
        )
      }
    ], "any");

  } else {
    setOptions(quality, [
      {
        value: "original",
        label: optionLabel(
          "options.original",
          "Original"
        )
      }
    ], "original");

    setOptions(format, [
      {
        value: "txt",
        label: optionLabel("options.txt", "TXT")
      },
      {
        value: "json",
        label: optionLabel("options.json", "JSON")
      },
      {
        value: "html",
        label: optionLabel("options.html", "HTML")
      }
    ], "txt");

    setOptions(audioLanguage, [
      {
        value: "any",
        label: optionLabel(
          "options.anyLanguage",
          "Any Language"
        )
      }
    ], "any");
  }
}

function applyLanguage() {
  document.documentElement.lang =
    state.language;

  document.documentElement.dir =
    state.language === "ar"
      ? "rtl"
      : "ltr";

  $$("[data-i18n]").forEach(
    (element) => {
      const key =
        element.getAttribute(
          "data-i18n"
        );

      const value = t(key);

      if (value !== key) {
        element.textContent = value;
      }
    }
  );

  $$("[data-i18n-placeholder]").forEach(
    (element) => {
      const key =
        element.getAttribute(
          "data-i18n-placeholder"
        );

      const value = t(key);

      if (value !== key) {
        element.placeholder = value;
      }
    }
  );

  const languageButton =
    $("#languageButton");

  if (languageButton) {
    const label =
      languageButton.querySelector(
        "[data-language-label]"
      );

    if (label) {
      label.textContent =
        state.language === "ar"
          ? "العربية"
          : "English";
    } else {
      languageButton.setAttribute(
        "aria-label",
        state.language === "ar"
          ? "العربية"
          : "English"
      );
    }
  }

  updateOptions();
  updateAdvancedButton();
  updateDownloadButton();
}

async function loadLanguage(language) {
  try {
    const response = await fetch(
      `/translations/${language}.json?v=5`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `Translation HTTP ${response.status}`
      );
    }

    state.translations =
      await response.json();

    state.language = language;

    localStorage.setItem(
      "mediagrab-language",
      language
    );

    applyLanguage();

  } catch (error) {
    console.error(
      "Translation loading failed:",
      error
    );
  }
}

function setupLanguage() {
  const button =
    $("#languageButton");

  if (!button) return;

  button.addEventListener(
    "click",
    () => {
      const nextLanguage =
        state.language === "en"
          ? "ar"
          : "en";

      loadLanguage(nextLanguage);
    }
  );
}

function setupMediaTypes() {
  $$(".media-type").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          $$(".media-type").forEach(
            (item) => {
              item.classList.remove(
                "active"
              );

              item.setAttribute(
                "aria-selected",
                "false"
              );
            }
          );

          button.classList.add(
            "active"
          );

          button.setAttribute(
            "aria-selected",
            "true"
          );

          state.mediaType =
            button.dataset.type ||
            "video";

          updateOptions();
        }
      );
    }
  );
}

function updateAdvancedButton() {
  const button =
    $("#advancedButton");

  const options =
    $("#advancedOptions");

  if (!button || !options) return;

  const label =
    button.querySelector(
      "[data-i18n]"
    );

  if (label) {
    label.textContent =
      state.advancedOpen
        ? t(
            "advanced.hide",
            "Hide Advanced Options"
          )
        : t(
            "advanced.show",
            "Advanced Options"
          );
  }

  options.hidden =
    !state.advancedOpen;

  button.setAttribute(
    "aria-expanded",
    String(state.advancedOpen)
  );
}

function setupAdvanced() {
  const button =
    $("#advancedButton");

  const options =
    $("#advancedOptions");

  if (!button || !options) return;

  button.addEventListener(
    "click",
    () => {
      state.advancedOpen =
        !state.advancedOpen;

      updateAdvancedButton();
    }
  );
      }
function setupUrl() {
  const input = $("#urlInput");
  const clear = $("#clearUrl");

  if (!input) return;

  const updateClear = () => {
    if (clear) {
      clear.style.display =
        input.value.trim() ? "" : "none";
    }
  };

  input.addEventListener(
    "input",
    updateClear
  );

  if (clear) {
    clear.addEventListener(
      "click",
      () => {
        input.value = "";
        input.focus();
        updateClear();
      }
    );
  }

  updateClear();
}

function setupTheme() {
  const button = $("#themeButton");

  if (!button) return;

  const saved =
    localStorage.getItem(
      "mediagrab-theme"
    );

  if (
    saved === "light" ||
    saved === "dark"
  ) {
    state.theme = saved;
  }

  document.documentElement.dataset.theme =
    state.theme;

  button.addEventListener(
    "click",
    () => {
      state.theme =
        state.theme === "dark"
          ? "light"
          : "dark";

      document.documentElement.dataset.theme =
        state.theme;

      localStorage.setItem(
        "mediagrab-theme",
        state.theme
      );
    }
  );
}

function updateDownloadButton() {
  const button = $("#downloadButton");

  if (!button) return;

  const label = button.querySelector(
    "[data-i18n]"
  );

  if (label) {
    label.textContent = t(
      "download.now",
      "Download Now"
    );
  }
}

function setupDownload() {
  const button = $("#downloadButton");
  const input = $("#urlInput");

  if (!button || !input) return;

  button.addEventListener(
    "click",
    () => {
      const url =
        input.value.trim();

      if (!url) {
        alert(
          t(
            "messages.urlRequired",
            "Please enter a valid media URL."
          )
        );

        input.focus();
        return;
      }

      try {
        new URL(url);
      } catch {
        alert(
          t(
            "errors.invalidUrl",
            "Please enter a valid URL."
          )
        );

        input.focus();
        return;
      }

      alert(
        t(
          "messages.backendComingSoon",
          "The download backend will be connected in the next step."
        )
      );
    }
  );
}

function initialize() {
  setupLanguage();
  setupMediaTypes();
  setupAdvanced();
  setupUrl();
  setupTheme();
  setupDownload();

  const savedLanguage =
    localStorage.getItem(
      "mediagrab-language"
    );

  const language =
    savedLanguage === "ar"
      ? "ar"
      : "en";

  loadLanguage(language);
}

document.addEventListener(
  "DOMContentLoaded",
  initialize
);
