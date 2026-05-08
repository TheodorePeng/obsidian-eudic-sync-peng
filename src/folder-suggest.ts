import { AbstractInputSuggest, App, TFolder, normalizePath } from "obsidian";

function normalizeFolderPath(value: string): string {
  return normalizePath(value.trim()).replace(/^\/+|\/+$/g, "");
}

function uniqueOrdered(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    ordered.push(value);
  }

  return ordered;
}

export class FolderInputSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    textInputEl: HTMLInputElement,
    private readonly onChoose: (value: string) => void | Promise<void>,
  ) {
    super(app, textInputEl);
  }

  protected getSuggestions(query: string): string[] {
    const normalizedQuery = normalizeFolderPath(query).toLowerCase();
    const folderPaths = uniqueOrdered(
      this.app.vault
        .getAllLoadedFiles()
        .filter((entry): entry is TFolder => entry instanceof TFolder)
        .map((folder) => normalizeFolderPath(folder.path))
        .filter(Boolean),
    ).sort((left, right) => left.localeCompare(right));

    if (!normalizedQuery) {
      return folderPaths;
    }

    return folderPaths.filter((folderPath) => folderPath.toLowerCase().includes(normalizedQuery));
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.createDiv({ text: value });
  }

  override selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    void this.onChoose(value);
    this.close();
  }
}
