const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
let failed = false;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) failed = true; };

ok('page language is set', /<html[^>]*\slang="[a-z-]+"/i.test(html));
ok('skip link target exists', /href="#main"/.test(html) && /id="main"/.test(html));
ok('no positive tabindex values', !/tabindex="[1-9]/.test(html));
const inputs = [...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map((m) => m[1]);
ok('every input has a label', inputs.every((id) => new RegExp(`<label[^>]*for="${id}"`).test(html)));
const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
ok('every button has visible text', buttons.every((m) => m[1].trim().length > 0));
ok('status is a live region', /id="status"[^>]*role="status"/.test(html));
ok('progress has an accessible name', /<progress[^>]*aria-label=/.test(html));
ok('no click handlers on non-interactive elements', !/<(div|span|p)[^>]*onclick/i.test(html));
process.exit(failed ? 1 : 0);