import { describe, it, expect } from 'vitest';
import { generateRules } from '../src/config/ruleGenerators.js';
import { formLogicFn } from '../src/components/formLogic.js';

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
});
