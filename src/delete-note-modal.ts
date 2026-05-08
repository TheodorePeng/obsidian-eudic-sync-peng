import { App, Modal, Setting } from "obsidian";

export interface DeleteTypedWordModalResult {
  word: string;
  language: string;
}

class ConfirmDeleteEudicNoteModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly messageLines: string[],
    private readonly onResolve: (confirmed: boolean) => void,
    private readonly confirmLabel: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: this.title });
    for (const line of this.messageLines) {
      contentEl.createEl("p", { text: line });
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.resolve(false);
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmLabel)
          .setWarning()
          .onClick(() => {
            this.resolve(true);
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(false);
    }
  }

  private resolve(confirmed: boolean): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.onResolve(confirmed);
  }
}

class DeleteTypedWordNoteModal extends Modal {
  private resolved = false;
  private word = "";
  private language: string;

  constructor(
    app: App,
    private readonly languages: string[],
    private readonly onResolve: (result: DeleteTypedWordModalResult | null) => void,
  ) {
    super(app);
    this.language = languages[0] ?? "en";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h3", { text: "Delete typed word note in Eudic" });

    new Setting(contentEl)
      .setName("Word")
      .setDesc("Delete the Eudic note for this word.")
      .addText((text) => {
        text
          .setPlaceholder("played")
          .onChange((value) => {
            this.word = value;
            submitButton.disabled = !this.canSubmit();
          });

        window.setTimeout(() => text.inputEl.focus(), 0);
      });

    new Setting(contentEl)
      .setName("Language")
      .setDesc("Choose the language used for the Eudic note lookup.")
      .addDropdown((dropdown) => {
        for (const language of this.languages) {
          dropdown.addOption(language, language);
        }

        dropdown.setValue(this.language);
        dropdown.onChange((value) => {
          this.language = value;
        });
      });

    let submitButton!: HTMLButtonElement;
    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.resolve(null);
          this.close();
        }),
      )
      .addButton((button) => {
        button
          .setButtonText("Continue")
          .setCta()
          .onClick(() => {
            if (!this.canSubmit()) {
              return;
            }

            this.resolve({
              word: this.word.trim(),
              language: this.language,
            });
            this.close();
          });

        submitButton = button.buttonEl;
        submitButton.disabled = true;
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolve(null);
    }
  }

  private canSubmit(): boolean {
    return this.word.trim().length > 0;
  }

  private resolve(result: DeleteTypedWordModalResult | null): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.onResolve(result);
  }
}

export function confirmDeleteEudicNote(
  app: App,
  title: string,
  messageLines: string[],
  confirmLabel = "Delete",
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmDeleteEudicNoteModal(app, title, messageLines, resolve, confirmLabel);
    modal.open();
  });
}

export function confirmEudicAction(
  app: App,
  title: string,
  messageLines: string[],
  confirmLabel = "Continue",
): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmDeleteEudicNoteModal(app, title, messageLines, resolve, confirmLabel);
    modal.open();
  });
}

export function promptDeleteTypedWordNote(
  app: App,
  languages: string[],
): Promise<DeleteTypedWordModalResult | null> {
  return new Promise((resolve) => {
    const modal = new DeleteTypedWordNoteModal(app, languages, resolve);
    modal.open();
  });
}
