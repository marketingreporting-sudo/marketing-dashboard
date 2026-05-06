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

export const WEBSITE_MANAGER_DEFAULT_SCHEMA = {
  groups: WEBSITE_MANAGER_FIELD_GROUPS.map((group, index) => ({
    id: `legacy_${index + 1}`,
    label: group.title,
    fields: group.fields.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.key.toLowerCase().includes('url') ? 'url' : (field.input === 'textarea' ? 'richtext' : 'text'),
      placeholder: field.placeholder || '',
    })),
  })),
};

export const buildWebsiteManagerDefaultContent = (schema = WEBSITE_MANAGER_DEFAULT_SCHEMA) => Object.fromEntries(
  (Array.isArray(schema?.groups) ? schema.groups : []).flatMap((group) => (
    Array.isArray(group?.fields) ? group.fields.map((field) => [field.key, '']) : []
  ))
);

export const normalizeWebsiteManagerSchema = (value) => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const sourceGroups = Array.isArray(safeValue.groups) && safeValue.groups.length > 0
    ? safeValue.groups
    : WEBSITE_MANAGER_DEFAULT_SCHEMA.groups;
  const seenFieldKeys = new Set();
  const groups = sourceGroups
    .map((group, groupIndex) => {
      const safeGroup = group && typeof group === 'object' ? group : {};
      const fields = (Array.isArray(safeGroup.fields) ? safeGroup.fields : [])
        .map((field) => {
          const safeField = field && typeof field === 'object' ? field : {};
          const key = String(safeField.key || '').trim();
          if (!key || seenFieldKeys.has(key)) return null;
          seenFieldKeys.add(key);
          const type = ['text', 'url', 'richtext'].includes(safeField.type) ? safeField.type : 'text';
          return {
            key,
            label: String(safeField.label || key).trim(),
            type,
            placeholder: String(safeField.placeholder || '').trim(),
          };
        })
        .filter(Boolean);
      if (fields.length === 0) return null;
      return {
        id: String(safeGroup.id || `group_${groupIndex + 1}`),
        label: String(safeGroup.label || `Group ${groupIndex + 1}`),
        fields,
      };
    })
    .filter(Boolean);
  return groups.length > 0 ? { groups } : WEBSITE_MANAGER_DEFAULT_SCHEMA;
};

export const WEBSITE_MANAGER_DEFAULT_RECORD = {
  platform: 'unknown',
  websiteUrl: '',
  wordpressSiteKey: '',
  notes: '',
  schema: WEBSITE_MANAGER_DEFAULT_SCHEMA,
  content: buildWebsiteManagerDefaultContent(WEBSITE_MANAGER_DEFAULT_SCHEMA),
  derivedContent: {
    specialsSummary: '',
    specialsCount: 0,
    pricingSummary: '',
    availabilitySummary: '',
    availabilityUrl: '',
    startingPrice: '',
    priceRange: '',
    floorplanCount: 0,
    availableUnitCount: 0,
    specialsLastSyncedAt: null,
    pricingLastSyncedAt: null,
  },
  wordpressSync: {
    publishEnabled: false,
    targetUrl: '',
    siteKeyConfigured: false,
    websiteUrlConfigured: false,
    latestEntrataSyncAt: null,
  }
};

export const HEATMAP_SITE_DEFAULT_CONFIG = {
  id: '',
  name: '',
  siteKey: '',
  allowedDomains: [],
  trackingEnabled: false,
  samplingRate: 0.10,
  featureFlags: {
    heatmaps: true,
    pageSnapshots: true,
    screenshots: false,
  },
  screenshotCaptureFrequency: 'manual',
  consentMode: 'opt_out',
  respectDnt: true,
  screenshotMinIntervalHours: 24,
  rawEventRetentionDays: 90,
  aggregateRetentionDays: 730,
  notes: '',
};

