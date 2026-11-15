// API の呼び先。Cloudflare（Worker と同じドメイン）なら相対パス、
// それ以外（デプロイナウなど）からは Cloudflare の API を呼ぶ
const REMOTE = 'https://lantern-street.lantern-street.workers.dev';
const LOCAL = 'http://localhost:8787'; // wrangler dev

const { hostname, port } = location;
const local = hostname === 'localhost' || hostname === '127.0.0.1';

export const API = hostname.endsWith('.workers.dev') || (local && port === '8787')
  ? ''
  : local ? LOCAL : REMOTE;
