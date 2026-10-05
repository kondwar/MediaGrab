const state = {
    mediaType: "video",
    theme: localStorage.getItem("mediagrab-theme") || "dark",
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
    languageButton: document.getElementById("languageButton"),
    themeButton: document.getElementById("themeButton"),
    languageSelector: document.getElementById("languageSelector"),

    urlInput: document.getElementById("urlInput"),
    clearUrl: document.getElementById("clearUrl"),

    mediaTypeButtons: document.querySelectorAll(".media-type-button"),

    quality: document.getElementById("quality"),
    format: document.getElementById("format"),
    audioLanguage: document.getElementById("audioLanguage"),

    advancedButton: document.getElementById("advancedButton"),
    advancedOptions: document.getElementById("advancedOptions"),

    downloadButton: document.getElementById("downloadButton")
};


/* =========================================================
   Translation helpers
========================================================= */

function getTranslationObject(path, fallback = "") {
    const parts = path.split(".");
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


function translate(key) {
    return getTranslationObject(key, key);
}


/* =========================================================
   Load language
========================================================= */

async function loadLanguage(language) {
    if (!supportedLanguages.includes(language)) {
        language = "en";
    }

    try {
        const response = await fetch(
            `/translations/${language}.json`,
            {
                cache: "no-cache"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Translation file failed: ${response.status}`
            );
        }

        state.translations = await response.json();
        state.language = language;

        localStorage.setItem(
            "mediagrab-language",
            language
        );

        applyLanguage();

    } catch (error) {
        console.error("Language loading error:", error);

        if (language !== "en") {
            await loadLanguage("en");
        }
    }
}


/* =========================================================
   Apply language
========================================================= */

function applyLanguage() {
    const isArabic = state.language === "ar";

    elements.html.lang = state.language;
    elements.html.dir = isArabic ? "rtl" : "ltr";

    document.querySelectorAll("[data-i18n]").forEach((element) => {
        const key = element.getAttribute("data-i18n");
        const value = translate(key);

        if (value) {
            element.textContent = value;
        }
    });

    document
        .querySelectorAll("[data-i18n-placeholder]")
        .forEach((element) => {
            const key = element.getAttribute(
                "data-i18n-placeholder"
            );

            element.placeholder = translate(key);
        });

    updateLanguageButton();
    updateAdvancedButton();
    updateDownloadButton();
    updatePageMetadata();
    updateOptionsForType();
}


/* =========================================================
   Page metadata
========================================================= */

function updatePageMetadata() {
    const title = translate("site.title");
    const description = translate("site.description");

    if (title) {
        document.title = title;
    }

    const descriptionElement =
        document.querySelector('meta[name="description"]');

    if (descriptionElement && description) {
        descriptionElement.setAttribute(
            "content",
            description
        );
    }
}


/* =========================================================
   Language selector
========================================================= */

function updateLanguageButton() {
    if (!elements.languageButton) {
        return;
    }

    const languageName =
        languageNames[state.language] || "English";

    elements.languageButton.textContent =
        `🌐 ${languageName}`;
}


function createLanguageMenu() {
    const existingMenu =
        document.querySelector(".language-menu");

    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement("div");

    menu.className = "language-menu";

    supportedLanguages.forEach((language) => {
        const button = document.createElement("button");

        button.type = "button";
        button.textContent =
            languageNames[language];

        if (language === state.language) {
            button.classList.add("active");
        }

        button.addEventListener("click", async (event) => {
            event.stopPropagation();

            await loadLanguage(language);

            menu.remove();
        });

        menu.appendChild(button);
    });

    return menu;
}


if (elements.languageButton) {
    elements.languageButton.addEventListener(
        "click",
        (event) => {
            event.stopPropagation();

            const existingMenu =
                document.querySelector(".language-menu");

            if (existingMenu) {
                existingMenu.remove();
                return;
            }

            const menu = createLanguageMenu();

            const wrapper =
                elements.languageButton.parentElement;

            if (wrapper) {
                wrapper.appendChild(menu);
            } else {
                document.body.appendChild(menu);
            }
        }
    );
}


document.addEventListener("click", () => {
    const menu =
        document.querySelector(".language-menu");

    if (menu) {
        menu.remove();
    }
});


/* =========================================================
   Media type
========================================================= */

function updateMediaType(type) {
    state.mediaType = type;

    elements.mediaTypeButtons.forEach((button) => {
        const buttonType =
            button.getAttribute("data-type");

        button.classList.toggle(
            "active",
            buttonType === type
        );
    });

    updateOptionsForType();
}


function setupMediaTypeButtons() {
    elements.mediaTypeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const type =
                button.getAttribute("data-type");

            if (type) {
                updateMediaType(type);
            }
        });
    });
}


/* =========================================================
   Select helpers
========================================================= */

function setSelectOptions(select, options) {
    if (!select) {
        return;
    }

    select.innerHTML = "";

    options.forEach((option) => {
        const optionElement =
            document.createElement("option");

        optionElement.value = option.value;
        optionElement.textContent = option.label;

        select.appendChild(optionElement);
    });
}


/* =========================================================
   Dynamic options
========================================================= */

function updateOptionsForType() {
    if (!elements.quality ||
        !elements.format ||
        !elements.audioLanguage) {
        return;
    }

    if (state.mediaType === "video") {

        setSelectOptions(elements.quality, [
            {
                value: "best",
                label: translate(
                    "options.bestAvailable"
                )
            },
            {
                value: "2160p",
                label: "2160p"
            },
            {
                value: "1440p",
                label: "1440p"
            },
            {
                value: "1080p",
                label: "1080p"
            },
            {
                value: "720p",
                label: "720p"
            },
            {
                value: "480p",
                label: "480p"
            },
            {
                value: "360p",
                label: "360p"
            }
        ]);

        setSelectOptions(elements.format, [
            {
                value: "mp4",
                label: "MP4"
            },
            {
                value: "webm",
                label: "WEBM"
            },
            {
                value: "mkv",
                label: "MKV"
            }
        ]);

        setSelectOptions(elements.audioLanguage, [
            {
                value: "original",
                label: translate(
                    "options.originalAudio"
                )
            },
            {
                value: "any",
                label: translate(
                    "options.anyLanguage"
                )
            }
        ]);

    } else if (state.mediaType === "audio") {

        setSelectOptions(elements.quality, [
            {
                value: "best",
                label: translate(
                    "options.bestAvailable"
                )
            },
            {
                value: "320",
                label: "320 kbps"
            },
            {
                value: "256",
                label: "256 kbps"
            },
            {
                value: "192",
                label: "192 kbps"
            },
            {
                value: "128",
                label: "128 kbps"
            }
        ]);

        setSelectOptions(elements.format, [
            {
                value: "mp3",
                label: "MP3"
            },
            {
                value: "m4a",
                label: "M4A"
            },
            {
                value: "opus",
                label: "OPUS"
            }
        ]);

        setSelectOptions(elements.audioLanguage, [
            {
                value: "original",
                label: translate(
                    "options.originalAudio"
                )
            },
            {
                value: "any",
                label: translate(
                    "options.anyLanguage"
                )
            }
        ]);

    } else if (state.mediaType === "subtitles") {

        setSelectOptions(elements.quality, [
            {
                value: "available",
                label: translate(
                    "options.availableLanguages"
                )
            }
        ]);

        setSelectOptions(elements.format, [
            {
                value: "srt",
                label: "SRT"
            },
            {
                value: "vtt",
                label: "VTT"
            },
            {
                value: "txt",
                label: "TXT"
            }
        ]);

        setSelectOptions(elements.audioLanguage, [
            {
                value: "original",
                label: translate(
                    "options.originalLanguage"
                )
            },
            {
                value: "any",
                label: translate(
                    "options.anyLanguage"
                )
            }
        ]);

    } else if (state.mediaType === "text") {

        setSelectOptions(elements.quality, [
            {
                value: "original",
                label: translate(
                    "options.original"
                )
            }
        ]);

        setSelectOptions(elements.format, [
            {
                value: "txt",
                label: "TXT"
            },
            {
                value: "json",
                label: "JSON"
            },
            {
                value: "html",
                label: "HTML"
            }
        ]);

        setSelectOptions(elements.audioLanguage, [
            {
                value: "original",
                label: translate(
                    "options.originalLanguage"
                )
            }
        ]);
    }
}


/* =========================================================
   URL input
========================================================= */

function updateClearButton() {
    if (!elements.clearUrl ||
        !elements.urlInput) {
        return;
    }

    const hasValue =
        elements.urlInput.value.trim().length > 0;

    elements.clearUrl.classList.toggle(
        "visible",
        hasValue
    );
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


/* =========================================================
   Advanced options
========================================================= */

function updateAdvancedButton() {
    if (!elements.advancedButton) {
        return;
    }

    const key = state.advancedOpen
        ? "advanced.hide"
        : "advanced.show";

    const text = translate(key);

    elements.advancedButton.textContent =
        text || translate("advanced.title");
}


if (elements.advancedButton) {
    elements.advancedButton.addEventListener(
        "click",
        () => {
            state.advancedOpen =
                !state.advancedOpen;

            if (elements.advancedOptions) {
                elements.advancedOptions.classList.toggle(
                    "open",
                    state.advancedOpen
                );

                elements.advancedOptions.hidden =
                    !state.advancedOpen;
            }

            updateAdvancedButton();
        }
    );
}


/* =========================================================
   Theme
========================================================= */

function applyTheme() {
    elements.html.dataset.theme =
        state.theme;

    document.body.classList.toggle(
        "light-theme",
        state.theme === "light"
    );

    localStorage.setItem(
        "mediagrab-theme",
        state.theme
    );
}


if (elements.themeButton) {
    elements.themeButton.addEventListener(
        "click",
        () => {
            state.theme =
                state.theme === "dark"
                    ? "light"
                    : "dark";

            applyTheme();
        }
    );
}


/* =========================================================
   Download button
========================================================= */

function updateDownloadButton() {
    if (!elements.downloadButton) {
        return;
    }

    const text =
        translate("download.now") ||
        translate("download.download") ||
        "Download";

    elements.downloadButton.textContent = text;
}


if (elements.downloadButton) {
    elements.downloadButton.addEventListener(
        "click",
        () => {
            const url =
                elements.urlInput
                    ? elements.urlInput.value.trim()
                    : "";

            if (!url) {
                alert(
                    translate("messages.urlRequired")
                );

                if (elements.urlInput) {
                    elements.urlInput.focus();
                }

                return;
            }

            /*
             * Backend integration will be connected here.
             *
             * Current frontend validates the URL only.
             */

            alert(
                translate(
                    "messages.backendComingSoon"
                )
            );
        }
    );
}


/* =========================================================
   Initialization
========================================================= */

async function initialize() {
    applyTheme();

    setupMediaTypeButtons();

    updateMediaType(
        state.mediaType
    );

    updateClearButton();

    if (
        elements.advancedOptions &&
        !state.advancedOpen
    ) {
        elements.advancedOptions.hidden = true;
    }

    await loadLanguage(
        state.language
    );
}


initialize();
