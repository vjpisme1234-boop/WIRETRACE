import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Vision models cap their effective input resolution well below a modern
// phone camera's native output (often 3000-4000px on the long side) — a
// bigger upload doesn't improve OCR accuracy on wire/terminal labels past
// this point, it just costs more image tokens and takes longer to upload.
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

async function readOriginalAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

/**
 * Downscales a photo before sending it to a vision API and returns raw
 * base64 (no data-URI prefix), matching what FileSystem.readAsStringAsync
 * already returned everywhere this replaces. The source file/imageUri is
 * left untouched — that's still what gets displayed to the user, only the
 * copy sent to the AI is resized. Falls back to the original file's base64
 * (previous behavior) if sizing or manipulation fails for any reason, so a
 * platform quirk here can't break scanning.
 */
export async function prepareImageForAI(uri: string): Promise<string> {
  try {
    const { width, height } = await getImageSize(uri);
    if (Math.max(width, height) <= MAX_DIMENSION) {
      return readOriginalAsBase64(uri);
    }

    const context = ImageManipulator.manipulate(uri);
    if (width >= height) {
      context.resize({ width: MAX_DIMENSION });
    } else {
      context.resize({ height: MAX_DIMENSION });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true });
    if (!saved.base64) throw new Error('Resize did not return base64 data');

    console.log('[ImageResize] Resized for upload', {
      from: `${width}x${height}`,
      to: `${saved.width}x${saved.height}`,
    });
    return saved.base64;
  } catch (error) {
    console.error('[ImageResize] Failed to resize image — using original', error);
    return readOriginalAsBase64(uri);
  }
}
