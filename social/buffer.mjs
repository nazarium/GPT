export async function bufferCredential(env) {
  const row = env.SOCIAL_DB ? await env.SOCIAL_DB.prepare("SELECT value FROM social_meta WHERE key='buffer-credential'").first() : null;
  if (row) return JSON.parse(row.value);
  return { revision: null, key: env.BUFFER_API_KEY || null };
}

export const CREATE_POST = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status schedulingType externalLink } }
    ... on MutationError { message }
  }
}`;
export const GET_POST = `query Post($input: PostInput!) {
  post(input: $input) { id status dueAt channelId schedulingType externalLink text assets { source } }
}`;
export const GET_CHANNELS = `query Channels($input: ChannelsInput!) {
  channels(input: $input) { id service type name isDisconnected isLocked isQueuePaused hasActiveMemberDevice }
}`;
export const GET_ORGANIZATIONS = `query Organizations { account { organizations { id name } } }`;

export class BufferFailure extends Error {
  constructor(kind, message, retryAt = 0) {
    super(message); this.kind = kind; this.retryAt = retryAt;
  }
}

export function retryAt(headers, now) {
  const value = headers.get('Retry-After');
  const numeric = Number(value);
  const delay = value ? (Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - now) : 0;
  const windows = [...(headers.get('RateLimit') ?? '').matchAll(/r\s*=\s*0\s*;\s*t\s*=\s*(\d+)/g)]
    .map(m => Number(m[1]) * 1000);
  return now + Math.max(60_000, delay || 0, ...windows);
}

export async function bufferRequest(env, query, variables, fetcher = fetch, now = Date.now()) {
  const credential = await bufferCredential(env);
  if (!credential.key) throw new BufferFailure('blocked', 'Buffer API key is not configured');
  const key = credential.key.trim();
  if (!key || /[^\x21-\x7e]/.test(key)) throw new BufferFailure('blocked', 'BUFFER_API_KEY must contain only the API token, without spaces or line breaks');
  const reading = !/\bmutation\b/.test(query);
  let response;
  try {
    response = await fetcher('https://api.buffer.com', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000), redirect: 'manual',
    });
  } catch {
    // A lost response may follow a committed mutation. Never blindly resend it.
    throw new BufferFailure(reading ? 'retry' : 'uncertain', reading ? 'Buffer read connection failed; safe to retry' : 'Buffer transport outcome unknown; reconcile before retry', reading ? now + 60_000 : 0);
  }
  if (response.status >= 300 && response.status < 400) throw new BufferFailure('blocked', 'Buffer endpoint redirected; authorization was not forwarded');
  if (response.status === 429) throw new BufferFailure('retry', 'Buffer rate limit', retryAt(response.headers, now));
  if (response.status === 401 || response.status === 403) throw new BufferFailure('blocked', 'Buffer authorization failed');
  if (!response.ok && response.status!==404) throw new BufferFailure('uncertain', 'Buffer HTTP ' + response.status + '; reconcile before retry');
  let body;
  try { body = await response.json(); }
  catch { throw new BufferFailure('uncertain', 'Buffer response unreadable; reconcile before retry'); }
  if(reading && query===GET_POST && variables?.input?.id && body.errors?.length &&
    body.errors.every(error=>error.message==='Post not found for id: '+variables.input.id))
    throw new BufferFailure('missing','Buffer explicitly reports that this post does not exist');
  if(!response.ok)throw new BufferFailure('uncertain','Buffer HTTP '+response.status+'; reconcile before retry');
  if (body.errors?.length) throw new BufferFailure('uncertain', 'GraphQL error; inspect Buffer before retry');
  if (!body.data) throw new BufferFailure('uncertain', 'Buffer returned no data');
  return body.data;
}

export async function createPost(env, input, fetcher = fetch, now = Date.now()) {
  const data = await bufferRequest(env, CREATE_POST, { input }, fetcher, now);
  const result = data.createPost;
  if (result?.__typename === 'MutationError') {
    // Do not persist provider error strings, which can contain private request details.
    throw new BufferFailure('blocked', 'Buffer rejected post; inspect channel and media in Buffer');
  }
  if (!result?.post?.id) throw new BufferFailure('uncertain', 'Buffer returned no post id');
  return result.post;
}
