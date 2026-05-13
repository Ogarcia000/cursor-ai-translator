const DEFAULT_SETTINGS = {
  backendUrl: "http://127.0.0.1:8787",
  targetLanguage: "",
  sourceLanguage: "",
  autoTranslate: true,
  bubbleTheme: "light",
  accentColor: "#0f766e",
  bubbleWidth: "360",
  fontSize: "14",
  bubblePlacement: "cursor",
  autoHideMs: "0"
};

const COMMON_LANGUAGES = [
  { code: "", label: "Auto detectar", value: "" },
  { code: "en", label: "English", value: "English" },
  { code: "es", label: "Español", value: "Spanish" },
  { code: "fr", label: "Français", value: "French" },
  { code: "de", label: "Deutsch", value: "German" },
  { code: "it", label: "Italiano", value: "Italian" },
  { code: "pt", label: "Português", value: "Portuguese" },
  { code: "zh", label: "中文", value: "Chinese" },
  { code: "ja", label: "日本語", value: "Japanese" },
  { code: "ko", label: "한국어", value: "Korean" },
  { code: "ar", label: "العربية", value: "Arabic" },
  { code: "hi", label: "हिन्दी", value: "Hindi" },
  { code: "ru", label: "Русский", value: "Russian" },
  { code: "nl", label: "Nederlands", value: "Dutch" },
  { code: "pl", label: "Polski", value: "Polish" },
  { code: "tr", label: "Türkçe", value: "Turkish" },
  { code: "vi", label: "Tiếng Việt", value: "Vietnamese" },
  { code: "id", label: "Bahasa Indonesia", value: "Indonesian" },
  { code: "th", label: "ไทย", value: "Thai" },
  { code: "uk", label: "Українська", value: "Ukrainian" }
];

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
const ollamaPreset = document.querySelector("#ollama-preset");
const mlxModel = document.querySelector("#mlx-model");
const mlxPort = document.querySelector("#mlx-port");
const mlxPreset = document.querySelector("#mlx-preset");
const bubbleTheme = document.querySelector("#bubble-theme");
const accentColor = document.querySelector("#accent-color");
const bubbleWidth = document.querySelector("#bubble-width");
const fontSize = document.querySelector("#font-size");
const bubblePlacement = document.querySelector("#bubble-placement");
const autoHideMs = document.querySelector("#auto-hide-ms");
const pairingToken = document.querySelector("#pairing-token");
const providerPanels = {
  argos: document.querySelector("#provider-argos"),
  ollama: document.querySelector("#provider-ollama"),
  mlx: document.querySelector("#provider-mlx"),
  openai: document.querySelector("#provider-openai"),
  zai: document.querySelector("#provider-zai")
};

init();

async function getStoredPairingToken() {
  const { pairingToken: stored = "" } = await chrome.storage.local.get({ pairingToken: "" });
  return stored.trim();
}

async function setStoredPairingToken(value) {
  await chrome.storage.local.set({ pairingToken: value.trim() });
}

async function init() {
  populateLanguageSelects();
  const browserTargetLanguage = getBrowserTargetLanguage();
  const settings = await chrome.storage.sync.get({
    ...DEFAULT_SETTINGS,
    targetLanguage: browserTargetLanguage
  });
  setSelectValue(targetLanguage, settings.targetLanguage || browserTargetLanguage);
  setSelectValue(sourceLanguage, settings.sourceLanguage);
  backendUrl.value = settings.backendUrl;
  autoTranslate.checked = settings.autoTranslate;
  bubbleTheme.value = settings.bubbleTheme;
  accentColor.value = settings.accentColor;
  bubbleWidth.value = settings.bubbleWidth;
  fontSize.value = settings.fontSize;
  bubblePlacement.value = settings.bubblePlacement;
  autoHideMs.value = settings.autoHideMs;

  const storedToken = await getStoredPairingToken();
  pairingToken.placeholder = storedToken ? "Token guardado (sobrescribe para cambiar)" : "Pega el token de la consola del servidor";

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
    ollamaModel.value = payload.ollamaModel ?? "qwen2.5:0.5b";
    syncOllamaPreset();
    ollamaBaseUrl.value = payload.ollamaBaseUrl ?? "http://127.0.0.1:11434/api";
    mlxModel.value = payload.mlxModel ?? "mlx-community/Qwen2.5-0.5B-Instruct-4bit";
    mlxPort.value = payload.mlxPort ?? "11435";
    syncMlxPreset();
    openaiApiKey.placeholder = payload.hasOpenAiKey ? "Guardada en servidor local" : "Pega una API key";
    zaiApiKey.placeholder = payload.hasZaiKey ? "Guardada en servidor local" : "Pega una API key";
  } catch {
    provider.value = "argos";
    remoteProvider.value = "";
    openaiModel.value = "gpt-5.4-mini";
    zaiModel.value = "glm-4.6";
    zaiEndpoint.value = "general";
    ollamaModel.value = "qwen2.5:0.5b";
    syncOllamaPreset();
    ollamaBaseUrl.value = "http://127.0.0.1:11434/api";
    mlxModel.value = "mlx-community/Qwen2.5-0.5B-Instruct-4bit";
    mlxPort.value = "11435";
    syncMlxPreset();
  }

  syncProviderPanels();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const resolvedBackendUrl = backendUrl.value.trim() || DEFAULT_SETTINGS.backendUrl;

  await chrome.storage.sync.set({
    targetLanguage: targetLanguage.value || getBrowserTargetLanguage(),
    sourceLanguage: sourceLanguage.value,
    backendUrl: resolvedBackendUrl,
    autoTranslate: autoTranslate.checked,
    bubbleTheme: bubbleTheme.value,
    accentColor: accentColor.value,
    bubbleWidth: bubbleWidth.value,
    fontSize: fontSize.value,
    bubblePlacement: bubblePlacement.value,
    autoHideMs: autoHideMs.value
  });

  const pastedToken = pairingToken.value.trim();
  if (pastedToken) {
    await setStoredPairingToken(pastedToken);
    pairingToken.value = "";
    pairingToken.placeholder = "Token guardado (sobrescribe para cambiar)";
  }

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
ollamaPreset?.addEventListener("change", () => {
  if (ollamaPreset.value !== "custom") {
    ollamaModel.value = ollamaPreset.value;
  }
});
ollamaModel?.addEventListener("input", syncOllamaPreset);
mlxPreset?.addEventListener("change", () => {
  if (mlxPreset.value !== "custom") {
    mlxModel.value = mlxPreset.value;
  }
});
mlxModel?.addEventListener("input", syncMlxPreset);

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

