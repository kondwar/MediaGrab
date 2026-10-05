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

    languageButton:
        document.getElementById("languageButton"),

    themeButton:
        document.getElementById("themeButton"),

    urlInput:
        document.getElementById("urlInput"),

    clearUrl:
        document.getElementById("clearUrl"),

    mediaTypeButtons:
        document.querySelectorAll(".media-type-button"),

    quality:
        document.getElementById("quality"),

    format:
        document.getElementById("format"),

    audioLanguage:
        document.getElementById("audioLanguage"),

    advancedButton:
        document.getElementById("advancedButton"),

    advancedOptions:
        document.getElementById("advancedOptions"),

    downloadButton:
        document.getElementById("downloadButton")
};

function translate(key) {
    let value = state.translations;

    for (const part of key.split(".")) {
        if (!value || typeof value !== "object") {
            return key;
        }

        value = value[part];
    }

    return typeof value === "string"
        ? value
        : key;
}

function setOptions(select, options) {
    if (!select) return;

    select.innerHTML = "";

    options.forEach(option => {
        const item =
            document.createElement("option");

        item.value = option.value;
        item.textContent = option.label;

        select.appendChild(item);
    });
}

async function loadLanguage(language) {
    if (!supportedLanguages.includes(language)) {
        language = "en";
    }

    try {
        const response = await fetch(
            `/translations/${language}.json?v=4`,
            {
                cache: "no-store"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Translation error: ${response.status}`
            );
        }

        state.translations =
            await response.json();

    } catch (error) {
        console.error(
            "Language loading error:",
            error
        );

        state.translations = {};
    }

    state.language = language;

    localStorage.setItem(
        "mediagrab-language",
        language
    );

    applyLanguage();
        }
function applyLanguage() {
    const isArabic =
        state.language === "ar";

    elements.html.lang =
        state.language;

    elements.html.dir =
        isArabic ? "rtl" : "ltr";

    document
        .querySelectorAll("[data-i18n]")
        .forEach(element => {
            const key =
                element.getAttribute("data-i18n");

            const value =
                translate(key);

            if (value !== key) {
                element.textContent = value;
            }
        });

    document
        .querySelectorAll("[data-i18n-placeholder]")
        .forEach(element => {
            const key =
                element.getAttribute(
                    "data-i18n-placeholder"
                );

            const value =
                translate(key);

            if (value !== key) {
                element.placeholder = value;
            }
        });

    updateLanguageButton();
    updatePageMetadata();
    updateOptions();
    updateAdvancedButton();
    updateDownloadButton();
}

function updateLanguageButton() {
    if (!elements.languageButton) return;

    elements.languageButton.textContent =
        `🌐 ${languageNames[state.language]}`;
}

function createLanguageMenu() {
    const oldMenu =
        document.querySelector(".language-menu");

    if (oldMenu) {
        oldMenu.remove();
    }

    const menu =
        document.createElement("div");

    menu.className = "language-menu";

    supportedLanguages.forEach(language => {
        const button =
            document.createElement("button");

        button.type = "button";

        button.textContent =
            languageNames[language];

        if (language === state.language) {
            button.classList.add("active");
        }

        button.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                await loadLanguage(language);

                menu.remove();
            }
        );

        menu.appendChild(button);
    });

    return menu;
}

if (elements.languageButton) {
    elements.languageButton.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            const oldMenu =
                document.querySelector(
                    ".language-menu"
                );

            if (oldMenu) {
                oldMenu.remove();
                return;
            }

            const menu =
                createLanguageMenu();

            const parent =
                elements.languageButton.parentElement;

            if (parent) {
                parent.appendChild(menu);
            }
        }
    );
}

document.addEventListener(
    "click",
    () => {
        const menu =
            document.querySelector(
                ".language-menu"
            );

        if (menu) {
            menu.remove();
        }
    }
);

function updatePageMetadata() {
    const title =
        translate("site.title");

    const description =
        translate("site.description");

    if (title) {
        document.title = title;
    }

    const meta =
        document.querySelector(
            'meta[name="description"]'
        );

    if (meta && description) {
        meta.setAttribute(
            "content",
            description
        );
    }
}

function updateMediaType(type) {
    state.mediaType = type;

    elements.mediaTypeButtons.forEach(
        button => {
            button.classList.toggle(
                "active",
                button.dataset.type === type
            );
        }
    );

    updateOptions();
}

function setupMediaTypes() {
    elements.mediaTypeButtons.forEach(
        button => {
            button.addEventListener(
                "click",
                () => {
                    updateMediaType(
                        button.dataset.type
                    );
                }
            );
        }
    );
}
function optionLabel(key, english, arabic) {
    const value = translate(key);

    if (value !== key) {
        return value;
    }

    return state.language === "ar"
        ? arabic
        : english;
}

function updateOptions() {
    const type = state.mediaType;

    if (type === "video") {
        setOptions(elements.quality, [
            {
                value: "best",
                label: optionLabel(
                    "options.bestAvailable",
                    "Best Available",
                    "أفضل جودة متاحة"
                )
            },
            {
                value: "2160p",
                label: optionLabel(
                    "options.2160p",
                    "2160p (4K)",
                    "2160p (4K)"
                )
            },
            {
                value: "1440p",
                label: optionLabel(
                    "options.1440p",
                    "1440p",
                    "1440p"
                )
            },
            {
                value: "1080p",
                label: optionLabel(
                    "options.1080p",
                    "1080p",
                    "1080p"
                )
            },
            {
                value: "720p",
                label: optionLabel(
                    "options.720p",
                    "720p",
                    "720p"
                )
            },
            {
                value: "480p",
                label: optionLabel(
                    "options.480p",
                    "480p",
                    "480p"
                )
            },
            {
                value: "360p",
                label: optionLabel(
                    "options.360p",
                    "360p",
                    "360p"
                )
            }
        ]);

        setOptions(elements.format, [
            {
                value: "mp4",
                label: optionLabel(
                    "options.mp4",
                    "MP4",
                    "MP4"
                )
            },
            {
                value: "webm",
                label: optionLabel(
                    "options.webm",
                    "WEBM",
                    "WEBM"
                )
            },
            {
                value: "mkv",
                label: optionLabel(
                    "options.mkv",
                    "MKV",
                    "MKV"
                )
            }
        ]);
    }

    if (type === "audio") {
        setOptions(elements.quality, [
            {
                value: "original",
                label: optionLabel(
                    "options.originalAudio",
                    "Original Audio",
                    "الصوت الأصلي"
                )
            },
            {
                value: "320",
                label: optionLabel(
                    "options.320kbps",
                    "320 kbps",
                    "320 kbps"
                )
            },
            {
                value: "256",
                label: optionLabel(
                    "options.256kbps",
                    "256 kbps",
                    "256 kbps"
                )
            },
            {
                value: "192",
                label: optionLabel(
                    "options.192kbps",
                    "192 kbps",
                    "192 kbps"
                )
            },
            {
                value: "128",
                label: optionLabel(
                    "options.128kbps",
                    "128 kbps",
                    "128 kbps"
                )
            }
        ]);

        setOptions(elements.format, [
            {
                value: "mp3",
                label: optionLabel(
                    "options.mp3",
                    "MP3",
                    "MP3"
                )
            },
            {
                value: "m4a",
                label: optionLabel(
                    "options.m4a",
                    "M4A",
                    "M4A"
                )
            },
            {
                value: "opus",
                label: optionLabel(
                    "options.opus",
                    "OPUS",
                    "OPUS"
                )
            }
        ]);
    }

    if (type === "subtitles") {
        setOptions(elements.quality, [
            {
                value: "original",
                label: optionLabel(
                    "options.originalLanguage",
                    "Original Language",
                    "اللغة الأصلية"
                )
            }
        ]);

        setOptions(elements.format, [
            {
                value: "srt",
                label: optionLabel(
                    "options.srt",
                    "SRT",
                    "SRT"
                )
            },
            {
                value: "vtt",
                label: optionLabel(
                    "options.vtt",
                    "VTT",
                    "VTT"
                )
            },
            {
                value: "txt",
                label: optionLabel(
                    "options.txt",
                    "TXT",
                    "TXT"
                )
            }
        ]);
    }

    if (type === "text") {
        setOptions(elements.quality, [
            {
                value: "original",
                label: optionLabel(
                    "options.original",
                    "Original",
                    "أصلي"
                )
            }
        ]);

        setOptions(elements.format, [
            {
                value: "txt",
                label: optionLabel(
                    "options.txt",
                    "TXT",
                    "TXT"
                )
            },
            {
                value: "json",
                label: optionLabel(
                    "options.json",
                    "JSON",
                    "JSON"
                )
            },
            {
                value: "html",
                label: optionLabel(
                    "options.html",

                    function setupUrl() {
    if (!elements.urlInput) return;

    elements.urlInput.addEventListener(
        "input",
        () => {
            if (elements.clearUrl) {
                elements.clearUrl.hidden =
                    elements.urlInput.value.trim() === "";
            }
        }
    );

    if (elements.clearUrl) {
        elements.clearUrl.addEventListener(
            "click",
            () => {
                elements.urlInput.value = "";
                elements.clearUrl.hidden = true;
                elements.urlInput.focus();
            }
        );
    }
}

function setupTheme() {
    document.documentElement.dataset.theme =
        state.theme;

    if (!elements.themeButton) return;

    elements.themeButton.addEventListener(
        "click",
        () => {
            state.theme =
                state.theme === "dark"
                    ? "light"
                    : "dark";

            localStorage.setItem(
                "mediagrab-theme",
                state.theme
            );

            document.documentElement.dataset.theme =
                state.theme;
        }
    );
}

function setupDownload() {
    if (!elements.downloadButton) return;

    elements.downloadButton.addEventListener(
        "click",
        () => {
            const url =
                elements.urlInput?.value.trim();

            if (!url) {
                alert(
                    translate(
                        "messages.urlRequired"
                    )
                );
                return;
            }

            try {
                new URL(url);
            } catch {
                alert(
                    translate(
                        "errors.invalidUrl"
                    )
                );
                return;
            }

            alert(
                translate(
                    "messages.backendComingSoon"
                )
            );
        }
    );
}

function initialize() {
    setupMediaTypes();
    setupAdvanced();
    setupUrl();
    setupTheme();
    setupDownload();

    updateMediaType("video");

    if (elements.clearUrl) {
        elements.clearUrl.hidden =
            !elements.urlInput?.value.trim();
    }

    loadLanguage(state.language);
}

document.addEventListener(
    "DOMContentLoaded",
    initialize
);
