const STATE = {
  bubble: null,
  lastSelection: "",
  debounceId: null,
  hideTimer: null,
  pointer: { x: 24, y: 24 },
  port: null,
  streamBuffer: "",
  currentSettings: null
};

function t(key, fallback) {
  return chrome.i18n?.getMessage?.(key) || fallback;
}

const TARGET_LANGUAGE_TO_ISO1 = {
  English: "en",
  Spanish: "es",
  French: "fr",
  German: "de",
  Italian: "it",
  Portuguese: "pt",
  Chinese: "zh",
  Japanese: "ja",
  Korean: "ko",
  Arabic: "ar",
  Hindi: "hi",
  Russian: "ru",
  Dutch: "nl",
  Polish: "pl",
  Turkish: "tr",
  Vietnamese: "vi",
  Indonesian: "id",
  Thai: "th",
  Ukrainian: "uk"
};

function buildProviderChipLabel(event, settings) {
  if (!event?.provider) return "";
  const parts = [event.provider];
  if (event.cached) parts.push("cache");
  const target = TARGET_LANGUAGE_TO_ISO1[settings?.targetLanguage] ?? null;
  if (event.detectedIso1 && target && event.detectedIso1 !== target) {
    parts.push(`${event.detectedIso1} → ${target}`);
  }
  return parts.join(" · ");
}

function ensureTranslatePort() {
  if (STATE.port) {
    return STATE.port;
  }

  const port = chrome.runtime.connect({ name: "translate" });
  STATE.port = port;

  port.onMessage.addListener((event) => {
    const settings = STATE.currentSettings ?? {};

    if (event?.type === "chunk") {
      STATE.streamBuffer += event.text;
      const bubble = STATE.bubble ?? createBubble();
      applyBubbleSettings(bubble, settings);
      bubble.dataset.mode = "ready";
      const body = bubble.querySelector(".cat-bubble__body");
      if (body) body.textContent = STATE.streamBuffer;
      const copy = bubble.querySelector(".cat-bubble__copy");
      if (copy) copy.hidden = false;
      bubble.hidden = false;
      positionBubble(bubble, settings);
      return;
    }

    if (event?.type === "done") {
      const bubble = STATE.bubble;
      if (bubble) {
        const providerChip = bubble.querySelector(".cat-bubble__provider");
        if (providerChip && event.provider) {
          providerChip.textContent = buildProviderChipLabel(event, settings);
          providerChip.hidden = false;
        }
      }
      STATE.streamBuffer = "";
      scheduleAutoHide(settings);
      return;
    }

    if (event?.type === "aborted") {
      STATE.streamBuffer = "";
      return;
    }

    if (event?.type === "error") {
      STATE.streamBuffer = "";
      showBubble(event.error || t("bubbleTranslationFailed", "Could not translate."), "error", settings);
    }
  });

  port.onDisconnect.addListener(() => {
    STATE.port = null;
    STATE.streamBuffer = "";
  });

  return port;
}

document.addEventListener("pointermove", (event) => {
  STATE.pointer = { x: event.clientX, y: event.clientY };
});

document.addEventListener("selectionchange", scheduleSelectionCheck);
document.addEventListener("pointerup", scheduleSelectionCheck, true);
document.addEventListener("mouseup", scheduleSelectionCheck, true);
document.addEventListener("keyup", scheduleSelectionCheck, true);
document.addEventListener("scroll", handlePageScroll, true);
document.addEventListener("pointerdown", handleClickOutside, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && STATE.bubble && !STATE.bubble.hidden) {
    STATE.lastSelection = "";
    hideBubble(true);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "force-translate-selection") {
    STATE.lastSelection = "";
    handleSelection();
  }
});

function scheduleSelectionCheck() {
  window.clearTimeout(STATE.debounceId);
  STATE.debounceId = window.setTimeout(handleSelection, 150);
}

