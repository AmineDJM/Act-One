import path from 'node:path';

/**
 * HyperFrames' own verdict on the assembled film, read into Act One's terms.
 *
 * `hyperframes check` loads the whole project in the renderer's browser and
 * reports five kinds of finding: static lint, runtime errors, layout, motion
 * and WCAG contrast. Each finding is traced back to the scene that caused it
 * where it can be — by the file it names, or by the frame id every scene
 * prefixes its ids with — because a finding that names a scene can be sent
 * back to the agent that wrote it, and one that names nothing is the engine's
 * own fault and must stop the render rather than be retried at random.
 */
export type CheckSection = 'lint' | 'runtime' | 'layout' | 'motion' | 'contrast';

export type EngineFinding = {
  section: CheckSection;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The scenes the finding belongs to; empty when it names none of them. */
  frameIds: string[];
  /** Project-relative file, when the finding names one. */
  file: string | null;
  selector: string | null;
  /** The other element, when the finding is about two: what the selector collides with or escapes. */
  against: string | null;
  atSeconds: number | null;
  fixHint: string | null;
};

export type CheckReport = {
  ok: boolean;
  findings: EngineFinding[];
};

export class CheckOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckOutputError';
  }
}

const SECTIONS: readonly CheckSection[] = ['lint', 'runtime', 'layout', 'motion', 'contrast'];

/** Reads the JSON document `hyperframes check --json` prints. */
export function parseCheckOutput(stdout: string, projectDir: string, frameIds: ReadonlySet<string>): CheckReport {
  const document = jsonDocument(stdout);
  const findings: EngineFinding[] = [];
  for (const section of SECTIONS) {
    const part = document[section];
    if (!part || typeof part !== 'object') continue;
    const list = (part as { findings?: unknown }).findings;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (raw && typeof raw === 'object') findings.push(findingFrom(section, raw as Record<string, unknown>, projectDir, frameIds));
    }
  }
  return { ok: document.ok === true, findings };
}

/** Reads the JSON document `hyperframes lint --json` prints. */
export function parseLintOutput(stdout: string, projectDir: string, frameIds: ReadonlySet<string>): CheckReport {
  const document = jsonDocument(stdout);
  const list = Array.isArray(document.findings) ? document.findings : [];
  return {
    ok: document.ok === true,
    findings: list
      .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
      .map((raw) => findingFrom('lint', raw, projectDir, frameIds)),
  };
}

function jsonDocument(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  const candidates = [text];
  // Tolerates log lines printed ahead of the document: the document is the last top-level object.
  const lastObject = text.lastIndexOf('\n{');
  if (lastObject >= 0) candidates.push(text.slice(lastObject + 1));
  const firstObject = text.indexOf('{');
  if (firstObject > 0) candidates.push(text.slice(firstObject));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next reading.
    }
  }
  throw new CheckOutputError(`HyperFrames did not print a JSON report (${text.length} characters of output).`);
}

function findingFrom(
  section: CheckSection,
  raw: Record<string, unknown>,
  projectDir: string,
  frameIds: ReadonlySet<string>,
): EngineFinding {
  const file = relativeFile(text(raw.file) ?? text(raw.sourceFile), projectDir);
  const code = text(raw.code) ?? 'unknown';
  const selector = text(raw.selector);
  const against = text(raw.containerSelector);
  let severity: EngineFinding['severity'] = raw.severity === 'error' || raw.severity === 'warning' ? raw.severity : 'info';
  let message = (text(raw.message) ?? '').slice(0, 600);
  /*
   * The film's own overlays are layered over every scene on purpose: the
   * watermark a plan pays to remove, the captions a vertical cut is watched
   * by. A scene's words crossing one is worth knowing — the Remotion engine
   * draws the same collision — but it is not the scene's fault and no rewrite
   * of the scene is owed for it, so it is said, not blocked on.
   */
  if (severity === 'error' && code === 'content_overlap' && [selector, against].some((candidate) => candidate !== null && ENGINE_OVERLAY.test(candidate))) {
    severity = 'warning';
    message = `Crosses the film's own overlay (${against ?? selector}): ${message}`;
  }
  const time = Number(raw.time ?? raw.firstSeen);
  return {
    section,
    code,
    severity,
    message,
    frameIds: scenesNamed(raw, file, frameIds),
    file,
    selector,
    against,
    atSeconds: Number.isFinite(time) ? time : null,
    fixHint: text(raw.fixHint)?.slice(0, 400) ?? null,
  };
}

/** The engine's own layers over the scenes: the watermark and the burned-in captions. */
const ENGINE_OVERLAY = /#ao-watermark\b|#ao-caption-\d+|\.ao-caption(-line|-block)?\b/;

/**
 * The scenes a finding is about.
 *
 * The file wins when it is a scene's file. Otherwise the scenes named in the
 * selector, element id, snippet or message: every id a scene creates starts
 * with its frame id. The engine's own host elements are called
 * `host-scene-NN`, and a finding about one of those is about the engine's
 * markup, not the scene inside it, so that spelling is never read as a scene.
 */
export function scenesNamed(raw: Record<string, unknown>, file: string | null, frameIds: ReadonlySet<string>): string[] {
  const fromFile = file ? /^compositions\/(scene-\d+)\.html$/.exec(file)?.[1] : undefined;
  if (fromFile && frameIds.has(fromFile)) return [fromFile];
  const haystack = ['selector', 'elementId', 'containerSelector', 'snippet', 'message']
    .map((key) => text(raw[key]) ?? '')
    .join(' ');
  const named = new Set<string>();
  for (const match of haystack.matchAll(/(?<![\w-])(scene-\d+)(?!\d)/g)) {
    if (frameIds.has(match[1]!)) named.add(match[1]!);
  }
  return [...named].sort();
}

function relativeFile(file: string | null, projectDir: string): string | null {
  if (!file) return null;
  const relative = path.isAbsolute(file) ? path.relative(projectDir, file) : file;
  return relative.split(path.sep).join('/').replace(/^\.\//, '');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The findings that must not reach a render. */
export function blocking(findings: readonly EngineFinding[]): EngineFinding[] {
  return findings.filter((finding) => finding.severity === 'error');
}
