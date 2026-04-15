export const WEBSITE_PLATFORM_OPTIONS = [
  {
    value: 'unknown',
    label: 'Needs review',
    description: 'Platform has not been classified yet.'
  },
  {
    value: 'wordpress_custom',
    label: 'WordPress custom',
    description: 'Dashboard-managed content can be prepared for WordPress injection.'
  },
  {
    value: 'entrata',
    label: 'Entrata website',
    description: 'This dashboard should stay read-only for content updates.'
  },
  {
    value: 'other',
    label: 'Other platform',
    description: 'Use for properties that are not Entrata and not part of the WordPress workflow.'
  }
];

export const WEBSITE_MANAGER_FIELDS = [
  {
    key: 'heroHeadline',
    label: 'Homepage headline',
    group: 'Homepage hero',
    input: 'textarea',
    placeholder: 'Luxury living near {{city}}.'
  },
  {
    key: 'heroSubheadline',
    label: 'Homepage subheadline',
    group: 'Homepage hero',
    input: 'textarea',
    placeholder: 'Use one or two sentences to frame the main offer, location, or lifestyle.'
  },
  {
    key: 'heroPrimaryCtaLabel',
    label: 'Primary CTA label',
    group: 'Calls to action',
    placeholder: 'Schedule a Tour'
  },
  {
    key: 'heroPrimaryCtaUrl',
    label: 'Primary CTA URL',
    group: 'Calls to action',
    placeholder: '/contact'
  },
  {
    key: 'heroSecondaryCtaLabel',
    label: 'Secondary CTA label',
    group: 'Calls to action',
    placeholder: 'View Floor Plans'
  },
  {
    key: 'heroSecondaryCtaUrl',
    label: 'Secondary CTA URL',
    group: 'Calls to action',
    placeholder: '/floorplans'
  },
  {
    key: 'bannerEyebrow',
    label: 'Banner eyebrow',
    group: 'Promo banner',
    placeholder: 'Now Leasing'
  },
  {
    key: 'bannerHeadline',
    label: 'Banner headline',
    group: 'Promo banner',
    input: 'textarea',
    placeholder: 'Limited-time offers at {{property_name}}'
  },
  {
    key: 'bannerBody',
    label: 'Banner supporting copy',
    group: 'Promo banner',
    input: 'textarea',
    placeholder: 'Mention specials, urgency, or a value prop in one short paragraph.'
  },
  {
    key: 'floorplansHeadline',
    label: 'Floor plans section headline',
    group: 'Floor plans',
    placeholder: 'Spaces designed for the way you live'
  },
  {
    key: 'floorplansBody',
    label: 'Floor plans supporting copy',
    group: 'Floor plans',
    input: 'textarea',
    placeholder: 'Highlight variety, layouts, or premium finishes.'
  },
  {
    key: 'availabilityNote',
    label: 'Availability note',
    group: 'Availability',
    input: 'textarea',
    placeholder: 'Pricing and availability are subject to change.'
  }
];

export const WEBSITE_MANAGER_FIELD_GROUPS = Array.from(
  WEBSITE_MANAGER_FIELDS.reduce((groups, field) => {
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
    return groups;
  }, new Map()).entries()
).map(([title, fields]) => ({ title, fields }));

export const WEBSITE_MANAGER_DEFAULT_CONTENT = Object.fromEntries(
  WEBSITE_MANAGER_FIELDS.map((field) => [field.key, ''])
);

export const WEBSITE_MANAGER_DEFAULT_RECORD = {
  platform: 'unknown',
  websiteUrl: '',
  wordpressSiteKey: '',
  notes: '',
  content: WEBSITE_MANAGER_DEFAULT_CONTENT
};

export const WEBSITE_MANAGER_TOKEN_DEFINITIONS = [
  { token: 'property_name', label: 'Property name' },
  { token: 'city', label: 'City' },
  { token: 'state', label: 'State' },
  { token: 'property_id', label: 'Property ID' }
];

export const normalizeWebsiteManagerRecord = (value) => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const safeContent = safeValue.content && typeof safeValue.content === 'object' ? safeValue.content : {};

  return {
    platform: safeValue.platform || WEBSITE_MANAGER_DEFAULT_RECORD.platform,
    websiteUrl: safeValue.websiteUrl || '',
    wordpressSiteKey: safeValue.wordpressSiteKey || '',
    notes: safeValue.notes || '',
    content: {
      ...WEBSITE_MANAGER_DEFAULT_CONTENT,
      ...safeContent
    }
  };
};

export const getWebsitePlatformMeta = (platform) => {
  return WEBSITE_PLATFORM_OPTIONS.find((option) => option.value === platform) || WEBSITE_PLATFORM_OPTIONS[0];
};

export const isWebsiteManagerEditable = (platform) => platform === 'wordpress_custom';

export const resolveMustacheTokens = (value, tokenValues) => {
  return String(value || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, tokenName) => {
    const resolved = tokenValues[tokenName];
    return resolved == null || resolved === '' ? `{{${tokenName}}}` : String(resolved);
  });
};