async function handleSelection() {
  const settings = await chrome.storage.sync.get({
    autoTranslate: true,
    bubbleTheme: "light",
    accentColor: "#0f766e",
    bubbleWidth: "360",
    fontSize: "14",
    bubblePlacement: "cursor",
    autoHideMs: "0",
    domainAllowlist: "",
    domainBlocklist: ""
  });

  if (!isCurrentDomainAllowed(settings)) {
    return;
  }

  const selectedText = getSelectedText();

  if (!settings.autoTranslate || selectedText.length < 2) {
    hideBubble(false);
    STATE.lastSelection = "";
    return;
  }

  const bubbleVisible = STATE.bubble && !STATE.bubble.hidden;
  if (selectedText === STATE.lastSelection && bubbleVisible) {
    return;
  }

  STATE.lastSelection = selectedText;
  STATE.currentSettings = settings;
  STATE.streamBuffer = "";
  showBubble(t("bubbleTranslating", "Translating..."), "loading", settings);

  try {
    const port = ensureTranslatePort();
    port.postMessage({ type: "translate-selection", text: selectedText });
  } catch (error) {
    showBubble(error instanceof Error ? error.message : t("bubbleTranslationFailed", "Could not translate."), "error", settings);
  }
}

function parseDomainList(value) {
  return (value || "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameMatches(hostname, patterns) {
  return patterns.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

function isCurrentDomainAllowed(settings) {
  const hostname = (location.hostname || "").toLowerCase();
  if (!hostname) {
    return true;
  }
  const blocklist = parseDomainList(settings.domainBlocklist);
  if (blocklist.length && hostnameMatches(hostname, blocklist)) {
    return false;
  }
  const allowlist = parseDomainList(settings.domainAllowlist);
  if (allowlist.length && !hostnameMatches(hostname, allowlist)) {
    return false;
  }
  return true;
}

function getSelectedText() {
  const pageSelection = window.getSelection()?.toString().trim() ?? "";

  if (pageSelection) {
    return pageSelection;
  }

  const activeElement = document.activeElement;
  const isTextControl = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;

  if (!isTextControl) {
    return "";
  }

  const start = activeElement.selectionStart;
  const end = activeElement.selectionEnd;

  if (typeof start !== "number" || typeof end !== "number" || start === end) {
    return "";
  }

  return activeElement.value.slice(start, end).trim();
}

function createBubble() {
  const bubble = document.createElement("section");
  bubble.className = "cat-bubble";
  bubble.setAttribute("role", "status");
  bubble.innerHTML = `
    <div class="cat-bubble__header">
      <div class="cat-bubble__identity">
        <span class="cat-bubble__dot"></span>
        <strong>${t("bubbleTitle", "AI Translate")}</strong>
        <span class="cat-bubble__provider" hidden></span>
      </div>
      <div class="cat-bubble__actions">
        <button type="button" class="cat-bubble__copy" aria-label="${t("bubbleAriaCopy", "Copy translation")}" hidden>⧉</button>
        <button type="button" class="cat-bubble__settings" aria-label="${t("bubbleAriaSettings", "Open settings")}">⚙</button>
        <button type="button" class="cat-bubble__close" aria-label="${t("bubbleAriaClose", "Close")}">×</button>
      </div>
    </div>
    <div class="cat-bubble__body"></div>
  `;

  bubble.querySelector(".cat-bubble__settings")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "open-options-page" });
  });

  bubble.querySelector(".cat-bubble__close")?.addEventListener("click", () => {
    STATE.lastSelection = "";
    clearActiveSelection();
    hideBubble(true);
  });

  bubble.querySelector(".cat-bubble__copy")?.addEventListener("click", async () => {
    const body = bubble.querySelector(".cat-bubble__body");
    const text = body?.textContent ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const copy = bubble.querySelector(".cat-bubble__copy");
      if (copy) {
        copy.dataset.copied = "1";
        window.setTimeout(() => delete copy.dataset.copied, 1200);
      }
    } catch {
      // clipboard API may be blocked; silently ignore
    }
  });

  bubble.addEventListener("pointerdown", () => {
    window.clearTimeout(STATE.hideTimer);
  });

  document.documentElement.appendChild(bubble);
  STATE.bubble = bubble;
  return bubble;
}

