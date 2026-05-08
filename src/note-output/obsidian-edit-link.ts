import type { App, TFile } from "obsidian";
import { buildManagedFileProtocolUrl } from "../eudic-link";
import type { PathScope } from "../path-scope";
import type { EudicNoteOutputMode } from "../types";

const OBSIDIAN_EDIT_LINK_TEXT = "Obsidian↗️";

export function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

export function buildManagedObsidianUrl(app: App, pathScope: PathScope, file: TFile, linkId: string): string {
  return buildManagedFileProtocolUrl(app, pathScope, file, linkId);
}

export function buildObsidianEditLinkHtml(app: App, pathScope: PathScope, file: TFile, linkId: string): string {
  const href = buildManagedObsidianUrl(app, pathScope, file, linkId);
  const link = `<a href="${escapeAttribute(href)}">${escapeText(OBSIDIAN_EDIT_LINK_TEXT)}</a>`;
  return `<div style="text-align:right">${link}</div>`;
}

export function buildLinkedWordHtml(word: string, href: string): string {
  return `<a href="${escapeAttribute(href)}"><b>${escapeText(word)}</b></a>`;
}

export function appendObsidianEditLink(
  finalNoteHtml: string,
  file: TFile,
  app: App,
  pathScope: PathScope,
  mode: EudicNoteOutputMode,
  linkId: string,
): string {
  const editLink = buildObsidianEditLinkHtml(app, pathScope, file, linkId);
  const trimmedNote = finalNoteHtml.trim();
  if (!trimmedNote) {
    return editLink;
  }

  const separator = mode === "minimal" ? "\n\n" : "<br><br>";
  return `${trimmedNote}${separator}${editLink}`;
}
