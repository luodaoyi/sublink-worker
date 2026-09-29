/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { Layout } from '../components/Layout.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { Form } from '../components/Form.jsx';
import { Footer } from '../components/Footer.jsx';
import { UpdateChecker } from '../components/UpdateChecker.jsx';
import { SingboxConfigBuilder } from '../builders/SingboxConfigBuilder.js';
import { ClashConfigBuilder } from '../builders/ClashConfigBuilder.js';
import { SurgeConfigBuilder } from '../builders/SurgeConfigBuilder.js';
import { createTranslator, resolveLanguage } from '../i18n/index.js';
import { encodeBase64, tryDecodeSubscriptionLines } from '../utils.js';
import { APP_NAME, APP_SUBTITLE } from '../constants.js';
import { ShortLinkService } from '../services/shortLinkService.js';
import { ConfigStorageService } from '../services/configStorageService.js';
import { GithubAuthService } from '../services/githubAuthService.js';
import { ServiceError, MissingDependencyError } from '../services/errors.js';
import { normalizeRuntime } from '../runtime/runtimeConfig.js';
import { PREDEFINED_RULE_SETS, SING_BOX_CONFIG, SING_BOX_CONFIG_V1_11, generateSubconverterConfig } from '../config/index.js';

const DEFAULT_USER_AGENT = 'curl/7.74.0';

