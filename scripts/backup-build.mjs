import {readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const git = args => execFileSync('git', ['-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), ...args], {encoding: 'utf8'}).trim();
export async function writeBackupBuild() {
  const assets = [];
  async function walk(path = '') {
    for (const item of await readdir('dist/' + path, {withFileTypes: true})) {
      const name = path + item.name;
      if (item.isDirectory()) await walk(name + '/');
      else {
        const bytes = await readFile('dist/' + name);
        assets.push({path: name, size: bytes.length, sha256: sha256(bytes)});
      }
    }
  }
  await walk();
  assets.sort((a, b) => a.path.localeCompare(b.path));
  const value = {commit: git(['rev-parse', 'HEAD']), dirty: !!git(['status', '--porcelain']), assets};
  value.id = sha256(JSON.stringify(value));
  await writeFile('.build/backup-build.json', JSON.stringify(value));
}
