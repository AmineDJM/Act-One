import { PLATFORM_ORGANIZATION_ID } from '@act-one/core';
import { checkForensicsRuntime, pythonBinary } from '@act-one/film-ir';
import { runJob, type RunnerDeps } from '@act-one/pipeline';
import { installProxyFromEnvironment , ProviderConfig, proxyConfigured, proxyMisconfiguration } from '@act-one/providers';
import { bundleFilm } from '@act-one/motion';
import { resolveTools } from '@act-one/motion-hyperframes';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_LIBRARY, buildSoundLibrary, resolveFfmpeg } from '@act-one/sound';
import { auditCredentials, buildRegistry, loadConfig, type WorkerConfig } from './config.ts';

/**
 * The render worker.
 *
 * A long-lived process that claims jobs and runs them. Deployed separately from
 * the web app because rendering a film takes minutes and holds gigabytes — work
 * that must never happen inside an HTTP request, where a proxy timeout would
 * kill it halfway and leave the customer looking at a spinner.
 *
 * Designed to be killed at any moment. Jobs are claimed with a lock rather than
 * removed, so a worker that dies mid-render has its job reclaimed by the
 * reaper and retried rather than lost.
 */
type WorkerState = {
  config: WorkerConfig;
  deps: RunnerDeps;
  inFlight: Set<Promise<void>>;
  shuttingDown: boolean;
  controller: AbortController;
};

async function main(): Promise<void> {
  /*
   * Before any provider exists. Node's fetch ignores HTTPS_PROXY, so a deploy
   * whose egress is behind a proxy would otherwise see every provider call
   * fail — as a timeout, or as a 401 that looks exactly like a bad API key.
   */
  const proxy = await installProxyFromEnvironment();
  if (proxy.proxy) {
    log(proxy.installed ? `egress proxy: ${proxy.proxy}` : `egress proxy configured but unavailable: ${proxy.proxy}`);
  }

  const config = loadConfig();

  const state: WorkerState = {
    config,
    deps: {
      store: config.store,
      workerId: config.workerId,
      vault: config.vault,
      buildRegistry: (scope) => buildRegistry(config, scope),
    },
    inFlight: new Set(),
    shuttingDown: false,
    controller: new AbortController(),
  };

  log(`starting as ${config.workerId} (concurrency ${config.concurrency})`);
  await preflight(config);
  installSignalHandlers(state);
  startReaper(state);
  startEditor(state);
  startAllowances(state);

  // The main loop. Claims up to `concurrency` jobs, then waits — either for a
  // slot to free up or for the poll interval, whichever comes first.
  while (!state.shuttingDown) {
    try {
      while (state.inFlight.size < config.concurrency && !state.shuttingDown) {
        const job = await config.store.jobs.claim(config.workerId);
        if (!job) break;

        log(`claimed ${job.kind} ${job.id} (attempt ${job.attempts})`);
        const task = runOne(state, job.id, job);
        state.inFlight.add(task);
        void task.finally(() => state.inFlight.delete(task));
      }
    } catch (error) {
      // A database blip must not kill the worker; it backs off and retries.
      log(`claim failed: ${(error as Error).message}`);
      await sleep(Math.min(30_000, config.pollIntervalMs * 5));
      continue;
    }

    if (state.inFlight.size === 0) {
      await sleep(config.pollIntervalMs);
    } else {
      await Promise.race([...state.inFlight, sleep(config.pollIntervalMs)]);
    }
  }

  log(`draining ${state.inFlight.size} job(s)`);
  await Promise.allSettled([...state.inFlight]);
  await config.database.close();
  log('stopped');
}

async function runOne(
  state: WorkerState,
  jobId: string,
  job: Parameters<typeof runJob>[1],
): Promise<void> {
  const started = Date.now();
  const where = {
    organizationId: job.organizationId,
    projectId: job.projectId ?? null,
    jobId,
    actorUserId: null,
  };

  try {
    const outcome = await runJob(state.deps, job, state.controller.signal);
    const durationMs = Date.now() - started;
    const error = 'error' in outcome ? outcome.error : undefined;
    log(`${jobId} ${outcome.status} in ${(durationMs / 1000).toFixed(1)}s${error ? `: ${error}` : ''}`);

    /*
     * Stdout is where this used to end, on a machine nobody operating the
     * platform can reach. The customer is told "Something went wrong on our
     * side" — correct, and useless on its own. The operator reads this.
     */
    state.deps.store.log.recordSafely({
      ...where,
      level: outcome.status === 'failed' ? 'error' : 'info',
      source: 'worker',
      event: `job.${outcome.status}`,
      message: error ?? `${job.kind} ${outcome.status}`,
      durationMs,
      detail: { kind: job.kind, attempt: job.attempts, worker: state.config.workerId },
    });
  } catch (error) {
    // runJob already records failure; this is the last line of defence against
    // an unhandled rejection taking the process down with it.
    const message = error instanceof Error ? error.message : String(error);
    log(`${jobId} threw outside the runner: ${message}`);
    state.deps.store.log.recordSafely({
      ...where,
      level: 'error',
      source: 'worker',
      event: 'job.crashed',
      message,
      durationMs: Date.now() - started,
      detail: { kind: job.kind, attempt: job.attempts, worker: state.config.workerId },
    });
  }
}

