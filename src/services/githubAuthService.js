import { MissingDependencyError, InvalidPayloadError } from './errors.js';

const STATE_TTL_SECONDS = 600;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SESSION_COOKIE = 'sublink_admin_session';

export class GithubAuthService {
    constructor(kv, config = {}) {
        this.kv = kv;
        this.clientId = config.githubClientId || '';
        this.clientSecret = config.githubClientSecret || '';
        this.allowedUsers = new Set(config.githubAllowedUsers || []);
        this.cookieSecret = config.authCookieSecret || '';
        this.origin = config.authOrigin || '';
    }

    isConfigured() {
        return Boolean(this.kv && this.clientId && this.clientSecret && this.cookieSecret && this.allowedUsers.size);
    }

    ensureConfigured() {
        if (!this.isConfigured()) {
            throw new MissingDependencyError('GitHub OAuth is not configured');
        }
    }

    callbackUrl(request) {
        const origin = this.origin || new URL(request.url).origin;
        return `${origin}/auth/github/callback`;
    }

    async start(request) {
        this.ensureConfigured();
        const state = crypto.randomUUID();
        await this.kv.put(`oauth_state_${state}`, JSON.stringify({ createdAt: Date.now() }), { expirationTtl: STATE_TTL_SECONDS });
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.callbackUrl(request),
            scope: 'read:user',
            state
        });
        return `https://github.com/login/oauth/authorize?${params}`;
    }

    async callback(request, code, state) {
        this.ensureConfigured();
        if (!code || !state) throw new InvalidPayloadError('Missing OAuth callback parameters');
        const stateKey = `oauth_state_${state}`;
        const storedState = await this.kv.get(stateKey);
        await this.kv.delete(stateKey);
        if (!storedState) throw new InvalidPayloadError('Expired or invalid OAuth state');

        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code, redirect_uri: this.callbackUrl(request) })
        });
        if (!tokenResponse.ok) throw new InvalidPayloadError('GitHub token exchange failed');
        const token = await tokenResponse.json();
        if (!token.access_token) throw new InvalidPayloadError('GitHub token exchange failed');

        const userResponse = await fetch('https://api.github.com/user', {
            headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`, 'User-Agent': 'sublink-worker' }
        });
        if (!userResponse.ok) throw new InvalidPayloadError('GitHub user lookup failed');
        const user = await userResponse.json();
        const login = String(user.login || '').toLowerCase();
        if (!this.allowedUsers.has(login)) throw new InvalidPayloadError('GitHub user is not allowed');

        const session = crypto.randomUUID();
        await this.kv.put(`admin_session_${session}`, JSON.stringify({ login, id: user.id, name: user.name || login }), { expirationTtl: SESSION_TTL_SECONDS });
        return { session, login };
    }

    async getSession(request) {
        if (!this.isConfigured()) return null;
        const cookies = parseCookies(request.headers.get('Cookie'));
        const session = cookies[SESSION_COOKIE];
        if (!session || !/^[0-9a-f-]{36}$/i.test(session)) return null;
        const value = await this.kv.get(`admin_session_${session}`);
        if (!value) return null;
        try { return { ...JSON.parse(value), token: session }; } catch { return null; }
    }

    async logout(request) {
        const session = await this.getSession(request);
        if (session) await this.kv.delete(`admin_session_${session.token}`);
    }

    cookieHeader(session, request, maxAge = SESSION_TTL_SECONDS) {
        const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
        return `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
    }
}

function parseCookies(value) {
    return String(value || '').split(';').reduce((result, part) => {
        const index = part.indexOf('=');
        if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
        return result;
    }, {});
}
