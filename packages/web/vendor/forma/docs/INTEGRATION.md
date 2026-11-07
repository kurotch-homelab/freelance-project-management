# Forma integration

## Packages and modes

| Project | Mode | GitHub Packages dependency |
| --- | --- | --- |
| React / Next.js | `react` | `@kurotch-homelab/forma-react` |
| Vue / Svelte / Astro / HTML | `css` | `@kurotch-homelab/forma-styles` |
| Native/design tooling | `tokens` | `@kurotch-homelab/forma-tokens` |

Use the exact version in `bundle.json`. There are no packaged implementations in this skill.
Fonts, examples and design references remain local; a source checkout is unnecessary.

## Registry and authentication

GitHub's npm registry requires authentication even for public packages.
Use a personal access token (classic) with `read:packages` for installation.
Do not print tokens, copy them into the skill, or commit them in application files.

For npm, pnpm, and Bun, configure the following in the application's workspace-root `.npmrc`.
Read any existing file first. Preserve unrelated entries; do not replace another registry mapping for
this scope without checking the other `@kurotch-homelab` dependencies used by the app.

```ini
@kurotch-homelab:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Provide `NODE_AUTH_TOKEN` through the user's environment or CI secrets. The literal environment-variable
reference above is safe to store; the actual token must stay outside source control. Existing npm login
credentials may be used instead. Do not add an unresolved token placeholder over working credentials.
Yarn Classic also reads `.npmrc`. For Yarn Berry use the existing `.yarnrc.yml` with:

```yaml
npmScopes:
  kurotch-homelab:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAlwaysAuth: true
    npmAuthToken: "${NODE_AUTH_TOKEN}"
```

Merge this into the existing configuration. For Yarn PnP, run the sync/verify script through `yarn node`
so its package resolution hook is active. For pnpm, keep the workspace's lockfile and node linker settings.
GitHub Actions can use `GITHUB_TOKEN` with `packages: read` when its repository has package access;
otherwise use an appropriately scoped secret provided by the user.

Official reference: [GitHub npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Prepare, install, sync

The Node.js 22+ installer uses built-ins only. It never runs package managers or changes credentials.

```sh
node "<SKILL_DIR>/scripts/forma.mjs" inspect --target "<APP_DIR>"
node "<SKILL_DIR>/scripts/forma.mjs" install --target "<APP_DIR>" --mode react --assets-dir public/forma --dry-run
node "<SKILL_DIR>/scripts/forma.mjs" install --target "<APP_DIR>" --mode react --assets-dir public/forma
# In the workspace root: npm install / pnpm install / yarn install / bun install
node "<SKILL_DIR>/scripts/forma.mjs" sync --target "<APP_DIR>"
node "<SKILL_DIR>/scripts/forma.mjs" verify --target "<APP_DIR>"
```

- `--target`: actual application package, including within a monorepo.
- `--mode auto|react|css|tokens`: auto chooses React only when declared by the app.
- `--assets-dir`: relative asset directory, e.g. `public/forma`, `static/forma`, `assets/forma`.
- `--fonts bundled|system`: original licensed local fonts by default; tokens copies no fonts.
- `--manager npm|pnpm|yarn|bun`: override ambiguous package-manager detection, never invokes it.
- `--dry-run`: read-only preparation or sync plan.

`install` writes a pinned registry dependency, fonts/docs/licenses and `vendor/forma/installation.json`.
CSS/tokens projects without package.json receive a private manifest containing only the selected Forma dependency.
It preserves unrelated package fields, lockfiles and source code. Run the existing package manager at its
workspace root and inspect the lockfile's version, GitHub registry URL and integrity.

`sync` requires the expected installed package version. It copies `forma.css` for CSS mode, or `tokens.css`
and `tokens.json` for tokens mode, plus the package license. React loads its CSS/JS from the installed package.
`verify` checks managed file hashes, dependency specs and installed package versions; it does not certify the UI.

Repeated commands are idempotent. Modified managed files and conflicting dependencies stop before writes.
The older managed file: dependency can migrate through `install`; old tarballs are left untouched but are no
longer referenced. Review/remove unused files as a separate application change.

Commit the package manifest, lockfile, local assets and `vendor/forma` docs/record. Keep MIT licenses and the
fonts' `OFL.txt`/`SOURCE.txt` with redistributed files. Do not commit node_modules or authentication values.

## React / Vite

1. Run the installer in the React app, then its existing package manager install command (`npm install`, `pnpm install`, `yarn install` or `bun install`). Do not mix managers or unpin React.
2. Import `@kurotch-homelab/forma-react/styles.css` once at the application entry. Import application overrides after it.
3. Wrap the app or the intended region with `FormaProvider`. Preserve existing providers, routes, StrictMode and rendering setup.
4. Serve the copied fonts directory. With `public/forma`, load `/forma/fonts/fonts.css` in the document head. For a non-root Vite base use `%BASE_URL%forma/fonts/fonts.css` in index.html, or import the local font CSS through the bundler so its relative URLs are processed.

```tsx
import { FormaProvider } from '@kurotch-homelab/forma-react';
import '@kurotch-homelab/forma-react/styles.css';
import './app.css';

// Keep existing providers and render setup; replace only the relevant boundary.
<FormaProvider locale="ja" theme="system" density="comfortable" motion="system">
  <App />
