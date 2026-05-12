const STATE = {
  bubble: null,
  lastSelection: "",
  debounceId: null,
  hideTimer: null,
  pointer: { x: 24, y: 24 }
};

document.addEventListener("pointermove", (event) => {
  STATE.pointer = { x: event.clientX, y: event.clientY };
});

document.addEventListener("selectionchange", scheduleSelectionCheck);
document.addEventListener("pointerup", scheduleSelectionCheck, true);
document.addEventListener("mouseup", scheduleSelectionCheck, true);
document.addEventListener("keyup", scheduleSelectionCheck, true);
document.addEventListener("scroll", handlePageScroll, true);

function scheduleSelectionCheck() {
  window.clearTimeout(STATE.debounceId);
  STATE.debounceId = window.setTimeout(handleSelection, 70);
}

async function handleSelection() {
  const settings = await chrome.storage.sync.get({
    autoTranslate: true,
    bubbleTheme: "light",
    accentColor: "#0f766e",
    bubbleWidth: "360",
    fontSize: "14",
    bubblePlacement: "cursor",
    autoHideMs: "0"
  });
  const selectedText = getSelectedText();

  if (!settings.autoTranslate || selectedText.length < 2) {
    hideBubble(false);
    STATE.lastSelection = "";
    return;
  }

  if (selectedText === STATE.lastSelection) {
    return;
  }

  STATE.lastSelection = selectedText;
  showBubble("Traduciendo...", "loading", settings);

  chrome.runtime.sendMessage(
    {
      type: "translate-selection",
      text: selectedText
    },
    (response) => {
      if (chrome.runtime.lastError) {
        showBubble(chrome.runtime.lastError.message, "error", settings);
        return;
      }

      if (!response?.ok) {
        showBubble(response?.error || "No se pudo traducir.", "error", settings);
        return;
      }

      showBubble(response.translation, "ready", settings);
    }
  );
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
        <strong>AI Translate</strong>
      </div>
      <div class="cat-bubble__actions">
        <button type="button" class="cat-bubble__settings" aria-label="Abrir configuracion">⚙</button>
        <button type="button" class="cat-bubble__close" aria-label="Cerrar">x</button>
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

  bubble.addEventListener("pointerdown", () => {
    window.clearTimeout(STATE.hideTimer);
  });

  document.documentElement.appendChild(bubble);
  STATE.bubble = bubble;
  return bubble;
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

function showBubble(text, mode, settings) {
  const bubble = STATE.bubble ?? createBubble();
  bubble.dataset.mode = mode;
  applyBubbleSettings(bubble, settings);

  const body = bubble.querySelector(".cat-bubble__body");
  if (body) {
    body.textContent = text;
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
  bubble.dataset.theme = settings.bubbleTheme;
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
