import { randomBytes } from 'node:crypto';

export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * Rewrites the verified Angular build's index.html for a webview: strict CSP,
 * per-load nonce, packaged local resources only, no remote or inline fetch.
 */
export function renderWebviewHtml(options: {
  readonly index: string;
  readonly assetsBase: string;
  readonly nonce: string;
  readonly cspSource: string;
}): string {
  const { index, assetsBase, nonce, cspSource } = options;
  const csp = [
    "default-src 'none'",
    `img-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return index
    .replace(/<base[^>]*>/, '')
    .replaceAll('__CSP_NONCE__', nonce)
    .replace(/<script\b(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
    .replace(
      /(src|href)="(?!https?:|data:|#)([^"]*)"/g,
      (_match, attribute: string, file: string) =>
        `${attribute}="${assetsBase}/${file.replace(/^\.?\//, '')}"`,
    )
    .replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
}
