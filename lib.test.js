const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { git, parseBlame, parseLog, ago, isUncommitted, short, LOG_FORMAT } = require('./lib');

async function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locallens-'));
  const g = (...a) => git(dir, ['-c', 'user.name=Kim', '-c', 'user.email=kim@x', ...a]);
  await g('init', '-q');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'one\ntwo\n');
  await g('add', '.'); await g('commit', '-qm', 'first');
  await g('mv', 'src/a.txt', 'src/b.txt');
  fs.writeFileSync(path.join(dir, 'src/b.txt'), 'one\ntwo\nthree\n');
  await g('add', '.'); await g('commit', '-qm', 'rename and add');
  return dir;
}

test('blame with dirty contents marks uncommitted lines', async () => {
  const dir = await repo();
  const out = await git(path.join(dir, 'src'), ['blame', '--porcelain', '--contents', '-', '--', 'b.txt'], 'one\nTWO\nthree\n');
  const lines = parseBlame(out);
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].summary, 'first');
  assert.strictEqual(lines[0].author, 'Kim');
  assert.strictEqual(lines[0].email, 'kim@x');
  assert.ok(isUncommitted(lines[1].sha));
  assert.strictEqual(lines[2].summary, 'rename and add');
  assert.strictEqual(lines[2].file, 'src/b.txt');
  assert.strictEqual(lines[2].prevFile, 'src/a.txt');
});

test('file history follows renames', async () => {
  const dir = await repo();
  const out = await git(path.join(dir, 'src'), ['log', '--follow', '-M', '--name-status', LOG_FORMAT, '--', 'b.txt']);
  const log = parseLog(out, 'src/b.txt');
  assert.deepStrictEqual(log.map(e => [e.summary, e.file, e.prevFile]), [
    ['rename and add', 'src/b.txt', 'src/a.txt'],
    ['first', 'src/a.txt', 'src/a.txt'],
  ]);
});

test('helpers', () => {
  assert.strictEqual(ago(new Date(0), 'en', 3 * 86400 * 1000), '3 days ago');
  assert.strictEqual(short('0123456789abcdef^'), '0123456^');
});
