"use strict";

/*
 * MediaGrab
 * Frontend controller
 *
 * This file currently handles UI interactions only.
 * Real media extraction will be connected later to the backend.
 */

document.addEventListener("DOMContentLoaded", () => {

    const mediaUrl = document.getElementById("mediaUrl");
    const clearUrl = document.getElementById("clearUrl");
    const downloadButton = document.getElementById("downloadButton");
    const advancedButton = document.getElementById("advancedButton");
    const themeButton = document.getElementById("themeButton");
    const languageButton = document.getElementById("languageButton");

    const mediaTypeButtons =
        document.querySelectorAll(".media-type");

    const qualitySelect =
        document.getElementById("quality");

    const formatSelect =
        document.getElementById("format");

    const languageSelect =
        document.getElementById("language");


    /* =========================
       Current State
    ========================= */

    const state = {
        mediaType: "video",
        theme: "dark",
        language: "en",
        advancedOpen: false
    };


    /* =========================
       Media Type Selection
    ========================= */

    mediaTypeButtons.forEach((button) => {

        button.addEventListener("click", () => {

            mediaTypeButtons.forEach((item) => {
                item.classList.remove("active");
            });

            button.classList.add("active");

            state.mediaType =
                button.dataset.type || "video";

            updateOptionsForType(state.mediaType);
        });

    });


    /* =========================
       Dynamic Options
    ========================= */

    function updateOptionsForType(type) {

        if (!qualitySelect || !formatSelect || !languageSelect) {
            return;
        }

        qualitySelect.innerHTML = "";
        formatSelect.innerHTML = "";
        languageSelect.innerHTML = "";


        if (type === "video") {

            addOption(
                qualitySelect,
                "best",
                "Best Available"
            );

            addOption(
                formatSelect,
                "mp4",
                "MP4"
            );

            addOption(
                formatSelect,
                "webm",
                "WEBM"
            );

            addOption(
                languageSelect,
                "any",
                "Any Language"
            );

        }


        else if (type === "audio") {

            addOption(
                qualitySelect,
                "best",
                "Best Available"
            );

            addOption(
                qualitySelect,
                "320",
                "320 kbps"
            );

            addOption(
                qualitySelect,
                "256",
                "256 kbps"
            );

            addOption(
                qualitySelect,
                "192",
                "192 kbps"
            );

            addOption(
                qualitySelect,
                "128",
                "128 kbps"
            );


            addOption(
                formatSelect,
                "mp3",
                "MP3"
            );

            addOption(
                formatSelect,
                "m4a",
                "M4A"
            );

            addOption(
                formatSelect,
                "opus",
                "OPUS"
            );


            addOption(
                languageSelect,
                "original",
                "Original Audio"
            );

        }


        else if (type === "subtitles") {

            addOption(
                qualitySelect,
                "original",
                "Original"
            );


            addOption(
                formatSelect,
                "srt",
                "SRT"
            );

            addOption(
                formatSelect,
                "vtt",
                "VTT"
            );

            addOption(
                formatSelect,
                "txt",
                "TXT"
            );


            addOption(
                languageSelect,
                "auto",
                "Available Languages"
            );

        }


        else if (type === "text") {

            addOption(
                qualitySelect,
                "original",
                "Original"
            );


            addOption(
                formatSelect,
                "txt",
                "TXT"
            );

            addOption(
                formatSelect,
                "json",
                "JSON"
            );

            addOption(
                formatSelect,
                "html",
                "HTML"
            );


            addOption(
                languageSelect,
                "original",
                "Original Language"
            );
        }
    }


    function addOption(select, value, label) {

        const option =
            document.createElement("option");

        option.value = value;
        option.textContent = label;

        select.appendChild(option);
    }


    /* =========================
       Clear URL
    ========================= */

    if (clearUrl) {

        clearUrl.addEventListener("click", () => {

            mediaUrl.value = "";

            mediaUrl.focus();
        });

    }


    /* =========================
       Advanced Options
    ========================= */

    if (advancedButton) {

        advancedButton.addEventListener("click", () => {

            state.advancedOpen =
                !state.advancedOpen;

            advancedButton.classList.toggle(
                "open",
                state.advancedOpen
            );

            const arrow =
                advancedButton.querySelector(".arrow");

            if (arrow) {

                arrow.textContent =
                    state.advancedOpen
                        ? "⌃"
                        : "⌄";
            }

            /*
             * Advanced settings will be added
             * when the backend is connected.
             */
        });

    }


    /* =========================
       Theme
    ========================= */

    if (themeButton) {

        themeButton.addEventListener("click", () => {

            state.theme =
                state.theme === "dark"
                    ? "light"
                    : "dark";

            document.body.classList.toggle(
                "light-theme",
                state.theme === "light"
            );

            themeButton.textContent =
                state.theme === "dark"
                    ? "☾"
                    : "☀";

        });

    }


    /* =========================
       Language
    ========================= */

    if (languageButton) {

        languageButton.addEventListener("click", () => {

            /*
             * Full language selector will be implemented
             * with translations/en.json and translations/ar.json.
             */

            alert(
                "Language selector will be enabled in the next step."
            );
        });

    }


    /* =========================
       Download
    ========================= */

    if (downloadButton) {

        downloadButton.addEventListener("click", () => {

            const url =
                mediaUrl.value.trim();

            if (!url) {

                alert(
                    "Please paste a media URL first."
                );

                mediaUrl.focus();

                return;
            }


            const selectedOptions = {

                type: state.mediaType,

                quality:
                    qualitySelect?.value || null,

                format:
                    formatSelect?.value || null,

                language:
                    languageSelect?.value || null
            };


            console.log(
                "MediaGrab request:",
                {
                    url,
                    ...selectedOptions
                }
            );


            alert(
                "The download engine will be connected after the backend is ready."
            );
        });

    }


    /* =========================
       Initial State
    ========================= */

    updateOptionsForType("video");

});