export function createApp(bindings = {}) {
    const runtime = normalizeRuntime(bindings);
    const services = {
        shortLinks: runtime.kv ? new ShortLinkService(runtime.kv, { shortLinkTtlSeconds: runtime.config.shortLinkTtlSeconds }) : null,
        configStorage: runtime.kv ? new ConfigStorageService(runtime.kv, { configTtlSeconds: runtime.config.configTtlSeconds }) : null,
        auth: new GithubAuthService(runtime.kv, runtime.config)
    };

    const app = new Hono();

    app.use('*', async (c, next) => {
        const acceptLanguage = getRequestHeader(c.req, 'Accept-Language');
        const lang = c.req.query('lang') || acceptLanguage?.split(',')[0] || 'zh-CN';
        c.set('lang', lang);
        c.set('t', createTranslator(lang));
        await next();
    });

    app.get('/auth/github', async (c) => {
        try {
            const location = await services.auth.start(c.req.raw);
            return c.redirect(location);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/auth/github/callback', async (c) => {
        try {
            const result = await services.auth.callback(c.req.raw, c.req.query('code'), c.req.query('state'));
            c.header('Set-Cookie', services.auth.cookieHeader(result.session, c.req.raw));
            return c.redirect('/admin');
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/auth/logout', async (c) => {
        await services.auth.logout(c.req.raw);
        c.header('Set-Cookie', services.auth.cookieHeader('', c.req.raw, 0));
        return c.redirect('/');
    });

    app.get('/admin', async (c) => {
        const session = await services.auth.getSession(c.req.raw);
        if (!session) return c.redirect('/auth/github');
        return c.html(renderAdminPage(session));
    });

    app.get('/admin/api/configs', async (c) => {
        try {
            await requireAdminSession(c, services.auth);
            const storage = requireConfigStorage(services.configStorage);
            const configs = await storage.listConfigs();
            return c.json(configs.map(({ content, ...entry }) => ({ ...entry, content })));
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.post('/admin/api/configs', async (c) => {
        try {
            await requireAdminSession(c, services.auth);
            const body = await c.req.json();
            const type = typeof body?.type === 'string' ? body.type : '';
            if (!['rules', 'clash', 'singbox', 'surge'].includes(type)) return c.text('Invalid config type', 400);
            const storage = requireConfigStorage(services.configStorage);
            const id = await storage.saveConfig(type, body.content);
            return c.json({ id });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.put('/admin/api/configs/:id', async (c) => {
        try {
            await requireAdminSession(c, services.auth);
            const body = await c.req.json();
            if (!['rules', 'clash', 'singbox', 'surge'].includes(body?.type)) return c.text('Invalid config type', 400);
            const storage = requireConfigStorage(services.configStorage);
            const id = await storage.updateConfig(c.req.param('id'), body?.type, body?.content);
            return c.json({ id });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.delete('/admin/api/configs/:id', async (c) => {
        try {
            await requireAdminSession(c, services.auth);
            const storage = requireConfigStorage(services.configStorage);
            await storage.deleteConfig(c.req.param('id'));
            return c.body(null, 204);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/', (c) => {
        const t = c.get('t');
        const lang = resolveLanguage(c.get('lang'));
        const subtitle = APP_SUBTITLE[lang] || APP_SUBTITLE['zh-CN'];

        return c.html(
            <Layout title={t('pageTitle')} description={t('pageDescription')} keywords={t('pageKeywords')}>
                <div class="flex flex-col min-h-screen">
                    <Navbar />
                    <main class="flex-1">
                        <div class="container mx-auto px-4 py-8 pt-24">
                            <div class="max-w-4xl mx-auto">
                                <div class="text-center mb-12 pt-8">
                                    <h1 class="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
                                        {APP_NAME}
                                    </h1>
                                    <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
                                        {subtitle}
                                    </p>
                                </div>
                                <Form t={t} lang={lang} />
                            </div>
                        </div>
                    </main>
                    <Footer />
                    <UpdateChecker />
                </div>
            </Layout>
        );
    });

    app.get('/singbox', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const { selectedRules, customRules } = await resolveRuleOptions(
                c,
                services,
                parseSelectedRules(c.req.query('selectedRules')),
                parseJsonArray(c.req.query('customRules'))
            );
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const enableClashUI = parseBooleanFlag(c.req.query('enable_clash_ui'));
            const externalController = c.req.query('external_controller');
            const externalUiDownloadUrl = c.req.query('external_ui_download_url');
            const configId = c.req.query('configId');
            const lang = c.get('lang');

            const requestedSingboxVersion = c.req.query('singbox_version') || c.req.query('sb_version') || c.req.query('sb_ver');
            const requestUserAgent = getRequestHeader(c.req, 'User-Agent');
            const singboxConfigVersion = resolveSingboxConfigVersion(requestedSingboxVersion, requestUserAgent);

            let baseConfig = singboxConfigVersion === '1.11' ? SING_BOX_CONFIG_V1_11 : SING_BOX_CONFIG;
            if (configId?.startsWith('singbox_')) {
                const storage = requireConfigStorage(services.configStorage);
                const storedConfig = await storage.getConfigById(configId);
                if (storedConfig) {
                    baseConfig = storedConfig;
                }
            }

            const builder = new SingboxConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                enableClashUI,
                externalController,
                externalUiDownloadUrl,
                singboxConfigVersion,
                includeAutoSelect
            );
            await builder.build();
            const userinfo = builder.getSubscriptionUserinfo();
            if (userinfo) {
                c.header('subscription-userinfo', userinfo);
            }
            return c.json(builder.config);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/clash', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const { selectedRules, customRules } = await resolveRuleOptions(
                c,
                services,
                parseSelectedRules(c.req.query('selectedRules')),
                parseJsonArray(c.req.query('customRules'))
            );
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const enableClashUI = parseBooleanFlag(c.req.query('enable_clash_ui'));
            const externalController = c.req.query('external_controller');
            const externalUiDownloadUrl = c.req.query('external_ui_download_url');
            const configId = c.req.query('configId');
            const lang = c.get('lang');

            let baseConfig;
            if (configId?.startsWith('clash_')) {
                const storage = requireConfigStorage(services.configStorage);
                baseConfig = await storage.getConfigById(configId);
            }

            const builder = new ClashConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                enableClashUI,
                externalController,
                externalUiDownloadUrl,
                includeAutoSelect
            );
            await builder.build();
            const userinfo = builder.getSubscriptionUserinfo();
            const headers = { 'Content-Type': 'text/yaml; charset=utf-8' };
            if (userinfo) {
                headers['subscription-userinfo'] = userinfo;
            }
            return c.text(builder.formatConfig(), 200, headers);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/surge', async (c) => {
        try {
            const config = c.req.query('config');
            if (!config) {
                return c.text('Missing config parameter', 400);
            }

            const { selectedRules, customRules } = await resolveRuleOptions(
                c,
                services,
                parseSelectedRules(c.req.query('selectedRules')),
                parseJsonArray(c.req.query('customRules'))
            );
            const ua = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const configId = c.req.query('configId');
            const lang = c.get('lang');

            let baseConfig;
            if (configId?.startsWith('surge_')) {
                const storage = requireConfigStorage(services.configStorage);
                baseConfig = await storage.getConfigById(configId);
            }

            const builder = new SurgeConfigBuilder(
                config,
                selectedRules,
                customRules,
                baseConfig,
                lang,
                ua,
                groupByCountry,
                includeAutoSelect
            );
            builder.setSubscriptionUrl(c.req.url);
            await builder.build();

            const userinfo = builder.getSubscriptionUserinfo();
            if (userinfo) {
                c.header('subscription-userinfo', userinfo);
            }
            return c.text(builder.formatConfig());
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/subconverter', async (c) => {
        try {
            const rawSelectedRules = c.req.query('selectedRules');
            let selectedRules;

            if (!rawSelectedRules) {
                selectedRules = PREDEFINED_RULE_SETS.balanced;
            } else if (PREDEFINED_RULE_SETS[rawSelectedRules]) {
                selectedRules = PREDEFINED_RULE_SETS[rawSelectedRules];
            } else {
                try {
                    const parsed = JSON.parse(rawSelectedRules);
                    if (Array.isArray(parsed)) {
                        selectedRules = parsed;
                    } else {
                        return c.text('Invalid selectedRules: must be a preset name (minimal, balanced, comprehensive) or a JSON array', 400);
                    }
                } catch {
                    return c.text(`Invalid selectedRules: "${rawSelectedRules}" is not a valid preset name or JSON array. Valid presets: minimal, balanced, comprehensive`, 400);
                }
            }

            const includeAutoSelect = c.req.query('include_auto_select') !== 'false';
            const groupByCountry = parseBooleanFlag(c.req.query('group_by_country'));
            const ruleOptions = await resolveRuleOptions(c, services, selectedRules, parseJsonArray(c.req.query('customRules')));
            selectedRules = ruleOptions.selectedRules;
            const customRules = ruleOptions.customRules;
            const lang = c.get('lang');

            const config = generateSubconverterConfig({
                selectedRules,
                customRules,
                lang,
                includeAutoSelect,
                groupByCountry
            });

            return c.text(config, 200, {
                'Content-Type': 'text/plain; charset=utf-8'
            });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/xray', async (c) => {
        const inputString = c.req.query('config');
        if (!inputString) {
            return c.text('Missing config parameter', 400);
        }

        const proxylist = inputString.split('\n');
        const finalProxyList = [];
        let subscriptionUserinfo;
        const userAgent = c.req.query('ua') || getRequestHeader(c.req, 'User-Agent') || DEFAULT_USER_AGENT;
        const headers = { 'User-Agent': userAgent };

        for (const proxy of proxylist) {
            const trimmedProxy = proxy.trim();
            if (!trimmedProxy) continue;

            if (trimmedProxy.startsWith('http://') || trimmedProxy.startsWith('https://')) {
                try {
                    const response = await fetch(trimmedProxy, { method: 'GET', headers });
                    const fetchedUserinfo = response.headers.get('subscription-userinfo');
                    if (fetchedUserinfo && subscriptionUserinfo === undefined) {
                        subscriptionUserinfo = fetchedUserinfo;
                    }
                    const text = await response.text();
                    let processed = tryDecodeSubscriptionLines(text, { decodeUriComponent: true });
                    if (!Array.isArray(processed)) processed = [processed];
                    finalProxyList.push(...processed.filter(item => typeof item === 'string' && item.trim() !== ''));
                } catch (e) {
                    runtime.logger.warn('Failed to fetch the proxy', e);
                }
            } else {
                let processed = tryDecodeSubscriptionLines(trimmedProxy);
                if (!Array.isArray(processed)) processed = [processed];
                finalProxyList.push(...processed.filter(item => typeof item === 'string' && item.trim() !== ''));
            }
        }

        const finalString = finalProxyList.join('\n');
        if (!finalString) {
            return c.text('Missing config parameter', 400);
        }

        const responseHeaders = {};
        if (subscriptionUserinfo) {
            responseHeaders['subscription-userinfo'] = subscriptionUserinfo;
        }

        return c.text(encodeBase64(finalString), 200, responseHeaders);
    });

    app.get('/shorten-v2', async (c) => {
        try {
            const url = c.req.query('url');
            if (!url) {
                return c.text('Missing URL parameter', 400);
            }
            let parsedUrl;
            try {
                parsedUrl = new URL(url);
            } catch {
                return c.text('Invalid URL parameter', 400);
            }
            const queryString = parsedUrl.search;

            const shortLinks = requireShortLinkService(services.shortLinks);
            const code = await shortLinks.createShortLink(queryString, c.req.query('shortCode'));
            return c.text(code);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    const redirectHandler = (prefix) => async (c) => {
        try {
            const code = c.req.param('code');
            const shortLinks = requireShortLinkService(services.shortLinks);
            const originalParam = await shortLinks.resolveShortCode(code);
            if (!originalParam) return c.text('Short URL not found', 404);

            const url = new URL(c.req.url);
            return c.redirect(`${url.origin}/${prefix}${originalParam}`);
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    };

    app.get('/s/:code', redirectHandler('surge'));
    app.get('/b/:code', redirectHandler('singbox'));
    app.get('/c/:code', redirectHandler('clash'));
    app.get('/x/:code', redirectHandler('xray'));

    app.post('/config', async (c) => {
        try {
            await requireAdminSession(c, services.auth);
            const { type, content } = await c.req.json();
            const storage = requireConfigStorage(services.configStorage);
            const configId = await storage.saveConfig(type, content);
            return c.text(configId);
        } catch (error) {
            if (error instanceof SyntaxError) {
                return c.text(`Invalid format: ${error.message}`, 400);
            }
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/resolve', async (c) => {
        try {
            const shortUrl = c.req.query('url');
            const t = c.get('t');
            if (!shortUrl) return c.text(t('missingUrl'), 400);

            let urlObj;
            try {
                urlObj = new URL(shortUrl);
            } catch {
                return c.text(t('invalidShortUrl'), 400);
            }
            const pathParts = urlObj.pathname.split('/');
            if (pathParts.length < 3) return c.text(t('invalidShortUrl'), 400);

            const prefix = pathParts[1];
            const shortCode = pathParts[2];
            if (!['b', 'c', 'x', 's'].includes(prefix)) return c.text(t('invalidShortUrl'), 400);

            const shortLinks = requireShortLinkService(services.shortLinks);
            const originalParam = await shortLinks.resolveShortCode(shortCode);
            if (!originalParam) return c.text(t('shortUrlNotFound'), 404);

            const mapping = { b: 'singbox', c: 'clash', x: 'xray', s: 'surge' };
            const originalUrl = `${urlObj.origin}/${mapping[prefix]}${originalParam}`;
            return c.json({ originalUrl });
        } catch (error) {
            return handleError(c, error, runtime.logger);
        }
    });

    app.get('/favicon.ico', async (c) => {
        if (!runtime.assetFetcher) {
            return c.notFound();
        }
        try {
            return await runtime.assetFetcher(c.req.raw);
        } catch (error) {
            runtime.logger.warn('Asset fetch failed', error);
            return c.notFound();
        }
    });

    return app;
}

export function parseSelectedRules(raw) {
    if (!raw) return [];

    // 首先检查是否是预设名称 (minimal, balanced, comprehensive)
    // 这确保向后兼容主分支的 API 行为
    if (typeof raw === 'string' && PREDEFINED_RULE_SETS[raw]) {
        return PREDEFINED_RULE_SETS[raw];
    }

    // 尝试解析为 JSON 数组
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        // 解析失败，回退到 minimal 预设
        console.warn(`Failed to parse selectedRules: ${raw}, falling back to minimal`);
        return PREDEFINED_RULE_SETS.minimal;
    }
}

function parseJsonArray(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function resolveRuleOptions(c, services, selectedRules, customRules) {
    const ruleConfigId = c.req.query('ruleConfigId');
    if (!ruleConfigId?.startsWith('rules_')) return { selectedRules, customRules };

    const storage = requireConfigStorage(services.configStorage);
    const stored = await storage.getConfigById(ruleConfigId);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return { selectedRules, customRules };
    }

    return {
        selectedRules: Array.isArray(stored.selectedRules) ? stored.selectedRules : selectedRules,
        customRules: Array.isArray(stored.customRules) ? stored.customRules : customRules
    };
}

function parseBooleanFlag(value) {
    return value === 'true' || value === true;
}

function parseSemverLike(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const match = trimmed.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    if (!match) {
        return null;
    }
    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: match[3] ? Number(match[3]) : 0
    };
}

function isSingboxLegacyConfig(version) {
    if (!version || Number.isNaN(version.major) || Number.isNaN(version.minor)) {
        return false;
    }
    if (version.major !== 1) {
        return version.major < 1;
    }
    return version.minor < 12;
}

// 1.14 swaps rule-set download_detour for http_client, which older clients
// reject as an unknown field, so it needs its own config tier.
function isSingboxModernConfig(version) {
    if (!version || Number.isNaN(version.major) || Number.isNaN(version.minor)) {
        return false;
    }
    if (version.major !== 1) {
        return version.major > 1;
    }
    return version.minor >= 14;
}

function resolveSingboxConfigTier(version) {
    if (isSingboxLegacyConfig(version)) return '1.11';
    return isSingboxModernConfig(version) ? '1.14' : '1.12';
}

function resolveSingboxConfigVersion(requestedVersion, userAgent) {
    const normalizedRequested = typeof requestedVersion === 'string' ? requestedVersion.trim().toLowerCase() : '';
    if (normalizedRequested && normalizedRequested !== 'auto') {
        if (normalizedRequested === 'legacy') return '1.11';
        if (normalizedRequested === 'latest') return '1.14';
        const parsed = parseSemverLike(normalizedRequested);
        if (parsed) {
            return resolveSingboxConfigTier(parsed);
        }
    }

    if (typeof userAgent === 'string' && userAgent) {
        const uaMatch = userAgent.match(/sing-box\/(\d+\.\d+(?:\.\d+)?)/i) || userAgent.match(/sing-box\s+(\d+\.\d+(?:\.\d+)?)/i);
        const versionString = uaMatch?.[1];
        const parsed = versionString ? parseSemverLike(versionString) : null;
        if (parsed) {
            return resolveSingboxConfigTier(parsed);
        }
    }

    return '1.12';
}

function getRequestHeader(request, name) {
    if (!request || !name) {
        return undefined;
    }

    try {
        const value = request.header(name);
        if (value !== undefined) {
            return value;
        }
    } catch {
        // Fallback if HonoRequest.header cannot read from the raw request.
    }

    const headers = request.raw?.headers;
    if (!headers) {
        return undefined;
    }

    if (typeof headers.get === 'function') {
        return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
    }

    if (typeof headers === 'object') {
        const lowerName = name.toLowerCase();
        const headerValue = headers[lowerName] ?? headers[name];
        if (Array.isArray(headerValue)) {
            return headerValue[0];
        }
        return headerValue;
    }

    return undefined;
}

function requireShortLinkService(service) {
    if (!service) {
        throw new MissingDependencyError('Short link functionality is unavailable');
    }
    return service;
}

function requireConfigStorage(service) {
    if (!service) {
        throw new MissingDependencyError('Config storage functionality is unavailable');
    }
    return service;
}

async function requireAdminSession(c, auth) {
    const session = await auth.getSession(c.req.raw);
    if (!session) throw new ServiceError('Administrator authentication required', 401);
    return session;
}

function renderAdminPage(session) {
    const user = escapeHtml(session.login);
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sublink 管理后台</title><style>
body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1f2937}button,select,input,textarea{font:inherit;padding:.55rem;border:1px solid #d1d5db;border-radius:.4rem}button{cursor:pointer;background:#2563eb;color:#fff;border:0;padding:.6rem 1rem}button.danger{background:#dc2626}textarea{width:100%;min-height:28rem;font-family:monospace}table{width:100%;border-collapse:collapse;margin:1rem 0}td,th{padding:.6rem;border-bottom:1px solid #e5e7eb;text-align:left}.muted{color:#6b7280}.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}</style></head>
<body><div class="row"><h1 style="margin-right:auto">规则与配置管理</h1><span class="muted">${user}</span><a href="/auth/logout">退出</a></div>
<p class="muted">这里保存的规则档案可通过 <code>ruleConfigId</code> 绑定到订阅链接。内容只对白名单 GitHub 账号开放。</p>
<div class="row"><button id="new">新建配置</button><button id="reload">刷新</button><label>类型 <select id="type"><option value="rules">规则档案</option><option value="clash">Clash</option><option value="singbox">Sing-box</option><option value="surge">Surge</option></select></label><input id="id" placeholder="编辑时显示配置 ID" readonly style="min-width:18rem"></div>
<table><thead><tr><th>ID</th><th>类型</th><th>更新时间</th><th>操作</th></tr></thead><tbody id="list"></tbody></table>
<h2>配置内容</h2><textarea id="content" placeholder='规则档案示例：{"selectedRules":["Location:CN"],"customRules":[{"name":"🚀 节点选择","domain_suffix":"cursorvm.com"}]}'></textarea>
<div class="row" style="margin-top:.7rem"><button id="save">保存为新配置</button><button id="update">更新当前配置</button><button id="remove" class="danger">删除当前配置</button></div>
<script>
const $=id=>document.getElementById(id); let current=null;
async function load(){const r=await fetch('/admin/api/configs'); if(!r.ok){alert(await r.text());return} const rows=await r.json(); $('list').innerHTML=rows.map(x=>'<tr><td>'+x.id+'</td><td>'+x.type+'</td><td>'+new Date(x.updatedAt||x.createdAt||Date.now()).toLocaleString()+'</td><td><button data-id="'+x.id+'">编辑</button></td></tr>').join(''); document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>edit(b.dataset.id,rows));}
async function edit(id,rows){const x=rows.find(v=>v.id===id); if(!x)return; current=x.id; $('id').value=x.id; $('type').value=x.type; $('content').value=JSON.stringify(x.content,null,2); $('save').textContent='另存为新配置';}
async function save(update){let content; try{content=JSON.parse($('content').value)}catch(e){alert('JSON 无效：'+e.message);return} const body=JSON.stringify({type:$('type').value,content}); const r=await fetch(update?'/admin/api/configs/'+encodeURIComponent(current):'/admin/api/configs',{method:update?'PUT':'POST',headers:{'Content-Type':'application/json'},body}); if(!r.ok){alert(await r.text());return} await load(); alert('已保存');}
$('reload').onclick=load; $('new').onclick=()=>{current=null;$('id').value='';$('content').value='{}';$('save').textContent='保存为新配置'}; $('save').onclick=()=>save(false); $('update').onclick=()=>current?save(true):alert('请先选择配置'); $('remove').onclick=async()=>{if(!current||!confirm('确认删除？'))return; const r=await fetch('/admin/api/configs/'+encodeURIComponent(current),{method:'DELETE'}); if(!r.ok)alert(await r.text()); else{$('new').click();await load();}}; load();
</script></body></html>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function handleError(c, error, logger) {
    if (error instanceof ServiceError) {
        return c.text(error.message, error.status);
    }
    logger.error?.('Unhandled error', error);
    return c.text(`Error: ${error.message}`, 500);
}