function handleClickOutside(event) {
  if (!STATE.bubble || STATE.bubble.hidden) {
    return;
  }
  if (STATE.bubble.contains(event.target)) {
    return;
  }
  STATE.lastSelection = "";
  hideBubble(true);
}

function handlePageScroll(event) {
  if (!STATE.bubble || STATE.bubble.hidden) {
    return;
  }

  if (STATE.bubble.contains(event.target)) {
    return;
  }

  positionBubbleAfterExternalScroll();
}

function clearActiveSelection() {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    selection.removeAllRanges();
  }

  const activeElement = document.activeElement;
  const isTextControl = activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement;

  if (!isTextControl) {
    return;
  }

  const caretPosition = activeElement.selectionEnd ?? activeElement.value.length;
  activeElement.setSelectionRange(caretPosition, caretPosition);
}

function showBubble(text, mode, settings, meta = {}) {
  const bubble = STATE.bubble ?? createBubble();
  bubble.dataset.mode = mode;
  applyBubbleSettings(bubble, settings);

  const body = bubble.querySelector(".cat-bubble__body");
  if (body) {
    body.textContent = text;
  }

  const providerChip = bubble.querySelector(".cat-bubble__provider");
  if (providerChip) {
    if (mode === "ready" && meta.provider) {
      const label = meta.cached ? `${meta.provider} · cache` : meta.provider;
      providerChip.textContent = label;
      providerChip.hidden = false;
    } else {
      providerChip.hidden = true;
      providerChip.textContent = "";
    }
  }

  const copyButton = bubble.querySelector(".cat-bubble__copy");
  if (copyButton) {
    copyButton.hidden = mode !== "ready";
    delete copyButton.dataset.copied;
  }

  bubble.hidden = false;
  positionBubble(bubble, settings);
  scheduleAutoHide(settings);
}

function hideBubble(resetSelection) {
  window.clearTimeout(STATE.hideTimer);

  if (STATE.bubble) {
    STATE.bubble.hidden = true;
  }

  if (resetSelection) {
    STATE.lastSelection = "";
  }
}

function applyBubbleSettings(bubble, settings) {
  const theme = settings.bubbleTheme === "auto"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.bubbleTheme;
  bubble.dataset.theme = theme;
  bubble.style.setProperty("--cat-accent", settings.accentColor);
  bubble.style.setProperty("--cat-width", `${settings.bubbleWidth}px`);
  bubble.style.setProperty("--cat-font-size", `${settings.fontSize}px`);
}

function scheduleAutoHide(settings) {
  window.clearTimeout(STATE.hideTimer);
  const timeout = Number.parseInt(settings.autoHideMs, 10);

  if (!timeout) {
    return;
  }

  STATE.hideTimer = window.setTimeout(() => hideBubble(false), timeout);
}

function positionBubble(bubble, settings) {
  const margin = 16;
  const offset = 18;
  const bounds = bubble.getBoundingClientRect();

  const selectionRect = getSelectionRect();
  const anchor = settings.bubblePlacement === "selection" && selectionRect
    ? {
        x: selectionRect.left,
        y: selectionRect.bottom
      }
    : STATE.pointer;

  let left = anchor.x + offset;
  let top = anchor.y + offset;

  if (left + bounds.width + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - bounds.width - margin);
  }

  if (top + bounds.height + margin > window.innerHeight) {
    top = Math.max(margin, STATE.pointer.y - bounds.height - offset);
  }

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

async function positionBubbleAfterExternalScroll() {
  const settings = await chrome.storage.sync.get({
    bubblePlacement: "cursor"
  });

  if (STATE.bubble && !STATE.bubble.hidden) {
    positionBubble(STATE.bubble, settings);
  }
}

function getSelectionRect() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (!rect || (!rect.width && !rect.height)) {
    return null;
  }

  return rect;
}
