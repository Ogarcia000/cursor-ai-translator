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

function getBrowserTargetLanguage() {
  const browserLanguage = chrome.i18n?.getUILanguage?.() || "en";
  const languageCode = browserLanguage.toLowerCase().split("-")[0];
  return LANGUAGE_MAP[languageCode] ?? "English";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open-options-page") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type !== "translate-selection") {
    return false;
  }

  Promise.all([getSettings(), getPairingToken()])
    .then(async ([settings, token]) => {
      if (!token) {
        throw new Error("Falta el token de pareo. Abre Opciones y pegalo desde la consola del servidor.");
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
        })
      });

      const payload = await response.json();

      if (response.status === 401) {
        throw new Error("Token de pareo invalido. Revisa Opciones.");
      }

      if (!response.ok) {
        throw new Error(payload.error || "Translation failed.");
      }

      sendResponse({ ok: true, ...payload });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Translation failed."
      });
    });

  return true;
});
