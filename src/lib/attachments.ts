/**
 * Helpers for image attachments sent through Petal's chat.
 *
 * We keep attachments small + bounded so a careless drop of a 30 MB photo
 * doesn't blow up the SSE request body (or the AI gateway's per-image limit).
 *
 *   - Max 4 images per message
 *   - Max ~3 MB each after re-encoding
 *   - Always re-encoded to JPEG/WebP and capped at 1600px on the long side
 */

export type ChatAttachment = {
  /** "image/jpeg", "image/png", … — what we actually send to the model. */
  mimeType: string;
  /** data:<mime>;base64,<…> — directly usable as <img src> AND as the AI image_url. */
  dataUrl: string;
  /** Original filename, for display in chat. */
  name: string;
};

export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
const MAX_DIMENSION = 1600;
const TARGET_QUALITY = 0.85;

/** Returns true for image MIME types the AI gateway will accept. */
export function isAcceptedImage(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(file.type);
}

/** Read a file into an HTMLImageElement so we can re-encode it on a canvas. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Re-encode an image to a bounded JPEG data URL. Keeps PNG only when the
 * source is small enough that JPEG would lose transparency for nothing.
 */
export async function encodeAttachment(file: File): Promise<ChatAttachment> {
  if (!isAcceptedImage(file)) {
    throw new Error(`Unsupported file type: ${file.type || file.name}`);
  }

  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, w, h);

  // GIFs lose animation; PNGs lose transparency — that's fine for a design ref.
  const dataUrl = canvas.toDataURL("image/jpeg", TARGET_QUALITY);
  return {
    mimeType: "image/jpeg",
    dataUrl,
    name: file.name,
  };
}

/** Encode a list of files, dropping any that fail and capping the count. */
export async function encodeAttachments(files: File[]): Promise<ChatAttachment[]> {
  const slice = files.slice(0, MAX_ATTACHMENTS_PER_MESSAGE);
  const out: ChatAttachment[] = [];
  for (const f of slice) {
    try {
      out.push(await encodeAttachment(f));
    } catch (e) {
      console.warn("Skipping attachment:", e);
    }
  }
  return out;
}