async function authHeaders(extra = {}) {
  const stored = await getStoredPairingToken();
  const pasted = pairingToken.value.trim();
  const token = pasted || stored;
  if (!token) {
    return extra;
  }
  return { ...extra, Authorization: `Bearer ${token}` };
}

async function fetchConfig(baseUrl) {
  const url = `${(baseUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "")}/config`;
  const response = await fetch(url, { headers: await authHeaders() });
  const payload = await response.json();

  if (response.status === 401) {
    throw new Error("Token de pareo invalido o ausente. Pegalo en el campo 'Token de pareo'.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "No se pudo leer la configuracion del servidor.");
  }

  return payload;
}

async function saveConfig(baseUrl) {
  const url = `${(baseUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/$/, "")}/config`;
  const response = await fetch(url, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      provider: remoteProvider.value || provider.value,
      openaiApiKey: openaiApiKey.value.trim(),
      openaiModel: openaiModel.value.trim(),
      zaiApiKey: zaiApiKey.value.trim(),
      zaiModel: zaiModel.value.trim(),
      zaiEndpoint: zaiEndpoint.value,
      ollamaModel: ollamaModel.value.trim(),
      ollamaBaseUrl: ollamaBaseUrl.value.trim(),
      mlxModel: mlxModel.value.trim(),
      mlxPort: mlxPort.value.trim()
    })
  });
  const payload = await response.json();

  if (response.status === 401) {
    throw new Error("Token de pareo invalido o ausente. Pegalo en el campo 'Token de pareo'.");
  }

  if (!response.ok) {
    throw new Error(payload.error || "No se pudo guardar la configuracion del servidor.");
  }

  return payload;
}

function setStatus(message) {
  status.textContent = message;
}

function populateLanguageSelects() {
  targetLanguage.replaceChildren(...COMMON_LANGUAGES
    .filter((language) => language.value)
    .map(createLanguageOption));
  sourceLanguage.replaceChildren(...COMMON_LANGUAGES.map(createLanguageOption));
}

function createLanguageOption(language) {
  const option = document.createElement("option");
  option.value = language.value;
  option.textContent = language.label;
  return option;
}

function getBrowserTargetLanguage() {
  const browserLanguage = chrome.i18n?.getUILanguage?.() || navigator.language || "en";
  const languageCode = browserLanguage.toLowerCase().split("-")[0];
  return COMMON_LANGUAGES.find((language) => language.code === languageCode && language.value)?.value ?? "English";
}

function setSelectValue(select, value) {
  const hasValue = Array.from(select.options).some((option) => option.value === value);

  if (!hasValue && value) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }

  select.value = value;
}

function syncProviderPanels() {
  const activeProvider = remoteProvider.value || provider.value;

  Object.entries(providerPanels).forEach(([name, panel]) => {
    panel?.classList.toggle("is-active", name === activeProvider);
  });
}

function syncOllamaPreset() {
  const presetValues = Array.from(ollamaPreset.options).map((option) => option.value);
  ollamaPreset.value = presetValues.includes(ollamaModel.value) ? ollamaModel.value : "custom";
}

function syncMlxPreset() {
  const presetValues = Array.from(mlxPreset.options).map((option) => option.value);
  mlxPreset.value = presetValues.includes(mlxModel.value) ? mlxModel.value : "custom";
}
