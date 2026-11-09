import {
  imageAssetsBatchBudget,
  imageAssetsPerMessage,
  validateMessage,
  type ImageAsset,
  type ImageAssetsMessage,
} from '@rdlc/report-model/protocol';
import type {
  EmbeddedImageDefinition,
  ReportProjection,
} from '@rdlc/report-model/report';
import { child } from '@rdlc/xml-parser/names';

/**
 * Tracks which picture keys one webview already holds. A cache belongs to exactly one
 * webview and is cleared whenever that webview may have lost its state (it reloaded or
 * its panel was disposed), so every key is re-sent after a reload and never otherwise.
 *
 * Payloads are only ever returned to the caller for transport: nothing here logs,
 * formats or stores them, and only keys are remembered.
 */
export class ImageAssetCache {
  private readonly sent = new Set<string>();

  /**
   * Assets of displayable PNG/JPEG definitions this webview has not yet received, each
   * key at most once, as exactly the bytes the projection validated. Keys stay unsent
   * until `markSent`, so an asset that was never emitted is offered again.
   */
  take(definitions: readonly EmbeddedImageDefinition[]): ImageAsset[] {
    const assets: ImageAsset[] = [];
    const offered = new Set<string>();
    for (const definition of definitions) {
      const { hash } = definition;
      if (
        !definition.displayable ||
        hash === null ||
        (definition.format !== 'png' && definition.format !== 'jpeg') ||
        this.sent.has(hash) ||
        offered.has(hash)
      )
        continue;
      // The projection already proved this text is valid base64 of exactly `byteSize`
      // bytes, so the native decoder (whitespace skipped) is enough: the bytes go to the
      // webview as they are, with no re-encoding. The transport sends the whole backing
      // ArrayBuffer of a typed array, so a view onto a larger buffer (the shared Buffer
      // pool, which holds unrelated data) is copied into one sized to the picture.
      const decoded = Buffer.from(
        child(definition.node, 'ImageData')?.text ?? '',
        'base64',
      );
      if (decoded.length !== definition.byteSize) continue;
      offered.add(hash);
      assets.push({
        key: hash,
        mime: definition.format === 'png' ? 'image/png' : 'image/jpeg',
        data:
          decoded.byteOffset === 0 &&
          decoded.buffer.byteLength === decoded.length
            ? new Uint8Array(decoded.buffer, 0, decoded.length)
            : new Uint8Array(decoded),
      });
    }
    return assets;
  }

  /** Record that these assets were emitted to the webview. */
  markSent(assets: readonly ImageAsset[]): void {
    for (const asset of assets) this.sent.add(asset.key);
  }

  clear(): void {
    this.sent.clear();
  }
}

/**
 * Groups assets so each message stays under the transport byte budget and the
 * per-message asset count; order is kept.
 */
export function batchImageAssets(
  assets: readonly ImageAsset[],
): ImageAsset[][] {
  const batches: ImageAsset[][] = [];
  let size = 0;
  for (const asset of assets) {
    const last = batches[batches.length - 1];
    if (
      last &&
      last.length < imageAssetsPerMessage &&
      size + asset.data.byteLength <= imageAssetsBatchBudget
    ) {
      last.push(asset);
      size += asset.data.byteLength;
    } else {
      batches.push([asset]);
      size = asset.data.byteLength;
    }
  }
  return batches;
}

/**
 * Emits the `imageAssets` messages for the pictures this webview still lacks. Keys are
 * marked sent only after their message validated and was emitted; a batch that fails
 * validation is dropped and its keys stay unsent, so the next call offers them again.
 * A report that is not editable renders every image as a placeholder: nothing is sent.
 */
export function sendImageAssets(
  cache: ImageAssetCache,
  projection: Pick<ReportProjection, 'status' | 'embeddedImages'>,
  emit: (message: ImageAssetsMessage) => void,
  accept: (message: ImageAssetsMessage) => boolean = (message) =>
    validateMessage(message) !== null,
): void {
  if (projection.status !== 'editable') return;
  for (const assets of batchImageAssets(
    cache.take(projection.embeddedImages),
  )) {
    const message: ImageAssetsMessage = {
      protocol: 2,
      kind: 'imageAssets',
      assets,
    };
    if (!accept(message)) continue;
    emit(message);
    cache.markSent(assets);
  }
}