</FormaProvider>;
```

The complete `assets/examples/react/FormaExample.tsx` is a starting screen, not a replacement for a user's existing app. Its named props and callbacks are real public APIs. REACT.md covers all 35 components.

## Next.js

Use a small client boundary rather than turning every layout or page into a client component. Copy/adapt `assets/examples/react/FormaBoundary.tsx` into the app's components directory. It starts with `'use client'` and accepts children. In the root layout, keep the existing html/body/metadata structure, import the Forma CSS, and wrap the relevant children in that boundary. Put `public/forma/fonts/fonts.css` in a head stylesheet link; account for any configured basePath.

```tsx
// app/layout.tsx: retain the project's existing metadata and providers.
import '@kurotch-homelab/forma-react/styles.css';
import { FormaBoundary } from './components/FormaBoundary';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="stylesheet" href="/forma/fonts/fonts.css" />
      </head>
      <body>
        <FormaBoundary>{children}</FormaBoundary>
      </body>
    </html>
  );
}
```

Interactive controls and state callbacks live inside client components. Do not pass ordinary functions from server components across the client boundary. Provider system theme is light during SSR and resolves the OS preference after hydration. For deterministic initial appearance, pass an explicit light/dark choice derived from the application's own persisted preference. Do not add blanket hydration-warning suppression.

## Vue, Svelte, Astro and server templates

Use CSS mode. Load the copied CSS globally once; do not place Forma's stylesheet in a component's scoped-style block. Wrap the intended UI in `<div class="forma" data-theme="light" data-density="comfortable">` and preserve framework bindings and event handlers. Native input/select/details/dialog elements work with the existing framework. CSS does not implement tab/menu keyboard handling, table state, notifications or validation; adapt those behaviors in the host app and test them.

For Vue/Nuxt use the project's current global style or document head mechanism. For Svelte/SvelteKit use its existing root layout/head mechanism and choose the served `static/forma` directory if configured. For Astro, place the link in the shared layout; React mode requires the project already using a React integration and an intentional client island, never installing a renderer implicitly.

Read HTML.md for all 35 structural examples and behavioral obligations. Keep IDs unique when reusing a pattern. Replace sample destinations and application-specific content; never copy demo-only hooks expecting an external catalog script.

## Plain HTML

Use `--mode css --assets-dir assets/forma` next to an existing HTML file. Copy/adapt the supplied HTML example and point its links at those local files. No npm package or runtime library is necessary.

```html
<link rel="stylesheet" href="./assets/forma/fonts/fonts.css" />
<link rel="stylesheet" href="./assets/forma/forma.css" />
<main class="forma" data-theme="light" data-density="comfortable">
  <label class="f-field">案件名<input class="f-input" name="project" required /></label>
  <button class="f-button f-button--primary" type="submit">保存</button>
</main>
```

Theme switching and persistence belong to the application. `assets/examples/html/theme.mjs` shows OS theme and reduced-motion handling without global libraries. The sample form in `index.html` includes local validation and a native dialog with focus restoration.

## Tokens and customization

Tokens mode copies `tokens.css` and `tokens.json` only (plus local reference documentation). JSON includes primitive, semantic light/dark, component, typography, spacing, radius, and motion values. References such as `{primitive.gray900}` and `{semantic.brand}` need resolving if converted to platform-native constants; do not treat them as literal colors.

Override semantic variables after Forma's CSS and within the same intended boundary. Preserve pairs such as brand/on-brand, surface/text and danger/danger-subtle. Check both themes and contrast after changes. Do not edit managed assets in place; put application overrides in the project's own stylesheet so future package updates can be checked.

## Fonts and network access

The default copies original IBM Plex Sans JP Regular/Medium/SemiBold TTF files, local @font-face declarations, source provenance and SIL OFL 1.1. Keep OFL.txt with redistributed fonts. The source is pinned in fonts/SOURCE.txt; it is not fetched during installation. TTF files total approximately 7 MB and load on demand with font-display: swap. A build pipeline may create WOFF2/subsets while preserving licensing; the unmodified bundle requires no font tooling. System mode is available when font payload is unsuitable, but this deliberately changes the reference typography.

Initial Forma package installation requires access to GitHub Packages and authentication. A populated package-manager cache may support later offline installs. The rendered application and local fonts do not require GitHub or Google requests at runtime.

## Verification and completion

- `self-check` verifies local guidance/assets and pinned registry metadata; `verify` checks managed files and installed package versions.
- Run the target's typecheck/build and relevant tests. Inspect one real screen, not just an import statement.
- Check labels, inline error association, disabled/loading states, keyboard menus/tabs, dialog focus restoration and reduced motion.
- Inspect 390 / 768 / 1440px and light/dark; if the product has multiple languages, check them too. Keep table overflow inside the table.
- Test a production build or equivalent served output so font and CSS URLs work outside the development root.

The skill pins package versions. Update through a reviewed manifest and lockfile change; sync copied CSS/tokens after installing a new version. Checksum verification does not replace package-manager integrity checks.

Official implementation references: [Vite assets and base paths](https://vite.dev/guide/assets), [Next.js global CSS](https://nextjs.org/docs/app/getting-started/css).
