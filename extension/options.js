const DEFAULT_SETTINGS = {
  backendUrl: "http://127.0.0.1:8787",
  targetLanguage: "Spanish",
  sourceLanguage: "",
  autoTranslate: true,
  bubbleTheme: "light",
  accentColor: "#0f766e",
  bubbleWidth: "360",
  fontSize: "14",
  bubblePlacement: "cursor",
  autoHideMs: "0"
};

const form = document.querySelector("#settings-form");
const status = document.querySelector("#status");
const targetLanguage = document.querySelector("#target-language");
const sourceLanguage = document.querySelector("#source-language");
const backendUrl = document.querySelector("#backend-url");
const autoTranslate = document.querySelector("#auto-translate");
const healthCheck = document.querySelector("#health-check");
const provider = document.querySelector("#provider");
const remoteProvider = document.querySelector("#remote-provider");
const openaiApiKey = document.querySelector("#openai-api-key");
const openaiModel = document.querySelector("#openai-model");
const zaiApiKey = document.querySelector("#zai-api-key");
const zaiModel = document.querySelector("#zai-model");
const zaiEndpoint = document.querySelector("#zai-endpoint");
const ollamaModel = document.querySelector("#ollama-model");
const ollamaBaseUrl = document.querySelector("#ollama-base-url");
const bubbleTheme = document.querySelector("#bubble-theme");
const accentColor = document.querySelector("#accent-color");
const bubbleWidth = document.querySelector("#bubble-width");
const fontSize = document.querySelector("#font-size");
const bubblePlacement = document.querySelector("#bubble-placement");
const autoHideMs = document.querySelector("#auto-hide-ms");
const providerPanels = {
  argos: document.querySelector("#provider-argos"),
  ollama: document.querySelector("#provider-ollama"),
  openai: document.querySelector("#provider-openai"),
  zai: document.querySelector("#provider-zai")
};

init();

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  targetLanguage.value = settings.targetLanguage;
  sourceLanguage.value = settings.sourceLanguage;
  backendUrl.value = settings.backendUrl;
  autoTranslate.checked = settings.autoTranslate;
  bubbleTheme.value = settings.bubbleTheme;
  accentColor.value = settings.accentColor;
  bubbleWidth.value = settings.bubbleWidth;
  fontSize.value = settings.fontSize;
  bubblePlacement.value = settings.bubblePlacement;
  autoHideMs.value = settings.autoHideMs;

  try {
    const payload = await fetchConfig(settings.backendUrl);
    if (payload.provider === "openai" || payload.provider === "zai") {
      provider.value = "argos";
      remoteProvider.value = payload.provider;
    } else {
      provider.value = payload.provider ?? "argos";
      remoteProvider.value = "";
    }
    openaiModel.value = payload.openaiModel ?? "gpt-5.4-mini";
    zaiModel.value = payload.zaiModel ?? "glm-4.6";
    zaiEndpoint.value = payload.zaiEndpoint ?? "general";
    ollamaModel.value = payload.ollamaModel ?? "gemma3";
    ollamaBaseUrl.value = payload.ollamaBaseUrl ?? "http://127.0.0.1:11434/api";
    openaiApiKey.placeholder = payload.hasOpenAiKey ? "Guardada en servidor local" : "Pega una API key";
    zaiApiKey.placeholder = payload.hasZaiKey ? "Guardada en servidor local" : "Pega una API key";
  } catch {
    provider.value = "argos";
    remoteProvider.value = "";
    openaiModel.value = "gpt-5.4-mini";
    zaiModel.value = "glm-4.6";
    zaiEndpoint.value = "general";
    ollamaModel.value = "gemma3";
    ollamaBaseUrl.value = "http://127.0.0.1:11434/api";
  }

  syncProviderPanels();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const resolvedBackendUrl = backendUrl.value.trim() || DEFAULT_SETTINGS.backendUrl;

  await chrome.storage.sync.set({
    targetLanguage: targetLanguage.value.trim() || DEFAULT_SETTINGS.targetLanguage,
    sourceLanguage: sourceLanguage.value.trim(),
    backendUrl: resolvedBackendUrl,
    autoTranslate: autoTranslate.checked,
    bubbleTheme: bubbleTheme.value,
    accentColor: accentColor.value,
    bubbleWidth: bubbleWidth.value,
    fontSize: fontSize.value,
    bubblePlacement: bubblePlacement.value,
    autoHideMs: autoHideMs.value
  });

  try {
    const payload = await saveConfig(resolvedBackendUrl);
    openaiApiKey.value = "";
    zaiApiKey.value = "";
    openaiApiKey.placeholder = payload.hasOpenAiKey ? "Guardada en servidor local" : "Pega una API key";
    zaiApiKey.placeholder = payload.hasZaiKey ? "Guardada en servidor local" : "Pega una API key";
    setStatus(`Configuracion guardada. Activo: ${payload.provider} / ${payload.activeModel}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudo guardar la configuracion del proveedor.");
  }
});

provider?.addEventListener("change", syncProviderPanels);
remoteProvider?.addEventListener("change", syncProviderPanels);

healthCheck?.addEventListener("click", async () => {
  try {
    const url = `${(backendUrl.value.trim() || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "")}/health`;
    const response = await fetch(url);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "El servidor no respondio correctamente.");
    }

    setStatus(payload.hasApiKey
      ? `Servidor listo. ${payload.provider} / ${payload.model} / ${payload.endpoint}.`
      : "Servidor activo, pero falta una API key para el proveedor seleccionado.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "No se pudo contactar el servidor.");
  }
});

async function fetchConfig(baseUrl) {
  const url = `${(baseUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "")}/config`;
  const response = await fetch(url);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "No se pudo leer la configuracion del servidor.");
  }

  return payload;
}

async function saveConfig(baseUrl) {
  const url = `${(baseUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "")}/config`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider: remoteProvider.value || provider.value,
      openaiApiKey: openaiApiKey.value.trim(),
      openaiModel: openaiModel.value.trim(),
      zaiApiKey: zaiApiKey.value.trim(),
      zaiModel: zaiModel.value.trim(),
      zaiEndpoint: zaiEndpoint.value,
      ollamaModel: ollamaModel.value.trim(),
      ollamaBaseUrl: ollamaBaseUrl.value.trim()
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "No se pudo guardar la configuracion del servidor.");
  }

  return payload;
}

function setStatus(message) {
  status.textContent = message;
}

function syncProviderPanels() {
  const activeProvider = remoteProvider.value || provider.value;

  Object.entries(providerPanels).forEach(([name, panel]) => {
    panel?.classList.toggle("is-active", name === activeProvider);
  });
}
