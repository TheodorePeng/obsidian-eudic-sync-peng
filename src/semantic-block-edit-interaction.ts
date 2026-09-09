const LIVE_EUDIC_BLOCK_SELECTOR = ".cm-preview-code-block.cm-lang-eudic-block";
const NATIVE_EDIT_ACTIONS_CLASS = "embed-actions";
const NATIVE_EDIT_BUTTON_SELECTOR = ".edit-block-button";
const INTERACTIVE_TARGET_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  "[role=\"button\"]",
  "[role=\"link\"]",
  "[contenteditable=\"true\"]",
].join(", ");

type SelectionState = Pick<Selection, "isCollapsed">;

function getClosestCapableElement(target: EventTarget | null): Element | null {
  if (!target || typeof (target as Element).closest !== "function") {
    const parentElement = (target as Node | null)?.parentElement;
    return parentElement && typeof parentElement.closest === "function" ? parentElement : null;
  }

  return target as Element;
}

function isInteractiveTarget(target: EventTarget | null, interactionBoundary: HTMLElement): boolean {
  const targetElement = getClosestCapableElement(target);
  if (!targetElement || !interactionBoundary.contains(targetElement)) {
    return true;
  }

  const interactiveElement = targetElement.closest(INTERACTIVE_TARGET_SELECTOR);
  return interactiveElement !== null && interactionBoundary.contains(interactiveElement);
}

export function shouldActivateEudicBlockEdit(
  event: Pick<MouseEvent, "button" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
  selection: SelectionState | null,
  interactionBoundary: HTMLElement,
): boolean {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return false;
  }

  if (selection?.isCollapsed === false || isInteractiveTarget(event.target, interactionBoundary)) {
    return false;
  }

  return true;
}

export function findNativeEudicBlockEditButton(previewEl: HTMLElement): HTMLElement | null {
  const liveBlock = previewEl.closest<HTMLElement>(LIVE_EUDIC_BLOCK_SELECTOR);
  if (!liveBlock) {
    return null;
  }

  const actions = Array.from(liveBlock.children).find((child) => child.classList.contains(NATIVE_EDIT_ACTIONS_CLASS));
  return actions?.querySelector<HTMLElement>(NATIVE_EDIT_BUTTON_SELECTOR) ?? null;
}

export function activateEudicBlockEdit(
  previewEl: HTMLElement,
  event: MouseEvent,
  selection: SelectionState | null,
  enterEditMode: () => boolean,
): boolean {
  if (!shouldActivateEudicBlockEdit(event, selection, previewEl)) {
    return false;
  }

  const editButton = findNativeEudicBlockEditButton(previewEl);
  if (!editButton) {
    return false;
  }

  if (!enterEditMode()) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
}

export function enhanceNativeEudicBlockEditButton(editButton: HTMLElement): void {
  editButton.classList.add("eudic-sync-block-edit-button");
  if (!editButton.getAttribute("aria-label")) {
    editButton.setAttribute("aria-label", "Edit Eudic block");
  }
  editButton.setAttribute("role", "button");
  editButton.setAttribute("tabindex", "0");
}

export function activateEudicBlockEditFromKeyboard(
  event: KeyboardEvent,
  enterEditMode: () => boolean,
): boolean {
  if (event.key !== "Enter" && event.key !== " ") {
    return false;
  }

  if (!enterEditMode()) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  return true;
}
