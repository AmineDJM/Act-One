/**
 * One word, and when it is said.
 *
 * Declared here rather than imported from the providers package so the Director
 * can reason about a reading without depending on whoever produced it. The
 * provider's `SpokenWord` is structurally the same type.
 */
export type SpokenWord = { word: string; startSeconds: number; endSeconds: number };
