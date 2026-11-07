import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { marker } from './compare.mjs';

const directory = resolve(process.argv[2] ?? 'screenshots-out/report');
const repository = process.env.GITHUB_REPOSITORY;
const pr = process.env.PR_NUMBER;
if (!repository || !/^\d+$/.test(pr ?? '')) throw new Error('GITHUB_REPOSITORY and PR_NUMBER are required');
const report = JSON.parse(await readFile(resolve(directory, 'report.json'), 'utf8'));
const gh = args => execFileSync('gh', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// The comment is posted by the attachment token's user, or by github-actions[bot]
// when only GITHUB_TOKEN is available. Remove earlier comments from either.
let viewer = 'github-actions[bot]';
try { viewer = gh(['api', 'user', '--jq', '.login']).trim() || viewer; } catch { /* installation token */ }
const authors = new Set(['github-actions[bot]', viewer]);
const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repository}/issues/${pr}/comments`]));
for (const comment of pages.flat()) {
  if (authors.has(comment.user?.login) && comment.body?.includes(marker)) {
    gh(['api', '--method', 'DELETE', `repos/${repository}/issues/comments/${comment.id}`]);
  }
}
if (report.changes.length > 0) {
  try {
    gh(['pr', 'comment', pr, '--repo', repository, '--body-file', 'comment.md',
      ...report.attachments.flatMap(file => ['--attach', `./${file}`])]);
  } catch (error) {
    // Attachments need a user token (SCREENSHOT_COMMENT_TOKEN); GITHUB_TOKEN is
    // rejected. Fall back to the artifact link.
    console.warn(String(error.stderr || error.message).trim());
    const url = process.env.ARTIFACT_URL || `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const body = [marker, '## 画面スクリーンショット', '',
      '画像をコメントに添付できなかったため、artifact に保存しました。', '',
      `[画像と比較結果をダウンロード](${url})`, '',
      ...report.changes.map(change => `- ${change.status}: ${change.name}`), ''].join('\n');
    await writeFile(resolve(directory, 'fallback.md'), body);
    gh(['pr', 'comment', pr, '--repo', repository, '--body-file', 'fallback.md']);
    console.warn('Image attachment unavailable; posted the artifact link');
  }
}
