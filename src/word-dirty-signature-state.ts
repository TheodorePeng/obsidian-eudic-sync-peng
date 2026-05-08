export type WordDirtySignatureDecision = "clean" | "dirty" | "unchanged";

export interface WordDirtySignatureState {
  cleanSignature?: string;
  previousSignature?: string;
  nextSignature: string;
}

export function resolveWordDirtySignatureDecision(state: WordDirtySignatureState): WordDirtySignatureDecision {
  if (state.cleanSignature !== undefined) {
    return state.nextSignature === state.cleanSignature ? "clean" : "dirty";
  }

  if (state.previousSignature === undefined) {
    return "dirty";
  }

  return state.nextSignature === state.previousSignature ? "unchanged" : "dirty";
}
