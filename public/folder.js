// Folder support: filters junk directories and zips a folder in the browser (using fflate).
// Also loadable from Node so it can be tested without a browser.
(function (root) {
  'use strict';
  const MAX_BYTES = 500 * 1024 * 1024;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'venv']);
  const SKIP_FILES = new Set(['.ds_store', 'thumbs.db']);
  const ALREADY_COMPRESSED = /\.(zip|gz|7z|rar|png|jpe?g|gif|webp|mp3|mp4|mov|pdf)$/i;
  const ff = root.fflate || (typeof require === 'function' ? require('./vendor/fflate.js') : null);

  const fmt = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

  // Takes the FileList from <input webkitdirectory>. Returns { entry } or { error }.
  function filterFolder(list) {
    const files = Array.from(list);
    if (!files.length) return { error: 'No files were found in that folder, so nothing was added.' };
    const rootName = (files[0].webkitRelativePath || files[0].name).split('/')[0];
    const kept = [];
    const skipped = new Map();
    let size = 0;

    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split('/');
      const dir = parts.slice(1, -1).find((p) => SKIP_DIRS.has(p));
      const junk = SKIP_FILES.has(parts[parts.length - 1].toLowerCase());
      const reason = dir || (junk ? 'system files' : null);
      if (reason) { skipped.set(reason, (skipped.get(reason) || 0) + 1); continue; }
      kept.push({ file, path });
      size += file.size;
    }

    const names = [...skipped.keys()].join(', ');
    const skippedNote = skipped.size
      ? `Skipped ${[...skipped].map(([n, c]) => `${n} (${plural(c, 'file')})`).join(', ')}`
      : '';
    if (!kept.length) return { error: `Nothing to send: every file in "${rootName}" was skipped (${names}).` };
    if (size > MAX_BYTES) {
      return { error: `"${rootName}" is ${fmt(size)}${names ? ` even after skipping ${names}` : ''}. The limit is 500 MB. Remove large files or send a smaller folder.` };
    }
    return {
      entry: { isFolder: true, name: `${rootName}.zip`, displayName: rootName, size, count: kept.length, files: kept, skippedNote, lastModified: 0 },
    };
  }

  // Zips one folder entry into a Blob. Resolves null if shouldStop() turns true.
  // Rejects with err.path set when a file inside can't be read.
  function zipFolder(entry, onProgress, shouldStop) {
    return new Promise((resolve, reject) => {
      const parts = [];
      const zip = new ff.Zip((err, chunk, final) => {
        if (err) return reject(err);
        parts.push(chunk);
        if (final) resolve(new Blob(parts, { type: 'application/zip' }));
      });
      (async () => {
        try {
          for (let i = 0; i < entry.files.length; i++) {
            if (shouldStop && shouldStop()) { zip.terminate(); return resolve(null); }
            const { file, path } = entry.files[i];
            let data;
            try { data = new Uint8Array(await file.arrayBuffer()); }
            catch { const e = new Error('unreadable'); e.path = path; throw e; }
            const item = ALREADY_COMPRESSED.test(path) ? new ff.ZipPassThrough(path) : new ff.ZipDeflate(path, { level: 6 });
            const year = file.lastModified ? new Date(file.lastModified).getFullYear() : 0;
            if (year >= 1980 && year <= 2099) item.mtime = file.lastModified; // zip cannot store other dates
            zip.add(item);
            item.push(data, true);
            if (onProgress) onProgress(i + 1, entry.files.length);
            await new Promise((r) => setTimeout(r, 0)); // let the page repaint
          }
          zip.end();
        } catch (e) {
          try { zip.terminate(); } catch { /* already stopped */ }
          reject(e);
        }
      })();
    });
  }

  const api = { filterFolder, zipFolder, SKIP_DIRS };
  root.DropFolder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);