/**
 * A photo as it's kept (decision 7): at most 2048 px on its longest side, as a JPEG. Drawing it anew
 * also leaves behind what the camera wrote into the file (where it was taken, and when).
 */

export const MAX_SIDE = 2048;

export interface Shrunk {
  blob: Blob;
  width: number;
  height: number;
}

export async function shrinkPhoto(file: Blob): Promise<Shrunk | null> {
  let bitmap: ImageBitmap;
  try {
    // (turned the way the camera held it)
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? { blob, width, height } : null;
}
