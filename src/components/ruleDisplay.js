import { UNIFIED_RULES } from '../config/index.js';

export const CUSTOM_RULE_ICON_CLASS = 'fas fa-wand-magic-sparkles';
const DEFAULT_RULE_ICON_CLASS = 'fas fa-shuffle';

const RULE_ICON_CLASS_MAP = {
  'Ad Block': 'fas fa-shield-halved',
  'AI Services': 'fas fa-robot',
  Bilibili: 'fas fa-tv',
  Youtube: 'fab fa-youtube',
  Google: 'fas fa-globe',
  Private: 'fas fa-lock',
  'Location:CN': 'fas fa-location-dot',
  Telegram: 'fab fa-telegram',
  Github: 'fab fa-github',
  Microsoft: 'fab fa-microsoft',
  Apple: 'fab fa-apple',
  'Social Media': 'fas fa-hashtag',
  Streaming: 'fas fa-film',
  Gaming: 'fas fa-gamepad',
  Education: 'fas fa-graduation-cap',
  Financial: 'fas fa-wallet',
  'Cloud Services': 'fas fa-cloud',
  'Non-China': 'fas fa-earth-americas'
};

export function getRuleIconClass(ruleName) {
  return RULE_ICON_CLASS_MAP[ruleName] || DEFAULT_RULE_ICON_CLASS;
}

export function getRuleDisplayMap(t) {
  return UNIFIED_RULES.reduce((acc, rule) => {
    acc[rule.name] = {
      type: 'predefined',
      name: rule.name,
      label: t(`outboundNames.${rule.name}`),
      iconClass: getRuleIconClass(rule.name)
    };
    return acc;
  }, {});
}

export function getCustomRuleDisplayItem(rule = {}, index = 0, customRuleLabel = 'Custom Rule') {
  const normalizedName = typeof rule.name === 'string' ? rule.name.trim() : '';

  return {
    type: 'custom',
    name: normalizedName,
    label: normalizedName || `${customRuleLabel} ${index + 1}`,
    iconClass: CUSTOM_RULE_ICON_CLASS
  };
}

export function buildPriorityPreviewItems({
  selectedRules = [],
  customRules = [],
  ruleDisplayMap = {},
  customRuleLabel = 'Custom Rule'
} = {}) {
  const customItems = customRules.map((rule, index) =>
    getCustomRuleDisplayItem(rule, index, customRuleLabel)
  );

  const selectedItems = selectedRules.map((ruleName) => ({
    type: 'predefined',
    name: ruleName,
    label: ruleDisplayMap[ruleName]?.label || ruleName,
    iconClass: ruleDisplayMap[ruleName]?.iconClass || getRuleIconClass(ruleName)
  }));

  return [...customItems, ...selectedItems];
}
