import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { SchematicRasterizerHandle } from '@/components/SchematicRasterizer';

export interface PickedSchematicFile {
  uri: string;
  name: string;
  mimeType: string;
}

const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
  'image/svg+xml',
];

const UNSUPPORTED_EXTENSIONS = ['dxf', 'dwg'];

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() || '';
}

function guessMimeTypeFromName(name: string): string {
  switch (extensionOf(name)) {
    case 'pdf':
      return 'application/pdf';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'heic':
      return 'image/heic';
    case 'heif':
      return 'image/heif';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export class UnsupportedFileError extends Error {
  fileName: string;
  constructor(fileName: string) {
    super(`Unsupported file type: ${fileName}`);
    this.fileName = fileName;
  }
}

export async function pickSchematicFiles(): Promise<PickedSchematicFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [...ACCEPTED_MIME_TYPES, '*/*'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets) return [];

  const files = result.assets.map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType || guessMimeTypeFromName(asset.name),
  }));

  const unsupported = files.find((f) => UNSUPPORTED_EXTENSIONS.includes(extensionOf(f.name)));
  if (unsupported) {
    throw new UnsupportedFileError(unsupported.name);
  }

  return files.filter((f) => ACCEPTED_MIME_TYPES.includes(f.mimeType));
}

async function writeBase64ToTempFile(base64: string, ext: string): Promise<string> {
  const path = `${FileSystem.cacheDirectory}wiretrace_upload_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  return path;
}

export async function convertFilesToImageUris(
  files: PickedSchematicFile[],
  rasterizer: SchematicRasterizerHandle
): Promise<string[]> {
  const imageUris: string[] = [];

  for (const file of files) {
    if (file.mimeType === 'application/pdf') {
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const pages = await rasterizer.rasterizePdf(base64);
      for (const page of pages) {
        imageUris.push(await writeBase64ToTempFile(page, 'jpg'));
      }
    } else if (file.mimeType === 'image/svg+xml') {
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
      const page = await rasterizer.rasterizeSvg(base64);
      imageUris.push(await writeBase64ToTempFile(page, 'jpg'));
    } else {
      imageUris.push(file.uri);
    }
  }

  return imageUris;
}
