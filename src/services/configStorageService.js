import yaml from 'js-yaml';
import { generateWebPath } from '../utils.js';
import { InvalidPayloadError, MissingDependencyError } from './errors.js';

export class ConfigStorageService {
    constructor(kv, options = {}) {
        this.kv = kv;
        this.options = options;
    }

    ensureKv() {
        if (!this.kv) {
            throw new MissingDependencyError('Config storage requires a KV store');
        }
        return this.kv;
    }

    async getConfigById(configId) {
        const kv = this.ensureKv();
        const stored = await kv.get(configId);
        if (!stored) return null;
        try {
            return JSON.parse(stored);
        } catch {
            throw new InvalidPayloadError('Stored config is not valid JSON');
        }
    }

    async saveConfig(type, content) {
        if (!type) {
            throw new InvalidPayloadError('Missing config type');
        }

        const kv = this.ensureKv();
        const configId = `${type}_${generateWebPath(8)}`;
        const configString = this.serializeConfig(type, content);

        // Validate string is JSON before storing
        JSON.parse(configString);

        const ttlSeconds = this.options.configTtlSeconds;
        const putOptions = ttlSeconds ? { expirationTtl: ttlSeconds } : undefined;
        await kv.put(configId, configString, putOptions);
        await this.addToIndex({ id: configId, type, createdAt: Date.now() });
        return configId;
    }

    async updateConfig(configId, type, content) {
        if (!/^([a-z]+)_[A-Za-z0-9_-]{8,}$/.test(configId)) {
            throw new InvalidPayloadError('Invalid config ID');
        }
        const kv = this.ensureKv();
        const configString = this.serializeConfig(type, content);
        JSON.parse(configString);
        const ttlSeconds = this.options.configTtlSeconds;
        await kv.put(configId, configString, ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
        await this.addToIndex({ id: configId, type, updatedAt: Date.now() });
        return configId;
    }

    async listConfigs() {
        const kv = this.ensureKv();
        const raw = await kv.get('config_index');
        let entries;
        try { entries = raw ? JSON.parse(raw) : []; } catch { entries = []; }
        const known = new Set((Array.isArray(entries) ? entries : []).map((entry) => entry.id));
        if (typeof kv.list === 'function') {
            for (const prefix of ['rules_', 'clash_', 'singbox_', 'surge_']) {
                for (const id of await kv.list(prefix)) {
                    if (!known.has(id)) {
                        entries.push({ id, type: id.split('_', 1)[0], discovered: true });
                        known.add(id);
                    }
                }
            }
        }
        const result = [];
        for (const entry of Array.isArray(entries) ? entries : []) {
            const content = await kv.get(entry.id);
            if (content) result.push({ ...entry, content: this.parseStored(content) });
        }
        return result;
    }

    async deleteConfig(configId) {
        const kv = this.ensureKv();
        await kv.delete(configId);
        const raw = await kv.get('config_index');
        if (!raw) return;
        try {
            const entries = JSON.parse(raw).filter((entry) => entry.id !== configId);
            await kv.put('config_index', JSON.stringify(entries));
        } catch { /* Ignore a corrupt index after deleting the requested key. */ }
    }

    parseStored(value) {
        try { return JSON.parse(value); } catch { return null; }
    }

    async addToIndex(entry) {
        const kv = this.ensureKv();
        const raw = await kv.get('config_index');
        let entries = [];
        try { entries = raw ? JSON.parse(raw) : []; } catch { entries = []; }
        const existing = entries.find((item) => item.id === entry.id);
        if (existing) Object.assign(existing, entry);
        else entries.push(entry);
        await kv.put('config_index', JSON.stringify(entries));
    }

    serializeConfig(type, content) {
        if (type === 'clash') {
            if (typeof content === 'string' && (content.trim().startsWith('-') || content.includes(':'))) {
                const yamlConfig = yaml.load(content);
                return JSON.stringify(yamlConfig);
            }
            return typeof content === 'object' ? JSON.stringify(content) : content;
        }

        if (typeof content === 'object') {
            return JSON.stringify(content);
        }
        if (typeof content === 'string') {
            return content;
        }
        throw new InvalidPayloadError('Unsupported config content type');
    }
}
