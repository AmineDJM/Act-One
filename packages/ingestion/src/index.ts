export { ingestBrand, type IngestionDependencies, type IngestionResult } from './engine.ts';
export { writeIngestion } from './persist.ts';
export { IngestionError, type IngestionFailure } from './errors.ts';
export { consoleLogger, silentLogger, type IngestionLogger, type LogLevel } from './logger.ts';
export type { IngestedAsset } from './assets.ts';
export * from './schema.ts';

export { sanitizeSvg, SvgRejected, type SanitizedSvg } from './svg/sanitize-svg.ts';
export { inspectFontFile, detectFontFormat, FontFileError, type FontFileInfo } from './fonts/font-file.ts';
export { classifyLicence } from './fonts/licence.ts';
export { parseFontFaceRules, parseSrcDescriptor, type FontFaceDeclaration } from './fonts/font-face-css.ts';
export { unsafeRequestReason } from './browser/request-guard.ts';
export { renderContactSheet } from './contact-sheet.ts';
