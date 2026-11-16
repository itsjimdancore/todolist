// The cutout worker (see ./cutout.js): loads RMBG-1.4 once (downloaded the first time, then from the browser's
// cache) and turns each photo it's sent into a mask: one byte per pixel, 255 where the subject is, 0 for background.
// RMBG-1.4 isn't one of the library's built-in model types, so it's loaded as a "custom" model and the photo is
// prepared by hand, as its model card describes: 1024×1024, scaled to 0–1, minus 0.5.
import { AutoModel, ImageProcessor, RawImage, env } from '@huggingface/transformers';

env.allowLocalModels = false; // only from Hugging Face, never from this site's /models

let model = null;
let loading = null;
const processor = new ImageProcessor({
  do_normalize: true, do_pad: false, do_rescale: true, do_resize: true,
  image_mean: [0.5, 0.5, 0.5], image_std: [1, 1, 1], resample: 2, rescale_factor: 1 / 255,
  size: { width: 1024, height: 1024 },
});

function load(onProgress) {
  if (model) return Promise.resolve(model);
  if (loading) return loading;
  const files = new Map(); // file → { loaded, total }
  const progress_callback = (p) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
    let loaded = 0;
    let total = 0;
    files.forEach((f) => { loaded += f.loaded; total += f.total; });
    onProgress({ phase: 'download', loaded, total });
  };
  // the 8-bit model (model_quantized.onnx, 44 MB) on WebAssembly, which works on every phone; WebGPU wants the
  // larger 16/32-bit files and can fail part-way on some phones
  loading = AutoModel.from_pretrained('briaai/RMBG-1.4', { config: { model_type: 'custom' }, dtype: 'q8', device: 'wasm', progress_callback })
    .then((m) => { model = m; return m; })
    .catch((e) => { loading = null; throw e; });
  return loading;
}

self.onmessage = async (e) => {
  const { id, blob } = e.data;
  const post = (msg, transfer) => self.postMessage({ id, ...msg }, transfer || []);
  try {
    const m = await load((p) => post({ type: 'progress', ...p }));
    post({ type: 'progress', phase: 'cutting' });
    const image = await RawImage.fromBlob(blob);
    const { pixel_values } = await processor(image);
    const result = await m({ input: pixel_values });
    let out = result.output ?? Object.values(result)[0]; // [1, 1, 1024, 1024], 0–1
    out = out[0];
    // some exports leave it unsquashed: bring it into 0–1
    if (out.data.some((x) => x < -1e-5 || x > 1 + 1e-5)) out = out.sigmoid();
    const mask = await RawImage.fromTensor(out.mul(255).to('uint8')).resize(image.width, image.height);
    const bytes = new Uint8Array(mask.channels === 1 ? mask.data : (await mask.grayscale()).data);
    post({ type: 'done', mask: bytes, width: mask.width, height: mask.height }, [bytes.buffer]);
  } catch (err) {
    const detail = String(err?.stack || err?.message || err);
    post({ type: 'error', detail, message: /fetch|network|Failed to load/i.test(detail) ? "Couldn't download the cutout tool. Check your connection." : "The cutout didn't work on this photo." });
  }
};
