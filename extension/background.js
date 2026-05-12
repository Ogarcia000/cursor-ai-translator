const DEFAULT_SETTINGS = {
  backendUrl: "http://127.0.0.1:8787",
  targetLanguage: "Spanish",
  sourceLanguage: "",
  autoTranslate: true
};

async function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
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

  getSettings()
    .then(async (settings) => {
      const response = await fetch(`${settings.backendUrl.replace(/\/$/, "")}/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: message.text,
          targetLanguage: settings.targetLanguage,
          sourceLanguage: settings.sourceLanguage
        })
      });

      const payload = await response.json();

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
