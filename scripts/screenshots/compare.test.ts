import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { PNG } from 'pngjs';
import { compareScreenshots, marker } from './compare.mjs';

let directory: string;
let before: string;
let after: string;
let output: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fpm-compare-'));
  before = join(directory, 'before');
  after = join(directory, 'after');
  output = join(directory, 'report');
  await Promise.all([mkdir(before), mkdir(after)]);
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

async function png(folder: string, name: string, color = 255, width = 3) {
  const image = new PNG({ width, height: 3 });
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = color; image.data[i + 1] = color; image.data[i + 2] = color; image.data[i + 3] = 255;
  }
  await writeFile(join(folder, name), PNG.sync.write(image));
}

test('同じ画像はコメントの変更対象にしない', async () => {
  await png(before, 'same.png'); await png(after, 'same.png');
  const report = await compareScreenshots(before, after, output);
  expect(report.changes).toEqual([]);
  expect(report.attachments).toEqual([]);
});

test('変更ピクセルを数え、相対パスで before/after を並べる', async () => {
  await png(before, 'changed.png'); await png(after, 'changed.png', 0);
  const report = await compareScreenshots(before, after, output);
  expect(report.changes).toEqual([{ name: 'changed.png', status: 'changed', changedPixels: 9 }]);
  expect(report.attachments).toEqual(['before/changed.png', 'after/changed.png']);
  const markdown = await readFile(join(output, 'comment.md'), 'utf8');
  expect(markdown).toContain(marker);
  expect(markdown).toContain('| before | after |');
  expect(markdown).toContain('(./before/changed.png)');
  expect(markdown).toContain('(./after/changed.png)');
  expect(await readFile(join(output, 'after/changed.png'))).toEqual(await readFile(join(after, 'changed.png')));
});

test('追加画像は after のみ掲載する', async () => {
  await png(before, 'same.png'); await png(after, 'same.png'); await png(after, 'added.png');
  const report = await compareScreenshots(before, after, output);
  expect(report.changes).toEqual([{ name: 'added.png', status: 'added', changedPixels: null }]);
  expect(report.attachments).toEqual(['after/added.png']);
});

test('削除画像は before のみ掲載する', async () => {
  await png(before, 'same.png'); await png(after, 'same.png'); await png(before, 'removed.png');
  const report = await compareScreenshots(before, after, output);
  expect(report.changes).toEqual([{ name: 'removed.png', status: 'removed', changedPixels: null }]);
  expect(report.attachments).toEqual(['before/removed.png']);
});

test.each([null, 'missing'])('before がない初回でも比較結果を作る: %s', async value => {
  await png(after, 'added.png');
  const report = await compareScreenshots(value ? join(directory, value) : null, after, output);
  expect(report.hasBefore).toBe(false);
  expect(report.changes[0]?.status).toBe('added');
  expect(await readFile(join(output, 'comment.md'), 'utf8')).toContain('比較元の撮影結果がない');
});

test('画像サイズの変更を検出する', async () => {
  await png(before, 'resized.png'); await png(after, 'resized.png', 255, 4);
  expect((await compareScreenshots(before, after, output)).changes[0]?.status).toBe('changed');
});

test('撮影に失敗して after が空なら比較を成功扱いにしない', async () => {
  await png(before, 'removed.png');
  await expect(compareScreenshots(before, after, output)).rejects.toThrow('No after screenshots');
});
