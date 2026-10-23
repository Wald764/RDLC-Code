# RDLC Code — branding assets

Production assets live in [`apps/vscode-extension/media/`](../../apps/vscode-extension/media/).
All ten PNG/SVG files are included in the VSIX, including reserved variants.

## Files

- `media/rdlc-logo.png`: **256×256 PNG**, configured as the extension manifest's
  `icon` for Marketplace and the Extensions view. The gallery banner uses `#17365A`
  with the `dark` text theme.
- `media/rdlc-logo-128.png`, `rdlc-logo-512.png`, `rdlc-logo-64.png`,
  `rdlc-logo-32.png`: reserved raster variants, packaged for later UI use.
- `media/rdlc-activity.svg`: **24×24 monochrome SVG**, reserved for a future
  `contributes.viewsContainers.activitybar` entry. Register it when an actual
  sidebar view is implemented; the branding update does not add an empty view.
- `media/rdlc-file-light.svg`, `rdlc-file-dark.svg`: themed designer-tab icons,
  configured through `WebviewPanel.iconPath` in `src/editor-provider.ts`.
- `media/rdlc-file-light.png`, `rdlc-file-dark.png`: reserved **64×64 PNG**
  rasterizations of the file glyph.
- `manifest-example.json`: reference fragments with paths relative to the
  extension root, including the future Activity Bar contribution. These are not
  an additional extension manifest.

## Notes about file icons

Explorer file icons are controlled by the active **File Icon Theme**. The
`contributes.languages[].icon` light/dark pair is a fallback when the theme does
not define an icon for that language; it is not an unconditional theme override.
RDLC Code does not register a new language just to brand files, so the existing
XML editing behavior is retained. The designer tab icon is independent of this.

The monochrome Activity Bar SVG is intentionally redrawn (not an automatic SVG conversion of the detailed source) so its shape remains legible at 24px. The main Marketplace PNG comes from the original generated illustration with transparent padding normalized.

## Packaging and verification

`.vscodeignore` includes the PNG/SVG assets under `media/`. The VSIX verifier
requires every production media file and compares its bytes with the source,
including currently unused variants. No remote image access is needed.

## Official references

- [Extension manifest: icon and gallery banner](https://code.visualstudio.com/api/references/extension-manifest)
- [Language icon fallback](https://code.visualstudio.com/api/references/contribution-points#contributes.languages)
- [View containers and Activity Bar icons](https://code.visualstudio.com/api/extension-guides/tree-view#view-container)
- [WebviewPanel API](https://code.visualstudio.com/api/references/vscode-api#WebviewPanel)
