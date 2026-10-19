// Local Lens: GitLens-style blame/history using only the local git CLI. No network calls.
const vscode = require('vscode');
const path = require('path');
const { git, isUncommitted, short, parseBlame, parseNameStatus, parseLog, ago, LOG_FORMAT } = require('./lib');

const SCHEME = 'localgit';
const cfg = () => vscode.workspace.getConfiguration('localLens');
const when = d => ago(d, vscode.env.language);
const who = c => isUncommitted(c.sha) ? 'You' : c.author;
const describe = c => isUncommitted(c.sha) ? 'You • Uncommitted changes' : `${c.author}, ${when(c.date)} • ${c.summary}`;
const esc = s => String(s).replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
const cmdLink = (cmd, arg) => `command:${cmd}?${encodeURIComponent(JSON.stringify([arg]))}`;

const prefixes = new Map(); // dir -> Promise<repo-relative prefix | null>
const blames = new Map();   // doc uri -> { version, promise }
const fileBlameOn = new Set();

function locate(uri) {
  if (!uri || uri.scheme !== 'file') return Promise.resolve(null);
  const cwd = path.dirname(uri.fsPath);
  if (!prefixes.has(cwd)) prefixes.set(cwd, git(cwd, ['rev-parse', '--show-prefix']).then(s => s.trim(), () => null));
  const name = path.basename(uri.fsPath);
  return prefixes.get(cwd).then(p => p === null ? null : { cwd, name, rel: p + name });
}

function blame(doc) {
  const key = doc.uri.toString();
  const hit = blames.get(key);
  if (hit && hit.version === doc.version) return hit.promise;
  // --contents - blames the editor buffer, so unsaved edits show as uncommitted
  const promise = locate(doc.uri).then(loc => loc && git(loc.cwd, ['blame', '--porcelain', '--contents', '-', '--', loc.name], doc.getText())
    .then(out => ({ loc, lines: parseBlame(out) }), () => null));
  blames.set(key, { version: doc.version, promise });
  return promise;
}

async function currentCommit() {
  const ed = vscode.window.activeTextEditor;
  const b = ed && await blame(ed.document);
  const c = b && b.lines[ed.selection.active.line];
  return c && { cwd: b.loc.cwd, rel: b.loc.rel, ...c };
}

// ---- revision content + diffs ----

const revUri = (cwd, ref, file) => vscode.Uri.from({ scheme: SCHEME, path: '/' + file, query: JSON.stringify({ cwd, ref }) });

const contentProvider = {
  provideTextDocumentContent(uri) {
    const { cwd, ref } = JSON.parse(uri.query);
    return git(cwd, ['show', `${ref}:${uri.path.slice(1)}`]).catch(() => ''); // missing side (add/delete/root) -> empty
  },
};

function diffCommit({ cwd, sha, file, prevSha, prevFile }) {
  if (isUncommitted(sha)) return diffWithHead();
  const left = prevSha || sha + '^';
  const name = path.posix.basename(file);
  return vscode.commands.executeCommand('vscode.diff', revUri(cwd, left, prevFile || file), revUri(cwd, sha, file),
    `${name} (${short(left)}) ↔ ${name} (${short(sha)})`);
}

async function diffWithHead(uri) {
  uri = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
  const loc = await locate(uri);
  if (!loc) return vscode.window.showWarningMessage('Local Lens: git 저장소의 파일이 아닙니다.');
  return vscode.commands.executeCommand('vscode.diff', revUri(loc.cwd, 'HEAD', loc.rel), uri, `${loc.name} (HEAD) ↔ ${loc.name}`);
}

// ---- pickers ----

function pickCommit(entries, title, onPick) {
  return vscode.window.showQuickPick(entries.map(e => ({
    label: `$(git-commit) ${e.summary}`,
    description: `${e.author}, ${when(e.date)}`,
    detail: `${short(e.sha)}  ${e.date.toLocaleString(vscode.env.language)}`,
    e,
  })), { title, matchOnDescription: true, matchOnDetail: true }).then(p => p && onPick(p.e));
}

async function fileHistory(uri) {
  uri = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
  const loc = await locate(uri);
  if (!loc) return vscode.window.showWarningMessage('Local Lens: git 저장소의 파일이 아닙니다.');
  const out = await git(loc.cwd, ['log', '--follow', '-M', '--name-status', LOG_FORMAT, '-n', '2000', '--', loc.name]);
  return pickCommit(parseLog(out, loc.rel), `File History: ${loc.rel}`, e => diffCommit({ cwd: loc.cwd, ...e }));
}

async function lineHistory() {
  const ed = vscode.window.activeTextEditor;
  const loc = await locate(ed?.document.uri);
  if (!loc) return vscode.window.showWarningMessage('Local Lens: git 저장소의 파일이 아닙니다.');
  const a = ed.selection.start.line + 1, b = ed.selection.end.line + 1;
  // shortcut: -L uses HEAD line numbers and the current path; unsaved edits/renames can shift the range.
  const out = await git(loc.cwd, ['log', '-L', `${a},${b}:${loc.name}`, '-s', LOG_FORMAT, '-n', '500']);
  return pickCommit(parseLog(out, loc.rel), `Line History: ${loc.rel}:${a}${a === b ? '' : '-' + b}`, e => diffCommit({ cwd: loc.cwd, ...e }));
}

