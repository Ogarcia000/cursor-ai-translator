const DEFAULT_SETTINGS = {
  backendUrl: "http://127.0.0.1:8787",
  targetLanguage: "",
  sourceLanguage: "",
  autoTranslate: true
};

const LANGUAGE_MAP = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  id: "Indonesian",
  th: "Thai",
  uk: "Ukrainian"
};

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...settings,
    targetLanguage: settings.targetLanguage || getBrowserTargetLanguage()
  };
}

async function getPairingToken() {
  const { pairingToken = "" } = await chrome.storage.local.get({ pairingToken: "" });
  return pairingToken.trim();
}

const TRANSLATE_TIMEOUT_MS = 25_000;

function getBrowserTargetLanguage() {
  const browserLanguage = chrome.i18n?.getUILanguage?.() || "en";
  const languageCode = browserLanguage.toLowerCase().split("-")[0];
  return LANGUAGE_MAP[languageCode] ?? "English";
}

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === "toggle-auto-translate") {
    const { autoTranslate = true } = await chrome.storage.sync.get({ autoTranslate: true });
    await chrome.storage.sync.set({ autoTranslate: !autoTranslate });
    return;
  }

  if (command === "translate-now") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (typeof tabId === "number") {
      try {
        await chrome.tabs.sendMessage(tabId, { type: "force-translate-selection" });
      } catch {
        // tab may not have the content script loaded
      }
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open-options-page") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translate") {
    return;
  }

  let controller = null;
  let timeoutId = null;

  port.onMessage.addListener(async (message) => {
    if (message?.type !== "translate-selection") {
      return;
    }

    if (controller) {
      controller.abort();
    }
    controller = new AbortController();
    timeoutId = setTimeout(() => controller?.abort(), TRANSLATE_TIMEOUT_MS);

    try {
      const [settings, token] = await Promise.all([getSettings(), getPairingToken()]);
      if (!token) {
        port.postMessage({
          type: "error",
          error: chrome.i18n.getMessage("errorTokenMissing") || "Pairing token missing."
        });
        return;
      }

      const response = await fetch(`${settings.backendUrl.replace(/\/$/, "")}/translate/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          text: message.text,
          targetLanguage: settings.targetLanguage,
          sourceLanguage: settings.sourceLanguage
        }),
        signal: controller.signal
      });

      if (response.status === 401) {
        port.postMessage({
          type: "error",
          error: chrome.i18n.getMessage("errorTokenInvalid") || "Pairing token invalid."
        });
        return;
      }

      if (!response.ok || !response.body) {
        let errorBody;
        try { errorBody = await response.json(); } catch { errorBody = {}; }
        port.postMessage({ type: "error", error: errorBody.error || `HTTP ${response.status}` });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx;
        while ((nlIdx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            port.postMessage(event);
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        port.postMessage({ type: "aborted" });
        return;
      }
      port.postMessage({
        type: "error",
        error: error instanceof Error ? error.message : "Translation failed."
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  });

  port.onDisconnect.addListener(() => {
    controller?.abort();
    if (timeoutId) clearTimeout(timeoutId);
  });
});
