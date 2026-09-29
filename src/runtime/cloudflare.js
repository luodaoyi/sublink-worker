import { CloudflareKVAdapter } from '../adapters/kv/cloudflareKv.js';

export function createCloudflareRuntime(env) {
    return {
        kv: env?.SUBLINK_KV ? new CloudflareKVAdapter(env.SUBLINK_KV) : null,
        assetFetcher: env?.ASSETS ? (request) => env.ASSETS.fetch(request) : null,
        logger: console,
        config: {
            githubClientId: env?.GITHUB_CLIENT_ID || '',
            githubClientSecret: env?.GITHUB_CLIENT_SECRET || '',
            githubAllowedUsers: parseAllowedUsers(env?.GITHUB_ALLOWED_USERS),
            authCookieSecret: env?.AUTH_COOKIE_SECRET || '',
            authOrigin: env?.AUTH_ORIGIN || ''
        }
    };
}

function parseAllowedUsers(value) {
    return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}