export const normalizeHeatmapSiteConfig = (value) => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const featureFlags = safeValue.featureFlags && typeof safeValue.featureFlags === 'object'
    ? safeValue.featureFlags
    : {};
  const samplingRate = Number(safeValue.samplingRate ?? 0.10);
  const frequency = ['manual', 'daily', 'weekly'].includes(safeValue.screenshotCaptureFrequency)
    ? safeValue.screenshotCaptureFrequency
    : 'manual';
  const consentMode = ['opt_out', 'required', 'disabled'].includes(safeValue.consentMode)
    ? safeValue.consentMode
    : 'opt_out';
  const screenshotMinIntervalHours = Number(safeValue.screenshotMinIntervalHours ?? 24);
  const rawEventRetentionDays = Number(safeValue.rawEventRetentionDays ?? 90);
  const aggregateRetentionDays = Number(safeValue.aggregateRetentionDays ?? 730);
  return {
    ...HEATMAP_SITE_DEFAULT_CONFIG,
    id: String(safeValue.id || ''),
    name: String(safeValue.name || ''),
    siteKey: String(safeValue.siteKey || ''),
    allowedDomains: Array.isArray(safeValue.allowedDomains)
      ? safeValue.allowedDomains.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    trackingEnabled: Boolean(safeValue.trackingEnabled),
    samplingRate: Number.isFinite(samplingRate) ? Math.max(0, Math.min(1, samplingRate)) : 0.10,
    featureFlags: {
      heatmaps: featureFlags.heatmaps !== false,
      pageSnapshots: featureFlags.pageSnapshots !== false,
      screenshots: featureFlags.screenshots === true,
    },
    screenshotCaptureFrequency: frequency,
    consentMode,
    respectDnt: safeValue.respectDnt !== false,
    screenshotMinIntervalHours: Number.isFinite(screenshotMinIntervalHours)
      ? Math.max(1, Math.min(720, screenshotMinIntervalHours))
      : 24,
    rawEventRetentionDays: Number.isFinite(rawEventRetentionDays)
      ? Math.max(1, Math.min(365, rawEventRetentionDays))
      : 90,
    aggregateRetentionDays: Number.isFinite(aggregateRetentionDays)
      ? Math.max(30, Math.min(3650, aggregateRetentionDays))
      : 730,
    notes: String(safeValue.notes || ''),
  };
};

export const WEBSITE_MANAGER_TOKEN_DEFINITIONS = [
  { token: 'property_name', label: 'Property name' },
  { token: 'city', label: 'City' },
  { token: 'state', label: 'State' },
  { token: 'property_id', label: 'Property ID' }
];

export const normalizeWebsiteManagerRecord = (value) => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const normalizedSchema = normalizeWebsiteManagerSchema(safeValue.schema);
  const defaultContent = buildWebsiteManagerDefaultContent(normalizedSchema);
  const safeContent = safeValue.content && typeof safeValue.content === 'object' ? safeValue.content : {};

  return {
    platform: safeValue.platform || WEBSITE_MANAGER_DEFAULT_RECORD.platform,
    websiteUrl: safeValue.websiteUrl || '',
    wordpressSiteKey: safeValue.wordpressSiteKey || '',
    notes: safeValue.notes || '',
    schema: normalizedSchema,
    content: {
      ...defaultContent,
      ...safeContent
    },
    derivedContent: {
      ...WEBSITE_MANAGER_DEFAULT_RECORD.derivedContent,
      ...(safeValue.derivedContent && typeof safeValue.derivedContent === 'object' ? safeValue.derivedContent : {})
    },
    wordpressSync: {
      ...WEBSITE_MANAGER_DEFAULT_RECORD.wordpressSync,
      ...(safeValue.wordpressSync && typeof safeValue.wordpressSync === 'object' ? safeValue.wordpressSync : {})
    },
  };
};

export const getWebsiteManagerFieldGroups = (schema) => normalizeWebsiteManagerSchema(schema).groups;

export const getWebsiteManagerFieldTokenDefinitions = (schema) => (
  getWebsiteManagerFieldGroups(schema).flatMap((group) => (
    group.fields.map((field) => ({
      token: field.key,
      label: field.label,
      type: field.type,
      groupLabel: group.label,
    }))
  ))
);

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
