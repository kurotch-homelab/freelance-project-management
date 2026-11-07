# Third-party notices

Forma's original code, design guidance, examples, CSS, and design tokens are
licensed under the MIT License in `LICENSE`. Third-party files retain their
own licenses.

## IBM Plex Sans JP

- Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".
- License: SIL Open Font License 1.1.
- Files: `IBMPlexSansJP-Regular.ttf`, `IBMPlexSansJP-Medium.ttf`, and
  `IBMPlexSansJP-SemiBold.ttf`.
- The complete license and copyright notice are in `OFL.txt` alongside the fonts.
- The original font source is recorded in `SOURCE.txt` alongside the fonts.
- Upstream: https://github.com/google/fonts/tree/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/ibmplexsansjp

The bundled font files are unmodified. In this repository they are stored in
`skills/forma-design-system/assets/fonts/`; in the portable skill they are in
`assets/fonts/`. The installer copies them into the selected asset directory's
`fonts/` folder with `OFL.txt` and `SOURCE.txt`. The fonts remain under OFL 1.1,
separate from Forma's MIT-licensed code and documents.

## Development and preview dependencies

React is a peer dependency of the optional adapter. The catalog preview and
development tools use dependencies declared in `package.json` and pinned in
`package-lock.json`. These dependencies retain their own copyright and license
notices. When redistributing a built preview, keep the generated JavaScript
license comments with it.

Fluent 2 and Material Design are design references linked in `GUIDELINES.md`;
their packages, logos, and brand assets are not included in Forma.
