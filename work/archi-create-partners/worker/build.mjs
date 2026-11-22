import './build-dialog.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const directory = new URL('../build/webhook/', import.meta.url);
await mkdir(directory, {recursive: true});
const parts = await Promise.all(['Integration.gs','Dialog.gs','Runtime.gs','Bridge.gs'].map(name => readFile(new URL('../apps-script/' + name, import.meta.url), 'utf8')));
await writeFile(new URL('Code.gs', directory), parts.join('\n\n'));
await writeFile(new URL('appsscript.json', directory), await readFile(new URL('../apps-script/appsscript.json', import.meta.url)));
console.log('Prepared local Apps Script bundle and Worker dialogue; no deployment performed.');
