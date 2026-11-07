// Encodes WebP in a worker with the jSquash (libwebp) WebAssembly encoder.
// Used only when the browser cannot make WebP from a canvas (Safari).
// Message in: { id, data: Uint8ClampedArray RGBA, width, height, quality (0–100) }
// Message out: { id, buffer: ArrayBuffer } or { id, error }
import createModule from './webp_enc.js';

// libwebp settings (struct WebPConfig), as in jSquash's defaults; only quality changes.
const DEFAULTS = {
  quality: 80, target_size: 0, target_PSNR: 0, method: 4, sns_strength: 50, filter_strength: 60,
  filter_sharpness: 0, filter_type: 1, partitions: 0, segments: 4, pass: 1, show_compressed: 0,
  preprocessing: 0, autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1,
  alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0, emulate_jpeg_size: 0, thread_level: 0,
  low_memory: 0, near_lossless: 100, use_delta_palette: 0, use_sharp_yuv: 0,
};

let ready = null;

self.onmessage = async (e) => {
  const { id, data, width, height, quality } = e.data;
  try {
    ready ||= createModule({ noInitialRun: true });
    const mod = await ready;
    const out = mod.encode(data, width, height, { ...DEFAULTS, quality: Math.round(quality) });
    if (!out) throw new Error('codifica non riuscita');
    const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
    self.postMessage({ id, buffer }, [buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
