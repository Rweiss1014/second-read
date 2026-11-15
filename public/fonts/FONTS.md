# Fonts

Three faces, all under the SIL Open Font License 1.1. Each license is in this folder, beside its files.
Only the Latin subset is here. Nothing else from the packages was copied.

| File | Face | Package and version | Where it comes from | License |
|---|---|---|---|---|
| `newsreader-latin-wght-normal.woff2` (58,084 bytes) | Newsreader, variable weight 200 to 800, upright | `@fontsource-variable/newsreader` 5.3.0 | Production Type, through Google Fonts and Fontsource | OFL 1.1, `Newsreader-LICENSE.txt` |
| `source-sans-3-latin-wght-normal.woff2` (28,872 bytes) | Source Sans 3, variable weight 200 to 900, upright | `@fontsource-variable/source-sans-3` 5.3.1 | Adobe, through Google Fonts and Fontsource | OFL 1.1, `SourceSans3-LICENSE.txt` |
| `source-code-pro-latin-400-normal.woff2` (11,656 bytes) | Source Code Pro, regular | `@fontsource/source-code-pro` 5.3.1 | Adobe, through Google Fonts and Fontsource | OFL 1.1, `SourceCodePro-LICENSE.txt` |

## How they were fetched (Nov 15, 2026)

- All three packages are published by the Fontsource project. Each package's `repository` field points to `github.com/fontsource/font-files`, and the npm maintainers are the same two Fontsource maintainers on all three.
- `npm pack --ignore-scripts` in a scratch folder outside this repo. No install, so no package script ran. None of the three `package.json` files has a `scripts` field.
- The unpacked folder was scanned with Windows Defender (`MpCmdRun -Scan -ScanType 3`): no threats.
- Then only the files above, and each package's `LICENSE`, were copied here.

## Why these cuts

- Newsreader's optical-size axis (`opsz`) would add about 74 KB. The weight-only file keeps the page's fonts under the 120 KB budget at load (58 KB + 29 KB = 87 KB).
- Source Code Pro is only used in the technical view. A browser fetches it only when that view is open.
- No italics: the page never uses them.
