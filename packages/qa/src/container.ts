import { open } from 'node:fs/promises';
import { runFfmpeg } from '@act-one/sound';

/**
 * Whether a master will play where it is going.
 *
 * Nobody here has ever watched one of these files in a browser: the Chromium
 * this system develops on ships without the H.264 decoder, so "the file is
 * valid" has only ever meant "ffprobe did not complain". That is not the same
 * thing. A browser plays an MP4 when the container says the right things —
 * `avc1` in a brand it recognises, a profile and level its decoder covers,
 * 4:2:0 8-bit chroma, AAC-LC audio, the `moov` box ahead of the media so
 * playback can begin before the download ends — and this reads those things
 * from the bytes, rather than trusting the encoder to have written them.
 *
 * The parser is deliberately small. It walks boxes, reads the handful the
 * verdict needs, and ignores the rest; it is not a media library.
 */
export type ColourTags = {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
};

export type VideoTrackFacts = {
  codec: string;
  profile: number;
  level: number;
  /** 1 = 4:2:0. Known only for High-family profiles, where avcC records it. */
  chromaFormat: number | null;
  bitDepth: number | null;
  width: number;
  height: number;
  colour: ColourTags | null;
  sampleCount: number;
  durationSeconds: number;
};

export type AudioTrackFacts = {
  codec: string;
  /** MPEG-4 audio object type; 2 is AAC-LC. */
  objectType: number | null;
  sampleRate: number;
  channels: number;
};

export type ContainerFacts = {
  brands: string[];
  /** `moov` precedes `mdat`: the player can start before the file has finished arriving. */
  faststart: boolean;
  durationSeconds: number;
  video: VideoTrackFacts | null;
  audio: AudioTrackFacts | null;
};

/** H.264 profile_idc values a browser or a phone is sure to decode. */
const PLAYABLE_PROFILES = new Map<number, string>([
  [66, 'Baseline'],
  [77, 'Main'],
  [88, 'Extended'],
  [100, 'High'],
]);
const PROFILE_NAMES = new Map<number, string>([
  ...PLAYABLE_PROFILES,
  [110, 'High 10'],
  [122, 'High 4:2:2'],
  [244, 'High 4:4:4'],
]);
/** Level 5.1 covers 4K at 30 fps; above it, hardware decoders drop out. */
const MAX_LEVEL = 51;
const KNOWN_BRANDS = ['isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1'];

export async function readContainer(path: string): Promise<ContainerFacts> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    let offset = 0;
    let brands: string[] = [];
    let moov: Buffer | null = null;
    let sawMoov = false;
    let sawMdat = false;
    let moovFirst = false;

    while (offset + 8 <= size) {
      const header = Buffer.alloc(16);
      await handle.read(header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (boxSize < headerSize) break;

      if (type === 'ftyp') {
        const body = Buffer.alloc(boxSize - headerSize);
        await handle.read(body, 0, body.length, offset + headerSize);
        brands = [body.toString('latin1', 0, 4)];
        for (let i = 8; i + 4 <= body.length; i += 4) brands.push(body.toString('latin1', i, i + 4));
      } else if (type === 'moov') {
        sawMoov = true;
        moovFirst = !sawMdat;
        moov = Buffer.alloc(boxSize - headerSize);
        await handle.read(moov, 0, moov.length, offset + headerSize);
      } else if (type === 'mdat') {
        sawMdat = true;
      }
      offset += boxSize;
    }

    if (!moov) throw new Error(`${path} has no moov box; it is not a playable MP4.`);
    const parsed = parseMoov(moov);
    return {
      brands,
      faststart: sawMoov && sawMdat && moovFirst,
      durationSeconds: parsed.durationSeconds,
      video: parsed.video,
      audio: parsed.audio,
    };
  } finally {
    await handle.close();
  }
}

type Box = { type: string; body: Buffer };

function boxes(buffer: Buffer): Box[] {
  const result: Box[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let boxSize = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let headerSize = 8;
    if (boxSize === 1 && offset + 16 <= buffer.length) {
      boxSize = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = buffer.length - offset;
    }
    if (boxSize < headerSize || offset + boxSize > buffer.length) break;
    result.push({ type, body: buffer.subarray(offset + headerSize, offset + boxSize) });
    offset += boxSize;
  }
  return result;
}

