/*
 * Pure helpers that turn the REAL formats returned by /api/info into the
 * options shown in the interface. No quality list is hard-coded here.
 * Works in the browser (window.MediaGrabFormats) and in Node (tests).
 */
(function (root) {
  "use strict";

  var CONVERSIONS = ["mp3", "m4a", "opus"];
  var MP3_BITRATES = ["128", "192", "256", "320"];
  var SUBTITLE_FORMATS = ["srt", "vtt", "txt"];
  var TEXT_FORMATS = ["txt", "json", "html"];

  function shortCodec(codec) {
    if (!codec || codec === "none") return "";
    return String(codec).split(".")[0];
  }

  function groupKey(f) {
    var height = f.height || 0;
    var fps = f.fps && f.fps > 30 ? Math.round(f.fps) : 0;
    return height + "p" + (fps || "");
  }

  function groupLabel(f, unknownLabel) {
    if (!f.height) return unknownLabel || "Unknown";
    var fps = f.fps && f.fps > 30 ? " " + Math.round(f.fps) + "fps" : "";
    return f.height + "p" + fps;
  }

  /* ---------- Video ---------- */

  function videoQualityOptions(video, unknownLabel) {
    var seen = {};
    var options = [];

    (video || []).forEach(function (f) {
      var key = groupKey(f);
      if (seen[key]) return;
      seen[key] = true;
      options.push({ value: key, label: groupLabel(f, unknownLabel) });
    });

    return options;
  }

  function videoFormatOptions(video, key, mergeNote) {
    var items = (video || []).filter(function (f) {
      return groupKey(f) === key;
    });

    var seenLabels = {};

    return items.map(function (f) {
      var parts = [String(f.ext || "?").toUpperCase()];
      var codec = shortCodec(f.vcodec);

      if (codec) parts.push(codec);

      var label = parts.join(" · ");

      if (f.kind === "video_only") {
        label += " (" + (mergeNote || "video + audio") + ")";
      }

      if (f.filesize_text) label += " · " + f.filesize_text;

      // Keep labels unique so the user can tell options apart.
      if (seenLabels[label]) {
        seenLabels[label] += 1;
        label += " #" + seenLabels[label];
      } else {
        seenLabels[label] = 1;
      }

      return { value: f.format_id, label: label };
    });
  }

  /* ---------- Audio ---------- */

  function audioSources(formats) {
    var audio = (formats && formats.audio) || [];
    var video = (formats && formats.video) || [];

    if (audio.length) {
      return {
        requiresConversion: false,
        options: audio.map(function (f) {
          var label = f.quality + " · " + String(f.ext || "?").toUpperCase();
          if (f.language) label += " · " + f.language;
          if (f.filesize_text) label += " · " + f.filesize_text;
          return { value: f.format_id, label: label, ext: f.ext };
        })
      };
    }

    // Some platforms offer no separate audio stream (video+audio only):
    // audio can then only be extracted (converted) from the smallest one.
    var combined = video
      .filter(function (f) { return f.kind === "combined"; })
      .sort(function (a, b) { return (a.height || 0) - (b.height || 0); });

    if (!combined.length) {
      return { requiresConversion: true, options: [] };
    }

    var f = combined[0];

    return {
      requiresConversion: true,
      options: [{
        value: f.format_id,
        label: String(f.ext || "?").toUpperCase() +
          (f.height ? " · " + f.height + "p" : ""),
        ext: f.ext
      }]
    };
  }

  function conversionOptions(sourceExt, requiresConversion, originalLabel) {
    var options = [];

    if (!requiresConversion) {
      options.push({ value: "original", label: originalLabel || "Original" });
    }

    CONVERSIONS.forEach(function (name) {
      if (name === String(sourceExt || "").toLowerCase()) return;
      options.push({ value: name, label: name.toUpperCase() });
    });

    return options;
  }

  /* ---------- Subtitles ---------- */

  function subtitleOptions(tracks, autoLabel) {
    return (tracks || []).map(function (track) {
      var label = track.name ? track.lang + " — " + track.name : track.lang;
      if (track.auto) label += " (" + (autoLabel || "auto") + ")";
      return {
        value: (track.auto ? "a:" : "m:") + track.lang,
        label: label
      };
    });
  }

  function parseSubtitleValue(value) {
    var text = String(value || "");
    return {
      auto: text.indexOf("a:") === 0,
      lang: text.slice(2)
    };
  }

  /* ---------- Audio languages ---------- */

  function audioLanguageOptions(languages, anyLabel) {
    var list = languages || [];

    if (list.length < 2) return [];

    return [{ value: "", label: anyLabel || "Any" }].concat(
      list.map(function (l) { return { value: l, label: l }; })
    );
  }

  /* ---------- Direct mode (the user's device downloads) ---------- */

  function directOnly(list) {
    return (list || []).filter(function (f) {
      return f.direct && f.direct_url;
    });
  }

  function directFormats(formats) {
    return {
      video: directOnly(formats && formats.video),
      audio: directOnly(formats && formats.audio)
    };
  }

  function tracksWithFiles(tracks) {
    return (tracks || []).filter(function (t) {
      return t.files && t.files.length;
    });
  }

  function subtitleFormatOptions(track) {
    if (!track || !track.files) return [];

    var seen = {};
    var options = [];

    track.files.forEach(function (file) {
      if (!file.ext || seen[file.ext]) return;
      seen[file.ext] = true;
      options.push({ value: file.ext, label: String(file.ext).toUpperCase() });
    });

    return options;
  }

  function subtitleFileUrl(track, ext) {
    var file = ((track && track.files) || []).filter(function (f) {
      return f.ext === ext;
    })[0];

    return file ? file.url : null;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Description + metadata exactly as the source reports it. */
  function buildTextExport(info, format) {
    var data = {
      title: info.title,
      uploader: info.uploader,
      platform: info.platform,
      webpage_url: info.webpage_url,
      duration: info.duration,
      view_count: info.view_count,
      description: info.description
    };

    var keys = Object.keys(data).filter(function (k) {
      return data[k] !== null && data[k] !== undefined && data[k] !== "";
    });

    if (format === "json") {
      return {
        content: JSON.stringify(data, null, 2) + "\n",
        ext: "json",
        mime: "application/json"
      };
    }

    if (format === "html") {
      var rows = keys.map(function (k) {
        return "<tr><th>" + escapeHtml(k) + "</th><td>" +
          escapeHtml(data[k]) + "</td></tr>";
      }).join("");

      return {
        content: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' +
          escapeHtml(data.title || "MediaGrab") + "</title></head><body><table>" +
          rows + "</table></body></html>\n",
        ext: "html",
        mime: "text/html"
      };
    }

    return {
      content: keys.map(function (k) { return k + ": " + data[k]; })
        .join("\n") + "\n",
      ext: "txt",
      mime: "text/plain"
    };
  }

  /* ---------- Misc ---------- */

  function filenameFromDisposition(header) {
    if (!header) return null;

    var star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);

    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch (e) { /* fall through */ }
    }

    var plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);

    return plain ? plain[1] : null;
  }

  function errorMessage(payload, fallback) {
    if (payload && payload.detail) {
      if (typeof payload.detail === "string") return payload.detail;
      if (payload.detail.error) return payload.detail.error;
    }
    return fallback;
  }

  function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return "";
    var s = Math.round(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return h ? h + ":" + pad(m) + ":" + pad(sec) : m + ":" + pad(sec);
  }

  var api = {
    CONVERSIONS: CONVERSIONS,
    MP3_BITRATES: MP3_BITRATES,
    SUBTITLE_FORMATS: SUBTITLE_FORMATS,
    TEXT_FORMATS: TEXT_FORMATS,
    videoQualityOptions: videoQualityOptions,
    videoFormatOptions: videoFormatOptions,
    audioSources: audioSources,
    conversionOptions: conversionOptions,
    subtitleOptions: subtitleOptions,
    parseSubtitleValue: parseSubtitleValue,
    audioLanguageOptions: audioLanguageOptions,
    directFormats: directFormats,
    tracksWithFiles: tracksWithFiles,
    subtitleFormatOptions: subtitleFormatOptions,
    subtitleFileUrl: subtitleFileUrl,
    buildTextExport: buildTextExport,
    filenameFromDisposition: filenameFromDisposition,
    errorMessage: errorMessage,
    formatDuration: formatDuration
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.MediaGrabFormats = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
