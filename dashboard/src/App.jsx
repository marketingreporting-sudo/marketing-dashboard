import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  ADMIN_ACCESS_USERS_URL,
  ADMIN_PROPERTIES_URL,
  ADMIN_TICKET_ASSIGNMENTS_URL,
  CLIENT_REPORT_BASE_DOMAIN,
  GA4_DASHBOARD_URL,
  GOOGLE_ADS_DASHBOARD_URL,
  LOCAL_FALCON_DASHBOARD_URL,
  HEATMAP_SITES_URL,
  HEATMAP_TRACKER_URL,
  META_ADS_DASHBOARD_URL,
  PROPERTY_REPORTING_OVERVIEW_URL,
  RECOMMENDATIONS_BASE_URL,
  RECOMMENDATIONS_GENERATE_URL,
  RENDER_API_BASE_URL,
  REPORTING_TAB_SUMMARY_URL,
  REPUTATION_DASHBOARD_URL,
  ROI_PIPELINE_STATUS_URL,
  TICKET_OPTIONS_URL,
  TICKETS_BASE_URL,
  WEBSITE_MANAGER_SCHEMA_URL,
  WEBSITE_MANAGER_URL
} from './apiConfig';
import { authFetch } from './lib/authFetch';
import { supabase } from './lib/supabase';
import { OPINIION_SKIPPED_PROPERTY_IDS } from './opiniionLocationMap';
import {
  DEFAULT_TAB_ORDER,
  REPORTING_LAYOUT_EDIT_PERMISSION,
  TAB_PERMISSIONS,
  WEBSITE_MANAGER_EDIT_PERMISSION
} from './access/accessModel';
import { useAccess } from './access/useAccess';
import {
  WEBSITE_MANAGER_DEFAULT_RECORD,
  WEBSITE_MANAGER_DEFAULT_SCHEMA,
  HEATMAP_SITE_DEFAULT_CONFIG,
  WEBSITE_MANAGER_TOKEN_DEFINITIONS,
  getWebsiteManagerFieldGroups,
  getWebsiteManagerFieldTokenDefinitions,
  getWebsitePlatformMeta,
  isWebsiteManagerEditable,
  normalizeHeatmapSiteConfig,
  normalizeWebsiteManagerRecord,
  normalizeWebsiteManagerSchema,
  resolveMustacheTokens
} from './websiteManager';
import loaderMark from './assets/redstone_logo_loader.svg';
import { 
  LayoutDashboard, 
  FileText, 
  ClipboardList, 
  PhoneCall,
  ChevronDown, 
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  Camera,
  Users,
  Home,
  TrendingUp,
  DollarSign,
  FileCheck,
  Lightbulb,
  MessageSquareText,
  Globe,
  Mail,
  Copy,
  Check,
  KeyRound,
  UserRound,
  X,
  Plus,
  Ticket,
  Trash2,
  Save,
  AlertTriangle,
} from 'lucide-react';
const AnalyticsView = React.lazy(() => import('./AnalyticsView.jsx'));
const AuditView = React.lazy(() => import('./AuditView.jsx'));
const DashboardView = React.lazy(() => import('./DashboardView.jsx'));
const CallPrepView = React.lazy(() => import('./CallPrepView.jsx'));
const PropertyInfoView = React.lazy(() => import('./PropertyInfoView.jsx'));
const ReputationView = React.lazy(() => import('./ReputationView.jsx'));
const ReportsView = React.lazy(() => import('./ReportsView.jsx'));

const PERFORMANCE_MARKETING_GL_CODES = new Set(['5300-0030', '5300-0210']);
const ALL_MARKETING_GL_CODES = new Set([
  '5300-0010',
  '5300-0030',
  '5300-0210',
  '5300-0320',
  '5300-0330',
  '5300-0400',
  '5300-0410'
]);
const PERFORMANCE_MARKETING_DESCRIPTIONS = [
  'internet advertising',
  'ppc management fees'
];
const ALL_MARKETING_DESCRIPTIONS = [
  'general advertising & marketing',
  'internet advertising',
  'ppc management fees',
  'seo',
  'reputation management',
  'social media management',
  'website expense'
];

const APPLICATION_EVENT_TYPE_IDS = new Set([12]);
const LEASE_EVENT_TYPE_IDS = new Set([13]);
const STATUS_CHANGE_EVENT_TYPE_ID = 21;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dashboardSidebarCollapsed';
const ALL_PROPERTIES_OPTION = '__all__';
const DASHBOARD_WORKSPACE_STATE_KEY_PREFIX = 'dashboardWorkspaceState';
const WEBSITE_SCHEMA_HISTORY_STORAGE_KEY_PREFIX = 'websiteSchemaHistory';
const AUDIT_FINDING_WORKFLOW_STORAGE_KEY_PREFIX = 'auditFindingWorkflowState';
const DATE_RANGE_OPTIONS = new Set(['7d', '14d', '28d', '30d', '90d', '365d', 'lastMonth', 'quarterToDate', 'yearToDate', 'custom']);
const META_ADS_ATTRIBUTION_MODES = new Set(['account_default', '7d_click_1d_view', '1d_click']);
const RECOMMENDATION_FEEDBACK_TAGS = [
  'Wrong data',
  'Too generic',
  'Already done',
  'Good idea',
  'Not actionable',
  'Duplicate',
  'Needs budget approval',
  'Worked',
  'Did not work',
];
const RECOMMENDATION_IMPLEMENTATION_LABELS = {
  not_started: 'New',
  approved: 'Approved',
  task_created: 'Task Created',
  in_progress: 'In Progress',
  complete: 'Completed',
  worked: 'Worked',
  did_not_move_metric: 'Did Not Move Metric',
  inconclusive: 'Inconclusive',
};
const buildSetPasswordLink = (authLinkPayload, type) => {
  const tokenHash = authLinkPayload?.hashedToken;
  if (!tokenHash) {
    return authLinkPayload?.actionLink || '';
  }

  const url = new URL('/set-password', window.location.origin);
  url.searchParams.set('token_hash', tokenHash);
  url.searchParams.set('type', type);
  return url.toString();
};
const HEATMAP_DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet'];
const AUDIT_TABLE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical' },
  { id: 'no-audit', label: 'No audit' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'application', label: 'Application' },
  { id: 'specials', label: 'Specials' },
  { id: 'broken-links', label: 'Broken links' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'stale-copy', label: 'Stale copy' },
];
const AUDIT_REVIEW_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'rubric', label: 'Rubric' },
  { id: 'screenshot', label: 'Screenshot' },
  { id: 'workflow', label: 'Workflow' },
];
const AUDIT_RISK_ORDER = {
  Critical: 5,
  High: 4,
  Watch: 3,
  Healthy: 2,
  'No audit': 1,
};
const AUDIT_RUBRIC_ITEMS = [
  { key: 'page_load_desktop_mobile', label: 'Desktop/mobile load' },
  { key: 'application_flow_visible', label: 'Application flow' },
  { key: 'floor_plan_availability', label: 'Floor plan availability' },
  { key: 'pricing_accuracy', label: 'Pricing accuracy' },
  { key: 'homepage_cta', label: 'Homepage CTA' },
  { key: 'homepage_value_add', label: 'Homepage value-add' },
  { key: 'special_offers_current', label: 'Special offers' },
  { key: 'leasing_verbiage', label: 'Leasing verbiage' },
  { key: 'contact_info_hours', label: 'Contact info/hours' },
];
const AUDIT_RUBRIC_FALLBACK_MAP = {
  page_load_desktop_mobile: 'performanceProxy',
  application_flow_visible: 'ctaClarity',
  floor_plan_availability: 'pageStructure',
  pricing_accuracy: 'pageStructure',
  homepage_cta: 'ctaClarity',
  homepage_value_add: 'seoBasics',
  special_offers_current: 'staleDates',
  leasing_verbiage: 'seoBasics',
  contact_info_hours: 'pageStructure',
};
const AUDIT_FINDING_WORKFLOW_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'fixed', label: 'Fixed' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'needs_manual_qa', label: 'Needs manual QA' },
];
const TASK_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'awaiting_approval', label: 'Awaiting Approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'complete', label: 'Complete' },
];
const TASK_STATUS_IDS = TASK_STATUSES.map((status) => status.id);
const TICKET_PRIORITIES = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High' },
  { id: 'urgent', label: 'Urgent' },
];
const TICKET_PRIORITY_IDS = TICKET_PRIORITIES.map((priority) => priority.id);
const TICKET_CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'reporting', label: 'Reporting' },
  { id: 'website', label: 'Website' },
  { id: 'ads', label: 'Ads' },
  { id: 'reputation', label: 'Reputation' },
  { id: 'resident_experience', label: 'Resident Experience' },
  { id: 'urgent_support', label: 'Urgent Support' },
];
const TICKET_CATEGORY_IDS = TICKET_CATEGORIES.map((category) => category.id);
const MARKETING_BUDGET_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'past', label: 'Past' },
];
const MARKETING_BUDGET_STATUS_IDS = MARKETING_BUDGET_STATUSES.map((status) => status.id);
const MARKETING_BUDGET_STATUS_ORDER = Object.fromEntries(
  MARKETING_BUDGET_STATUSES.map((status, index) => [status.id, index])
);
const LOCKED_MARKETING_BUDGET_FIELDS = new Set(['itemName', 'startDate', 'endDate', 'monthlyAmount']);
const MARKETING_BUDGET_SELECT_COLUMNS = [
  'id',
  'property_id',
  'status',
  'item_name',
  'monthly_amount',
  'start_date',
  'end_date',
  'listing_url',
  'contract_file_name',
  'contract_storage_path',
  'contract_mime_type',
  'notes',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by'
].join(', ');
const WEBSITE_SCHEMA_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const WEBSITE_SCHEMA_FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'richtext', label: 'Rich text' },
  { value: 'url', label: 'URL' },
];
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: TAB_PERMISSIONS.dashboard },
  { id: 'website manager', label: 'Website Editor', icon: Globe, permission: TAB_PERMISSIONS['website manager'] },
  { id: 'property info', label: 'Property Info', icon: Home, permission: TAB_PERMISSIONS['property info'] },
  { id: 'reports', label: 'Reports', icon: FileText, permission: TAB_PERMISSIONS.reports },
  { id: 'call prep', label: 'Call Prep', icon: PhoneCall, permission: TAB_PERMISSIONS['call prep'] },
  { id: 'recommendations', label: 'Recommendations', icon: Lightbulb, permission: TAB_PERMISSIONS.recommendations },
  { id: 'audit', label: 'Audit', icon: AlertTriangle, permission: TAB_PERMISSIONS.audit },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp, permission: TAB_PERMISSIONS.analytics },
  { id: 'reputation', label: 'Reputation', icon: MessageSquareText, permission: TAB_PERMISSIONS.reputation },
  { id: 'tickets', label: 'Tickets', icon: Ticket, permission: TAB_PERMISSIONS.tickets },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList, permission: TAB_PERMISSIONS.tasks },
  { id: 'red-list', label: 'Red List', icon: AlertTriangle, permission: TAB_PERMISSIONS['red-list'] },
  { id: 'admin', label: 'Admin', icon: Users, permission: TAB_PERMISSIONS.admin }
];
const ADMIN_SECTIONS = [
  { id: 'users', label: 'Users' },
  { id: 'properties', label: 'Properties' },
  { id: 'ticket-routing', label: 'Assignments' },
  { id: 'website-schema', label: 'Website Schema' },
  { id: 'audit-log', label: 'Audit Log' },
];
const ADMIN_PROPERTY_DRAFT_DEFAULTS = {
  propertyId: '',
  name: '',
  city: '',
  state: '',
  googleAnalyticsId: '',
  googleAdsId: '',
  localFalconLocationId: '',
  metaAdsAccountId: '',
  opiniionLocationId: '',
  marketingAccountManager: '',
  regionalManager: '',
  vicePresidentOperations: '',
  portfolio: '',
  newPortfolio: '',
  client: '',
  newClient: '',
  websiteType: 'entrata',
  websiteUrl: '',
  propertyType: 'student',
  legalEntity: '',
  entrataApiAccess: false,
};
const RED_LIST_SECTIONS = [
  { id: 'student', label: 'Student Properties' },
  { id: 'conventional', label: 'Conventional Properties' },
  { id: 'lead-deficit', label: 'Lead Deficit Details' },
];
const MONTH_INDEX_BY_NAME = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

const CHART_TOOLTIP_STYLE = {
  background: 'var(--panel-deep)',
  border: '1px solid var(--panel-border)',
  color: 'var(--primary-white)',
  borderRadius: 0,
  boxShadow: 'none',
  padding: '0.75rem 0.85rem'
};

const CHART_TOOLTIP_LABEL_STYLE = {
  color: 'var(--primary-tan)',
  fontSize: '0.68rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '0.3rem'
};

const CHART_TOOLTIP_ITEM_STYLE = {
  color: 'var(--primary-white)',
  fontSize: '0.8rem',
  padding: 0
};

const CHART_COLOR_TAN = '#D7D2CF';
const CHART_COLOR_SECONDARY_TAN = '#B8AA9B';
const CHART_COLOR_GREEN = '#57886C';
const CHART_COLOR_PINK = '#E56870';
const CHART_COLOR_GOLD = '#EE8413';
const CHART_COLOR_ORANGE = '#FF6416';
const CHART_GRID_DARK = 'rgba(215, 210, 207, 0.16)';
const CHART_AXIS_DARK = 'rgba(215, 210, 207, 0.62)';
const CHART_AXIS_DARK_SOFT = 'rgba(215, 210, 207, 0.4)';
const CHART_GRID_LIGHT = 'rgba(16, 33, 38, 0.12)';
const CHART_AXIS_LIGHT = 'rgba(16, 33, 38, 0.58)';
const CHART_AXIS_LIGHT_SOFT = 'rgba(16, 33, 38, 0.3)';
const CHART_MARGIN_STANDARD = { top: 8, right: 12, left: 0, bottom: 20 };
const CHART_MARGIN_TALL = { top: 8, right: 12, left: 0, bottom: 24 };
const CHART_MARGIN_VERTICAL = { top: 8, right: 12, left: 8, bottom: 10 };

const slugifyWebsiteSchemaKey = (value, fallback = 'new_field') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  const withLetterStart = normalized.replace(/^[^a-z]+/, '');
  return withLetterStart || fallback;
};

const getUniqueWebsiteSchemaKey = (groups, seed) => {
  const existingKeys = new Set(
    (Array.isArray(groups) ? groups : []).flatMap((group) => (
      Array.isArray(group?.fields) ? group.fields.map((field) => field.key) : []
    ))
  );
  const baseKey = slugifyWebsiteSchemaKey(seed);
  if (!existingKeys.has(baseKey)) return baseKey;
  let suffix = 2;
  while (existingKeys.has(`${baseKey}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseKey}_${suffix}`;
};

const getWebsiteSchemaValidationIssues = (schema) => {
  const issues = [];
  const fieldCounts = new Map();
  const groups = Array.isArray(schema?.groups) ? schema.groups : [];

  groups.forEach((group) => {
    (Array.isArray(group?.fields) ? group.fields : []).forEach((field) => {
      const key = String(field?.key || '').trim();
      if (!key) return;
      fieldCounts.set(key, (fieldCounts.get(key) || 0) + 1);
    });
  });

  groups.forEach((group, groupIndex) => {
    const groupLabel = String(group?.label || '').trim() || `Group ${groupIndex + 1}`;
    const fields = Array.isArray(group?.fields) ? group.fields : [];
    if (!String(group?.label || '').trim()) {
      issues.push(`${groupLabel} needs a group label.`);
    }
    if (fields.length === 0) {
      issues.push(`${groupLabel} needs at least one field.`);
    }
    fields.forEach((field, fieldIndex) => {
      const fieldLabel = String(field?.label || '').trim() || `Field ${fieldIndex + 1}`;
      const key = String(field?.key || '').trim();
      if (!String(field?.label || '').trim()) {
        issues.push(`${groupLabel}: ${fieldLabel} needs a label.`);
      }
      if (!WEBSITE_SCHEMA_FIELD_KEY_PATTERN.test(key)) {
        issues.push(`${groupLabel}: ${fieldLabel} key must start with a letter and use only lowercase letters, numbers, and underscores.`);
      }
      if ((fieldCounts.get(key) || 0) > 1) {
        issues.push(`${groupLabel}: ${key} is duplicated.`);
      }
      if (!WEBSITE_SCHEMA_FIELD_TYPES.some((type) => type.value === field?.type)) {
        issues.push(`${groupLabel}: ${fieldLabel} has an unsupported type.`);
      }
    });
  });

  return Array.from(new Set(issues));
};

const flattenWebsiteSchemaFields = (schema) => {
  const fields = new Map();
  (Array.isArray(schema?.groups) ? schema.groups : []).forEach((group) => {
    (Array.isArray(group?.fields) ? group.fields : []).forEach((field) => {
      if (!field?.key) return;
      fields.set(field.key, {
        ...field,
        groupLabel: group.label || 'Untitled group',
      });
    });
  });
  return fields;
};

const describeWebsiteSchemaChanges = (beforeSchema, afterSchema) => {
  const beforeFields = flattenWebsiteSchemaFields(beforeSchema);
  const afterFields = flattenWebsiteSchemaFields(afterSchema);
  const changes = [];

  afterFields.forEach((field, key) => {
    const previous = beforeFields.get(key);
    if (!previous) {
      changes.push(`Added ${field.label || key} (${key}) to ${field.groupLabel}.`);
      return;
    }
    const changedParts = [];
    if ((previous.label || '') !== (field.label || '')) changedParts.push('label');
    if ((previous.type || '') !== (field.type || '')) changedParts.push('type');
    if ((previous.placeholder || '') !== (field.placeholder || '')) changedParts.push('placeholder');
    if ((previous.groupLabel || '') !== (field.groupLabel || '')) changedParts.push('group');
    if (changedParts.length) {
      changes.push(`Updated ${field.label || key} (${key}): ${changedParts.join(', ')}.`);
    }
  });

  beforeFields.forEach((field, key) => {
    if (!afterFields.has(key)) {
      changes.push(`Removed ${field.label || key} (${key}) from ${field.groupLabel}.`);
    }
  });

  return changes;
};

const getWebsiteSchemaHistoryStorageKey = (propertyId) => `${WEBSITE_SCHEMA_HISTORY_STORAGE_KEY_PREFIX}:${propertyId || 'none'}`;

const readWebsiteSchemaHistory = (propertyId) => {
  if (typeof window === 'undefined' || !propertyId) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getWebsiteSchemaHistoryStorageKey(propertyId)) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
};

const getHostnameFromUrl = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text.includes('://') ? text : `https://${text}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const toDomainText = (domains) => (Array.isArray(domains) ? domains.join('\n') : '');

const parseDomainText = (value) => (
  String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .filter(Boolean)
);

const toClientReportSlug = (value) => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
);

const getPropertyReportSlug = (property) => (
  toClientReportSlug(property?.orgSlug || property?.name || property?.propertyId)
);

const normalizeAdminAssignmentDraft = (assignment = {}) => ({
  defaultAssigneeUserId: assignment.defaultAssigneeUserId || assignment.default_assignee_user_id || '',
  regionalUserId: assignment.regionalUserId || assignment.regional_user_id || '',
  clientGroupPortfolio: assignment.clientGroupPortfolio || assignment.client_group_portfolio || '',
});

const formatPortfolioLabel = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'Unassigned';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const propertyMatchesReportSlug = (property, slug) => {
  const normalizedSlug = toClientReportSlug(slug);
  if (!property || !normalizedSlug) return false;

  return [
    property.propertyId,
    property.name,
    property.orgSlug,
    getPropertyReportSlug(property),
  ].some((candidate) => toClientReportSlug(candidate) === normalizedSlug);
};

const buildClientReportLink = (property) => {
  if (typeof window === 'undefined') return '';

  const slug = getPropertyReportSlug(property);
  if (!slug) return '';

  if (CLIENT_REPORT_BASE_DOMAIN) {
    const protocol = window.location.protocol === 'http:' ? 'http:' : 'https:';
    return `${protocol}//${slug}.${CLIENT_REPORT_BASE_DOMAIN}/`;
  }

  return `${window.location.origin}/reports/${slug}`;
};

const buildManualTrackerSnippet = (siteKey) => {
  if (!siteKey || !HEATMAP_TRACKER_URL) return '';
  const separator = HEATMAP_TRACKER_URL.includes('?') ? '&' : '?';
  return `<script async id="redstone-tracker" data-redstone-tracker="1" src="${HEATMAP_TRACKER_URL}${separator}site_key=${encodeURIComponent(siteKey)}"></script>`;
};

const writeWebsiteSchemaHistory = (propertyId, history) => {
  if (typeof window === 'undefined' || !propertyId) return;
  window.localStorage.setItem(
    getWebsiteSchemaHistoryStorageKey(propertyId),
    JSON.stringify(Array.isArray(history) ? history.slice(0, 12) : [])
  );
};

const PROFILE_AVATAR_BUCKET = 'profile-avatars';
const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AVATAR_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MARKETING_BUDGET_CONTRACT_BUCKET = 'property-marketing-contracts';
const MARKETING_BUDGET_CONTRACT_MAX_BYTES = 15 * 1024 * 1024;
const MARKETING_BUDGET_CONTRACT_ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const getDashboardWorkspaceStateKey = (user) => {
  const accountId = user?.id || user?.email || 'anonymous';
  return `${DASHBOARD_WORKSPACE_STATE_KEY_PREFIX}:${accountId}`;
};

const getAuditFindingWorkflowStorageKey = (user) => {
  const accountId = user?.id || user?.email || 'anonymous';
  return `${AUDIT_FINDING_WORKFLOW_STORAGE_KEY_PREFIX}:${accountId}`;
};

const readDashboardWorkspaceState = (storageKey) => {
  if (typeof window === 'undefined' || !storageKey) return {};

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const isDateInputValue = (value) => (
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
);

const normalizeSavedDashboardState = (savedState, fallbackPropertyId) => {
  const nextState = savedState && typeof savedState === 'object' ? savedState : {};
  const customRange = nextState.customRange && typeof nextState.customRange === 'object'
    ? nextState.customRange
    : {};
  const savedTab = nextState.activeTab === 'notes' ? 'tasks' : nextState.activeTab;
  const excludedMarketingSpendKeys = Array.isArray(nextState.excludedMarketingSpendKeys)
    ? nextState.excludedMarketingSpendKeys
        .map((item) => String(item))
        .filter(Boolean)
    : [];

  return {
    activeTab: NAV_ITEMS.some((item) => item.id === savedTab) ? savedTab : 'dashboard',
    dateRange: DATE_RANGE_OPTIONS.has(nextState.dateRange) ? nextState.dateRange : '28d',
    customRange: {
      start: isDateInputValue(customRange.start) ? customRange.start : null,
      end: isDateInputValue(customRange.end) ? customRange.end : null,
    },
    selectedPropertyId: nextState.selectedPropertyId ? String(nextState.selectedPropertyId) : fallbackPropertyId,
    metaAdsAttributionMode: META_ADS_ATTRIBUTION_MODES.has(nextState.metaAdsAttributionMode)
      ? nextState.metaAdsAttributionMode
      : 'account_default',
    excludedMarketingSpendKeys,
  };
};

const getDefaultCustomRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 27);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return {
    start: formatDateInputValue(start),
    end: formatDateInputValue(end),
  };
};

const getInitials = (value) => {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'R';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
};

const getFileExtension = (filename, mimeType) => {
  const lastDot = String(filename || '').lastIndexOf('.');
  if (lastDot >= 0) {
    return String(filename).slice(lastDot + 1).toLowerCase();
  }
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
};

const MeasuredChart = ({ className, fixedHeight = null, children }) => {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      const nextWidth = Math.max(0, Math.floor(node.clientWidth));
      const nextHeight = Math.max(0, Math.floor(fixedHeight ?? node.clientHeight));
      setSize((previous) => (
        previous.width === nextWidth && previous.height === nextHeight
          ? previous
          : { width: nextWidth, height: nextHeight }
      ));
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(node);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [fixedHeight]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={fixedHeight == null ? undefined : { '--measured-chart-height': `${fixedHeight}px` }}
    >
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
};

const collectPrimitiveValues = (value) => {
  if (Array.isArray(value)) {
    return value.flatMap(collectPrimitiveValues);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectPrimitiveValues);
  }
  return value == null ? [] : [String(value)];
};

const parseCurrency = (value) => {
  if (value == null || value === '') return 0;
  const normalized = String(value).replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseNumber = (value) => {
  if (value == null || value === '') return null;
  const normalized = String(value).replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBooleanish = (value) => {
  if (typeof value === 'boolean') return value;
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return null;
};

const parseEntrataDate = (value) => {
  if (!value) return null;
  const normalized = String(value).trim();
  const dateToken = normalized.match(/\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/)?.[0];
  if (!dateToken) return null;
  let parts = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateToken)) {
    parts = dateToken.split('-');
  } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateToken)) {
    parts = dateToken.split('/');
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateToken)) {
    const [month, day, year] = dateToken.split('/');
    parts = [year, month, day];
  }

  if (!parts) return null;

  const [year, month, day] = parts.map((part) => Number.parseInt(part, 10));
  if (![year, month, day].every(Number.isFinite)) return null;

  return new Date(year, month - 1, day);
};

const parseLocalDateInputValue = (value) => {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  return parseEntrataDate(value);
};

const formatReadableDate = (value) => {
  const parsed = value instanceof Date ? value : parseEntrataDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatReadableDateTime = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatDateInputValue = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateTimeLocalInputValue = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getMinimumTicketDueDateTimeValue = () => {
  const minimum = new Date(Date.now() + (24 * 60 * 60 * 1000) + (5 * 60 * 1000));
  minimum.setSeconds(0, 0);
  return formatDateTimeLocalInputValue(minimum);
};

const matchesSearch = (values, search) => {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || '').toLowerCase().includes(query));
};

const normalizeTaskRecord = (row) => {
  const status = TASK_STATUS_IDS.includes(row?.status) ? row.status : 'new';
  return {
    id: row?.id || '',
    ownerUserId: row?.owner_user_id || '',
    title: row?.title || '',
    description: row?.description || '',
    notes: row?.notes || '',
    dueDate: row?.due_date || '',
    status,
    propertyId: row?.property_id == null ? '' : String(row.property_id),
    ticketId: row?.ticket_id || '',
    source: row?.source || 'manual',
    priority: row?.priority || 'normal',
    requesterEmail: row?.requester_email || '',
    createdAt: row?.created_at || '',
    updatedAt: row?.updated_at || '',
  };
};

const createEmptyTaskDraft = (propertyId = '') => ({
  title: '',
  description: '',
  notes: '',
  dueDate: '',
  status: 'new',
  propertyId: propertyId || '',
});

const normalizeTicketRecord = (row) => {
  const status = TASK_STATUS_IDS.includes(row?.status) ? row.status : 'new';
  const priority = TICKET_PRIORITY_IDS.includes(row?.priority) ? row.priority : 'normal';
  const category = TICKET_CATEGORY_IDS.includes(row?.category) ? row.category : 'general';
  return {
    id: row?.id || '',
    taskId: row?.taskId || row?.task_id || '',
    propertyId: row?.propertyId || row?.property_id || '',
    requesterUserId: row?.requesterUserId || row?.requester_user_id || '',
    requesterEmail: row?.requesterEmail || row?.requester_email || '',
    submittedByUserId: row?.submittedByUserId || row?.submitted_by_user_id || '',
    submittedByEmail: row?.submittedByEmail || row?.submitted_by_email || '',
    submittedByName: row?.submittedByName || '',
    assignedUserId: row?.assignedUserId || row?.assigned_user_id || '',
    assignedUserName: row?.assignedUserName || '',
    source: row?.source || 'dashboard_form',
    category,
    priority,
    status,
    title: row?.title || '',
    description: row?.description || '',
    dueAt: row?.dueAt || row?.due_at || '',
    emailSubject: row?.emailSubject || row?.email_subject || '',
    emailFrom: row?.emailFrom || row?.email_from || '',
    emailExcerpt: row?.emailExcerpt || row?.email_excerpt || '',
    createdAt: row?.createdAt || row?.created_at || '',
    updatedAt: row?.updatedAt || row?.updated_at || '',
  };
};

const createEmptyTicketDraft = (propertyId = '', requesterEmail = '') => ({
  title: '',
  description: '',
  propertyId: propertyId || '',
  requesterEmail: requesterEmail || '',
  assignedUserId: '',
  dueAt: getMinimumTicketDueDateTimeValue(),
  category: 'general',
  priority: 'normal',
  status: 'new',
});

const normalizeMarketingBudgetRecord = (row) => {
  const status = MARKETING_BUDGET_STATUS_IDS.includes(row?.status) ? row.status : 'new';
  return {
    id: row?.id || '',
    propertyId: row?.property_id || '',
    status,
    itemName: row?.item_name || '',
    monthlyAmount: row?.monthly_amount == null ? '' : String(row.monthly_amount),
    startDate: row?.start_date || '',
    endDate: row?.end_date || '',
    listingUrl: row?.listing_url || '',
    contractFileName: row?.contract_file_name || '',
    contractStoragePath: row?.contract_storage_path || '',
    contractMimeType: row?.contract_mime_type || '',
    notes: row?.notes || '',
    createdAt: row?.created_at || '',
    updatedAt: row?.updated_at || '',
  };
};

const createEmptyMarketingBudgetDraft = (propertyId = '') => ({
  id: '',
  propertyId: propertyId || '',
  status: 'new',
  itemName: '',
  monthlyAmount: '',
  startDate: formatDateInputValue(new Date()),
  endDate: '',
  listingUrl: '',
  contractFileName: '',
  contractStoragePath: '',
  contractMimeType: '',
  notes: '',
  contractFile: null,
});

const getSafeStorageFilename = (filename) => (
  String(filename || 'contract')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'contract'
);

const createMarketingBudgetContractPath = (propertyId, budgetItemId, file) => {
  const safeName = getSafeStorageFilename(file?.name);
  return `${propertyId}/${budgetItemId}/${Date.now()}-${safeName}`;
};

const normalizeExternalUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const parseEntrataPostMonth = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/^([A-Za-z]{3}),\s*(\d{4})$/);
  if (!match) return null;

  const monthIndex = MONTH_INDEX_BY_NAME[match[1].toLowerCase()];
  const year = Number.parseInt(match[2], 10);
  if (!Number.isFinite(monthIndex) || !Number.isFinite(year)) return null;

  return new Date(year, monthIndex, 1);
};

const getMonthRange = (date) => {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 999);
  return { monthStart, monthEnd };
};

const countInclusiveDays = (start, end) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
};

const getInvoiceAmount = (invoice) => {
  const detailAmounts = [invoice.debit, invoice.credit]
    .map((value) => parseCurrency(value))
    .filter((value) => value !== 0);

  if (detailAmounts.length > 0) {
    return Math.max(...detailAmounts.map((value) => Math.abs(value)));
  }

  const amountFields = [
    invoice.totalAmount,
    invoice.amount,
    invoice.invoiceAmount,
    invoice.total,
    invoice.amountDue,
    invoice.total_due,
    invoice.currentAmount
  ];

  for (const candidate of amountFields) {
    const amount = parseCurrency(candidate);
    if (amount !== 0) return Math.abs(amount);
  }

  return 0;
};

const getInvoiceBreakdownLabel = (invoice) => {
  const accountNumber = invoice.glAccount?.accountNumber;
  const accountName = invoice.glAccount?.accountName;
  const vendorName = invoice.vendorName || invoice.contract || invoice.vendorCode;

  const accountLabel = [accountNumber, accountName].filter(Boolean).join(' ');
  if (vendorName && accountLabel) return `${accountLabel} - ${vendorName}`;
  return accountLabel || vendorName || 'Unlabeled marketing cost';
};

const getMarketingSpendExclusionKey = (label) => String(label || 'Unlabeled marketing cost').trim().toLowerCase();

const isMarketingSpendLineExcluded = (label, excludedKeySet) => (
  excludedKeySet instanceof Set && excludedKeySet.has(getMarketingSpendExclusionKey(label))
);

const resolveRenderApiRoute = (path, fallbackUrl = '') => {
  if (RENDER_API_BASE_URL) return `${RENDER_API_BASE_URL}${path}`;
  return fallbackUrl;
};

const getInvoiceEffectiveDate = (invoice) => {
  return (
    parseEntrataDate(invoice.postDate) ||
    parseEntrataDate(invoice.transactionDate) ||
    parseEntrataDate(invoice.invoiceDate) ||
    parseEntrataDate(invoice._date)
  );
};

const getInvoiceKey = (invoice) => {
  const candidates = [
    invoice['@attributes']?.id,
    invoice.id,
    invoice.apDetailId,
    invoice.reference,
    invoice.memo
  ];
  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return String(stableId);
  return JSON.stringify(invoice);
};

const getInvoiceAllocationMonth = (invoice) => {
  const postMonthDate = parseEntrataPostMonth(invoice.postMonth);
  if (postMonthDate) {
    return getMonthRange(postMonthDate);
  }

  const effectiveDate = getInvoiceEffectiveDate(invoice);
  if (effectiveDate) {
    return getMonthRange(effectiveDate);
  }

  return null;
};

const getAllocatedInvoiceAmountInRange = (invoice, rangeStart, rangeEnd) => {
  const amount = getInvoiceAmount(invoice);
  if (amount === 0) return 0;

  const allocationMonth = getInvoiceAllocationMonth(invoice);
  if (!allocationMonth) return 0;

  const overlapStart = new Date(Math.max(allocationMonth.monthStart.getTime(), rangeStart.getTime()));
  const overlapEnd = new Date(Math.min(allocationMonth.monthEnd.getTime(), rangeEnd.getTime()));
  if (overlapStart > overlapEnd) return 0;

  const totalDaysInMonth = countInclusiveDays(allocationMonth.monthStart, allocationMonth.monthEnd);
  const overlapDays = countInclusiveDays(overlapStart, overlapEnd);
  return (amount / totalDaysInMonth) * overlapDays;
};

const getInvoiceGlCodes = (invoice) => {
  const searchSpace = collectPrimitiveValues(invoice).join(' ');
  const exactMatches = searchSpace.match(/\b\d{4}-\d{4}\b/g) || [];
  const compactMatches = searchSpace.match(/\b\d{8}\b/g) || [];
  const spacedMatches = searchSpace.match(/\b\d{4}\s\d{4}\b/g) || [];
  const normalized = [
    ...exactMatches,
    ...compactMatches.map((value) => `${value.slice(0, 4)}-${value.slice(4)}`),
    ...spacedMatches.map((value) => value.replace(' ', '-'))
  ];
  return [...new Set(normalized)];
};

const hasInvoiceClassification = (invoice, allowedCodes, allowedDescriptions) => {
  const codes = getInvoiceGlCodes(invoice);
  if (codes.some((code) => allowedCodes.has(code))) {
    return true;
  }

  const searchSpace = collectPrimitiveValues(invoice).join(' ').toLowerCase();
  return allowedDescriptions.some((description) => searchSpace.includes(description));
};

const getScopedStableKey = (propertyId, fallbackValue) => {
  const scope = propertyId != null && propertyId !== '' ? `${propertyId}:` : '';
  return `${scope}${String(fallbackValue)}`;
};

const normalizeLeadIdentityText = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeLeadIdentityPhone = (value) => {
  const digits = String(value ?? '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const getLeadKey = (lead) => {
  const eventIds = new Set(
    [lead.leadEventId, lead.eventId, lead.eventID]
      .map(normalizeLeadIdentityText)
      .filter(Boolean)
  );
  const idCandidates = [
    lead.leadId,
    lead.leadID,
    lead.prospectId,
    lead.prospectID,
    lead.customerId,
    lead.customerID,
    lead.applicationId,
    lead.applicationID,
    lead.prospect_leadId,
    lead.prospect_leadID,
    lead.prospect_prospectId,
    lead.prospect_prospectID,
    lead.prospect_customerId,
    lead.prospect_customerID,
    lead.prospect_applicationId
  ];

  const stableId = idCandidates.find((value) => {
    const normalized = normalizeLeadIdentityText(value);
    return normalized && !eventIds.has(normalized);
  });
  if (stableId) return getScopedStableKey(lead?._propertyId, `id:${normalizeLeadIdentityText(stableId)}`);

  const email = [
    lead.email,
    lead.emailAddress,
    lead.primaryEmail,
    lead.emailaddress,
    lead.prospectEmail,
    lead.guestCardEmail,
    lead.prospect_email,
    lead.prospect_emailAddress
  ].map(normalizeLeadIdentityText).find(Boolean);
  if (email) return getScopedStableKey(lead?._propertyId, `email:${email}`);

  const phone = [
    lead.phoneNumber,
    lead.primaryPhoneNumber,
    lead.mobilePhone,
    lead.phone,
    lead.phone_number,
    lead.prospect_phoneNumber,
    lead.prospect_primaryPhoneNumber,
    lead.prospect_mobilePhone
  ].map(normalizeLeadIdentityPhone).find(Boolean);
  if (phone) return getScopedStableKey(lead?._propertyId, `phone:${phone}`);

  const firstName = normalizeLeadIdentityText(lead.firstName || lead.firstname || lead.prospect_firstName || lead.prospect_firstname);
  const lastName = normalizeLeadIdentityText(lead.lastName || lead.lastname || lead.prospect_lastName || lead.prospect_lastname);
  if (firstName || lastName) return getScopedStableKey(lead?._propertyId, `name:${firstName}:${lastName}`);

  const eventId = [lead.leadEventId, lead.eventId, lead.eventID, lead.id].find((value) => value != null && value !== '');
  if (eventId) return getScopedStableKey(lead?._propertyId, `event:${eventId}`);
  return getScopedStableKey(lead?._propertyId, JSON.stringify(lead));
};

const getAvailabilityStatus = (unit) => {
  const attrs = unit?.['@attributes'] || {};
  const availableFlag = parseBooleanish(
    unit?.isAvailable ?? unit?.available ?? unit?.isavailable ?? unit?.isVacant ?? attrs.IsAvailable
  );
  if (availableFlag === true) return 'Available';
  if (availableFlag === false) return 'Unavailable';
  return unit?.availabilityStatus || unit?.status || unit?.leaseStatus || attrs.Availability || attrs.Status || 'Unknown';
};

const getAvailabilityDate = (unit) => {
  const attrs = unit?.['@attributes'] || {};
  return (
    unit?.availableOn ||
    unit?.availabilityDate ||
    unit?.availableDate ||
    unit?.availableFrom ||
    attrs.AvailableOn ||
    null
  );
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const getRoomCount = (roomItems, roomType) => {
  const match = ensureArray(roomItems).find((room) => String(room?.['@attributes']?.RoomType || '').toLowerCase() === roomType.toLowerCase());
  return match?.Count ?? null;
};

const getFloorplanPriceRange = (floorplan) => {
  const attrs = floorplan?.MarketRent?.['@attributes'] || {};
  return {
    min: parseNumber(attrs.Min),
    max: parseNumber(attrs.Max),
  };
};

const getFloorplanDepositRange = (floorplan) => {
  const attrs = floorplan?.Deposit?.Amount?.ValueRange?.['@attributes'] || {};
  return {
    min: parseNumber(attrs.Min),
    max: parseNumber(attrs.Max),
  };
};

const getPropertyUnitSpaces = (unit) => {
  const unitSpace = unit?.UnitSpace;
  if (!unitSpace || typeof unitSpace !== 'object') return [];
  return Object.values(unitSpace);
};

const getPropertyUnitPriceRange = (space) => {
  const attrs = space?.Rent?.['@attributes'] || {};
  return {
    min: parseNumber(attrs.MinRent),
    max: parseNumber(attrs.MaxRent),
  };
};

const findNestedValue = (value, candidateKeys) => {
  const normalizedKeys = new Set(candidateKeys.map((key) => String(key).toLowerCase()));

  const visit = (current) => {
    if (current == null) return null;
    if (Array.isArray(current)) {
      for (const item of current) {
        const found = visit(item);
        if (found != null && found !== '') return found;
      }
      return null;
    }
    if (typeof current === 'object') {
      for (const [key, nested] of Object.entries(current)) {
        if (normalizedKeys.has(String(key).toLowerCase()) && nested != null && nested !== '') {
          if (typeof nested === 'object') {
            const objectValue = visit(nested);
            if (objectValue != null && objectValue !== '') return objectValue;
          } else {
            return nested;
          }
        }
      }
      for (const nested of Object.values(current)) {
        const found = visit(nested);
        if (found != null && found !== '') return found;
      }
    }
    return null;
  };

  return visit(value);
};

const getSpecialTitle = (special) => {
  return (
    findNestedValue(special, [
      'specialName',
      'specialTitle',
      'marketingName',
      'headline',
      'title',
      'name',
      'label',
      'incentiveName'
    ]) ||
    'Untitled special'
  );
};

const getSpecialDescription = (special) => {
  return (
    findNestedValue(special, [
      'marketingDescription',
      'marketingText',
      'description',
      'details',
      'specialText',
      'internalDescription',
      'internalText',
      'body',
      'finePrint',
      'text'
    ]) ||
    ''
  );
};

const getSpecialDateRange = (special) => {
  const startDate = findNestedValue(special, ['startDate', 'activeFrom', 'effectiveStartDate', 'beginDate']);
  const endDate = findNestedValue(special, ['endDate', 'activeTo', 'effectiveEndDate', 'expirationDate']);
  const explicitRange = findNestedValue(special, ['activeDateRange', 'dateRange', 'activeRange']);
  const alwaysActive = findNestedValue(special, ['alwaysActive', 'isAlwaysActive']);

  if (explicitRange) {
    return String(explicitRange);
  }
  if (parseBooleanish(alwaysActive) === true) {
    return 'Always active';
  }
  if (startDate && endDate) {
    return `${formatReadableDate(startDate)} - ${formatReadableDate(endDate)}`;
  }
  if (startDate) {
    return `Starts ${formatReadableDate(startDate)}`;
  }
  if (endDate) {
    return `Ends ${formatReadableDate(endDate)}`;
  }
  return 'Date range not provided';
};

const extractSpecialItems = (snapshot) => {
  if (Array.isArray(snapshot?.specials)) {
    return snapshot.specials;
  }

  const groupedSpecials = snapshot?.specials?.propertySpecials?.special;
  if (groupedSpecials && typeof groupedSpecials === 'object') {
    return Object.values(groupedSpecials);
  }

  return [];
};

const getSnapshotTimestampLabel = (value) => {
  if (!value) return '—';
  if (typeof value?.toDate === 'function') {
    return value.toDate().toLocaleString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
};

const getEventContainerValue = (event, key) => {
  const value = event?.[key];
  if (!value) return null;
  if (typeof value !== 'object') return value;
  return (
    value.typeId ??
    value.type_id ??
    value.eventTypeId ??
    value.event_type_id ??
    value.id ??
    value.name ??
    value.label ??
    null
  );
};

const getEventReasonText = (event) => {
  const candidates = [
    event?.eventReason,
    event?.event_reason,
    typeof event?.type === 'string' ? event.type : null,
    typeof event?.eventType === 'string' ? event.eventType : null,
    typeof event?.event_type === 'string' ? event.event_type : null,
    findNestedValue(event?.type, ['eventReason', 'event_reason', 'name', 'label', 'description']),
    findNestedValue(event?.eventType, ['eventReason', 'event_reason', 'name', 'label', 'description']),
    findNestedValue(event?.event_type, ['eventReason', 'event_reason', 'name', 'label', 'description']),
    findNestedValue(event, ['eventReason', 'event_reason', 'eventTypeName', 'event_type_name', 'reason', 'name']),
  ];
  return String(candidates.find((value) => value != null && value !== '') || '')
    .toLowerCase()
    .replace(/\s*:\s*/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
};

const isStartedApplicationEvent = (event) => {
  const typeId = getEventTypeId(event);
  const reason = getEventReasonText(event);
  return (typeId == null || typeId === 12) && (
    reason.includes('application status:completed') ||
    reason.includes('application status completed') ||
    reason.includes('application status: completed') ||
    reason.includes('application: completed')
  );
};

const isApprovedNewLeaseEvent = (event) => {
  const typeId = getEventTypeId(event);
  const reason = getEventReasonText(event);
  return (typeId == null || typeId === 13) &&
    (reason.includes('lease status:approved') || reason.includes('lease status approved')) &&
    !reason.includes('renewal lease');
};

const TOUR_EVENT_TYPE_IDS = new Set([78, 9, 449, 442, 515]);

const getEventTypeId = (event) => {
  const candidates = [
    event?.typeId ??
      event?.type_id ??
      event?.eventTypeId ??
      event?.event_type_id,
    getEventContainerValue(event, 'eventType'),
    getEventContainerValue(event, 'event_type'),
    getEventContainerValue(event, 'type'),
    findNestedValue(event, ['typeId', 'type_id', 'eventTypeId', 'event_type_id']),
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const isTourEvent = (event) => {
  return TOUR_EVENT_TYPE_IDS.has(getEventTypeId(event));
};

const EVENT_OCCURRED_DATE_KEYS = [
  'eventDate',
  'event_date',
  'eventDateTime',
  'eventDatetime',
  'date',
  'timestamp',
  'createdAt',
  'created_at'
];

const isInDateRange = (date, start, end) => {
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
};

const getDaysBetweenDates = (start, end) => {
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / msPerDay));
};

const getStudentPreleaseCycle = (rangeEnd) => {
  const fallYear = rangeEnd.getMonth() >= 8 ? rangeEnd.getFullYear() + 1 : rangeEnd.getFullYear();
  return {
    cycleStart: new Date(fallYear - 1, 10, 10),
    fallStart: new Date(fallYear, 7, 15),
    fallWindowStart: new Date(fallYear, 7, 1),
    fallWindowEnd: new Date(fallYear, 10, 30),
  };
};

const getLeaseApprovalDate = (lease) => (
  parseEntrataDate(
    lease?.attribution_event_date ||
    lease?._date ||
    findNestedValue(lease, ['approvalDate', 'approvedDate', 'leaseApprovedDate', 'leaseSignedDate', 'signedDate', 'eventDate', 'date'])
  )
);

const getLeaseStartDate = (lease) => (
  parseEntrataDate(
    lease?.lease_start_date ||
    lease?.move_in_date ||
    findNestedValue(lease, ['leaseStartDate', 'lease_start_date', 'moveInDate', 'move_in_date', 'startDate'])
  )
);

const getLeaseEndDate = (lease) => (
  parseEntrataDate(
    lease?.lease_end_date ||
    lease?.move_out_date ||
    findNestedValue(lease, ['leaseEndDate', 'lease_end_date', 'moveOutDate', 'move_out_date', 'endDate'])
  )
);

const isLeaseActiveOnDate = (lease, date) => {
  const startDate = getLeaseStartDate(lease);
  const endDate = getLeaseEndDate(lease);
  if (!startDate || startDate > date) return false;
  if (endDate && endDate < date) return false;
  return true;
};

const filterUniqueActiveLeases = (leases, date, signedAsOf = date) => {
  const uniqueLeases = new Map();
  leases.forEach((lease) => {
    if (!isLeaseActiveOnDate(lease, date)) return;
    const approvalDate = getLeaseApprovalDate(lease);
    if (approvalDate && approvalDate > signedAsOf) return;
    const key = getApprovedLeaseRecordKey(lease);
    const existing = uniqueLeases.get(key);
    if (!existing || (approvalDate && approvalDate < existing.approvalDate)) {
      uniqueLeases.set(key, { lease, approvalDate: approvalDate || date });
    }
  });
  return Array.from(uniqueLeases.values());
};

const filterUniqueFallPreleaseLeases = (leases, cycle, rangeEnd) => {
  const uniqueLeases = new Map();
  leases.forEach((lease) => {
    const approvalDate = getLeaseApprovalDate(lease);
    if (!approvalDate || approvalDate < cycle.cycleStart || approvalDate > rangeEnd) return;
    const startDate = getLeaseStartDate(lease);
    if (!startDate || startDate < cycle.fallWindowStart || startDate > cycle.fallWindowEnd) return;
    const key = getApprovedLeaseRecordKey(lease);
    const existing = uniqueLeases.get(key);
    if (!existing || approvalDate < existing.approvalDate) {
      uniqueLeases.set(key, { lease, approvalDate, startDate });
    }
  });
  return Array.from(uniqueLeases.values());
};

const getCallPrepWindowRange = (days, offsetDays = 0) => {
  const end = new Date();
  end.setDate(end.getDate() - offsetDays);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
};

const getItemPropertyId = (item) => String(item?._propertyId ?? item?.property_id ?? item?.propertyId ?? '');

const getCallPrepDate = (value) => {
  const parsed = value instanceof Date ? value : parseEntrataDate(value);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

const getCompletedApplicationRecordKey = (record) => {
  const candidates = [
    record.application_id,
    record.applicationId,
    record.applicationID,
    record.lease_interval_id,
    record.leaseIntervalId,
    record.lease_id,
    record.leaseId,
    record.applicantId,
    record.applicantID,
    record.prospectId,
    record.prospectID,
    record.eventId,
    record.eventID,
    record.id
  ];

  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return getScopedStableKey(record?._propertyId ?? record?.property_id, stableId);
  return getScopedStableKey(record?._propertyId ?? record?.property_id, JSON.stringify(record));
};

const getApprovedLeaseRecordKey = (record) => {
  const candidates = [
    record.lease_interval_id,
    record.leaseIntervalId,
    record.lease_id,
    record.leaseId,
    record.leaseID,
    record.application_id,
    record.applicationId,
    record.applicationID,
    record.id
  ];

  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return getScopedStableKey(record?._propertyId ?? record?.property_id, stableId);
  return getScopedStableKey(record?._propertyId ?? record?.property_id, JSON.stringify(record));
};

const getTrueEventOccurredDate = (event) => parseEntrataDate(findNestedValue(event, EVENT_OCCURRED_DATE_KEYS) || event._date);

const getRecommendationConfidence = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return { label: 'Medium Confidence', className: 'recommendation-confidence--medium' };
  if (numeric >= 0.75) return { label: 'High Confidence', className: 'recommendation-confidence--high' };
  if (numeric >= 0.45) return { label: 'Medium Confidence', className: 'recommendation-confidence--medium' };
  return { label: 'Low Confidence', className: 'recommendation-confidence--low' };
};

const getRecommendationImplementationLabel = (recommendation) => {
  const status = recommendation?.implementationStatus || recommendation?.status || 'not_started';
  return RECOMMENDATION_IMPLEMENTATION_LABELS[status] || RECOMMENDATION_IMPLEMENTATION_LABELS.not_started;
};


const formatPercent = (value, digits = 1) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
};

const formatSignedPercent = (value, digits = 1) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value) * 100;
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(digits)}%`;
};

const formatCurrency = (value, digits = 0) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
};

const formatNumber = (value, digits = 0) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const formatDurationMs = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  const totalSeconds = Math.round(numeric / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const MiniMetricLoader = () => (
  <span className="mini-metric-loader" role="status" aria-label="Loading data">
    <img src={loaderMark} alt="" aria-hidden="true" />
  </span>
);

const renderMetricValue = (isLoading, value) => (
  isLoading ? <MiniMetricLoader /> : value
);

const AuditScoreSparkline = ({ points = [] }) => {
  const cleanPoints = points
    .map((point) => Number(point?.score))
    .filter((score) => Number.isFinite(score));
  if (cleanPoints.length < 2) {
    return <span className="audit-sparkline audit-sparkline--empty">No trend</span>;
  }
  const width = 112;
  const height = 34;
  const min = Math.min(50, ...cleanPoints);
  const max = Math.max(100, ...cleanPoints);
  const range = Math.max(1, max - min);
  const step = width / Math.max(1, cleanPoints.length - 1);
  const path = cleanPoints.map((score, index) => {
    const x = index * step;
    const y = height - ((score - min) / range) * height;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const latest = cleanPoints[cleanPoints.length - 1];
  const previous = cleanPoints[cleanPoints.length - 2];
  const tone = latest >= previous ? 'positive' : 'negative';
  return (
    <svg className={`audit-sparkline audit-sparkline--${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Score trend ${cleanPoints.join(', ')}`}>
      <path d={path} fill="none" />
      {cleanPoints.map((score, index) => {
        const x = index * step;
        const y = height - ((score - min) / range) * height;
        return <circle key={`${score}-${index}`} cx={x} cy={y} r={2.2} />;
      })}
    </svg>
  );
};

const getDeltaTone = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'neutral';
  if (Number(value) > 0) return 'positive';
  if (Number(value) < 0) return 'negative';
  return 'neutral';
};

const formatAuditScoreChange = (value) => {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const numeric = Number(value);
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(1)} pts`;
};

const getAuditRiskClass = (tier) => {
  const normalized = String(tier || '').toLowerCase().replace(/\s+/g, '-');
  return normalized || 'unknown';
};

const getAuditReasonText = (reason) => {
  if (!reason) return '';
  if (typeof reason === 'string') return reason;
  return reason.issue || reason.text || reason.evidence || '';
};

const normalizeAuditRubricStatus = (value, score) => {
  const status = String(value || '').toLowerCase().replace(/\s+/g, '_');
  if (['pass', 'warn', 'fail', 'not_verifiable'].includes(status)) return status;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return 'not_verifiable';
  if (numeric < 70) return 'fail';
  if (numeric < 85) return 'warn';
  return 'pass';
};

const getAuditRubricStatusLabel = (status) => ({
  pass: 'Pass',
  warn: 'Warn',
  fail: 'Fail',
  not_verifiable: 'Not verifiable',
}[status] || 'Not verifiable');

const getAuditFindingWorkflowLabel = (status) => (
  AUDIT_FINDING_WORKFLOW_STATUSES.find((item) => item.id === status)?.label || 'New'
);

const getAuditFindingKey = (propertyId, reason, index = 0) => {
  const signature = [
    propertyId || 'property',
    reason?.rubricKey || reason?.category || 'finding',
    reason?.path || '',
    reason?.issue || reason?.rubricLabel || reason?.evidence || '',
    index,
  ].join('|').toLowerCase();
  return signature.replace(/[^a-z0-9|_-]+/g, '-').slice(0, 220);
};

const propertyMatchesAuditFilter = (property, filterId) => {
  if (!property || filterId === 'all') return true;
  const reasons = Array.isArray(property.flaggedReasons) ? property.flaggedReasons : [];
  const reasonText = reasons.map((reason) => `${reason.category || ''} ${getAuditReasonText(reason)} ${reason.rubricKey || ''}`).join(' ').toLowerCase();
  const topRubric = `${property.topFailingRubric?.key || ''} ${property.topFailingRubric?.label || ''}`.toLowerCase();
  const combined = `${reasonText} ${topRubric} ${property.topIssue || ''}`.toLowerCase();
  if (filterId === 'critical') return property.riskTier === 'Critical';
  if (filterId === 'no-audit') return !property.hasAudit;
  if (filterId === 'pricing') return combined.includes('pricing') || combined.includes('price') || combined.includes('rent');
  if (filterId === 'application') return combined.includes('application') || combined.includes('apply') || combined.includes('lease now');
  if (filterId === 'specials') return combined.includes('special') || combined.includes('offer') || combined.includes('promo');
  if (filterId === 'broken-links') return Number(property.brokenLinkCount || 0) > 0 || combined.includes('broken link');
  if (filterId === 'mobile') return combined.includes('mobile') || combined.includes('desktop') || combined.includes('load');
  if (filterId === 'stale-copy') return Number(property.staleDateCount || 0) > 0 || combined.includes('stale') || combined.includes('expired');
  return true;
};

const getLocalFalconRankTone = (rank) => {
  const numeric = Number(rank);
  if (!Number.isFinite(numeric)) return 'missing';
  if (numeric <= 3) return 'strong';
  if (numeric <= 10) return 'moderate';
  if (numeric <= 20) return 'weak';
  return 'missing';
};

const shortenLabel = (value, max = 20) => {
  const text = String(value || '(not set)');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const normalizeAnalyticsError = (message) => {
  const text = String(message || '').trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized.includes('deleted_client') || normalized.includes('oauth client was deleted')) {
    return 'Google Ads access needs to be reconnected. The OAuth client in GOOGLE_ADS_CONFIG_JSON was deleted, so refresh the Google Ads credentials before live paid search metrics can load.';
  }
  if (
    normalized.includes('consumer_invalid')
    || normalized.includes('project #')
    || normalized.includes('project has been deleted')
  ) {
    return 'GA4 reporting credentials need to be updated. The Google Cloud project behind the Analytics API credential was deleted or disabled, so replace the service account/API credential and enable the Analytics Data API.';
  }
  if (text.includes('403') && text.toLowerCase().includes('property')) {
    return 'GA4 access is not enabled for this property yet. Share the property with the reporting service account to unlock the GA4 sections.';
  }
  return text;
};

const LEGAL_LAST_UPDATED = 'April 6, 2026';

const LegalLayout = ({ badge, title, intro, children }) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <main className="legal-page">
      <div className="legal-shell">
        <div className="legal-hero">
          <div className="legal-badge">{badge}</div>
          <img src="/logo-white.svg" alt="Redstone Logo" className="legal-logo" />
          <h1>{title}</h1>
          <p>{intro}</p>
          <div className="legal-meta">
            <span>Last updated {LEGAL_LAST_UPDATED}</span>
            <span>{origin}</span>
          </div>
        </div>
        <div className="legal-card">
          {children}
          <div className="legal-links">
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-of-service">Terms of Service</a>
            <a href="/">Back to Dashboard</a>
          </div>
        </div>
      </div>
    </main>
  );
};

const PrivacyPolicyPage = () => (
  <LegalLayout
    badge="Privacy Policy"
    title="Redstone Dashboard Privacy Policy"
    intro="This Privacy Policy explains how Redstone Dashboard collects, uses, stores, and shares information when authorized users access our analytics and reporting platform."
  >
    <section className="legal-section">
      <h2>1. Information We Collect</h2>
      <p>We collect information needed to operate the dashboard, secure accounts, and provide reporting features. This may include account details, usage logs, property and marketing performance data, and information made available through connected services.</p>
    </section>
    <section className="legal-section">
      <h2>2. Connected Services</h2>
      <p>When enabled, the dashboard may process data from Google APIs, Firebase, Entrata, Meta platforms, and other analytics or advertising providers that you authorize. We use that data only to provide dashboard functionality, reporting, troubleshooting, and product improvements.</p>
    </section>
    <section className="legal-section">
      <h2>3. How We Use Information</h2>
      <p>We use information to authenticate users, deliver analytics, maintain integrations, monitor performance, prevent misuse, comply with legal obligations, and support customer requests.</p>
    </section>
    <section className="legal-section">
      <h2>4. Sharing of Information</h2>
      <p>We do not sell personal information. We may share information with service providers and subprocessors that help us host the application, store data, analyze performance, and maintain infrastructure. We may also disclose information if required by law or to protect the security and integrity of the service.</p>
    </section>
    <section className="legal-section">
      <h2>5. Data Retention</h2>
      <p>We retain information for as long as reasonably necessary to provide the service, maintain records, resolve disputes, enforce agreements, and meet legal or operational requirements. Retention periods may vary depending on the type of data and the source system.</p>
    </section>
    <section className="legal-section">
      <h2>6. Security</h2>
      <p>We use administrative, technical, and organizational safeguards designed to protect information against unauthorized access, disclosure, alteration, or destruction. No system is perfectly secure, and we cannot guarantee absolute security.</p>
    </section>
    <section className="legal-section">
      <h2>7. Your Choices and Rights</h2>
      <p>Depending on your relationship with Redstone and applicable law, you may have rights to request access, correction, deletion, or restriction of certain information. Requests should be directed through your Redstone account contact or organization administrator.</p>
    </section>
    <section className="legal-section">
      <h2>8. Google API Data</h2>
      <p>Data received from Google APIs is used only to provide and improve the user-facing features you enable in the dashboard. We do not use Google Workspace API data to develop, improve, or train generalized artificial intelligence or machine learning models.</p>
    </section>
    <section className="legal-section">
      <h2>9. Updates to This Policy</h2>
      <p>We may update this Privacy Policy from time to time. Changes become effective when posted on this page. Continued use of the service after an update means the revised policy applies going forward.</p>
    </section>
  </LegalLayout>
);

const TermsOfServicePage = () => (
  <LegalLayout
    badge="Terms of Service"
    title="Redstone Dashboard Terms of Service"
    intro="These Terms of Service govern access to and use of the Redstone Dashboard by authorized customers, team members, and invited users."
  >
    <section className="legal-section">
      <h2>1. Acceptance of Terms</h2>
      <p>By accessing or using the dashboard, you agree to these Terms. If you are using the service on behalf of an organization, you represent that you are authorized to bind that organization to these Terms.</p>
    </section>
    <section className="legal-section">
      <h2>2. Permitted Use</h2>
      <p>You may use the service only for lawful business purposes and only in accordance with your organization’s authorization. You agree not to misuse the platform, attempt unauthorized access, interfere with service operations, or use the dashboard to violate applicable law or third-party rights.</p>
    </section>
    <section className="legal-section">
      <h2>3. Accounts and Access</h2>
      <p>You are responsible for maintaining the confidentiality of your credentials and for activities that occur under your account. Access may be suspended or revoked if we believe an account presents a security risk or violates these Terms.</p>
    </section>
    <section className="legal-section">
      <h2>4. Third-Party Platforms</h2>
      <p>The dashboard may rely on third-party products and APIs, including Google, Firebase, Meta, and property management or advertising platforms. Your use of those integrations may also be subject to separate third-party terms and privacy policies.</p>
    </section>
    <section className="legal-section">
      <h2>5. Data and Availability</h2>
      <p>We work to provide accurate and timely reporting, but we do not guarantee uninterrupted availability, error-free operation, or perfect completeness of data supplied by third-party systems. Analytics, attribution, and reporting outputs should be reviewed before being used for material business decisions.</p>
    </section>
    <section className="legal-section">
      <h2>6. Intellectual Property</h2>
      <p>The dashboard, including its software, design, and content other than customer-provided data, is owned by Redstone or its licensors and is protected by applicable intellectual property laws. These Terms grant a limited right to use the service and do not transfer ownership.</p>
    </section>
    <section className="legal-section">
      <h2>7. Disclaimer of Warranties</h2>
      <p>The service is provided on an “as is” and “as available” basis to the fullest extent permitted by law. We disclaim all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, and non-infringement.</p>
    </section>
    <section className="legal-section">
      <h2>8. Limitation of Liability</h2>
      <p>To the fullest extent permitted by law, Redstone will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenues, data, or business opportunities arising from or related to use of the service.</p>
    </section>
    <section className="legal-section">
      <h2>9. Changes and Termination</h2>
      <p>We may modify the service or these Terms at any time. We may also suspend or terminate access if necessary for security, maintenance, legal compliance, or violations of these Terms.</p>
    </section>
  </LegalLayout>
);

const DashboardApp = ({
  currentUser = null,
  onSignOut = null,
  availableProperties = [],
  propertyAccessById = {},
  defaultPropertyId = null,
  clientReportSlug = '',
}) => {
  const { profile, refreshAccess } = useAccess();
  const normalizedClientReportSlug = toClientReportSlug(clientReportSlug);
  const isClientReportMode = Boolean(normalizedClientReportSlug);
  const clientReportProperty = useMemo(
    () => availableProperties.find((property) => propertyMatchesReportSlug(property, normalizedClientReportSlug)) || null,
    [availableProperties, normalizedClientReportSlug]
  );
  const workspaceStateStorageKey = useMemo(
    () => getDashboardWorkspaceStateKey(currentUser),
    [currentUser]
  );
  const auditFindingWorkflowStorageKey = useMemo(
    () => getAuditFindingWorkflowStorageKey(currentUser),
    [currentUser]
  );
  const savedWorkspaceState = useMemo(
    () => normalizeSavedDashboardState(readDashboardWorkspaceState(workspaceStateStorageKey), defaultPropertyId),
    [defaultPropertyId, workspaceStateStorageKey]
  );
  const initialSelectedPropertyId = clientReportProperty?.propertyId || savedWorkspaceState.selectedPropertyId;
  const [activeTab, setActiveTab] = useState(isClientReportMode ? 'reports' : savedWorkspaceState.activeTab);
  const [dateRange, setDateRange] = useState(savedWorkspaceState.dateRange);
  const [customRange, setCustomRange] = useState(() => {
    const defaultRange = getDefaultCustomRange();
    return {
      start: savedWorkspaceState.customRange.start || defaultRange.start,
      end: savedWorkspaceState.customRange.end || defaultRange.end,
    };
  });
  const [draftDateRange, setDraftDateRange] = useState(savedWorkspaceState.dateRange);
  const [draftCustomRange, setDraftCustomRange] = useState(() => {
    const defaultRange = getDefaultCustomRange();
    return {
      start: savedWorkspaceState.customRange.start || defaultRange.start,
      end: savedWorkspaceState.customRange.end || defaultRange.end,
    };
  });
  const [selectedPropertyId, setSelectedPropertyId] = useState(initialSelectedPropertyId);
  const [excludedMarketingSpendKeys, setExcludedMarketingSpendKeys] = useState(savedWorkspaceState.excludedMarketingSpendKeys);
  const [loading, setLoading] = useState(true);
  const [invoiceLoading, setInvoiceLoading] = useState(true);
  const [roiLoading, setRoiLoading] = useState(true);
  const [propertyInfoLoading, setPropertyInfoLoading] = useState(true);
  const [roiPipelineStatusLoading, setRoiPipelineStatusLoading] = useState(true);
  const [ga4Loading, setGa4Loading] = useState(true);
  const [googleAdsLoading, setGoogleAdsLoading] = useState(true);
  const [metaAdsLoading, setMetaAdsLoading] = useState(true);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [localFalconLoading, setLocalFalconLoading] = useState(true);
  const [metaAdsAttributionMode, setMetaAdsAttributionMode] = useState(savedWorkspaceState.metaAdsAttributionMode);
  const [websiteManagerLoading, setWebsiteManagerLoading] = useState(true);
  const [websiteManagerSaving, setWebsiteManagerSaving] = useState(false);
  const [websiteManagerAction, setWebsiteManagerAction] = useState('save');
  const [websiteManagerError, setWebsiteManagerError] = useState(null);
  const [websiteManagerNotice, setWebsiteManagerNotice] = useState(null);
  const [websiteManagerDoc, setWebsiteManagerDoc] = useState(WEBSITE_MANAGER_DEFAULT_RECORD);
  const [websiteManagerDraft, setWebsiteManagerDraft] = useState(WEBSITE_MANAGER_DEFAULT_RECORD);
  const [websiteManagerSection, setWebsiteManagerSection] = useState('content');
  const [selectedWebsiteManagerGroupId, setSelectedWebsiteManagerGroupId] = useState('');
  const [websiteManagerReferenceOpen, setWebsiteManagerReferenceOpen] = useState(true);
  const [websiteManagerContentSearch, setWebsiteManagerContentSearch] = useState('');
  const [websiteManagerContentFilter, setWebsiteManagerContentFilter] = useState('all');
  const [expandedWebsiteManagerGroups, setExpandedWebsiteManagerGroups] = useState(() => new Set());
  const [copiedWebsiteManagerToken, setCopiedWebsiteManagerToken] = useState('');
  const [websiteManagerTokenSearch, setWebsiteManagerTokenSearch] = useState('');
  const [activeWebsiteManagerFieldKey, setActiveWebsiteManagerFieldKey] = useState('');
  const [heatmapSiteLoading, setHeatmapSiteLoading] = useState(true);
  const [heatmapSiteSaving, setHeatmapSiteSaving] = useState(false);
  const [heatmapSiteError, setHeatmapSiteError] = useState(null);
  const [heatmapSiteNotice, setHeatmapSiteNotice] = useState(null);
  const [heatmapSiteDoc, setHeatmapSiteDoc] = useState(HEATMAP_SITE_DEFAULT_CONFIG);
  const [heatmapSiteDraft, setHeatmapSiteDraft] = useState(HEATMAP_SITE_DEFAULT_CONFIG);
  const [websiteSchemaLoading, setWebsiteSchemaLoading] = useState(false);
  const [websiteSchemaSaving, setWebsiteSchemaSaving] = useState(false);
  const [websiteSchemaError, setWebsiteSchemaError] = useState(null);
  const [websiteSchemaNotice, setWebsiteSchemaNotice] = useState(null);
  const [websiteSchemaDoc, setWebsiteSchemaDoc] = useState(WEBSITE_MANAGER_DEFAULT_SCHEMA);
  const [websiteSchemaDraft, setWebsiteSchemaDraft] = useState(WEBSITE_MANAGER_DEFAULT_SCHEMA);
  const [expandedWebsiteSchemaGroups, setExpandedWebsiteSchemaGroups] = useState(() => new Set());
  const [websiteSchemaHistory, setWebsiteSchemaHistory] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  });
  
  // Real data state
  const [leadItems, setLeadItems] = useState([]);
  const [eventItems, setEventItems] = useState([]);
  const [leaseItems, setLeaseItems] = useState([]);
  const [preleaseLeaseItems, setPreleaseLeaseItems] = useState([]);
  const [priorPreleaseLeaseItems, setPriorPreleaseLeaseItems] = useState([]);
  const [conventionalLeaseItems, setConventionalLeaseItems] = useState([]);
  const [lead60DayItems, setLead60DayItems] = useState([]);
  const [event60DayItems, setEvent60DayItems] = useState([]);
  const [studentPreleaseCycle, setStudentPreleaseCycle] = useState(null);
  const [conventionalOccupancyWindow, setConventionalOccupancyWindow] = useState(null);
  const [reportingPortfolio, setReportingPortfolio] = useState('student');
  const [redListSummary, setRedListSummary] = useState(null);
  const [redListPortfolioLoading, setRedListPortfolioLoading] = useState(false);
  const [redListPortfolioError, setRedListPortfolioError] = useState(null);
  const [redListPortfolioSummaries, setRedListPortfolioSummaries] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [availabilityPricingSnapshot, setAvailabilityPricingSnapshot] = useState(null);
  const [specialsSnapshot, setSpecialsSnapshot] = useState(null);
  const [latestAvailabilityDate, setLatestAvailabilityDate] = useState(null);
  const [parentDocs, setParentDocs] = useState([]);
  const [roiDailyItems, setRoiDailyItems] = useState([]);
  const reportingOverviewUrl = resolveRenderApiRoute('/api/reporting/property-overview', PROPERTY_REPORTING_OVERVIEW_URL);
  const reportingTabSummaryUrl = resolveRenderApiRoute('/api/reporting/tab-summary', REPORTING_TAB_SUMMARY_URL);
  const reportingUsesStagedOverview = Boolean(reportingOverviewUrl);
  const [reportingTabSummaryBypass, setReportingTabSummaryBypass] = useState(false);
  const [reportingDataSource, setReportingDataSource] = useState(() => (
    reportingUsesStagedOverview ? 'loading' : 'error'
  ));
  const [roiPipelineStatus, setRoiPipelineStatus] = useState(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsData, setRecommendationsData] = useState(null);
  const [recommendationsError, setRecommendationsError] = useState(null);
  const [recommendationFeedbackLoading, setRecommendationFeedbackLoading] = useState({});
  const [selectedRecommendationId, setSelectedRecommendationId] = useState(null);
  const [recommendationFeedbackDrafts, setRecommendationFeedbackDrafts] = useState({});
  const [ga4Data, setGa4Data] = useState(null);
  const [ga4Error, setGa4Error] = useState(null);
  const [googleAdsData, setGoogleAdsData] = useState(null);
  const [googleAdsError, setGoogleAdsError] = useState(null);
  const [metaAdsData, setMetaAdsData] = useState(null);
  const [metaAdsError, setMetaAdsError] = useState(null);
  const [reputationData, setReputationData] = useState(null);
  const [reputationError, setReputationError] = useState(null);
  const [localFalconData, setLocalFalconData] = useState(null);
  const [localFalconError, setLocalFalconError] = useState(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksSaving, setTasksSaving] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [taskDraft, setTaskDraft] = useState(() => createEmptyTaskDraft(savedWorkspaceState.selectedPropertyId));
  const [tasksError, setTasksError] = useState(null);
  const [tasksNotice, setTasksNotice] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [ticketUsers, setTicketUsers] = useState([]);
  const [ticketAssignments, setTicketAssignments] = useState([]);
  const [ticketDraft, setTicketDraft] = useState(() => createEmptyTicketDraft(savedWorkspaceState.selectedPropertyId));
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsSaving, setTicketsSaving] = useState(false);
  const [ticketsError, setTicketsError] = useState(null);
  const [ticketsNotice, setTicketsNotice] = useState(null);
  const [marketingBudgetItems, setMarketingBudgetItems] = useState([]);
  const [marketingBudgetDraft, setMarketingBudgetDraft] = useState(() => createEmptyMarketingBudgetDraft(savedWorkspaceState.selectedPropertyId));
  const [marketingBudgetLoading, setMarketingBudgetLoading] = useState(false);
  const [marketingBudgetSaving, setMarketingBudgetSaving] = useState(false);
  const [marketingBudgetError, setMarketingBudgetError] = useState(null);
  const [marketingBudgetNotice, setMarketingBudgetNotice] = useState(null);
  const [propertyBudgetItemsExpanded, setPropertyBudgetItemsExpanded] = useState(true);
  const [propertyBudgetTableSort, setPropertyBudgetTableSort] = useState({ key: 'startDate', direction: 'desc' });
  const [actualMarketingSpendItems, setActualMarketingSpendItems] = useState([]);
  const [actualMarketingSpendLoading, setActualMarketingSpendLoading] = useState(false);
  const [actualMarketingSpendError, setActualMarketingSpendError] = useState(null);
  const [adminAccessLoading, setAdminAccessLoading] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState(null);
  const [adminAccessNotice, setAdminAccessNotice] = useState(null);
  const [adminInviteLink, setAdminInviteLink] = useState('');
  const [adminPasswordResetLink, setAdminPasswordResetLink] = useState('');
  const [adminCopiedLinkType, setAdminCopiedLinkType] = useState('');
  const [adminActiveSection, setAdminActiveSection] = useState('users');
  const [redListActiveSection, setRedListActiveSection] = useState('student');
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminInvitePropertySearch, setAdminInvitePropertySearch] = useState('');
  const [adminUserPropertySearch, setAdminUserPropertySearch] = useState('');
  const [adminRoutingSearch, setAdminRoutingSearch] = useState('');
  const [adminRoutingFilter, setAdminRoutingFilter] = useState('all');
  const [adminPropertySearch, setAdminPropertySearch] = useState('');
  const [adminPropertyDraft, setAdminPropertyDraft] = useState(ADMIN_PROPERTY_DRAFT_DEFAULTS);
  const [adminOffboardConfirmations, setAdminOffboardConfirmations] = useState({});
  const [adminAuditSearch, setAdminAuditSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRoles, setAdminRoles] = useState([]);
  const [adminProperties, setAdminProperties] = useState([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState([]);
  const [adminTicketAssignmentDrafts, setAdminTicketAssignmentDrafts] = useState({});
  const [adminSelectedUserId, setAdminSelectedUserId] = useState(null);
  const [adminUserDraft, setAdminUserDraft] = useState(null);
  const [adminInviteDraft, setAdminInviteDraft] = useState({
    email: '',
    fullName: '',
    globalRole: '',
    propertyRole: '',
    propertyIds: [],
  });
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [accountDraft, setAccountDraft] = useState({
    fullName: '',
    email: '',
    avatarUrl: '',
    avatarPath: '',
  });
  const [accountPasswordDraft, setAccountPasswordDraft] = useState({
    password: '',
    confirmPassword: '',
  });
  const websiteManagerUsesStagedAdapter = Boolean(WEBSITE_MANAGER_URL);
  const websiteManagerSchemaUsesStagedAdapter = Boolean(WEBSITE_MANAGER_SCHEMA_URL);
  const shouldLoadReportingOverview = ['dashboard', 'property info', 'reports', 'recommendations'].includes(activeTab);
  const shouldLoadWebsiteManagerContent = activeTab === 'website manager';
  const shouldLoadWebsiteExperienceConfig = shouldLoadWebsiteManagerContent || activeTab === 'reports' || activeTab === 'audit';
  const shouldLoadChannelAnalytics = activeTab === 'reports';
  const shouldLoadReputationData = activeTab === 'reports' || activeTab === 'reputation';
  const shouldLoadReportingTabSummary = Boolean(reportingTabSummaryUrl)
    && !reportingTabSummaryBypass
    && ['reports', 'reputation'].includes(activeTab);
  const reportingTabSummarySections = useMemo(() => {
    if (activeTab === 'reports') return 'analytics,reputation,reports';
    if (activeTab === 'reputation') return 'reputation';
    return '';
  }, [activeTab]);
  const isAllPropertiesSelected = selectedPropertyId === ALL_PROPERTIES_OPTION;
  const allPropertiesSupportedTabs = useMemo(() => new Set(['dashboard', 'red-list']), []);
  const selectedProperty = useMemo(() => {
    if (isAllPropertiesSelected) return null;
    const base = availableProperties.find((property) => property.propertyId === selectedPropertyId) || null;
    if (!base) return null;
    return {
      ...base,
      opiniionSkip: OPINIION_SKIPPED_PROPERTY_IDS.has(selectedPropertyId),
    };
  }, [availableProperties, isAllPropertiesSelected, selectedPropertyId]);
  const clientReportLink = useMemo(
    () => buildClientReportLink(selectedProperty),
    [selectedProperty]
  );
  const currentPropertyPermissionSet = useMemo(() => {
    if (!isAllPropertiesSelected) {
      return new Set(propertyAccessById[selectedPropertyId]?.permissions || []);
    }

    const permissionSet = new Set();
    availableProperties.forEach((property) => {
      (propertyAccessById[property.propertyId]?.permissions || []).forEach((permission) => permissionSet.add(permission));
    });
    return permissionSet;
  }, [availableProperties, isAllPropertiesSelected, propertyAccessById, selectedPropertyId]);
  const displayName = profile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'Account';
  const accountAvatarUrl = profile?.avatar_url || accountDraft.avatarUrl || '';
  const accountInitials = useMemo(() => getInitials(displayName), [displayName]);
  const visibleNavItems = useMemo(
    () => {
      const items = NAV_ITEMS.filter((item) => currentPropertyPermissionSet.has(item.permission));
      return isClientReportMode ? items.filter((item) => item.id === 'reports') : items;
    },
    [currentPropertyPermissionSet, isClientReportMode]
  );
  const taskPropertyIds = useMemo(
    () => new Set(availableProperties.map((property) => property.propertyId)),
    [availableProperties]
  );
  const taskPropertyById = useMemo(
    () => new Map(availableProperties.map((property) => [property.propertyId, property])),
    [availableProperties]
  );
  const ticketUserById = useMemo(
    () => new Map(ticketUsers.map((user) => [user.id, user])),
    [ticketUsers]
  );
  const ticketAssignmentByPropertyId = useMemo(
    () => new Map(ticketAssignments.map((assignment) => [assignment.propertyId, assignment.defaultAssigneeUserId])),
    [ticketAssignments]
  );
  const ticketAssignableUsers = useMemo(() => {
    if (!ticketDraft.propertyId) return ticketUsers;
    return ticketUsers.filter((user) => user.globalRole === 'admin' || user.propertyIds?.includes(ticketDraft.propertyId));
  }, [ticketDraft.propertyId, ticketUsers]);
  const canEditReportingLayout = !isClientReportMode && currentPropertyPermissionSet.has(REPORTING_LAYOUT_EDIT_PERMISSION);
  const canEditWebsiteManager = currentPropertyPermissionSet.has(WEBSITE_MANAGER_EDIT_PERMISSION);
  const canManageUsers = currentPropertyPermissionSet.has(TAB_PERMISSIONS.admin);
  const canUseAllProperties = canManageUsers && availableProperties.length > 1;
  const propertyScopedSelectionId = isAllPropertiesSelected ? null : selectedPropertyId;
  const canApplyDraftCustomRange = Boolean(draftCustomRange.start && draftCustomRange.end);
  const hasUnappliedCustomRange = draftDateRange === 'custom' && (
    dateRange !== 'custom' ||
    draftCustomRange.start !== customRange.start ||
    draftCustomRange.end !== customRange.end
  );
  const adminGlobalRoles = useMemo(
    () => adminRoles.filter((role) => role.scope === 'global'),
    [adminRoles]
  );
  const adminPropertyRoles = useMemo(
    () => adminRoles.filter((role) => role.scope === 'property'),
    [adminRoles]
  );
  const adminUserById = useMemo(
    () => new Map(adminUsers.map((user) => [user.id, user])),
    [adminUsers]
  );
  const adminTicketAssignmentCount = useMemo(
    () => Object.values(adminTicketAssignmentDrafts).filter((assignment) => {
      const draft = normalizeAdminAssignmentDraft(assignment);
      return Boolean(draft.defaultAssigneeUserId || draft.regionalUserId || draft.clientGroupPortfolio);
    }).length,
    [adminTicketAssignmentDrafts]
  );
  const adminPortfolioOptions = useMemo(() => {
    const values = new Set(['student', 'multifamily']);
    adminProperties.forEach((property) => {
      if (property.portfolio) values.add(property.portfolio);
    });
    Object.values(adminTicketAssignmentDrafts).forEach((assignment) => {
      const draft = normalizeAdminAssignmentDraft(assignment);
      if (draft.clientGroupPortfolio) values.add(draft.clientGroupPortfolio);
    });
    return Array.from(values).sort((a, b) => formatPortfolioLabel(a).localeCompare(formatPortfolioLabel(b)));
  }, [adminProperties, adminTicketAssignmentDrafts]);
  const adminClientOptions = useMemo(() => (
    Array.from(new Set(adminProperties.map((property) => property.client).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  ), [adminProperties]);
  const filteredAdminUsers = useMemo(
    () => adminUsers.filter((user) => matchesSearch([
      user.fullName,
      user.email,
      user.globalRole,
      user.memberships?.[0]?.role,
    ], adminUserSearch)),
    [adminUserSearch, adminUsers]
  );
  const filteredAdminInviteProperties = useMemo(
    () => adminProperties.filter((property) => matchesSearch([
      property.name,
      property.city,
      property.state,
      property.id,
    ], adminInvitePropertySearch)),
    [adminInvitePropertySearch, adminProperties]
  );
  const filteredAdminUserProperties = useMemo(
    () => adminProperties.filter((property) => matchesSearch([
      property.name,
      property.city,
      property.state,
      property.id,
    ], adminUserPropertySearch)),
    [adminProperties, adminUserPropertySearch]
  );
  const filteredAdminProperties = useMemo(
    () => adminProperties.filter((property) => matchesSearch([
      property.name,
      property.city,
      property.state,
      property.id,
      property.portfolio,
      property.client,
      property.website_type,
      property.property_type,
    ], adminPropertySearch)),
    [adminProperties, adminPropertySearch]
  );
  const filteredAdminRoutingProperties = useMemo(
    () => adminProperties.filter((property) => {
      const assignmentDraft = normalizeAdminAssignmentDraft(adminTicketAssignmentDrafts[property.id]);
      const assigneeId = assignmentDraft.defaultAssigneeUserId;
      const regionalUser = adminUserById.get(assignmentDraft.regionalUserId);
      const assignee = adminUserById.get(assigneeId);
      const assignmentMatchesFilter = adminRoutingFilter === 'assigned'
        ? Boolean(assigneeId || assignmentDraft.regionalUserId || assignmentDraft.clientGroupPortfolio)
        : adminRoutingFilter === 'unassigned'
          ? !(assigneeId || assignmentDraft.regionalUserId || assignmentDraft.clientGroupPortfolio)
          : true;
      return assignmentMatchesFilter && matchesSearch([
        property.name,
        property.city,
        property.state,
        property.id,
        property.portfolio,
        assignee?.fullName,
        assignee?.email,
        regionalUser?.fullName,
        regionalUser?.email,
        assignmentDraft.clientGroupPortfolio,
      ], adminRoutingSearch);
    }),
    [adminProperties, adminRoutingFilter, adminRoutingSearch, adminTicketAssignmentDrafts, adminUserById]
  );
  const filteredAdminAuditLogs = useMemo(
    () => adminAuditLogs.filter((log) => matchesSearch([
      log.action,
      log.actor_email,
      log.target_email,
      log.details?.requestedPropertyRole,
      log.details?.requestedGlobalRole,
      log.details?.propertyRole,
      log.details?.globalRole,
    ], adminAuditSearch)),
    [adminAuditLogs, adminAuditSearch]
  );
  const tasksByStatus = useMemo(() => {
    const grouped = Object.fromEntries(TASK_STATUSES.map((status) => [status.id, []]));
    tasks.forEach((task) => {
      const status = TASK_STATUS_IDS.includes(task.status) ? task.status : 'new';
      grouped[status].push(task);
    });
    return grouped;
  }, [tasks]);
  const openTaskCount = useMemo(
    () => tasks.filter((task) => task.status !== 'complete').length,
    [tasks]
  );
  const ticketsByStatus = useMemo(() => {
    const grouped = Object.fromEntries(TASK_STATUSES.map((status) => [status.id, []]));
    tickets.forEach((ticket) => {
      const status = TASK_STATUS_IDS.includes(ticket.status) ? ticket.status : 'new';
      grouped[status].push(ticket);
    });
    return grouped;
  }, [tickets]);
  const openTicketCount = useMemo(
    () => tickets.filter((ticket) => ticket.status !== 'complete').length,
    [tickets]
  );
  const currentMarketingBudgetDate = useMemo(() => formatDateInputValue(new Date()), []);
  const activeMarketingBudgetItems = useMemo(() => (
    marketingBudgetItems.filter((item) => item.status === 'active')
  ), [marketingBudgetItems]);
  const activeApprovedMarketingBudget = useMemo(() => (
    activeMarketingBudgetItems.reduce((total, item) => total + parseCurrency(item.monthlyAmount), 0)
  ), [activeMarketingBudgetItems]);
  const futureMarketingBudgetItems = useMemo(() => (
    marketingBudgetItems.filter((item) => item.status === 'new' || (item.startDate && item.startDate > currentMarketingBudgetDate))
  ), [currentMarketingBudgetDate, marketingBudgetItems]);
  const sortedMarketingBudgetItems = useMemo(() => {
    const sortMultiplier = propertyBudgetTableSort.direction === 'asc' ? 1 : -1;
    const getSortValue = (item) => {
      if (propertyBudgetTableSort.key === 'status') return MARKETING_BUDGET_STATUS_ORDER[item.status] ?? 99;
      if (propertyBudgetTableSort.key === 'itemName') return String(item.itemName || '').toLowerCase();
      if (propertyBudgetTableSort.key === 'startDate') return item.startDate || '';
      if (propertyBudgetTableSort.key === 'endDate') return item.endDate || '';
      if (propertyBudgetTableSort.key === 'monthlyAmount') return parseCurrency(item.monthlyAmount);
      if (propertyBudgetTableSort.key === 'contractFileName') return String(item.contractFileName || '').toLowerCase();
      if (propertyBudgetTableSort.key === 'listingUrl') return String(item.listingUrl || '').toLowerCase();
      if (propertyBudgetTableSort.key === 'notes') return String(item.notes || '').toLowerCase();
      if (propertyBudgetTableSort.key === 'updatedAt') return item.updatedAt || '';
      return '';
    };
    return [...marketingBudgetItems].sort((a, b) => {
      const left = getSortValue(a);
      const right = getSortValue(b);
      const leftEmpty = left === '' || left == null || (typeof left === 'number' && !Number.isFinite(left));
      const rightEmpty = right === '' || right == null || (typeof right === 'number' && !Number.isFinite(right));
      if (leftEmpty || rightEmpty) {
        if (leftEmpty && rightEmpty) return String(a.itemName || '').localeCompare(String(b.itemName || ''));
        return leftEmpty ? 1 : -1;
      }
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
      if (comparison !== 0) return comparison * sortMultiplier;
      return String(a.itemName || '').localeCompare(String(b.itemName || ''));
    });
  }, [marketingBudgetItems, propertyBudgetTableSort]);
  const actualMarketingSpendWindow = useMemo(() => getCallPrepWindowRange(30), []);

  const handleDateRangeChange = (nextDateRange) => {
    setDraftDateRange(nextDateRange);

    if (nextDateRange !== 'custom') {
      setDateRange(nextDateRange);
    }
  };

  const applyDraftCustomRange = () => {
    if (!draftCustomRange.start || !draftCustomRange.end) return;
    setCustomRange(draftCustomRange);
    setDateRange('custom');
  };

  useEffect(() => {
    setAccountDraft({
      fullName: profile?.full_name || currentUser?.user_metadata?.full_name || '',
      email: currentUser?.email || profile?.email || '',
      avatarUrl: profile?.avatar_url || '',
      avatarPath: profile?.avatar_path || '',
    });
  }, [currentUser, profile]);

  useEffect(() => {
    if (isClientReportMode) {
      if (clientReportProperty?.propertyId && selectedPropertyId !== clientReportProperty.propertyId) {
        setSelectedPropertyId(clientReportProperty.propertyId);
      }
      return;
    }

    if (availableProperties.length === 0) {
      if (selectedPropertyId !== null) {
        setSelectedPropertyId(null);
      }
      return;
    }

    const allowedIds = new Set(availableProperties.map((property) => property.propertyId));
    if (canUseAllProperties) {
      allowedIds.add(ALL_PROPERTIES_OPTION);
    }
    const nextPropertyId = defaultPropertyId || availableProperties[0]?.propertyId || null;
    if (!selectedPropertyId || !allowedIds.has(selectedPropertyId)) {
      setSelectedPropertyId(nextPropertyId);
    }
  }, [availableProperties, canUseAllProperties, clientReportProperty, defaultPropertyId, isClientReportMode, selectedPropertyId]);

  useEffect(() => {
    if (!isClientReportMode) return;
    if (activeTab !== 'reports') setActiveTab('reports');
  }, [activeTab, isClientReportMode]);

  useEffect(() => {
    if (!isAllPropertiesSelected) return;
    if (allPropertiesSupportedTabs.has(activeTab)) return;
    setSelectedPropertyId(defaultPropertyId || availableProperties[0]?.propertyId || null);
  }, [activeTab, allPropertiesSupportedTabs, availableProperties, defaultPropertyId, isAllPropertiesSelected]);

  useEffect(() => {
    const preferredTab = DEFAULT_TAB_ORDER.find((tabId) => visibleNavItems.some((item) => item.id === tabId));
    if (!preferredTab) return;
    if (!visibleNavItems.some((item) => item.id === activeTab)) {
      setActiveTab(preferredTab);
    }
  }, [activeTab, visibleNavItems]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isClientReportMode) return;
    window.localStorage.setItem(
      workspaceStateStorageKey,
      JSON.stringify({
        activeTab,
        dateRange,
        customRange,
        selectedPropertyId,
        metaAdsAttributionMode,
        excludedMarketingSpendKeys,
      })
    );
  }, [activeTab, customRange, dateRange, excludedMarketingSpendKeys, isClientReportMode, metaAdsAttributionMode, selectedPropertyId, workspaceStateStorageKey]);

  const hydrateAdminDraftFromUser = (user) => {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email || '',
      fullName: user.fullName || '',
      globalRole: user.globalRole || '',
      propertyRole: user.memberships?.[0]?.role || '',
      propertyIds: Array.isArray(user.memberships)
        ? user.memberships.filter((membership) => membership.isActive).map((membership) => membership.propertyId)
        : [],
      isActive: user.isActive !== false,
    };
  };

  const loadAdminAccess = useCallback(async () => {
    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);

    try {
      const [accessResponse, assignmentsResponse] = await Promise.all([
        authFetch(ADMIN_ACCESS_USERS_URL),
        authFetch(ADMIN_TICKET_ASSIGNMENTS_URL),
      ]);
      const [payload, assignmentsPayload] = await Promise.all([
        accessResponse.json(),
        assignmentsResponse.json(),
      ]);
      if (!accessResponse.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Admin access load failed: ${accessResponse.status}`);
      }
      if (!assignmentsResponse.ok || assignmentsPayload?.status === 'error') {
        throw new Error(assignmentsPayload?.error || `Ticket assignments load failed: ${assignmentsResponse.status}`);
      }

      const users = Array.isArray(payload.users) ? payload.users : [];
      const roles = Array.isArray(payload.roles) ? payload.roles : [];
      const properties = Array.isArray(payload.properties) ? payload.properties : [];
      const auditLogs = Array.isArray(payload.auditLogs) ? payload.auditLogs : [];
      const assignmentDrafts = Object.fromEntries(
        (Array.isArray(assignmentsPayload.assignments) ? assignmentsPayload.assignments : [])
          .map((assignment) => [assignment.propertyId, normalizeAdminAssignmentDraft(assignment)])
      );
      const nextSelectedUserId = users.some((user) => user.id === adminSelectedUserId)
        ? adminSelectedUserId
        : users[0]?.id || null;

      setAdminUsers(users);
      setAdminRoles(roles);
      setAdminProperties(properties);
      setAdminAuditLogs(auditLogs);
      setAdminTicketAssignmentDrafts(assignmentDrafts);
      setAdminSelectedUserId(nextSelectedUserId);
      setAdminUserDraft(hydrateAdminDraftFromUser(users.find((user) => user.id === nextSelectedUserId) || null));
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to load admin access data.');
    } finally {
      setAdminAccessLoading(false);
    }
  }, [adminSelectedUserId]);

  useEffect(() => {
    if (!canManageUsers || activeTab !== 'admin') return;
    loadAdminAccess();
  }, [activeTab, canManageUsers, loadAdminAccess]);

  useEffect(() => {
    setTaskDraft((current) => {
      if (current.propertyId && taskPropertyIds.has(current.propertyId)) return current;
      return { ...current, propertyId: selectedPropertyId || availableProperties[0]?.propertyId || '' };
    });
  }, [availableProperties, selectedPropertyId, taskPropertyIds]);

  useEffect(() => {
    setMarketingBudgetDraft((current) => ({
      ...createEmptyMarketingBudgetDraft(propertyScopedSelectionId || selectedPropertyId || availableProperties[0]?.propertyId || ''),
      startDate: current.startDate || formatDateInputValue(new Date()),
    }));
  }, [availableProperties, propertyScopedSelectionId, selectedPropertyId]);

  const loadMarketingBudgetItems = useCallback(async () => {
    if (!propertyScopedSelectionId) {
      setMarketingBudgetItems([]);
      setMarketingBudgetError('Choose a single property to manage approved marketing budget items.');
      setMarketingBudgetLoading(false);
      return;
    }
    if (!currentUser?.id || !supabase) {
      setMarketingBudgetItems([]);
      setMarketingBudgetError('Marketing budgets require a signed-in Supabase account.');
      setMarketingBudgetLoading(false);
      return;
    }

    setMarketingBudgetLoading(true);
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);

    try {
      const response = await supabase
        .from('property_marketing_budget_items')
        .select(MARKETING_BUDGET_SELECT_COLUMNS)
        .eq('property_id', propertyScopedSelectionId)
        .order('start_date', { ascending: false })
        .order('updated_at', { ascending: false });

      if (response.error) {
        throw response.error;
      }

      setMarketingBudgetItems((response.data || []).map(normalizeMarketingBudgetRecord));
    } catch (error) {
      setMarketingBudgetItems([]);
      setMarketingBudgetError(error.message || 'Unable to load approved marketing budget items.');
    } finally {
      setMarketingBudgetLoading(false);
    }
  }, [currentUser, propertyScopedSelectionId]);

  useEffect(() => {
    if (activeTab !== 'property info') return;
    loadMarketingBudgetItems();
  }, [activeTab, loadMarketingBudgetItems]);

  const loadActualMarketingSpendItems = useCallback(async () => {
    if (!propertyScopedSelectionId) {
      setActualMarketingSpendItems([]);
      setActualMarketingSpendError(null);
      setActualMarketingSpendLoading(false);
      return;
    }
    if (!reportingOverviewUrl) {
      setActualMarketingSpendItems([]);
      setActualMarketingSpendError('Reporting overview endpoint is not configured.');
      setActualMarketingSpendLoading(false);
      return;
    }

    setActualMarketingSpendLoading(true);
    setActualMarketingSpendError(null);

    try {
      const params = new URLSearchParams({
        property_id: propertyScopedSelectionId,
        start_date: formatDateInputValue(actualMarketingSpendWindow.start),
        end_date: formatDateInputValue(actualMarketingSpendWindow.end),
        call_prep_only: '1',
      });
      const response = await authFetch(`${reportingOverviewUrl}?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.message || payload?.error || `Actual marketing spend fetch failed: ${response.status}`);
      }
      setActualMarketingSpendItems(Array.isArray(payload.invoice_items) ? payload.invoice_items : []);
    } catch (error) {
      setActualMarketingSpendItems([]);
      setActualMarketingSpendError(error.message || 'Unable to load actual marketing spend.');
    } finally {
      setActualMarketingSpendLoading(false);
    }
  }, [actualMarketingSpendWindow, propertyScopedSelectionId, reportingOverviewUrl]);

  useEffect(() => {
    if (activeTab !== 'property info') return;
    loadActualMarketingSpendItems();
  }, [activeTab, loadActualMarketingSpendItems]);

  const loadTasks = useCallback(async (scope = 'mine') => {
    if (!currentUser?.id || !supabase) {
      setTasks([]);
      setTasksError('Tasks require a signed-in Supabase account.');
      return;
    }

    setTasksLoading(true);
    setTasksError(null);
    setTasksNotice(null);

    try {
      let query = supabase
        .from('user_tasks')
        .select('id, owner_user_id, property_id, title, description, notes, due_date, status, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (scope === 'property' && propertyScopedSelectionId) {
        query = query.eq('property_id', propertyScopedSelectionId);
      } else {
        query = query.eq('owner_user_id', currentUser.id);
      }

      const response = await query;

      if (response.error) {
        throw response.error;
      }

      setTasks((response.data || []).map(normalizeTaskRecord));
    } catch (error) {
      setTasksError(error.message || 'Unable to load your task board.');
    } finally {
      setTasksLoading(false);
    }
  }, [currentUser, propertyScopedSelectionId]);

  useEffect(() => {
    if (activeTab === 'tasks') {
      loadTasks('mine');
    }
  }, [activeTab, loadTasks]);

  const loadTickets = useCallback(async () => {
    if (!TICKETS_BASE_URL || !TICKET_OPTIONS_URL) {
      setTicketsError('Ticket endpoints are not configured.');
      return;
    }

    setTicketsLoading(true);
    setTicketsError(null);
    setTicketsNotice(null);

    try {
      const [optionsResponse, ticketsResponse] = await Promise.all([
        authFetch(TICKET_OPTIONS_URL),
        authFetch(TICKETS_BASE_URL),
      ]);
      const [optionsPayload, ticketsPayload] = await Promise.all([
        optionsResponse.json(),
        ticketsResponse.json(),
      ]);
      if (!optionsResponse.ok || optionsPayload?.status === 'error') {
        throw new Error(optionsPayload?.error || optionsPayload?.message || `Ticket options failed: ${optionsResponse.status}`);
      }
      if (!ticketsResponse.ok || ticketsPayload?.status === 'error') {
        throw new Error(ticketsPayload?.error || ticketsPayload?.message || `Tickets failed: ${ticketsResponse.status}`);
      }

      const users = Array.isArray(optionsPayload.users) ? optionsPayload.users : [];
      const assignments = Array.isArray(optionsPayload.assignments) ? optionsPayload.assignments : [];
      setTicketUsers(users);
      setTicketAssignments(assignments);
      setTickets((Array.isArray(ticketsPayload.tickets) ? ticketsPayload.tickets : []).map(normalizeTicketRecord));
      setTicketDraft((current) => {
        const currentPropertyIsValid = current.propertyId && taskPropertyIds.has(current.propertyId);
        if (currentPropertyIsValid || !selectedPropertyId || isAllPropertiesSelected || !taskPropertyIds.has(selectedPropertyId)) return current;
        const defaultAssigneeId = assignments.find((assignment) => assignment.propertyId === selectedPropertyId)?.defaultAssigneeUserId || '';
        return { ...current, propertyId: selectedPropertyId, assignedUserId: defaultAssigneeId, requesterEmail: current.requesterEmail || currentUser?.email || '' };
      });
    } catch (error) {
      setTicketsError(error.message || 'Unable to load tickets.');
    } finally {
      setTicketsLoading(false);
    }
  }, [currentUser?.email, isAllPropertiesSelected, selectedPropertyId, taskPropertyIds]);

  useEffect(() => {
    if (activeTab !== 'tickets') return;
    loadTickets();
  }, [activeTab, loadTickets]);

  const updateTaskDraft = (field, value) => {
    setTasksError(null);
    setTasksNotice(null);
    setTaskDraft((current) => ({ ...current, [field]: value }));
  };

  const updateTaskField = (taskId, field, value) => {
    setTasksError(null);
    setTasksNotice(null);
    setTasks((current) => current.map((task) => (
      task.id === taskId ? { ...task, [field]: value } : task
    )));
  };

  const createTask = async () => {
    const title = taskDraft.title.trim();
    if (!title) {
      setTasksError('Add a task title before creating it.');
      return;
    }
    if (!taskDraft.propertyId || !taskPropertyIds.has(taskDraft.propertyId)) {
      setTasksError('Choose one of your active properties for this task.');
      return;
    }
    if (!currentUser?.id || !supabase) {
      setTasksError('Tasks require a signed-in Supabase account.');
      return;
    }

    setTasksSaving(true);
    setTasksError(null);
    setTasksNotice(null);

    try {
      const response = await supabase
        .from('user_tasks')
        .insert({
          owner_user_id: currentUser.id,
          property_id: taskDraft.propertyId,
          title,
          description: taskDraft.description.trim(),
          notes: taskDraft.notes.trim(),
          due_date: taskDraft.dueDate || null,
          status: taskDraft.status,
        })
        .select('id, owner_user_id, property_id, title, description, notes, due_date, status, created_at, updated_at')
        .single();

      if (response.error) {
        throw response.error;
      }

      const savedTask = normalizeTaskRecord(response.data);
      setTasks((current) => [savedTask, ...current]);
      setTaskDraft(createEmptyTaskDraft(selectedPropertyId || taskDraft.propertyId));
      setTasksNotice('Task created.');
    } catch (error) {
      setTasksError(error.message || 'Unable to create the task.');
    } finally {
      setTasksSaving(false);
    }
  };

  const saveTask = async (task) => {
    if (!task?.id) return;
    if (!task.title.trim()) {
      setTasksError('Task titles cannot be blank.');
      return;
    }
    if (!task.propertyId || !taskPropertyIds.has(task.propertyId)) {
      setTasksError('Choose one of your active properties for this task.');
      return;
    }
    if (!currentUser?.id || !supabase) {
      setTasksError('Tasks require a signed-in Supabase account.');
      return;
    }

    setTasksSaving(true);
    setTasksError(null);
    setTasksNotice(null);

    try {
      const response = await supabase
        .from('user_tasks')
        .update({
          property_id: task.propertyId,
          title: task.title.trim(),
          description: task.description.trim(),
          notes: task.notes.trim(),
          due_date: task.dueDate || null,
          status: task.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
        .eq('owner_user_id', currentUser.id)
        .select('id, owner_user_id, property_id, title, description, notes, due_date, status, created_at, updated_at')
        .single();

      if (response.error) {
        throw response.error;
      }

      const savedTask = normalizeTaskRecord(response.data);
      setTasks((current) => current.map((candidate) => (
        candidate.id === savedTask.id ? savedTask : candidate
      )));
      setTasksNotice('Task updated.');
    } catch (error) {
      setTasksError(error.message || 'Unable to update the task.');
    } finally {
      setTasksSaving(false);
    }
  };

  const deleteTask = async (taskId) => {
    if (!taskId || !currentUser?.id || !supabase) return;
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (task && !window.confirm(`Delete "${task.title}"?`)) return;

    setTasksSaving(true);
    setTasksError(null);
    setTasksNotice(null);

    try {
      const response = await supabase
        .from('user_tasks')
        .delete()
        .eq('id', taskId)
        .eq('owner_user_id', currentUser.id);

      if (response.error) {
        throw response.error;
      }

      setTasks((current) => current.filter((candidate) => candidate.id !== taskId));
      setTasksNotice('Task deleted.');
    } catch (error) {
      setTasksError(error.message || 'Unable to delete the task.');
    } finally {
      setTasksSaving(false);
    }
  };

  const updateTicketDraft = (field, value) => {
    setTicketsError(null);
    setTicketsNotice(null);
    setTicketDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === 'propertyId') {
        next.assignedUserId = ticketAssignmentByPropertyId.get(value) || '';
      }
      return next;
    });
  };

  const updateTicketField = (ticketId, field, value) => {
    setTicketsError(null);
    setTicketsNotice(null);
    setTickets((current) => current.map((ticket) => (
      ticket.id === ticketId ? { ...ticket, [field]: value } : ticket
    )));
  };

  const createTicket = async () => {
    const title = ticketDraft.title.trim();
    if (!title) {
      setTicketsError('Add a ticket title before submitting it.');
      return;
    }
    if (!ticketDraft.propertyId || !taskPropertyIds.has(ticketDraft.propertyId)) {
      setTicketsError('Choose one of your active properties for this ticket.');
      return;
    }
    if (!ticketDraft.dueAt) {
      setTicketsError('Choose a due date and time at least 24 hours from now.');
      return;
    }
    const dueDate = new Date(ticketDraft.dueAt);
    if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
      setTicketsError('Ticket due date must be at least 24 hours in the future.');
      return;
    }
    if (!TICKETS_BASE_URL) {
      setTicketsError('Ticket endpoint is not configured.');
      return;
    }

    setTicketsSaving(true);
    setTicketsError(null);
    setTicketsNotice(null);

    try {
      const response = await authFetch(TICKETS_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: ticketDraft.description.trim(),
          propertyId: ticketDraft.propertyId,
          requesterEmail: ticketDraft.requesterEmail.trim() || currentUser?.email || '',
          assignedUserId: ticketDraft.assignedUserId || undefined,
          dueAt: dueDate.toISOString(),
          category: ticketDraft.category,
          priority: ticketDraft.priority,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || payload?.message || `Ticket submit failed: ${response.status}`);
      }

      const savedTicket = normalizeTicketRecord(payload.ticket);
      setTickets((current) => [savedTicket, ...current]);
      if (payload.task) {
        const savedTask = normalizeTaskRecord(payload.task);
        setTasks((current) => (
          current.some((task) => task.id === savedTask.id) ? current : [savedTask, ...current]
        ));
      }
      setTicketDraft(createEmptyTicketDraft(ticketDraft.propertyId, currentUser?.email || ''));
      setTicketsNotice('Ticket submitted and task created.');
    } catch (error) {
      setTicketsError(error.message || 'Unable to submit the ticket.');
    } finally {
      setTicketsSaving(false);
    }
  };

  const saveTicket = async (ticket) => {
    if (!ticket?.id || !TICKETS_BASE_URL) return;
    if (!ticket.title.trim()) {
      setTicketsError('Ticket titles cannot be blank.');
      return;
    }

    setTicketsSaving(true);
    setTicketsError(null);
    setTicketsNotice(null);

    try {
      const dueDate = ticket.dueAt ? new Date(ticket.dueAt) : null;
      const response = await authFetch(`${TICKETS_BASE_URL}/${ticket.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: ticket.title.trim(),
          description: ticket.description.trim(),
          status: ticket.status,
          priority: ticket.priority,
          category: ticket.category,
          assignedUserId: ticket.assignedUserId || undefined,
          dueAt: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString() : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || payload?.message || `Ticket update failed: ${response.status}`);
      }

      const savedTicket = normalizeTicketRecord(payload.ticket);
      setTickets((current) => current.map((candidate) => (
        candidate.id === savedTicket.id ? savedTicket : candidate
      )));
      if (payload.task) {
        const savedTask = normalizeTaskRecord(payload.task);
        setTasks((current) => current.map((candidate) => (
          candidate.id === savedTask.id ? savedTask : candidate
        )));
      }
      setTicketsNotice('Ticket updated.');
    } catch (error) {
      setTicketsError(error.message || 'Unable to update the ticket.');
    } finally {
      setTicketsSaving(false);
    }
  };

  const updateMarketingBudgetDraft = (field, value) => {
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);
    setMarketingBudgetDraft((current) => ({ ...current, [field]: value }));
  };

  const updateMarketingBudgetField = (itemId, field, value) => {
    if (itemId && LOCKED_MARKETING_BUDGET_FIELDS.has(field)) return;
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);
    setMarketingBudgetItems((current) => current.map((item) => (
      item.id === itemId ? { ...item, [field]: value } : item
    )));
  };

  const updatePropertyBudgetTableSort = (key) => {
    const defaultDirection = ['startDate', 'endDate', 'monthlyAmount', 'updatedAt'].includes(key) ? 'desc' : 'asc';
    setPropertyBudgetTableSort((current) => (
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultDirection }
    ));
  };

  const getPropertyBudgetSortLabel = (key) => {
    if (propertyBudgetTableSort.key !== key) return '';
    return propertyBudgetTableSort.direction === 'asc' ? 'ascending' : 'descending';
  };

  const getPropertyBudgetAriaSort = (key) => {
    if (propertyBudgetTableSort.key !== key) return 'none';
    return propertyBudgetTableSort.direction === 'asc' ? 'ascending' : 'descending';
  };

  const renderPropertyBudgetSortHeader = (key, label) => (
    <button
      type="button"
      className={`property-budget-sort ${propertyBudgetTableSort.key === key ? 'is-active' : ''}`}
      onClick={() => updatePropertyBudgetTableSort(key)}
      aria-label={`Sort budget items by ${label}${getPropertyBudgetSortLabel(key) ? `, currently ${getPropertyBudgetSortLabel(key)}` : ''}`}
    >
      <span>{label}</span>
      <ChevronDown
        size={13}
        className={`property-budget-sort__icon ${propertyBudgetTableSort.direction === 'asc' ? 'is-ascending' : ''}`}
        aria-hidden="true"
      />
    </button>
  );

  const validateMarketingBudgetFile = (file) => {
    if (!file) return null;
    if (!MARKETING_BUDGET_CONTRACT_ALLOWED_TYPES.has(file.type)) {
      return 'Use a PDF, Word doc, JPG, PNG, or WEBP file for the contract.';
    }
    if (file.size > MARKETING_BUDGET_CONTRACT_MAX_BYTES) {
      return 'Keep contract uploads under 15 MB.';
    }
    return null;
  };

  const saveMarketingBudgetItem = async (item, contractFile = null) => {
    if (!propertyScopedSelectionId || !currentUser?.id || !supabase) {
      setMarketingBudgetError('Choose a single property before saving a marketing budget item.');
      return;
    }

    const isExistingItem = Boolean(item.id);
    const itemName = String(item.itemName || '').trim();
    const startDate = item.startDate || '';
    const monthlyAmount = parseCurrency(item.monthlyAmount);
    const status = MARKETING_BUDGET_STATUS_IDS.includes(item.status) ? item.status : 'new';
    const fileError = validateMarketingBudgetFile(contractFile);

    if (!isExistingItem && !itemName) {
      setMarketingBudgetError('Add an item name before saving.');
      return;
    }
    if (!isExistingItem && !isDateInputValue(startDate)) {
      setMarketingBudgetError('Add a valid start date before saving.');
      return;
    }
    if (!isExistingItem && String(item.monthlyAmount ?? '').trim() === '') {
      setMarketingBudgetError('Add a monthly amount before saving.');
      return;
    }
    if (!isExistingItem && (!Number.isFinite(monthlyAmount) || monthlyAmount < 0)) {
      setMarketingBudgetError('Add a valid monthly amount before saving.');
      return;
    }
    if (!isExistingItem && item.endDate && !isDateInputValue(item.endDate)) {
      setMarketingBudgetError('End date must be blank or a valid date.');
      return;
    }
    if (fileError) {
      setMarketingBudgetError(fileError);
      return;
    }

    setMarketingBudgetSaving(true);
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);

    try {
      const itemId = item.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`);
      let contractFileName = item.contractFileName || null;
      let contractStoragePath = item.contractStoragePath || null;
      let contractMimeType = item.contractMimeType || null;

      if (contractFile) {
        contractStoragePath = createMarketingBudgetContractPath(propertyScopedSelectionId, itemId, contractFile);
        contractFileName = contractFile.name;
        contractMimeType = contractFile.type;

        const uploadResponse = await supabase.storage
          .from(MARKETING_BUDGET_CONTRACT_BUCKET)
          .upload(contractStoragePath, contractFile, { upsert: true });

        if (uploadResponse.error) {
          throw new Error(uploadResponse.error.message || 'Unable to upload the contract.');
        }
      }

      const payload = {
        property_id: propertyScopedSelectionId,
        status,
        listing_url: String(item.listingUrl || '').trim() || null,
        contract_file_name: contractFileName,
        contract_storage_path: contractStoragePath,
        contract_mime_type: contractMimeType,
        notes: String(item.notes || '').trim(),
        updated_by: currentUser.id,
        updated_at: new Date().toISOString(),
      };
      if (!isExistingItem) {
        payload.item_name = itemName;
        payload.monthly_amount = monthlyAmount;
        payload.start_date = startDate;
        payload.end_date = item.endDate || null;
      }

      const response = isExistingItem
        ? await supabase
            .from('property_marketing_budget_items')
            .update(payload)
            .eq('id', item.id)
            .eq('property_id', propertyScopedSelectionId)
            .select(MARKETING_BUDGET_SELECT_COLUMNS)
            .single()
        : await supabase
            .from('property_marketing_budget_items')
            .insert({
              id: itemId,
              ...payload,
              created_by: currentUser.id,
            })
            .select(MARKETING_BUDGET_SELECT_COLUMNS)
            .single();

      if (response.error) {
        throw response.error;
      }

      const savedItem = normalizeMarketingBudgetRecord(response.data);
      setMarketingBudgetItems((current) => {
        const nextItems = item.id
          ? current.map((candidate) => (candidate.id === savedItem.id ? savedItem : candidate))
          : [savedItem, ...current];
        return nextItems.sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
      });
      if (!item.id) {
        setMarketingBudgetDraft(createEmptyMarketingBudgetDraft(propertyScopedSelectionId));
      }
      setMarketingBudgetNotice(contractFile ? 'Budget item and contract saved.' : 'Budget item saved.');
    } catch (error) {
      setMarketingBudgetError(error.message || 'Unable to save the marketing budget item.');
    } finally {
      setMarketingBudgetSaving(false);
    }
  };

  const deleteMarketingBudgetItem = async (itemId) => {
    if (!itemId || !propertyScopedSelectionId || !supabase) return;
    const item = marketingBudgetItems.find((candidate) => candidate.id === itemId);
    if (item && !window.confirm(`Delete "${item.itemName}"?`)) return;

    setMarketingBudgetSaving(true);
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);

    try {
      const response = await supabase
        .from('property_marketing_budget_items')
        .delete()
        .eq('id', itemId)
        .eq('property_id', propertyScopedSelectionId);

      if (response.error) {
        throw response.error;
      }

      if (item?.contractStoragePath) {
        await supabase.storage.from(MARKETING_BUDGET_CONTRACT_BUCKET).remove([item.contractStoragePath]);
      }

      setMarketingBudgetItems((current) => current.filter((candidate) => candidate.id !== itemId));
      setMarketingBudgetNotice('Budget item deleted.');
    } catch (error) {
      setMarketingBudgetError(error.message || 'Unable to delete the marketing budget item.');
    } finally {
      setMarketingBudgetSaving(false);
    }
  };

  const openMarketingBudgetContract = async (item) => {
    if (!item?.contractStoragePath || !supabase) return;

    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);

    try {
      const response = await supabase.storage
        .from(MARKETING_BUDGET_CONTRACT_BUCKET)
        .createSignedUrl(item.contractStoragePath, 60);
      if (response.error) {
        throw response.error;
      }
      if (response.data?.signedUrl) {
        window.open(response.data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (error) {
      setMarketingBudgetError(error.message || 'Unable to open the contract file.');
    }
  };

  const removeMarketingBudgetContract = async (item) => {
    if (!item?.id || !propertyScopedSelectionId || !supabase) return;
    if (!item.contractStoragePath && !item.contractFileName) return;
    if (!window.confirm(`Remove the uploaded contract from "${item.itemName || 'this budget item'}"?`)) return;

    setMarketingBudgetSaving(true);
    setMarketingBudgetError(null);
    setMarketingBudgetNotice(null);

    try {
      if (item.contractStoragePath) {
        const removeResponse = await supabase.storage
          .from(MARKETING_BUDGET_CONTRACT_BUCKET)
          .remove([item.contractStoragePath]);

        if (removeResponse.error) {
          throw removeResponse.error;
        }
      }

      const response = await supabase
        .from('property_marketing_budget_items')
        .update({
          contract_file_name: null,
          contract_storage_path: null,
          contract_mime_type: null,
          updated_by: currentUser?.id || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('property_id', propertyScopedSelectionId)
        .select(MARKETING_BUDGET_SELECT_COLUMNS)
        .single();

      if (response.error) {
        throw response.error;
      }

      const savedItem = normalizeMarketingBudgetRecord(response.data);
      setMarketingBudgetItems((current) => current.map((candidate) => (
        candidate.id === savedItem.id ? savedItem : candidate
      )));
      setMarketingBudgetNotice('Contract file removed.');
    } catch (error) {
      setMarketingBudgetError(error.message || 'Unable to remove the contract file.');
    } finally {
      setMarketingBudgetSaving(false);
    }
  };

  // Derived Date Range
  const rangeDates = useMemo(() => {
    const end = new Date();
    let start = new Date();
    if (dateRange === '7d') start.setDate(end.getDate() - 6);
    else if (dateRange === '14d') start.setDate(end.getDate() - 13);
    else if (dateRange === '28d') start.setDate(end.getDate() - 27);
    else if (dateRange === '30d') start.setDate(end.getDate() - 29);
    else if (dateRange === '90d') start.setDate(end.getDate() - 89);
    else if (dateRange === '365d') start.setDate(end.getDate() - 364);
    else if (dateRange === 'lastMonth') {
      start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      end.setDate(0); // last day of previous month
    }
    else if (dateRange === 'quarterToDate') {
      const quarterStartMonth = Math.floor(end.getMonth() / 3) * 3;
      start = new Date(end.getFullYear(), quarterStartMonth, 1);
    }
    else if (dateRange === 'yearToDate') {
      start = new Date(end.getFullYear(), 0, 1);
    }
    else if (dateRange === 'custom' && customRange.start) {
      const parsedStart = parseLocalDateInputValue(customRange.start);
      const parsedEnd = parseLocalDateInputValue(customRange.end);
      if (parsedStart) start.setTime(parsedStart.getTime());
      if (parsedEnd) end.setTime(parsedEnd.getTime());
      if (start > end) {
        const originalStart = new Date(start);
        start.setTime(end.getTime());
        end.setTime(originalStart.getTime());
      }
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [dateRange, customRange]);

  useEffect(() => {
    let cancelled = false;

    const loadPropertyOverview = async () => {
      if (!shouldLoadReportingOverview) {
        setLoading(false);
        setInvoiceLoading(false);
        setPropertyInfoLoading(false);
        setRoiLoading(false);
        return;
      }

      if (!propertyScopedSelectionId) {
        setParentDocs([]);
        setLeadItems([]);
        setEventItems([]);
        setLeaseItems([]);
        setPreleaseLeaseItems([]);
        setPriorPreleaseLeaseItems([]);
        setConventionalLeaseItems([]);
        setLead60DayItems([]);
        setEvent60DayItems([]);
        setStudentPreleaseCycle(null);
        setConventionalOccupancyWindow(null);
        setReportingPortfolio('student');
        setRedListSummary(null);
        setInvoiceItems([]);
        setAvailabilityPricingSnapshot(null);
        setSpecialsSnapshot(null);
        setLatestAvailabilityDate(null);
        setRoiDailyItems([]);
        setReportingDataSource('error');
        setLoading(false);
        setInvoiceLoading(false);
        setPropertyInfoLoading(false);
        setRoiLoading(false);
        return;
      }

      if (!reportingUsesStagedOverview) {
        setParentDocs([]);
        setLeadItems([]);
        setEventItems([]);
        setLeaseItems([]);
        setPreleaseLeaseItems([]);
        setPriorPreleaseLeaseItems([]);
        setConventionalLeaseItems([]);
        setLead60DayItems([]);
        setEvent60DayItems([]);
        setStudentPreleaseCycle(null);
        setConventionalOccupancyWindow(null);
        setReportingPortfolio('student');
        setRedListSummary(null);
        setInvoiceItems([]);
        setAvailabilityPricingSnapshot(null);
        setSpecialsSnapshot(null);
        setLatestAvailabilityDate(null);
        setRoiDailyItems([]);
        setReportingDataSource('error');
        setLoading(false);
        setInvoiceLoading(false);
        setPropertyInfoLoading(false);
        setRoiLoading(false);
        return;
      }

      setReportingDataSource('loading');
      setLoading(true);
      setInvoiceLoading(true);
      setPropertyInfoLoading(true);
      setRoiLoading(true);

      try {
        const params = new URLSearchParams({
          property_id: isAllPropertiesSelected ? 'all' : selectedPropertyId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (isAllPropertiesSelected) {
          params.set('property_ids', JSON.stringify(availableProperties.map((property) => property.propertyId)));
        }
        const response = await authFetch(`${reportingOverviewUrl}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.message || `Property overview fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        setParentDocs(Array.isArray(payload.parent_docs) ? payload.parent_docs : []);
        setLeadItems(Array.isArray(payload.lead_items) ? payload.lead_items : []);
        setEventItems(Array.isArray(payload.event_items) ? payload.event_items : []);
        setLeaseItems(Array.isArray(payload.lease_items) ? payload.lease_items : []);
        setPreleaseLeaseItems(Array.isArray(payload.prelease_lease_items) ? payload.prelease_lease_items : []);
        setPriorPreleaseLeaseItems(Array.isArray(payload.prior_prelease_lease_items) ? payload.prior_prelease_lease_items : []);
        setConventionalLeaseItems(Array.isArray(payload.conventional_lease_items) ? payload.conventional_lease_items : []);
        setLead60DayItems(Array.isArray(payload.lead_60_day_items) ? payload.lead_60_day_items : []);
        setEvent60DayItems(Array.isArray(payload.event_60_day_items) ? payload.event_60_day_items : []);
        setStudentPreleaseCycle(payload.student_prelease_cycle || null);
        setConventionalOccupancyWindow(payload.conventional_occupancy_window || null);
        setReportingPortfolio(payload.portfolio || payload.availability_pricing_snapshot?.portfolio || 'student');
        setRedListSummary(payload.red_list_summary || null);
        if (Array.isArray(payload.red_list_summaries)) {
          setRedListPortfolioSummaries(payload.red_list_summaries);
        }
        setInvoiceItems(Array.isArray(payload.invoice_items) ? payload.invoice_items : []);
        setAvailabilityPricingSnapshot(payload.availability_pricing_snapshot || null);
        setSpecialsSnapshot(payload.specials_snapshot || null);
        setLatestAvailabilityDate(payload.latest_availability_date || null);
        setRoiDailyItems(Array.isArray(payload.roi_daily_items) ? payload.roi_daily_items : []);
        setReportingDataSource('staged');
        setLoading(false);
        setInvoiceLoading(false);
        setPropertyInfoLoading(false);
        setRoiLoading(false);
      } catch (error) {
        console.error('Property overview fetch failed in staged mode', error);
        if (!cancelled) {
          setParentDocs([]);
          setLeadItems([]);
          setEventItems([]);
          setLeaseItems([]);
          setPreleaseLeaseItems([]);
          setPriorPreleaseLeaseItems([]);
          setConventionalLeaseItems([]);
          setLead60DayItems([]);
          setEvent60DayItems([]);
          setStudentPreleaseCycle(null);
          setConventionalOccupancyWindow(null);
          setReportingPortfolio('student');
          setRedListSummary(null);
          setInvoiceItems([]);
          setAvailabilityPricingSnapshot(null);
          setSpecialsSnapshot(null);
          setLatestAvailabilityDate(null);
          setRoiDailyItems([]);
          setReportingDataSource('error');
          setLoading(false);
          setInvoiceLoading(false);
          setPropertyInfoLoading(false);
          setRoiLoading(false);
        }
      }
    };

    loadPropertyOverview();
    return () => {
      cancelled = true;
    };
  }, [availableProperties, isAllPropertiesSelected, propertyScopedSelectionId, rangeDates, reportingOverviewUrl, selectedPropertyId, reportingUsesStagedOverview, shouldLoadReportingOverview]);

  useEffect(() => {
    let cancelled = false;

    const loadRedListPortfolio = async () => {
      if (!canManageUsers || activeTab !== 'red-list' || !reportingOverviewUrl || availableProperties.length === 0) {
        if (!cancelled && activeTab !== 'red-list') {
          setRedListPortfolioError(null);
        }
        return;
      }

      setRedListPortfolioLoading(true);
      setRedListPortfolioError(null);

      try {
        const redListEndDate = new Date();
        redListEndDate.setHours(23, 59, 59, 999);
        const params = new URLSearchParams({
          property_id: 'all',
          property_ids: JSON.stringify(availableProperties.map((property) => property.propertyId)),
          end_date: formatDateInputValue(redListEndDate),
          red_list_only: '1',
        });
        const response = await authFetch(`${reportingOverviewUrl}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.message || `Red list fetch failed: ${response.status}`);
        }
        if (cancelled) return;
        setRedListPortfolioSummaries(Array.isArray(payload.red_list_summaries) ? payload.red_list_summaries : []);
      } catch (error) {
        if (!cancelled) {
          setRedListPortfolioSummaries([]);
          setRedListPortfolioError(error.message || 'Unable to load red list summary.');
        }
      } finally {
        if (!cancelled) setRedListPortfolioLoading(false);
      }
    };

    loadRedListPortfolio();
    return () => {
      cancelled = true;
    };
  }, [activeTab, availableProperties, canManageUsers, reportingOverviewUrl]);

  useEffect(() => {
    let cancelled = false;

    const loadWebsiteManager = async () => {
      if (!shouldLoadWebsiteManagerContent) {
        setWebsiteManagerLoading(false);
        return;
      }

      if (!selectedPropertyId) {
        const fallback = normalizeWebsiteManagerRecord(null);
        setWebsiteManagerDoc(fallback);
        setWebsiteManagerDraft(fallback);
        setWebsiteManagerError('No property is currently available for this account.');
        setWebsiteManagerLoading(false);
        return;
      }

      if (!websiteManagerUsesStagedAdapter) {
        const fallback = normalizeWebsiteManagerRecord(null);
        setWebsiteManagerDoc(fallback);
        setWebsiteManagerDraft(fallback);
        setWebsiteManagerError('Website editor endpoint is not configured.');
        setWebsiteManagerLoading(false);
        return;
      }

      setWebsiteManagerLoading(true);
      setWebsiteManagerError(null);
      setWebsiteManagerNotice(null);

      try {
        const params = new URLSearchParams({ property_id: propertyScopedSelectionId });
        const response = await authFetch(`${WEBSITE_MANAGER_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Website editor fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        const normalized = normalizeWebsiteManagerRecord(payload.record);
        setWebsiteManagerDoc(normalized);
        setWebsiteManagerDraft(normalized);
        setWebsiteManagerLoading(false);
      } catch (error) {
        console.error('Website editor staged fetch failed', error);
        if (cancelled) return;
        const fallback = normalizeWebsiteManagerRecord(null);
        setWebsiteManagerDoc(fallback);
        setWebsiteManagerDraft(fallback);
        setWebsiteManagerError('Unable to load website editor content from the staged adapter.');
        setWebsiteManagerLoading(false);
      }
    };

    loadWebsiteManager();
    return () => {
      cancelled = true;
    };
  }, [propertyScopedSelectionId, selectedPropertyId, shouldLoadWebsiteManagerContent, websiteManagerUsesStagedAdapter]);

  useEffect(() => {
    let cancelled = false;

    const loadHeatmapSite = async () => {
      if (!shouldLoadWebsiteExperienceConfig) {
        setHeatmapSiteLoading(false);
        return;
      }

      if (!propertyScopedSelectionId) {
        const fallback = normalizeHeatmapSiteConfig(null);
        setHeatmapSiteDoc(fallback);
        setHeatmapSiteDraft(fallback);
        setHeatmapSiteError(null);
        setHeatmapSiteLoading(false);
        return;
      }

      if (!HEATMAP_SITES_URL) {
        const fallback = normalizeHeatmapSiteConfig(null);
        setHeatmapSiteDoc(fallback);
        setHeatmapSiteDraft(fallback);
        setHeatmapSiteError('Heatmap site configuration endpoint is not configured.');
        setHeatmapSiteLoading(false);
        return;
      }

      setHeatmapSiteLoading(true);
      setHeatmapSiteError(null);
      setHeatmapSiteNotice(null);

      try {
        const params = new URLSearchParams({ property_id: propertyScopedSelectionId });
        const response = await authFetch(`${HEATMAP_SITES_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Tracking site fetch failed: ${response.status}`);
        }
        if (cancelled) return;
        const primarySite = Array.isArray(payload.sites) ? payload.sites[0] : null;
        const normalized = normalizeHeatmapSiteConfig(primarySite);
        if (!normalized.name) normalized.name = selectedProperty?.name || 'Selected property';
        if (normalized.allowedDomains.length === 0) {
          const host = getHostnameFromUrl(websiteManagerDoc.websiteUrl);
          if (host) normalized.allowedDomains = [host];
        }
        setHeatmapSiteDoc(normalized);
        setHeatmapSiteDraft(normalized);
        setHeatmapSiteLoading(false);
      } catch (error) {
        console.error('Tracking site config fetch failed', error);
        if (cancelled) return;
        const fallback = normalizeHeatmapSiteConfig(null);
        setHeatmapSiteDoc(fallback);
        setHeatmapSiteDraft(fallback);
        setHeatmapSiteError('Unable to load tracking site configuration.');
        setHeatmapSiteLoading(false);
      }
    };

    loadHeatmapSite();
    return () => {
      cancelled = true;
    };
  }, [propertyScopedSelectionId, selectedProperty?.name, shouldLoadWebsiteExperienceConfig, websiteManagerDoc.websiteUrl]);

  useEffect(() => {
    setReportingTabSummaryBypass(false);
  }, [activeTab, propertyScopedSelectionId, rangeDates]);

  useEffect(() => {
    if (!shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setGa4Data(null);
      setGoogleAdsData(null);
      setMetaAdsData(null);
      setLocalFalconData(null);
      setReputationData(null);
      return;
    }

    const includeAnalytics = reportingTabSummarySections.includes('analytics');
    const includeReputation = reportingTabSummarySections.includes('reputation');
    const controller = new AbortController();

    const applySummaryEntry = (entry, setData, setError, fallbackMessage) => {
      if (entry?.status === 'ok' && entry.payload) {
        setData(entry.payload);
        setError(null);
        return;
      }
      setData(null);
      setError(entry?.error || fallbackMessage);
    };

    const loadReportingTabSummary = async () => {
      if (includeAnalytics) {
        setGa4Loading(true);
        setGoogleAdsLoading(true);
        setMetaAdsLoading(true);
        setLocalFalconLoading(true);
        setGa4Error(null);
        setGoogleAdsError(null);
        setMetaAdsError(null);
        setLocalFalconError(null);
      }
      if (includeReputation) {
        setReputationLoading(true);
        setReputationError(null);
      }

      try {
        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          sections: reportingTabSummarySections,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });

        const response = await authFetch(`${reportingTabSummaryUrl}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Reporting summary fetch failed: ${response.status}`);
        }

        if (includeAnalytics) {
          const analytics = payload.analytics || {};
          applySummaryEntry(analytics.ga4, setGa4Data, setGa4Error, 'No cached GA4 summary is available yet.');
          applySummaryEntry(analytics.googleAds, setGoogleAdsData, setGoogleAdsError, 'No cached Google Ads summary is available yet.');
          applySummaryEntry(analytics.metaAds, setMetaAdsData, setMetaAdsError, 'No cached Meta Ads summary is available yet.');
          applySummaryEntry(analytics.localFalcon, setLocalFalconData, setLocalFalconError, 'No cached Local Falcon summary is available yet.');
        }

        if (includeReputation) {
          if (selectedProperty?.opiniionSkip) {
            setReputationData(null);
            setReputationError('This property is intentionally excluded from Opiniion mapping.');
          } else {
            applySummaryEntry(payload.reputation, setReputationData, setReputationError, 'No cached reputation summary is available yet.');
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Reporting tab summary fetch failed', error);
        setReportingTabSummaryBypass(true);
        if (includeAnalytics) {
          setGa4Error(error.message || 'Unable to load analytics summary.');
          setGoogleAdsError(error.message || 'Unable to load paid search summary.');
          setMetaAdsError(error.message || 'Unable to load paid social summary.');
          setLocalFalconError(error.message || 'Unable to load local SEO summary.');
        }
        if (includeReputation) {
          setReputationError(error.message || 'Unable to load reputation summary.');
        }
      } finally {
        if (!controller.signal.aborted) {
          if (includeAnalytics) {
            setGa4Loading(false);
            setGoogleAdsLoading(false);
            setMetaAdsLoading(false);
            setLocalFalconLoading(false);
          }
          if (includeReputation) {
            setReputationLoading(false);
          }
        }
      }
    };

    loadReportingTabSummary();
    return () => controller.abort();
  }, [
    propertyScopedSelectionId,
    rangeDates,
    reportingTabSummarySections,
    reportingTabSummaryUrl,
    selectedProperty?.opiniionSkip,
    shouldLoadReportingTabSummary,
  ]);

  useEffect(() => {
    setWebsiteSchemaHistory(readWebsiteSchemaHistory(propertyScopedSelectionId));
  }, [propertyScopedSelectionId]);

  useEffect(() => {
    let cancelled = false;

    const loadWebsiteSchema = async () => {
      if (!shouldLoadWebsiteManagerContent) {
        setWebsiteSchemaLoading(false);
        return;
      }

      if (!propertyScopedSelectionId || !canManageUsers) {
        const fallback = normalizeWebsiteManagerSchema(null);
        setWebsiteSchemaDoc(fallback);
        setWebsiteSchemaDraft(fallback);
        setWebsiteSchemaLoading(false);
        return;
      }

      if (!websiteManagerSchemaUsesStagedAdapter) {
        const fallback = normalizeWebsiteManagerSchema(null);
        setWebsiteSchemaDoc(fallback);
        setWebsiteSchemaDraft(fallback);
        setWebsiteSchemaError('Website schema endpoint is not configured.');
        setWebsiteSchemaLoading(false);
        return;
      }

      setWebsiteSchemaLoading(true);
      setWebsiteSchemaError(null);
      setWebsiteSchemaNotice(null);

      try {
        const params = new URLSearchParams({ property_id: propertyScopedSelectionId });
        const response = await authFetch(`${WEBSITE_MANAGER_SCHEMA_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Website schema fetch failed: ${response.status}`);
        }
        if (cancelled) return;
        const normalized = normalizeWebsiteManagerSchema(payload?.record?.schema);
        setWebsiteSchemaDoc(normalized);
        setWebsiteSchemaDraft(normalized);
      } catch (error) {
        if (cancelled) return;
        setWebsiteSchemaError(error.message || 'Unable to load the website field schema.');
        const fallback = normalizeWebsiteManagerSchema(null);
        setWebsiteSchemaDoc(fallback);
        setWebsiteSchemaDraft(fallback);
      } finally {
        if (!cancelled) {
          setWebsiteSchemaLoading(false);
        }
      }
    };

    loadWebsiteSchema();
    return () => {
      cancelled = true;
    };
  }, [propertyScopedSelectionId, canManageUsers, shouldLoadWebsiteManagerContent, websiteManagerSchemaUsesStagedAdapter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      setRoiPipelineStatusLoading(true);
      if (!ROI_PIPELINE_STATUS_URL) {
        if (!cancelled) {
          setRoiPipelineStatus(null);
          setRoiPipelineStatusLoading(false);
        }
        return;
      }
      try {
        const response = await authFetch(ROI_PIPELINE_STATUS_URL);
        if (!response.ok) throw new Error(`Status fetch failed: ${response.status}`);
        const payload = await response.json();
        if (!cancelled) {
          setRoiPipelineStatus(payload);
        }
      } catch {
        if (!cancelled) {
          setRoiPipelineStatus(null);
        }
      } finally {
        if (!cancelled) {
          setRoiPipelineStatusLoading(false);
        }
      }
    };

    loadStatus();
    const intervalId = window.setInterval(loadStatus, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!shouldLoadChannelAnalytics) {
      setGa4Loading(false);
      return;
    }

    if (shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setGa4Data(null);
      setGa4Error(null);
      setGa4Loading(false);
      return;
    }

    const ga4PropertyId = selectedProperty?.googleAnalyticsId;
    if (!ga4PropertyId) {
      setGa4Data(null);
      setGa4Error('No GA4 property ID is configured for this property.');
      setGa4Loading(false);
      return;
    }

    const controller = new AbortController();
    const loadGa4Data = async () => {
      setGa4Loading(true);
      setGa4Error(null);

      try {
        if (!GA4_DASHBOARD_URL) {
          throw new Error('GA4 endpoint is not configured. Set VITE_GA4_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          ga4_property_id: ga4PropertyId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end)
        });
        const response = await authFetch(`${GA4_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `GA4 fetch failed: ${response.status}`);
        }
        setGa4Data(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('GA4 dashboard fetch failed', error);
        setGa4Data(null);
        setGa4Error(error.message || 'Unable to load GA4 analytics. The staged adapter may not be reachable yet.');
      } finally {
        setGa4Loading(false);
      }
    };

    loadGa4Data();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, selectedProperty, shouldLoadChannelAnalytics, shouldLoadReportingTabSummary]);

  useEffect(() => {
    if (!shouldLoadChannelAnalytics) {
      setGoogleAdsLoading(false);
      return;
    }

    if (shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setGoogleAdsData(null);
      setGoogleAdsError(null);
      setGoogleAdsLoading(false);
      return;
    }

    const googleAdsCustomerId = selectedProperty?.googleAdsId;
    if (!googleAdsCustomerId) {
      setGoogleAdsData(null);
      setGoogleAdsError('No Google Ads customer ID is configured for this property.');
      setGoogleAdsLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadGoogleAdsData = async () => {
      setGoogleAdsLoading(true);
      setGoogleAdsError(null);

      try {
        if (!GOOGLE_ADS_DASHBOARD_URL) {
          throw new Error('Google Ads endpoint is not configured. Set VITE_GOOGLE_ADS_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          google_ads_customer_id: googleAdsCustomerId,
          property_name: selectedProperty?.name || '',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end)
        });
        const response = await authFetch(`${GOOGLE_ADS_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Google Ads fetch failed: ${response.status}`);
        }
        setGoogleAdsData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Google Ads dashboard fetch failed', error);
        setGoogleAdsData(null);
        setGoogleAdsError(error.message || 'Unable to load Google Ads analytics. The staged adapter may not be reachable yet.');
      } finally {
        setGoogleAdsLoading(false);
      }
    };

    loadGoogleAdsData();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, selectedProperty, shouldLoadChannelAnalytics, shouldLoadReportingTabSummary]);

  useEffect(() => {
    if (!shouldLoadChannelAnalytics) {
      setMetaAdsLoading(false);
      return;
    }

    if (shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setMetaAdsData(null);
      setMetaAdsError(null);
      setMetaAdsLoading(false);
      return;
    }

    const metaAdsAccountId = selectedProperty?.metaAdsAccountId;
    if (!metaAdsAccountId) {
      setMetaAdsData(null);
      setMetaAdsError('No Meta Ads account ID is configured for this property.');
      setMetaAdsLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadMetaAdsData = async () => {
      setMetaAdsLoading(true);
      setMetaAdsError(null);

      try {
        if (!META_ADS_DASHBOARD_URL) {
          throw new Error('Meta Ads endpoint is not configured. Set VITE_META_ADS_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          meta_ads_account_id: metaAdsAccountId,
          property_name: selectedProperty?.name || '',
          attribution_mode: metaAdsAttributionMode,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end)
        });
        if (selectedProperty?.metaAdsCampaignIds?.length) {
          params.set('campaign_ids', JSON.stringify(selectedProperty.metaAdsCampaignIds));
        }
        if (selectedProperty?.metaAdsMatchTerms?.length) {
          params.set('match_terms', JSON.stringify(selectedProperty.metaAdsMatchTerms));
        }
        const response = await authFetch(`${META_ADS_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Meta Ads fetch failed: ${response.status}`);
        }
        setMetaAdsData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Meta Ads dashboard fetch failed', error);
        setMetaAdsData(null);
        setMetaAdsError(error.message || 'Unable to load Meta Ads analytics. The staged adapter may not be reachable yet.');
      } finally {
        setMetaAdsLoading(false);
      }
    };

    loadMetaAdsData();
    return () => controller.abort();
  }, [metaAdsAttributionMode, propertyScopedSelectionId, rangeDates, selectedProperty, shouldLoadChannelAnalytics, shouldLoadReportingTabSummary]);

  useEffect(() => {
    if (!shouldLoadReputationData) {
      setReputationLoading(false);
      return;
    }

    if (shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setReputationData(null);
      setReputationError(null);
      setReputationLoading(false);
      return;
    }

    if (selectedProperty?.opiniionSkip) {
      setReputationData(null);
      setReputationError('This property is intentionally excluded from Opiniion mapping.');
      setReputationLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadReputationData = async () => {
      setReputationLoading(true);
      setReputationError(null);

      try {
        if (!REPUTATION_DASHBOARD_URL) {
          throw new Error('Reputation endpoint is not configured. Set VITE_REPUTATION_DASHBOARD_URL to enable live refresh.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          property_name: selectedProperty?.name || '',
          property_city: selectedProperty?.city || '',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end)
        });
        if (selectedProperty?.opiniionLocationName) {
          params.set('location_name', selectedProperty.opiniionLocationName);
        }
        const response = await authFetch(`${REPUTATION_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Reputation fetch failed: ${response.status}`);
        }
        setReputationData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Reputation dashboard fetch failed', error);
        setReputationData(null);
        setReputationError(error.message || 'Unable to load reputation data. The staged adapter may not be reachable or the property may not be configured yet.');
      } finally {
        setReputationLoading(false);
      }
    };

    loadReputationData();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, selectedProperty, shouldLoadReputationData, shouldLoadReportingTabSummary]);

  useEffect(() => {
    if (!shouldLoadChannelAnalytics) {
      setLocalFalconLoading(false);
      return;
    }

    if (shouldLoadReportingTabSummary) {
      return;
    }

    if (!propertyScopedSelectionId) {
      setLocalFalconData(null);
      setLocalFalconError(null);
      setLocalFalconLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadLocalFalconData = async () => {
      setLocalFalconLoading(true);
      setLocalFalconError(null);

      try {
        if (!LOCAL_FALCON_DASHBOARD_URL) {
          throw new Error('Local Falcon endpoint is not configured. Set VITE_LOCAL_FALCON_DASHBOARD_URL to enable local SEO reporting.');
        }

        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          property_name: selectedProperty?.name || '',
          property_city: selectedProperty?.city || '',
          property_state: selectedProperty?.state || '',
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end)
        });
        if (selectedProperty?.localFalconPlaceId) {
          params.set('place_id', selectedProperty.localFalconPlaceId);
        }
        if (selectedProperty?.localFalconCampaignKey) {
          params.set('campaign_key', selectedProperty.localFalconCampaignKey);
        }
        if (selectedProperty?.localFalconKeyword) {
          params.set('keyword', selectedProperty.localFalconKeyword);
        }
        if (selectedProperty?.localFalconPlatform) {
          params.set('platform', selectedProperty.localFalconPlatform);
        }

        const response = await authFetch(`${LOCAL_FALCON_DASHBOARD_URL}?${params.toString()}`, {
          signal: controller.signal
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || `Local Falcon fetch failed: ${response.status}`);
        }
        setLocalFalconData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Local Falcon dashboard fetch failed', error);
        setLocalFalconData(null);
        setLocalFalconError(error.message || 'Unable to load Local Falcon data. The property may need a Local Falcon place ID mapping.');
      } finally {
        setLocalFalconLoading(false);
      }
    };

    loadLocalFalconData();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, selectedProperty, shouldLoadChannelAnalytics, shouldLoadReportingTabSummary]);

  // ──────────────── COMPUTED METRICS ────────────────
  
  const allCanonicalLeadItems = useMemo(() => {
    const canonicalLeads = new Map();
    leadItems.forEach((lead) => {
      const key = getLeadKey(lead);
      const current = canonicalLeads.get(key);
      if (!current) {
        canonicalLeads.set(key, lead);
        return;
      }

      const currentDate = current._date || '9999-12-31';
      const nextDate = lead._date || '9999-12-31';
      if (nextDate < currentDate) {
        canonicalLeads.set(key, lead);
      }
    });
    return Array.from(canonicalLeads.values());
  }, [leadItems]);

  const totalLeads = allCanonicalLeadItems.length;

  const completedApplicationRecords = useMemo(() => {
    const completedApplications = new Map();

    eventItems.forEach((event) => {
      if (!isStartedApplicationEvent(event)) return;
      const completedDate = getTrueEventOccurredDate(event);
      if (!isInDateRange(completedDate, rangeDates.start, rangeDates.end)) return;
      const key = getCompletedApplicationRecordKey(event);
      const existing = completedApplications.get(key);
      if (!existing || completedDate < existing.sortDate) {
        completedApplications.set(key, {
          key,
          sortDate: completedDate,
          date: completedDate,
          source: 'event',
          item: event
        });
      }
    });

    return Array.from(completedApplications.values());
  }, [eventItems, rangeDates]);

  const approvedLeaseRecords = useMemo(() => {
    const approvedLeases = new Map();

    eventItems.forEach((event) => {
      if (!isApprovedNewLeaseEvent(event)) return;
      const approvedDate = getTrueEventOccurredDate(event);
      if (!isInDateRange(approvedDate, rangeDates.start, rangeDates.end)) return;
      const key = getApprovedLeaseRecordKey(event);
      const existing = approvedLeases.get(key);
      if (!existing || approvedDate < existing.sortDate) {
        approvedLeases.set(key, {
          key,
          sortDate: approvedDate,
          date: approvedDate,
          source: 'event',
          item: event
        });
      }
    });

    return Array.from(approvedLeases.values());
  }, [eventItems, rangeDates]);

  const totalApplications = completedApplicationRecords.length;
  const totalLeases = approvedLeaseRecords.length;
  const funnelMetricSource = 'Entrata lead events: Online Guest Card, Application Status: Completed, Lease Status: Approved';

  const normalizedInvoiceItems = useMemo(() => {
    const uniqueInvoices = new Map();

    invoiceItems.forEach((invoice) => {
      const key = getInvoiceKey(invoice);
      const existing = uniqueInvoices.get(key);
      if (!existing) {
        uniqueInvoices.set(key, invoice);
        return;
      }

      const effectiveDate = getInvoiceEffectiveDate(invoice);
      const existingDate = getInvoiceEffectiveDate(existing);
      if (effectiveDate && existingDate && effectiveDate < existingDate) {
        uniqueInvoices.set(key, invoice);
      }
    });

    return Array.from(uniqueInvoices.values());
  }, [invoiceItems]);

  const normalizedActualMarketingSpendItems = useMemo(() => {
    const uniqueInvoices = new Map();

    actualMarketingSpendItems.forEach((invoice) => {
      const key = getInvoiceKey(invoice);
      const existing = uniqueInvoices.get(key);
      if (!existing) {
        uniqueInvoices.set(key, invoice);
        return;
      }

      const effectiveDate = getInvoiceEffectiveDate(invoice);
      const existingDate = getInvoiceEffectiveDate(existing);
      if (effectiveDate && existingDate && effectiveDate < existingDate) {
        uniqueInvoices.set(key, invoice);
      }
    });

    return Array.from(uniqueInvoices.values());
  }, [actualMarketingSpendItems]);

  const allMarketingInvoices = useMemo(() => {
    return normalizedInvoiceItems.filter((invoice) => {
      if (!hasInvoiceClassification(invoice, ALL_MARKETING_GL_CODES, ALL_MARKETING_DESCRIPTIONS)) {
        return false;
      }
      return getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end) > 0;
    });
  }, [normalizedInvoiceItems, rangeDates]);

  const performanceMarketingInvoices = useMemo(() => {
    return normalizedInvoiceItems.filter((invoice) => {
      const inPerformanceGl = hasInvoiceClassification(
        invoice,
        PERFORMANCE_MARKETING_GL_CODES,
        PERFORMANCE_MARKETING_DESCRIPTIONS
      );
      return inPerformanceGl && getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end) > 0;
    });
  }, [normalizedInvoiceItems, rangeDates]);

  const excludedMarketingSpendKeySet = useMemo(() => (
    new Set(excludedMarketingSpendKeys)
  ), [excludedMarketingSpendKeys]);

  const includedMarketingInvoices = useMemo(() => (
    allMarketingInvoices.filter((invoice) => {
      const label = getInvoiceBreakdownLabel(invoice);
      return !isMarketingSpendLineExcluded(label, excludedMarketingSpendKeySet);
    })
  ), [allMarketingInvoices, excludedMarketingSpendKeySet]);

  const includedPerformanceMarketingInvoices = useMemo(() => (
    performanceMarketingInvoices.filter((invoice) => {
      const label = getInvoiceBreakdownLabel(invoice);
      return !isMarketingSpendLineExcluded(label, excludedMarketingSpendKeySet);
    })
  ), [performanceMarketingInvoices, excludedMarketingSpendKeySet]);

  const toggleMarketingSpendLine = useCallback((label) => {
    const key = getMarketingSpendExclusionKey(label);
    setExcludedMarketingSpendKeys((currentKeys) => (
      currentKeys.includes(key)
        ? currentKeys.filter((item) => item !== key)
        : [...currentKeys, key]
    ));
  }, []);

  const leadStatusBreakdown = useMemo(() => {
    const statuses = {};
    allCanonicalLeadItems.forEach((lead) => {
      const status = lead.status || 'Unknown';
      statuses[status] = (statuses[status] || 0) + 1;
    });
    return statuses;
  }, [allCanonicalLeadItems]);

  // Marketing cost from invoices
  const totalPerformanceMarketingCost = useMemo(() => {
    let total = 0;
    includedPerformanceMarketingInvoices.forEach(inv => {
      total += getAllocatedInvoiceAmountInRange(inv, rangeDates.start, rangeDates.end);
    });
    return total;
  }, [includedPerformanceMarketingInvoices, rangeDates]);

  const totalBlendedMarketingSpend = useMemo(() => {
    let total = 0;
    includedMarketingInvoices.forEach((invoice) => {
      total += getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end);
    });
    return total;
  }, [includedMarketingInvoices, rangeDates]);

  const marketingSpendBreakdown = useMemo(() => {
    const groupedSpend = new Map();

    allMarketingInvoices.forEach((invoice) => {
      const label = getInvoiceBreakdownLabel(invoice);
      const amount = getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end);
      if (amount === 0) return;
      groupedSpend.set(label, (groupedSpend.get(label) || 0) + amount);
    });

    return Array.from(groupedSpend.entries())
      .map(([label, amount]) => ({
        label,
        amount,
        excluded: isMarketingSpendLineExcluded(label, excludedMarketingSpendKeySet),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [allMarketingInvoices, excludedMarketingSpendKeySet, rangeDates]);


  const actualMarketingSpendBreakdown = useMemo(() => {
    const groupedSpend = new Map();

    normalizedActualMarketingSpendItems.forEach((invoice) => {
      if (!hasInvoiceClassification(invoice, ALL_MARKETING_GL_CODES, ALL_MARKETING_DESCRIPTIONS)) return;
      const amount = getAllocatedInvoiceAmountInRange(invoice, actualMarketingSpendWindow.start, actualMarketingSpendWindow.end);
      if (amount === 0) return;
      const label = getInvoiceBreakdownLabel(invoice);
      groupedSpend.set(label, (groupedSpend.get(label) || 0) + amount);
    });

    return Array.from(groupedSpend.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [actualMarketingSpendWindow, normalizedActualMarketingSpendItems]);

  const actualMarketingSpendLast30 = useMemo(() => (
    actualMarketingSpendBreakdown.reduce((total, item) => total + item.amount, 0)
  ), [actualMarketingSpendBreakdown]);

  const actualPerformanceMarketingSpendLast30 = useMemo(() => (
    normalizedActualMarketingSpendItems.reduce((total, invoice) => {
      if (!hasInvoiceClassification(invoice, PERFORMANCE_MARKETING_GL_CODES, PERFORMANCE_MARKETING_DESCRIPTIONS)) return total;
      return total + getAllocatedInvoiceAmountInRange(invoice, actualMarketingSpendWindow.start, actualMarketingSpendWindow.end);
    }, 0)
  ), [actualMarketingSpendWindow, normalizedActualMarketingSpendItems]);

  const marketingBudgetVarianceLast30 = useMemo(() => (
    activeApprovedMarketingBudget - actualMarketingSpendLast30
  ), [activeApprovedMarketingBudget, actualMarketingSpendLast30]);

  const availabilitySummary = useMemo(() => {
    const floorplanItems = Array.isArray(availabilityPricingSnapshot?.floorplans) ? availabilityPricingSnapshot.floorplans : [];
    const propertyUnitItems = Array.isArray(availabilityPricingSnapshot?.units) ? availabilityPricingSnapshot.units : [];
    const units = propertyUnitItems.flatMap(getPropertyUnitSpaces);
    const pricedUnits = units
      .map((unit) => {
        const range = getPropertyUnitPriceRange(unit);
        return range.min ?? range.max;
      })
      .filter((value) => value != null);
    const availableUnits = units.filter((unit) => {
      const status = String(getAvailabilityStatus(unit)).toLowerCase();
      return status.includes('available');
    });
    const datedUnits = units
      .map((unit) => parseEntrataDate(getAvailabilityDate(unit)))
      .filter((value) => value && !Number.isNaN(value.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    return {
      unitCount: propertyUnitItems.length > 0 ? propertyUnitItems.length : units.length,
      unitSpaceCount: units.length,
      floorplanCount: floorplanItems.length,
      availableCount: availableUnits.length,
      minPrice: pricedUnits.length ? Math.min(...pricedUnits) : null,
      maxPrice: pricedUnits.length ? Math.max(...pricedUnits) : null,
      nextAvailableDate: datedUnits[0] || null,
    };
  }, [availabilityPricingSnapshot]);

  const roiTotals = useMemo(() => {
    const totals = {
      attributedLeases: 0,
      unattributedLeases: 0,
      grossLeaseValue: 0,
      netEffectiveRevenue: 0,
      concessionTotal: 0,
      marketingSpend: 0,
      performanceMarketingSpend: 0
    };

    roiDailyItems.forEach((item) => {
      const dailyTotals = item.totals || {};
      totals.attributedLeases += dailyTotals.attributed_leases || 0;
      totals.unattributedLeases += dailyTotals.unattributed_leases || 0;
      totals.grossLeaseValue += dailyTotals.gross_lease_value || 0;
      totals.netEffectiveRevenue += dailyTotals.net_effective_revenue || 0;
      totals.concessionTotal += dailyTotals.concession_total || 0;
      totals.marketingSpend += dailyTotals.marketing_spend || 0;
      totals.performanceMarketingSpend += dailyTotals.performance_marketing_spend || 0;
    });

    return totals;
  }, [roiDailyItems]);

  const roiSourceBreakdown = useMemo(() => {
    const grouped = new Map();

    roiDailyItems.forEach((item) => {
      const sourceMetrics = Array.isArray(item.source_metrics) ? item.source_metrics : [];
      sourceMetrics.forEach((metric) => {
        const key = metric.source_key || metric.source_label || 'other';
        const current = grouped.get(key) || {
          sourceKey: key,
          sourceLabel: metric.source_label || 'Other',
          attributedLeases: 0,
          grossLeaseValue: 0,
          netEffectiveRevenue: 0,
          concessionTotal: 0,
          marketingSpend: 0,
          performanceMarketingSpend: 0
        };

        current.attributedLeases += metric.attributed_leases || 0;
        current.grossLeaseValue += metric.gross_lease_value || 0;
        current.netEffectiveRevenue += metric.net_effective_revenue || 0;
        current.concessionTotal += metric.concession_total || 0;
        current.marketingSpend += metric.marketing_spend || 0;
        current.performanceMarketingSpend += metric.performance_marketing_spend || 0;
        grouped.set(key, current);
      });
    });

    return Array.from(grouped.values())
      .filter((item) => !isMarketingSpendLineExcluded(item.sourceLabel, excludedMarketingSpendKeySet))
      .map((item) => ({
        ...item,
        roas: item.marketingSpend > 0 ? (item.netEffectiveRevenue / item.marketingSpend) : null
      }))
      .sort((a, b) => b.netEffectiveRevenue - a.netEffectiveRevenue);
  }, [excludedMarketingSpendKeySet, roiDailyItems]);

  // Conversion rates
  const attributedLeaseCount = roiTotals.attributedLeases;
  const unattributedLeaseCount = roiTotals.unattributedLeases;
  const totalTrackedLeaseCount = attributedLeaseCount + unattributedLeaseCount;
  const leaseConversion = totalLeads > 0 ? ((totalLeases / totalLeads) * 100).toFixed(1) : '0.0';
  const applicationConversion = totalLeads > 0 ? ((totalApplications / totalLeads) * 100).toFixed(1) : '0.0';
  const adjustedMarketingSpend = totalBlendedMarketingSpend;
  const costPerLead = totalLeads > 0 && adjustedMarketingSpend > 0 ? (adjustedMarketingSpend / totalLeads).toFixed(2) : '—';
  const costPerLease = totalLeases > 0 && adjustedMarketingSpend > 0 ? (adjustedMarketingSpend / totalLeases).toFixed(2) : '—';
  const attributionMatchRate = totalTrackedLeaseCount > 0 ? ((attributedLeaseCount / totalTrackedLeaseCount) * 100).toFixed(1) : '0.0';
  const applicationToLeaseConversion = totalApplications > 0 ? ((totalLeases / totalApplications) * 100).toFixed(1) : '0.0';
  const blendedRoi = adjustedMarketingSpend > 0 ? ((roiTotals.netEffectiveRevenue - adjustedMarketingSpend) / adjustedMarketingSpend) : null;
  const blendedRoas = adjustedMarketingSpend > 0 ? (roiTotals.netEffectiveRevenue / adjustedMarketingSpend) : null;
  const studentLeadDeficitMetrics = useMemo(() => {
    const cycle = {
      ...getStudentPreleaseCycle(rangeDates.end),
      cycleStart: parseEntrataDate(studentPreleaseCycle?.cycle_start) || getStudentPreleaseCycle(rangeDates.end).cycleStart,
      fallStart: parseEntrataDate(studentPreleaseCycle?.fall_start) || getStudentPreleaseCycle(rangeDates.end).fallStart,
      fallWindowStart: parseEntrataDate(studentPreleaseCycle?.fall_window_start) || getStudentPreleaseCycle(rangeDates.end).fallWindowStart,
      fallWindowEnd: parseEntrataDate(studentPreleaseCycle?.fall_window_end) || getStudentPreleaseCycle(rangeDates.end).fallWindowEnd,
    };
    const currentPreleases = filterUniqueFallPreleaseLeases([...preleaseLeaseItems, ...leaseItems], cycle, rangeDates.end);
    const priorComparableEnd = parseEntrataDate(studentPreleaseCycle?.prior_comparable_end);
    const priorCycle = {
      cycleStart: parseEntrataDate(studentPreleaseCycle?.prior_cycle_start) || new Date(cycle.cycleStart.getFullYear() - 1, cycle.cycleStart.getMonth(), cycle.cycleStart.getDate()),
      fallStart: new Date(cycle.fallStart.getFullYear() - 1, cycle.fallStart.getMonth(), cycle.fallStart.getDate()),
      fallWindowStart: parseEntrataDate(studentPreleaseCycle?.prior_fall_window_start) || new Date(cycle.fallWindowStart.getFullYear() - 1, cycle.fallWindowStart.getMonth(), cycle.fallWindowStart.getDate()),
      fallWindowEnd: parseEntrataDate(studentPreleaseCycle?.prior_fall_window_end) || new Date(cycle.fallWindowEnd.getFullYear() - 1, cycle.fallWindowEnd.getMonth(), cycle.fallWindowEnd.getDate()),
    };
    const priorPreleases = filterUniqueFallPreleaseLeases(
      priorPreleaseLeaseItems,
      priorCycle,
      priorComparableEnd || new Date(rangeDates.end.getFullYear() - 1, rangeDates.end.getMonth(), rangeDates.end.getDate())
    );
    const targetLeaseCount = Math.max(
      0,
      Number(availabilityPricingSnapshot?.bed_count || availabilityPricingSnapshot?.bedCount || 0),
      Number(availabilityPricingSnapshot?.unit_space_count || availabilityPricingSnapshot?.unitSpaceCount || 0),
      Number(availabilitySummary.unitSpaceCount || 0),
      Number(availabilityPricingSnapshot?.unit_count || availabilityPricingSnapshot?.unitCount || 0),
      Number(availabilitySummary.unitCount || 0)
    );
    const currentPreleaseCount = currentPreleases.length;
    const leasesRemaining = targetLeaseCount > 0 ? Math.max(0, targetLeaseCount - currentPreleaseCount) : null;
    const reportDays = Math.max(1, countInclusiveDays(rangeDates.start, rangeDates.end));
    const reportMonths = reportDays / 30.4375;
    const leadsPerMonth = totalLeads / Math.max(reportMonths, 0.1);
    const leadsPerDay = totalLeads / reportDays;
    const currentCloseRate = totalLeads > 0 ? totalLeases / totalLeads : null;
    const leadToAppRate = totalLeads > 0 ? totalApplications / totalLeads : null;
    const appToLeaseRate = totalApplications > 0 ? totalLeases / totalApplications : null;
    const daysToFallStart = getDaysBetweenDates(rangeDates.end, cycle.fallStart);
    const projectedLeadsBeforeFall = leadsPerDay * daysToFallStart;
    const projectedAdditionalLeases = currentCloseRate != null ? projectedLeadsBeforeFall * currentCloseRate : 0;
    const leadNeedAtCurrentClose = leasesRemaining != null && currentCloseRate > 0 ? Math.ceil(leasesRemaining / currentCloseRate) : null;
    const leadNeedAtThirtyClose = leasesRemaining != null ? Math.ceil(leasesRemaining / 0.3) : null;
    const leadDeficitAtCurrentClose = leadNeedAtCurrentClose != null ? Math.max(0, Math.ceil(leadNeedAtCurrentClose - projectedLeadsBeforeFall)) : null;
    const leadDeficitAtThirtyClose = leadNeedAtThirtyClose != null ? Math.max(0, Math.ceil(leadNeedAtThirtyClose - projectedLeadsBeforeFall)) : null;
    const leadDeficitPercentAtThirtyClose = leadNeedAtThirtyClose > 0 ? leadDeficitAtThirtyClose / leadNeedAtThirtyClose : null;
    const monthsToFallStart = Math.max(daysToFallStart / 30.4375, 0.1);
    const leadsNeededPerMonthAtThirtyClose = leadNeedAtThirtyClose != null ? leadNeedAtThirtyClose / monthsToFallStart : null;
    const leadFulfillmentRate = leadsNeededPerMonthAtThirtyClose > 0 ? leadsPerMonth / leadsNeededPerMonthAtThirtyClose : null;
    const isRedList = Boolean(
      ((leadDeficitAtThirtyClose || 0) > 0 && (leadDeficitPercentAtThirtyClose || 0) > 0.8) ||
      (leadFulfillmentRate != null && leadFulfillmentRate < 0.5)
    );
    const numericCostPerLead = totalLeads > 0 && adjustedMarketingSpend > 0 ? adjustedMarketingSpend / totalLeads : null;

    return {
      cycle,
      targetLeaseCount,
      currentPreleaseCount,
      priorPreleaseCount: priorPreleases.length,
      yoyDelta: priorPreleases.length > 0 ? (currentPreleaseCount - priorPreleases.length) / priorPreleases.length : null,
      leasesRemaining,
      currentPreleaseRate: targetLeaseCount > 0 ? currentPreleaseCount / targetLeaseCount : null,
      projectedOccupancyRate: targetLeaseCount > 0 ? Math.min(1, (currentPreleaseCount + projectedAdditionalLeases) / targetLeaseCount) : null,
      leadsPerMonth,
      currentCloseRate,
      leadToAppRate,
      appToLeaseRate,
      daysToFallStart,
      projectedLeadsBeforeFall,
      projectedAdditionalLeases,
      leadNeedAtCurrentClose,
      leadNeedAtThirtyClose,
      leadDeficitAtCurrentClose,
      leadDeficitAtThirtyClose,
      leadDeficitPercentAtThirtyClose,
      leadsNeededPerMonthAtThirtyClose,
      leadFulfillmentRate,
      isRedList,
      extraSpendAtCurrentClose: numericCostPerLead != null && leadDeficitAtCurrentClose != null ? leadDeficitAtCurrentClose * numericCostPerLead : null,
      extraSpendAtThirtyClose: numericCostPerLead != null && leadDeficitAtThirtyClose != null ? leadDeficitAtThirtyClose * numericCostPerLead : null,
      costPerLead: numericCostPerLead,
    };
  }, [
    availabilityPricingSnapshot,
    availabilitySummary.unitCount,
    availabilitySummary.unitSpaceCount,
    leaseItems,
    preleaseLeaseItems,
    priorPreleaseLeaseItems,
    rangeDates,
    studentPreleaseCycle,
    totalApplications,
    totalLeads,
    totalLeases,
    adjustedMarketingSpend
  ]);
  const conventionalLeadDeficitMetrics = useMemo(() => {
    const forecastDate = parseEntrataDate(conventionalOccupancyWindow?.forecast_date) || new Date(rangeDates.end.getFullYear(), rangeDates.end.getMonth(), rangeDates.end.getDate() + 60);
    const priorWeekDate = parseEntrataDate(conventionalOccupancyWindow?.prior_week_date) || new Date(rangeDates.end.getFullYear(), rangeDates.end.getMonth(), rangeDates.end.getDate() - 7);
    const windowStart = parseEntrataDate(conventionalOccupancyWindow?.window_start) || new Date(rangeDates.end.getFullYear(), rangeDates.end.getMonth(), rangeDates.end.getDate() - 59);
    const targetUnitCount = Math.max(
      0,
      Number(availabilityPricingSnapshot?.unit_count || availabilityPricingSnapshot?.unitCount || 0),
      Number(availabilitySummary.unitCount || 0)
    );
    const activeLeaseFeed = conventionalLeaseItems.length > 0 ? conventionalLeaseItems : leaseItems;
    const activeCurrentLeases = filterUniqueActiveLeases(activeLeaseFeed, rangeDates.end, rangeDates.end);
    const activeForecastLeases = filterUniqueActiveLeases(activeLeaseFeed, forecastDate, rangeDates.end);
    const activePriorWeekLeases = filterUniqueActiveLeases(activeLeaseFeed, priorWeekDate, priorWeekDate);
    const currentOccupancyRate = targetUnitCount > 0 ? Math.min(1, activeCurrentLeases.length / targetUnitCount) : null;
    const forecastOccupancyRate = targetUnitCount > 0 ? Math.min(1, activeForecastLeases.length / targetUnitCount) : null;
    const currentExposureRate = currentOccupancyRate != null ? Math.max(0, 1 - currentOccupancyRate) : null;
    const forecastExposureRate = forecastOccupancyRate != null ? Math.max(0, 1 - forecastOccupancyRate) : null;
    const priorWeekExposureRate = targetUnitCount > 0 ? Math.max(0, 1 - Math.min(1, activePriorWeekLeases.length / targetUnitCount)) : null;
    const exposureVariance = currentExposureRate != null && priorWeekExposureRate != null ? currentExposureRate - priorWeekExposureRate : null;
    const availableUnitsIn60Days = targetUnitCount > 0 ? Math.max(0, targetUnitCount - activeForecastLeases.length) : null;

    const canonicalLeads = new Map();
    lead60DayItems.forEach((lead) => {
      const leadDate = getCallPrepDate(lead._date || lead.activity_date || lead.date);
      if (!isInDateRange(leadDate, windowStart, rangeDates.end)) return;
      const key = getLeadKey(lead);
      const current = canonicalLeads.get(key);
      if (!current || String(lead._date || '') < String(current._date || '9999-12-31')) {
        canonicalLeads.set(key, lead);
      }
    });
    const leads60 = Array.from(canonicalLeads.values());

    const tourRecords = new Map();
    const applicationRecords = new Map();
    const leaseRecords = new Map();
    event60DayItems.forEach((event) => {
      const eventDate = getTrueEventOccurredDate(event);
      if (!isInDateRange(eventDate, windowStart, rangeDates.end)) return;
      const eventKey = getScopedStableKey(
        getItemPropertyId(event),
        event.eventId || event.eventID || event.id || event._firestorePath || JSON.stringify(event)
      );
      if (isTourEvent(event)) {
        const existing = tourRecords.get(eventKey);
        if (!existing || eventDate < existing.date) tourRecords.set(eventKey, { date: eventDate, item: event });
      }
      if (isStartedApplicationEvent(event)) {
        const key = getCompletedApplicationRecordKey(event);
        const existing = applicationRecords.get(key);
        if (!existing || eventDate < existing.date) applicationRecords.set(key, { date: eventDate, item: event });
      }
      if (isApprovedNewLeaseEvent(event)) {
        const key = getApprovedLeaseRecordKey(event);
        const existing = leaseRecords.get(key);
        if (!existing || eventDate < existing.date) leaseRecords.set(key, { date: eventDate, item: event });
      }
    });

    const totalLeads60 = leads60.length;
    const totalTours60 = tourRecords.size;
    const totalApplications60 = applicationRecords.size;
    const totalLeases60 = leaseRecords.size;
    const currentCloseRate = totalLeads60 > 0 ? totalLeases60 / totalLeads60 : null;
    const requiredLeadsAtCurrentClose = availableUnitsIn60Days != null && currentCloseRate > 0 ? Math.ceil(availableUnitsIn60Days / currentCloseRate) : null;
    const requiredLeadsAtTenClose = availableUnitsIn60Days != null ? Math.ceil(availableUnitsIn60Days / 0.1) : null;
    const leadDeficitAtTenClose = requiredLeadsAtTenClose != null ? Math.max(0, requiredLeadsAtTenClose - totalLeads60) : null;
    const isRedList = Boolean((forecastExposureRate || 0) > 0.12 && (leadDeficitAtTenClose || 0) > 0);

    return {
      forecastDate,
      priorWeekDate,
      windowStart,
      targetUnitCount,
      currentOccupiedUnits: activeCurrentLeases.length,
      forecastOccupiedUnits: activeForecastLeases.length,
      currentOccupancyRate,
      forecastOccupancyRate,
      currentExposureRate,
      forecastExposureRate,
      priorWeekExposureRate,
      exposureVariance,
      availableUnitsIn60Days,
      totalLeads60,
      totalTours60,
      totalApplications60,
      totalLeases60,
      currentCloseRate,
      leadDeficitAtCurrentClose: requiredLeadsAtCurrentClose != null ? Math.max(0, requiredLeadsAtCurrentClose - totalLeads60) : null,
      leadDeficitAtTenClose,
      requiredLeadsAtCurrentClose,
      requiredLeadsAtTenClose,
      isRedList,
      leadToTourRate: totalLeads60 > 0 ? totalTours60 / totalLeads60 : null,
      tourToApplicationRate: totalTours60 > 0 ? totalApplications60 / totalTours60 : null,
      tourToLeaseRate: totalTours60 > 0 ? totalLeases60 / totalTours60 : null,
      leadToLeaseRate: currentCloseRate,
      leadToApplicationRate: totalLeads60 > 0 ? totalApplications60 / totalLeads60 : null,
      applicationToLeaseRate: totalApplications60 > 0 ? totalLeases60 / totalApplications60 : null,
    };
  }, [
    availabilityPricingSnapshot,
    availabilitySummary.unitCount,
    conventionalLeaseItems,
    conventionalOccupancyWindow,
    event60DayItems,
    lead60DayItems,
    leaseItems,
    rangeDates,
  ]);
  const isConventionalLeadDeficitPanel = reportingPortfolio === 'multifamily';
  const activeRedListStatus = isConventionalLeadDeficitPanel
    ? {
        isRedList: Boolean(redListSummary?.is_red_list ?? conventionalLeadDeficitMetrics.isRedList),
        label: (redListSummary?.is_red_list ?? conventionalLeadDeficitMetrics.isRedList) ? 'On Red List' : 'Clear',
        detail: redListSummary?.reason || (
          conventionalLeadDeficitMetrics.isRedList
            ? '60-day exposure is above 12% and the 10% close-rate lead deficit is positive.'
            : 'Conventional red-list thresholds are currently clear.'
        ),
      }
    : {
        isRedList: Boolean(redListSummary?.is_red_list ?? studentLeadDeficitMetrics.isRedList),
        label: (redListSummary?.is_red_list ?? studentLeadDeficitMetrics.isRedList) ? 'On Red List' : 'Clear',
        detail: redListSummary?.reason || (
          studentLeadDeficitMetrics.isRedList
            ? '30% close-rate deficit is above 80% or lead fulfillment is below 50%.'
            : 'Student red-list thresholds are currently clear.'
        ),
      };
  const selectedPropertyLabel = useMemo(() => {
    if (isAllPropertiesSelected) {
      return 'All Properties';
    }
    if (selectedProperty) {
      const location = [selectedProperty.city, selectedProperty.state].filter(Boolean).join(', ');
      return location ? `${selectedProperty.name} (${location})` : selectedProperty.name;
    }

    const propertyId = parentDocs[0]?.property_id;
    return propertyId ? `Property ${propertyId}` : 'Live Property Data';
  }, [isAllPropertiesSelected, selectedProperty, parentDocs]);
  const reportingSourceBadge = useMemo(() => {
    if (reportingDataSource === 'staged') {
      return { label: 'Data source: Staged Render', className: 'reports-chip reports-chip--staged' };
    }
    if (reportingDataSource === 'loading') {
      return { label: 'Data source: Checking staged route…', className: 'reports-chip reports-chip--loading' };
    }
    return {
      label: reportingUsesStagedOverview ? 'Data source: Staged route unavailable' : 'Data source: Endpoint unavailable',
      className: 'reports-chip reports-chip--error'
    };
  }, [reportingDataSource, reportingUsesStagedOverview]);
  const websitePlatformMeta = useMemo(
    () => getWebsitePlatformMeta(websiteManagerDraft.platform),
    [websiteManagerDraft.platform]
  );
  const websiteManagerEditable = isWebsiteManagerEditable(websiteManagerDraft.platform);
  const websiteManagerTokenValues = useMemo(() => ({
    property_name: selectedProperty?.name || '',
    city: selectedProperty?.city || '',
    state: selectedProperty?.state || '',
    property_id: selectedPropertyId
  }), [selectedProperty, selectedPropertyId]);
  const websiteManagerSchemaGroups = useMemo(
    () => getWebsiteManagerFieldGroups(websiteManagerDraft.schema),
    [websiteManagerDraft.schema]
  );
  useEffect(() => {
    if (!websiteManagerSchemaGroups.length) {
      return;
    }
    if (!websiteManagerSchemaGroups.some((group) => group.id === selectedWebsiteManagerGroupId)) {
      setSelectedWebsiteManagerGroupId(websiteManagerSchemaGroups[0].id);
    }
  }, [selectedWebsiteManagerGroupId, websiteManagerSchemaGroups]);
  const selectedWebsiteManagerGroup = useMemo(
    () => websiteManagerSchemaGroups.find((group) => group.id === selectedWebsiteManagerGroupId) || websiteManagerSchemaGroups[0] || null,
    [selectedWebsiteManagerGroupId, websiteManagerSchemaGroups]
  );
  const selectedWebsiteManagerGroupFilledCount = useMemo(() => (
    selectedWebsiteManagerGroup
      ? selectedWebsiteManagerGroup.fields.filter((field) => String(websiteManagerDraft.content[field.key] || '').trim()).length
      : 0
  ), [selectedWebsiteManagerGroup, websiteManagerDraft.content]);
  const websiteManagerContentTokens = useMemo(
    () => getWebsiteManagerFieldTokenDefinitions(websiteManagerDraft.schema),
    [websiteManagerDraft.schema]
  );
  const websiteManagerTokenSearchTerm = websiteManagerTokenSearch.trim().toLowerCase();
  const websiteManagerReferenceTokens = useMemo(() => {
    const propertyTokens = WEBSITE_MANAGER_TOKEN_DEFINITIONS.map((token) => ({
      groupLabel: 'Property tokens',
      label: token.label,
      tokenText: `{{${token.token}}}`,
      detail: websiteManagerTokenValues[token.token] || 'Not available',
    }));
    const contentTokens = websiteManagerContentTokens.map((field) => ({
      groupLabel: field.groupLabel || 'Content fields',
      label: field.label,
      tokenText: field.type === 'url' ? `r:${field.token}` : `{{r:${field.token}}}`,
      detail: field.type === 'url' ? 'URL token' : 'Content token',
    }));
    return [...propertyTokens, ...contentTokens].filter((token) => (
      !websiteManagerTokenSearchTerm ||
      [token.groupLabel, token.label, token.tokenText, token.detail].some((value) => (
        String(value || '').toLowerCase().includes(websiteManagerTokenSearchTerm)
      ))
    ));
  }, [websiteManagerContentTokens, websiteManagerTokenSearchTerm, websiteManagerTokenValues]);
  const websiteManagerReferenceTokenGroups = useMemo(() => (
    websiteManagerReferenceTokens.reduce((groups, token) => {
      if (!groups.has(token.groupLabel)) groups.set(token.groupLabel, []);
      groups.get(token.groupLabel).push(token);
      return groups;
    }, new Map())
  ), [websiteManagerReferenceTokens]);
  const websiteManagerSearchTerm = websiteManagerContentSearch.trim().toLowerCase();
  const getWebsiteManagerFieldStatus = useCallback((field) => {
    const draftValue = String(websiteManagerDraft.content[field.key] || '').trim();
    const savedValue = String(websiteManagerDoc.content?.[field.key] || '').trim();
    const tokenText = `{{r:${field.key}}}`;
    const isLiveFilled = /\{\{\s*[^}]+\s*\}\}/.test(draftValue);
    return {
      draftValue,
      savedValue,
      tokenText,
      isEmpty: !draftValue,
      isChanged: draftValue !== savedValue,
      isRequired: !draftValue,
      isLiveFilled,
    };
  }, [websiteManagerDoc.content, websiteManagerDraft.content]);
  const fieldMatchesWebsiteManagerFilter = useCallback((field) => {
    const status = getWebsiteManagerFieldStatus(field);
    if (websiteManagerContentFilter === 'empty') return status.isEmpty;
    if (websiteManagerContentFilter === 'changed') return status.isChanged;
    if (websiteManagerContentFilter === 'required') return status.isRequired;
    if (websiteManagerContentFilter === 'live_filled') return status.isLiveFilled;
    return true;
  }, [getWebsiteManagerFieldStatus, websiteManagerContentFilter]);
  const fieldMatchesWebsiteManagerSearch = useCallback((field, groupLabel = '') => {
    if (!websiteManagerSearchTerm) return true;
    const status = getWebsiteManagerFieldStatus(field);
    return [
      field.label,
      field.key,
      groupLabel,
      status.draftValue,
      status.tokenText
    ].some((value) => String(value || '').toLowerCase().includes(websiteManagerSearchTerm));
  }, [getWebsiteManagerFieldStatus, websiteManagerSearchTerm]);
  const visibleWebsiteManagerGroups = useMemo(() => (
    websiteManagerSchemaGroups
      .map((group) => ({
        ...group,
        fields: group.fields.filter((field) => (
          fieldMatchesWebsiteManagerFilter(field) && fieldMatchesWebsiteManagerSearch(field, group.label)
        )),
      }))
      .filter((group) => group.fields.length > 0)
  ), [fieldMatchesWebsiteManagerFilter, fieldMatchesWebsiteManagerSearch, websiteManagerSchemaGroups]);
  useEffect(() => {
    if (!visibleWebsiteManagerGroups.length) {
      return;
    }
    if (!visibleWebsiteManagerGroups.some((group) => group.id === selectedWebsiteManagerGroupId)) {
      setSelectedWebsiteManagerGroupId(visibleWebsiteManagerGroups[0].id);
    }
  }, [selectedWebsiteManagerGroupId, visibleWebsiteManagerGroups]);
  const selectedWebsiteManagerGroupVisibleFields = useMemo(() => (
    selectedWebsiteManagerGroup
      ? selectedWebsiteManagerGroup.fields.filter((field) => (
        fieldMatchesWebsiteManagerFilter(field) && fieldMatchesWebsiteManagerSearch(field, selectedWebsiteManagerGroup.label)
      ))
      : []
  ), [fieldMatchesWebsiteManagerFilter, fieldMatchesWebsiteManagerSearch, selectedWebsiteManagerGroup]);
  const copyWebsiteManagerToken = useCallback(async (token) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedWebsiteManagerToken(token);
      window.setTimeout(() => {
        setCopiedWebsiteManagerToken((current) => current === token ? '' : current);
      }, 1500);
    } catch (error) {
      setWebsiteManagerError(error.message || 'Unable to copy token.');
    }
  }, []);
  const focusWebsiteManagerField = useCallback((fieldKey) => {
    window.setTimeout(() => {
      document.getElementById(`website-manager-field-${fieldKey}`)?.focus();
    }, 0);
  }, []);
  const jumpToWebsiteManagerField = useCallback((field) => {
    if (!field) return;
    const group = websiteManagerSchemaGroups.find((item) => item.fields.some((candidate) => candidate.key === field.key));
    if (group) {
      setSelectedWebsiteManagerGroupId(group.id);
      setExpandedWebsiteManagerGroups((current) => new Set([...current, group.id]));
    }
    focusWebsiteManagerField(field.key);
  }, [focusWebsiteManagerField, websiteManagerSchemaGroups]);
  const jumpToFirstMissingWebsiteManagerField = useCallback(() => {
    const missingField = websiteManagerSchemaGroups
      .flatMap((group) => group.fields.map((field) => ({ ...field, groupId: group.id })))
      .find((field) => getWebsiteManagerFieldStatus(field).isEmpty);
    jumpToWebsiteManagerField(missingField);
  }, [getWebsiteManagerFieldStatus, jumpToWebsiteManagerField, websiteManagerSchemaGroups]);
  const websiteManagerPreviewItems = useMemo(() => (
    [
      ...websiteManagerContentTokens.map((field) => ({
        label: field.label,
        value: websiteManagerDraft.content[field.token],
      })),
      { label: 'Live pricing', value: websiteManagerDraft.derivedContent.pricingSummary },
      { label: 'Live specials', value: websiteManagerDraft.derivedContent.specialsSummary },
      { label: 'Live availability', value: websiteManagerDraft.derivedContent.availabilitySummary }
    ]
      .filter((item) => String(item.value || '').trim())
      .slice(0, 9)
      .map((item) => ({
        ...item,
        resolved: resolveMustacheTokens(item.value, websiteManagerTokenValues)
      }))
  ), [websiteManagerContentTokens, websiteManagerDraft.content, websiteManagerDraft.derivedContent, websiteManagerTokenValues]);
  const websiteManagerDirty = useMemo(
    () => JSON.stringify(websiteManagerDraft) !== JSON.stringify(websiteManagerDoc),
    [websiteManagerDraft, websiteManagerDoc]
  );
  const heatmapSiteDirty = useMemo(
    () => JSON.stringify(normalizeHeatmapSiteConfig(heatmapSiteDraft)) !== JSON.stringify(normalizeHeatmapSiteConfig(heatmapSiteDoc)),
    [heatmapSiteDraft, heatmapSiteDoc]
  );
  const manualTrackerSnippet = useMemo(
    () => buildManualTrackerSnippet(heatmapSiteDraft.siteKey),
    [heatmapSiteDraft.siteKey]
  );
  const websiteManagerPublishReady = useMemo(() => (
    websiteManagerEditable &&
    canEditWebsiteManager &&
    Boolean(websiteManagerDraft.websiteUrl && websiteManagerDraft.wordpressSiteKey)
  ), [websiteManagerDraft.websiteUrl, websiteManagerDraft.wordpressSiteKey, websiteManagerEditable, canEditWebsiteManager]);
  const updateWebsiteManagerField = useCallback((field, value) => {
    setWebsiteManagerNotice(null);
    setWebsiteManagerError(null);
    setWebsiteManagerDraft((current) => ({
      ...current,
      [field]: value
    }));
  }, []);

  const updateWebsiteManagerContentField = useCallback((field, value) => {
    setWebsiteManagerNotice(null);
    setWebsiteManagerError(null);
    setWebsiteManagerDraft((current) => ({
      ...current,
      content: {
        ...current.content,
        [field]: value
      }
    }));
  }, []);

  const insertWebsiteManagerSnippet = useCallback((fieldKey, snippet) => {
    const currentValue = String(websiteManagerDraft.content[fieldKey] || '');
    const spacer = currentValue && !currentValue.endsWith(' ') && !currentValue.endsWith('\n') ? ' ' : '';
    updateWebsiteManagerContentField(fieldKey, `${currentValue}${spacer}${snippet}`);
    window.setTimeout(() => {
      document.getElementById(`website-manager-field-${fieldKey}`)?.focus();
    }, 0);
  }, [updateWebsiteManagerContentField, websiteManagerDraft.content]);

  const updateHeatmapSiteField = (field, value) => {
    setHeatmapSiteNotice(null);
    setHeatmapSiteError(null);
    setHeatmapSiteDraft((current) => ({
      ...current,
      [field]: value
    }));
  };

  const updateHeatmapFeatureFlag = (field, value) => {
    setHeatmapSiteNotice(null);
    setHeatmapSiteError(null);
    setHeatmapSiteDraft((current) => ({
      ...current,
      featureFlags: {
        ...current.featureFlags,
        [field]: value
      }
    }));
  };

  const resetHeatmapSiteDraft = () => {
    setHeatmapSiteDraft(heatmapSiteDoc);
    setHeatmapSiteNotice('Unsaved tracking setup changes were discarded.');
    setHeatmapSiteError(null);
  };

  const updateWebsiteSchemaGroupLabel = (groupId, value) => {
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => (
        group.id === groupId ? { ...group, label: value } : group
      )),
    }));
  };

  const updateWebsiteSchemaField = (groupId, fieldIndex, property, value) => {
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          fields: group.fields.map((field, index) => (
            index === fieldIndex ? { ...field, [property]: value } : field
          )),
        };
      }),
    }));
  };

  const addWebsiteSchemaGroup = () => {
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    const nextGroupId = `group_${Date.now()}`;
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: (() => {
        const nextKey = getUniqueWebsiteSchemaKey(current.groups, `new_group_${current.groups.length + 1}_field`);
        return [
          ...current.groups,
          {
            id: nextGroupId,
            label: 'New Group',
            fields: [
              {
                key: nextKey,
                label: 'New Field',
                type: 'text',
                placeholder: '',
              },
            ],
          },
        ];
      })(),
    }));
    setExpandedWebsiteSchemaGroups((current) => new Set([...current, nextGroupId]));
  };

  const removeWebsiteSchemaGroup = (groupId) => {
    const group = websiteSchemaDraft.groups.find((item) => item.id === groupId);
    if (group && !window.confirm(`Remove "${group.label}" and its ${group.fields.length} field${group.fields.length === 1 ? '' : 's'} from this schema? Existing content for these keys will no longer appear in the editor.`)) {
      return;
    }
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== groupId),
    }));
    setExpandedWebsiteSchemaGroups((current) => {
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });
  };

  const addWebsiteSchemaField = (groupId) => {
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          fields: [
            ...group.fields,
            {
              key: getUniqueWebsiteSchemaKey(current.groups, `${group.label || 'group'} field ${group.fields.length + 1}`),
              label: 'New Field',
              type: 'text',
              placeholder: '',
            },
          ],
        };
      }),
    }));
    setExpandedWebsiteSchemaGroups((current) => new Set([...current, groupId]));
  };

  const removeWebsiteSchemaField = (groupId, fieldIndex) => {
    const group = websiteSchemaDraft.groups.find((item) => item.id === groupId);
    const field = group?.fields[fieldIndex];
    if (field && !window.confirm(`Remove "${field.label}" (${field.key}) from this schema? Existing content for this key will no longer appear in the editor.`)) {
      return;
    }
    setWebsiteSchemaNotice(null);
    setWebsiteSchemaError(null);
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          fields: group.fields.filter((field, index) => index !== fieldIndex),
        };
      }).filter((group) => group.fields.length > 0),
    }));
  };

  const websiteSchemaDirty = JSON.stringify(websiteSchemaDraft) !== JSON.stringify(websiteSchemaDoc);
  const websiteSchemaValidationIssues = useMemo(
    () => getWebsiteSchemaValidationIssues(websiteSchemaDraft),
    [websiteSchemaDraft]
  );
  const websiteSchemaFieldCount = useMemo(
    () => websiteSchemaDraft.groups.reduce((count, group) => count + group.fields.length, 0),
    [websiteSchemaDraft.groups]
  );
  const websiteSchemaFieldKeyCounts = useMemo(() => {
    const counts = new Map();
    websiteSchemaDraft.groups.forEach((group) => {
      group.fields.forEach((field) => {
        const key = String(field.key || '').trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    return counts;
  }, [websiteSchemaDraft.groups]);

  const toggleWebsiteSchemaGroup = (groupId) => {
    setExpandedWebsiteSchemaGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const saveWebsiteSchemaDraft = async () => {
    if (!selectedPropertyId) {
      setWebsiteSchemaError('No property is currently available for this account.');
      return;
    }
    if (!canManageUsers) {
      setWebsiteSchemaError('Only admins can edit website field schemas.');
      return;
    }
    if (websiteSchemaValidationIssues.length > 0) {
      setWebsiteSchemaError('Fix the schema issues before saving.');
      setWebsiteSchemaNotice(null);
      return;
    }

    setWebsiteSchemaSaving(true);
    setWebsiteSchemaError(null);
    setWebsiteSchemaNotice(null);

    try {
      if (!websiteManagerSchemaUsesStagedAdapter) {
        throw new Error('Website schema endpoint is not configured.');
      }
      const normalizedSchema = normalizeWebsiteManagerSchema(websiteSchemaDraft);
      const response = await authFetch(WEBSITE_MANAGER_SCHEMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          propertyName: selectedProperty?.name || '',
          schema: normalizedSchema,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Website schema save failed: ${response.status}`);
      }
      const savedSchema = normalizeWebsiteManagerSchema(payload?.record?.schema);
      const schemaChanges = describeWebsiteSchemaChanges(websiteSchemaDoc, savedSchema);
      if (schemaChanges.length > 0) {
        setWebsiteSchemaHistory((current) => {
          const nextHistory = [
            {
              id: `${Date.now()}`,
              savedAt: new Date().toISOString(),
              propertyName: selectedProperty?.name || selectedPropertyLabel,
              changes: schemaChanges,
            },
            ...current,
          ].slice(0, 12);
          writeWebsiteSchemaHistory(selectedPropertyId, nextHistory);
          return nextHistory;
        });
      }
      setWebsiteSchemaDoc(savedSchema);
      setWebsiteSchemaDraft(savedSchema);
      setWebsiteSchemaNotice('Website field schema saved.');
      setWebsiteManagerDoc((current) => ({ ...current, schema: savedSchema }));
      setWebsiteManagerDraft((current) => normalizeWebsiteManagerRecord({ ...current, schema: savedSchema }));
    } catch (error) {
      setWebsiteSchemaError(error.message || 'Unable to save the website schema.');
    } finally {
      setWebsiteSchemaSaving(false);
    }
  };

  const resetWebsiteManagerDraft = () => {
    setWebsiteManagerDraft(websiteManagerDoc);
    setWebsiteManagerNotice('Unsaved website edits were discarded.');
    setWebsiteManagerError(null);
  };

  const persistWebsiteManagerDraft = async ({ publish = false } = {}) => {
    if (!selectedPropertyId) {
      setWebsiteManagerError('No property is currently available for this account.');
      return;
    }
    if (!canEditWebsiteManager) {
      setWebsiteManagerError('Your current role can view website editor content, but cannot edit it.');
      return;
    }

    setWebsiteManagerSaving(true);
    setWebsiteManagerAction(publish ? 'publish' : 'save');
    setWebsiteManagerError(null);
    setWebsiteManagerNotice(null);

    try {
      if (!websiteManagerUsesStagedAdapter) {
        throw new Error('Website editor endpoint is not configured.');
      }
      const normalizedDraft = normalizeWebsiteManagerRecord(websiteManagerDraft);
      const response = await authFetch(WEBSITE_MANAGER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          propertyId: selectedPropertyId,
          propertyName: selectedProperty?.name || '',
          ...normalizedDraft,
          editable: isWebsiteManagerEditable(normalizedDraft.platform),
          publish,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Website editor save failed: ${response.status}`);
      }
      const savedRecord = normalizeWebsiteManagerRecord(payload.record);
      setWebsiteManagerDoc(savedRecord);
      setWebsiteManagerDraft(savedRecord);
      if (publish) {
        setWebsiteManagerNotice('Website content was saved and pushed to the linked WordPress site.');
      } else {
        setWebsiteManagerNotice('Website editor content saved for this property.');
      }
    } catch (error) {
      console.error('Website editor save failed', error);
      setWebsiteManagerError(error.message || 'Unable to save website editor content.');
    } finally {
      setWebsiteManagerSaving(false);
      setWebsiteManagerAction('save');
    }
  };

  const persistHeatmapSiteDraft = async () => {
    if (!selectedPropertyId) {
      setHeatmapSiteError('No property is currently available for this account.');
      return;
    }
    if (!canEditWebsiteManager) {
      setHeatmapSiteError('Your current role can view tracking setup, but cannot edit it.');
      return;
    }

    setHeatmapSiteSaving(true);
    setHeatmapSiteError(null);
    setHeatmapSiteNotice(null);

    try {
      if (!HEATMAP_SITES_URL) {
        throw new Error('Tracking site endpoint is not configured.');
      }
      const normalizedDraft = normalizeHeatmapSiteConfig(heatmapSiteDraft);
      const fallbackDomain = getHostnameFromUrl(websiteManagerDraft.websiteUrl);
      const allowedDomains = normalizedDraft.allowedDomains.length ? normalizedDraft.allowedDomains : (fallbackDomain ? [fallbackDomain] : []);
      if (normalizedDraft.trackingEnabled && allowedDomains.length === 0) {
        throw new Error('Add at least one allowed domain before enabling tracking.');
      }
      const response = await authFetch(HEATMAP_SITES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          id: normalizedDraft.id || undefined,
          name: normalizedDraft.name || selectedProperty?.name || selectedPropertyLabel,
          siteKey: normalizedDraft.siteKey || undefined,
          allowedDomains,
          trackingEnabled: normalizedDraft.trackingEnabled,
          samplingRate: normalizedDraft.samplingRate,
          featureFlags: normalizedDraft.featureFlags,
          screenshotCaptureFrequency: normalizedDraft.screenshotCaptureFrequency,
          consentMode: normalizedDraft.consentMode,
          respectDnt: normalizedDraft.respectDnt,
          screenshotMinIntervalHours: normalizedDraft.screenshotMinIntervalHours,
          rawEventRetentionDays: normalizedDraft.rawEventRetentionDays,
          aggregateRetentionDays: normalizedDraft.aggregateRetentionDays,
          notes: normalizedDraft.notes,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Tracking site save failed: ${response.status}`);
      }
      const savedSite = normalizeHeatmapSiteConfig(payload.site);
      setHeatmapSiteDoc(savedSite);
      setHeatmapSiteDraft(savedSite);
      setHeatmapSiteNotice(savedSite.siteKey ? 'Tracking setup saved and site key is ready.' : 'Tracking setup saved.');
    } catch (error) {
      console.error('Tracking site save failed', error);
      setHeatmapSiteError(error.message || 'Unable to save tracking site setup.');
    } finally {
      setHeatmapSiteSaving(false);
    }
  };

  const generateRecommendations = async (windowOverride = null) => {
    if (!selectedPropertyId || isAllPropertiesSelected) {
      setRecommendationsError('Choose a single property before generating recommendations.');
      return;
    }
    if (!RECOMMENDATIONS_GENERATE_URL) {
      setRecommendationsError('Recommendations endpoint is not configured.');
      return;
    }

    setRecommendationsLoading(true);
    setRecommendationsError(null);

    try {
      const response = await authFetch(RECOMMENDATIONS_GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          property_name: selectedProperty?.name || selectedPropertyLabel,
          start_date: formatDateInputValue(windowOverride?.start || rangeDates.start),
          end_date: formatDateInputValue(windowOverride?.end || rangeDates.end),
          siteKey: heatmapSiteDraft.siteKey || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Recommendation generation failed: ${response.status}`);
      }
      setRecommendationsData(payload);
      setSelectedRecommendationId(null);
      setRecommendationFeedbackDrafts({});
    } catch (error) {
      console.error('Recommendation generation failed', error);
      setRecommendationsError(error.message || 'Unable to generate recommendations.');
    } finally {
      setRecommendationsLoading(false);
    }
  };

  const getRecommendationFeedbackDraft = (recommendationId) => (
    recommendationFeedbackDrafts[recommendationId] || { feedbackType: 'useful', notes: '', tags: [] }
  );

  const updateRecommendationFeedbackDraft = (recommendationId, patch) => {
    setRecommendationFeedbackDrafts((current) => ({
      ...current,
      [recommendationId]: {
        feedbackType: 'useful',
        notes: '',
        tags: [],
        ...(current[recommendationId] || {}),
        ...patch,
      },
    }));
  };

  const toggleRecommendationFeedbackTag = (recommendationId, tag) => {
    const draft = getRecommendationFeedbackDraft(recommendationId);
    const tags = new Set(draft.tags || []);
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    updateRecommendationFeedbackDraft(recommendationId, { tags: Array.from(tags) });
  };

  const submitRecommendationFeedback = async (recommendation, feedbackType, options = {}) => {
    const recommendationId = recommendation?.storedRecommendationId;
    if (!recommendationId) {
      setRecommendationsError('This recommendation was not stored yet, so feedback cannot be saved.');
      return;
    }
    if (!selectedPropertyId || isAllPropertiesSelected) {
      setRecommendationsError('Choose a single property before saving recommendation feedback.');
      return;
    }
    if (!RECOMMENDATIONS_BASE_URL) {
      setRecommendationsError('Recommendations feedback endpoint is not configured.');
      return;
    }

    setRecommendationsError(null);
    setRecommendationFeedbackLoading((current) => ({ ...current, [recommendationId]: feedbackType }));

    try {
      const response = await authFetch(`${RECOMMENDATIONS_BASE_URL}/${recommendationId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          feedback_type: feedbackType,
          notes: options.notes || '',
          tags: Array.isArray(options.tags) ? options.tags : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Feedback save failed: ${response.status}`);
      }

      setRecommendationsData((current) => {
        if (!current?.recommendations) return current;
        return {
          ...current,
          recommendations: current.recommendations.map((item) => {
            if (item.storedRecommendationId !== recommendationId) return item;
            return {
              ...item,
              status: payload?.recommendation?.status || item.status,
              latestFeedbackType: payload?.recommendation?.latestFeedbackType || feedbackType,
              usefulCount: payload?.recommendation?.usefulCount ?? item.usefulCount,
              notUsefulCount: payload?.recommendation?.notUsefulCount ?? item.notUsefulCount,
              feedbackHistory: payload?.feedbackItem
                ? [payload.feedbackItem, ...(Array.isArray(item.feedbackHistory) ? item.feedbackHistory : [])]
                : item.feedbackHistory,
            };
          }),
        };
      });
      if (options.clearDraft) {
        setRecommendationFeedbackDrafts((current) => ({
          ...current,
          [recommendationId]: { feedbackType: 'useful', notes: '', tags: [] },
        }));
      }
    } catch (error) {
      console.error('Recommendation feedback save failed', error);
      setRecommendationsError(error.message || 'Unable to save recommendation feedback.');
    } finally {
      setRecommendationFeedbackLoading((current) => {
        const next = { ...current };
        delete next[recommendationId];
        return next;
      });
    }
  };

  const createTaskFromRecommendation = async (recommendation) => {
    const recommendationId = recommendation?.storedRecommendationId;
    if (!recommendationId) {
      setRecommendationsError('This recommendation was not stored yet, so a task cannot be created.');
      return;
    }
    if (!selectedPropertyId || isAllPropertiesSelected) {
      setRecommendationsError('Choose a single property before creating a recommendation task.');
      return;
    }

    setRecommendationsError(null);
    setRecommendationFeedbackLoading((current) => ({ ...current, [recommendationId]: 'task' }));

    try {
      const response = await authFetch(`${RECOMMENDATIONS_BASE_URL}/${recommendationId}/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: selectedPropertyId }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Task creation failed: ${response.status}`);
      }
      if (payload.task) {
        const savedTask = normalizeTaskRecord({
          id: payload.task.id,
          owner_user_id: currentUser?.id,
          property_id: payload.task.propertyId,
          title: payload.task.title,
          description: payload.task.description,
          notes: payload.task.notes,
          due_date: payload.task.dueDate,
          status: payload.task.status,
          created_at: payload.task.createdAt,
          updated_at: payload.task.updatedAt,
        });
        setTasks((current) => current.some((task) => task.id === savedTask.id) ? current : [savedTask, ...current]);
      }
      setRecommendationsData((current) => {
        if (!current?.recommendations) return current;
        return {
          ...current,
          recommendations: current.recommendations.map((item) => (
            item.storedRecommendationId === recommendationId
              ? {
                  ...item,
                  taskId: payload?.recommendation?.taskId || item.taskId,
                  status: payload?.recommendation?.status || item.status,
                  latestFeedbackType: payload?.recommendation?.latestFeedbackType || item.latestFeedbackType,
                  implementationStatus: payload?.recommendation?.implementationStatus || item.implementationStatus,
                }
              : item
          )),
        };
      });
    } catch (error) {
      console.error('Recommendation task creation failed', error);
      setRecommendationsError(error.message || 'Unable to create a task from this recommendation.');
    } finally {
      setRecommendationFeedbackLoading((current) => {
        const next = { ...current };
        delete next[recommendationId];
        return next;
      });
    }
  };

  const reviewRecommendationImpact = async (recommendation) => {
    const recommendationId = recommendation?.storedRecommendationId;
    if (!recommendationId) {
      setRecommendationsError('This recommendation was not stored yet, so impact cannot be reviewed.');
      return;
    }
    if (!selectedPropertyId || isAllPropertiesSelected) {
      setRecommendationsError('Choose a single property before reviewing recommendation impact.');
      return;
    }

    setRecommendationsError(null);
    setRecommendationFeedbackLoading((current) => ({ ...current, [recommendationId]: 'impact' }));

    try {
      const response = await authFetch(`${RECOMMENDATIONS_BASE_URL}/${recommendationId}/impact-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: selectedPropertyId }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Impact review failed: ${response.status}`);
      }
      setRecommendationsData((current) => {
        if (!current?.recommendations) return current;
        return {
          ...current,
          recommendations: current.recommendations.map((item) => (
            item.storedRecommendationId === recommendationId
              ? {
                  ...item,
                  implementationStatus: payload?.recommendation?.implementationStatus || item.implementationStatus,
                  implementationReview: payload?.recommendation?.implementationReview || item.implementationReview,
                  implementationReviewedAt: payload?.recommendation?.implementationReviewedAt || item.implementationReviewedAt,
                }
              : item
          )),
        };
      });
    } catch (error) {
      console.error('Recommendation impact review failed', error);
      setRecommendationsError(error.message || 'Unable to review recommendation impact.');
    } finally {
      setRecommendationFeedbackLoading((current) => {
        const next = { ...current };
        delete next[recommendationId];
        return next;
      });
    }
  };

  const reputationOverview = reputationData?.overview || {};
  const reputationAverageRating = reputationOverview.averageRating ?? null;
  const reputationReviewCount = reputationOverview.reviewCount ?? null;
  const reputationResponseRate = reputationOverview.responseRate ?? null;
  const reputationSentimentScore = reputationOverview.sentimentScore ?? null;
  const reputationSummary = reputationData?.summary || [];
  const reputationWindow = reputationData?.window || null;

  const ga4AcquisitionChannels = ga4Data?.Acquisition?.channels || [];
  const ga4ApplyPage = ga4Data?.Diagnostic?.applyPage || null;
  const ga4Sessions = ga4Data?.Acquisition?.totals?.current?.sessions ?? null;
  const ga4NewUsers = ga4Data?.Acquisition?.totals?.current?.newUsers ?? null;
  const ga4EventTotal = ga4Data?.Conversion?.totals?.currentEventCount ?? null;
  const googleAdsOverview = googleAdsData?.Overview?.current || null;
  const googleAdsCampaigns = googleAdsData?.Campaigns || [];
  const metaAdsOverview = metaAdsData?.Overview?.current || null;
  const metaAdsCampaigns = metaAdsData?.Campaigns || [];
  const ga4StatusMessage = normalizeAnalyticsError(ga4Error);
  const googleAdsStatusMessage = normalizeAnalyticsError(googleAdsError);
  const metaAdsStatusMessage = normalizeAnalyticsError(metaAdsError);
  const reputationStatusMessage = normalizeAnalyticsError(reputationError);
  const localFalconStatusMessage = normalizeAnalyticsError(localFalconError);
  const ga4Blocked = Boolean(ga4StatusMessage && !ga4Data);
  const localFalconOverview = localFalconData?.Overview || null;
  const localFalconKeywords = localFalconData?.Keywords || [];
  const localFalconReports = localFalconData?.Reports || [];
  const localFalconLocation = localFalconData?.Location || null;
  const localFalconLatestReport = localFalconReports[0] || null;
  const localFalconLatestScan = localFalconData?.LatestScan || null;
  const localFalconGrid = localFalconData?.Grid || {};
  const localFalconGridPoints = Array.isArray(localFalconGrid?.points) ? localFalconGrid.points : [];
  const localFalconGridSize = Number(localFalconGrid?.size || localFalconLatestScan?.gridSize || 0);
  const localFalconCompetitors = Array.isArray(localFalconData?.Competitors) ? localFalconData.Competitors : [];
  const localFalconHeatmapUrl = localFalconOverview?.heatmap || localFalconLatestReport?.heatmap || localFalconLatestScan?.raw?.heatmap;
  const localFalconMapImageUrl = localFalconOverview?.image || localFalconLatestReport?.image || localFalconLatestScan?.raw?.image;
  const localFalconReportUrl = localFalconLatestReport?.publicUrl || localFalconOverview?.publicUrl || localFalconLatestScan?.raw?.public_url;
  const localFalconPdfUrl = localFalconLatestReport?.pdf || localFalconOverview?.pdf || localFalconLatestScan?.raw?.pdf;
  const redListPortfolioRows = useMemo(() => (
    redListPortfolioSummaries
      .map((summary) => {
        const property = taskPropertyById.get(String(summary.property_id)) || taskPropertyById.get(summary.property_id);
        const title = property?.name || `Property ${summary.property_id}`;
        const location = [property?.city, property?.state].filter(Boolean).join(', ');
        const isConventional = summary.portfolio === 'multifamily';
        const activityWindowDays = Number(summary.activity_window_days || 30);
        const asOfText = summary.as_of_date ? `As of ${formatReadableDate(summary.as_of_date)}` : 'Latest Supabase snapshot';
        const primaryMetric = summary.portfolio === 'multifamily'
          ? `${formatPercent(summary.forecast_exposure_rate, 1)} 60-day exposure`
          : `${formatPercent(summary.lead_fulfillment_rate, 1)} lead fulfillment`;
        const secondaryMetric = summary.portfolio === 'multifamily'
          ? `${formatNumber(summary.lead_deficit_at_ten_close)} lead deficit at 10%`
          : `${formatNumber(summary.lead_deficit_at_thirty_close)} lead deficit at 30%`;
        return {
          ...summary,
          title,
          location,
          isConventional,
          activityWindowDays,
          asOfText,
          primaryMetric,
          secondaryMetric,
        };
      })
      .sort((a, b) => {
        if (a.portfolio !== b.portfolio) return a.portfolio.localeCompare(b.portfolio);
        const aRisk = a.portfolio === 'multifamily'
          ? Number(a.forecast_exposure_rate || 0)
          : 1 - Number(a.lead_fulfillment_rate ?? 1);
        const bRisk = b.portfolio === 'multifamily'
          ? Number(b.forecast_exposure_rate || 0)
          : 1 - Number(b.lead_fulfillment_rate ?? 1);
        return bRisk - aRisk;
      })
  ), [redListPortfolioSummaries, taskPropertyById]);
  const redListStudentRows = useMemo(
    () => redListPortfolioRows.filter((summary) => !summary.isConventional && summary.is_red_list),
    [redListPortfolioRows]
  );
  const redListConventionalRows = useMemo(
    () => redListPortfolioRows.filter((summary) => summary.isConventional && summary.is_red_list),
    [redListPortfolioRows]
  );
  const redListLeadDeficitRows = useMemo(
    () => [...redListPortfolioRows].sort((a, b) => {
      if (Number(Boolean(b.is_red_list)) !== Number(Boolean(a.is_red_list))) {
        return Number(Boolean(b.is_red_list)) - Number(Boolean(a.is_red_list));
      }
      if (a.isConventional !== b.isConventional) return Number(a.isConventional) - Number(b.isConventional);
      const aDeficit = a.isConventional
        ? Number(a.lead_deficit_at_ten_close || 0)
        : Number(a.lead_deficit_at_thirty_close || 0);
      const bDeficit = b.isConventional
        ? Number(b.lead_deficit_at_ten_close || 0)
        : Number(b.lead_deficit_at_thirty_close || 0);
      return bDeficit - aDeficit;
    }),
    [redListPortfolioRows]
  );
  const showLoader = loading || invoiceLoading || roiLoading;

  const renderPropertyInfo = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading property info...</div>}>
      <PropertyInfoView
        {...{
          MARKETING_BUDGET_STATUSES,
          activeApprovedMarketingBudget,
          activeMarketingBudgetItems,
          actualMarketingSpendBreakdown,
          actualMarketingSpendError,
          actualMarketingSpendLast30,
          actualMarketingSpendLoading,
          actualPerformanceMarketingSpendLast30,
          availabilityPricingSnapshot,
          availabilitySummary,
          deleteMarketingBudgetItem,
          extractSpecialItems,
          formatCurrency,
          formatNumber,
          formatReadableDate,
          futureMarketingBudgetItems,
          getAvailabilityDate,
          getAvailabilityStatus,
          getFloorplanDepositRange,
          getFloorplanPriceRange,
          getPropertyBudgetAriaSort,
          getPropertyUnitPriceRange,
          getPropertyUnitSpaces,
          getRoomCount,
          getSpecialDateRange,
          getSpecialDescription,
          getSpecialTitle,
          latestAvailabilityDate,
          loadMarketingBudgetItems,
          loading,
          marketingBudgetDraft,
          marketingBudgetError,
          marketingBudgetItems,
          marketingBudgetLoading,
          marketingBudgetNotice,
          marketingBudgetSaving,
          marketingBudgetVarianceLast30,
          normalizeExternalUrl,
          openMarketingBudgetContract,
          propertyBudgetItemsExpanded,
          propertyInfoLoading,
          removeMarketingBudgetContract,
          renderMetricValue,
          renderPropertyBudgetSortHeader,
          saveMarketingBudgetItem,
          selectedPropertyId,
          selectedPropertyLabel,
          setPropertyBudgetItemsExpanded,
          sortedMarketingBudgetItems,
          specialsSnapshot,
          totalApplications,
          totalLeads,
          totalLeases,
          updateMarketingBudgetDraft,
          updateMarketingBudgetField,
        }}
      />
    </React.Suspense>
  );


  const renderAnalytics = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading analytics view...</div>}>
      <AnalyticsView
        {...{
          CHART_AXIS_DARK,
          CHART_AXIS_DARK_SOFT,
          CHART_AXIS_LIGHT,
          CHART_AXIS_LIGHT_SOFT,
          CHART_COLOR_GOLD,
          CHART_COLOR_GREEN,
          CHART_COLOR_ORANGE,
          CHART_COLOR_PINK,
          CHART_COLOR_SECONDARY_TAN,
          CHART_COLOR_TAN,
          CHART_GRID_DARK,
          CHART_GRID_LIGHT,
          CHART_MARGIN_STANDARD,
          CHART_MARGIN_TALL,
          CHART_MARGIN_VERTICAL,
          CHART_TOOLTIP_ITEM_STYLE,
          CHART_TOOLTIP_LABEL_STYLE,
          CHART_TOOLTIP_STYLE,
          MeasuredChart,
          formatCurrency,
          formatDateInputValue,
          formatNumber,
          formatPercent,
          formatSignedPercent,
          getDeltaTone,
          metaAdsAttributionMode,
          rangeDates,
          renderMetricValue,
          selectedProperty,
          selectedPropertyId,
          selectedPropertyLabel,
          setMetaAdsAttributionMode,
          shortenLabel,
        }}
      />
    </React.Suspense>
  );

  const renderCallPrep = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading call prep view...</div>}>
      <CallPrepView
        availableProperties={availableProperties}
        selectedProperty={selectedProperty}
        selectedPropertyLabel={selectedPropertyLabel}
        selectedPropertyId={selectedPropertyId}
        isAllPropertiesSelected={isAllPropertiesSelected}
        recommendationsData={recommendationsData}
        recommendationsError={recommendationsError}
        recommendationsLoading={recommendationsLoading}
        generateRecommendations={generateRecommendations}
        taskStatuses={TASK_STATUSES}
        formatDateInputValue={formatDateInputValue}
        formatReadableDate={formatReadableDate}
        formatNumber={formatNumber}
        formatCurrency={formatCurrency}
        formatPercent={formatPercent}
        formatSignedPercent={formatSignedPercent}
        getDeltaTone={getDeltaTone}
        renderMetricValue={renderMetricValue}
        miniMetricLoader={<MiniMetricLoader />}
        normalizeAnalyticsError={normalizeAnalyticsError}
        parseCurrency={parseCurrency}
      />
    </React.Suspense>
  );

  // ──────────────── RENDER ────────────────

  const renderDashboard = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading dashboard view...</div>}>
      <DashboardView
        {...{
          CHART_AXIS_DARK,
          CHART_AXIS_DARK_SOFT,
          CHART_COLOR_GREEN,
          CHART_COLOR_ORANGE,
          CHART_COLOR_PINK,
          CHART_COLOR_SECONDARY_TAN,
          CHART_COLOR_TAN,
          CHART_GRID_DARK,
          CHART_MARGIN_TALL,
          CHART_MARGIN_VERTICAL,
          CHART_TOOLTIP_ITEM_STYLE,
          CHART_TOOLTIP_LABEL_STYLE,
          CHART_TOOLTIP_STYLE,
          DollarSign,
          FileCheck,
          Home,
          MeasuredChart,
          TrendingUp,
          Users,
          adjustedMarketingSpend,
          activeRedListStatus,
          allCanonicalLeadItems,
          applicationConversion,
          applicationToLeaseConversion,
          approvedLeaseRecords,
          attributedLeaseCount,
          attributionMatchRate,
          blendedRoas,
          blendedRoi,
          completedApplicationRecords,
          conventionalLeadDeficitMetrics,
          costPerLead,
          costPerLease,
          formatCurrency,
          formatDateInputValue,
          formatNumber,
          formatPercent,
          formatReadableDate,
          formatSignedPercent,
          funnelMetricSource,
          invoiceLoading,
          isConventionalLeadDeficitPanel,
          leaseConversion,
          loading,
          marketingSpendBreakdown,
          rangeDates,
          redListSummary,
          renderMetricValue,
          roiLoading,
          roiTotals,
          selectedProperty,
          studentLeadDeficitMetrics,
          toggleMarketingSpendLine,
          totalApplications,
          totalBlendedMarketingSpend,
          totalLeads,
          totalLeases,
        }}
      />
    </React.Suspense>
  );

  const renderAuditCommandCenter = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading audit view...</div>}>
      <AuditView
        {...{
          AUDIT_FINDING_WORKFLOW_STATUSES,
          AUDIT_RISK_ORDER,
          AUDIT_RUBRIC_FALLBACK_MAP,
          AUDIT_RUBRIC_ITEMS,
          AUDIT_REVIEW_TABS,
          AUDIT_TABLE_FILTERS,
          AuditScoreSparkline,
          HEATMAP_DEVICE_OPTIONS,
          auditFindingWorkflowStorageKey,
          formatAuditScoreChange,
          formatDateInputValue,
          formatNumber,
          getAuditFindingKey,
          getAuditFindingWorkflowLabel,
          getAuditReasonText,
          getAuditRiskClass,
          getAuditRubricStatusLabel,
          getDeltaTone,
          getSnapshotTimestampLabel,
          heatmapSiteKey: heatmapSiteDraft.siteKey,
          normalizeAuditRubricStatus,
          propertyMatchesAuditFilter,
          rangeDates,
          renderMetricValue,
          selectedPropertyId,
          selectedPropertyLabel,
          setSelectedPropertyId,
        }}
      />
    </React.Suspense>
  );

  const renderReports = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading reports view...</div>}>
      <ReportsView
        {...{
          CHART_AXIS_LIGHT,
          CHART_AXIS_LIGHT_SOFT,
          CHART_COLOR_GOLD,
          CHART_COLOR_GREEN,
          CHART_COLOR_ORANGE,
          CHART_COLOR_TAN,
          CHART_GRID_LIGHT,
          CHART_MARGIN_STANDARD,
          CHART_TOOLTIP_ITEM_STYLE,
          CHART_TOOLTIP_LABEL_STYLE,
          CHART_TOOLTIP_STYLE,
          HEATMAP_DEVICE_OPTIONS,
          MeasuredChart,
          MiniMetricLoader,
          activeRedListStatus,
          adjustedMarketingSpend,
          applicationConversion,
          applicationToLeaseConversion,
          attributedLeaseCount,
          blendedRoas,
          blendedRoi,
          canEditReportingLayout,
          clientReportLink,
          conventionalLeadDeficitMetrics,
          costPerLead,
          costPerLease,
          formatCurrency,
          formatDateInputValue,
          formatDurationMs,
          formatNumber,
          formatPercent,
          formatReadableDate,
          formatSignedPercent,
          funnelMetricSource,
          ga4AcquisitionChannels,
          ga4ApplyPage,
          ga4Blocked,
          ga4EventTotal,
          ga4Loading,
          ga4NewUsers,
          ga4Sessions,
          ga4StatusMessage,
          getLocalFalconRankTone,
          getSnapshotTimestampLabel,
          googleAdsCampaigns,
          googleAdsLoading,
          googleAdsOverview,
          googleAdsStatusMessage,
          heatmapSiteKey: heatmapSiteDraft.siteKey,
          invoiceLoading,
          isClientReportMode,
          isConventionalLeadDeficitPanel,
          leadStatusBreakdown,
          leaseConversion,
          loading,
          localFalconCompetitors,
          localFalconData,
          localFalconGridPoints,
          localFalconGridSize,
          localFalconHeatmapUrl,
          localFalconKeywords,
          localFalconLatestReport,
          localFalconLatestScan,
          localFalconLoading,
          localFalconLocation,
          localFalconMapImageUrl,
          localFalconOverview,
          localFalconPdfUrl,
          localFalconReportUrl,
          localFalconReports,
          localFalconStatusMessage,
          marketingSpendBreakdown,
          metaAdsCampaigns,
          metaAdsLoading,
          metaAdsOverview,
          metaAdsStatusMessage,
          rangeDates,
          redListSummary,
          renderMetricValue,
          reportingSourceBadge,
          reputationAverageRating,
          reputationLoading,
          reputationResponseRate,
          reputationReviewCount,
          reputationSentimentScore,
          reputationStatusMessage,
          reputationSummary,
          reputationWindow,
          roiLoading,
          roiPipelineStatus,
          roiPipelineStatusLoading,
          roiSourceBreakdown,
          roiTotals,
          selectedPropertyId,
          selectedPropertyLabel,
          shortenLabel,
          studentLeadDeficitMetrics,
          toggleMarketingSpendLine,
          totalApplications,
          totalBlendedMarketingSpend,
          totalLeads,
          totalLeases,
          totalPerformanceMarketingCost,
          unattributedLeaseCount,
        }}
      />
    </React.Suspense>
  );

  const renderReputation = () => (
    <React.Suspense fallback={<div className="reports-empty">Loading reputation view...</div>}>
      <ReputationView
        {...{
          formatDateInputValue,
          formatNumber,
          formatPercent,
          rangeDates,
          renderMetricValue,
          reputationData,
          reputationError,
          reputationLoading,
          selectedPropertyId,
          selectedPropertyLabel,
        }}
      />
    </React.Suspense>
  );

  const renderWebsiteManager = () => (
    <div className="website-manager-view">
      {(websiteManagerError || websiteManagerNotice) && (
        <div className={`website-manager-banner ${websiteManagerError ? 'website-manager-banner--error' : 'website-manager-banner--success'}`}>
          {websiteManagerError || websiteManagerNotice}
        </div>
      )}
      {(heatmapSiteError || heatmapSiteNotice) && (
        <div className={`website-manager-banner ${heatmapSiteError ? 'website-manager-banner--error' : 'website-manager-banner--success'}`}>
          {heatmapSiteError || heatmapSiteNotice}
        </div>
      )}

      {!canEditWebsiteManager && (
        <div className="website-manager-banner">
          Your current role can view website editor content for this property, but editing is disabled.
        </div>
      )}

      <div className="website-manager-command-bar">
        <div className="website-manager-command-bar__meta">
          <div className="website-manager-command-bar__title">
            <span>Website Editor</span>
            <strong>{selectedPropertyLabel}</strong>
          </div>
          <div className="website-manager-status-strip">
            <div className="website-manager-status-item">
              <span>Status</span>
              <strong>{websiteManagerLoading ? 'Loading' : websiteManagerDirty ? 'Unsaved' : 'Saved'}</strong>
            </div>
            <div className="website-manager-status-item">
              <span>Platform</span>
              <strong>{websitePlatformMeta.label}</strong>
            </div>
            <div className="website-manager-status-item">
              <span>Filled</span>
              <strong>{Object.values(websiteManagerDraft.content).filter((value) => String(value || '').trim()).length}</strong>
            </div>
            <div className="website-manager-status-item">
              <span>Sync</span>
              <strong>{getSnapshotTimestampLabel(websiteManagerDraft.wordpressSync.latestEntrataSyncAt)}</strong>
            </div>
            <div className="website-manager-status-item">
              <span>WP key</span>
              <strong>{websiteManagerDraft.wordpressSiteKey || 'Not set'}</strong>
            </div>
          </div>
        </div>
        <div className="website-manager-command-bar__actions">
          <button
            type="button"
            className="website-manager-button website-manager-button--ghost"
            onClick={resetWebsiteManagerDraft}
            disabled={!websiteManagerDirty || websiteManagerSaving || !canEditWebsiteManager}
          >
            Reset
          </button>
          <button
            type="button"
            className="website-manager-button website-manager-button--ghost"
            onClick={() => setWebsiteManagerSection('preview')}
          >
            Preview
          </button>
          <button
            type="button"
            className="website-manager-button website-manager-button--primary"
            onClick={() => persistWebsiteManagerDraft({ publish: false })}
            disabled={!websiteManagerDirty || websiteManagerSaving || !canEditWebsiteManager}
          >
            {websiteManagerSaving && websiteManagerAction === 'save' ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            type="button"
            className="website-manager-button website-manager-button--primary"
            onClick={() => persistWebsiteManagerDraft({ publish: true })}
            disabled={websiteManagerSaving || !websiteManagerPublishReady}
          >
            {websiteManagerSaving && websiteManagerAction === 'publish' ? 'Updating…' : 'Update Website'}
          </button>
        </div>
      </div>

      <div className="website-manager-workspace">
        <div className="website-manager-left-rail">
          <nav className="website-manager-section-nav" aria-label="Website editor sections">
            {[
              { id: 'setup', label: 'Setup', detail: 'Platform, URL, WordPress key, tracking' },
              { id: 'content', label: 'Content Editor', detail: `${websiteManagerSchemaGroups.length} content groups` },
              { id: 'preview', label: 'Preview', detail: 'Resolved content, tokens, live fields' },
              { id: 'deploy', label: 'Deploy / Sync', detail: websiteManagerDirty ? 'Draft has unsaved changes' : 'Draft is current' }
            ].map((section) => (
              <button
                key={section.id}
                type="button"
                className={`website-manager-section-nav__item ${websiteManagerSection === section.id ? 'is-active' : ''}`}
                onClick={() => setWebsiteManagerSection(section.id)}
              >
                <span>{section.label}</span>
                <small>{section.detail}</small>
              </button>
            ))}
          </nav>

          {websiteManagerSection === 'content' && (
            <aside className="website-manager-content-rail" aria-label="Website content sections">
              <div className="website-manager-content-rail__head">
                <div className="website-manager-panel__eyebrow">Sections</div>
                <strong>{visibleWebsiteManagerGroups.length}/{websiteManagerSchemaGroups.length}</strong>
              </div>
              <label className="website-manager-search">
                <span className="website-manager-field__label">Search content</span>
                <input
                  type="search"
                  value={websiteManagerContentSearch}
                  onChange={(event) => setWebsiteManagerContentSearch(event.target.value)}
                  className="website-manager-field__input"
                  placeholder="Label, content, token..."
                />
              </label>
              <div className="website-manager-filter-row" aria-label="Content filters">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'empty', label: 'Empty' },
                  { id: 'changed', label: 'Changed' },
                  { id: 'required', label: 'Required' },
                  { id: 'live_filled', label: 'Live-filled' }
                ].map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={`website-manager-filter-chip ${websiteManagerContentFilter === filter.id ? 'is-active' : ''}`}
                    onClick={() => setWebsiteManagerContentFilter(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="website-manager-actions website-manager-actions--rail">
                <button
                  type="button"
                  className="website-manager-button website-manager-button--ghost"
                  onClick={jumpToFirstMissingWebsiteManagerField}
                  disabled={!websiteManagerSchemaGroups.some((group) => group.fields.some((field) => getWebsiteManagerFieldStatus(field).isEmpty))}
                >
                  First Missing
                </button>
              </div>
              <div className="website-manager-content-rail__list">
                {visibleWebsiteManagerGroups.map((group) => {
                  const filledFields = group.fields.filter((field) => String(websiteManagerDraft.content[field.key] || '').trim()).length;
                  const changedFields = group.fields.filter((field) => getWebsiteManagerFieldStatus(field).isChanged).length;
                  const isExpanded = expandedWebsiteManagerGroups.has(group.id);
                  return (
                    <div key={group.id} className={`website-manager-content-rail__group ${selectedWebsiteManagerGroup?.id === group.id ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className="website-manager-content-rail__item"
                        onClick={() => setSelectedWebsiteManagerGroupId(group.id)}
                      >
                        <span>{group.label}</span>
                        <small>{filledFields}/{group.fields.length} fields</small>
                      </button>
                      <div className="website-manager-content-rail__meta">
                        <span className={`website-manager-state-badge ${changedFields ? 'is-unsaved' : 'is-published'}`}>
                          {changedFields ? `${changedFields} changed` : 'Published'}
                        </span>
                        <button
                          type="button"
                          className="website-manager-rail-toggle"
                          onClick={() => setExpandedWebsiteManagerGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })}
                        >
                          {isExpanded ? 'Collapse' : 'Fields'}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="website-manager-content-rail__fields">
                          {group.fields.map((field) => {
                            const status = getWebsiteManagerFieldStatus(field);
                            return (
                              <button
                                key={field.key}
                                type="button"
                                className="website-manager-content-rail__field"
                                onClick={() => jumpToWebsiteManagerField(field)}
                              >
                                <span>{field.label}</span>
                                <small>{status.isEmpty ? 'Empty' : status.isChanged ? 'Changed' : 'Saved'}</small>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {visibleWebsiteManagerGroups.length === 0 && (
                  <div className="website-manager-empty">No fields match the current search and filter.</div>
                )}
              </div>
            </aside>
          )}
        </div>

        <div className="website-manager-section-panel">
          {websiteManagerSection === 'setup' && (
            <div className="website-manager-panel">
              <div className="website-manager-section-head">
                <div>
                  <div className="website-manager-panel__eyebrow">Setup</div>
                  <h3 className="website-manager-panel__title">Website classification and tracking configuration</h3>
                </div>
              </div>

              <div className="website-manager-form-grid">
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Website platform</span>
                  <select
                    value={websiteManagerDraft.platform}
                    onChange={(event) => updateWebsiteManagerField('platform', event.target.value)}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager}
                  >
                    {[
                      { value: 'unknown', label: 'Needs review' },
                      { value: 'wordpress_custom', label: 'WordPress custom' },
                      { value: 'entrata', label: 'Entrata website' },
                      { value: 'other', label: 'Other platform' }
                    ].map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Public website URL</span>
                  <input
                    type="text"
                    value={websiteManagerDraft.websiteUrl}
                    onChange={(event) => updateWebsiteManagerField('websiteUrl', event.target.value)}
                    className="website-manager-field__input"
                    placeholder="https://www.example.com"
                    disabled={!canEditWebsiteManager}
                  />
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">WordPress site key</span>
                  <input
                    type="text"
                    value={websiteManagerDraft.wordpressSiteKey}
                    onChange={(event) => updateWebsiteManagerField('wordpressSiteKey', event.target.value)}
                    className="website-manager-field__input"
                    placeholder="montaire"
                    disabled={!canEditWebsiteManager}
                  />
                </label>
                <label className="website-manager-field website-manager-field--wide">
                  <span className="website-manager-field__label">Implementation notes</span>
                  <textarea
                    value={websiteManagerDraft.notes}
                    onChange={(event) => updateWebsiteManagerField('notes', event.target.value)}
                    className="website-manager-field__input website-manager-field__input--textarea"
                    placeholder="Add rollout notes, environment reminders, or page-level mapping details."
                    disabled={!canEditWebsiteManager}
                  />
                </label>
              </div>

              <div className={`website-manager-lockup ${websiteManagerEditable ? 'website-manager-lockup--editable' : 'website-manager-lockup--blocked'}`}>
                <strong>{websiteManagerEditable ? 'WordPress path is open.' : 'Content editing is currently blocked.'}</strong>
                <span>
                  {websiteManagerEditable
                    ? 'These fields can be maintained here and later pushed into WordPress templates or database values.'
                    : 'Set the platform to WordPress custom before using this tab as a content source. Entrata properties stay informational only.'}
                </span>
              </div>

              <div className="website-manager-section-divider" />

              <div className="website-manager-section-head">
                <div>
                  <div className="website-manager-panel__eyebrow">Tracking setup</div>
                  <h3 className="website-manager-panel__title">Heatmap and audit snippet configuration</h3>
                </div>
              </div>

              <div className="website-manager-form-grid">
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Tracking site name</span>
                  <input
                    type="text"
                    value={heatmapSiteDraft.name}
                    onChange={(event) => updateHeatmapSiteField('name', event.target.value)}
                    className="website-manager-field__input"
                    placeholder={selectedPropertyLabel}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  />
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Heatmap/audit site key</span>
                  <input
                    type="text"
                    value={heatmapSiteDraft.siteKey || (heatmapSiteDraft.id ? 'Generated after save' : '')}
                    onChange={(event) => updateHeatmapSiteField('siteKey', event.target.value)}
                    className="website-manager-field__input"
                    placeholder="Generated when saved"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading || !heatmapSiteDraft.siteKey}
                  />
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Sampling rate</span>
                  <select
                    value={String(heatmapSiteDraft.samplingRate)}
                    onChange={(event) => updateHeatmapSiteField('samplingRate', Number(event.target.value))}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  >
                    <option value="0.1">10%</option>
                    <option value="0.25">25%</option>
                    <option value="0.5">50%</option>
                    <option value="1">100%</option>
                  </select>
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Screenshot capture</span>
                  <select
                    value={heatmapSiteDraft.screenshotCaptureFrequency}
                    onChange={(event) => updateHeatmapSiteField('screenshotCaptureFrequency', event.target.value)}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading || !heatmapSiteDraft.featureFlags.screenshots}
                  >
                    <option value="manual">Manual / disabled</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Consent mode</span>
                  <select
                    value={heatmapSiteDraft.consentMode}
                    onChange={(event) => updateHeatmapSiteField('consentMode', event.target.value)}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  >
                    <option value="opt_out">Opt-out unless denied</option>
                    <option value="required">Require explicit opt-in</option>
                    <option value="disabled">Disable consent checks</option>
                  </select>
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Screenshot minimum interval</span>
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={heatmapSiteDraft.screenshotMinIntervalHours}
                    onChange={(event) => updateHeatmapSiteField('screenshotMinIntervalHours', Number(event.target.value))}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading || !heatmapSiteDraft.featureFlags.screenshots}
                  />
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Raw event retention</span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={heatmapSiteDraft.rawEventRetentionDays}
                    onChange={(event) => updateHeatmapSiteField('rawEventRetentionDays', Number(event.target.value))}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  />
                </label>
                <label className="website-manager-field">
                  <span className="website-manager-field__label">Aggregate retention</span>
                  <input
                    type="number"
                    min="30"
                    max="3650"
                    value={heatmapSiteDraft.aggregateRetentionDays}
                    onChange={(event) => updateHeatmapSiteField('aggregateRetentionDays', Number(event.target.value))}
                    className="website-manager-field__input"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  />
                </label>
                <label className="website-manager-field website-manager-field--wide">
                  <span className="website-manager-field__label">Allowed domains</span>
                  <textarea
                    value={toDomainText(heatmapSiteDraft.allowedDomains)}
                    onChange={(event) => updateHeatmapSiteField('allowedDomains', parseDomainText(event.target.value))}
                    className="website-manager-field__input website-manager-field__input--textarea"
                    placeholder="example.com"
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  />
                </label>
              </div>

              <div className="website-manager-checklist">
                <label className="website-manager-checklist__item">
                  <input
                    type="checkbox"
                    checked={heatmapSiteDraft.trackingEnabled}
                    onChange={(event) => updateHeatmapSiteField('trackingEnabled', event.target.checked)}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  /> Tracking enabled
                </label>
                <label className="website-manager-checklist__item">
                  <input
                    type="checkbox"
                    checked={heatmapSiteDraft.featureFlags.heatmaps}
                    onChange={(event) => updateHeatmapFeatureFlag('heatmaps', event.target.checked)}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  /> Behavioral heatmaps
                </label>
                <label className="website-manager-checklist__item">
                  <input
                    type="checkbox"
                    checked={heatmapSiteDraft.featureFlags.pageSnapshots}
                    onChange={(event) => updateHeatmapFeatureFlag('pageSnapshots', event.target.checked)}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  /> Page audit snapshots
                </label>
                <label className="website-manager-checklist__item">
                  <input
                    type="checkbox"
                    checked={heatmapSiteDraft.featureFlags.screenshots}
                    onChange={(event) => updateHeatmapFeatureFlag('screenshots', event.target.checked)}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  /> Screenshot capture
                </label>
                <label className="website-manager-checklist__item">
                  <input
                    type="checkbox"
                    checked={heatmapSiteDraft.respectDnt}
                    onChange={(event) => updateHeatmapSiteField('respectDnt', event.target.checked)}
                    disabled={!canEditWebsiteManager || heatmapSiteSaving || heatmapSiteLoading}
                  /> Respect Do Not Track
                </label>
              </div>

              <label className="website-manager-field website-manager-field--wide">
                <span className="website-manager-field__label">Manual snippet for non-WordPress / Entrata / other platforms</span>
                <textarea
                  value={manualTrackerSnippet || 'Save tracking setup to generate a site key and snippet.'}
                  readOnly
                  className="website-manager-field__input website-manager-field__input--textarea"
                  rows="3"
                />
              </label>

              <div className="website-manager-actions">
                <button
                  type="button"
                  className="website-manager-button website-manager-button--ghost"
                  onClick={resetHeatmapSiteDraft}
                  disabled={!heatmapSiteDirty || heatmapSiteSaving || !canEditWebsiteManager}
                >
                  Reset Tracking
                </button>
                <button
                  type="button"
                  className="website-manager-button website-manager-button--primary"
                  onClick={persistHeatmapSiteDraft}
                  disabled={heatmapSiteSaving || !canEditWebsiteManager || (!heatmapSiteDirty && Boolean(heatmapSiteDraft.siteKey))}
                >
                  {heatmapSiteSaving ? 'Saving…' : heatmapSiteDraft.siteKey ? 'Save Tracking Setup' : 'Generate Tracking Site'}
                </button>
              </div>
            </div>
          )}

          {websiteManagerSection === 'content' && (
            <div className={`website-manager-editor-workbench ${websiteManagerReferenceOpen ? 'has-reference' : 'is-reference-collapsed'}`}>
              <div className="website-manager-panel website-manager-panel--editor">
                <div className="website-manager-section-head website-manager-section-head--sticky">
                  <div>
                    <div className="website-manager-panel__eyebrow">Content editor</div>
                    <h3 className="website-manager-panel__title">{selectedWebsiteManagerGroup?.label || 'Editable payload for the site'}</h3>
                  </div>
                  {selectedWebsiteManagerGroup && (
                    <div className="website-manager-edit-status">
                      <span className="website-manager-edit-count">
                        {selectedWebsiteManagerGroupFilledCount}/{selectedWebsiteManagerGroup.fields.length} filled
                      </span>
                      <span className={`website-manager-state-badge ${websiteManagerDirty ? 'is-unsaved' : 'is-published'}`}>
                        {websiteManagerDirty ? 'Unsaved' : 'Published'}
                      </span>
                    </div>
                  )}
                </div>

                {selectedWebsiteManagerGroup ? (
                  <div className="website-manager-group website-manager-group--active">
                    <div className="website-manager-form-grid">
                      {selectedWebsiteManagerGroupVisibleFields.map((field) => {
                        const status = getWebsiteManagerFieldStatus(field);
                        return (
                          <label key={field.key} className={`website-manager-field ${field.type === 'richtext' ? 'website-manager-field--wide' : ''}`}>
                            <span className="website-manager-field__header">
                              <span className="website-manager-field__label">{field.label}</span>
                              <span className="website-manager-field__badges">
                                <button
                                  type="button"
                                  className="website-manager-token-icon"
                                  onClick={() => copyWebsiteManagerToken(status.tokenText)}
                                  aria-label={`Copy ${field.label} token`}
                                  title={copiedWebsiteManagerToken === status.tokenText ? 'Copied' : status.tokenText}
                                >
                                  {copiedWebsiteManagerToken === status.tokenText ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                                {status.isEmpty && <span className="website-manager-state-badge is-empty">Empty</span>}
                                {status.isChanged && <span className="website-manager-state-badge is-changed">Changed</span>}
                                {!status.isChanged && !status.isEmpty && <span className="website-manager-state-badge is-published">Published</span>}
                                {status.isLiveFilled && <span className="website-manager-state-badge">Live-filled</span>}
                              </span>
                            </span>
                            {field.type === 'richtext' ? (
                              <>
                                <div className={`website-manager-format-row ${activeWebsiteManagerFieldKey === field.key ? 'is-active' : ''}`} aria-label={`${field.label} formatting helpers`}>
                                  <span>HTML</span>
                                  <button
                                    type="button"
                                    onClick={() => insertWebsiteManagerSnippet(field.key, '<strong>Important text</strong>')}
                                    disabled={!websiteManagerEditable || !canEditWebsiteManager}
                                  >
                                    Bold
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => insertWebsiteManagerSnippet(field.key, '<br>')}
                                    disabled={!websiteManagerEditable || !canEditWebsiteManager}
                                  >
                                    Line break
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => insertWebsiteManagerSnippet(field.key, '<a href="/floorplans">View floor plans</a>')}
                                    disabled={!websiteManagerEditable || !canEditWebsiteManager}
                                  >
                                    Link
                                  </button>
                                </div>
                                <textarea
                                  id={`website-manager-field-${field.key}`}
                                  value={websiteManagerDraft.content[field.key]}
                                  onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                                  onFocus={() => setActiveWebsiteManagerFieldKey(field.key)}
                                  className={`website-manager-field__input website-manager-field__input--textarea website-manager-field__input--editor ${status.draftValue.length > 140 ? 'has-long-content' : ''}`}
                                  placeholder={field.placeholder || ''}
                                  disabled={!websiteManagerEditable || !canEditWebsiteManager}
                                />
                                <span className="website-manager-field__hint">Supports basic HTML such as strong text, line breaks, and links.</span>
                              </>
                            ) : (
                              <input
                                id={`website-manager-field-${field.key}`}
                                type="text"
                                value={websiteManagerDraft.content[field.key]}
                                onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                                onFocus={() => setActiveWebsiteManagerFieldKey(field.key)}
                                className="website-manager-field__input"
                                placeholder={field.placeholder || ''}
                                disabled={!websiteManagerEditable || !canEditWebsiteManager}
                              />
                            )}
                          </label>
                        );
                      })}
                      {selectedWebsiteManagerGroupVisibleFields.length === 0 && (
                        <div className="website-manager-empty website-manager-field--wide">No fields in this section match the current search and filter.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="website-manager-empty">No editable content sections are configured for this property yet.</div>
                )}
              </div>

              <aside className="website-manager-reference-drawer">
                <button
                  type="button"
                  className="website-manager-reference-drawer__toggle"
                  onClick={() => setWebsiteManagerReferenceOpen((isOpen) => !isOpen)}
                >
                  {websiteManagerReferenceOpen ? 'Hide reference' : 'Show reference'}
                </button>

                {websiteManagerReferenceOpen && (
                  <div className="website-manager-reference-drawer__content">
                    <div className="website-manager-reference-section">
                      <div className="website-manager-panel__eyebrow">Resolved preview</div>
                      {websiteManagerPreviewItems.length > 0 ? (
                        <div className="website-manager-preview-list website-manager-preview-list--compact">
                          {websiteManagerPreviewItems.slice(0, 5).map((item) => (
                            <div key={item.label} className="website-manager-preview">
                              <div className="website-manager-preview__label">{item.label}</div>
                              <div className="website-manager-preview__value">{item.resolved}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="website-manager-empty">Fill in content fields to generate a resolved preview.</div>
                      )}
                    </div>

                    <div className="website-manager-reference-section">
                      <div className="website-manager-panel__eyebrow">Tokens</div>
                      <label className="website-manager-search">
                        <span className="website-manager-field__label">Search tokens</span>
                        <input
                          type="search"
                          value={websiteManagerTokenSearch}
                          onChange={(event) => setWebsiteManagerTokenSearch(event.target.value)}
                          className="website-manager-field__input"
                          placeholder="Token, section, value..."
                        />
                      </label>
                      <div className="website-manager-token-groups">
                        {Array.from(websiteManagerReferenceTokenGroups.entries()).map(([groupLabel, tokens]) => (
                          <div key={groupLabel} className="website-manager-token-group">
                            <div className="website-manager-token-group__title">{groupLabel}</div>
                            <div className="website-manager-token-list website-manager-token-list--compact">
                              {tokens.map((token) => (
                                <button
                                  key={`${groupLabel}-${token.tokenText}-${token.label}`}
                                  type="button"
                                  className="website-manager-token website-manager-token--button"
                                  onClick={() => copyWebsiteManagerToken(token.tokenText)}
                                >
                                  <span>
                                    <span className="website-manager-token__name">{token.tokenText}</span>
                                    <span className="website-manager-token__detail">
                                      {token.label}: <strong>{token.detail}</strong>
                                    </span>
                                  </span>
                                  {copiedWebsiteManagerToken === token.tokenText ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        {websiteManagerReferenceTokens.length === 0 && (
                          <div className="website-manager-empty">No tokens match that search.</div>
                        )}
                      </div>
                    </div>

                    <div className="website-manager-reference-section">
                      <div className="website-manager-panel__eyebrow">Live fields</div>
                      <div className="website-manager-preview-list website-manager-preview-list--compact">
                        <div className="website-manager-preview">
                          <div className="website-manager-preview__label">Pricing</div>
                          <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.pricingSummary || 'No pricing snapshot available yet.'}</div>
                        </div>
                        <div className="website-manager-preview">
                          <div className="website-manager-preview__label">Specials</div>
                          <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.specialsSummary || 'No current specials snapshot available yet.'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="website-manager-reference-section">
                      <div className="website-manager-panel__eyebrow">Sync notes</div>
                      <div className="website-manager-checklist">
                        <div className="website-manager-checklist__item">
                          Persist path: <code>{`properties/${selectedPropertyId}/website_manager/current`}</code>
                        </div>
                        <div className="website-manager-checklist__item">
                          Entrata sync: {getSnapshotTimestampLabel(websiteManagerDraft.wordpressSync.latestEntrataSyncAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}

          {websiteManagerSection === 'preview' && (
            <div className="website-manager-preview-grid">
              <div className="website-manager-panel">
                <div className="website-manager-section-head">
                  <div>
                    <div className="website-manager-panel__eyebrow">Resolved preview</div>
                    <h3 className="website-manager-panel__title">What the content would look like on-site</h3>
                  </div>
                </div>

                {websiteManagerPreviewItems.length > 0 ? (
                  <div className="website-manager-preview-list">
                    {websiteManagerPreviewItems.map((item) => (
                      <div key={item.label} className="website-manager-preview">
                        <div className="website-manager-preview__label">{item.label}</div>
                        <div className="website-manager-preview__value">{item.resolved}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="website-manager-empty">
                    Start filling in content fields to generate a live preview using the selected property tokens.
                  </div>
                )}

                <div className="website-manager-section-divider" />

                <div className="website-manager-section-head">
                  <div>
                    <div className="website-manager-panel__eyebrow">Live Entrata fields</div>
                    <h3 className="website-manager-panel__title">Auto-filled pricing, specials, and availability</h3>
                  </div>
                </div>

                <div className="website-manager-preview-list">
                  <div className="website-manager-preview">
                    <div className="website-manager-preview__label">Pricing summary</div>
                    <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.pricingSummary || 'No pricing snapshot available yet.'}</div>
                  </div>
                  <div className="website-manager-preview">
                    <div className="website-manager-preview__label">Availability summary</div>
                    <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.availabilitySummary || 'No availability snapshot available yet.'}</div>
                  </div>
                  <div className="website-manager-preview">
                    <div className="website-manager-preview__label">Specials summary</div>
                    <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.specialsSummary || 'No current specials snapshot available yet.'}</div>
                  </div>
                  <div className="website-manager-preview">
                    <div className="website-manager-preview__label">Availability URL</div>
                    <div className="website-manager-preview__value">{websiteManagerDraft.derivedContent.availabilityUrl || 'Not provided by Entrata.'}</div>
                  </div>
                </div>
              </div>

              <div className="website-manager-panel">
                <div className="website-manager-section-head">
                  <div>
                    <div className="website-manager-panel__eyebrow">Mustache tokens</div>
                    <h3 className="website-manager-panel__title">Dynamic placeholders available today</h3>
                  </div>
                </div>

                <div className="website-manager-token-list">
                  {WEBSITE_MANAGER_TOKEN_DEFINITIONS.map((token) => (
                    <div key={token.token} className="website-manager-token">
                      <div className="website-manager-token__name">{`{{${token.token}}}`}</div>
                      <div className="website-manager-token__detail">
                        {token.label}: <strong>{websiteManagerTokenValues[token.token] || 'Not available'}</strong>
                      </div>
                    </div>
                  ))}
                  {websiteManagerContentTokens.slice(0, 18).map((field) => (
                    <div key={field.token} className="website-manager-token">
                      <div className="website-manager-token__name">
                        {field.type === 'url' ? `r:${field.token}` : `{{r:${field.token}}}`}
                      </div>
                      <div className="website-manager-token__detail">
                        {field.groupLabel}: <strong>{field.label}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {websiteManagerSection === 'deploy' && (
            <div className="website-manager-panel">
              <div className="website-manager-section-head">
                <div>
                  <div className="website-manager-panel__eyebrow">Deploy / sync</div>
                  <h3 className="website-manager-panel__title">Save drafts, update WordPress, and confirm backend flow</h3>
                </div>
              </div>

              <div className="website-manager-deploy-grid">
                <div className="website-manager-preview">
                  <div className="website-manager-preview__label">Content draft</div>
                  <div className="website-manager-preview__value">
                    {websiteManagerDirty ? 'Unsaved changes are waiting in this dashboard draft.' : 'Dashboard content matches the saved draft.'}
                  </div>
                </div>
                <div className="website-manager-preview">
                  <div className="website-manager-preview__label">Publish readiness</div>
                  <div className="website-manager-preview__value">
                    {websiteManagerPublishReady ? 'Ready to push to the linked WordPress endpoint.' : 'Publishing needs WordPress custom platform, a public URL, and a site key.'}
                  </div>
                </div>
                <div className="website-manager-preview">
                  <div className="website-manager-preview__label">Entrata live sync</div>
                  <div className="website-manager-preview__value">
                    {getSnapshotTimestampLabel(websiteManagerDraft.wordpressSync.latestEntrataSyncAt)}
                  </div>
                </div>
              </div>

              <div className="website-manager-actions website-manager-actions--left">
                <button
                  type="button"
                  className="website-manager-button website-manager-button--ghost"
                  onClick={resetWebsiteManagerDraft}
                  disabled={!websiteManagerDirty || websiteManagerSaving || !canEditWebsiteManager}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="website-manager-button website-manager-button--primary"
                  onClick={() => persistWebsiteManagerDraft({ publish: false })}
                  disabled={!websiteManagerDirty || websiteManagerSaving || !canEditWebsiteManager}
                >
                  {websiteManagerSaving && websiteManagerAction === 'save' ? 'Saving…' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  className="website-manager-button website-manager-button--primary"
                  onClick={() => persistWebsiteManagerDraft({ publish: true })}
                  disabled={websiteManagerSaving || !websiteManagerPublishReady}
                >
                  {websiteManagerSaving && websiteManagerAction === 'publish' ? 'Updating…' : 'Update Website'}
                </button>
              </div>

              <div className="website-manager-section-divider" />

              <div className="website-manager-section-head">
                <div>
                  <div className="website-manager-panel__eyebrow">Suggested next backend step</div>
                  <h3 className="website-manager-panel__title">How this tab should connect to WordPress</h3>
                </div>
              </div>

              <div className="website-manager-checklist">
                <div className="website-manager-checklist__item">
                  Persist per-property content in <code>{`properties/${selectedPropertyId}/website_manager/current`}</code>.
                </div>
                <div className="website-manager-checklist__item">Manual copy and Entrata-derived fields are bundled into one signed WordPress publish payload.</div>
                <div className="website-manager-checklist__item">The WordPress plugin echoes current option values and flushes caches after updates.</div>
                <div className="website-manager-checklist__item">A backend cron republishes WordPress properties every four hours after Entrata snapshots refresh.</div>
                <div className="website-manager-checklist__item">Entrata properties still remain read-only until the platform is switched to `wordpress_custom`.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderRecommendations = () => {
    const recommendations = Array.isArray(recommendationsData?.recommendations) ? recommendationsData.recommendations : [];
    const analyticsLoaded = recommendationsData?.contextSummary?.analyticsLoaded || {};
    const websiteLoaded = recommendationsData?.contextSummary?.websiteLoaded || {};
    const learningSummary = recommendationsData?.learningSummary || {};
    const selectedRecommendation = recommendations.find((item) => (
      item.storedRecommendationId === selectedRecommendationId || item.id === selectedRecommendationId
    )) || null;
    const selectedDraft = selectedRecommendation
      ? getRecommendationFeedbackDraft(selectedRecommendation.storedRecommendationId)
      : { feedbackType: 'useful', notes: '', tags: [] };
    const sourceLabels = [
      analyticsLoaded.ga4 ? 'GA4' : null,
      analyticsLoaded.googleAds ? 'Google Ads' : null,
      analyticsLoaded.metaAds ? 'Meta Ads' : null,
      analyticsLoaded.reputation ? 'Reputation' : null,
      websiteLoaded.heatmap ? 'Heatmaps' : null,
      websiteLoaded.siteAudit ? 'Site Audit' : null,
    ].filter(Boolean);

    return (
      <div className="recommendations-view">
        <div className="recommendations-hero">
          <div>
            <div className="recommendations-kicker">AI recommendations</div>
            <h2 className="recommendations-headline">{selectedPropertyLabel}</h2>
            <p className="recommendations-copy">
              Leasing, spend, paid media, website behavior, audit findings, and reputation context in one readout.
            </p>
          </div>
          <div className="recommendations-action-panel">
            <div className="recommendations-window">
              {formatDateInputValue(rangeDates.start)} to {formatDateInputValue(rangeDates.end)}
            </div>
            <button
              type="button"
              className="website-manager-button website-manager-button--primary"
              onClick={generateRecommendations}
              disabled={recommendationsLoading || !selectedPropertyId || isAllPropertiesSelected}
            >
              {recommendationsLoading ? 'Generating...' : 'Generate Recommendations'}
            </button>
          </div>
        </div>

        {recommendationsError && (
          <div className="tasks-message tasks-message--error">{recommendationsError}</div>
        )}

        {recommendationsData?.summary && (
          <div className="recommendations-summary">
            <span>Executive readout</span>
            <strong>{recommendationsData.summary}</strong>
          </div>
        )}

        <div className="recommendations-context-strip">
          <div><span>Model</span><strong>{recommendationsData?.model || 'Ready'}</strong></div>
          <div><span>Context</span><strong>{sourceLabels.length ? sourceLabels.join(' + ') : 'Pending'}</strong></div>
          <div>
            <span>Memory</span>
            <strong>
              {recommendationsData
                ? `${learningSummary.positiveExampleCount || 0} preferred / ${learningSummary.negativeExampleCount || 0} suppressed`
                : 'Ready'}
            </strong>
          </div>
        </div>

        {recommendationsLoading && (
          <div className="recommendations-loading">Reading the property data and asking OpenAI for a structured recommendation set...</div>
        )}

        {!recommendationsLoading && recommendations.length === 0 && (
          <div className="recommendations-empty">
            No recommendations have been generated for this window yet.
          </div>
        )}

        <div className="recommendations-grid">
          {recommendations.map((recommendation) => {
            const recommendationId = recommendation.storedRecommendationId;
            const feedbackLoading = recommendationFeedbackLoading[recommendationId];
            const confidence = getRecommendationConfidence(recommendation.confidence);
            const canReviewImpact = Boolean(recommendation.taskId);
            return (
              <article key={recommendation.id} className={`recommendation-card recommendation-card--${recommendation.priority}`}>
                <div className="recommendation-card__top">
                  <div className="recommendation-card__badges">
                    <span className={`recommendation-priority recommendation-priority--${recommendation.priority}`}>
                      {recommendation.priority || 'medium'}
                    </span>
                    <span className="recommendation-category">{recommendation.category || 'general'}</span>
                  </div>
                  <span className="recommendation-state">{getRecommendationImplementationLabel(recommendation)}</span>
                </div>
                <h3>{recommendation.title}</h3>
                <p>{recommendation.reasoning}</p>
                {recommendation.suggestedAction && (
                  <div className="recommendation-action">
                    <span>Suggested action</span>
                    <strong>{recommendation.suggestedAction}</strong>
                  </div>
                )}
                {recommendation.expectedImpact && (
                  <div className="recommendation-impact">{recommendation.expectedImpact}</div>
                )}
                {Array.isArray(recommendation.evidence) && recommendation.evidence.length > 0 && (
                  <div className="recommendation-evidence">
                    <span>Evidence</span>
                    {recommendation.evidence.slice(0, 4).map((item, index) => (
                      <div key={`${recommendation.id}-evidence-${index}`}>{item}</div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="recommendation-primary-action"
                  onClick={() => createTaskFromRecommendation(recommendation)}
                  disabled={Boolean(feedbackLoading)}
                >
                  {feedbackLoading === 'task' ? 'Creating...' : recommendation.taskId ? 'Open Linked Task' : 'Create Task'}
                </button>
                <div className="recommendation-secondary-actions">
                  <button
                    type="button"
                    className={recommendation.status === 'approved' ? 'is-active' : ''}
                    onClick={() => submitRecommendationFeedback(recommendation, 'approve')}
                    disabled={Boolean(feedbackLoading)}
                  >
                    {feedbackLoading === 'approve' ? 'Saving...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className={recommendation.latestFeedbackType === 'useful' ? 'is-active' : ''}
                    onClick={() => submitRecommendationFeedback(recommendation, 'useful')}
                    disabled={Boolean(feedbackLoading)}
                  >
                    {feedbackLoading === 'useful' ? 'Saving...' : 'Useful'}
                  </button>
                  <button
                    type="button"
                    className={recommendation.status === 'dismissed' ? 'is-active is-dismissed' : ''}
                    onClick={() => submitRecommendationFeedback(recommendation, 'dismiss')}
                    disabled={Boolean(feedbackLoading)}
                  >
                    {feedbackLoading === 'dismiss' ? 'Saving...' : 'Dismiss'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRecommendationId(recommendationId || recommendation.id)}
                  >
                    Details
                  </button>
                  {canReviewImpact && (
                    <button
                      type="button"
                      className={recommendation.implementationStatus && !['not_started', 'task_created'].includes(recommendation.implementationStatus) ? 'is-active' : ''}
                      onClick={() => reviewRecommendationImpact(recommendation)}
                      disabled={Boolean(feedbackLoading)}
                    >
                      {feedbackLoading === 'impact' ? 'Reviewing...' : 'Review Impact'}
                    </button>
                  )}
                </div>
                {recommendation.implementationReview?.summary && (
                  <div className={`recommendation-impact-review recommendation-impact-review--${recommendation.implementationStatus || 'inconclusive'}`}>
                    <span>{recommendation.implementationStatus === 'worked' ? 'Worked' : recommendation.implementationStatus === 'did_not_move_metric' ? 'Did not move metric' : 'Impact review'}</span>
                    <strong>{recommendation.implementationReview.summary}</strong>
                    {Array.isArray(recommendation.implementationReview.metricMovement) && recommendation.implementationReview.metricMovement.length > 0 && (
                      <div>{recommendation.implementationReview.metricMovement.slice(0, 2).join(' | ')}</div>
                    )}
                  </div>
                )}
                <div className="recommendation-card__footer">
                  <span>{Array.isArray(recommendation.sourceAreas) ? recommendation.sourceAreas.join(' / ') : 'Source context'}</span>
                  <strong className={confidence.className}>{confidence.label}</strong>
                </div>
              </article>
            );
          })}
        </div>

        {selectedRecommendation && (
          <div className="recommendation-drawer" role="dialog" aria-modal="true">
            <div className="recommendation-drawer__scrim" onClick={() => setSelectedRecommendationId(null)} />
            <aside className="recommendation-drawer__panel">
              <div className="recommendation-drawer__header">
                <div>
                  <div className="recommendations-kicker">Recommendation detail</div>
                  <h3>{selectedRecommendation.title}</h3>
                </div>
                <button type="button" onClick={() => setSelectedRecommendationId(null)} aria-label="Close recommendation detail">
                  <X size={18} />
                </button>
              </div>

              <div className="recommendation-detail-grid">
                <div><span>Status</span><strong>{getRecommendationImplementationLabel(selectedRecommendation)}</strong></div>
                <div><span>Category</span><strong>{selectedRecommendation.category || 'general'}</strong></div>
                <div><span>Confidence</span><strong>{getRecommendationConfidence(selectedRecommendation.confidence).label}</strong></div>
                <div><span>Task</span><strong>{selectedRecommendation.taskId ? 'Linked' : 'Not created'}</strong></div>
              </div>

              <section className="recommendation-drawer__section">
                <span>Full reasoning</span>
                <p>{selectedRecommendation.reasoning || 'No reasoning returned.'}</p>
              </section>

              <section className="recommendation-drawer__section">
                <span>Evidence</span>
                {(selectedRecommendation.evidence || []).length ? (
                  <div className="recommendation-drawer__list">
                    {selectedRecommendation.evidence.map((item, index) => (
                      <div key={`${selectedRecommendation.id}-drawer-evidence-${index}`}>{item}</div>
                    ))}
                  </div>
                ) : (
                  <p>No evidence returned.</p>
                )}
              </section>

              <section className="recommendation-drawer__section">
                <span>Source data used</span>
                <p>{(selectedRecommendation.sourceAreas || []).join(' / ') || 'Source areas unavailable.'}</p>
                <div className="recommendation-drawer__source-grid">
                  <div>
                    <span>Reporting rows</span>
                    <strong>{recommendationsData?.contextSummary?.reportingCounts?.roiDailyRows ?? 'n/a'}</strong>
                  </div>
                  <div>
                    <span>Analytics</span>
                    <strong>{sourceLabels.length ? sourceLabels.join(', ') : 'pending'}</strong>
                  </div>
                </div>
              </section>

              {selectedRecommendation.implementationReview?.summary && (
                <section className="recommendation-drawer__section">
                  <span>Before / after impact review</span>
                  <p>{selectedRecommendation.implementationReview.summary}</p>
                  {Array.isArray(selectedRecommendation.implementationReview.metricMovement) && (
                    <div className="recommendation-drawer__list">
                      {selectedRecommendation.implementationReview.metricMovement.map((item, index) => (
                        <div key={`impact-${index}`}>{item}</div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section className="recommendation-drawer__section">
                <span>Feedback history</span>
                {(selectedRecommendation.feedbackHistory || []).length ? (
                  <div className="recommendation-feedback-history">
                    {selectedRecommendation.feedbackHistory.map((item) => (
                      <div key={item.id || `${item.feedbackType}-${item.createdAt}`}>
                        <strong>{item.feedbackType}</strong>
                        {item.tags?.length ? <small>{item.tags.join(', ')}</small> : null}
                        {item.notes ? <p>{item.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>No feedback saved yet.</p>
                )}
              </section>

              <section className="recommendation-drawer__section recommendation-open-feedback">
                <span>Open-ended training feedback</span>
                <select
                  value={selectedDraft.feedbackType}
                  onChange={(event) => updateRecommendationFeedbackDraft(selectedRecommendation.storedRecommendationId, { feedbackType: event.target.value })}
                >
                  <option value="useful">Useful</option>
                  <option value="not_useful">Not useful</option>
                  <option value="approve">Approve</option>
                  <option value="dismiss">Dismiss</option>
                </select>
                <div className="recommendation-tag-grid">
                  {RECOMMENDATION_FEEDBACK_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={selectedDraft.tags?.includes(tag) ? 'is-active' : ''}
                      onClick={() => toggleRecommendationFeedbackTag(selectedRecommendation.storedRecommendationId, tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <textarea
                  value={selectedDraft.notes}
                  onChange={(event) => updateRecommendationFeedbackDraft(selectedRecommendation.storedRecommendationId, { notes: event.target.value })}
                  placeholder="What would you change? Was the data wrong? Was this already done? What outcome did you see?"
                />
                <button
                  type="button"
                  className="recommendation-primary-action"
                  disabled={Boolean(recommendationFeedbackLoading[selectedRecommendation.storedRecommendationId])}
                  onClick={() => submitRecommendationFeedback(
                    selectedRecommendation,
                    selectedDraft.feedbackType,
                    { notes: selectedDraft.notes, tags: selectedDraft.tags, clearDraft: true }
                  )}
                >
                  {recommendationFeedbackLoading[selectedRecommendation.storedRecommendationId] ? 'Saving Feedback...' : 'Save Feedback'}
                </button>
              </section>
            </aside>
          </div>
        )}
      </div>
    );
  };

  const renderTickets = () => {
    const minimumDueAt = getMinimumTicketDueDateTimeValue();
    const defaultAssigneeId = ticketAssignmentByPropertyId.get(ticketDraft.propertyId) || '';
    const defaultAssignee = ticketUserById.get(defaultAssigneeId);

    return (
      <div className="tasks-view tickets-view">
        <div className="tasks-hero">
          <div>
            <div className="tasks-kicker">Shared intake</div>
            <h2 className="tasks-headline">Tickets</h2>
            <p className="tasks-copy">
              Submit property-scoped requests, auto-route them to the property assignee, and create the linked task in the same workflow.
            </p>
          </div>
          <div className="tasks-summary">
            <span>{openTicketCount} open</span>
            <strong>{tickets.length}</strong>
            <small>total tickets</small>
          </div>
        </div>

        <div className="tasks-create-panel tickets-create-panel">
          <div className="tasks-create-panel__main tickets-create-panel__main">
            <label className="tasks-field">
              <span>Request</span>
              <input
                value={ticketDraft.title}
                onChange={(event) => updateTicketDraft('title', event.target.value)}
                placeholder="What needs to happen?"
              />
            </label>
            <label className="tasks-field">
              <span>Details</span>
              <input
                value={ticketDraft.description}
                onChange={(event) => updateTicketDraft('description', event.target.value)}
                placeholder="Add context, links, screenshots, or desired outcome"
              />
            </label>
          </div>
          <div className="tasks-create-panel__meta tickets-create-panel__meta">
            <label className="tasks-field">
              <span>Property</span>
              <select
                value={ticketDraft.propertyId}
                onChange={(event) => updateTicketDraft('propertyId', event.target.value)}
              >
                <option value="">Choose property</option>
                {availableProperties.map((property) => (
                  <option key={property.propertyId} value={property.propertyId}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tasks-field">
              <span>Assignee</span>
              <select
                value={ticketDraft.assignedUserId}
                onChange={(event) => updateTicketDraft('assignedUserId', event.target.value)}
              >
                <option value="">{defaultAssignee ? `Auto: ${defaultAssignee.fullName}` : 'Auto assign'}</option>
                {ticketAssignableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName || user.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="tasks-field">
              <span>Due</span>
              <input
                type="datetime-local"
                min={minimumDueAt}
                value={ticketDraft.dueAt}
                onChange={(event) => updateTicketDraft('dueAt', event.target.value)}
              />
            </label>
            <label className="tasks-field">
              <span>Priority</span>
              <select
                value={ticketDraft.priority}
                onChange={(event) => updateTicketDraft('priority', event.target.value)}
              >
                {TICKET_PRIORITIES.map((priority) => (
                  <option key={priority.id} value={priority.id}>{priority.label}</option>
                ))}
              </select>
            </label>
            <label className="tasks-field">
              <span>Category</span>
              <select
                value={ticketDraft.category}
                onChange={(event) => updateTicketDraft('category', event.target.value)}
              >
                {TICKET_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="tasks-create-button"
              onClick={createTicket}
              disabled={ticketsSaving || !ticketDraft.title.trim()}
            >
              <Plus size={16} />
              Submit
            </button>
          </div>
          <div className="tickets-intake-meta">
            <span>Due dates must be at least 24 hours out.</span>
            <span>{defaultAssignee ? `Default assignee: ${defaultAssignee.fullName || defaultAssignee.email}` : 'No default assignee is set for this property yet.'}</span>
          </div>
        </div>

        {(ticketsError || ticketsNotice) && (
          <div className={`tasks-message ${ticketsError ? 'tasks-message--error' : 'tasks-message--success'}`}>
            {ticketsError || ticketsNotice}
          </div>
        )}

        {ticketsLoading ? (
          <div className="tasks-empty">Loading tickets...</div>
        ) : (
          <div className="tasks-board tickets-board" aria-label="Ticket board">
            {TASK_STATUSES.map((status) => {
              const statusTickets = ticketsByStatus[status.id] || [];
              return (
                <section className="tasks-column" key={status.id}>
                  <div className="tasks-column__header">
                    <h3>{status.label}</h3>
                    <span>{statusTickets.length}</span>
                  </div>
                  <div className="tasks-column__cards">
                    {statusTickets.length === 0 ? (
                      <div className="tasks-empty-card">No tickets</div>
                    ) : statusTickets.map((ticket) => {
                      const property = taskPropertyById.get(ticket.propertyId);
                      const assignedUser = ticketUserById.get(ticket.assignedUserId);
                      const editableUsers = ticketUsers.filter((user) => user.globalRole === 'admin' || user.propertyIds?.includes(ticket.propertyId));
                      return (
                        <article className={`task-card ticket-card ticket-card--${ticket.priority}`} key={ticket.id}>
                          <div className="ticket-card__topline">
                            <span>{TICKET_PRIORITIES.find((priority) => priority.id === ticket.priority)?.label || 'Normal'}</span>
                            <span>{ticket.source === 'forwarded_email' ? 'Email' : 'Dashboard'}</span>
                          </div>
                          <label className="tasks-field task-card__title-field">
                            <span>Title</span>
                            <input
                              value={ticket.title}
                              onChange={(event) => updateTicketField(ticket.id, 'title', event.target.value)}
                            />
                          </label>
                          <label className="tasks-field">
                            <span>Status</span>
                            <select
                              value={ticket.status}
                              onChange={(event) => {
                                const nextTicket = { ...ticket, status: event.target.value };
                                updateTicketField(ticket.id, 'status', event.target.value);
                                saveTicket(nextTicket);
                              }}
                            >
                              {TASK_STATUSES.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="tasks-field">
                            <span>Assignee</span>
                            <select
                              value={ticket.assignedUserId}
                              onChange={(event) => updateTicketField(ticket.id, 'assignedUserId', event.target.value)}
                            >
                              {editableUsers.map((user) => (
                                <option key={user.id} value={user.id}>{user.fullName || user.email}</option>
                              ))}
                            </select>
                          </label>
                          <label className="tasks-field">
                            <span>Due</span>
                            <input
                              type="datetime-local"
                              min={minimumDueAt}
                              value={ticket.dueAt ? formatDateTimeLocalInputValue(ticket.dueAt) : ''}
                              onChange={(event) => updateTicketField(ticket.id, 'dueAt', event.target.value)}
                            />
                          </label>
                          <label className="tasks-field">
                            <span>Details</span>
                            <textarea
                              value={ticket.description}
                              onChange={(event) => updateTicketField(ticket.id, 'description', event.target.value)}
                              rows={4}
                            />
                          </label>
                          <div className="task-card__meta">
                            <span>{property?.name || 'Active property'}</span>
                            <span>Assigned to {assignedUser?.fullName || assignedUser?.email || ticket.assignedUserName || 'Auto assignment'}</span>
                            <span>Submitted by {ticket.submittedByName || ticket.submittedByEmail || ticket.requesterEmail || 'Dashboard user'}</span>
                            <span>{ticket.dueAt ? `Due ${formatReadableDateTime(ticket.dueAt)}` : 'No due date'}</span>
                            {ticket.taskId && <span>Linked task created</span>}
                          </div>
                          <div className="task-card__actions ticket-card__actions">
                            <button type="button" onClick={() => saveTicket(ticket)} disabled={ticketsSaving}>
                              <Save size={15} />
                              Save
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTasks = () => (
    <div className="tasks-view">
      <div className="tasks-hero">
        <div>
          <div className="tasks-kicker">Personal workflow</div>
          <h2 className="tasks-headline">Tasks</h2>
          <p className="tasks-copy">
            Your board is scoped to your account. Assign work to an active property, track due dates, and move tasks through approval.
          </p>
        </div>
        <div className="tasks-summary">
          <span>{openTaskCount} open</span>
          <strong>{tasks.length}</strong>
          <small>total tasks</small>
        </div>
      </div>

      <div className="tasks-create-panel">
        <div className="tasks-create-panel__main">
          <label className="tasks-field">
            <span>Task</span>
            <input
              value={taskDraft.title}
              onChange={(event) => updateTaskDraft('title', event.target.value)}
              placeholder="Create a task"
            />
          </label>
          <label className="tasks-field">
            <span>Description</span>
            <input
              value={taskDraft.description}
              onChange={(event) => updateTaskDraft('description', event.target.value)}
              placeholder="Add the outcome or next step"
            />
          </label>
        </div>
        <div className="tasks-create-panel__meta">
          <label className="tasks-field">
            <span>Property</span>
            <select
              value={taskDraft.propertyId}
              onChange={(event) => updateTaskDraft('propertyId', event.target.value)}
            >
              {availableProperties.map((property) => (
                <option key={property.propertyId} value={property.propertyId}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          <label className="tasks-field">
            <span>Due</span>
            <input
              type="date"
              value={taskDraft.dueDate}
              onChange={(event) => updateTaskDraft('dueDate', event.target.value)}
            />
          </label>
          <label className="tasks-field">
            <span>Status</span>
            <select
              value={taskDraft.status}
              onChange={(event) => updateTaskDraft('status', event.target.value)}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status.id} value={status.id}>{status.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="tasks-create-button"
            onClick={createTask}
            disabled={tasksSaving || !taskDraft.title.trim()}
          >
            <Plus size={16} />
            Create
          </button>
        </div>
        <label className="tasks-field tasks-field--wide">
          <span>Notes</span>
          <textarea
            value={taskDraft.notes}
            onChange={(event) => updateTaskDraft('notes', event.target.value)}
            placeholder="Add context, links, review notes, or blockers"
            rows={3}
          />
        </label>
      </div>

      {(tasksError || tasksNotice) && (
        <div className={`tasks-message ${tasksError ? 'tasks-message--error' : 'tasks-message--success'}`}>
          {tasksError || tasksNotice}
        </div>
      )}

      {tasksLoading ? (
        <div className="tasks-empty">Loading your task board...</div>
      ) : (
        <div className="tasks-board" aria-label="Task kanban board">
          {TASK_STATUSES.map((status) => {
            const statusTasks = tasksByStatus[status.id] || [];
            return (
              <section className="tasks-column" key={status.id}>
                <div className="tasks-column__header">
                  <h3>{status.label}</h3>
                  <span>{statusTasks.length}</span>
                </div>
                <div className="tasks-column__cards">
                  {statusTasks.length === 0 ? (
                    <div className="tasks-empty-card">No tasks</div>
                  ) : statusTasks.map((task) => {
                    const property = taskPropertyById.get(task.propertyId);
                    return (
                      <article className="task-card" key={task.id}>
                        <label className="tasks-field task-card__title-field">
                          <span>Title</span>
                          <input
                            value={task.title}
                            onChange={(event) => updateTaskField(task.id, 'title', event.target.value)}
                          />
                        </label>
                        <label className="tasks-field">
                          <span>Status</span>
                          <select
                            value={task.status}
                            onChange={(event) => {
                              const nextTask = { ...task, status: event.target.value };
                              updateTaskField(task.id, 'status', event.target.value);
                              saveTask(nextTask);
                            }}
                          >
                            {TASK_STATUSES.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="tasks-field">
                          <span>Property</span>
                          <select
                            value={task.propertyId}
                            onChange={(event) => updateTaskField(task.id, 'propertyId', event.target.value)}
                          >
                            {availableProperties.map((candidate) => (
                              <option key={candidate.propertyId} value={candidate.propertyId}>
                                {candidate.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="tasks-field">
                          <span>Due date</span>
                          <input
                            type="date"
                            value={task.dueDate}
                            onChange={(event) => updateTaskField(task.id, 'dueDate', event.target.value)}
                          />
                        </label>
                        <label className="tasks-field">
                          <span>Description</span>
                          <textarea
                            value={task.description}
                            onChange={(event) => updateTaskField(task.id, 'description', event.target.value)}
                            rows={2}
                          />
                        </label>
                        <label className="tasks-field">
                          <span>Notes</span>
                          <textarea
                            value={task.notes}
                            onChange={(event) => updateTaskField(task.id, 'notes', event.target.value)}
                            rows={4}
                          />
                        </label>
                        <div className="task-card__meta">
                          <span>{property?.name || 'Active property'}</span>
                          <span>{task.dueDate ? `Due ${formatReadableDate(task.dueDate)}` : 'No due date'}</span>
                        </div>
                        <div className="task-card__actions">
                          <button type="button" onClick={() => saveTask(task)} disabled={tasksSaving}>
                            <Save size={15} />
                            Save
                          </button>
                          <button type="button" className="task-card__delete" onClick={() => deleteTask(task.id)} disabled={tasksSaving}>
                            <Trash2 size={15} />
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );

  const updateAdminPropertyDraft = (field, value) => {
    setAdminPropertyDraft((current) => ({ ...current, [field]: value }));
  };

  const saveAdminProperty = async () => {
    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);

    const portfolio = adminPropertyDraft.newPortfolio.trim() || adminPropertyDraft.portfolio;
    const client = adminPropertyDraft.newClient.trim() || adminPropertyDraft.client;

    try {
      const response = await authFetch(ADMIN_PROPERTIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...adminPropertyDraft,
          portfolio,
          client,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Property onboarding failed: ${response.status}`);
      }

      const onboardedName = adminPropertyDraft.name.trim();
      setAdminPropertyDraft(ADMIN_PROPERTY_DRAFT_DEFAULTS);
      await Promise.all([loadAdminAccess(), refreshAccess()]);
      setAdminAccessNotice(`${onboardedName} is now active in the dashboard.`);
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to onboard property.');
      setAdminAccessLoading(false);
    }
  };

  const updateAdminOffboardConfirmation = (propertyId, value) => {
    setAdminOffboardConfirmations((current) => ({ ...current, [propertyId]: value }));
  };

  const offboardAdminProperty = async (property) => {
    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);

    try {
      const response = await authFetch(`${ADMIN_PROPERTIES_URL}/${property.id}/offboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: adminOffboardConfirmations[property.id] || '' }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Property offboarding failed: ${response.status}`);
      }

      setAdminOffboardConfirmations((current) => {
        const next = { ...current };
        delete next[property.id];
        return next;
      });
      if (selectedPropertyId === property.id) {
        setSelectedPropertyId(defaultPropertyId || availableProperties.find((candidate) => candidate.propertyId !== property.id)?.propertyId || null);
      }
      await Promise.all([loadAdminAccess(), refreshAccess()]);
      setAdminAccessNotice(`${property.name} has been offboarded.`);
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to offboard property.');
      setAdminAccessLoading(false);
    }
  };

  const handleAdminUserSelection = (userId) => {
    setAdminSelectedUserId(userId);
    const user = adminUsers.find((candidate) => candidate.id === userId) || null;
    setAdminUserDraft(hydrateAdminDraftFromUser(user));
    setAdminAccessNotice(null);
    setAdminAccessError(null);
    setAdminInviteLink('');
  };

  const updateAdminUserDraft = (field, value) => {
    setAdminUserDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const toggleAdminUserProperty = (propertyId) => {
    setAdminUserDraft((current) => {
      if (!current) return current;
      const selected = new Set(current.propertyIds);
      if (selected.has(propertyId)) selected.delete(propertyId);
      else selected.add(propertyId);
      return { ...current, propertyIds: Array.from(selected) };
    });
  };

  const updateAdminInviteDraft = (field, value) => {
    setAdminInviteDraft((current) => ({ ...current, [field]: value }));
  };

  const toggleAdminInviteProperty = (propertyId) => {
    setAdminInviteDraft((current) => {
      const selected = new Set(current.propertyIds);
      if (selected.has(propertyId)) selected.delete(propertyId);
      else selected.add(propertyId);
      return { ...current, propertyIds: Array.from(selected) };
    });
  };

  const setAdminInviteVisibleProperties = (selected) => {
    const visibleIds = new Set(filteredAdminInviteProperties.map((property) => property.id));
    setAdminInviteDraft((current) => {
      const next = new Set(current.propertyIds);
      visibleIds.forEach((propertyId) => {
        if (selected) next.add(propertyId);
        else next.delete(propertyId);
      });
      return { ...current, propertyIds: Array.from(next) };
    });
  };

  const setAdminUserVisibleProperties = (selected) => {
    const visibleIds = new Set(filteredAdminUserProperties.map((property) => property.id));
    setAdminUserDraft((current) => {
      if (!current) return current;
      const next = new Set(current.propertyIds);
      visibleIds.forEach((propertyId) => {
        if (selected) next.add(propertyId);
        else next.delete(propertyId);
      });
      return { ...current, propertyIds: Array.from(next) };
    });
  };

  const getAdminAssignableUsersForProperty = (propertyId) => (
    adminUsers.filter((user) => (
      user.isActive !== false
      && (
        user.globalRole === 'admin'
        || (Array.isArray(user.memberships) && user.memberships.some((membership) => (
          membership.isActive && membership.propertyId === propertyId
        )))
      )
    ))
  );

  const getAdminRegionalUsersForProperty = (propertyId) => (
    adminUsers.filter((user) => (
      user.isActive !== false
      && (
        user.globalRole === 'admin'
        || (Array.isArray(user.memberships) && user.memberships.some((membership) => (
          membership.isActive && membership.propertyId === propertyId && membership.role === 'regional_manager'
        )))
      )
    ))
  );

  const updateAdminTicketAssignmentField = (propertyId, field, value) => {
    setAdminAccessError(null);
    setAdminAccessNotice(null);
    setAdminTicketAssignmentDrafts((current) => ({
      ...current,
      [propertyId]: {
        ...normalizeAdminAssignmentDraft(current[propertyId]),
        [field]: value,
      },
    }));
  };

  const saveAdminTicketAssignments = async () => {
    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);

    try {
      const response = await authFetch(ADMIN_TICKET_ASSIGNMENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: adminProperties.map((property) => ({
            propertyId: property.id,
            ...normalizeAdminAssignmentDraft(adminTicketAssignmentDrafts[property.id]),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Ticket assignment save failed: ${response.status}`);
      }

      const assignmentDrafts = Object.fromEntries(
        (Array.isArray(payload.assignments) ? payload.assignments : [])
          .map((assignment) => [assignment.propertyId, normalizeAdminAssignmentDraft(assignment)])
      );
      setAdminTicketAssignmentDrafts(assignmentDrafts);
      setAdminAccessNotice('Ticket assignment mapping updated.');
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to save ticket assignment mapping.');
    } finally {
      setAdminAccessLoading(false);
    }
  };

  const saveAdminUserAccess = async () => {
    if (!adminUserDraft?.id) {
      setAdminAccessError('Choose a user before saving access changes.');
      return;
    }

    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);
    setAdminInviteLink('');
    setAdminPasswordResetLink('');

    try {
      const response = await authFetch(`${ADMIN_ACCESS_USERS_URL}/${adminUserDraft.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: adminUserDraft.fullName,
          globalRole: adminUserDraft.globalRole || null,
          propertyRole: adminUserDraft.propertyRole || null,
          propertyIds: adminUserDraft.propertyIds,
          isActive: adminUserDraft.isActive,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Access save failed: ${response.status}`);
      }

      setAdminAccessNotice('User access updated.');
      await loadAdminAccess();
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to save user access.');
      setAdminAccessLoading(false);
    }
  };

  const inviteAdminUser = async () => {
    if (!adminInviteDraft.email.trim()) {
      setAdminAccessError('Enter an email address to create an invite.');
      return;
    }

    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);
    setAdminCopiedLinkType('');
    setAdminInviteLink('');
    setAdminPasswordResetLink('');

    try {
      const response = await authFetch(ADMIN_ACCESS_USERS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminInviteDraft.email,
          fullName: adminInviteDraft.fullName,
          globalRole: adminInviteDraft.globalRole || null,
          propertyRole: adminInviteDraft.propertyRole || null,
          propertyIds: adminInviteDraft.propertyIds,
          redirectTo: `${window.location.origin}/set-password`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Invite failed: ${response.status}`);
      }

      setAdminAccessNotice(`Invite created for ${adminInviteDraft.email}.`);
      setAdminInviteLink(buildSetPasswordLink(payload?.invite, 'invite'));
      setAdminInviteDraft({
        email: '',
        fullName: '',
        globalRole: '',
        propertyRole: '',
        propertyIds: [],
      });
      await loadAdminAccess();
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to create invite.');
      setAdminAccessLoading(false);
    }
  };

  const createAdminPasswordResetLink = async () => {
    if (!adminUserDraft?.id) {
      setAdminAccessError('Choose a user before creating a password reset link.');
      return;
    }

    setAdminAccessLoading(true);
    setAdminAccessError(null);
    setAdminAccessNotice(null);
    setAdminCopiedLinkType('');
    setAdminInviteLink('');
    setAdminPasswordResetLink('');

    try {
      const response = await authFetch(`${ADMIN_ACCESS_USERS_URL}/${adminUserDraft.id}/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirectTo: `${window.location.origin}/set-password`,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Password reset link failed: ${response.status}`);
      }

      setAdminAccessNotice(`Password reset link created for ${payload?.reset?.email || adminUserDraft.email}.`);
      setAdminPasswordResetLink(buildSetPasswordLink(payload?.reset, 'recovery'));
      await loadAdminAccess();
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to create a password reset link.');
      setAdminAccessLoading(false);
    }
  };

  const copyAdminAccessLink = async (link, linkType) => {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link);
      setAdminCopiedLinkType(linkType);
      window.setTimeout(() => {
        setAdminCopiedLinkType((current) => current === linkType ? '' : current);
      }, 1800);
    } catch {
      setAdminAccessError('Unable to copy the link. Select the link text and copy it manually.');
    }
  };

  const updateAccountDraft = (field, value) => {
    setAccountDraft((current) => ({ ...current, [field]: value }));
  };

  const updateAccountPasswordDraft = (field, value) => {
    setAccountPasswordDraft((current) => ({ ...current, [field]: value }));
  };

  const persistProfileRecord = async ({ fullName, avatarPath, avatarUrl }) => {
    if (!supabase || !currentUser?.id) return;

    const payload = {
      full_name: String(fullName || '').trim(),
      avatar_path: avatarPath || null,
      avatar_url: avatarUrl || null,
    };

    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', currentUser.id);

    if (error) {
      throw new Error(error.message || 'Unable to save profile details.');
    }
  };

  const handleAccountProfileSave = async () => {
    if (!supabase || !currentUser?.id) return;

    setAccountSaving(true);
    setAccountError('');
    setAccountNotice('');

    try {
      const trimmedName = accountDraft.fullName.trim();
      const trimmedEmail = accountDraft.email.trim();

      await persistProfileRecord({
        fullName: trimmedName,
        avatarPath: accountDraft.avatarPath,
        avatarUrl: accountDraft.avatarUrl,
      });

      const metadataNeedsUpdate = (currentUser?.user_metadata?.full_name || '') !== trimmedName;
      const emailNeedsUpdate = trimmedEmail && trimmedEmail !== (currentUser?.email || '');

      if (metadataNeedsUpdate || emailNeedsUpdate) {
        const updatePayload = {};
        if (metadataNeedsUpdate) {
          updatePayload.data = { ...(currentUser?.user_metadata || {}), full_name: trimmedName };
        }
        if (emailNeedsUpdate) {
          updatePayload.email = trimmedEmail;
        }

        const { error } = await supabase.auth.updateUser(updatePayload);
        if (error) {
          throw new Error(error.message || 'Unable to update account settings.');
        }
      }

      await refreshAccess();
      setAccountNotice(emailNeedsUpdate
        ? 'Profile updated. Check your email to confirm the new address if Supabase requires verification.'
        : 'Profile updated.');
    } catch (error) {
      setAccountError(error.message || 'Unable to save account settings.');
    } finally {
      setAccountSaving(false);
    }
  };

  const handleAccountPasswordSave = async () => {
    if (!supabase) return;

    if (accountPasswordDraft.password.length < 8) {
      setAccountError('Use at least 8 characters for the new password.');
      return;
    }

    if (accountPasswordDraft.password !== accountPasswordDraft.confirmPassword) {
      setAccountError('The new password and confirmation do not match.');
      return;
    }

    setAccountSaving(true);
    setAccountError('');
    setAccountNotice('');

    try {
      const { error } = await supabase.auth.updateUser({
        password: accountPasswordDraft.password,
      });

      if (error) {
        throw new Error(error.message || 'Unable to change the password.');
      }

      setAccountPasswordDraft({ password: '', confirmPassword: '' });
      setAccountNotice('Password updated.');
    } catch (error) {
      setAccountError(error.message || 'Unable to change the password.');
    } finally {
      setAccountSaving(false);
    }
  };

  const handleAccountAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !supabase || !currentUser?.id) return;
    event.target.value = '';

    if (!PROFILE_AVATAR_ALLOWED_TYPES.has(file.type)) {
      setAccountError('Use a JPG, PNG, or WEBP image for the profile photo.');
      return;
    }

    if (file.size > PROFILE_AVATAR_MAX_BYTES) {
      setAccountError('Keep the profile photo under 5 MB.');
      return;
    }

    setAccountSaving(true);
    setAccountError('');
    setAccountNotice('');

    try {
      const extension = getFileExtension(file.name, file.type);
      const nextPath = `${currentUser.id}/avatar-${Date.now()}.${extension}`;

      if (accountDraft.avatarPath) {
        await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([accountDraft.avatarPath]);
      }

      const uploadResponse = await supabase.storage
        .from(PROFILE_AVATAR_BUCKET)
        .upload(nextPath, file, { upsert: true });

      if (uploadResponse.error) {
        throw new Error(uploadResponse.error.message || 'Unable to upload the profile photo.');
      }

      const { data } = supabase.storage.from(PROFILE_AVATAR_BUCKET).getPublicUrl(nextPath);
      await persistProfileRecord({
        fullName: accountDraft.fullName,
        avatarPath: nextPath,
        avatarUrl: data?.publicUrl || '',
      });

      await refreshAccess();
      setAccountDraft((current) => ({
        ...current,
        avatarPath: nextPath,
        avatarUrl: data?.publicUrl || '',
      }));
      setAccountNotice('Profile photo updated.');
    } catch (error) {
      setAccountError(error.message || 'Unable to upload the profile photo.');
    } finally {
      setAccountSaving(false);
    }
  };

  const handleAccountAvatarRemove = async () => {
    if (!supabase || !currentUser?.id || !accountDraft.avatarPath) return;

    setAccountSaving(true);
    setAccountError('');
    setAccountNotice('');

    try {
      await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([accountDraft.avatarPath]);
      await persistProfileRecord({
        fullName: accountDraft.fullName,
        avatarPath: null,
        avatarUrl: null,
      });
      await refreshAccess();
      setAccountDraft((current) => ({
        ...current,
        avatarPath: '',
        avatarUrl: '',
      }));
      setAccountNotice('Profile photo removed.');
    } catch (error) {
      setAccountError(error.message || 'Unable to remove the profile photo.');
    } finally {
      setAccountSaving(false);
    }
  };

  const renderAccountPanel = () => (
    <div className={`account-panel ${accountPanelOpen ? 'is-open' : ''}`} aria-hidden={!accountPanelOpen}>
      <div className="account-panel__backdrop" onClick={() => setAccountPanelOpen(false)} />
      <div className="account-panel__sheet">
        <div className="account-panel__header">
          <div>
            <div className="account-panel__eyebrow">Account settings</div>
            <h2 className="account-panel__title">Manage your profile</h2>
          </div>
          <button
            type="button"
            className="account-panel__close"
            onClick={() => setAccountPanelOpen(false)}
            aria-label="Close account settings"
          >
            <X size={18} />
          </button>
        </div>

        <div className="account-panel__avatar-row">
          <div className="account-avatar account-avatar--large">
            {accountAvatarUrl ? (
              <img src={accountAvatarUrl} alt={displayName} className="account-avatar__image" />
            ) : (
              <span>{accountInitials}</span>
            )}
          </div>
          <div className="account-panel__avatar-actions">
            <label className="account-panel__secondary-button">
              <Camera size={16} />
              <span>{accountDraft.avatarUrl ? 'Replace photo' : 'Upload photo'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAccountAvatarUpload} hidden />
            </label>
            {accountDraft.avatarUrl && (
              <button type="button" className="account-panel__ghost-button" onClick={handleAccountAvatarRemove} disabled={accountSaving}>
                Remove photo
              </button>
            )}
          </div>
        </div>

        {(accountError || accountNotice) && (
          <div className={`auth-alert ${accountError ? 'auth-alert--error' : 'auth-alert--success'}`}>
            {accountError || accountNotice}
          </div>
        )}

        <div className="account-panel__section">
          <div className="account-panel__section-head">
            <UserRound size={16} />
            <span>Profile details</span>
          </div>
          <div className="account-panel__form-grid">
            <label className="auth-form__field">
              <span>Full name</span>
              <input
                type="text"
                value={accountDraft.fullName}
                onChange={(event) => updateAccountDraft('fullName', event.target.value)}
              />
            </label>
            <label className="auth-form__field">
              <span>Email</span>
              <input
                type="email"
                value={accountDraft.email}
                onChange={(event) => updateAccountDraft('email', event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="account-panel__primary-button" onClick={handleAccountProfileSave} disabled={accountSaving}>
            {accountSaving ? 'Saving…' : 'Save profile'}
          </button>
        </div>

        <div className="account-panel__section">
          <div className="account-panel__section-head">
            <KeyRound size={16} />
            <span>Password</span>
          </div>
          <div className="account-panel__form-grid">
            <label className="auth-form__field">
              <span>New password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={accountPasswordDraft.password}
                onChange={(event) => updateAccountPasswordDraft('password', event.target.value)}
              />
            </label>
            <label className="auth-form__field">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={accountPasswordDraft.confirmPassword}
                onChange={(event) => updateAccountPasswordDraft('confirmPassword', event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="account-panel__primary-button" onClick={handleAccountPasswordSave} disabled={accountSaving}>
            {accountSaving ? 'Updating…' : 'Update password'}
          </button>
        </div>

        <div className="account-panel__section account-panel__section--meta">
          <div className="account-panel__section-head">
            <Mail size={16} />
            <span>Account summary</span>
          </div>
          <div className="account-panel__meta-list">
            <div>
              <span>Signed in as</span>
              <strong>{currentUser?.email || 'Unknown'}</strong>
            </div>
            <div>
              <span>Role</span>
              <strong>{profile?.global_role || 'Property-scoped access'}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRedListPropertyList = (rows, emptyMessage) => (
    <>
      {redListPortfolioError && <div className="admin-access-empty">{redListPortfolioError}</div>}
      {!redListPortfolioError && redListPortfolioLoading && <div className="admin-access-empty">Loading red list metrics…</div>}
      {!redListPortfolioError && !redListPortfolioLoading && rows.length === 0 && (
        <div className="admin-access-empty">{emptyMessage}</div>
      )}
      {!redListPortfolioError && rows.length > 0 && (
        <div className="reports-list">
          {rows.map((property) => (
            <div key={property.property_id} className="reports-list__row">
              <div>
                <strong>{property.title}</strong>
                <small>{property.location || (property.isConventional ? 'Conventional' : 'Student')} | {property.asOfText} | {property.reason}</small>
              </div>
              <div>
                <strong>{property.primaryMetric}</strong>
                <small>{property.secondaryMetric}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderRedList = () => (
    <div className="admin-access-view red-list-view">
      <div className="admin-access-hero">
        <div>
          <div className="admin-access-kicker">Red List</div>
          <div className="admin-access-headline">Portfolio leasing risk, split by property type.</div>
          <div className="admin-access-subhead">
            Student and conventional properties use separate thresholds, with lead velocity based on the last 30 days ending on each property's latest Supabase snapshot.
          </div>
        </div>
        <div className="admin-access-stats">
          <div className="admin-access-stat">
            <span>Student Flagged</span>
            <strong>{redListPortfolioLoading ? '…' : formatNumber(redListStudentRows.length)}</strong>
          </div>
          <div className="admin-access-stat">
            <span>Conventional Flagged</span>
            <strong>{redListPortfolioLoading ? '…' : formatNumber(redListConventionalRows.length)}</strong>
          </div>
          <div className="admin-access-stat">
            <span>Properties Loaded</span>
            <strong>{redListPortfolioLoading ? '…' : formatNumber(redListLeadDeficitRows.length)}</strong>
          </div>
        </div>
      </div>

      <div className="admin-section-tabs" role="tablist" aria-label="Red list sections">
        {RED_LIST_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={redListActiveSection === section.id ? 'is-active' : ''}
            onClick={() => setRedListActiveSection(section.id)}
            role="tab"
            aria-selected={redListActiveSection === section.id}
          >
            {section.label}
          </button>
        ))}
      </div>

      {redListActiveSection === 'student' && (
        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div>
              <div className="admin-access-panel__eyebrow">Student Properties</div>
              <h3 className="admin-access-panel__title">Student properties currently on the red list</h3>
            </div>
            <span>{redListPortfolioLoading ? 'Loading…' : `${formatNumber(redListStudentRows.length)} flagged`}</span>
          </div>
          {renderRedListPropertyList(redListStudentRows, 'No student properties are currently on the red list.')}
        </div>
      )}

      {redListActiveSection === 'conventional' && (
        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div>
              <div className="admin-access-panel__eyebrow">Conventional Properties</div>
              <h3 className="admin-access-panel__title">Conventional properties currently on the red list</h3>
            </div>
            <span>{redListPortfolioLoading ? 'Loading…' : `${formatNumber(redListConventionalRows.length)} flagged`}</span>
          </div>
          {renderRedListPropertyList(redListConventionalRows, 'No conventional properties are currently on the red list.')}
        </div>
      )}

      {redListActiveSection === 'lead-deficit' && (
        <div className="admin-access-panel red-list-detail-panel">
          <div className="admin-access-section-head">
            <div>
              <div className="admin-access-panel__eyebrow">Lead Deficit Details</div>
              <h3 className="admin-access-panel__title">All properties</h3>
            </div>
            <span>{redListPortfolioLoading ? 'Loading…' : `${formatNumber(redListLeadDeficitRows.length)} properties`}</span>
          </div>
          {redListPortfolioError && <div className="admin-access-empty">{redListPortfolioError}</div>}
          {!redListPortfolioError && redListPortfolioLoading && <div className="admin-access-empty">Loading lead deficit details…</div>}
          {!redListPortfolioError && !redListPortfolioLoading && redListLeadDeficitRows.length === 0 && (
            <div className="admin-access-empty">No lead deficit details are available yet.</div>
          )}
          {!redListPortfolioError && redListLeadDeficitRows.length > 0 && (
            <div className="red-list-detail-table-wrap">
              <table className="red-list-detail-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Lead Deficit</th>
                    <th>Lead Fulfillment</th>
                    <th>Exposure</th>
                    <th>Leads Last 30</th>
                    <th>Leases / Preleases</th>
                  </tr>
                </thead>
                <tbody>
                  {redListLeadDeficitRows.map((property) => (
                    <tr key={property.property_id}>
                      <td>
                        <strong>{property.title}</strong>
                        <small>{property.location || property.property_id} | {property.asOfText}</small>
                      </td>
                      <td>{property.isConventional ? 'Conventional' : 'Student'}</td>
                      <td>
                        <span className={`red-list-status-pill ${property.is_red_list ? 'is-red-list' : ''}`}>
                          {property.is_red_list ? 'On Red List' : 'Clear'}
                        </span>
                      </td>
                      <td>
                        {property.isConventional
                          ? formatNumber(property.lead_deficit_at_ten_close)
                          : formatNumber(property.lead_deficit_at_thirty_close)}
                        <small>{property.isConventional ? 'at 10% close' : 'at 30% close'}</small>
                      </td>
                      <td>
                        {property.isConventional ? '—' : formatPercent(property.lead_fulfillment_rate, 1)}
                        {!property.isConventional && <small>{formatNumber(property.leads_needed_per_month_at_thirty_close, 1)} needed/mo</small>}
                      </td>
                      <td>
                        {property.isConventional ? formatPercent(property.forecast_exposure_rate, 1) : '—'}
                        {property.isConventional && <small>{formatNumber(property.available_units_in_60_days)} units in 60 days</small>}
                      </td>
                      <td>
                        {formatNumber(property.isConventional
                          ? (property.lead_count_30_days ?? property.lead_count_60_days)
                          : (property.lead_count_30_days ?? property.lead_count))}
                        {!property.isConventional && <small>{formatNumber(property.leads_per_month, 1)} / month</small>}
                      </td>
                      <td>
                        {property.isConventional
                          ? formatNumber(property.lease_count_30_days ?? property.lease_count_60_days)
                          : `${formatNumber(property.current_prelease_count)} / ${formatNumber(property.target_lease_count)}`}
                        <small>{property.isConventional ? 'approved in window' : 'preleased / target'}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderAdmin = () => (
    <div className="admin-access-view">
      <div className="admin-access-hero">
        <div>
          <div className="admin-access-kicker">Access Control</div>
          <div className="admin-access-headline">Invite teammates and shape what they can see.</div>
          <div className="admin-access-subhead">
            This admin view lets you create invite links, assign a top-level admin role, or give a property-scoped role across selected communities.
          </div>
        </div>
        <div className="admin-access-stats">
          <div className="admin-access-stat">
            <span>Users</span>
            <strong>{adminUsers.length}</strong>
          </div>
          <div className="admin-access-stat">
            <span>Roles</span>
            <strong>{adminRoles.length}</strong>
          </div>
          <div className="admin-access-stat">
            <span>Properties</span>
            <strong>{adminProperties.length}</strong>
          </div>
          <div className="admin-access-stat">
            <span>Assignments</span>
            <strong>{adminTicketAssignmentCount}</strong>
          </div>
        </div>
      </div>

      <div className="admin-section-tabs" role="tablist" aria-label="Admin sections">
        {ADMIN_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={adminActiveSection === section.id ? 'is-active' : ''}
            onClick={() => setAdminActiveSection(section.id)}
            role="tab"
            aria-selected={adminActiveSection === section.id}
          >
            {section.label}
          </button>
        ))}
      </div>

      {(adminAccessError || adminAccessNotice) && (
        <div className={`admin-access-banner ${adminAccessError ? 'admin-access-banner--error' : 'admin-access-banner--success'}`}>
          {adminAccessError || adminAccessNotice}
        </div>
      )}

      {adminInviteLink && (
        <div className="admin-access-banner admin-access-banner--info">
          <span className="admin-access-banner__label">Invite link:</span>
          <span className="admin-access-banner__link-text">{adminInviteLink}</span>
          <button
            type="button"
            className="admin-access-banner__copy"
            onClick={() => copyAdminAccessLink(adminInviteLink, 'invite')}
            title="Copy invite link"
            aria-label="Copy invite link"
          >
            {adminCopiedLinkType === 'invite' ? <Check size={16} /> : <Copy size={16} />}
            <span>{adminCopiedLinkType === 'invite' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}

      {adminPasswordResetLink && (
        <div className="admin-access-banner admin-access-banner--info">
          <span className="admin-access-banner__label">Password reset link:</span>
          <span className="admin-access-banner__link-text">{adminPasswordResetLink}</span>
          <button
            type="button"
            className="admin-access-banner__copy"
            onClick={() => copyAdminAccessLink(adminPasswordResetLink, 'reset')}
            title="Copy password reset link"
            aria-label="Copy password reset link"
          >
            {adminCopiedLinkType === 'reset' ? <Check size={16} /> : <Copy size={16} />}
            <span>{adminCopiedLinkType === 'reset' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}

      {adminActiveSection === 'properties' && (
      <div className="admin-properties-layout">
        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div>
              <div className="admin-access-panel__eyebrow">Onboarding</div>
              <h3 className="admin-access-panel__title">Add a property to the dashboard</h3>
            </div>
          </div>
          <div className="admin-access-form-grid admin-access-form-grid--wide">
            {[
              ['propertyId', 'Entrata property ID'],
              ['name', 'Property name'],
              ['city', 'City'],
              ['state', 'State'],
              ['googleAnalyticsId', 'GA4 ID'],
              ['googleAdsId', 'Google Ads ID'],
              ['localFalconLocationId', 'Local Falcon ID'],
              ['metaAdsAccountId', 'Meta ID'],
              ['opiniionLocationId', 'Opiniion ID'],
              ['marketingAccountManager', 'Marketing account manager'],
              ['regionalManager', 'Regional manager'],
              ['vicePresidentOperations', 'Vice president of operations'],
              ['websiteUrl', 'Website URL'],
              ['legalEntity', 'Legal entity'],
            ].map(([field, label]) => (
              <label key={field} className="admin-access-field">
                <span>{label}</span>
                <input
                  type={field === 'websiteUrl' ? 'url' : 'text'}
                  value={adminPropertyDraft[field]}
                  onChange={(event) => updateAdminPropertyDraft(field, event.target.value)}
                />
              </label>
            ))}
            <label className="admin-access-field">
              <span>Portfolio</span>
              <select value={adminPropertyDraft.portfolio} onChange={(event) => updateAdminPropertyDraft('portfolio', event.target.value)}>
                <option value="">Choose portfolio</option>
                {adminPortfolioOptions.map((portfolio) => (
                  <option key={portfolio} value={portfolio}>{formatPortfolioLabel(portfolio)}</option>
                ))}
              </select>
            </label>
            <label className="admin-access-field">
              <span>Create portfolio</span>
              <input type="text" value={adminPropertyDraft.newPortfolio} onChange={(event) => updateAdminPropertyDraft('newPortfolio', event.target.value)} />
            </label>
            <label className="admin-access-field">
              <span>Client</span>
              <select value={adminPropertyDraft.client} onChange={(event) => updateAdminPropertyDraft('client', event.target.value)}>
                <option value="">Choose client</option>
                {adminClientOptions.map((client) => (
                  <option key={client} value={client}>{client}</option>
                ))}
              </select>
            </label>
            <label className="admin-access-field">
              <span>Create client</span>
              <input type="text" value={adminPropertyDraft.newClient} onChange={(event) => updateAdminPropertyDraft('newClient', event.target.value)} />
            </label>
            <label className="admin-access-field">
              <span>Website type</span>
              <select value={adminPropertyDraft.websiteType} onChange={(event) => updateAdminPropertyDraft('websiteType', event.target.value)}>
                <option value="entrata">Entrata</option>
                <option value="wordpress">WordPress</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="admin-access-field">
              <span>Property type</span>
              <select value={adminPropertyDraft.propertyType} onChange={(event) => updateAdminPropertyDraft('propertyType', event.target.value)}>
                <option value="student">Student</option>
                <option value="conventional">Conventional</option>
              </select>
            </label>
            <label className="admin-access-field admin-access-field--checkbox">
              <input
                type="checkbox"
                checked={adminPropertyDraft.entrataApiAccess}
                onChange={(event) => updateAdminPropertyDraft('entrataApiAccess', event.target.checked)}
              />
              <span>Added to Entrata API access</span>
            </label>
          </div>
          <div className="admin-access-actions">
            <button type="button" onClick={saveAdminProperty} disabled={adminAccessLoading}>
              {adminAccessLoading ? 'Saving…' : 'Onboard Property'}
            </button>
          </div>
        </div>

        <div className="admin-access-panel admin-properties-panel">
          <div className="admin-access-section-head">
            <div>
              <div className="admin-access-panel__eyebrow">Offboarding</div>
              <h3 className="admin-access-panel__title">Active properties</h3>
            </div>
            <span>{formatNumber(filteredAdminProperties.length)} shown</span>
          </div>
          <label className="admin-search-field admin-search-field--wide">
            <span>Search properties</span>
            <input
              type="search"
              value={adminPropertySearch}
              onChange={(event) => setAdminPropertySearch(event.target.value)}
              placeholder="Property, ID, portfolio, client, or market"
            />
          </label>
          <div className="admin-properties-list">
            {filteredAdminProperties.map((property) => (
              <div key={property.id} className="admin-property-row">
                <div className="admin-ticket-routing-row__property">
                  <strong>{property.name}</strong>
                  <span>{property.city || property.state ? `${property.city || ''}${property.city && property.state ? ', ' : ''}${property.state || ''}` : property.id}</span>
                  <small>{property.id}{property.portfolio ? ` | ${formatPortfolioLabel(property.portfolio)}` : ''}{property.client ? ` | ${property.client}` : ''}</small>
                </div>
                <label className="admin-access-field">
                  <span>Confirm offboard</span>
                  <input
                    type="text"
                    value={adminOffboardConfirmations[property.id] || ''}
                    onChange={(event) => updateAdminOffboardConfirmation(property.id, event.target.value)}
                    placeholder="Type Offboard"
                  />
                </label>
                <div className="admin-access-actions">
                  <button
                    type="button"
                    className="admin-danger-button"
                    onClick={() => offboardAdminProperty(property)}
                    disabled={adminAccessLoading || adminOffboardConfirmations[property.id] !== 'Offboard'}
                  >
                    Offboard
                  </button>
                </div>
              </div>
            ))}
            {filteredAdminProperties.length === 0 && (
              <div className="admin-access-empty">No active properties match that search.</div>
            )}
          </div>
        </div>
      </div>
      )}

      {adminActiveSection === 'ticket-routing' && (
      <div className="admin-access-panel admin-ticket-routing-panel">
        <div className="admin-access-section-head">
          <div>
            <div className="admin-access-panel__eyebrow">Assignments</div>
            <h3 className="admin-access-panel__title">Property assignment defaults</h3>
          </div>
          <span>{adminAccessLoading ? 'Loading…' : `${formatNumber(adminTicketAssignmentCount)} mapped`}</span>
        </div>
        <div className="admin-toolbar">
          <label className="admin-search-field">
            <span>Search assignments</span>
            <input
              type="search"
              value={adminRoutingSearch}
              onChange={(event) => setAdminRoutingSearch(event.target.value)}
              placeholder="Property, assignee, regional, or portfolio"
            />
          </label>
          <div className="admin-segmented-control" aria-label="Assignment filter">
            {[
              ['all', 'All'],
              ['unassigned', 'Unassigned'],
              ['assigned', 'Assigned'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={adminRoutingFilter === id ? 'is-active' : ''}
                onClick={() => setAdminRoutingFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-ticket-routing-list">
          {filteredAdminRoutingProperties.map((property) => {
            const assignableUsers = getAdminAssignableUsersForProperty(property.id);
            const regionalUsers = getAdminRegionalUsersForProperty(property.id);
            const assignmentDraft = normalizeAdminAssignmentDraft(adminTicketAssignmentDrafts[property.id]);
            const selectedAssigneeId = assignmentDraft.defaultAssigneeUserId;
            const selectedRegionalId = assignmentDraft.regionalUserId;
            const selectedPortfolio = assignmentDraft.clientGroupPortfolio;
            const selectedAssignee = adminUserById.get(selectedAssigneeId);
            const selectedRegional = adminUserById.get(selectedRegionalId);
            return (
              <div className="admin-ticket-routing-row" key={property.id}>
                <div className="admin-ticket-routing-row__property">
                  <strong>{property.name}</strong>
                  <span>{property.city || property.state ? `${property.city || ''}${property.city && property.state ? ', ' : ''}${property.state || ''}` : property.id}</span>
                </div>
                <label className="admin-access-field admin-ticket-routing-row__select">
                  <span>Default marketing assignee</span>
                  <select
                    value={selectedAssigneeId}
                    onChange={(event) => updateAdminTicketAssignmentField(property.id, 'defaultAssigneeUserId', event.target.value)}
                  >
                    <option value="">No marketing assignee</option>
                    {assignableUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName || user.email}</option>
                    ))}
                  </select>
                </label>
                <label className="admin-access-field admin-ticket-routing-row__select">
                  <span>Regional</span>
                  <select
                    value={selectedRegionalId}
                    onChange={(event) => updateAdminTicketAssignmentField(property.id, 'regionalUserId', event.target.value)}
                  >
                    <option value="">No regional selected</option>
                    {regionalUsers.map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName || user.email}</option>
                    ))}
                  </select>
                </label>
                <label className="admin-access-field admin-ticket-routing-row__select">
                  <span>Client group / portfolio</span>
                  <select
                    value={selectedPortfolio}
                    onChange={(event) => updateAdminTicketAssignmentField(property.id, 'clientGroupPortfolio', event.target.value)}
                  >
                    <option value="">No portfolio selected</option>
                    {adminPortfolioOptions.map((portfolio) => (
                      <option key={portfolio} value={portfolio}>{formatPortfolioLabel(portfolio)}</option>
                    ))}
                  </select>
                </label>
                <div className="admin-ticket-routing-row__meta">
                  {selectedAssignee ? selectedAssignee.email : 'Marketing falls back to triage user'}
                  {selectedRegional && <span>Regional: {selectedRegional.email}</span>}
                  {selectedPortfolio && <span>Portfolio: {formatPortfolioLabel(selectedPortfolio)}</span>}
                </div>
              </div>
            );
          })}
          {filteredAdminRoutingProperties.length === 0 && (
            <div className="admin-access-empty">No properties match the current assignment filters.</div>
          )}
        </div>
        <div className="admin-access-actions">
          <button type="button" onClick={saveAdminTicketAssignments} disabled={adminAccessLoading}>
            {adminAccessLoading ? 'Saving…' : 'Save Assignments'}
          </button>
        </div>
      </div>
      )}

      {adminActiveSection === 'website-schema' && (websiteSchemaError || websiteSchemaNotice) && (
        <div className={`admin-access-banner ${websiteSchemaError ? 'admin-access-banner--error' : 'admin-access-banner--success'}`}>
          {websiteSchemaError || websiteSchemaNotice}
        </div>
      )}

      {adminActiveSection === 'users' && (
      <div className="admin-access-layout">
        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div className="admin-access-panel__eyebrow">Invite</div>
            <h3 className="admin-access-panel__title">Create a new user invite</h3>
          </div>

          <div className="admin-access-form-grid">
            <label className="admin-access-field">
              <span>Email</span>
              <input
                type="email"
                value={adminInviteDraft.email}
                onChange={(event) => updateAdminInviteDraft('email', event.target.value)}
                placeholder="name@redstoneresidential.com"
              />
            </label>
            <label className="admin-access-field">
              <span>Full name</span>
              <input
                type="text"
                value={adminInviteDraft.fullName}
                onChange={(event) => updateAdminInviteDraft('fullName', event.target.value)}
                placeholder="Full name"
              />
            </label>
            <label className="admin-access-field">
              <span>Global role</span>
              <select
                value={adminInviteDraft.globalRole}
                onChange={(event) => updateAdminInviteDraft('globalRole', event.target.value)}
              >
                <option value="">No global role</option>
                {adminGlobalRoles.map((role) => (
                  <option key={role.name} value={role.name}>{role.name}</option>
                ))}
              </select>
            </label>
            <label className="admin-access-field">
              <span>Property role</span>
              <select
                value={adminInviteDraft.propertyRole}
                onChange={(event) => updateAdminInviteDraft('propertyRole', event.target.value)}
              >
                <option value="">No property role</option>
                {adminPropertyRoles.map((role) => (
                  <option key={role.name} value={role.name}>{role.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-panel-toolbar">
            <div className="admin-selected-count">{formatNumber(adminInviteDraft.propertyIds.length)} selected</div>
            <label className="admin-search-field">
              <span>Property search</span>
              <input
                type="search"
                value={adminInvitePropertySearch}
                onChange={(event) => setAdminInvitePropertySearch(event.target.value)}
                placeholder="Filter properties"
              />
            </label>
            <div className="admin-mini-actions">
              <button type="button" onClick={() => setAdminInviteVisibleProperties(true)}>Select visible</button>
              <button type="button" onClick={() => setAdminInviteVisibleProperties(false)}>Clear visible</button>
            </div>
          </div>
          <div className="admin-access-property-picker">
            {filteredAdminInviteProperties.map((property) => (
              <label key={property.id} className="admin-access-property-pill">
                <input
                  type="checkbox"
                  checked={adminInviteDraft.propertyIds.includes(property.id)}
                  onChange={() => toggleAdminInviteProperty(property.id)}
                />
                <span>{property.name}</span>
              </label>
            ))}
            {filteredAdminInviteProperties.length === 0 && (
              <div className="admin-access-empty">No properties match that search.</div>
            )}
          </div>

          <div className="admin-access-actions">
            <button type="button" onClick={inviteAdminUser} disabled={adminAccessLoading}>
              {adminAccessLoading ? 'Working…' : 'Create Invite Link'}
            </button>
          </div>
        </div>

        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div className="admin-access-panel__eyebrow">Users</div>
            <h3 className="admin-access-panel__title">Existing accounts</h3>
          </div>

          <label className="admin-search-field">
            <span>Search users</span>
            <input
              type="search"
              value={adminUserSearch}
              onChange={(event) => setAdminUserSearch(event.target.value)}
              placeholder="Name, email, or role"
            />
          </label>
          <div className="admin-access-user-list">
            {filteredAdminUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`admin-access-user-card ${adminSelectedUserId === user.id ? 'active' : ''}`}
                onClick={() => handleAdminUserSelection(user.id)}
              >
                <strong>{user.fullName || user.email}</strong>
                <span>{user.email}</span>
                <small>{user.globalRole || user.memberships?.[0]?.role || 'No role assigned'}</small>
              </button>
            ))}
            {filteredAdminUsers.length === 0 && (
              <div className="admin-access-empty">No users match that search.</div>
            )}
          </div>
        </div>

        <div className="admin-access-panel">
          <div className="admin-access-section-head">
            <div className="admin-access-panel__eyebrow">Assignments</div>
            <h3 className="admin-access-panel__title">Edit user access</h3>
          </div>

          {adminUserDraft ? (
            <>
              <div className="admin-access-form-grid">
                <label className="admin-access-field">
                  <span>Email</span>
                  <input type="text" value={adminUserDraft.email} disabled />
                </label>
                <label className="admin-access-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    value={adminUserDraft.fullName}
                    onChange={(event) => updateAdminUserDraft('fullName', event.target.value)}
                  />
                </label>
                <label className="admin-access-field">
                  <span>Global role</span>
                  <select
                    value={adminUserDraft.globalRole}
                    onChange={(event) => updateAdminUserDraft('globalRole', event.target.value)}
                  >
                    <option value="">No global role</option>
                    {adminGlobalRoles.map((role) => (
                      <option key={role.name} value={role.name}>{role.name}</option>
                    ))}
                  </select>
                </label>
                <label className="admin-access-field">
                  <span>Property role</span>
                  <select
                    value={adminUserDraft.propertyRole}
                    onChange={(event) => updateAdminUserDraft('propertyRole', event.target.value)}
                  >
                    <option value="">No property role</option>
                    {adminPropertyRoles.map((role) => (
                      <option key={role.name} value={role.name}>{role.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="admin-panel-toolbar">
                <div className="admin-selected-count">{formatNumber(adminUserDraft.propertyIds.length)} selected</div>
                <label className="admin-search-field">
                  <span>Property search</span>
                  <input
                    type="search"
                    value={adminUserPropertySearch}
                    onChange={(event) => setAdminUserPropertySearch(event.target.value)}
                    placeholder="Filter properties"
                  />
                </label>
                <div className="admin-mini-actions">
                  <button type="button" onClick={() => setAdminUserVisibleProperties(true)}>Select visible</button>
                  <button type="button" onClick={() => setAdminUserVisibleProperties(false)}>Clear visible</button>
                </div>
              </div>
              <div className="admin-access-property-picker">
                {filteredAdminUserProperties.map((property) => (
                  <label key={property.id} className="admin-access-property-pill">
                    <input
                      type="checkbox"
                      checked={adminUserDraft.propertyIds.includes(property.id)}
                      onChange={() => toggleAdminUserProperty(property.id)}
                    />
                    <span>{property.name}</span>
                  </label>
                ))}
                {filteredAdminUserProperties.length === 0 && (
                  <div className="admin-access-empty">No properties match that search.</div>
                )}
              </div>

              <div className="admin-access-actions">
                <button type="button" onClick={saveAdminUserAccess} disabled={adminAccessLoading}>
                  {adminAccessLoading ? 'Saving…' : 'Save Access'}
                </button>
                <button type="button" onClick={createAdminPasswordResetLink} disabled={adminAccessLoading}>
                  {adminAccessLoading ? 'Working…' : 'Create Password Reset Link'}
                </button>
              </div>
            </>
          ) : (
            <div className="admin-access-empty">Choose a user to edit roles and property memberships.</div>
          )}
        </div>
      </div>
      )}

      {adminActiveSection === 'website-schema' && (
      <div className="admin-access-panel">
        <div className="admin-access-section-head">
          <div>
            <div className="admin-access-panel__eyebrow">Website Schema</div>
            <h3 className="admin-access-panel__title">Edit website fields for {selectedPropertyLabel}</h3>
          </div>
          <div className="website-schema-summary">
            <span>{websiteSchemaDraft.groups.length} groups</span>
            <span>{websiteSchemaFieldCount} fields</span>
          </div>
        </div>

        <div className="website-schema-intro">
          <div>
            This schema controls which editable website fields appear for the currently selected property. Field keys become WordPress tokens, so they must stay lowercase and unique.
          </div>
          <button type="button" className="website-schema-action website-schema-action--primary" onClick={addWebsiteSchemaGroup}>
            <Plus size={14} />
            Add group
          </button>
        </div>

        {websiteSchemaValidationIssues.length > 0 && (
          <div className="website-schema-validation">
            <div className="website-schema-validation__title">
              <AlertTriangle size={15} />
              Fix before saving
            </div>
            {websiteSchemaValidationIssues.slice(0, 5).map((issue) => (
              <div key={issue} className="website-schema-validation__item">{issue}</div>
            ))}
            {websiteSchemaValidationIssues.length > 5 && (
              <div className="website-schema-validation__item">And {websiteSchemaValidationIssues.length - 5} more.</div>
            )}
          </div>
        )}

        {websiteSchemaLoading ? (
          <div className="admin-access-empty">Loading website schema…</div>
        ) : (
          <>
            {websiteSchemaDraft.groups.map((group) => (
              <div key={group.id} className={`website-schema-group ${expandedWebsiteSchemaGroups.has(group.id) ? 'is-expanded' : 'is-collapsed'}`}>
                <div className="website-schema-group__top">
                  <button
                    type="button"
                    className="website-schema-icon-button website-schema-group__toggle"
                    onClick={() => toggleWebsiteSchemaGroup(group.id)}
                    aria-expanded={expandedWebsiteSchemaGroups.has(group.id)}
                    title={expandedWebsiteSchemaGroups.has(group.id) ? 'Collapse group' : 'Expand group'}
                  >
                    {expandedWebsiteSchemaGroups.has(group.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <label className="admin-access-field website-schema-group__label">
                    <span>Group label</span>
                    <input
                      type="text"
                      value={group.label}
                      onChange={(event) => updateWebsiteSchemaGroupLabel(group.id, event.target.value)}
                      placeholder="Homepage"
                    />
                  </label>
                  <div className="website-schema-group__meta">
                    <span>{group.fields.length} fields</span>
                    <button type="button" className="website-schema-icon-button" onClick={() => addWebsiteSchemaField(group.id)} title="Add field">
                      <Plus size={15} />
                    </button>
                    <button type="button" className="website-schema-icon-button website-schema-icon-button--danger" onClick={() => removeWebsiteSchemaGroup(group.id)} title="Remove group">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {expandedWebsiteSchemaGroups.has(group.id) && (
                <div className="website-schema-field-list">
                  {group.fields.map((field, fieldIndex) => (
                    <div key={`${group.id}-${fieldIndex}`} className="website-schema-field-card">
                      <div className="website-schema-field-card__top">
                        <div>
                          <strong>{field.label || 'Untitled field'}</strong>
                          <span>{field.type === 'url' ? `r:${field.key || 'field_key'}` : `{{r:${field.key || 'field_key'}}}`}</span>
                        </div>
                        <button type="button" className="website-schema-icon-button website-schema-icon-button--danger" onClick={() => removeWebsiteSchemaField(group.id, fieldIndex)} title="Remove field">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="admin-access-form-grid website-schema-field-card__grid">
                        <label className="admin-access-field">
                          <span>Field key</span>
                          <input
                            type="text"
                            value={field.key}
                            onChange={(event) => updateWebsiteSchemaField(group.id, fieldIndex, 'key', event.target.value)}
                            className={!WEBSITE_SCHEMA_FIELD_KEY_PATTERN.test(field.key) || (websiteSchemaFieldKeyCounts.get(field.key) || 0) > 1 ? 'website-schema-input--invalid' : ''}
                            placeholder="homepage_headline"
                          />
                        </label>
                        <label className="admin-access-field">
                          <span>Field label</span>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(event) => updateWebsiteSchemaField(group.id, fieldIndex, 'label', event.target.value)}
                          />
                        </label>
                        <label className="admin-access-field">
                          <span>Field type</span>
                          <select
                            value={field.type}
                            onChange={(event) => updateWebsiteSchemaField(group.id, fieldIndex, 'type', event.target.value)}
                          >
                            {WEBSITE_SCHEMA_FIELD_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>{type.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="admin-access-field">
                          <span>Placeholder</span>
                          <input
                            type="text"
                            value={field.placeholder || ''}
                            onChange={(event) => updateWebsiteSchemaField(group.id, fieldIndex, 'placeholder', event.target.value)}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                )}
              </div>
            ))}

            <div className="website-schema-footer-actions">
              <button type="button" className="website-schema-action website-schema-action--primary" onClick={saveWebsiteSchemaDraft} disabled={!websiteSchemaDirty || websiteSchemaSaving || websiteSchemaValidationIssues.length > 0}>
                <Save size={14} />
                {websiteSchemaSaving ? 'Saving…' : 'Save schema'}
              </button>
            </div>

            <div className="website-schema-history">
              <div className="website-schema-history__head">
                <div>
                  <div className="admin-access-panel__eyebrow">Schema History</div>
                  <h4>Recent field changes</h4>
                </div>
              </div>
              {websiteSchemaHistory.length > 0 ? (
                <div className="website-schema-history__list">
                  {websiteSchemaHistory.map((entry) => (
                    <div key={entry.id} className="website-schema-history__item">
                      <div className="website-schema-history__time">
                        {new Date(entry.savedAt).toLocaleString()}
                      </div>
                      {entry.changes.slice(0, 4).map((change) => (
                        <div key={change} className="website-schema-history__change">{change}</div>
                      ))}
                      {entry.changes.length > 4 && (
                        <div className="website-schema-history__change">And {entry.changes.length - 4} more changes.</div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="website-schema-history__empty">Saved field changes will appear here after the first schema update.</div>
              )}
            </div>
          </>
        )}
      </div>
      )}

      {adminActiveSection === 'audit-log' && (
      <div className="admin-access-panel">
        <div className="admin-access-section-head">
          <div>
            <div className="admin-access-panel__eyebrow">Audit</div>
            <h3 className="admin-access-panel__title">Recent access activity</h3>
          </div>
          <span>{formatNumber(filteredAdminAuditLogs.length)} shown</span>
        </div>
        <label className="admin-search-field admin-search-field--wide">
          <span>Search audit log</span>
          <input
            type="search"
            value={adminAuditSearch}
            onChange={(event) => setAdminAuditSearch(event.target.value)}
            placeholder="Actor, target, action, or role"
          />
        </label>

        {filteredAdminAuditLogs.length ? (
          <div className="admin-access-audit-list">
            {filteredAdminAuditLogs.slice(0, 25).map((log) => {
              const createdAt = log.created_at ? new Date(log.created_at) : null;
              const actionLabel = log.action === 'invite_user' ? 'Invite created' : 'Access updated';
              const requestedRole = log.details?.requestedPropertyRole || log.details?.propertyRole || log.details?.requestedGlobalRole || log.details?.globalRole;
              const propertyCount = Array.isArray(log.details?.requestedPropertyIds)
                ? log.details.requestedPropertyIds.length
                : Array.isArray(log.details?.propertyIds)
                  ? log.details.propertyIds.length
                  : Array.isArray(log.details?.after?.memberships)
                    ? log.details.after.memberships.length
                    : 0;

              return (
                <div key={log.id} className="admin-access-audit-card">
                  <div className="admin-access-audit-card__top">
                    <strong>{actionLabel}</strong>
                    <span>{createdAt ? createdAt.toLocaleString() : 'Unknown time'}</span>
                  </div>
                  <div className="admin-access-audit-card__body">
                    <div>
                      <span>Actor</span>
                      <strong>{log.actor_email || 'Unknown admin'}</strong>
                    </div>
                    <div>
                      <span>Target</span>
                      <strong>{log.target_email || 'Unknown user'}</strong>
                    </div>
                    <div>
                      <span>Role</span>
                      <strong>{requestedRole || 'None assigned'}</strong>
                    </div>
                    <div>
                      <span>Properties</span>
                      <strong>{propertyCount}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredAdminAuditLogs.length > 25 && (
              <div className="admin-access-empty">Showing latest 25 matching audit records.</div>
            )}
          </div>
        ) : (
          <div className="admin-access-empty">No access activity matches the current search.</div>
        )}
      </div>
      )}
    </div>
  );

  if (isClientReportMode && !clientReportProperty) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-card__eyebrow">Report unavailable</div>
          <h1 className="auth-card__title">This report link is not assigned to your account.</h1>
          <p className="auth-card__copy">
            Sign in with an account that has reporting access for this property, or ask an administrator to update the client membership.
          </p>
          {typeof onSignOut === 'function' && (
            <button type="button" className="auth-form__submit" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </div>
    );
  }

  const isReportsPresentationTab = activeTab === 'reports' || activeTab === 'call prep';

  return (
    <div className={`dashboard-container ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${isReportsPresentationTab ? 'dashboard-container--reports' : ''} ${isClientReportMode ? 'dashboard-container--client-report' : ''}`}>
      {renderAccountPanel()}
      {showLoader && (
        <div className="loading-overlay" aria-live="polite" aria-busy="true">
          <div className="loading-overlay__animation">
            <img src={loaderMark} alt="Loading" className="loading-overlay__image" />
            <div className="loading-overlay__label">Loading dashboard data</div>
          </div>
        </div>
      )}
      {/* Sidebar */}
      {!isClientReportMode && (
        <div className="sidebar">
          <div className="sidebar-topbar">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={sidebarCollapsed}
            >
              {sidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            </button>
          </div>

          <div className="logo-container">
            <img src={sidebarCollapsed ? '/logo-white-icon.svg' : '/logo-white.svg'} alt="Redstone Logo" className="brand-logo" />
          </div>

          <div className="nav-menu">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon size={20} />
                  <span className="nav-label">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className={`main-content ${isReportsPresentationTab ? 'main-content--reports' : ''}`}>
        {!isClientReportMode && (
          <div className={`header ${isReportsPresentationTab ? 'header--reports' : ''}`}>
            {activeTab === 'admin' || activeTab === 'audit' || activeTab === 'red-list' ? (
              <div className="property-selector property-selector--admin">
                <span className="property-selector__label">{activeTab === 'audit' || activeTab === 'red-list' ? 'Portfolio scope' : 'Access scope'}</span>
                <div className="property-selector__admin-summary">
                  {activeTab === 'audit'
                    ? 'Cross-property audit command center for internal triage and design follow-up.'
                    : activeTab === 'red-list'
                      ? 'All-property red-list monitoring and lead-deficit details.'
                      : 'Manage user invites, global roles, and property assignments.'}
                </div>
              </div>
            ) : (
              <div className="property-selector">
                <span className="property-selector__label">Property</span>
                <div className="property-selector__control">
                  <select
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    className="property-selector__select"
                  >
                    {canUseAllProperties && activeTab === 'dashboard' && (
                      <option value={ALL_PROPERTIES_OPTION}>All Properties</option>
                    )}
                    {availableProperties.map((property) => (
                      <option key={property.propertyId} value={property.propertyId}>
                        {property.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="property-selector__chevron" />
                </div>
              </div>
            )}
            <div className="header-status">
              <div className="header-status__identity">
                <span className="header-status__name">{displayName}</span>
              </div>
              <div className="header-status__actions">
                <button
                  type="button"
                  className="header-status__avatar header-status__avatar-button"
                  aria-label="Open account settings"
                  onClick={() => {
                    setAccountError('');
                    setAccountNotice('');
                    setAccountPanelOpen(true);
                  }}
                >
                  {accountAvatarUrl ? (
                    <img src={accountAvatarUrl} alt={displayName} className="account-avatar__image" />
                  ) : (
                    <span>{accountInitials}</span>
                  )}
                </button>
                {typeof onSignOut === 'function' && (
                  <button
                    type="button"
                    className="header-status__signout"
                    onClick={onSignOut}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={`content-body ${isReportsPresentationTab ? 'content-body--reports' : ''}`}>
          {activeTab !== 'website manager' && activeTab !== 'admin' && activeTab !== 'audit' && activeTab !== 'red-list' && (
            <div className="dashboard-title-row">
              <h1 className="title">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
              {activeTab !== 'call prep' && <div className="global-date-controls">
                <div className="global-date-controls__picker">
                  <div className="global-date-controls__label">Date range</div>
                  <div className="global-date-controls__control">
                    <Calendar size={16} className="global-date-controls__icon" />
                    <select value={draftDateRange} onChange={(e) => handleDateRangeChange(e.target.value)} className="global-date-controls__select">
                      <option value="7d">Last 7 Days</option>
                      <option value="14d">Last 14 Days</option>
                      <option value="28d">Last 28 Days</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="90d">Last 90 Days</option>
                      <option value="365d">Last 12 Months</option>
                      <option value="quarterToDate">Quarter to Date</option>
                      <option value="yearToDate">Year to Date</option>
                      <option value="lastMonth">Last Month</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>
                  {draftDateRange === 'custom' && (
                    <div className="global-date-controls__custom-range">
                      <input
                        type="date"
                        value={draftCustomRange.start}
                        onChange={(e) => setDraftCustomRange({ ...draftCustomRange, start: e.target.value })}
                        className="global-date-controls__input"
                      />
                      <span className="global-date-controls__to">to</span>
                      <input
                        type="date"
                        value={draftCustomRange.end}
                        onChange={(e) => setDraftCustomRange({ ...draftCustomRange, end: e.target.value })}
                        className="global-date-controls__input"
                      />
                      <button
                        type="button"
                        className="global-date-controls__apply"
                        onClick={applyDraftCustomRange}
                        disabled={!canApplyDraftCustomRange || !hasUnappliedCustomRange}
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>
                <div className="global-date-controls__meta">
                  <div className="global-date-controls__label">Live window</div>
                  <div className="global-date-controls__meta-window">
                    <strong>{rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}</strong>
                  </div>
                </div>
              </div>}
            </div>
          )}

          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'website manager' && renderWebsiteManager()}
          {activeTab === 'property info' && renderPropertyInfo()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'call prep' && renderCallPrep()}
          {activeTab === 'recommendations' && renderRecommendations()}
          {activeTab === 'audit' && renderAuditCommandCenter()}
          {activeTab === 'analytics' && renderAnalytics()}
          {activeTab === 'reputation' && renderReputation()}
          {activeTab === 'tickets' && renderTickets()}
          {activeTab === 'tasks' && renderTasks()}
          {activeTab === 'red-list' && renderRedList()}
          {activeTab === 'admin' && renderAdmin()}

          <div className="app-footer-links">
            <a href="/privacy-policy">Privacy Policy</a>
            <a href="/terms-of-service">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export { DashboardApp, PrivacyPolicyPage, TermsOfServicePage };

export default DashboardApp;
