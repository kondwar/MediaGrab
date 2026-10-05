const state = {
  mediaType: "video",
  theme: "dark",
  language: localStorage.getItem("mediagrab-language") || "en",
  advancedOpen: false,
  translations: {}
};

const languageNames = {
  en: "English",
  ar: "العربية"
};

const supportedLanguages = ["en", "ar"];

const elements = {
  html: document.documentElement,
  urlInput: document.querySelector("#urlInput"),
  clearUrl: document.querySelector("#clearUrl"),
  mediaTypeButtons: document.querySelectorAll("[data-type]"),
  qualitySelect: document.querySelector("#quality"),
  formatSelect: document.querySelector("#format"),
  audioLanguageSelect: document.querySelector("#audioLanguage"),
  advancedButton: document.querySelector("#advancedButton"),
  advancedOptions: document.querySelector("#advancedOptions"),
  themeButton: document.querySelector("#themeButton"),
  languageButton: document.querySelector("#languageButton"),
  downloadButton: document.querySelector("#downloadButton")
};


/* =========================
   Translation Helpers
========================= */

function getTranslationObject(object, path) {
  return path.split(".").reduce((current, key) => {
    return current && current[key] !== undefined
      ? current[key]
      : undefined;
  }, object);
}

function translate(path) {
  return getTranslationObject(state.translations, path) || path;
}


/* =========================
   Load Translation
========================= */

async function loadLanguage(language) {
  if (!supportedLanguages.includes(language)) {
    language = "en";
  }

  try {
    const response = await fetch(`../translations/${language}.json`);

    if (!response.ok) {
      throw new Error(`Translation file not found: ${language}`);
    }

    state.translations = await response.json();
    state.language = language;

    localStorage.setItem("mediagrab-language", language);

    applyLanguage();
  } catch (error) {
    console.error("Language loading failed:", error);

    if (language !== "en") {
      await loadLanguage("en");
    }
  }
}


/* =========================
   Apply Language
========================= */

function applyLanguage() {
  const isArabic = state.language === "ar";

  elements.html.lang = state.language;
  elements.html.dir = isArabic ? "rtl" : "ltr";

  /*
   * Translate elements that use data-i18n
   */
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    const value = translate(key);

    if (value && value !== key) {
      element.textContent = value;
    }
  });

  /*
   * Translate placeholders
   */
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    const value = translate(key);

    if (value && value !== key) {
      element.placeholder = value;
    }
  });

  /*
   * Update language button
   */
  if (elements.languageButton) {
    elements.languageButton.textContent =
      `🌐 ${languageNames[state.language] || state.language}`;
  }

  /*
   * Update page title
   */
  document.title = translate("site.title");

  /*
   * Update description
   */
  const description = document.querySelector('meta[name="description"]');

  if (description) {
    description.setAttribute(
      "content",
      translate("site.description")
    );
  }

  /*
   * Rebuild media options in selected language
   */
  updateOptionsForType();
}


/* =========================
   Media Type
========================= */

function updateMediaType(type) {
  state.mediaType = type;

  elements.mediaTypeButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.type === type
    );
  });

  updateOptionsForType();
}


/* =========================
   Dynamic Options
========================= */

function setSelectOptions(select, options) {
  if (!select) return;

  select.innerHTML = "";

  options.forEach((option) => {
    const optionElement = document.createElement("option");

    optionElement.value = option.value;
    optionElement.textContent = option.label;

    select.appendChild(optionElement);
  });
}


