export class RedisKVAdapter {
    constructor(options = {}) {
        const { prefix, client, manageConnection = false } = options;
        if (!client) {
            throw new Error('Redis KV adapter requires an active Redis client instance');
        }
        this.prefix = prefix ? `${prefix}:` : '';
        this.client = client;
        this.manageConnection = manageConnection;
    }

    formatKey(key) {
        return `${this.prefix}${key}`;
    }

    async get(key) {
        const value = await this.client.get(this.formatKey(key));
        return value ?? null;
    }

    async put(key, value, options = {}) {
        const ttlSeconds = normalizeTtl(options.expirationTtl);
        const formattedKey = this.formatKey(key);
        if (typeof ttlSeconds === 'number') {
            await this.client.set(formattedKey, value, 'EX', ttlSeconds);
        } else {
            await this.client.set(formattedKey, value);
        }
    }

    async delete(key) {
        await this.client.del(this.formatKey(key));
    }

    async list(prefix = '') {
        const keys = [];
        let cursor = '0';
        do {
            const result = await this.client.scan(cursor, 'MATCH', this.formatKey(prefix) + '*', 'COUNT', 500);
            cursor = String(result[0]);
            keys.push(...result[1].map((key) => key.slice(this.prefix.length)));
        } while (cursor !== '0');
        return keys;
    }

    async disconnect() {
        if (this.manageConnection && this.client) {
            await this.client.quit();
        }
    }
}

function normalizeTtl(ttl) {
    if (!ttl && ttl !== 0) return null;
    const parsed = Math.floor(Number(ttl));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
