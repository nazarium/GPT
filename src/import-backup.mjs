// The v1 file wraps its JSON payload in a JSON string. Read one escaped
// [key,value] at a time, including strings and arrays spanning file slices.
async function* backupParts(file) {
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let buffer = '', state = 'header', index = 0, depth = 0, quoted = false, slashes = 0;
  const invalid = () => new Error('Неповний або некоректний файл резервної копії.');
  for (let offset = 0; offset < file.size; offset += 256 * 1024) {
    const slice = file.slice(offset, offset + 256 * 1024);
    buffer += decoder.decode(await slice.arrayBuffer(), {stream: offset + slice.size < file.size});
    for (;;) {
      if (state === 'header') {
        const match = /^\s*\{\s*"payload"\s*:\s*"\{\\"format\\":\\"archi-create-do-v1\\",\\"createdAt\\":\\"([\dT:.Z-]+)\\",\\"entries\\":\[/.exec(buffer);
        if (!match) { if (buffer.length > 1024) throw invalid(); break; }
        yield {date: match[1]};
        buffer = buffer.slice(match[0].length);
        state = 'first';
      }
      if (state === 'first' || state === 'separator') {
        if (!buffer.length) break;
        if (buffer[0] === ']') { state = 'footer'; continue; }
        if (state === 'separator') {
          if (buffer[0] !== ',') throw invalid();
          buffer = buffer.slice(1);
        }
        state = 'entry';
      }
      if (state === 'footer') {
        if (buffer.length > 2048) throw invalid();
        break;
      }
      if (!buffer.length) break;
      if (buffer[0] !== '[') throw invalid();
      for (; index < buffer.length; index++) {
        const char = buffer[index];
        if (char === '\\') { slashes++; continue; }
        if (char === '"') {
          if (slashes % 2 === 0) throw invalid();
          if (slashes % 4 === 1) quoted = !quoted;
        }
        slashes = 0;
        if (!quoted && char === '[') depth++;
        if (!quoted && char === ']' && --depth === 0) {
          yield {entry: JSON.parse('"' + buffer.slice(0, index + 1) + '"')};
          buffer = buffer.slice(index + 1);
          index = 0;
          state = 'separator';
          break;
        }
      }
      if (state === 'entry') {
        if (buffer.length > 16 * 1024 * 1024) throw invalid();
        break;
      }
    }
  }
  if (state !== 'footer' || !buffer.startsWith(']}"')) throw invalid();
  const footer = JSON.parse('{"payload":""' + buffer.slice(3));
  yield {signature: footer.signature};
}

export async function importBackup(file, api) {
  const post = (action, data) => api('home/backup?restore=' + action, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
  });
  let session, signature, entries = [], size = 0, offset = 0;
  async function flush() {
    if (!entries.length) return;
    await post('append', {session, offset, entries});
    offset += entries.length;
    entries = [];
    size = 0;
  }
  try {
    for await (const part of backupParts(file)) {
      if (part.date) ({session} = await post('start', {date: part.date}));
      else if ('entry' in part) {
        entries.push(part.entry);
        size += part.entry.length;
        if (size >= 256 * 1024 || entries.length >= 100) await flush();
      } else signature = part.signature;
    }
    await flush();
    return await post('finish', {session, offset, signature, confirm: 'RESTORE'});
  } catch (error) {
    if (session) await post('cancel', {session}).catch(() => {});
    throw error;
  }
}