function updateOptionsForType() {

  if (state.mediaType === "video") {

    setSelectOptions(elements.qualitySelect, [
      {
        value: "best",
        label: translate("options.bestAvailable")
      },
      {
        value: "2160p",
        label: translate("options.2160p")
      },
      {
        value: "1440p",
        label: translate("options.1440p")
      },
      {
        value: "1080p",
        label: translate("options.1080p")
      },
      {
        value: "720p",
        label: translate("options.720p")
      },
      {
        value: "480p",
        label: translate("options.480p")
      },
      {
        value: "360p",
        label: translate("options.360p")
      }
    ]);

    setSelectOptions(elements.formatSelect, [
      {
        value: "mp4",
        label: translate("options.mp4")
      },
      {
        value: "webm",
        label: translate("options.webm")
      },
      {
        value: "mkv",
        label: translate("options.mkv")
      }
    ]);

    setSelectOptions(elements.audioLanguageSelect, [
      {
        value: "any",
        label: translate("options.anyLanguage")
      },
      {
        value: "original",
        label: translate("options.originalAudio")
      }
    ]);
  }


  else if (state.mediaType === "audio") {

    setSelectOptions(elements.qualitySelect, [
      {
        value: "best",
        label: translate("options.bestAvailable")
      },
      {
        value: "320",
        label: translate("options.320kbps")
      },
      {
        value: "256",
        label: translate("options.256kbps")
      },
      {
        value: "192",
        label: translate("options.192kbps")
      },
      {
        value: "128",
        label: translate("options.128kbps")
      }
    ]);

    setSelectOptions(elements.formatSelect, [
      {
        value: "mp3",
        label: translate("options.mp3")
      },
      {
        value: "m4a",
        label: translate("options.m4a")
      },
      {
        value: "opus",
        label: translate("options.opus")
      }
    ]);

    setSelectOptions(elements.audioLanguageSelect, [
      {
        value: "original",
        label: translate("options.originalAudio")
      },
      {
        value: "any",
        label: translate("options.anyLanguage")
      }
    ]);
  }


  else if (state.mediaType === "subtitles") {

    setSelectOptions(elements.qualitySelect, [
      {
        value: "available",
        label: translate("options.availableLanguages")
      }
    ]);

    setSelectOptions(elements.formatSelect, [
      {
        value: "srt",
        label: translate("options.srt")
      },
      {
        value: "vtt",
        label: translate("options.vtt")
      },
      {
        value: "txt",
        label: translate("options.txt")
      }
    ]);

    setSelectOptions(elements.audioLanguageSelect, [
      {
        value: "original",
        label: translate("options.originalLanguage")
      },
      {
        value: "any",
        label: translate("options.anyLanguage")
      }
    ]);
  }


  else if (state.mediaType === "text") {

    setSelectOptions(elements.qualitySelect, [
      {
        value: "original",
        label: translate("options.original")
      }
    ]);

    setSelectOptions(elements.formatSelect, [
      {
        value: "txt",
        label: translate("options.txt")
      },
      {
        value: "json",
        label: translate("options.json")
      },
      {
        value: "html",
        label: translate("options.html")
      }
    ]);

    setSelectOptions(elements.audioLanguageSelect, [
      {
        value: "original",
        label: translate("options.originalLanguage")
      },
      {
        value: "any",
        label: translate("options.anyLanguage")
      }
    ]);
  }
}


/* =========================
   URL Input
========================= */

function updateClearButton() {
  if (!elements.clearUrl || !elements.urlInput) return;

  elements.clearUrl.style.display =
    elements.urlInput.value.trim()
      ? "block"
      : "none";
}

if (elements.urlInput) {
  elements.urlInput.addEventListener(
    "input",
    updateClearButton
  );
}

if (elements.clearUrl) {
  elements.clearUrl.addEventListener(
    "click",
    () => {
      elements.urlInput.value = "";
      updateClearButton();
      elements.urlInput.focus();
    }
  );
}


/* =========================
   Advanced Options
========================= */

if (elements.advancedButton) {
  elements.advancedButton.addEventListener(
    "click",
    () => {

      state.advancedOpen = !state.advancedOpen;

      if (elements.advancedOptions) {
        elements.advancedOptions.classList.toggle(
          "open",
          state.advancedOpen
        );
      }

      const text = state.advancedOpen
        ? translate("advanced.hide")
        : translate("advanced.show");

      elements.advancedButton.textContent = text;
    }
  );
}


/* =========================
   Theme
========================= */

if (elements.themeButton) {
  elements.themeButton.addEventListener(
    "click",
    () => {

      state.theme =
        state.theme === "dark"
          ? "light"
          : "dark";

      document.body.classList.toggle(
        "light-theme",
        state.theme === "light"
      );

      localStorage.setItem(
        "mediagrab-theme",
        state.theme
      );
    }
  );
}


/* =========================
   Language Selector
========================= */

function showLanguageSelector() {

  const existing =
    document.querySelector(".language-menu");

  if (existing) {
    existing.remove();
    return;
  }

  const menu = document.createElement("div");

  menu.className = "language-menu";

  supportedLanguages.forEach((language) => {

    const button = document.createElement("button");

    button.type = "button";
    button.textContent =
      languageNames[language];

    button.classList.toggle(
      "active",
      language === state.language
    );

    button.addEventListener(
      "click",
      async () => {

        menu.remove();

        await loadLanguage(language);
      }
    );

    menu.appendChild(button);
  });

  document.body.appendChild(menu);
}


if (elements.languageButton) {
  elements.languageButton.addEventListener(
    "click",
    showLanguageSelector
  );
}


/* =========================
   Download
========================= */

if (elements.downloadButton) {

  elements.downloadButton.addEventListener(
    "click",
    () => {

      const url =
        elements.urlInput?.value.trim();

      if (!url) {
        alert(
          translate("messages.urlRequired")
        );
        return;
      }

      alert(
        translate("messages.backendComingSoon")
      );
    }
  );
}


/* =========================
   Media Type Buttons
========================= */

elements.mediaTypeButtons.forEach((button) => {

  button.addEventListener(
    "click",
    () => {
      updateMediaType(button.dataset.type);
    }
  );

});


/* =========================
   Restore Theme
========================= */

const savedTheme =
  localStorage.getItem("mediagrab-theme");

if (savedTheme) {

  state.theme = savedTheme;

  document.body.classList.toggle(
    "light-theme",
    savedTheme === "light"
  );
}


/* =========================
   Initialize
========================= */

async function initialize() {

  await loadLanguage(state.language);

  updateMediaType(state.mediaType);

  updateClearButton();
}

initialize();
