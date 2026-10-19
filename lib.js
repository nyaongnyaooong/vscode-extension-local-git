// Pure helpers (no vscode import) so they can be tested with `node --test`.
const cp = require('child_process');

const LOG_FORMAT = '--format=%x1e%H%x1f%an%x1f%at%x1f%s';

// Runs local git only. execFile (no shell) so paths/refs are never interpreted by a shell.
function git(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const p = cp.execFile('git', args, {
      cwd,
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout));
    p.stdin.on('error', () => {}); // git may exit before reading stdin
    p.stdin.end(input);
  });
}

const isUncommitted = sha => /^0{40}$/.test(sha);
const short = ref => ref.replace(/^([0-9a-f]{7})[0-9a-f]+/, '$1');

// `git blame --porcelain` -> array indexed by 0-based line, entries shared per commit.
function parseBlame(out) {
  const commits = new Map();
  const lines = [];
  let cur;
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) continue; // source line content
    const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (m) {
      cur = commits.get(m[1]) || { sha: m[1] };
      commits.set(m[1], cur);
      lines[+m[2] - 1] = cur;
      continue;
    }
    const i = l.indexOf(' ');
    if (!cur || i < 0) continue;
    const k = l.slice(0, i), v = l.slice(i + 1);
    if (k === 'author') cur.author = v;
    else if (k === 'author-mail') cur.email = v.replace(/[<>]/g, '');
    else if (k === 'author-time') cur.date = new Date(+v * 1000);
    else if (k === 'summary') cur.summary = v;
    else if (k === 'filename') cur.file = v;
    else if (k === 'previous') { cur.prevSha = v.slice(0, 40); cur.prevFile = v.slice(41); }
  }
  return lines;
}

// `--name-status` lines: "M\tpath" or "R100\told\tnew".
function parseNameStatus(text) {
  return text.split('\n').filter(l => l.includes('\t')).map(l => {
    const p = l.split('\t');
    return { status: p[0][0], file: p[p.length - 1], prevFile: p.length > 2 ? p[1] : p[p.length - 1] };
  });
}

// Output of `git log ${LOG_FORMAT} [--name-status]`. `currentFile` fills entries without
// a name-status line (merges, -L) by following renames backwards from the newest entry.
function parseLog(out, currentFile) {
  let path = currentFile;
  return out.split('\x1e').filter(r => r.trim()).map(r => {
    const [head, ...rest] = r.split('\n');
    const [sha, author, at, summary] = head.split('\x1f');
    const ns = parseNameStatus(rest.join('\n'))[0];
    const e = { sha, author, date: new Date(+at * 1000), summary, file: ns ? ns.file : path, prevFile: ns ? ns.prevFile : path };
    path = e.prevFile;
    return e;
  });
}

const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
function ago(date, locale = 'en', now = Date.now()) {
  const s = (now - date) / 1000;
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [u, n] of UNITS) if (s >= n) return fmt.format(-Math.floor(s / n), u);
  return fmt.format(0, 'second');
}

module.exports = { git, isUncommitted, short, parseBlame, parseNameStatus, parseLog, ago, LOG_FORMAT };