/**
 * Fails fast on a misconfigured host.
 *
 * A worker that starts happily and then fails every render an hour later — on a
 * missing FFmpeg or a broken bundle — is far worse than one that refuses to
 * start. Bundling here also warms the cache so the first real job is not the
 * one paying for it.
 */
async function preflight(config: WorkerConfig): Promise<void> {
  try {
    const ffmpeg = await resolveFfmpeg();
    log(`ffmpeg: ${ffmpeg}`);
  } catch (error) {
    throw new Error(`Preflight failed — ${(error as Error).message}`);
  }

  try {
    const started = Date.now();
    await bundleFilm();
    log(`motion bundle ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    // Not fatal: research and concept jobs do not need the renderer, and a
    // worker that can do two thirds of the work beats one that does none.
    log(`motion bundle unavailable, render jobs will fail: ${(error as Error).message}`);
  }

  await checkHyperFrames(config);
  checkEgress();
  await checkCredentials(config);
  await checkStorage(config);
  await checkSoundLibrary(config);
  await checkForensics();
}

/**
 * Says whether this worker can draw a film with HyperFrames.
 *
 * Only asked when the platform is set to that engine, or this worker is pinned
 * to it. Not fatal: every other job runs without it, and a render asked of a
 * worker that cannot draw fails at once with the same reason — said here so it
 * is in the deploy's log before anybody asks.
 */
async function checkHyperFrames(config: WorkerConfig): Promise<void> {
  const settings = await config.store.platform.getSettings().catch(() => null);
  const parsed = ProviderConfig.safeParse(settings?.providerConfig ?? {});
  const pinned = process.env['ACT_ONE_FILM_ENGINE'];
  const engine = pinned === 'remotion' || pinned === 'hyperframes' ? pinned : parsed.success ? parsed.data.render.engine : 'remotion';
  if (engine !== 'hyperframes') return;
  try {
    const tools = await resolveTools();
    log(`hyperframes ${tools.cliVersion}: browser ${tools.browserPath}, ffprobe ${tools.ffprobePath}`);
  } catch (error) {
    log(`hyperframes unavailable, film renders will fail: ${(error as Error).message}`);
  }
}

/**
 * Says whether this worker can read a reference film for the Benchmark Library.
 *
 * Not fatal: customer films never touch the analyzer, and an analysis asked
 * of a worker without it fails at once with this same reason. Said here so
 * the reason is in the deploy's log before anybody asks.
 */
async function checkForensics(): Promise<void> {
  const runtime = await checkForensicsRuntime();
  log(
    runtime.ok
      ? `forensic analyzer: ${pythonBinary()} (${Object.entries(runtime.versions).map(([name, version]) => `${name} ${version}`).join(', ')})`
      : `forensic analyzer unavailable, benchmark analyses will fail: ${runtime.reason}`,
  );
}

/**
 * Says out loud whether this worker can make sound.
 *
 * The library manifest has always described files in object storage, and
 * nothing ever checked that they were there. A worker with no library still
 * builds a completely correct mix — of nothing — and every film it renders
 * comes out silent, with no error anywhere to explain it. The manifest's own
 * comment promised this check; this is it.
 *
 * Not fatal, because a silent film is still a film and refusing to start would
 * take down a worker that can do everything else. Loud, because the failure is
 * otherwise invisible until somebody plays a master.
 */
/**
 * Says out loud whether this worker can reach the outside world.
 *
 * A proxy configured for the machine that Node was not told to use is the
 * quietest deployment failure there is: the database works, the health check
 * works, and the first provider call two minutes into a customer's film comes
 * back 401 or times out. Said at startup it costs a line; discovered later it
 * costs an incident.
 */
function checkEgress(): void {
  const problem = proxyMisconfiguration();
  if (problem) log(`egress: ${problem}`);
  else if (proxyConfigured()) log('egress: through the configured proxy');
}

/**
 * Says out loud whether anything this worker makes can be reached.
 *
 * The worker renders a film and writes it to storage; the web service serves
 * it from storage. If that store is this instance's own disk, every master it
 * produces is unreachable from the page that offers it — the film exists in
 * the database, the player is black, and the only trace is an ENOENT in the
 * web service's log naming a path that was never on its machine.
 */
/**
 * Says out loud which provider keys this worker can actually read.
 *
 * A key stored by the console and unreadable here is the worst of the
 * configuration failures, because Super Admin shows it green: the service that
 * encrypted it can still read it, and only the worker cannot. Every job then
 * fails with a provider 401 pointing at a key the operator can see is set.
 */
async function checkCredentials(config: WorkerConfig): Promise<void> {
  const audited = await auditCredentials(config, [
    'openai',
    'browserbase',
    'higgsfield',
    'supabase',
    'elevenlabs',
    'gemini',
  ]);
  const unreadable = audited.filter((entry) => entry.state === 'unreadable');
  if (unreadable.length > 0) {
    log(
      `credentials: cannot decrypt ${unreadable.map((entry) => entry.provider).join(', ')} — ` +
        'ACT_ONE_SECRET_KEYS here is not the key Super Admin encrypted them with. ' +
        'Both services and the console must share one vault.',
    );
  }
  const readable = audited.filter((entry) => entry.state === 'vault').map((entry) => entry.provider);
  const fromEnvironment = audited.filter((entry) => entry.state === 'environment').map((entry) => entry.provider);
  const missing = audited.filter((entry) => entry.state === 'missing').map((entry) => entry.provider);
  log(
    `credentials: ${readable.length} from the vault${readable.length ? ` (${readable.join(', ')})` : ''}` +
      `${fromEnvironment.length ? `, ${fromEnvironment.length} from the environment (${fromEnvironment.join(', ')})` : ''}` +
      `${missing.length ? `, ${missing.length} not configured (${missing.join(', ')})` : ''}`,
  );
}

async function checkStorage(config: WorkerConfig): Promise<void> {
  const registry = await buildRegistry(config, { organizationId: 'platform' });
  const problem = registry.storageMisconfiguration();
  if (problem) log(`storage: ${problem}`);
  else log(`storage: ${registry.storage().name}`);
}

async function checkSoundLibrary(config: WorkerConfig): Promise<void> {
  const registry = await buildRegistry(config, { organizationId: 'platform' });
  const storage = registry.storage();
  const keys = [
    ...DEFAULT_LIBRARY.music.map((track) => track.storageKey),
    ...DEFAULT_LIBRARY.sfx.map((sample) => sample.storageKey),
  ];

  const present = await Promise.all(
    keys.map(async (key) => ((await storage.exists(key).catch(() => false)) ? key : null)),
  );
  const missing = keys.filter((_, index) => present[index] === null);
  if (missing.length === 0) {
    log(`sound library: ${keys.length} files present in ${storage.name}`);
    return;
  }

  /*
   * Build it rather than complain about it.
   *
   * The library is the same nineteen files for every deployment; it is not
   * configuration, it is part of the product. Leaving it as a command an
   * operator has to know about means the first film of every new deployment
   * comes out silent — and the check that was supposed to warn about that
   * skipped itself entirely the moment storage stopped being a local
   * directory, which is to say on every real deployment there has ever been.
   *
   * Four minutes, once, before this worker takes its first job. Two workers
   * booting together will both build it, which wastes a few minutes of one of
   * them and is harmless: the files are identical and the keys are the same.
   */
  log(`sound library: ${missing.length} of ${keys.length} files missing from ${storage.name}; building them now`);
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-sound-'));
  try {
    const built = await buildSoundLibrary({
      storageDir: workDir,
      onProgress: (message, done, total) => log(`sound library: ${done + 1}/${total} ${message}`),
    });
    let uploaded = 0;
    for (const key of built.written) {
      await storage.put(key, new Uint8Array(await readFile(path.join(workDir, key))), {
        contentType: 'audio/wav',
      });
      uploaded += 1;
    }
    log(`sound library: ${uploaded} file(s) written to ${storage.name}`);
  } catch (error) {
    // Not fatal: a silent film is still a film, and a worker that refuses to
    // start does none of the other work either. Loud, because the failure is
    // otherwise invisible until somebody plays a master.
    log(
      `sound library: could not build it — films will render SILENT until it is there. ` +
        `${(error as Error).message}`,
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Reclaims jobs from workers that died holding a lock.
 *
 * Without this, a host that is killed mid-render strands that job forever and
 * the customer's film never finishes with no error to explain why.
 */
function startReaper(state: WorkerState): void {
  const interval = setInterval(() => {
    void state.config.store.jobs
      .reapStale(state.config.staleLockMs)
      .then((count) => {
        if (count > 0) log(`reclaimed ${count} stale job(s)`);
      })
      .catch((error: unknown) => log(`reaper failed: ${(error as Error).message}`));
  }, 60_000);
  interval.unref();
}

function installSignalHandlers(state: WorkerState): void {
  const shutdown = (signal: string) => {
    if (state.shuttingDown) {
      log(`${signal} again — exiting immediately`);
      process.exit(1);
    }
    log(`${signal} — finishing in-flight work`);
    state.shuttingDown = true;

    // Give in-flight renders a bounded window to finish cleanly. Past that the
    // platform will SIGKILL us anyway, and the reaper will reclaim whatever
    // was still running.
    setTimeout(() => {
      log('grace period elapsed — aborting in-flight work');
      state.controller.abort();
    }, 25_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

function log(message: string): void {
  console.log(`[worker ${new Date().toISOString()}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error('[worker] fatal:', error);
  process.exit(1);
});

/**
 * The allowance clock.
 *
 * An annual subscriber generates one Stripe event a year and is promised
 * credits every month, so nothing event-driven would ever notice the other
 * eleven are due. This notices. Every allocation is keyed by its period, so
 * running beside the invoice that triggers the same grant is harmless — the
 * ledger takes the first and refuses the rest.
 */
function startAllowances(state: WorkerState): void {
  const tick = async () => {
    if (state.shuttingDown) return;
    try {
      const { grantAllowancesForEveryone } = await import('@act-one/db');
      const settings = await state.config.store.platform.getSettings();
      const { DEFAULT_PLANS, Plan } = await import('@act-one/core');
      const parsed = Plan.array().safeParse(settings.plans);
      const plans = parsed.success && parsed.data.length > 0 ? parsed.data : DEFAULT_PLANS;
      const outcome = await grantAllowancesForEveryone({ store: state.config.store, plans });
      if (outcome.workspaces > 0) {
        log(`allowances: ${outcome.creditsAdded} credits to ${outcome.workspaces} workspace(s)`);
      }
    } catch (error) {
      log(`allowance tick failed: ${(error as Error).message}`);
    }
  };

  // Hourly. A period is a month at its shortest, so being an hour late is
  // invisible, and being cheap matters more than being instant.
  const timer = setInterval(() => void tick(), 60 * 60_000);
  timer.unref?.();
  void tick();
}

/**
 * The journal's own clock.
 *
 * Publishes what was scheduled and, when the operator has asked for it,
 * drafts one piece per cadence. Runs beside the queue rather than in it: an
 * article has no project, and a journal must never delay a customer's film.
 * Every failure is logged and swallowed — the worker's job is the queue.
 */
function startEditor(state: WorkerState): void {
  const tick = async () => {
    if (state.shuttingDown) return;
    try {
      const { runEditorialTick } = await import('@act-one/pipeline/editorial');
      const { readEditorialSchedule, writeEditorialSchedule } = await import('./editorial.ts');
      const schedule = await readEditorialSchedule(state.config.store);
      const registry = await state.deps.buildRegistry({ organizationId: PLATFORM_ORGANIZATION_ID, projectId: null });
      const outcome = await runEditorialTick({
        store: state.config.store,
        llm: registry.llm(),
        schedule,
        context: { organizationId: PLATFORM_ORGANIZATION_ID, projectId: null },
      });
      if (outcome.drafted) {
        await writeEditorialSchedule(state.config.store, { ...schedule, lastRunAt: new Date().toISOString() });
        log(`journal: drafted ${outcome.drafted}`);
      }
      for (const slug of outcome.published) log(`journal: published ${slug}`);
    } catch (error) {
      log(`journal tick failed: ${(error as Error).message}`);
    }
  };

  // Every ten minutes: often enough that a scheduled article appears on time,
  // rare enough to cost nothing when there is nothing to do.
  const timer = setInterval(() => void tick(), 10 * 60_000);
  timer.unref?.();
  void tick();
}
