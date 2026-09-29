const { filterFolder, zipFolder } = require('./public/folder.js');
const { unzipSync, strFromU8 } = require('./public/vendor/fflate.js');
let failed = false;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed = true; };

const fake = (path, text, extra = {}) => {
  const bytes = Buffer.from(text);
  return { name: path.split('/').pop(), size: extra.size ?? bytes.length, webkitRelativePath: path,
    lastModified: extra.lastModified ?? Date.now(), arrayBuffer: extra.arrayBuffer || (async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)) };
};

(async () => {
  const list = [
    fake('proj/index.js', 'console.log(1)'), fake('proj/src/a.js', 'export const a = 2'),
    fake('proj/node_modules/x/y.js', 'junk'), fake('proj/node_modules/x/z.js', 'junk'), fake('proj/node_modules/q.js', 'junk'),
    fake('proj/.git/config', 'junk'), fake('proj/dist/out.js', 'junk'), fake('proj/.DS_Store', 'junk'),
    fake('proj/logo.png', 'not really a png', { lastModified: 0 }),
  ];
  const r = filterFolder(list);
  ok('keeps 3 real files', r.entry && r.entry.count === 3);
  ok('zip is named after the folder', r.entry.name === 'proj.zip');
  ok('reports node_modules (3 files) as skipped', /node_modules \(3 files\)/.test(r.entry.skippedNote));
  ok('reports .git, dist and system files as skipped', ['.git', 'dist', 'system files'].every((n) => r.entry.skippedNote.includes(n)));

  const blob = await zipFolder(r.entry);
  const out = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  ok('zip holds exactly the kept files', Object.keys(out).sort().join() === 'proj/index.js,proj/logo.png,proj/src/a.js');
  ok('file contents survive zipping', strFromU8(out['proj/src/a.js']) === 'export const a = 2');

  ok('empty folder gives a clear error', /No files were found/.test(filterFolder([]).error));
  const allSkipped = filterFolder([fake('p/node_modules/a.js', 'x'), fake('p/.git/b', 'x')]);
  ok('nothing left after skipping gives an error', /Nothing to send/.test(allSkipped.error));
  const huge = filterFolder([fake('big/a.bin', '', { size: 600 * 1024 * 1024 })]);
  ok('over 500 MB after skipping gives an error', /limit is 500 MB/.test(huge.error));

  const bad = filterFolder([fake('p/ok.txt', 'fine'), fake('p/locked.txt', 'x', { arrayBuffer: async () => { throw new Error('NotReadableError'); } })]);
  let err; try { await zipFolder(bad.entry); } catch (e) { err = e; }
  ok('unreadable file names the path in the error', err && err.path === 'p/locked.txt');

  const stopped = await zipFolder(r.entry, null, () => true);
  ok('cancelling stops zipping', stopped === null);
  const envList = [fake('app/index.js', 'x'), fake('app/.env', 'SECRET=1'), fake('app/.env.production', 'SECRET=2'), fake('app/.env.example', 'SECRET='), fake('app/.gitignore', 'node_modules')];
  const noEnv = filterFolder(envList);
  ok('.env and .env.production are skipped by default', noEnv.entry.count === 3 && /\.env files \(2 files\)/.test(noEnv.entry.skippedNote));
  ok('.env.example and .gitignore are still sent', noEnv.entry.files.some((f) => f.path === 'app/.env.example') && noEnv.entry.files.some((f) => f.path === 'app/.gitignore'));
  ok('skipped note tells the user how to include .env', /Include \.env files/.test(noEnv.entry.skippedNote));
  const withEnv = filterFolder(envList, { includeEnv: true });
  ok('includeEnv sends every file', withEnv.entry.count === 5 && !/env/.test(withEnv.entry.skippedNote));
  process.exit(failed ? 1 : 0);
})();