async function repoHistory() {
  const loc = await locate(vscode.window.activeTextEditor?.document.uri);
  const cwd = loc?.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return;
  const out = await git(cwd, ['log', LOG_FORMAT, '-n', '2000']).catch(() => null);
  if (out === null) return vscode.window.showWarningMessage('Local Lens: git 저장소가 아닙니다.');
  return pickCommit(parseLog(out), 'Commits (작성자·메시지·SHA로 검색)', e => showCommit({ cwd, sha: e.sha }));
}

async function showCommit(arg) {
  const c = arg?.sha ? arg : await currentCommit();
  if (!c) return;
  if (isUncommitted(c.sha)) return diffWithHead();
  const [head, files] = await Promise.all([
    git(c.cwd, ['show', '-s', '--format=%h %an, %ad%n%B', '--date=format:%Y-%m-%d %H:%M', c.sha]),
    git(c.cwd, ['show', '-m', '--first-parent', '-M', '--name-status', '--format=', c.sha]),
  ]);
  const [title, ...body] = head.trim().split('\n');
  const picked = await vscode.window.showQuickPick([
    { label: '$(copy) Copy SHA', copy: true, detail: body.join(' ').trim() },
    ...parseNameStatus(files).map(f => ({
      label: `$(diff) ${path.posix.basename(f.file)}`,
      description: `${f.status}  ${path.posix.dirname(f.file)}${f.prevFile !== f.file ? `  ← ${f.prevFile}` : ''}`,
      f,
    })),
  ], { title, matchOnDescription: true });
  if (picked?.copy) return copySha(c);
  if (picked) return diffCommit({ cwd: c.cwd, sha: c.sha, file: picked.f.file, prevFile: picked.f.prevFile });
}

async function copySha(arg) {
  const c = arg?.sha ? arg : await currentCommit();
  if (!c || isUncommitted(c.sha)) return;
  await vscode.env.clipboard.writeText(c.sha);
  vscode.window.setStatusBarMessage(`$(copy) ${short(c.sha)} copied`, 2000);
}

// ---- decorations ----

const muted = new vscode.ThemeColor('editorCodeLens.foreground');
const inlineDeco = vscode.window.createTextEditorDecorationType({
  after: { margin: '0 0 0 3em', color: muted, fontStyle: 'italic' },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
});
const gutterDeco = vscode.window.createTextEditorDecorationType({
  before: { margin: '0 1.5em 0 0', color: muted },
});
const GUTTER = 48;
const gutterText = c => {
  const t = isUncommitted(c.sha) ? 'Uncommitted' : `${c.date.toISOString().slice(0, 10)} ${c.author.slice(0, 12).padEnd(12)} ${c.summary}`;
  return t.length > GUTTER ? t.slice(0, GUTTER - 1) + '…' : t;
};

let status, lastEditor;

async function refresh(ed) {
  if (lastEditor && lastEditor !== ed) lastEditor.setDecorations(inlineDeco, []);
  lastEditor = ed;
  if (!ed) return status.hide();
  const b = await blame(ed.document);
  if (ed !== vscode.window.activeTextEditor) return;
  const line = ed.selection.active.line;
  const c = b && line < ed.document.lineCount && b.lines[line];

  ed.setDecorations(inlineDeco, c && cfg().get('inlineBlame.enabled')
    ? [{ range: ed.document.lineAt(line).range.with({ start: ed.document.lineAt(line).range.end }), renderOptions: { after: { contentText: describe(c) } } }]
    : []);

  if (c && cfg().get('statusBar.enabled')) {
    status.text = `$(git-commit) ${who(c)}, ${isUncommitted(c.sha) ? 'uncommitted' : when(c.date)}`;
    status.tooltip = describe(c);
    status.show();
  } else status.hide();

  let prev;
  ed.setDecorations(gutterDeco, b && fileBlameOn.has(ed.document.uri.toString())
    ? b.lines.slice(0, ed.document.lineCount).map((c, i) => {
      const text = c && c !== prev ? gutterText(c) : '';
      prev = c;
      return { range: new vscode.Range(i, 0, i, 0), renderOptions: { before: { contentText: text.padEnd(GUTTER, ' ') } } };
    })
    : []);
}

// ---- hover + codelens ----

