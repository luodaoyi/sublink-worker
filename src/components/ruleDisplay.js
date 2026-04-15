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
  priorityOrder = [],
  ruleDisplayMap = {},
  customRuleLabel = 'Custom Rule'
} = {}) {
  const customItems = customRules.map((rule, index) => ({
    ...getCustomRuleDisplayItem(rule, index, customRuleLabel),
    _priorityKey: `custom:${index}`
  }));

  const selectedItems = selectedRules.map((ruleName) => ({
    type: 'predefined',
    name: ruleName,
    label: ruleDisplayMap[ruleName]?.label || ruleName,
    iconClass: ruleDisplayMap[ruleName]?.iconClass || getRuleIconClass(ruleName),
    _priorityKey: `predefined:${ruleName}`
  }));

  const itemsByPriorityKey = [...customItems, ...selectedItems].reduce((acc, item) => {
    acc[item._priorityKey] = item;
    return acc;
  }, {});

  const normalizedPriorityOrder = Array.isArray(priorityOrder) ? priorityOrder : [];

  if (normalizedPriorityOrder.length === 0) {
    return [...customItems, ...selectedItems].map(({ _priorityKey, ...item }) => item);
  }

  const orderedItems = [];
  const usedPriorityKeys = new Set();

  normalizedPriorityOrder.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    const priorityKey = entry.type === 'custom'
      ? `custom:${entry.index}`
      : entry.type === 'predefined'
        ? `predefined:${entry.name}`
        : null;

    if (!priorityKey || usedPriorityKeys.has(priorityKey) || !itemsByPriorityKey[priorityKey]) {
      return;
    }

    usedPriorityKeys.add(priorityKey);
    orderedItems.push(itemsByPriorityKey[priorityKey]);
  });

  const remainingItems = [...customItems, ...selectedItems].filter(
    (item) => !usedPriorityKeys.has(item._priorityKey)
  );

  return [...orderedItems, ...remainingItems].map(({ _priorityKey, ...item }) => item);
}
