/**
 * @typedef {Object} KeyValueStore
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 * @property {(prefix?: string) => Promise<string[]>} [list]
 */

/**
 * @typedef {(request: Request) => Promise<Response>} AssetFetcher
 */

/**
 * @typedef {Object} RuntimeConfig
 * @property {number} [configTtlSeconds]
 * @property {number} [shortLinkTtlSeconds]
 * @property {string} [githubClientId]
 * @property {string} [githubClientSecret]
 * @property {string[]} [githubAllowedUsers]
 * @property {string} [authCookieSecret]
 * @property {string} [authOrigin]
 */

/**
 * @typedef {Object} RuntimeBindings
 * @property {KeyValueStore | null} [kv]
 * @property {AssetFetcher | null} [assetFetcher]
 * @property {Console} [logger]
 * @property {RuntimeConfig} [config]
 */

const DEFAULTS = {
    configTtlSeconds: 60 * 60 * 24 * 30
};

/**
 * Normalize optional runtime bindings and provide safe defaults.
 *
 * @param {RuntimeBindings | undefined} runtime
 * @returns {{ kv: KeyValueStore | null, assetFetcher: AssetFetcher | null, logger: Console, config: RuntimeConfig & { configTtlSeconds: number, shortLinkTtlSeconds: number | null } }}
 */
export function normalizeRuntime(runtime = {}) {
    return {
        kv: runtime.kv ?? null,
        assetFetcher: runtime.assetFetcher ?? null,
        logger: runtime.logger ?? console,
        config: {
            configTtlSeconds: runtime.config?.configTtlSeconds ?? DEFAULTS.configTtlSeconds,
            shortLinkTtlSeconds: runtime.config?.shortLinkTtlSeconds ?? null,
            githubClientId: runtime.config?.githubClientId ?? '',
            githubClientSecret: runtime.config?.githubClientSecret ?? '',
            githubAllowedUsers: runtime.config?.githubAllowedUsers ?? [],
            authCookieSecret: runtime.config?.authCookieSecret ?? '',
            authOrigin: runtime.config?.authOrigin ?? ''
        }
    };
}
