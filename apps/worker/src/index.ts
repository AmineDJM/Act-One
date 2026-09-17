import { runJob, type RunnerDeps } from '@act-one/pipeline';
import { installProxyFromEnvironment } from '@act-one/providers';
import { bundleFilm } from '@act-one/motion';
import { resolveFfmpeg } from '@act-one/sound';
import { buildRegistry, loadConfig, type WorkerConfig } from './config.ts';

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
  await preflight();
  installSignalHandlers(state);
  startReaper(state);

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
async function preflight(): Promise<void> {
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
