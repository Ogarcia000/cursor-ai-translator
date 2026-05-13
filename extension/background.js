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

let inflightTranslateController = null;
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

  if (message?.type !== "translate-selection") {
    return false;
  }

  if (inflightTranslateController) {
    inflightTranslateController.abort();
  }
  const controller = new AbortController();
  inflightTranslateController = controller;
  const timeoutId = setTimeout(() => controller.abort(), TRANSLATE_TIMEOUT_MS);

  Promise.all([getSettings(), getPairingToken()])
    .then(async ([settings, token]) => {
      if (!token) {
        throw new Error(chrome.i18n.getMessage("errorTokenMissing") || "Pairing token missing.");
      }

      const response = await fetch(`${settings.backendUrl.replace(/\/$/, "")}/translate`, {
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

      const payload = await response.json();

      if (response.status === 401) {
        throw new Error(chrome.i18n.getMessage("errorTokenInvalid") || "Pairing token invalid.");
      }

      if (!response.ok) {
        throw new Error(payload.error || "Translation failed.");
      }

      sendResponse({ ok: true, ...payload });
    })
    .catch((error) => {
      if (error?.name === "AbortError") {
        sendResponse({
          ok: false,
          error: chrome.i18n.getMessage("bubbleCanceledByNewSelection") || "Cancelled by a new selection.",
          aborted: true
        });
        return;
      }
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Translation failed."
      });
    })
    .finally(() => {
      clearTimeout(timeoutId);
      if (inflightTranslateController === controller) {
        inflightTranslateController = null;
      }
    });

  return true;
});
