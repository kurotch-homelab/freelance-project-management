import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export const marker = '<!-- fpm-screenshots -->';

async function files(directory, optional = false) {
  if (!directory) return [];
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(entry.name))
      .map(entry => entry.name).sort();
  } catch (error) {
    if (optional && error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function compareScreenshots(before, after, output) {
  const beforeFiles = new Set(await files(before, true));
  const afterFiles = new Set(await files(after));
  if (afterFiles.size === 0) throw new Error('No after screenshots found');
  const changes = [];
  const attachments = [];
  const lines = [marker, '## 画面スクリーンショット', '',
    ...(beforeFiles.size === 0 ? ['比較元の撮影結果がないため、現在の画面を掲載します。', ''] : [])];
  await mkdir(output, { recursive: true });
  for (const name of [...new Set([...beforeFiles, ...afterFiles])].sort()) {
    const hasBefore = beforeFiles.has(name);
    const hasAfter = afterFiles.has(name);
    let changedPixels = null;
    let status = !hasBefore ? 'added' : !hasAfter ? 'removed' : 'changed';
    if (hasBefore && hasAfter) {
      const a = PNG.sync.read(await readFile(join(before, name)));
      const b = PNG.sync.read(await readFile(join(after, name)));
      if (a.width === b.width && a.height === b.height) {
        changedPixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
        if (changedPixels === 0) continue;
      }
    }
    changes.push({ name, status, changedPixels });
    const label = { changed: '変更', added: '追加', removed: '削除' }[status];
    lines.push(`### ${label}: ${name}`, '', '| before | after |', '| --- | --- |');
    const cells = [];
    for (const [side, source, present] of [['before', before, hasBefore], ['after', after, hasAfter]]) {
      if (!present) { cells.push('—'); continue; }
      const relative = `${side}/${name}`;
      await mkdir(join(output, side), { recursive: true });
      await copyFile(join(source, name), join(output, relative));
      attachments.push(relative);
      cells.push(`![${side}: ${name}](./${relative})`);
    }
    lines.push(`| ${cells.join(' | ')} |`, '');
  }
  if (changes.length === 0) lines.push('画面の変更はありません。', '');
  const result = { changes, attachments, hasBefore: beforeFiles.size > 0 };
  await writeFile(join(output, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(join(output, 'comment.md'), lines.join('\n'));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [before, after, output] = process.argv.slice(2);
  if (!before || !after || !output) throw new Error('Usage: node scripts/screenshots/compare.mjs <before|-> <after> <output>');
  const result = await compareScreenshots(before === '-' ? null : resolve(before), resolve(after), resolve(output));
  console.log(JSON.stringify(result.changes, null, 2));
}
