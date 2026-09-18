/**
 * One request to Higgsfield, with the official SDK.
 *
 *   npm run higgsfield:example
 *
 * Generates a five-second Seedance 2.5 clip from a fixed prompt, waits for
 * it, and prints the URL — or says exactly why there is none. It spends
 * credits on the account whose credentials it finds.
 *
 * Credentials: HF_CREDENTIALS=key-id:key-secret, from the environment or from
 * .env.local at the repository root, which git ignores. The value is handed
 * to the SDK and never printed, logged or written anywhere.
 */
import { readFile } from 'node:fs/promises';
import { parseEnvBlock } from '@act-one/core';
import {
  APIError,
  AuthenticationError,
  BadInputError,
  NotEnoughCreditsError,
  TimeoutError,
  ValidationError,
  config,
  higgsfield,
} from '@higgsfield/client/v2';

const MODEL = 'bytedance/seedance-2.5/text-to-video';
const INPUT = {
  prompt: 'A cinematic scene at sunset',
  duration: 5,
  resolution: '720p',
  aspect_ratio: '16:9',
  output_format: 'mp4',
  generate_audio: true,
};
const WAIT_MINUTES = 15;

async function loadEnvLocal(): Promise<void> {
  let text: string;
  try {
    text = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
  } catch {
    return;
  }
  // The environment wins over the file, as with every dotenv loader.
  for (const { key, value } of parseEnvBlock(text)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

await loadEnvLocal();

const credentials = process.env.HF_CREDENTIALS?.trim();
if (!credentials) {
  fail(
    'HF_CREDENTIALS is not set. Put HF_CREDENTIALS=key-id:key-secret in .env.local (ignored by git) or in the environment. Keys are issued at https://console.higgsfield.ai.',
    2,
  );
}
if (!/^[^:\s]+:[^:\s]+$/.test(credentials)) {
  fail('HF_CREDENTIALS must be KEY_ID:KEY_SECRET.', 2);
}

config({ credentials, pollInterval: 3_000, maxPollTime: WAIT_MINUTES * 60_000 });

console.error(
  `Submitting to ${MODEL}: ${INPUT.duration}s, ${INPUT.resolution}, ${INPUT.aspect_ratio}. This spends credits.`,
);

try {
  // The SDK's v2 client returns the request itself: its status and its
  // outputs are on the object. (The `isCompleted` / `jobs[0]` accessors in
  // some samples belong to the JobSet of the older v1 client.)
  const result = await higgsfield.subscribe(MODEL, { input: INPUT, withPolling: true });
  const status: string = result.status;
  const reason = (result as { error?: string | null }).error;

  switch (status) {
    case 'completed': {
      const url = result.video?.url;
      if (!url) fail(`Request ${result.request_id} completed without a video URL.`);
      console.log(url);
      break;
    }
    case 'nsfw':
      fail(
        `Request ${result.request_id} was rejected by content moderation. No video was produced and nothing is charged.`,
        3,
      );
    // eslint-disable-next-line no-fallthrough
    case 'failed':
      fail(
        `Request ${result.request_id} failed on the provider's side${reason ? `: ${reason}` : ''}. Nothing is charged.`,
        3,
      );
    // eslint-disable-next-line no-fallthrough
    case 'canceled':
      fail(`Request ${result.request_id} was canceled before it started.`, 3);
    // eslint-disable-next-line no-fallthrough
    default:
      fail(`Request ${result.request_id} ended in state "${status}" without a video.`, 3);
  }
} catch (error) {
  // Messages only, never the error object: the SDK's HTTP errors carry the
  // request that failed, headers included.
  if (error instanceof AuthenticationError) {
    fail(
      'Higgsfield rejected the credentials. Check HF_CREDENTIALS (KEY_ID:KEY_SECRET) against https://console.higgsfield.ai.',
      4,
    );
  }
  if (error instanceof NotEnoughCreditsError) {
    fail('The Higgsfield account has no credits for this request.', 4);
  }
  if (error instanceof ValidationError || error instanceof BadInputError) {
    fail(`Higgsfield rejected the request: ${error.message}`, 4);
  }
  if (error instanceof TimeoutError) {
    fail(
      `The request did not finish within ${WAIT_MINUTES} minutes. It may still complete; look it up in the console. A request that fails is not charged.`,
      5,
    );
  }
  if (error instanceof APIError) {
    fail(`Higgsfield answered HTTP ${error.statusCode ?? '?'}: ${error.message}`, 5);
  }
  fail(`Could not reach Higgsfield: ${error instanceof Error ? error.message : String(error)}`, 5);
}