function child(parent: Buffer, type: string): Buffer | null {
  return boxes(parent).find((box) => box.type === type)?.body ?? null;
}

function parseMoov(moov: Buffer): {
  durationSeconds: number;
  video: VideoTrackFacts | null;
  audio: AudioTrackFacts | null;
} {
  let durationSeconds = 0;
  const mvhd = child(moov, 'mvhd');
  if (mvhd) {
    const version = mvhd[0];
    const timescale = version === 1 ? mvhd.readUInt32BE(20) : mvhd.readUInt32BE(12);
    const duration = version === 1 ? Number(mvhd.readBigUInt64BE(24)) : mvhd.readUInt32BE(16);
    durationSeconds = timescale > 0 ? duration / timescale : 0;
  }

  let video: VideoTrackFacts | null = null;
  let audio: AudioTrackFacts | null = null;

  for (const trak of boxes(moov).filter((box) => box.type === 'trak')) {
    const mdia = child(trak.body, 'mdia');
    if (!mdia) continue;
    const hdlr = child(mdia, 'hdlr');
    const handler = hdlr ? hdlr.toString('latin1', 8, 12) : '';
    const minf = child(mdia, 'minf');
    const stbl = minf ? child(minf, 'stbl') : null;
    const stsd = stbl ? child(stbl, 'stsd') : null;
    if (!stsd) continue;

    const mdhd = child(mdia, 'mdhd');
    let trackSeconds = 0;
    if (mdhd) {
      const version = mdhd[0];
      const timescale = version === 1 ? mdhd.readUInt32BE(20) : mdhd.readUInt32BE(12);
      const duration = version === 1 ? Number(mdhd.readBigUInt64BE(24)) : mdhd.readUInt32BE(16);
      trackSeconds = timescale > 0 ? duration / timescale : 0;
    }
    const stsz = stbl ? child(stbl, 'stsz') : null;
    const sampleCount = stsz ? stsz.readUInt32BE(8) : 0;

    // stsd: version/flags, entry count, then sample entries as boxes.
    const entries = boxes(stsd.subarray(8));
    const entry = entries[0];
    if (!entry) continue;

    if (handler === 'vide' && !video) {
      // Visual sample entry: 8 bytes of reserved/data-reference, then 70 bytes
      // of fields before the child boxes.
      const width = entry.body.readUInt16BE(24);
      const height = entry.body.readUInt16BE(26);
      const children = boxes(entry.body.subarray(78));
      const avcC = children.find((box) => box.type === 'avcC')?.body ?? null;
      const colr = children.find((box) => box.type === 'colr')?.body ?? null;
      const sps = avcC ? parseSps(firstSps(avcC)) : null;
      video = {
        codec: entry.type,
        profile: avcC ? avcC[1]! : 0,
        level: avcC ? avcC[3]! : 0,
        chromaFormat: sps?.chromaFormat ?? (avcC ? highProfileExtras(avcC).chromaFormat : null),
        bitDepth: sps?.bitDepth ?? (avcC ? highProfileExtras(avcC).bitDepth : null),
        width,
        height,
        // The bitstream's own word first: players read the VUI, and a colr box
        // that disagrees with it loses. The box is the fallback for a stream
        // whose SPS says nothing.
        colour: sps?.colour ?? (colr ? parseColr(colr) : null),
        sampleCount,
        durationSeconds: trackSeconds,
      };
    } else if (handler === 'soun' && !audio) {
      // Audio sample entry: 8 reserved/data-reference, then version 0 fields.
      const channels = entry.body.readUInt16BE(16);
      const sampleRate = entry.body.readUInt32BE(24) >>> 16;
      const esds = boxes(entry.body.subarray(28)).find((box) => box.type === 'esds')?.body ?? null;
      audio = {
        codec: entry.type,
        objectType: esds ? aacObjectType(esds) : null,
        sampleRate,
        channels,
      };
    }
  }

  return { durationSeconds, video, audio };
}

