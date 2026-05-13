const DEFAULT_BACKEND = "http://127.0.0.1:8787";

const COMMON_LANGUAGES = [
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
  { code: "ru", label: "Русский", value: "Russian" },
  { code: "nl", label: "Nederlands", value: "Dutch" }
];

const auto = document.getElementById("popup-auto");
const target = document.getElementById("popup-target");
const status = document.getElementById("popup-status");
const test = document.getElementById("popup-test");
const openOptions = document.getElementById("popup-options");

populateLanguages();
init();

auto.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoTranslate: auto.checked });
  status.textContent = auto.checked ? "Traduccion automatica activa." : "Traduccion automatica pausada.";
});

target.addEventListener("change", async () => {
  await chrome.storage.sync.set({ targetLanguage: target.value });
  status.textContent = `Destino: ${target.value}.`;
});

test.addEventListener("click", checkHealth);

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function init() {
  const settings = await chrome.storage.sync.get({
    autoTranslate: true,
    targetLanguage: "Spanish",
    backendUrl: DEFAULT_BACKEND
  });
  auto.checked = Boolean(settings.autoTranslate);
  setSelectValue(target, settings.targetLanguage);
  status.textContent = settings.autoTranslate ? "Traduccion automatica activa." : "Traduccion automatica pausada.";
}

function populateLanguages() {
  for (const language of COMMON_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.value;
    option.textContent = language.label;
    target.appendChild(option);
  }
}

function setSelectValue(select, value) {
  if (!Array.from(select.options).some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  select.value = value;
}

async function checkHealth() {
  status.textContent = "Probando...";
  try {
    const { backendUrl = DEFAULT_BACKEND } = await chrome.storage.sync.get({ backendUrl: DEFAULT_BACKEND });
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    status.textContent = payload.ok ? "Servidor OK." : "Servidor respondio sin OK.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "No se pudo contactar el servidor.";
  }
}
