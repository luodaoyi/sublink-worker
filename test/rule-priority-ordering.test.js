import { describe, it, expect } from 'vitest';
import { generateRules } from '../src/config/ruleGenerators.js';
import { formLogicFn } from '../src/components/formLogic.js';
import {
  buildPriorityPreviewItems,
  getCustomRuleDisplayItem,
  getRuleDisplayMap
} from '../src/components/ruleDisplay.js';

describe('rule priority ordering', () => {
  it('keeps custom rules in UI priority order without mutating the input array', () => {
    const customRules = [
      { name: 'Highest', domain_suffix: 'highest.example' },
      { name: 'Second', domain_suffix: 'second.example' }
    ];

    const originalSnapshot = JSON.stringify(customRules);
    const rules = generateRules(['Google'], customRules);

    expect(rules[0].outbound).toBe('Highest');
    expect(rules[1].outbound).toBe('Second');
    expect(JSON.stringify(customRules)).toBe(originalSnapshot);
  });

  it('reorders selected rules by drag target index for persisted priority', () => {
    const fakeWindow = {
      APP_TRANSLATIONS: {},
      PREDEFINED_RULE_SETS: {
        balanced: ['Google', 'Telegram', 'OpenAI']
      },
      location: { origin: 'https://example.com', search: '', href: 'https://example.com/' },
      history: { replaceState() {} }
    };

    const fn = new Function('window', '(' + formLogicFn.toString() + ')(); return window;');
    const result = fn(fakeWindow);
    const data = result.formData();

    data.selectedRules = ['Google', 'Telegram', 'OpenAI'];
    data.moveSelectedRule(2, 0);

    expect(data.selectedPredefinedRule).toBe('custom');
    expect(data.selectedRules).toEqual(['OpenAI', 'Google', 'Telegram']);
  });

  it('builds one shared display map for rule selection and priority preview', () => {
    const t = (key) => ({
      'outboundNames.Google': '谷歌',
      'outboundNames.Telegram': '电报'
    }[key] || key);

    const displayMap = getRuleDisplayMap(t);

    expect(displayMap.Google).toMatchObject({
      label: '谷歌',
      iconClass: 'fas fa-globe'
    });
    expect(displayMap.Telegram).toMatchObject({
      label: '电报',
      iconClass: 'fab fa-telegram'
    });
  });

  it('includes custom rules ahead of selected rules in the effective priority preview', () => {
    const displayMap = {
      Google: { label: '谷歌', iconClass: 'fas fa-globe' },
      Telegram: { label: '电报', iconClass: 'fab fa-telegram' }
    };

    const items = buildPriorityPreviewItems({
      selectedRules: ['Google', 'Telegram'],
      customRules: [
        { name: 'Work', domain_suffix: 'corp.example' },
        { name: '', domain_suffix: 'fallback.example' }
      ],
      ruleDisplayMap: displayMap,
      customRuleLabel: '自定义规则'
    });

    expect(items).toEqual([
      { type: 'custom', name: 'Work', label: 'Work', iconClass: 'fas fa-wand-magic-sparkles' },
      { type: 'custom', name: '', label: '自定义规则 2', iconClass: 'fas fa-wand-magic-sparkles' },
      { type: 'predefined', name: 'Google', label: '谷歌', iconClass: 'fas fa-globe' },
      { type: 'predefined', name: 'Telegram', label: '电报', iconClass: 'fab fa-telegram' }
    ]);
  });

  it('creates a stable fallback label for unnamed custom rules', () => {
    expect(getCustomRuleDisplayItem({ name: '  ' }, 2, '自定义规则')).toEqual({
      type: 'custom',
      name: '',
      label: '自定义规则 3',
      iconClass: 'fas fa-wand-magic-sparkles'
    });
  });
});
