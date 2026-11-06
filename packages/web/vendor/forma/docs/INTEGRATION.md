# Forma integration

## Choose the smallest useful integration

| Project                                                         | Mode     | Integration                                                  |
| --------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| Existing React or Next.js web app                               | `react`  | Local React tarball + shared CSS, FormaProvider, local fonts |
| Vue, Nuxt, Svelte, Astro, server-rendered templates, plain HTML | `css`    | Standalone CSS, native elements, application-owned behavior  |
| Native app, design tooling, existing component library          | `tokens` | CSS/JSON design tokens; implement each platform's behavior   |

The source repository and the Forma npm registry are not needed. Everything specific to Forma is bundled in the skill. React itself and the host application's dependencies are provided by the project, its cache or registry.

## Installer commands

Use Node.js 22 or later. The installer has no npm dependencies, downloads, shell subprocesses or postinstall scripts.

```sh
node "<SKILL_DIR>/scripts/forma.mjs" inspect --target "<APP_DIR>"
node "<SKILL_DIR>/scripts/forma.mjs" install --target "<APP_DIR>" --mode react --assets-dir public/forma --dry-run
node "<SKILL_DIR>/scripts/forma.mjs" install --target "<APP_DIR>" --mode react --assets-dir public/forma
node "<SKILL_DIR>/scripts/forma.mjs" verify --target "<APP_DIR>"
```

Flags:

- `--target`: existing application directory; defaults to the current directory.
- `--mode auto|react|css|tokens`: auto chooses React only if React is declared in the target manifest; otherwise CSS.
- `--assets-dir`: relative asset destination inside the target. Default `public/forma`; set it explicitly to match the app.
- `--fonts bundled|system`: bundled is the default for web integrations. System mode writes a font-family override and copies no font files. Tokens mode does not copy fonts.
- `--manager npm|pnpm|yarn|bun`: override only the reported package manager when autodetection is ambiguous. No package manager is run by this script.
- `--dry-run`: validates and reports changes without creating or modifying files.

`install` writes `vendor/forma/installation.json`, versioned tarballs when needed, local reference docs and the chosen assets. In React mode it adds `@kurotch-homelab/forma-react` to dependencies as a portable `file:vendor/forma/...tgz` entry. It keeps unrelated package fields and never rewrites source files, lockfiles, scripts or providers. Re-running with the same inputs is idempotent. Edited managed files or a conflicting existing Forma dependency cause an error before any planned write. There is no force-delete/overwrite switch. Resolve changes deliberately or select a new unused asset directory.

`verify` checks installed checksums and the local dependency reference. It does **not** prove the stylesheet/provider is used or the app is accessible. Finish by building and checking the real screen.

For monorepos, target the actual app package (for example `apps/web`). Dependencies are relative to that package. Run the package manager at its workspace root, as identified by `inspect`, and use the workspace's established commands. Do not create another lockfile in a child package. If multiple package-manager signals conflict, inspect the workspace and pass `--manager` rather than guessing.

Commit `vendor/forma`, the copied asset directory, package.json and the updated lockfile. Do not commit node_modules. No installed path should contain the skill directory, the source repository or a developer's home directory.

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

Override semantic variables after Forma's CSS and within the same intended boundary. Preserve pairs such as brand/on-brand, surface/text and danger/danger-subtle. Check both themes and contrast after changes. Do not edit bundled assets in place; put application overrides in the project's own stylesheet so future bundle updates can be checked.

## Fonts and offline use

The default copies original IBM Plex Sans JP Regular/Medium/SemiBold TTF files, local @font-face declarations, source provenance and SIL OFL 1.1. Keep OFL.txt with redistributed fonts. The source is pinned in fonts/SOURCE.txt; it is not fetched during installation. TTF files total approximately 7 MB and load on demand with font-display: swap. A build pipeline may create WOFF2/subsets while preserving licensing; the unmodified bundle requires no font tooling. System mode is available when font payload is unsuitable, but this deliberately changes the reference typography.

Forma-specific installation works offline. A fresh React application still needs React, its renderer and its build tooling from the project's usual sources; the skill does not bundle third-party runtimes.

## Verification and completion

- `self-check` verifies the skill bundle; `verify` verifies the installed snapshot and local package reference.
- Run the target's typecheck/build and relevant tests. Inspect one real screen, not just an import statement.
- Check labels, inline error association, disabled/loading states, keyboard menus/tabs, dialog focus restoration and reduced motion.
- Inspect 390 / 768 / 1440px and light/dark; if the product has multiple languages, check them too. Keep table overflow inside the table.
- Test a production build or equivalent served output so font and CSS URLs work outside the development root.

The checked-in assets are a versioned snapshot, not a live connection to the authoring project. Updating the skill or app is a deliberate local-bundle update, not an instruction to fetch an unverified package from npm.

Official implementation references: [npm local paths](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#local-paths), [Vite assets and base paths](https://vite.dev/guide/assets), [Next.js global CSS](https://nextjs.org/docs/app/getting-started/css).
