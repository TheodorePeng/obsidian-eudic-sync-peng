import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { findAutoBoldMarkerEdit } from "./markdown-bold-markers";
import type { PathScope } from "./path-scope";
import type { EudicSyncSettings } from "./types";

interface AutoBoldMarkersExtensionOptions {
  pathScope: PathScope;
  getSettings: () => EudicSyncSettings;
}

export function createAutoBoldMarkersExtension(options: AutoBoldMarkersExtensionOptions) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    const settings = options.getSettings();
    if (!settings.enableAutoBoldMarkersOnEdit || settings.boldMarkers.length === 0) {
      return false;
    }

    const info = view.state.field(editorInfoField, false);
    const file = info?.file;
    if (!file || (file.extension !== "md")) {
      return false;
    }

    if (!options.pathScope.isWordPath(file.path) && !options.pathScope.isReferencePath(file.path)) {
      return false;
    }

    const edit = findAutoBoldMarkerEdit({
      markdown: view.state.doc.toString(),
      from,
      to,
      insertedText: text,
      markers: settings.boldMarkers,
    });
    if (!edit) {
      return false;
    }

    const userEvent = text.length > 1 || /\r|\n/.test(text) || from !== to ? "input.paste" : "input.type";
    view.dispatch({
      changes: {
        from: edit.from,
        to: edit.to,
        insert: edit.text,
      },
      selection: {
        anchor: edit.from + edit.text.length,
      },
      userEvent,
    });
    return true;
  });
}