const hoverProvider = {
  async provideHover(doc, pos) {
    // Only over the trailing annotation (end of line), or the gutter when file blame is on.
    const atEnd = pos.character >= doc.lineAt(pos.line).range.end.character;
    if (!atEnd && !(pos.character === 0 && fileBlameOn.has(doc.uri.toString()))) return;
    const b = await blame(doc);
    const c = b && b.lines[pos.line];
    if (!c) return;
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = { enabledCommands: ['localLens.diffCommit', 'localLens.showCommit', 'localLens.copySha', 'localLens.fileHistory', 'localLens.diffWithHead'] };
    if (isUncommitted(c.sha)) {
      md.appendMarkdown(`$(account) **You** • Uncommitted changes\n\n[$(git-compare) Open Changes with HEAD](${cmdLink('localLens.diffWithHead', doc.uri)})`);
      return new vscode.Hover(md);
    }
    const arg = { cwd: b.loc.cwd, sha: c.sha, file: c.file, prevSha: c.prevSha, prevFile: c.prevFile };
    const msg = (await git(b.loc.cwd, ['show', '-s', '--format=%B', c.sha]).catch(() => c.summary)).trim();
    md.appendMarkdown(`$(account) **${esc(c.author)}** ${esc(c.email)}, ${when(c.date)} (${c.date.toLocaleString(vscode.env.language)})\n\n`);
    md.appendText(msg);
    md.appendMarkdown('\n\n---\n\n' + [
      `[$(git-compare) Open Changes](${cmdLink('localLens.diffCommit', arg)})`,
      `[$(git-commit) Show Commit](${cmdLink('localLens.showCommit', { cwd: b.loc.cwd, sha: c.sha })})`,
      `[$(history) File History](${cmdLink('localLens.fileHistory', doc.uri)})`,
      `[$(copy) ${short(c.sha)}](${cmdLink('localLens.copySha', { sha: c.sha })})`,
    ].join(' &nbsp;|&nbsp; '));
    return new vscode.Hover(md);
  },
};

const lensChanged = new vscode.EventEmitter();
const codeLensProvider = {
  onDidChangeCodeLenses: lensChanged.event,
  async provideCodeLenses(doc) {
    if (!cfg().get('codeLens.enabled')) return [];
    const b = await blame(doc);
    const commits = b && [...new Set(b.lines.filter(Boolean))];
    if (!commits?.length) return [];
    const latest = commits.reduce((a, c) => (c.date > a.date ? c : a));
    const authors = [...new Set(commits.map(who))];
    const r = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(r, { title: `${who(latest)}, ${when(latest.date)}`, command: 'localLens.fileHistory', arguments: [doc.uri] }),
      new vscode.CodeLens(r, {
        title: authors.length === 1 ? `1 author (${authors[0]})` : `${authors.length} authors (${authors[0]} and ${authors.length - 1} others)`,
        command: 'localLens.toggleFileBlame',
      }),
    ];
  },
};

// ---- activation ----

function activate(ctx) {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
  status.command = 'localLens.showCommit';

  let timer;
  const later = (ms = 150) => { clearTimeout(timer); timer = setTimeout(() => refresh(vscode.window.activeTextEditor), ms); };
  // shortcut: external commits are detected via .git/index|HEAD changes and window focus; upgrade to the vscode.git API if that misses cases.
  const invalidate = () => { blames.clear(); lensChanged.fire(); later(); };
  const watcher = vscode.workspace.createFileSystemWatcher('**/.git/{index,HEAD}');

  const files = [{ scheme: 'file' }];
  ctx.subscriptions.push(
    status, inlineDeco, gutterDeco, lensChanged, watcher,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, contentProvider),
    vscode.languages.registerHoverProvider(files, hoverProvider),
    vscode.languages.registerCodeLensProvider(files, codeLensProvider),
    vscode.window.onDidChangeActiveTextEditor(() => later(0)),
    vscode.window.onDidChangeTextEditorSelection(() => later()),
    vscode.workspace.onDidChangeTextDocument(e => e.document === vscode.window.activeTextEditor?.document && later(500)),
    vscode.workspace.onDidCloseTextDocument(d => blames.delete(d.uri.toString())),
    vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('localLens') && (lensChanged.fire(), later(0))),
    vscode.window.onDidChangeWindowState(s => s.focused && invalidate()),
    watcher.onDidChange(invalidate), watcher.onDidCreate(invalidate), watcher.onDidDelete(invalidate),
    vscode.commands.registerCommand('localLens.toggleFileBlame', () => {
      const key = vscode.window.activeTextEditor?.document.uri.toString();
      if (!key) return;
      fileBlameOn.has(key) ? fileBlameOn.delete(key) : fileBlameOn.add(key);
      later(0);
    }),
    vscode.commands.registerCommand('localLens.toggleInlineBlame', () =>
      cfg().update('inlineBlame.enabled', !cfg().get('inlineBlame.enabled'), vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('localLens.fileHistory', fileHistory),
    vscode.commands.registerCommand('localLens.lineHistory', lineHistory),
    vscode.commands.registerCommand('localLens.repoHistory', repoHistory),
    vscode.commands.registerCommand('localLens.showCommit', showCommit),
    vscode.commands.registerCommand('localLens.copySha', copySha),
    vscode.commands.registerCommand('localLens.diffWithHead', diffWithHead),
    vscode.commands.registerCommand('localLens.diffCommit', diffCommit),
    vscode.commands.registerCommand('localLens.diffLineCommit', async () => { const c = await currentCommit(); if (c) return diffCommit(c); }),
  );
  later(0);
}

module.exports = { activate, deactivate() {} };
