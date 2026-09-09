import assert from "node:assert/strict";
import {
  activateEudicBlockEdit,
  activateEudicBlockEditFromKeyboard,
  enhanceNativeEudicBlockEditButton,
  findNativeEudicBlockEditButton,
  shouldActivateEudicBlockEdit,
} from "../src/semantic-block-edit-interaction";

interface MouseEventStubOptions {
  target?: EventTarget | null;
  button?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

function createMouseEventStub(options: MouseEventStubOptions = {}): MouseEvent & {
  prevented: boolean;
  stopped: boolean;
} {
  return {
    target: options.target ?? null,
    button: options.button ?? 0,
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  } as unknown as MouseEvent & { prevented: boolean; stopped: boolean };
}

function parseDocument(markup: string): Document {
  return new DOMParser().parseFromString(`<html><body>${markup}</body></html>`, "text/html");
}

const activationDocument = parseDocument(`
  <div class="cm-content" contenteditable="true">
  <div class="cm-preview-code-block cm-embed-block markdown-rendered cm-lang-eudic-block">
    <div class="block-language-eudic-block eudic-sync-block-preview">
      <p><span class="ordinary">ordinary</span> <a href="#word"><span class="linked">linked</span></a></p>
      <button class="nested-button">nested button</button>
      <input class="nested-input">
      <span class="role-button" role="button">role button</span>
      <span class="role-link" role="link">role link</span>
      <span class="editable" contenteditable="true">editable</span>
    </div>
    <div class="embed-actions">
      <div class="embed-action edit-block-button" aria-label="Edit this block"></div>
    </div>
  </div>
  </div>
`);
const preview = activationDocument.querySelector<HTMLElement>(".eudic-sync-block-preview")!;
const ordinary = activationDocument.querySelector<HTMLElement>(".ordinary")!;
const editButton = activationDocument.querySelector<HTMLElement>(".edit-block-button")!;

assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary }), { isCollapsed: true }, preview), true);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary }), null, preview), true);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, button: 1 }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, button: 2 }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, altKey: true }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, ctrlKey: true }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, metaKey: true }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary, shiftKey: true }), null, preview), false);
assert.equal(shouldActivateEudicBlockEdit(createMouseEventStub({ target: ordinary }), { isCollapsed: false }, preview), false);

for (const selector of [
  "a",
  ".linked",
  ".nested-button",
  ".nested-input",
  ".role-button",
  ".role-link",
  ".editable",
]) {
  const target = activationDocument.querySelector<HTMLElement>(selector)!;
  assert.equal(
    shouldActivateEudicBlockEdit(createMouseEventStub({ target }), { isCollapsed: true }, preview),
    false,
    `${selector} should retain its native interaction`,
  );
}

assert.equal(findNativeEudicBlockEditButton(preview), editButton);

const readingDocument = parseDocument(`
  <div class="el-pre">
    <div class="block-language-eudic-block eudic-sync-block-preview">reading preview</div>
  </div>
`);
assert.equal(
  findNativeEudicBlockEditButton(
    readingDocument.querySelector<HTMLElement>(".eudic-sync-block-preview")!,
  ),
  null,
);

const wrongLanguageDocument = parseDocument(`
  <div class="cm-preview-code-block cm-lang-js">
    <div class="eudic-sync-block-preview">wrong wrapper</div>
    <div class="embed-actions"><div class="edit-block-button"></div></div>
  </div>
`);
assert.equal(
  findNativeEudicBlockEditButton(
    wrongLanguageDocument.querySelector<HTMLElement>(".eudic-sync-block-preview")!,
  ),
  null,
);

let editClickCount = 0;
editButton.addEventListener("click", () => {
  editClickCount += 1;
});
let enterEditModeCount = 0;
const enterEditMode = (): boolean => {
  enterEditModeCount += 1;
  return true;
};
const ordinaryClick = createMouseEventStub({ target: ordinary });
assert.equal(activateEudicBlockEdit(preview, ordinaryClick, { isCollapsed: true }, enterEditMode), true);
assert.equal(enterEditModeCount, 1);
assert.equal(editClickCount, 0);
assert.equal(ordinaryClick.prevented, true);
assert.equal(ordinaryClick.stopped, true);