/** avcC carries chroma format and bit depth only for the High family of profiles. */
function highProfileExtras(avcC: Buffer): { chromaFormat: number | null; bitDepth: number | null } {
  const profile = avcC[1]!;
  if (![100, 110, 122, 144, 244].includes(profile)) return { chromaFormat: null, bitDepth: null };
  let offset = 5;
  const spsCount = avcC[offset]! & 0x1f;
  offset += 1;
  for (let i = 0; i < spsCount && offset + 2 <= avcC.length; i += 1) {
    offset += 2 + avcC.readUInt16BE(offset);
  }
  if (offset >= avcC.length) return { chromaFormat: null, bitDepth: null };
  const ppsCount = avcC[offset]!;
  offset += 1;
  for (let i = 0; i < ppsCount && offset + 2 <= avcC.length; i += 1) {
    offset += 2 + avcC.readUInt16BE(offset);
  }
  if (offset + 3 > avcC.length) return { chromaFormat: null, bitDepth: null };
  return {
    chromaFormat: avcC[offset]! & 0x03,
    bitDepth: 8 + (avcC[offset + 1]! & 0x07),
  };
}

function parseColr(colr: Buffer): ColourTags | null {
  const kind = colr.toString('latin1', 0, 4);
  if (kind !== 'nclx' && kind !== 'nclc') return null;
  return {
    primaries: colr.readUInt16BE(4),
    transfer: colr.readUInt16BE(6),
    matrix: colr.readUInt16BE(8),
    fullRange: kind === 'nclx' && colr.length > 10 ? (colr[10]! & 0x80) !== 0 : false,
  };
}

/**
 * The audio object type from an esds box: the first five bits of the
 * AudioSpecificConfig inside the DecoderSpecificInfo descriptor.
 */