const linkedClick = createMouseEventStub({
  target: activationDocument.querySelector<HTMLElement>(".linked")!,
});
assert.equal(activateEudicBlockEdit(preview, linkedClick, { isCollapsed: true }, enterEditMode), false);
assert.equal(enterEditModeCount, 1);
assert.equal(editClickCount, 0);
assert.equal(linkedClick.prevented, false);
assert.equal(linkedClick.stopped, false);

const missingButtonDocument = parseDocument(`
  <div class="cm-preview-code-block cm-lang-eudic-block">
    <div class="eudic-sync-block-preview"><span>ordinary</span></div>
  </div>
`);
const missingPreview = missingButtonDocument.querySelector<HTMLElement>(".eudic-sync-block-preview")!;
assert.equal(
  activateEudicBlockEdit(
    missingPreview,
    createMouseEventStub({ target: missingPreview.querySelector("span") }),
    { isCollapsed: true },
    enterEditMode,
  ),
  false,
);
assert.equal(enterEditModeCount, 1);

const rejectedActivationClick = createMouseEventStub({ target: ordinary });
assert.equal(
  activateEudicBlockEdit(preview, rejectedActivationClick, { isCollapsed: true }, () => false),
  false,
);
assert.equal(rejectedActivationClick.prevented, false);
assert.equal(rejectedActivationClick.stopped, false);

enhanceNativeEudicBlockEditButton(editButton);
assert.equal(editButton.classList.contains("eudic-sync-block-edit-button"), true);
assert.equal(editButton.getAttribute("aria-label"), "Edit this block");
assert.equal(editButton.getAttribute("role"), "button");
assert.equal(editButton.getAttribute("tabindex"), "0");

const unlabeledButton = parseDocument('<div class="edit-block-button"></div>').querySelector<HTMLElement>(
  ".edit-block-button",
)!;
enhanceNativeEudicBlockEditButton(unlabeledButton);
assert.equal(unlabeledButton.getAttribute("aria-label"), "Edit Eudic block");

function createKeyboardEventStub(key: string): KeyboardEvent & { prevented: boolean; stopped: boolean } {
  return {
    key,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  } as unknown as KeyboardEvent & { prevented: boolean; stopped: boolean };
}

const enterEvent = createKeyboardEventStub("Enter");
assert.equal(activateEudicBlockEditFromKeyboard(enterEvent, enterEditMode), true);
assert.equal(enterEditModeCount, 2);
assert.equal(enterEvent.prevented, true);
assert.equal(enterEvent.stopped, true);

const spaceEvent = createKeyboardEventStub(" ");
assert.equal(activateEudicBlockEditFromKeyboard(spaceEvent, enterEditMode), true);
assert.equal(enterEditModeCount, 3);
assert.equal(spaceEvent.prevented, true);
assert.equal(spaceEvent.stopped, true);

const unrelatedKeyEvent = createKeyboardEventStub("Escape");
assert.equal(activateEudicBlockEditFromKeyboard(unrelatedKeyEvent, enterEditMode), false);
assert.equal(enterEditModeCount, 3);
assert.equal(unrelatedKeyEvent.prevented, false);
assert.equal(unrelatedKeyEvent.stopped, false);

const rejectedKeyboardEvent = createKeyboardEventStub("Enter");
assert.equal(activateEudicBlockEditFromKeyboard(rejectedKeyboardEvent, () => false), false);
assert.equal(rejectedKeyboardEvent.prevented, false);
assert.equal(rejectedKeyboardEvent.stopped, false);

const secondDocument = parseDocument(`
  <div class="cm-preview-code-block cm-lang-eudic-block">
    <div class="eudic-sync-block-preview"><span>second block</span></div>
    <div class="embed-actions"><div class="edit-block-button"></div></div>
  </div>
`);
const secondPreview = secondDocument.querySelector<HTMLElement>(".eudic-sync-block-preview")!;
const secondButton = secondDocument.querySelector<HTMLElement>(".edit-block-button")!;
let secondClickCount = 0;
secondButton.addEventListener("click", () => {
  secondClickCount += 1;
});
let secondActivationCount = 0;
assert.equal(
  activateEudicBlockEdit(
    secondPreview,
    createMouseEventStub({ target: secondPreview.querySelector("span") }),
    { isCollapsed: true },
    () => {
      secondActivationCount += 1;
      return true;
    },
  ),
  true,
);
assert.equal(secondActivationCount, 1);
assert.equal(secondClickCount, 0);
assert.equal(enterEditModeCount, 3);
assert.equal(editClickCount, 0);