function aacObjectType(esds: Buffer): number | null {
  let offset = 4; // version and flags
  const readDescriptor = (): { tag: number; size: number; start: number } | null => {
    if (offset >= esds.length) return null;
    const tag = esds[offset]!;
    offset += 1;
    let size = 0;
    for (let i = 0; i < 4 && offset < esds.length; i += 1) {
      const byte = esds[offset]!;
      offset += 1;
      size = (size << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return { tag, size, start: offset };
  };

  const es = readDescriptor();
  if (!es || es.tag !== 0x03) return null;
  offset = es.start + 3; // ES_ID and flags
  const flags = esds[es.start + 2]!;
  if (flags & 0x80) offset += 2;
  if (flags & 0x40) offset += 1 + esds[offset]!;
  if (flags & 0x20) offset += 2;

  const decoder = readDescriptor();
  if (!decoder || decoder.tag !== 0x04) return null;
  offset = decoder.start + 13; // objectTypeIndication, streamType, buffer size, bitrates
  const specific = readDescriptor();
  if (!specific || specific.tag !== 0x05 || specific.start >= esds.length) return null;
  return esds[specific.start]! >> 3;
}

/**
 * What would stop this file playing, in words. Empty means it plays.
 *
 * `expected` is what the render asked for; a master at the wrong size is a
 * wrong master, whatever else is right about it.
 */
export function playabilityIssues(
  facts: ContainerFacts,
  expected: { width: number; height: number; audio?: boolean } = { width: 0, height: 0 },
): string[] {
  const issues: string[] = [];
  if (!facts.brands.some((brand) => KNOWN_BRANDS.includes(brand))) {
    issues.push(`File brands ${facts.brands.join(', ') || '(none)'} are not an MP4 brand players recognise.`);
  }
  if (!facts.faststart) {
    issues.push('The moov box is after the media: playback cannot begin until the whole file has downloaded.');
  }

  const video = facts.video;
  if (!video) {
    issues.push('No video track.');
  } else {
    if (video.codec !== 'avc1' && video.codec !== 'avc3') {
      issues.push(`Video is ${video.codec}, not avc1 (H.264).`);
    }
    if (!PLAYABLE_PROFILES.has(video.profile)) {
      issues.push(
        `H.264 profile ${PROFILE_NAMES.get(video.profile) ?? video.profile} is not decoded by browsers and phones; use High or lower.`,
      );
    }
    if (video.level > MAX_LEVEL) {
      issues.push(`H.264 level ${(video.level / 10).toFixed(1)} exceeds 5.1, the ceiling for hardware decoders.`);
    }
    if (video.chromaFormat !== null && video.chromaFormat !== 1) {
      issues.push('Chroma is not 4:2:0; browsers decode 4:2:0 only.');
    }
    if (video.bitDepth !== null && video.bitDepth !== 8) {
      issues.push(`Bit depth is ${video.bitDepth}; deliverables are 8-bit.`);
    }
    if (!video.colour) {
      issues.push('Colour is untagged; players will guess the transfer and matrix, each differently.');
    } else if (video.colour.primaries !== 1 || video.colour.transfer !== 1 || video.colour.matrix !== 1) {
      issues.push(
        `Colour is tagged ${video.colour.primaries}/${video.colour.transfer}/${video.colour.matrix}, not BT.709 (1/1/1).`,
      );
    } else if (video.colour.fullRange) {
      issues.push('Video is flagged full range; deliverables are studio range.');
    }
    if (video.width % 2 !== 0 || video.height % 2 !== 0) {
      issues.push(`Odd dimensions ${video.width}x${video.height} cannot be 4:2:0.`);
    }
    if (expected.width > 0 && (video.width !== expected.width || video.height !== expected.height)) {
      issues.push(`Master is ${video.width}x${video.height}, not the ${expected.width}x${expected.height} that was asked for.`);
    }
    if (video.sampleCount === 0) issues.push('The video track has no samples.');
  }

  const audio = facts.audio;
  if (expected.audio !== false) {
    if (!audio) {
      issues.push('No audio track.');
    } else {
      if (audio.codec !== 'mp4a') issues.push(`Audio is ${audio.codec}, not AAC.`);
      if (audio.objectType !== null && audio.objectType !== 2) {
        issues.push(`AAC object type ${audio.objectType} is not AAC-LC, the one every player decodes.`);
      }
      if (audio.sampleRate !== 48000 && audio.sampleRate !== 44100) {
        issues.push(`Audio sample rate ${audio.sampleRate} Hz is neither 48 kHz nor 44.1 kHz.`);
      }
      if (audio.channels > 2) issues.push(`${audio.channels} audio channels; deliverables are stereo.`);
    }
  }

  return issues;
}

/**
 * Decodes every frame and every sample, and reports any decoder complaint.
 *
 * The container can say all the right things about a bitstream that is
 * broken. This is the other half of "it plays": the decoder went through it
 * end to end and had nothing to say.
 */
export async function decodeCleanly(
  path: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: boolean; complaint: string }> {
  const result = await runFfmpeg(
    ['-v', 'error', '-xerror', '-nostdin', '-i', path, '-f', 'null', '-'],
    { signal: options.signal, timeoutMs: options.timeoutMs ?? 600_000 },
  );
  const complaint = result.stderr.trim();
  return { ok: result.ok && complaint.length === 0, complaint };
}

/**
 * The full verdict on a master, for the render stage to refuse on.
 */
export async function verifyMaster(
  path: string,
  expected: { width: number; height: number; audio?: boolean },
  options: { signal?: AbortSignal } = {},
): Promise<{ facts: ContainerFacts; issues: string[] }> {
  const facts = await readContainer(path);
  const issues = playabilityIssues(facts, expected);
  const decoded = await decodeCleanly(path, { signal: options.signal });
  if (!decoded.ok) {
    issues.push(`The decoder complained: ${decoded.complaint.split('\n')[0] ?? 'unknown error'}`);
  }
  return { facts, issues };
}

/** The first sequence parameter set in an avcC box, without its NAL header. */
function firstSps(avcC: Buffer): Buffer | null {
  if (avcC.length < 8) return null;
  const spsCount = avcC[5]! & 0x1f;
  if (spsCount === 0) return null;
  const length = avcC.readUInt16BE(6);
  if (8 + length > avcC.length) return null;
  // Byte 8 is the NAL header (type 7); the RBSP starts after it.
  return avcC.subarray(9, 8 + length);
}

/**
 * The parts of an H.264 SPS a playability verdict needs.
 *
 * Read with the same bit-exact grammar a decoder uses (ITU-T H.264 §7.3.2.1),
 * up to the VUI's colour description and no further. Emulation-prevention
 * bytes are stripped first, as the specification requires — a 0x000003
 * sequence in the payload is an escape, not data.
 */
export function parseSps(rbsp: Buffer | null): {
  profile: number;
  level: number;
  chromaFormat: number;
  bitDepth: number;
  colour: ColourTags | null;
} | null {
  if (!rbsp || rbsp.length < 4) return null;
  try {
    const bits = new BitReader(unescape(rbsp));
    const profile = bits.u(8);
    bits.u(8); // constraint flags and reserved bits
    const level = bits.u(8);
    bits.ue(); // seq_parameter_set_id

    let chromaFormat = 1;
    let bitDepth = 8;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chromaFormat = bits.ue();
      if (chromaFormat === 3) bits.u(1); // separate_colour_plane_flag
      bitDepth = 8 + bits.ue(); // bit_depth_luma_minus8
      bits.ue(); // bit_depth_chroma_minus8
      bits.u(1); // qpprime_y_zero_transform_bypass_flag
      if (bits.u(1)) {
        // seq_scaling_matrix_present_flag: walk the lists to stay aligned.
        const lists = chromaFormat !== 3 ? 8 : 12;
        for (let i = 0; i < lists; i += 1) {
          if (bits.u(1)) skipScalingList(bits, i < 6 ? 16 : 64);
        }
      }
    }

    bits.ue(); // log2_max_frame_num_minus4
    const pocType = bits.ue();
    if (pocType === 0) {
      bits.ue();
    } else if (pocType === 1) {
      bits.u(1);
      bits.se();
      bits.se();
      const cycle = bits.ue();
      for (let i = 0; i < cycle; i += 1) bits.se();
    }
    bits.ue(); // max_num_ref_frames
    bits.u(1); // gaps_in_frame_num_value_allowed_flag
    bits.ue(); // pic_width_in_mbs_minus1
    bits.ue(); // pic_height_in_map_units_minus1
    if (!bits.u(1)) bits.u(1); // frame_mbs_only_flag, mb_adaptive_frame_field_flag
    bits.u(1); // direct_8x8_inference_flag
    if (bits.u(1)) {
      bits.ue();
      bits.ue();
      bits.ue();
      bits.ue(); // frame cropping offsets
    }

    let colour: ColourTags | null = null;
    if (bits.u(1)) {
      // vui_parameters_present_flag
      if (bits.u(1)) {
        // aspect_ratio_info_present_flag
        if (bits.u(8) === 255) {
          bits.u(16);
          bits.u(16);
        }
      }
      if (bits.u(1)) bits.u(1); // overscan
      if (bits.u(1)) {
        // video_signal_type_present_flag
        bits.u(3); // video_format
        const fullRange = bits.u(1) === 1;
        if (bits.u(1)) {
          // colour_description_present_flag
          colour = {
            primaries: bits.u(8),
            transfer: bits.u(8),
            matrix: bits.u(8),
            fullRange,
          };
        } else {
          colour = { primaries: 2, transfer: 2, matrix: 2, fullRange };
        }
      }
    }

    return { profile, level, chromaFormat, bitDepth, colour };
  } catch {
    // A truncated or malformed SPS: the container facts stand on their own,
    // and the decode pass will say what a decoder makes of it.
    return null;
  }
}

function skipScalingList(bits: BitReader, size: number): void {
  let last = 8;
  let next = 8;
  for (let j = 0; j < size; j += 1) {
    if (next !== 0) {
      const delta = bits.se();
      next = (last + delta + 256) % 256;
    }
    last = next === 0 ? last : next;
  }
}

function unescape(rbsp: Buffer): Buffer {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Buffer.from(out);
}

class BitReader {
  private position = 0;
  private readonly data: Buffer;

  // Not a parameter property: the worker runs on Node's strip-only TypeScript,
  // which refuses that syntax, and the first render job found out in production.
  constructor(data: Buffer) {
    this.data = data;
  }

  u(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      const byte = this.data[this.position >> 3];
      if (byte === undefined) throw new Error('SPS ended early');
      value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
      this.position += 1;
    }
    return value >>> 0;
  }

  /** Unsigned Exp-Golomb. */
  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) {
      zeros += 1;
      if (zeros > 31) throw new Error('SPS Exp-Golomb code too long');
    }
    return zeros === 0 ? 0 : ((1 << zeros) - 1 + this.u(zeros)) >>> 0;
  }

  /** Signed Exp-Golomb. */
  se(): number {
    const code = this.ue();
    return code % 2 === 0 ? -(code / 2) : (code + 1) / 2;
  }
}
