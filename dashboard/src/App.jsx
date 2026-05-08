import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  ADMIN_ACCESS_USERS_URL,
  GA4_DASHBOARD_URL,
  GOOGLE_ADS_DASHBOARD_URL,
  LOCAL_FALCON_DASHBOARD_URL,
  HEATMAP_SITES_URL,
  HEATMAP_PAGES_URL,
  HEATMAP_SUMMARY_URL,
  HEATMAP_TRACKER_URL,
  META_ADS_DASHBOARD_URL,
  PROPERTY_REPORTING_OVERVIEW_URL,
  RENDER_API_BASE_URL,
  REPORTING_LAYOUT_URL,
  REPUTATION_DASHBOARD_URL,
  ROI_PIPELINE_STATUS_URL,
  SITE_AUDIT_PORTFOLIO_URL,
  SITE_AUDIT_PAGES_URL,
  SITE_AUDIT_RUN_URL,
  SITE_AUDIT_SCREENSHOT_PREVIEW_URL,
  SITE_AUDIT_SUMMARY_URL,
  WEBSITE_MANAGER_SCHEMA_URL,
  WEBSITE_MANAGER_URL
} from './apiConfig';
import { authFetch } from './lib/authFetch';
import { supabase } from './lib/supabase';
import HeatmapRenderer from './components/HeatmapRenderer';
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
  ChevronDown, 
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  Camera,
  Users,
  Home,
  TrendingUp,
  DollarSign,
  FileCheck,
  MessageSquareText,
  Globe,
  Mail,
  KeyRound,
  UserRound,
  X,
  Plus,
  Trash2,
  Save,
  AlertTriangle
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, LineChart, Line
} from 'recharts';

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
const REPORTING_LAYOUT_STORAGE_KEY = 'reportingLayoutAdminEnabled';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'dashboardSidebarCollapsed';
const ALL_PROPERTIES_OPTION = '__all__';
const DASHBOARD_WORKSPACE_STATE_KEY_PREFIX = 'dashboardWorkspaceState';
const WEBSITE_SCHEMA_HISTORY_STORAGE_KEY_PREFIX = 'websiteSchemaHistory';
const DATE_RANGE_OPTIONS = new Set(['7d', '14d', '28d', '90d', '365d', 'lastMonth', 'quarterToDate', 'yearToDate', 'custom']);
const META_ADS_ATTRIBUTION_MODES = new Set(['account_default', '7d_click_1d_view', '1d_click']);
const REPORTING_PANEL_LIBRARY = [
  { id: 'roi', title: 'ROAS Metrics', eyebrow: 'Revenue Efficiency' },
  { id: 'budget', title: 'Budget Tracking', eyebrow: 'Spend Control' },
  { id: 'entrata', title: 'Entrata Funnel', eyebrow: 'Leads to Leases' },
  { id: 'heatmaps-audit', title: 'Heatmaps + Site Audit', eyebrow: 'Website Experience' },
  { id: 'google-ads', title: 'Google Ads', eyebrow: 'Paid Search' },
  { id: 'ga4', title: 'Google Analytics', eyebrow: 'Behavior + Demand' },
  { id: 'opiniion', title: 'Opiniion', eyebrow: 'Resident Sentiment' },
  { id: 'local-falcon', title: 'Local Falcon', eyebrow: 'Local SEO' },
  { id: 'meta-ads', title: 'Meta Ads', eyebrow: 'Paid Social' }
];
const REPORTING_PANEL_IDS = REPORTING_PANEL_LIBRARY.map((panel) => panel.id);
const HEATMAP_DEVICE_OPTIONS = ['desktop', 'mobile', 'tablet'];
const TASK_STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'awaiting_approval', label: 'Awaiting Approval' },
  { id: 'approved', label: 'Approved' },
  { id: 'complete', label: 'Complete' },
];
const TASK_STATUS_IDS = TASK_STATUSES.map((status) => status.id);
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
  { id: 'audit', label: 'Audit', icon: AlertTriangle, permission: TAB_PERMISSIONS.audit },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp, permission: TAB_PERMISSIONS.analytics },
  { id: 'reputation', label: 'Reputation', icon: MessageSquareText, permission: TAB_PERMISSIONS.reputation },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList, permission: TAB_PERMISSIONS.tasks },
  { id: 'admin', label: 'Admin', icon: Users, permission: TAB_PERMISSIONS.admin }
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

const getDashboardWorkspaceStateKey = (user) => {
  const accountId = user?.id || user?.email || 'anonymous';
  return `${DASHBOARD_WORKSPACE_STATE_KEY_PREFIX}:${accountId}`;
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

const formatDateInputValue = (value) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeTaskRecord = (row) => {
  const status = TASK_STATUS_IDS.includes(row?.status) ? row.status : 'new';
  return {
    id: row?.id || '',
    title: row?.title || '',
    description: row?.description || '',
    notes: row?.notes || '',
    dueDate: row?.due_date || '',
    status,
    propertyId: row?.property_id || '',
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

const normalizeReportingLayoutRecord = (value) => {
  const order = Array.isArray(value?.panelOrder) ? value.panelOrder.map((item) => String(item)) : [];
  const hidden = Array.isArray(value?.hiddenPanelIds) ? value.hiddenPanelIds.map((item) => String(item)) : [];

  const uniqueOrder = order.filter((panelId, index) => REPORTING_PANEL_IDS.includes(panelId) && order.indexOf(panelId) === index);
  const normalizedOrder = [
    ...uniqueOrder,
    ...REPORTING_PANEL_IDS.filter((panelId) => !uniqueOrder.includes(panelId))
  ];

  return {
    panelOrder: normalizedOrder,
    hiddenPanelIds: hidden.filter((panelId, index) => REPORTING_PANEL_IDS.includes(panelId) && hidden.indexOf(panelId) === index)
  };
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

const getLeadKey = (lead) => {
  const candidates = [
    lead.leadId,
    lead.leadID,
    lead.prospectId,
    lead.prospectID,
    lead.customerId,
    lead.customerID,
    lead.applicationId,
    lead.id
  ];

  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return getScopedStableKey(lead?._propertyId, stableId);
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

const isRenderAdapterUrl = (value) => {
  if (!value || !RENDER_API_BASE_URL) return false;
  return String(value).startsWith(RENDER_API_BASE_URL);
};

const isStartedApplicationEvent = (event) => {
  const reason = String(event.eventReason || event.type || '').toLowerCase();
  return event.typeId === 12 && (
    reason.includes('application status:completed') ||
    reason.includes('application status: completed')
  );
};

const APPLICATION_COMPLETED_DATE_KEYS = [
  'Application - Completed',
  'Application Completed',
  'applicationCompletedOn',
  'applicationCompletedDate',
  'applicationDateCompleted',
  'applicationCompleted',
  'appCompletedOn',
  'appCompletedDate'
];

const LEASE_APPROVED_DATE_KEYS = [
  'Lease - Approved',
  'Lease Approved',
  'leaseApprovedOn',
  'leaseApprovedDate',
  'leaseDateApproved',
  'leaseApproved'
];

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

const getLifecycleDate = (record, dateKeys) => parseEntrataDate(findNestedValue(record, dateKeys));

const isInDateRange = (date, start, end) => {
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
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

const getDeltaTone = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'neutral';
  if (Number(value) > 0) return 'positive';
  if (Number(value) < 0) return 'negative';
  return 'neutral';
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
}) => {
  const { profile, refreshAccess } = useAccess();
  const workspaceStateStorageKey = useMemo(
    () => getDashboardWorkspaceStateKey(currentUser),
    [currentUser]
  );
  const savedWorkspaceState = useMemo(
    () => normalizeSavedDashboardState(readDashboardWorkspaceState(workspaceStateStorageKey), defaultPropertyId),
    [defaultPropertyId, workspaceStateStorageKey]
  );
  const [activeTab, setActiveTab] = useState(savedWorkspaceState.activeTab);
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
  const [selectedPropertyId, setSelectedPropertyId] = useState(savedWorkspaceState.selectedPropertyId);
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
  const [heatmapSiteLoading, setHeatmapSiteLoading] = useState(true);
  const [heatmapSiteSaving, setHeatmapSiteSaving] = useState(false);
  const [heatmapSiteError, setHeatmapSiteError] = useState(null);
  const [heatmapSiteNotice, setHeatmapSiteNotice] = useState(null);
  const [heatmapSiteDoc, setHeatmapSiteDoc] = useState(HEATMAP_SITE_DEFAULT_CONFIG);
  const [heatmapSiteDraft, setHeatmapSiteDraft] = useState(HEATMAP_SITE_DEFAULT_CONFIG);
  const [, setHeatmapPagesLoading] = useState(false);
  const [heatmapSummaryLoading, setHeatmapSummaryLoading] = useState(false);
  const [siteAuditLoading, setSiteAuditLoading] = useState(false);
  const [siteAuditRunning, setSiteAuditRunning] = useState(false);
  const [heatmapPanelError, setHeatmapPanelError] = useState(null);
  const [heatmapPagesData, setHeatmapPagesData] = useState(null);
  const [heatmapSummaryData, setHeatmapSummaryData] = useState(null);
  const [siteAuditPagesData, setSiteAuditPagesData] = useState(null);
  const [siteAuditSummaryData, setSiteAuditSummaryData] = useState(null);
  const [portfolioAuditLoading, setPortfolioAuditLoading] = useState(false);
  const [portfolioAuditError, setPortfolioAuditError] = useState(null);
  const [portfolioAuditProperties, setPortfolioAuditProperties] = useState([]);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState('');
  const [screenshotPreviewLoading, setScreenshotPreviewLoading] = useState(false);
  const [screenshotPreviewError, setScreenshotPreviewError] = useState(null);
  const [selectedHeatmapPath, setSelectedHeatmapPath] = useState('');
  const [heatmapLayers, setHeatmapLayers] = useState({
    click: true,
    cursor: false,
    scroll: false,
    engagement: false,
  });
  const [heatmapLayersTouched, setHeatmapLayersTouched] = useState(false);
  const [selectedHeatmapDevice, setSelectedHeatmapDevice] = useState('desktop');
  const heatmapPageOptions = heatmapPagesData?.pages || [];
  const auditPageOptions = siteAuditPagesData?.pages || [];
  const selectedAuditPage = useMemo(() => (
    auditPageOptions.find((page) => (page.path || '/') === selectedHeatmapPath) || auditPageOptions[0] || null
  ), [auditPageOptions, selectedHeatmapPath]);
  const selectedScreenshot = useMemo(() => {
    const screenshots = Array.isArray(selectedAuditPage?.screenshots) ? selectedAuditPage.screenshots : [];
    return screenshots.find((item) => item.deviceType === selectedHeatmapDevice) || screenshots[0] || null;
  }, [selectedAuditPage, selectedHeatmapDevice]);
  const [websiteSchemaLoading, setWebsiteSchemaLoading] = useState(false);
  const [websiteSchemaSaving, setWebsiteSchemaSaving] = useState(false);
  const [websiteSchemaError, setWebsiteSchemaError] = useState(null);
  const [websiteSchemaNotice, setWebsiteSchemaNotice] = useState(null);
  const [websiteSchemaDoc, setWebsiteSchemaDoc] = useState(WEBSITE_MANAGER_DEFAULT_SCHEMA);
  const [websiteSchemaDraft, setWebsiteSchemaDraft] = useState(WEBSITE_MANAGER_DEFAULT_SCHEMA);
  const [websiteSchemaHistory, setWebsiteSchemaHistory] = useState([]);
  const [reportingLayoutLoading, setReportingLayoutLoading] = useState(true);
  const [reportingLayoutSaving, setReportingLayoutSaving] = useState(false);
  const [reportingLayoutError, setReportingLayoutError] = useState(null);
  const [reportingLayoutNotice, setReportingLayoutNotice] = useState(null);
  const [reportingLayoutDoc, setReportingLayoutDoc] = useState(() => normalizeReportingLayoutRecord(null));
  const [reportingLayoutDraft, setReportingLayoutDraft] = useState(() => normalizeReportingLayoutRecord(null));
  const [reportingAdminEnabled, setReportingAdminEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(REPORTING_LAYOUT_STORAGE_KEY) === 'true';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  });
  
  // Real data state
  const [leadItems, setLeadItems] = useState([]);
  const [eventItems, setEventItems] = useState([]);
  const [leaseItems, setLeaseItems] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [availabilityPricingSnapshot, setAvailabilityPricingSnapshot] = useState(null);
  const [specialsSnapshot, setSpecialsSnapshot] = useState(null);
  const [latestAvailabilityDate, setLatestAvailabilityDate] = useState(null);
  const [parentDocs, setParentDocs] = useState([]);
  const [roiDailyItems, setRoiDailyItems] = useState([]);
  const reportingUsesStagedOverview = Boolean(PROPERTY_REPORTING_OVERVIEW_URL);
  const [reportingDataSource, setReportingDataSource] = useState(() => (
    reportingUsesStagedOverview ? 'loading' : 'error'
  ));
  const [roiPipelineStatus, setRoiPipelineStatus] = useState(null);
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
  const [adminAccessLoading, setAdminAccessLoading] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState(null);
  const [adminAccessNotice, setAdminAccessNotice] = useState(null);
  const [adminInviteLink, setAdminInviteLink] = useState('');
  const [adminPasswordResetLink, setAdminPasswordResetLink] = useState('');
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminRoles, setAdminRoles] = useState([]);
  const [adminProperties, setAdminProperties] = useState([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState([]);
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
  const reportingLayoutUsesStagedAdapter = Boolean(REPORTING_LAYOUT_URL);
  const analyticsEndpointsConfigured = Boolean(
    GA4_DASHBOARD_URL && GOOGLE_ADS_DASHBOARD_URL && META_ADS_DASHBOARD_URL && REPUTATION_DASHBOARD_URL
  );
  const analyticsUsesRenderAdapter = useMemo(
    () => [GA4_DASHBOARD_URL, GOOGLE_ADS_DASHBOARD_URL, META_ADS_DASHBOARD_URL, REPUTATION_DASHBOARD_URL].every(isRenderAdapterUrl),
    []
  );
  const isAllPropertiesSelected = selectedPropertyId === ALL_PROPERTIES_OPTION;
  const allPropertiesSupportedTabs = useMemo(() => new Set(['dashboard']), []);
  const selectedProperty = useMemo(() => {
    if (isAllPropertiesSelected) return null;
    const base = availableProperties.find((property) => property.propertyId === selectedPropertyId) || null;
    if (!base) return null;
    return {
      ...base,
      opiniionSkip: OPINIION_SKIPPED_PROPERTY_IDS.has(selectedPropertyId),
    };
  }, [availableProperties, isAllPropertiesSelected, selectedPropertyId]);
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
    () => NAV_ITEMS.filter((item) => currentPropertyPermissionSet.has(item.permission)),
    [currentPropertyPermissionSet]
  );
  const taskPropertyIds = useMemo(
    () => new Set(availableProperties.map((property) => property.propertyId)),
    [availableProperties]
  );
  const taskPropertyById = useMemo(
    () => new Map(availableProperties.map((property) => [property.propertyId, property])),
    [availableProperties]
  );
  const canEditReportingLayout = currentPropertyPermissionSet.has(REPORTING_LAYOUT_EDIT_PERMISSION);
  const canEditWebsiteManager = currentPropertyPermissionSet.has(WEBSITE_MANAGER_EDIT_PERMISSION);
  const canViewAuditCommandCenter = currentPropertyPermissionSet.has(TAB_PERMISSIONS.audit);
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
  }, [availableProperties, canUseAllProperties, defaultPropertyId, selectedPropertyId]);

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
  }, [activeTab, customRange, dateRange, excludedMarketingSpendKeys, metaAdsAttributionMode, selectedPropertyId, workspaceStateStorageKey]);

  useEffect(() => {
    if (!canEditReportingLayout && reportingAdminEnabled) {
      setReportingAdminEnabled(false);
    }
  }, [canEditReportingLayout, reportingAdminEnabled]);

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
      const response = await authFetch(ADMIN_ACCESS_USERS_URL);
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Admin access load failed: ${response.status}`);
      }

      const users = Array.isArray(payload.users) ? payload.users : [];
      const roles = Array.isArray(payload.roles) ? payload.roles : [];
      const properties = Array.isArray(payload.properties) ? payload.properties : [];
      const auditLogs = Array.isArray(payload.auditLogs) ? payload.auditLogs : [];
      const nextSelectedUserId = users.some((user) => user.id === adminSelectedUserId)
        ? adminSelectedUserId
        : users[0]?.id || null;

      setAdminUsers(users);
      setAdminRoles(roles);
      setAdminProperties(properties);
      setAdminAuditLogs(auditLogs);
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

  const loadPortfolioAudit = useCallback(async () => {
    if (!SITE_AUDIT_PORTFOLIO_URL) {
      setPortfolioAuditProperties([]);
      setPortfolioAuditError('Portfolio audit endpoint is not configured.');
      return;
    }

    setPortfolioAuditLoading(true);
    setPortfolioAuditError(null);

    try {
      const response = await authFetch(SITE_AUDIT_PORTFOLIO_URL);
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Portfolio audit load failed: ${response.status}`);
      }
      setPortfolioAuditProperties(Array.isArray(payload.properties) ? payload.properties : []);
    } catch (error) {
      setPortfolioAuditProperties([]);
      setPortfolioAuditError(error.message || 'Unable to load portfolio audit data.');
    } finally {
      setPortfolioAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canViewAuditCommandCenter || activeTab !== 'audit') return;
    loadPortfolioAudit();
  }, [activeTab, canViewAuditCommandCenter, loadPortfolioAudit]);

  useEffect(() => {
    setTaskDraft((current) => {
      if (current.propertyId && taskPropertyIds.has(current.propertyId)) return current;
      return { ...current, propertyId: selectedPropertyId || availableProperties[0]?.propertyId || '' };
    });
  }, [availableProperties, selectedPropertyId, taskPropertyIds]);

  const loadTasks = useCallback(async () => {
    if (!currentUser?.id || !supabase) {
      setTasks([]);
      setTasksError('Tasks require a signed-in Supabase account.');
      return;
    }

    setTasksLoading(true);
    setTasksError(null);
    setTasksNotice(null);

    try {
      const response = await supabase
        .from('user_tasks')
        .select('id, owner_user_id, property_id, title, description, notes, due_date, status, created_at, updated_at')
        .eq('owner_user_id', currentUser.id)
        .order('updated_at', { ascending: false });

      if (response.error) {
        throw response.error;
      }

      setTasks((response.data || []).map(normalizeTaskRecord));
    } catch (error) {
      setTasksError(error.message || 'Unable to load your task board.');
    } finally {
      setTasksLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (activeTab !== 'tasks') return;
    loadTasks();
  }, [activeTab, loadTasks]);

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
  // Derived Date Range
  const rangeDates = useMemo(() => {
    const end = new Date();
    let start = new Date();
    if (dateRange === '7d') start.setDate(end.getDate() - 6);
    else if (dateRange === '14d') start.setDate(end.getDate() - 13);
    else if (dateRange === '28d') start.setDate(end.getDate() - 27);
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
      if (!propertyScopedSelectionId) {
        setParentDocs([]);
        setLeadItems([]);
        setEventItems([]);
        setLeaseItems([]);
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
        const response = await authFetch(`${PROPERTY_REPORTING_OVERVIEW_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.message || `Property overview fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        setParentDocs(Array.isArray(payload.parent_docs) ? payload.parent_docs : []);
        setLeadItems(Array.isArray(payload.lead_items) ? payload.lead_items : []);
        setEventItems(Array.isArray(payload.event_items) ? payload.event_items : []);
        setLeaseItems(Array.isArray(payload.lease_items) ? payload.lease_items : []);
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
  }, [availableProperties, isAllPropertiesSelected, rangeDates, selectedPropertyId, reportingUsesStagedOverview]);

  useEffect(() => {
    let cancelled = false;

    const loadWebsiteManager = async () => {
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
  }, [propertyScopedSelectionId, websiteManagerUsesStagedAdapter]);

  useEffect(() => {
    let cancelled = false;

    const loadHeatmapSite = async () => {
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
  }, [propertyScopedSelectionId, selectedProperty?.name, websiteManagerDoc.websiteUrl]);

  useEffect(() => {
    if (!propertyScopedSelectionId || !HEATMAP_PAGES_URL || !SITE_AUDIT_PAGES_URL || !SITE_AUDIT_SUMMARY_URL) {
      setHeatmapPagesData(null);
      setSiteAuditPagesData(null);
      setSiteAuditSummaryData(null);
      setHeatmapPanelError(propertyScopedSelectionId ? 'Heatmap and audit endpoints are not fully configured.' : null);
      setHeatmapPagesLoading(false);
      setSiteAuditLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadHeatmapPanelData = async () => {
      setHeatmapPagesLoading(true);
      setSiteAuditLoading(true);
      setHeatmapPanelError(null);
      try {
        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteDraft.siteKey) params.set('site_key', heatmapSiteDraft.siteKey);

        const fetchPanelPayload = async (label, url) => {
          const response = await authFetch(url, { signal: controller.signal });
          const payload = await response.json();
          if (!response.ok || payload?.status === 'error') {
            throw new Error(payload?.error || `${label} fetch failed: ${response.status}`);
          }
          return payload;
        };
        const [pagesResult, auditPagesResult, auditSummaryResult] = await Promise.allSettled([
          fetchPanelPayload('Heatmap pages', `${HEATMAP_PAGES_URL}?${params.toString()}`),
          fetchPanelPayload('Audit pages', `${SITE_AUDIT_PAGES_URL}?${params.toString()}`),
          fetchPanelPayload('Audit summary', `${SITE_AUDIT_SUMMARY_URL}?${params.toString()}`),
        ]);
        const partialErrors = [];
        if (pagesResult.status === 'fulfilled') setHeatmapPagesData(pagesResult.value);
        else {
          setHeatmapPagesData(null);
          partialErrors.push(pagesResult.reason?.message || 'Heatmap pages unavailable.');
        }
        if (auditPagesResult.status === 'fulfilled') setSiteAuditPagesData(auditPagesResult.value);
        else {
          setSiteAuditPagesData(null);
          partialErrors.push(auditPagesResult.reason?.message || 'Audit pages unavailable.');
        }
        if (auditSummaryResult.status === 'fulfilled') setSiteAuditSummaryData(auditSummaryResult.value);
        else {
          setSiteAuditSummaryData(null);
          partialErrors.push(auditSummaryResult.reason?.message || 'Audit summary unavailable.');
        }
        setHeatmapPanelError(partialErrors.length ? `Partial data loaded: ${partialErrors.join(' ')}` : null);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Heatmap/audit panel fetch failed', error);
        setHeatmapPagesData(null);
        setSiteAuditPagesData(null);
        setSiteAuditSummaryData(null);
        setHeatmapPanelError(error.message || 'Unable to load heatmap and audit data.');
      } finally {
        if (!controller.signal.aborted) {
          setHeatmapPagesLoading(false);
          setSiteAuditLoading(false);
        }
      }
    };

    loadHeatmapPanelData();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, heatmapSiteDraft.siteKey]);

  useEffect(() => {
    const pages = heatmapPagesData?.pages || [];
    if (!selectedHeatmapPath && pages.length > 0) {
      setSelectedHeatmapPath(pages[0].path || pages[0].canonicalPath || '/');
    }
    if (selectedHeatmapPath && pages.length > 0 && !pages.some((page) => (page.path || page.canonicalPath || '/') === selectedHeatmapPath)) {
      setSelectedHeatmapPath(pages[0].path || pages[0].canonicalPath || '/');
    }
  }, [heatmapPagesData, selectedHeatmapPath]);

  useEffect(() => {
    if (!propertyScopedSelectionId || !HEATMAP_SUMMARY_URL || !selectedHeatmapPath) {
      setHeatmapSummaryData(null);
      setHeatmapSummaryLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadHeatmapSummary = async () => {
      setHeatmapSummaryLoading(true);
      setHeatmapPanelError(null);
      try {
        const params = new URLSearchParams({
          property_id: propertyScopedSelectionId,
          path: selectedHeatmapPath,
          device_type: selectedHeatmapDevice,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        if (heatmapSiteDraft.siteKey) params.set('site_key', heatmapSiteDraft.siteKey);
        const response = await authFetch(`${HEATMAP_SUMMARY_URL}?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Heatmap summary fetch failed: ${response.status}`);
        }
        setHeatmapSummaryData(payload);
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Heatmap summary fetch failed', error);
        setHeatmapSummaryData(null);
        setHeatmapPanelError(error.message || 'Unable to load heatmap summary.');
      } finally {
        if (!controller.signal.aborted) setHeatmapSummaryLoading(false);
      }
    };

    loadHeatmapSummary();
    return () => controller.abort();
  }, [propertyScopedSelectionId, rangeDates, selectedHeatmapDevice, selectedHeatmapPath, heatmapSiteDraft.siteKey]);

  useEffect(() => {
    if (!selectedScreenshot?.id || !SITE_AUDIT_SCREENSHOT_PREVIEW_URL) {
      setScreenshotPreviewUrl('');
      setScreenshotPreviewError(null);
      setScreenshotPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadScreenshotPreview = async () => {
      setScreenshotPreviewLoading(true);
      setScreenshotPreviewError(null);
      try {
        const params = new URLSearchParams({
          screenshot_id: selectedScreenshot.id,
          expires_in: '900',
        });
        const response = await authFetch(`${SITE_AUDIT_SCREENSHOT_PREVIEW_URL}?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Screenshot preview fetch failed: ${response.status}`);
        }
        setScreenshotPreviewUrl(payload.url || '');
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Screenshot preview fetch failed', error);
        setScreenshotPreviewUrl('');
        setScreenshotPreviewError(error.message || 'Unable to load screenshot preview.');
      } finally {
        if (!controller.signal.aborted) setScreenshotPreviewLoading(false);
      }
    };

    loadScreenshotPreview();
    return () => controller.abort();
  }, [selectedScreenshot?.id]);

  useEffect(() => {
    setWebsiteSchemaHistory(readWebsiteSchemaHistory(propertyScopedSelectionId));
  }, [propertyScopedSelectionId]);

  useEffect(() => {
    let cancelled = false;

    const loadWebsiteSchema = async () => {
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
  }, [propertyScopedSelectionId, canManageUsers, websiteManagerSchemaUsesStagedAdapter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REPORTING_LAYOUT_STORAGE_KEY, reportingAdminEnabled ? 'true' : 'false');
  }, [reportingAdminEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? 'true' : 'false');
  }, [sidebarCollapsed]);

  useEffect(() => {
    let cancelled = false;

    const loadReportingLayout = async () => {
      if (!propertyScopedSelectionId) {
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('No property is currently available for this account.');
        setReportingLayoutLoading(false);
        return;
      }

      if (!reportingLayoutUsesStagedAdapter) {
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('Reporting layout endpoint is not configured.');
        setReportingLayoutLoading(false);
        return;
      }

      setReportingLayoutLoading(true);
      setReportingLayoutError(null);
      setReportingLayoutNotice(null);

      try {
        const params = new URLSearchParams({ property_id: propertyScopedSelectionId });
        const response = await authFetch(`${REPORTING_LAYOUT_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Reporting layout fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        const normalized = normalizeReportingLayoutRecord(payload.record);
        setReportingLayoutDoc(normalized);
        setReportingLayoutDraft(normalized);
        setReportingLayoutLoading(false);
      } catch (error) {
        console.error('Reporting layout staged fetch failed', error);
        if (cancelled) return;
        const fallback = normalizeReportingLayoutRecord(null);
        setReportingLayoutDoc(fallback);
        setReportingLayoutDraft(fallback);
        setReportingLayoutError('Unable to load the saved reporting layout from the staged adapter.');
        setReportingLayoutLoading(false);
      }
    };

    loadReportingLayout();
    return () => {
      cancelled = true;
    };
  }, [propertyScopedSelectionId, reportingLayoutUsesStagedAdapter]);

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
  }, [propertyScopedSelectionId, rangeDates, selectedProperty]);

  useEffect(() => {
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
  }, [propertyScopedSelectionId, rangeDates, selectedProperty]);

  useEffect(() => {
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
  }, [metaAdsAttributionMode, propertyScopedSelectionId, rangeDates, selectedProperty]);

  useEffect(() => {
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
  }, [propertyScopedSelectionId, rangeDates, selectedProperty]);

  useEffect(() => {
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
  }, [propertyScopedSelectionId, rangeDates, selectedProperty]);

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

    leaseItems.forEach((lease) => {
      const completedDate = getLifecycleDate(lease, APPLICATION_COMPLETED_DATE_KEYS);
      if (!isInDateRange(completedDate, rangeDates.start, rangeDates.end)) return;
      const key = getCompletedApplicationRecordKey(lease);
      const existing = completedApplications.get(key);
      if (!existing || completedDate < existing.sortDate) {
        completedApplications.set(key, {
          key,
          sortDate: completedDate,
          date: completedDate,
          source: 'lease',
          item: lease
        });
      }
    });

    return Array.from(completedApplications.values());
  }, [eventItems, leaseItems, rangeDates]);

  const approvedLeaseRecords = useMemo(() => {
    const approvedLeases = new Map();

    leaseItems.forEach((lease) => {
      const approvedDate = getLifecycleDate(lease, LEASE_APPROVED_DATE_KEYS);
      if (!isInDateRange(approvedDate, rangeDates.start, rangeDates.end)) return;
      const key = getApprovedLeaseRecordKey(lease);
      const existing = approvedLeases.get(key);
      if (!existing || approvedDate < existing.sortDate) {
        approvedLeases.set(key, {
          key,
          sortDate: approvedDate,
          date: approvedDate,
          item: lease
        });
      }
    });

    return Array.from(approvedLeases.values());
  }, [leaseItems, rangeDates]);

  const totalApplications = completedApplicationRecords.length;
  const totalLeases = approvedLeaseRecords.length;
  const funnelMetricSource = 'Entrata completed applications + approved leases';

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
      return !excludedMarketingSpendKeySet.has(getMarketingSpendExclusionKey(label));
    })
  ), [allMarketingInvoices, excludedMarketingSpendKeySet]);

  const includedPerformanceMarketingInvoices = useMemo(() => (
    performanceMarketingInvoices.filter((invoice) => {
      const label = getInvoiceBreakdownLabel(invoice);
      return !excludedMarketingSpendKeySet.has(getMarketingSpendExclusionKey(label));
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

  // Lead sources breakdown
  const leadSourceBreakdown = useMemo(() => {
    const sources = {};
    allCanonicalLeadItems.forEach(l => {
      const s = l.leadSource || l.internetListingService || 'Unknown';
      sources[s] = (sources[s] || 0) + 1;
    });
    // Sort by count, take top 5
    return Object.entries(sources)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 20) + '…' : name, value }));
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
        excluded: excludedMarketingSpendKeySet.has(getMarketingSpendExclusionKey(label)),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [allMarketingInvoices, excludedMarketingSpendKeySet, rangeDates]);

  const activeMarketingSpendLineCount = useMemo(() => (
    marketingSpendBreakdown.filter((item) => !item.excluded).length
  ), [marketingSpendBreakdown]);

  const specialItems = useMemo(() => {
    return extractSpecialItems(specialsSnapshot);
  }, [specialsSnapshot]);

  const floorplanItems = useMemo(() => {
    return Array.isArray(availabilityPricingSnapshot?.floorplans) ? availabilityPricingSnapshot.floorplans : [];
  }, [availabilityPricingSnapshot]);

  const propertyUnitItems = useMemo(() => {
    return Array.isArray(availabilityPricingSnapshot?.units) ? availabilityPricingSnapshot.units : [];
  }, [availabilityPricingSnapshot]);

  const availabilitySummary = useMemo(() => {
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
  }, [propertyUnitItems, floorplanItems]);

  const floorplanTableRows = useMemo(() => {
    return [...floorplanItems]
      .sort((a, b) => {
        const availableA = Number.parseInt(a?.DisplayedUnitsAvailable || a?.UnitsAvailable || '0', 10) > 0 ? 0 : 1;
        const availableB = Number.parseInt(b?.DisplayedUnitsAvailable || b?.UnitsAvailable || '0', 10) > 0 ? 0 : 1;
        if (availableA !== availableB) return availableA - availableB;
        const priceA = getFloorplanPriceRange(a).min ?? Number.MAX_SAFE_INTEGER;
        const priceB = getFloorplanPriceRange(b).min ?? Number.MAX_SAFE_INTEGER;
        return priceA - priceB;
      })
      .slice(0, 14);
  }, [floorplanItems]);

  const unitTableRows = useMemo(() => {
    if (propertyUnitItems.length > 0) {
      return propertyUnitItems
        .flatMap((unit) => {
          const attrs = unit?.['@attributes'] || {};
          return getPropertyUnitSpaces(unit).map((space, index) => ({
            ...space,
            _unitAttrs: attrs,
            _spaceKey: `${attrs.Id || attrs.UnitNumber || 'unit'}-${space?.['@attributes']?.Id || index}`,
          }));
        })
        .sort((a, b) => {
          const statusA = String(getAvailabilityStatus(a)).toLowerCase();
          const statusB = String(getAvailabilityStatus(b)).toLowerCase();
          const availableA = statusA.includes('available') ? 0 : 1;
          const availableB = statusB.includes('available') ? 0 : 1;
          if (availableA !== availableB) return availableA - availableB;
          const priceA = getPropertyUnitPriceRange(a).min ?? Number.MAX_SAFE_INTEGER;
          const priceB = getPropertyUnitPriceRange(b).min ?? Number.MAX_SAFE_INTEGER;
          return priceA - priceB;
        })
        .slice(0, 14);
    }

    return [];
  }, [propertyUnitItems]);

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
      .map((item) => ({
        ...item,
        roas: item.marketingSpend > 0 ? (item.netEffectiveRevenue / item.marketingSpend) : null
      }))
      .sort((a, b) => b.netEffectiveRevenue - a.netEffectiveRevenue);
  }, [roiDailyItems]);

  // Daily chart data
  const dailyChartData = useMemo(() => {
    const dateMap = {};
    for (
      let cursor = new Date(rangeDates.start.getFullYear(), rangeDates.start.getMonth(), rangeDates.start.getDate());
      cursor <= rangeDates.end;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
    ) {
      const dateKey = formatDateInputValue(cursor);
      dateMap[dateKey] = { date: dateKey, leads: 0, leases: 0, applications: 0 };
    }

    // Count leads per day
    allCanonicalLeadItems.forEach(l => {
      if (l._date && dateMap[l._date]) {
        dateMap[l._date].leads += 1;
      }
    });

    completedApplicationRecords.forEach((record) => {
      const dateKey = record.date ? formatDateInputValue(record.date) : null;
      if (dateKey && dateMap[dateKey]) {
        dateMap[dateKey].applications += 1;
      }
    });

    approvedLeaseRecords.forEach((record) => {
      const dateKey = record.date ? formatDateInputValue(record.date) : null;
      if (dateKey && dateMap[dateKey]) {
        dateMap[dateKey].leases += 1;
      }
    });

    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        label: new Date(d.date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
      }));
  }, [rangeDates, allCanonicalLeadItems, completedApplicationRecords, approvedLeaseRecords]);

  // Conversion rates
  const attributedLeaseCount = roiTotals.attributedLeases;
  const unattributedLeaseCount = roiTotals.unattributedLeases;
  const totalTrackedLeaseCount = attributedLeaseCount + unattributedLeaseCount;
  const leaseConversion = totalLeads > 0 ? ((totalLeases / totalLeads) * 100).toFixed(1) : '0.0';
  const applicationConversion = totalLeads > 0 ? ((totalApplications / totalLeads) * 100).toFixed(1) : '0.0';
  const costPerLead = totalLeads > 0 && totalPerformanceMarketingCost > 0 ? (totalPerformanceMarketingCost / totalLeads).toFixed(2) : '—';
  const costPerLease = totalLeases > 0 && totalPerformanceMarketingCost > 0 ? (totalPerformanceMarketingCost / totalLeases).toFixed(2) : '—';
  const attributionMatchRate = totalTrackedLeaseCount > 0 ? ((attributedLeaseCount / totalTrackedLeaseCount) * 100).toFixed(1) : '0.0';
  const applicationToLeaseConversion = totalApplications > 0 ? ((totalLeases / totalApplications) * 100).toFixed(1) : '0.0';
  const blendedRoi = roiTotals.marketingSpend > 0 ? ((roiTotals.netEffectiveRevenue - roiTotals.marketingSpend) / roiTotals.marketingSpend) : null;
  const blendedRoas = roiTotals.marketingSpend > 0 ? (roiTotals.netEffectiveRevenue / roiTotals.marketingSpend) : null;
  const roiCostPerLease = totalLeases > 0 && roiTotals.marketingSpend > 0 ? (roiTotals.marketingSpend / totalLeases).toFixed(2) : '—';
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
  const analyticsSourceBadge = useMemo(() => {
    if (analyticsUsesRenderAdapter) {
      return { label: 'Data source: Staged Render', className: 'analytics-chip analytics-chip--staged' };
    }
    if (analyticsEndpointsConfigured) {
      return { label: 'Data source: External endpoints', className: 'analytics-chip analytics-chip--fallback' };
    }
    return { label: 'Data source: Endpoint unavailable', className: 'analytics-chip analytics-chip--error' };
  }, [analyticsEndpointsConfigured, analyticsUsesRenderAdapter]);
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
  const websiteManagerContentTokens = useMemo(
    () => getWebsiteManagerFieldTokenDefinitions(websiteManagerDraft.schema),
    [websiteManagerDraft.schema]
  );
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
  const reportingLayoutDirty = useMemo(
    () => JSON.stringify(reportingLayoutDraft) !== JSON.stringify(reportingLayoutDoc),
    [reportingLayoutDraft, reportingLayoutDoc]
  );
  const activeReportingPanels = useMemo(() => {
    const hiddenIds = new Set(reportingLayoutDraft.hiddenPanelIds);
    return reportingLayoutDraft.panelOrder
      .map((panelId) => REPORTING_PANEL_LIBRARY.find((panel) => panel.id === panelId))
      .filter(Boolean)
      .filter((panel) => !hiddenIds.has(panel.id));
  }, [reportingLayoutDraft]);

  const updateWebsiteManagerField = (field, value) => {
    setWebsiteManagerNotice(null);
    setWebsiteManagerError(null);
    setWebsiteManagerDraft((current) => ({
      ...current,
      [field]: value
    }));
  };

  const updateWebsiteManagerContentField = (field, value) => {
    setWebsiteManagerNotice(null);
    setWebsiteManagerError(null);
    setWebsiteManagerDraft((current) => ({
      ...current,
      content: {
        ...current.content,
        [field]: value
      }
    }));
  };

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

  const updateHeatmapLayer = (field, value) => {
    setHeatmapLayersTouched(true);
    setHeatmapLayers((current) => ({
      ...current,
      [field]: value
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
    setWebsiteSchemaDraft((current) => ({
      ...current,
      groups: (() => {
        const nextKey = getUniqueWebsiteSchemaKey(current.groups, `new_group_${current.groups.length + 1}_field`);
        return [
          ...current.groups,
          {
            id: `group_${Date.now()}`,
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

  const runSiteAudit = async () => {
    if (!selectedPropertyId) {
      setHeatmapPanelError('No property is currently available for this account.');
      return;
    }
    if (!SITE_AUDIT_RUN_URL) {
      setHeatmapPanelError('Site audit run endpoint is not configured.');
      return;
    }

    setSiteAuditRunning(true);
    setHeatmapPanelError(null);
    try {
      const params = new URLSearchParams({ property_id: selectedPropertyId });
      if (heatmapSiteDraft.siteKey) params.set('site_key', heatmapSiteDraft.siteKey);
      const response = await authFetch(`${SITE_AUDIT_RUN_URL}?${params.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: selectedPropertyId, siteKey: heatmapSiteDraft.siteKey || undefined }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Site audit run failed: ${response.status}`);
      }
      setSiteAuditSummaryData(payload);
    } catch (error) {
      console.error('Site audit run failed', error);
      setHeatmapPanelError(error.message || 'Unable to run the site audit.');
    } finally {
      setSiteAuditRunning(false);
    }
  };

  const toggleReportingAdminMode = () => {
    if (!canEditReportingLayout) {
      setReportingLayoutError('Your current role can view reports, but cannot change reporting layout.');
      return;
    }
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingAdminEnabled((current) => !current);
  };

  const moveReportingPanel = (panelId, direction) => {
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingLayoutDraft((current) => {
      const currentIndex = current.panelOrder.indexOf(panelId);
      if (currentIndex === -1) return current;
      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.panelOrder.length) return current;
      const nextOrder = [...current.panelOrder];
      const [moved] = nextOrder.splice(currentIndex, 1);
      nextOrder.splice(nextIndex, 0, moved);
      return {
        ...current,
        panelOrder: nextOrder
      };
    });
  };

  const toggleReportingPanelVisibility = (panelId) => {
    setReportingLayoutNotice(null);
    setReportingLayoutError(null);
    setReportingLayoutDraft((current) => {
      const hidden = new Set(current.hiddenPanelIds);
      if (hidden.has(panelId)) hidden.delete(panelId);
      else hidden.add(panelId);
      return {
        ...current,
        hiddenPanelIds: REPORTING_PANEL_IDS.filter((id) => hidden.has(id))
      };
    });
  };

  const resetReportingLayoutDraft = () => {
    setReportingLayoutDraft(reportingLayoutDoc);
    setReportingLayoutNotice('Unsaved reporting layout changes were discarded.');
    setReportingLayoutError(null);
  };

  const saveReportingLayoutDraft = async () => {
    if (!selectedPropertyId) {
      setReportingLayoutError('No property is currently available for this account.');
      return;
    }
    if (!canEditReportingLayout) {
      setReportingLayoutError('Your current role can view reporting, but cannot change panel layout.');
      return;
    }

    setReportingLayoutSaving(true);
    setReportingLayoutError(null);
    setReportingLayoutNotice(null);

    try {
      if (!reportingLayoutUsesStagedAdapter) {
        throw new Error('Reporting layout endpoint is not configured.');
      }
      const normalizedDraft = normalizeReportingLayoutRecord(reportingLayoutDraft);
      const response = await authFetch(REPORTING_LAYOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: selectedPropertyId,
          propertyId: selectedPropertyId,
          propertyName: selectedProperty?.name || '',
          ...normalizedDraft,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.status === 'error') {
        throw new Error(payload?.error || `Reporting layout save failed: ${response.status}`);
      }
      const savedRecord = normalizeReportingLayoutRecord(payload.record);
      setReportingLayoutDoc(savedRecord);
      setReportingLayoutDraft(savedRecord);
      setReportingLayoutNotice('Reporting layout saved for this property.');
    } catch (error) {
      console.error('Reporting layout save failed', error);
      setReportingLayoutError(error.message || 'Unable to save the reporting layout.');
    } finally {
      setReportingLayoutSaving(false);
    }
  };

  const scrollToReportingPanel = (panelId) => {
    const target = document.getElementById(`reporting-panel-${panelId}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const reputationOverview = reputationData?.overview || {};
  const reputationAverageRating = reputationOverview.averageRating ?? null;
  const reputationReviewCount = reputationOverview.reviewCount ?? null;
  const reputationResponseRate = reputationOverview.responseRate ?? null;
  const reputationSentimentScore = reputationOverview.sentimentScore ?? null;
  const reputationRecentReviews = reputationData?.recentReviews || [];
  const reputationSummary = reputationData?.summary || [];
  const reputationWindow = reputationData?.window || null;
  const reputationRawKeys = reputationData?.rawTopLevelKeys || [];

  const ga4AcquisitionChannels = ga4Data?.Acquisition?.channels || [];
  const ga4TopSources = ga4Data?.Acquisition?.topSources || [];
  const ga4TrafficByMonth = ga4Data?.Acquisition?.trafficByMonth || [];
  const ga4TrafficBySessionSource = ga4Data?.Acquisition?.trafficBySessionSource || [];
  const ga4LlmTraffic = ga4Data?.Acquisition?.llmTraffic || [];
  const ga4ConversionEvents = ga4Data?.Conversion?.events || [];
  const ga4LandingPages = ga4Data?.Conversion?.landingPages || [];
  const ga4DeviceBreakdown = ga4Data?.Conversion?.deviceBreakdown || [];
  const ga4ConversionByMedium = ga4Data?.Conversion?.conversionByMedium || [];
  const ga4ConversionsByDay = ga4Data?.Conversion?.conversionsByDay || [];
  const ga4OrganicConversionBreakdown = ga4Data?.Conversion?.organicConversionBreakdown || [];
  const ga4Cities = ga4Data?.Geo?.cities || [];
  const ga4TopPages = ga4Data?.Diagnostic?.topPages || [];
  const ga4ApplyPage = ga4Data?.Diagnostic?.applyPage || null;
  const ga4PathExploration = ga4Data?.Diagnostic?.pathExploration || null;
  const ga4DevicesDetailed = ga4Data?.Diagnostic?.devicesDetailed || [];
  const ga4PagePerformance = ga4Data?.Diagnostic?.pagePerformance || [];
  const ga4CoverageGaps = ga4Data?.CoverageGaps || null;
  const ga4Sessions = ga4Data?.Acquisition?.totals?.current?.sessions ?? null;
  const ga4NewUsers = ga4Data?.Acquisition?.totals?.current?.newUsers ?? null;
  const ga4EventTotal = ga4Data?.Conversion?.totals?.currentEventCount ?? null;
  const ga4OutcomeChartData = useMemo(() => (
    ga4ConversionEvents.map((item) => ({
      name: shortenLabel(item.eventName, 18),
      value: Number(item.current.eventCount || 0),
    }))
  ), [ga4ConversionEvents]);
  const ga4AcquisitionChartData = useMemo(() => (
    ga4AcquisitionChannels.slice(0, 6).map((item) => ({
      name: shortenLabel(item.channel, 16),
      sessions: Number(item.current.sessions || 0),
      engagement: Number(item.current.engagementRate || 0),
    }))
  ), [ga4AcquisitionChannels]);
  const ga4TrafficByMonthChartData = useMemo(() => (
    ga4TrafficByMonth.map((item) => ({
      name: String(item.month || ''),
      sessions: Number(item.sessions || 0),
      newUsers: Number(item.newUsers || 0),
    }))
  ), [ga4TrafficByMonth]);
  const ga4MarketChartData = useMemo(() => (
    ga4Cities.slice(0, 6).map((item) => ({
      name: shortenLabel(item.city || '(not set)', 16),
      users: Number(item.current.totalUsers || 0),
      keyEvents: Number(item.current.keyEvents || 0),
    }))
  ), [ga4Cities]);
  const ga4DiagnosticChartData = useMemo(() => (
    ga4TopPages.slice(0, 6).map((item) => ({
      name: shortenLabel(item.pagePath || '(not set)', 18),
      views: Number(item.current.screenPageViews || 0),
      engagement: Number(item.current.engagementRate || 0),
    }))
  ), [ga4TopPages]);
  const ga4PathStartChartData = useMemo(() => (
    (ga4PathExploration?.startPages || []).slice(0, 5).map((item) => ({
      name: shortenLabel(item.pagePath || '(not set)', 18),
      users: Number(item.activeUsers || 0),
    }))
  ), [ga4PathExploration]);
  const ga4ConversionByDayChartData = useMemo(() => (
    ga4ConversionsByDay.slice(-14).map((item) => ({
      name: String(item.date || '').slice(4, 8),
      keyEvents: Number(item.keyEvents || 0),
      conversionRate: Number(item.conversionRate || 0),
    }))
  ), [ga4ConversionsByDay]);
  const googleAdsOverview = googleAdsData?.Overview?.current || null;
  const googleAdsOverviewDelta = googleAdsData?.Overview?.delta || null;
  const googleAdsCampaigns = googleAdsData?.Campaigns || [];
  const googleAdsKeywords = googleAdsData?.Keywords || [];
  const googleAdsConversionActions = googleAdsData?.ConversionActions?.items || [];
  const googleAdsConversionActionNote = googleAdsData?.ConversionActions?.repeatRateNote || null;
  const googleAdsBrandSplit = googleAdsData?.BrandVsNonBrand || null;
  const googleAdsAds = googleAdsData?.Ads?.topAds || [];
  const googleAdsDailyPerformance = googleAdsData?.Ads?.dailyPerformance || [];
  const googleAdsCoverage = googleAdsData?.Coverage || null;
  const metaAdsOverview = metaAdsData?.Overview?.current || null;
  const metaAdsOverviewDelta = metaAdsData?.Overview?.delta || null;
  const metaAdsCampaigns = metaAdsData?.Campaigns || [];
  const metaAdsAdSets = metaAdsData?.AdSets?.items || [];
  const metaAdsPlacements = metaAdsData?.Placements?.items || [];
  const metaAdsTopAds = metaAdsData?.Ads?.topAds || [];
  const metaAdsDailyPerformance = metaAdsData?.Ads?.dailyPerformance || [];
  const metaAdsCoverage = metaAdsData?.Coverage || null;
  const metaAdsScoping = metaAdsData?.Scoping || null;
  const metaAdsAttribution = metaAdsData?.Attribution || null;
  const metaAdsKeyMetrics = metaAdsOverview?.keyMetrics || {};
  const googleAdsTopAd = googleAdsAds[0] || null;
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
  const localFalconTrends = Array.isArray(localFalconData?.Trends) ? localFalconData.Trends : [];
  const localFalconTrendChartData = useMemo(() => (
    localFalconTrends.map((item) => ({
      name: String(item.label || item.date || '').slice(0, 10),
      arp: Number(item.arp || 0),
      atrp: Number(item.atrp || 0),
      solv: Number(item.solv || 0),
    }))
  ), [localFalconTrends]);
  const localFalconHeatmapUrl = localFalconOverview?.heatmap || localFalconLatestReport?.heatmap || localFalconLatestScan?.raw?.heatmap;
  const localFalconReportUrl = localFalconLatestReport?.publicUrl || localFalconOverview?.publicUrl || localFalconLatestScan?.raw?.public_url;
  const localFalconPdfUrl = localFalconLatestReport?.pdf || localFalconOverview?.pdf || localFalconLatestScan?.raw?.pdf;
  const heatmapTotals = heatmapSummaryData?.totals || {};
  const heatmapPoints = useMemo(() => (
    (heatmapSummaryData?.points || [])
      .filter((point) => !point.deviceType || point.deviceType === selectedHeatmapDevice)
  ), [heatmapSummaryData, selectedHeatmapDevice]);
  const heatmapCoordinateDiagnostics = useMemo(() => {
    const allPoints = Array.isArray(heatmapSummaryData?.points) ? heatmapSummaryData.points : [];
    const selectedDevicePoints = allPoints.filter((point) => !point.deviceType || point.deviceType === selectedHeatmapDevice);
    const deviceMismatchCount = allPoints.length - selectedDevicePoints.length;
    const parseCoordinate = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const hasRendererCoordinate = (point) => {
      const xPct = parseCoordinate(point.xPct);
      const yPct = parseCoordinate(point.yPct);
      if (xPct === null || yPct === null) return false;
      if (xPct <= 0.001 && yPct <= 0.001 && !point.targetLabel && !point.targetHref) return false;
      return true;
    };
    const coordinateCount = selectedDevicePoints.filter((point) => point.xPct != null || point.yPct != null).length;
    const rendererAcceptedCount = selectedDevicePoints.filter(hasRendererCoordinate).length;
    return {
      rawEvents: Number(heatmapTotals.events || 0),
      withCoordinates: coordinateCount,
      rejectedFromRenderer: Math.max(0, coordinateCount - rendererAcceptedCount),
      deviceMismatch: Math.max(0, deviceMismatchCount),
    };
  }, [heatmapSummaryData, selectedHeatmapDevice, heatmapTotals.events]);
  useEffect(() => {
    setHeatmapLayersTouched(false);
  }, [rangeDates, selectedHeatmapDevice, selectedHeatmapPath, selectedPropertyId]);
  useEffect(() => {
    if (heatmapLayersTouched || heatmapSummaryLoading || !heatmapSummaryData) return;
    const clickCount = Number(heatmapTotals.clicks || 0) + Number(heatmapTotals.ctaClicks || 0);
    const scrollCount = Number(heatmapTotals.scrolls || 0);
    const maxScrollDepth = Number(heatmapTotals.maxScrollDepthPct || 0);
    if (clickCount > 0) {
      setHeatmapLayers({ click: true, cursor: false, scroll: false, engagement: false });
      return;
    }
    if (scrollCount > 0 || maxScrollDepth > 0) {
      setHeatmapLayers({ click: false, cursor: false, scroll: true, engagement: false });
      return;
    }
    setHeatmapLayers({ click: false, cursor: false, scroll: false, engagement: false });
  }, [heatmapLayersTouched, heatmapSummaryData, heatmapSummaryLoading, heatmapTotals.clicks, heatmapTotals.ctaClicks, heatmapTotals.scrolls, heatmapTotals.maxScrollDepthPct]);
  const heatmapClickAnomalies = useMemo(() => {
    const clickPoints = heatmapPoints.filter((point) => point.type === 'click');
    const deadClicks = clickPoints.filter((point) => !point.targetHref && !point.targetLabel).length;
    const clusterMap = new Map();
    clickPoints.forEach((point) => {
      const x = Math.round(Number(point.xPct || 0) * 25);
      const y = Math.round(Number(point.yPct || 0) * 25);
      const key = `${point.sessionKey || 'unknown'}:${point.targetLabel || point.targetId || point.targetTag || 'unknown'}:${x}:${y}`;
      clusterMap.set(key, (clusterMap.get(key) || 0) + 1);
    });
    const rageClusters = Array.from(clusterMap.values()).filter((count) => count >= 3).length;
    return { deadClicks, rageClusters };
  }, [heatmapPoints]);
  const heatmapTopTargets = heatmapSummaryData?.topTargets || [];
  const latestAudit = siteAuditSummaryData?.audit || null;
  const auditPageResult = useMemo(() => {
    const pages = Array.isArray(latestAudit?.pages) ? latestAudit.pages : [];
    return pages.find((page) => (page.path || '/') === selectedHeatmapPath) || pages[0] || null;
  }, [latestAudit, selectedHeatmapPath]);
  const auditIssues = auditPageResult?.issues || latestAudit?.issues || [];
  const auditRecommendations = auditPageResult?.recommendations || latestAudit?.recommendations || [];
  const auditStaleDates = auditPageResult?.staleDateStrings || latestAudit?.stale_date_findings || latestAudit?.staleDateFindings || [];
  const auditBrokenLinks = auditPageResult?.suspiciousLinks || latestAudit?.broken_links || latestAudit?.brokenLinks || [];
  const auditCategoryScores = useMemo(() => {
    const rawCategories = latestAudit?.raw_data?.categoryScores || latestAudit?.rawData?.categoryScores;
    if (Array.isArray(rawCategories) && rawCategories.length) return rawCategories;
    const pageCategories = auditPageResult?.categoryScores;
    if (pageCategories && typeof pageCategories === 'object') {
      const labels = {
        seoBasics: 'SEO basics',
        ctaClarity: 'CTA clarity',
        staleDates: 'Stale dates',
        internalLinks: 'Internal links',
        pageStructure: 'Page structure',
        performanceProxy: 'Performance proxy',
      };
      return Object.entries(labels).map(([key, label]) => ({
        key,
        label,
        score: pageCategories[key],
      })).filter((item) => item.score != null);
    }
    return [
      { key: 'ctaClarity', label: 'CTA clarity', score: latestAudit?.urgency_score },
      { key: 'staleDates', label: 'Stale dates', score: latestAudit?.freshness_score },
      { key: 'internalLinks', label: 'Internal links', score: latestAudit?.link_score },
    ].filter((item) => item.score != null);
  }, [latestAudit, auditPageResult]);
  const lastTrackerEventAt = useMemo(() => {
    const latestPoint = heatmapPoints
      .map((point) => point.occurredAt)
      .filter(Boolean)
      .sort()
      .pop();
    return latestPoint || selectedAuditPage?.lastSeenAt || '';
  }, [heatmapPoints, selectedAuditPage]);
  const selectedPortfolioAudit = useMemo(
    () => portfolioAuditProperties.find((property) => property.propertyId === selectedPropertyId) || portfolioAuditProperties[0] || null,
    [portfolioAuditProperties, selectedPropertyId]
  );
  const portfolioAuditSummary = useMemo(() => {
    const totalProperties = portfolioAuditProperties.length;
    const missingAudits = portfolioAuditProperties.filter((property) => !property.hasAudit).length;
    const urgentProperties = portfolioAuditProperties.filter((property) => Number(property.performanceScore ?? 101) < 70).length;
    const brokenLinkProperties = portfolioAuditProperties.filter((property) => Number(property.brokenLinkCount || 0) > 0).length;
    const staleDateProperties = portfolioAuditProperties.filter((property) => Number(property.staleDateCount || 0) > 0).length;
    return {
      totalProperties,
      missingAudits,
      urgentProperties,
      brokenLinkProperties,
      staleDateProperties,
    };
  }, [portfolioAuditProperties]);
  const reportingPanelSummaries = useMemo(() => ({
    executive: `${formatCurrency(roiTotals.netEffectiveRevenue)} net revenue | ${formatCurrency(totalBlendedMarketingSpend)} spend`,
    roi: blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}% ROI | ${blendedRoas != null ? `${blendedRoas.toFixed(2)}x ROAS` : 'ROAS pending'}` : 'Waiting on spend and revenue data',
    budget: `${activeMarketingSpendLineCount} active spend lines | ${formatCurrency(totalPerformanceMarketingCost)} paid media`,
    entrata: `${totalLeads} leads | ${totalApplications} apps | ${totalLeases} leases`,
    'google-ads': googleAdsLoading ? 'Loading paid search metrics' : googleAdsStatusMessage ? 'Google Ads connection needs attention' : `${formatNumber(googleAdsOverview?.clicks)} clicks | ${formatCurrency(googleAdsOverview?.cost)} spend`,
    ga4: ga4Loading ? 'Loading analytics metrics' : ga4Blocked ? 'GA4 access required' : `${formatNumber(ga4Sessions)} sessions | ${formatNumber(ga4EventTotal)} tracked events`,
    opiniion: reputationLoading ? 'Loading reputation metrics' : `${formatNumber(reputationReviewCount)} reviews | ${formatNumber(reputationAverageRating, 2)} avg rating`,
    'local-falcon': localFalconLoading ? 'Loading local SEO metrics' : localFalconStatusMessage ? 'Local Falcon mapping needed' : `${formatNumber(localFalconOverview?.avgSolv, 2)} SoLV | ${formatNumber(localFalconOverview?.scanCount)} scans`,
    'meta-ads': metaAdsLoading ? 'Loading paid social metrics' : `${formatNumber(metaAdsOverview?.clicks)} clicks | ${formatCurrency(metaAdsOverview?.spend)} spend`,
    'heatmaps-audit': heatmapSummaryLoading ? 'Loading website experience data' : `${formatNumber(heatmapTotals.sessions)} sessions | ${formatNumber(heatmapTotals.clicks)} clicks`
  }), [
    blendedRoi,
    blendedRoas,
    ga4Blocked,
    ga4EventTotal,
    ga4Loading,
    ga4Sessions,
    googleAdsLoading,
    googleAdsOverview,
    googleAdsStatusMessage,
    localFalconLoading,
    localFalconOverview,
    localFalconStatusMessage,
    activeMarketingSpendLineCount,
    metaAdsLoading,
    metaAdsOverview,
    heatmapSummaryLoading,
    heatmapTotals.clicks,
    heatmapTotals.sessions,
    reputationAverageRating,
    reputationLoading,
    reputationReviewCount,
    roiTotals.netEffectiveRevenue,
    totalApplications,
    totalBlendedMarketingSpend,
    totalLeads,
    totalLeases,
    totalPerformanceMarketingCost
  ]);
  const googleAdsCampaignChartData = useMemo(() => (
    googleAdsCampaigns.slice(0, 6).map((item) => ({
      name: shortenLabel(item.campaignName, 18),
      clicks: Number(item.current?.clicks || 0),
      conversions: Number(item.current?.conversions || 0),
    }))
  ), [googleAdsCampaigns]);
  const googleAdsDailyChartData = useMemo(() => (
    googleAdsDailyPerformance.slice(-14).map((item) => ({
      name: String(item.date || '').slice(5),
      clicks: Number(item.clicks || 0),
      cost: Number(item.cost || 0),
      conversions: Number(item.conversions || 0),
    }))
  ), [googleAdsDailyPerformance]);
  const googleAdsKeywordChartData = useMemo(() => (
    googleAdsKeywords.slice(0, 6).map((item) => ({
      name: shortenLabel(item.keywordText, 18),
      clicks: Number(item.clicks || 0),
      cost: Number(item.cost || 0),
    }))
  ), [googleAdsKeywords]);
  const metaAdsCampaignChartData = useMemo(() => (
    metaAdsCampaigns.slice(0, 6).map((item) => ({
      name: shortenLabel(item.campaignName, 18),
      spend: Number(item.current?.spend || 0),
      clicks: Number(item.current?.clicks || 0),
    }))
  ), [metaAdsCampaigns]);
  const metaAdsDailyChartData = useMemo(() => (
    metaAdsDailyPerformance.slice(-14).map((item) => ({
      name: String(item.date || '').slice(5),
      spend: Number(item.spend || 0),
      clicks: Number(item.clicks || 0),
    }))
  ), [metaAdsDailyPerformance]);
  const metaAdsTopPreview = metaAdsTopAds[0] || null;
  const showLoader = loading || invoiceLoading || roiLoading;

  const renderPropertyInfo = () => (
    <div className="property-info-view">
      <div className="property-info-hero">
        <div>
          <div className="property-info-kicker">Entrata Property Info</div>
          <div className="property-info-headline">{selectedPropertyLabel}</div>
          <div className="property-info-subhead">
            Current specials plus the newest availability snapshot in the selected window, paired with the live lead, application, lease, and cost metrics already flowing into the dashboard.
          </div>
        </div>
        <div className="property-info-pill-row">
          <div className="property-info-pill">Entrata ID {selectedPropertyId}</div>
          <div className="property-info-pill">Specials synced {formatNumber(specialItems.length)}</div>
          <div className="property-info-pill">
            Availability snapshot {latestAvailabilityDate ? formatReadableDate(latestAvailabilityDate) : 'Not loaded'}
          </div>
        </div>
      </div>

      <div className="property-info-grid">
        <div className="property-info-card">
          <div className="property-info-card__label">Current Specials</div>
          <div className="property-info-card__value">{propertyInfoLoading ? '…' : formatNumber(specialItems.length)}</div>
          <div className="property-info-card__meta">
            Last synced {getSnapshotTimestampLabel(specialsSnapshot?.last_synced_at)}
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Available Units</div>
          <div className="property-info-card__value">{propertyInfoLoading ? '…' : formatNumber(availabilitySummary.availableCount)}</div>
          <div className="property-info-card__meta">
            {formatNumber(availabilitySummary.unitCount)} units across {formatNumber(availabilitySummary.floorplanCount)} floorplans
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Price Range</div>
          <div className="property-info-card__value">
            {propertyInfoLoading ? '…' : availabilitySummary.minPrice != null ? `${formatCurrency(availabilitySummary.minPrice)} - ${formatCurrency(availabilitySummary.maxPrice)}` : 'No pricing'}
          </div>
          <div className="property-info-card__meta">
            Next available {availabilitySummary.nextAvailableDate ? formatReadableDate(availabilitySummary.nextAvailableDate) : '—'}
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Funnel Snapshot</div>
          <div className="property-info-card__value">{loading ? '…' : `${formatNumber(totalLeads)} / ${formatNumber(totalApplications)} / ${formatNumber(totalLeases)}`}</div>
          <div className="property-info-card__meta">Leads / apps / leases in selected range</div>
        </div>
      </div>

      <div className="property-info-panels">
        <div className="property-info-panel property-info-panel--specials">
          <div className="property-info-panel__eyebrow">Specials</div>
          <div className="property-info-panel__title">Current leasing offers</div>
          <div className="property-info-panel__subhead">
            Stored from the daily `getSpecials` sync and only rewritten when the payload changes.
          </div>
          {propertyInfoLoading ? (
            <div className="property-info-empty">Loading specials…</div>
          ) : specialItems.length === 0 ? (
            <div className="property-info-empty">No specials are stored for this property yet.</div>
          ) : (
            <div className="property-info-list">
              {specialItems.map((special, index) => {
                const title = getSpecialTitle(special);
                const description = getSpecialDescription(special);
                const dateRange = getSpecialDateRange(special);

                return (
                  <div key={`${title}-${index}`} className="property-info-list__item">
                    <div className="property-info-list__title">{title}</div>
                    <div className="property-info-list__meta"><strong>Description:</strong> {description || 'No description provided'}</div>
                    <div className="property-info-list__meta"><strong>Active:</strong> {dateRange}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="property-info-panel property-info-panel--units">
          <div className="property-info-panel__eyebrow">Pricing + Availability</div>
          <div className="property-info-panel__title">Latest unit snapshot</div>
          <div className="property-info-panel__subhead">
            Stored from the dedicated `getUnitsAvailabilityAndPricing` availability/pricing snapshot.
          </div>
          {floorplanTableRows.length > 0 && (
            <div className="property-info-table">
              <div className="property-info-table__head">Floorplan</div>
              <div className="property-info-table__head">Beds/Baths</div>
              <div className="property-info-table__head">Units</div>
              <div className="property-info-table__head">Available</div>
              <div className="property-info-table__head">Rent Range</div>
              {floorplanTableRows.map((floorplan, index) => {
                const price = getFloorplanPriceRange(floorplan);
                const deposit = getFloorplanDepositRange(floorplan);
                return (
                  <React.Fragment key={`${floorplan?.Identification?.IDValue || floorplan?.Name || index}`}>
                    <div className="property-info-table__cell">
                      {floorplan?.Name || '—'}
                      {deposit.min != null ? ` · Deposit ${formatCurrency(deposit.min)}` : ''}
                    </div>
                    <div className="property-info-table__cell">
                      {getRoomCount(floorplan?.Room, 'Bedroom') || '—'} / {getRoomCount(floorplan?.Room, 'Bathroom') || '—'}
                    </div>
                    <div className="property-info-table__cell">{floorplan?.UnitCount || '—'}</div>
                    <div className="property-info-table__cell">{floorplan?.DisplayedUnitsAvailable || floorplan?.UnitsAvailable || '0'}</div>
                    <div className="property-info-table__cell">
                      {price.min != null ? `${formatCurrency(price.min)} - ${formatCurrency(price.max ?? price.min)}` : '—'}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {propertyInfoLoading ? (
            <div className="property-info-empty">Loading availability…</div>
          ) : unitTableRows.length === 0 ? (
            <div className="property-info-empty">No availability snapshot is stored for this property yet.</div>
          ) : (
            <div className="property-info-table">
              <div className="property-info-table__head">Unit</div>
              <div className="property-info-table__head">Floorplan</div>
              <div className="property-info-table__head">Beds/Baths</div>
              <div className="property-info-table__head">Price</div>
              <div className="property-info-table__head">Status</div>
              {unitTableRows.map((unit, index) => (
                <React.Fragment key={unit._spaceKey || `${unit.unitId || unit.unitNumber || index}`}>
                  <div className="property-info-table__cell">
                    {unit._unitAttrs?.UnitNumber || unit?.['@attributes']?.MarketingUnitNumber || unit.unitNumber || unit.name || unit.unitId || '—'}
                  </div>
                  <div className="property-info-table__cell">
                    {unit._unitAttrs?.FloorPlanName || unit.floorplanName || unit.floorPlanName || unit.floorplan || '—'}
                  </div>
                  <div className="property-info-table__cell">
                    {unit._unitAttrs?.OccupancyType || unit.bedCount || unit.beds || '—'} / {unit.bathCount || unit.baths || '—'}
                  </div>
                  <div className="property-info-table__cell">
                    {(() => {
                      const range = getPropertyUnitPriceRange(unit);
                      return range.min != null ? `${formatCurrency(range.min)} - ${formatCurrency(range.max ?? range.min)}` : '—';
                    })()}
                  </div>
                  <div className="property-info-table__cell">
                    {getAvailabilityStatus(unit)}
                    {getAvailabilityDate(unit) ? ` · ${formatReadableDate(getAvailabilityDate(unit))}` : ''}
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );

  const formatPipelineTimestamp = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
  };

  const renderPipelineStatusCard = (title, status) => {
    const progress = status?.progress || {};
    const phase = status?.phase || 'unknown';
    const isComplete = Boolean(status?.completed);
    const isActive = Boolean(status?.active);

    const progressRows = [];
    if (progress.raw_days_total) {
      progressRows.push(`Raw days: ${progress.raw_days_processed}/${progress.raw_days_total}`);
    }
    if (progress.attribution_properties_total) {
      progressRows.push(`Attribution props: ${progress.attribution_properties_processed}/${progress.attribution_properties_total}`);
    }
    if (progress.aggregate_properties_total) {
      progressRows.push(`Aggregate props: ${progress.aggregate_properties_processed}/${progress.aggregate_properties_total}`);
    }

    return (
      <div className="card span-2" style={{ background: 'var(--panel-soft)', color: 'var(--white)' }}>
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>{title}</div>
        {roiPipelineStatusLoading ? (
          <div style={{ marginTop: '1rem', opacity: 0.6 }}>Loading pipeline status…</div>
        ) : !status ? (
          <div style={{ marginTop: '1rem', opacity: 0.6 }}>No pipeline status available.</div>
        ) : (
          <div style={{ marginTop: '0.85rem', display: 'grid', gap: '0.45rem', fontSize: '0.88rem' }}>
            <div><strong>Status:</strong> {isComplete ? 'Completed' : isActive ? 'Active' : 'Idle'}</div>
            <div><strong>Phase:</strong> {phase}</div>
            <div><strong>Window:</strong> {status.report_start_date || '—'} to {status.report_end_date || '—'}</div>
            <div><strong>Last update:</strong> {formatPipelineTimestamp(status.last_processed_at)}</div>
            {progressRows.map((row) => (
              <div key={row}>{row}</div>
            ))}
            <div style={{ opacity: 0.75 }}><strong>Summary:</strong> {status.last_summary || '—'}</div>
          </div>
        )}
      </div>
    );
  };

  const renderGa4SectionFallback = (label) => (
    <div className="analytics-placeholder">
      <div className="analytics-placeholder__title">{label} is waiting on GA4 access</div>
      <div className="analytics-placeholder__detail">
        {ga4StatusMessage || 'This section will populate once live GA4 reporting is available for the selected property.'}
      </div>
    </div>
  );

  const renderAnalytics = () => (
    <div className="analytics-view">
      <div className="analytics-hero">
        <div className="analytics-hero__top">
          <div>
            <div className="analytics-kicker">Behavioral Intelligence Layer</div>
            <div className="analytics-headline">Analytics</div>
            <div className="analytics-subhead">
              Use this layer to understand traffic quality, conversion intent, geographic pull, and where users hesitate before they become leads or applications.
            </div>
          </div>
          <div className="analytics-chip-row">
            <div className="analytics-chip">{selectedPropertyLabel}</div>
            <div className="analytics-chip">
              {selectedProperty?.googleAnalyticsId ? `GA4 ${selectedProperty.googleAnalyticsId}` : 'GA4 ID missing'}
            </div>
            <div className="analytics-chip">
              {selectedProperty?.googleAdsId ? `Google Ads ${selectedProperty.googleAdsId}` : 'Google Ads ID missing'}
            </div>
            <div className="analytics-chip">
              {rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}
            </div>
            <div className={analyticsSourceBadge.className}>{analyticsSourceBadge.label}</div>
          </div>
        </div>

        <div className="analytics-kpis">
          <div className="analytics-kpi">
            <div className="analytics-kpi__label">Sessions</div>
            <div className="analytics-kpi__value">{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4Sessions)}</div>
            <div className="analytics-kpi__meta">{ga4Blocked ? 'GA4 access required for this property' : 'Current period traffic volume'}</div>
          </div>
          <div className="analytics-kpi">
            <div className="analytics-kpi__label">New Users</div>
            <div className="analytics-kpi__value">{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4NewUsers)}</div>
            <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'Fresh demand entering the funnel'}</div>
          </div>
          <div className="analytics-kpi">
            <div className="analytics-kpi__label">Tracked Events</div>
            <div className="analytics-kpi__value">{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4EventTotal)}</div>
            <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'High-intent actions across the site'}</div>
          </div>
          <div className="analytics-kpi">
            <div className="analytics-kpi__label">Apply Drop-off</div>
            <div className="analytics-kpi__value">{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatPercent(ga4ApplyPage?.abandonmentRate, 0)}</div>
            <div className="analytics-kpi__meta">{ga4Blocked ? 'Pending GA4 property access' : 'Proxy for friction on the apply flow'}</div>
          </div>
        </div>
      </div>

      <div className="analytics-grid">
      {ga4Blocked && (
        <div className="analytics-status analytics-status--warning" style={{ gridColumn: 'span 4' }}>
          <div className="analytics-status__title">GA4 access status</div>
          <div className="analytics-status__detail">{ga4StatusMessage}</div>
        </div>
      )}
      <div className="analytics-panel analytics-panel--dark" style={{ gridColumn: 'span 2' }}>
        <div className="analytics-panel__eyebrow">Outcome View</div>
        <div className="analytics-panel__title">What users actually did</div>
        <div className="analytics-panel__subhead">
          Focus on the actions that indicate real leasing intent, plus the entry pages and devices that triggered them.
        </div>
        {ga4Loading ? (
          <div className="analytics-note">Loading conversion analytics…</div>
        ) : ga4Blocked ? (
          renderGa4SectionFallback('Outcome view')
        ) : (
          <div className="analytics-stack">
            {ga4OutcomeChartData.length > 0 && (
              <MeasuredChart className="analytics-chart">
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={ga4OutcomeChartData} margin={CHART_MARGIN_STANDARD}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                    <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar dataKey="value" fill={CHART_COLOR_GOLD} radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </MeasuredChart>
            )}
            {ga4ConversionByDayChartData.length > 0 && (
              <MeasuredChart className="analytics-chart">
                {({ width, height }) => (
                  <LineChart width={width} height={height} data={ga4ConversionByDayChartData} margin={CHART_MARGIN_STANDARD}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis yAxisId="left" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar yAxisId="left" dataKey="keyEvents" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="conversionRate" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_SECONDARY_TAN }} />
                  </LineChart>
                )}
              </MeasuredChart>
            )}
            {ga4ConversionEvents.map((item) => (
              <div key={item.eventName} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">{item.eventName}</div>
                  <div className="analytics-row__detail">High-intent action volume in the selected window.</div>
                </div>
                <div style={{ display: 'grid', gap: '0.4rem', justifyItems: 'end' }}>
                  <div className="analytics-row__metric">{formatNumber(item.current.eventCount)} current</div>
                  <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.eventCount)}`}>
                    {formatSignedPercent(item.delta.eventCount, 1)} vs prior
                  </div>
                </div>
              </div>
            ))}
            {ga4LandingPages.slice(0, 3).map((item) => (
              <div key={item.landingPagePlusQueryString || '(not set)'} className="analytics-row">
                <div className="analytics-row__title">{item.landingPagePlusQueryString || '(not set)'}</div>
                <div className="analytics-row__detail">
                  Top landing page by tracked conversion actions with {formatNumber(item.current.eventCount)} event-driven conversions.
                </div>
              </div>
            ))}
            {ga4DeviceBreakdown.length > 0 && (
              <div className="analytics-row">
                <div className="analytics-row__title">Device conversion mix</div>
                <div className="analytics-row__detail">
                  {ga4DeviceBreakdown.map((item) => `${item.deviceCategory} ${formatNumber(item.current.eventCount)}`).join(' | ')}
                </div>
              </div>
            )}
            {ga4ConversionByMedium.slice(0, 4).map((item) => (
              <div key={item.firstUserMedium} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">First user medium: {item.firstUserMedium}</div>
                  <div className="analytics-row__detail">{formatNumber(item.keyEvents)} key events across {formatNumber(item.totalUsers)} users</div>
                </div>
                <div className="analytics-row__metric">{formatPercent(item.conversionRate, 1)}</div>
              </div>
            ))}
            {ga4OrganicConversionBreakdown.slice(0, 5).map((item) => (
              <div key={item.eventName} className="analytics-row analytics-row--split">
                <div className="analytics-row__title">Organic event: {item.eventName}</div>
                <div className="analytics-row__metric">{formatNumber(item.eventCount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="analytics-panel analytics-panel--dark" style={{ gridColumn: 'span 2' }}>
        <div className="analytics-panel__eyebrow">Acquisition View</div>
        <div className="analytics-panel__title">Is the traffic quality right?</div>
        <div className="analytics-panel__subhead">
          Compare channels by volume, freshness, and engagement so the team can tell whether demand is merely arriving or actually paying attention.
        </div>
        {ga4Loading ? (
          <div className="analytics-note">Loading acquisition analytics…</div>
        ) : ga4Blocked ? (
          renderGa4SectionFallback('Acquisition view')
        ) : (
          <div className="analytics-stack">
            {ga4AcquisitionChartData.length > 0 && (
              <MeasuredChart className="analytics-chart analytics-chart--tall">
                {({ width, height }) => (
                  <LineChart width={width} height={height} data={ga4AcquisitionChartData} margin={CHART_MARGIN_TALL}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                    <YAxis yAxisId="left" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar yAxisId="left" dataKey="sessions" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="engagement" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_SECONDARY_TAN }} />
                  </LineChart>
                )}
              </MeasuredChart>
            )}
            {ga4TrafficByMonthChartData.length > 0 && (
              <MeasuredChart className="analytics-chart">
                {({ width, height }) => (
                  <AreaChart width={width} height={height} data={ga4TrafficByMonthChartData} margin={CHART_MARGIN_STANDARD}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Area type="monotone" dataKey="sessions" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} strokeWidth={2} />
                    <Line type="monotone" dataKey="newUsers" stroke={CHART_COLOR_SECONDARY_TAN} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_SECONDARY_TAN }} />
                  </AreaChart>
                )}
              </MeasuredChart>
            )}
            {ga4AcquisitionChannels.slice(0, 6).map((item) => (
              <div key={item.channel} className="analytics-row analytics-row--triple">
                <div>
                  <div className="analytics-row__title">{item.channel}</div>
                  <div className="analytics-row__detail">{formatNumber(item.current.newUsers)} new users</div>
                </div>
                <div className="analytics-row__metric">{formatNumber(item.current.sessions)} sessions</div>
                <div style={{ display: 'grid', gap: '0.35rem', justifyItems: 'end' }}>
                  <div className="analytics-row__metric">{formatPercent(item.current.engagementRate, 1)} engaged</div>
                  <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.sessions)}`}>
                    {formatSignedPercent(item.delta.sessions, 1)}
                  </div>
                </div>
              </div>
            ))}
            {ga4TopSources.slice(0, 4).map((item) => (
              <div key={`${item.sessionSource}-${item.sessionMedium}`} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">{item.sessionSource} / {item.sessionMedium}</div>
                  <div className="analytics-row__detail">
                    {formatNumber(item.current.screenPageViews)} views | {formatPercent(item.current.engagementRate, 1)} engagement | {formatPercent(item.conversionRate, 1)} conversion rate
                  </div>
                </div>
                <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.sessions)}`}>
                  {formatSignedPercent(item.delta.sessions, 1)}
                </div>
              </div>
            ))}
            {ga4LlmTraffic.length > 0 && (
              <div className="analytics-row">
                <div className="analytics-row__title">LLM traffic</div>
                <div className="analytics-row__detail">
                  {ga4LlmTraffic.map((item) => `${item.dimensions?.sessionSource || '(not set)'} ${formatNumber(item.metrics?.sessions || 0)} sessions`).join(' | ')}
                </div>
              </div>
            )}
            {ga4TrafficBySessionSource.length > 0 && (
              <div className="analytics-row">
                <div className="analytics-row__title">Organic traffic by search source</div>
                <div className="analytics-row__detail">
                  {ga4TrafficBySessionSource.slice(0, 5).map((item) => `${item.sessionSource} ${formatNumber(item.sessions)}`).join(' | ')}
                </div>
              </div>
            )}
            <div className="analytics-note">
              Search Console query-level intent is the next recommended feed for branded vs generic search analysis.
            </div>
          </div>
        )}
      </div>

      <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 2' }}>
        <div className="analytics-panel__eyebrow">Market View</div>
        <div className="analytics-panel__title">Where demand is pulling from</div>
        <div className="analytics-panel__subhead">
          Geographic concentration helps regional teams spot relocation corridors, neighboring-city lift, and out-of-market curiosity worth acting on.
        </div>
        {ga4Loading ? (
          <div className="analytics-note">Loading market analytics…</div>
        ) : ga4Blocked ? (
          renderGa4SectionFallback('Market view')
        ) : (
          <div className="analytics-stack">
            {ga4MarketChartData.length > 0 && (
              <MeasuredChart className="analytics-chart analytics-chart--tall">
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={ga4MarketChartData} margin={CHART_MARGIN_TALL}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Bar dataKey="users" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                    <Bar dataKey="keyEvents" fill={CHART_COLOR_ORANGE} radius={[6, 6, 0, 0]} />
                  </BarChart>
                )}
              </MeasuredChart>
            )}
            {ga4Cities.slice(0, 8).map((item) => (
              <div key={item.city || '(not set)'} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">{item.city || '(not set)'}</div>
                  <div className="analytics-row__detail">
                    <span className={`analytics-pill analytics-pill--${getDeltaTone(item.delta.totalUsers)}`}>
                      {formatSignedPercent(item.delta.totalUsers, 1)} users vs prior
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                  <div className="analytics-row__metric">{formatNumber(item.current.totalUsers)} users</div>
                  <div className="analytics-row__detail">{formatNumber(item.current.keyEvents)} key events</div>
                </div>
              </div>
            ))}
            <div className="analytics-note">
              GBP rank, share of local voice, and map heatmap pins can slot into this section next.
            </div>
          </div>
        )}
      </div>

      <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 2' }}>
        <div className="analytics-panel__eyebrow">Diagnostics View</div>
        <div className="analytics-panel__title">Where users hesitate or leave</div>
        <div className="analytics-panel__subhead">
          This is the friction layer: apply-flow weakness, engagement drop-offs, and the pages that deserve UX or messaging attention.
        </div>
        {ga4Loading ? (
          <div className="analytics-note">Loading drop-off diagnostics…</div>
        ) : ga4Blocked ? (
          renderGa4SectionFallback('Diagnostics view')
        ) : (
          <div className="analytics-stack">
            <div className="analytics-callout">
              <div className="analytics-panel__eyebrow">Apply Page</div>
              <div className="analytics-callout__value">{formatPercent(ga4ApplyPage?.abandonmentRate, 0)}</div>
              <div className="analytics-row__detail">
                {formatNumber(ga4ApplyPage?.currentViews)} views | {formatNumber(ga4ApplyPage?.applicationSubmittedEvents)} submitted events
              </div>
            </div>
            {ga4PathExploration && (
              <div className="analytics-path-module">
                <div className="analytics-panel__eyebrow">GA4 Path Exploration</div>
                <div className="analytics-row__detail">
                  Starting at <strong>{ga4PathExploration.startingPoint}</strong> across {formatNumber(ga4PathExploration.startingUsers)} tracked starts.
                </div>
                {ga4PathStartChartData.length > 0 && (
                  <MeasuredChart className="analytics-chart">
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={ga4PathStartChartData} margin={CHART_MARGIN_STANDARD}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                        <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                        <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                        <Bar dataKey="users" fill={CHART_COLOR_GREEN} radius={[6, 6, 0, 0]} />
                      </BarChart>
                    )}
                  </MeasuredChart>
                )}
                <div className="analytics-path-branches">
                  {(ga4PathExploration.branches || []).slice(0, 4).map((branch) => (
                    <div key={branch.entryPage} className="analytics-path-branch">
                      <div className="analytics-path-branch__head">
                        <div>
                          <div className="analytics-row__title">{branch.entryPage || '(not set)'}</div>
                          <div className="analytics-row__detail">
                            {formatNumber(branch.entryUsers)} starts | {formatPercent(branch.shareOfStarts, 1)} of total starts
                          </div>
                        </div>
                        <div className="analytics-pill analytics-pill--neutral">
                          {formatPercent(branch.shownContinuationRate, 0)} shown continuation
                        </div>
                      </div>
                      <div className="analytics-path-list">
                        {(branch.nextSteps || []).slice(0, 4).map((step) => (
                          <div key={`${branch.entryPage}-${step.pagePath}`} className="analytics-path-step">
                            <div className="analytics-path-step__meta">
                              <span className="analytics-row__title">{step.pagePath || '(not set)'}</span>
                              <span className="analytics-row__metric">{formatNumber(step.activeUsers)}</span>
                            </div>
                            <div className="analytics-path-step__bar">
                              <span style={{ width: `${Math.max(6, Math.round((step.shareOfParent || 0) * 100))}%` }} />
                            </div>
                            <div className="analytics-row__detail">{formatPercent(step.shareOfParent, 1)} of this branch</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {ga4PathExploration.note && <div className="analytics-note">{ga4PathExploration.note}</div>}
              </div>
            )}
            {ga4DiagnosticChartData.length > 0 && (
              <MeasuredChart className="analytics-chart analytics-chart--tall">
                {({ width, height }) => (
                  <AreaChart width={width} height={height} data={ga4DiagnosticChartData} margin={CHART_MARGIN_TALL}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                    <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} interval={0} />
                    <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                    <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} tickFormatter={(value) => `${Math.round(value * 100)}%`} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Area yAxisId="left" type="monotone" dataKey="views" stroke={CHART_COLOR_GOLD} fill={CHART_COLOR_GOLD} fillOpacity={0.14} strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="engagement" stroke={CHART_COLOR_GREEN} strokeWidth={2} dot={{ r: 3, fill: CHART_COLOR_GREEN }} />
                  </AreaChart>
                )}
              </MeasuredChart>
            )}
            {ga4TopPages.slice(0, 6).map((item) => (
              <div key={item.pagePath || '(not set)'} className="analytics-row">
                <div className="analytics-row__title">{item.pagePath || '(not set)'}</div>
                <div className="analytics-row__detail">
                  {formatNumber(item.current.screenPageViews)} views | {formatNumber(item.current.userEngagementDuration, 0)} sec engaged | {formatPercent(item.current.engagementRate, 1)} engagement
                </div>
              </div>
            ))}
            {ga4DevicesDetailed.slice(0, 3).map((item) => (
              <div key={item.deviceCategory} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">Device: {item.deviceCategory}</div>
                  <div className="analytics-row__detail">
                    {formatNumber(item.engagedSessions)} engaged sessions | {formatNumber(item.screenPageViews)} views | {formatNumber(item.screenPageViewsPerSession, 2)} views/session
                  </div>
                </div>
                <div className="analytics-row__metric">{formatPercent(item.engagementRate, 1)}</div>
              </div>
            ))}
            {ga4PagePerformance.slice(0, 4).map((item) => (
              <div key={item.pageTitle} className="analytics-row analytics-row--split">
                <div>
                  <div className="analytics-row__title">{item.pageTitle}</div>
                  <div className="analytics-row__detail">
                    {formatNumber(item.sessions)} sessions | {formatNumber(item.userEngagementDuration, 0)} sec engaged | {formatNumber(item.keyEvents)} key events
                  </div>
                </div>
                <div className="analytics-row__metric">{formatPercent(item.engagementRate, 1)}</div>
              </div>
            ))}
            {ga4ApplyPage?.note && <div className="analytics-note">{ga4ApplyPage.note}</div>}
          </div>
        )}
      </div>

      <div className="analytics-panel analytics-panel--search" style={{ gridColumn: 'span 4' }}>
        <div className="analytics-panel__eyebrow">Paid Search Layer</div>
        <div className="analytics-panel__title">Google Search Ads</div>
        <div className="analytics-panel__subhead">
          Search-only paid media performance, keyword depth, branded demand mix, and the actual ad creative that is showing on desktop.
        </div>
        {googleAdsLoading ? (
          <div className="analytics-note">Loading Google Ads search performance…</div>
        ) : googleAdsError ? (
          <div className="analytics-note">{googleAdsError}</div>
        ) : (
          <div className="analytics-search-grid">
            <div className="analytics-search-card analytics-search-card--wide">
              <div className="analytics-panel__eyebrow">Conversion Actions</div>
              <div className="analytics-panel__subhead" style={{ marginBottom: 0 }}>
                Imported and native Google Ads conversion actions, with totals by action type for the selected window.
              </div>
              <div className="analytics-conversion-table">
                <div className="analytics-conversion-table__head">Action</div>
                <div className="analytics-conversion-table__head">Source</div>
                <div className="analytics-conversion-table__head">Optimization</div>
                <div className="analytics-conversion-table__head">Count</div>
                <div className="analytics-conversion-table__head">Included</div>
                <div className="analytics-conversion-table__head">All conv.</div>
                <div className="analytics-conversion-table__head">Value</div>
                <div className="analytics-conversion-table__head">Repeat</div>
                {googleAdsConversionActions.slice(0, 12).map((item) => (
                  <React.Fragment key={item.conversionActionId || item.name}>
                    <div className="analytics-conversion-table__cell">
                      <div className="analytics-row__title">{item.name}</div>
                      <div className="analytics-row__detail">{item.category || item.type || 'Conversion action'}</div>
                    </div>
                    <div className="analytics-conversion-table__cell">{item.source || '—'}</div>
                    <div className="analytics-conversion-table__cell">{item.primaryForGoal ? 'Primary' : 'Secondary'}</div>
                    <div className="analytics-conversion-table__cell">{item.countingType === 'MANY_PER_CLICK' ? 'Every' : item.countingType === 'ONE_PER_CLICK' ? 'One' : '—'}</div>
                    <div className="analytics-conversion-table__cell">{item.includeInConversionsMetric ? 'Yes' : 'No'}</div>
                    <div className="analytics-conversion-table__cell">{formatNumber(item.allConversions, 2)}</div>
                    <div className="analytics-conversion-table__cell">{formatNumber(item.allConversionsValue, 2)}</div>
                    <div className="analytics-conversion-table__cell">{item.repeatRateAvailable ? formatNumber(item.repeatRate, 2) : '—'}</div>
                  </React.Fragment>
                ))}
              </div>
              {googleAdsConversionActionNote && (
                <div className="analytics-note">{googleAdsConversionActionNote}</div>
              )}
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Paid Search Overview</div>
              <div className="analytics-search-kpis">
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Impressions</span>
                  <strong>{formatNumber(googleAdsOverview?.impressions)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Clicks</span>
                  <strong>{formatNumber(googleAdsOverview?.clicks)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Cost</span>
                  <strong>{formatCurrency(googleAdsOverview?.cost)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Conversions</span>
                  <strong>{formatNumber(googleAdsOverview?.conversions, 1)}</strong>
                </div>
              </div>
              <div className="analytics-search-inline">
                <span>CTR {formatPercent(googleAdsOverview?.ctr, 1)}</span>
                <span>Avg CPC {formatCurrency(googleAdsOverview?.avgCpc, 2)}</span>
                <span>Search IS {formatPercent(googleAdsOverview?.searchImpressionShare, 1)}</span>
                <span className={`analytics-pill analytics-pill--${getDeltaTone(googleAdsOverviewDelta?.clicks)}`}>
                  Clicks {formatSignedPercent(googleAdsOverviewDelta?.clicks, 1)}
                </span>
              </div>
              {googleAdsDailyChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--compact">
                  {({ width, height }) => (
                    <AreaChart width={width} height={height} data={googleAdsDailyChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Area yAxisId="left" type="monotone" dataKey="clicks" stroke={CHART_COLOR_GOLD} fill={CHART_COLOR_GOLD} fillOpacity={0.16} strokeWidth={2} />
                      <Line yAxisId="right" type="monotone" dataKey="conversions" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                    </AreaChart>
                  )}
                </MeasuredChart>
              )}
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Campaign Performance</div>
              {googleAdsCampaignChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--compact">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={googleAdsCampaignChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="clicks" fill={CHART_COLOR_GOLD} radius={[6, 6, 0, 0]} />
                      <Bar dataKey="conversions" fill={CHART_COLOR_ORANGE} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </MeasuredChart>
              )}
              <div className="analytics-stack">
                {googleAdsCampaigns.slice(0, 5).map((item) => (
                  <div key={item.campaignName} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{item.campaignName}</div>
                      <div className="analytics-row__detail">
                        {formatNumber(item.current.impressions)} impressions | {formatPercent(item.current.ctr, 1)} CTR | {formatCurrency(item.current.avgCpc, 2)} avg CPC
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatNumber(item.current.conversions, 1)} conv.</div>
                      <div className={`analytics-pill analytics-pill--${getDeltaTone(item.delta?.conversions)}`}>
                        {formatSignedPercent(item.delta?.conversions, 1)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Keyword Breakdown</div>
              {googleAdsKeywordChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--compact">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={googleAdsKeywordChartData} layout="vertical" margin={CHART_MARGIN_VERTICAL}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} horizontal={false} />
                      <XAxis type="number" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis type="category" dataKey="name" width={120} stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="clicks" fill={CHART_COLOR_GOLD} radius={[0, 6, 6, 0]} />
                    </BarChart>
                  )}
                </MeasuredChart>
              )}
              <div className="analytics-stack">
                {googleAdsKeywords.slice(0, 6).map((item) => (
                  <div key={`${item.keywordText}-${item.matchType}`} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{item.keywordText}</div>
                      <div className="analytics-row__detail">
                        {item.matchType} | {item.campaignName} | Search IS {formatPercent(item.searchImpressionShare, 1)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatNumber(item.clicks)} clicks</div>
                      <div className="analytics-row__detail">{formatCurrency(item.avgCpc, 2)} avg CPC</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Brand vs Non-Brand</div>
              <div className="analytics-stack">
                {['brand', 'nonBrand'].map((group) => (
                  <div key={group} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{group === 'brand' ? 'Brand' : 'Non-brand'}</div>
                      <div className="analytics-row__detail">
                        {formatNumber(googleAdsBrandSplit?.[group]?.impressions)} impressions | {formatPercent(googleAdsBrandSplit?.[group]?.searchImpressionShare, 1)} search impression share
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatNumber(googleAdsBrandSplit?.[group]?.conversions, 1)} conv.</div>
                      <div className="analytics-row__detail">{formatCurrency(googleAdsBrandSplit?.[group]?.cost)}</div>
                    </div>
                  </div>
                ))}
                <div className="analytics-note">
                  Brand logic currently keys off the property name tokens: {(googleAdsBrandSplit?.brandTerms || []).join(', ') || 'No brand terms available'}.
                </div>
              </div>
            </div>

            <div className="analytics-search-card analytics-search-card--preview">
              <div className="analytics-panel__eyebrow">Desktop Ad Preview</div>
              {googleAdsTopAd ? (
                <div className="search-ad-preview">
                  <div className="search-ad-preview__meta">Sponsored</div>
                  <div className="search-ad-preview__url">{googleAdsTopAd.displayUrl || googleAdsTopAd.finalUrl || 'example.com'}</div>
                  <div className="search-ad-preview__headline">
                    {(googleAdsTopAd.headlines || []).slice(0, 3).join(' | ')}
                  </div>
                  <div className="search-ad-preview__desc">
                    {(googleAdsTopAd.descriptions || []).slice(0, 2).join(' ')}
                  </div>
                  <div className="search-ad-preview__footer">
                    <span>{googleAdsTopAd.campaignName}</span>
                    <span>{formatNumber(googleAdsTopAd.impressions)} impressions</span>
                    <span>{formatNumber(googleAdsTopAd.clicks)} clicks</span>
                    <span>{formatPercent(googleAdsTopAd.ctr, 1)} CTR</span>
                  </div>
                </div>
              ) : (
                <div className="analytics-note">No responsive search ad creative found for the selected window.</div>
              )}
              <div className="analytics-stack">
                {googleAdsAds.slice(0, 3).map((ad) => (
                  <div key={ad.adId} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{ad.campaignName}</div>
                      <div className="analytics-row__detail">
                        {(ad.headlines || []).slice(0, 2).join(' | ')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatNumber(ad.conversions, 1)} conv.</div>
                      <div className="analytics-row__detail">{formatCurrency(ad.cost)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="analytics-panel analytics-panel--search" style={{ gridColumn: 'span 4' }}>
        <div className="analytics-panel__eyebrow">Paid Social Layer</div>
        <div className="analytics-panel__title">Meta Ads</div>
        <div className="analytics-panel__subhead">
          Active Meta campaigns only, with strict property scoping, conversion actions, ad set and placement detail, plus a creative preview for the top-spend ad.
        </div>
        <div className="analytics-search-inline" style={{ marginBottom: '0.9rem' }}>
          {[
            ['account_default', 'Account default'],
            ['7d_click_1d_view', '7d click / 1d view'],
            ['1d_click', '1d click'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMetaAdsAttributionMode(value)}
              className={`analytics-pill analytics-pill--${metaAdsAttributionMode === value ? 'positive' : 'neutral'}`}
              style={{ border: 'none', cursor: 'pointer' }}
            >
              {label}
            </button>
          ))}
        </div>
        {metaAdsLoading ? (
          <div className="analytics-note">Loading Meta Ads campaign performance…</div>
        ) : metaAdsError ? (
          <div className="analytics-note">{metaAdsError}</div>
        ) : (
          <div className="analytics-search-grid">
            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Paid Social Overview</div>
              <div className="analytics-search-kpis">
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Impressions</span>
                  <strong>{formatNumber(metaAdsOverview?.impressions)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Clicks</span>
                  <strong>{formatNumber(metaAdsOverview?.clicks)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Spend</span>
                  <strong>{formatCurrency(metaAdsOverview?.spend)}</strong>
                </div>
                <div className="analytics-search-kpi">
                  <span className="analytics-search-kpi__label">Leads</span>
                  <strong>{formatNumber(metaAdsKeyMetrics.leads, 1)}</strong>
                </div>
              </div>
              <div className="analytics-search-inline">
                <span>CTR {formatPercent(metaAdsOverview?.ctr, 1)}</span>
                <span>CPC {formatCurrency(metaAdsOverview?.cpc, 2)}</span>
                <span>CPM {formatCurrency(metaAdsOverview?.cpm, 2)}</span>
                <span>Freq {formatNumber(metaAdsOverview?.frequency, 2)}</span>
                <span className={`analytics-pill analytics-pill--${getDeltaTone(metaAdsOverviewDelta?.clicks)}`}>
                  Clicks {formatSignedPercent(metaAdsOverviewDelta?.clicks, 1)}
                </span>
              </div>
              <div className="analytics-stack">
                <div className="analytics-row analytics-row--split">
                  <div>
                    <div className="analytics-row__title">Fixed Funnel Metrics</div>
                    <div className="analytics-row__detail">
                      Leads {formatNumber(metaAdsKeyMetrics.leads, 0)} | LPVs {formatNumber(metaAdsKeyMetrics.landingPageViews, 0)} | Link clicks {formatNumber(metaAdsKeyMetrics.linkClicks, 0)} | Outbound clicks {formatNumber(metaAdsKeyMetrics.outboundClicks, 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                    <div className="analytics-row__metric">{formatCurrency(metaAdsOverview?.costPerResult, 2)}</div>
                    <div className="analytics-row__detail">Primary result: {metaAdsOverview?.resultLabel || '—'}</div>
                  </div>
                </div>
                {metaAdsAttribution?.label && (
                  <div className="analytics-note">
                    Attribution mode: {metaAdsAttribution.label}
                  </div>
                )}
                {metaAdsScoping?.note && (
                  <div className="analytics-note">
                    {metaAdsScoping.note} Matched campaigns: {formatNumber((metaAdsScoping.matchedCampaignIds || []).length, 0)}.
                  </div>
                )}
              </div>
              {metaAdsDailyChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--compact">
                  {({ width, height }) => (
                    <AreaChart width={width} height={height} data={metaAdsDailyChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="left" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis yAxisId="right" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Area yAxisId="left" type="monotone" dataKey="spend" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} strokeWidth={2} />
                      <Line yAxisId="right" type="monotone" dataKey="clicks" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                    </AreaChart>
                  )}
                </MeasuredChart>
              )}
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Active Campaigns</div>
              {metaAdsCampaignChartData.length > 0 && (
                <MeasuredChart className="analytics-chart analytics-chart--compact">
                  {({ width, height }) => (
                    <BarChart width={width} height={height} data={metaAdsCampaignChartData} margin={CHART_MARGIN_STANDARD}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                      <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <YAxis stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                      <Bar dataKey="spend" fill={CHART_COLOR_PINK} radius={[8, 8, 0, 0]} barSize={22} />
                    </BarChart>
                  )}
                </MeasuredChart>
              )}
              <div className="analytics-stack">
                {metaAdsCampaigns.slice(0, 6).map((item) => (
                  <div key={item.campaignId || item.campaignName} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{item.campaignName}</div>
                      <div className="analytics-row__detail">
                        {item.effectiveStatus || item.status || 'Status unavailable'} | {item.objective || 'Objective unavailable'} | Freq {formatNumber(item.current?.frequency, 2)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatCurrency(item.current?.spend)}</div>
                      <div className="analytics-row__detail">
                        Leads {formatNumber(item.current?.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.current?.keyMetrics?.landingPageViews, 0)}
                      </div>
                    </div>
                  </div>
                ))}
                {metaAdsCampaigns.length === 0 && (
                  <div className="analytics-note">No active Meta campaigns returned for this date range.</div>
                )}
              </div>
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Placements</div>
              <div className="analytics-stack">
                {metaAdsPlacements.slice(0, 6).map((item, index) => (
                  <div key={`${item.publisherPlatform}-${item.platformPosition}-${item.impressionDevice}-${index}`} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">
                        {item.publisherPlatform} / {item.platformPosition}
                      </div>
                      <div className="analytics-row__detail">
                        {item.impressionDevice} | CTR {formatPercent(item.ctr, 1)} | Freq {formatNumber(item.frequency, 2)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatCurrency(item.spend)}</div>
                      <div className="analytics-row__detail">Leads {formatNumber(item.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.keyMetrics?.landingPageViews, 0)}</div>
                    </div>
                  </div>
                ))}
                {metaAdsPlacements.length === 0 && (
                  <div className="analytics-note">No placement breakdown returned for the selected window.</div>
                )}
              </div>
            </div>

            <div className="analytics-search-card">
              <div className="analytics-panel__eyebrow">Ad Sets</div>
              <div className="analytics-stack">
                {metaAdsAdSets.slice(0, 6).map((item) => (
                  <div key={item.id || item.name} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{item.name}</div>
                      <div className="analytics-row__detail">
                        {item.campaign_name || 'Campaign unavailable'} | Freq {formatNumber(item.frequency, 2)} | CTR {formatPercent(item.ctr, 1)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatCurrency(item.spend)}</div>
                      <div className="analytics-row__detail">
                        Leads {formatNumber(item.keyMetrics?.leads, 0)} | LPVs {formatNumber(item.keyMetrics?.landingPageViews, 0)}
                      </div>
                    </div>
                  </div>
                ))}
                {metaAdsAdSets.length === 0 && (
                  <div className="analytics-note">No active ad sets returned for the selected window.</div>
                )}
              </div>
            </div>

            <div className="analytics-search-card analytics-search-card--preview">
              <div className="analytics-panel__eyebrow">Meta Ad Preview</div>
              {metaAdsTopPreview ? (
                <div className="search-ad-preview">
                  <div className="search-ad-preview__meta">
                    {metaAdsTopPreview.pageName || 'Meta Ad'} | {metaAdsTopPreview.format || 'ad'}
                  </div>
                  {metaAdsTopPreview.mediaUrl && metaAdsTopPreview.format !== 'carousel' && (
                    <img
                      src={metaAdsTopPreview.mediaUrl}
                      alt={metaAdsTopPreview.adName || 'Meta creative'}
                      style={{ width: '100%', borderRadius: '12px', marginBottom: '0.75rem', objectFit: 'cover', maxHeight: '180px', background: 'rgba(16,33,38,0.06)' }}
                    />
                  )}
                  {metaAdsTopPreview.format === 'carousel' && (metaAdsTopPreview.carouselCards || []).length > 0 && (
                    <div style={{ display: 'grid', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {metaAdsTopPreview.carouselCards.slice(0, 3).map((card, index) => (
                        <div key={`${metaAdsTopPreview.adId}-card-${index}`} style={{ display: 'grid', gridTemplateColumns: card.mediaUrl ? '72px 1fr' : '1fr', gap: '0.75rem', alignItems: 'center', padding: '0.5rem', background: 'rgba(16,33,38,0.04)', borderRadius: '10px' }}>
                          {card.mediaUrl && (
                            <img
                              src={card.mediaUrl}
                              alt={card.headline || `Carousel card ${index + 1}`}
                              style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '8px' }}
                            />
                          )}
                          <div>
                            <div className="analytics-row__title">{card.headline || `Card ${index + 1}`}</div>
                            <div className="analytics-row__detail">{card.description || card.destinationUrl || 'No card description available'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="search-ad-preview__headline">
                    {metaAdsTopPreview.headline || metaAdsTopPreview.adName || 'Untitled Meta ad'}
                  </div>
                  <div className="search-ad-preview__desc">
                    {metaAdsTopPreview.primaryText || metaAdsTopPreview.description || 'Creative text was not available from the API response for this ad.'}
                  </div>
                  {metaAdsTopPreview.destinationUrl && (
                    <div className="search-ad-preview__url" style={{ marginBottom: '0.5rem' }}>
                      {metaAdsTopPreview.destinationUrl}
                    </div>
                  )}
                  <div className="search-ad-preview__footer">
                    <span>{metaAdsTopPreview.campaignName}</span>
                    <span>{metaAdsTopPreview.callToAction || 'CTA unavailable'}</span>
                    <span>{formatCurrency(metaAdsTopPreview.spend)}</span>
                    <span>LPVs {formatNumber(metaAdsTopPreview.keyMetrics?.landingPageViews, 0)}</span>
                  </div>
                </div>
              ) : (
                <div className="analytics-note">No active Meta ad creative was available for preview in the selected window.</div>
              )}
              <div className="analytics-stack">
                {metaAdsTopAds.slice(0, 3).map((ad) => (
                  <div key={ad.adId} className="analytics-row analytics-row--split">
                    <div>
                      <div className="analytics-row__title">{ad.headline || ad.adName}</div>
                      <div className="analytics-row__detail">
                        {ad.pageName || 'Meta Ad'} | {ad.campaignName} | {ad.callToAction || 'CTA unavailable'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', display: 'grid', gap: '0.3rem' }}>
                      <div className="analytics-row__metric">{formatCurrency(ad.spend)}</div>
                      <div className="analytics-row__detail">{formatNumber(ad.keyMetrics?.landingPageViews, 0)} LPVs</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {(ga4CoverageGaps || googleAdsCoverage || metaAdsCoverage) && (
        <div className="analytics-panel analytics-panel--light" style={{ gridColumn: 'span 4' }}>
          <div className="analytics-panel__eyebrow">Coverage Map</div>
          <div className="analytics-panel__title">What still needs external connectors</div>
          <div className="analytics-panel__subhead">
            The dashboard now covers the GA4-sourced competitor metrics and core Google Search Ads metrics. These remaining items still need dedicated Search Console, Meta, and deeper Google Ads connectors.
          </div>
          <div className="analytics-stack">
            {Object.entries(ga4CoverageGaps || {}).map(([group, items]) => (
              <div key={group} className="analytics-row">
                <div className="analytics-row__title">{group}</div>
                <div className="analytics-row__detail">{items.join(' | ')}</div>
              </div>
            ))}
            {googleAdsCoverage && (
              <>
                <div className="analytics-row">
                  <div className="analytics-row__title">googleAdsIncluded</div>
                  <div className="analytics-row__detail">{(googleAdsCoverage.included || []).join(' | ')}</div>
                </div>
                <div className="analytics-row">
                  <div className="analytics-row__title">googleAdsRemaining</div>
                  <div className="analytics-row__detail">{(googleAdsCoverage.remaining || []).join(' | ')}</div>
                </div>
              </>
            )}
            {metaAdsCoverage && (
              <>
                <div className="analytics-row">
                  <div className="analytics-row__title">metaAdsIncluded</div>
                  <div className="analytics-row__detail">{(metaAdsCoverage.included || []).join(' | ')}</div>
                </div>
                <div className="analytics-row">
                  <div className="analytics-row__title">metaAdsRemaining</div>
                  <div className="analytics-row__detail">{(metaAdsCoverage.remaining || []).join(' | ')}</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );

  // ──────────────── RENDER ────────────────

  const renderDashboard = () => (
    <div className="grid-layout">
      {/* ── KPI Tiles ── */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={16} style={{ opacity: 0.6 }} />
        <div className="card-title">Total Leads</div>
        </div>
        <div className="card-value">{loading ? '…' : formatNumber(totalLeads)}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Apps: {formatNumber(totalApplications)} | Leases: {formatNumber(totalLeases)}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileCheck size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Applications Completed</div>
        </div>
        <div className="card-value">{loading ? '…' : formatNumber(totalApplications)}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Lead-to-completed-app: {applicationConversion}% | {funnelMetricSource}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Home size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Leases Approved</div>
        </div>
        <div className="card-value">{loading ? '…' : formatNumber(totalLeases)}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          App-to-approved-lease: {applicationToLeaseConversion}% | Lead-to-lease: {leaseConversion}%
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Lead-to-Lease Conversion</div>
        </div>
        <div className="card-value">
          {loading ? '…' : `${leaseConversion}%`}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Leads: {formatNumber(totalLeads)} | Leases: {formatNumber(totalLeases)}
        </div>
      </div>

      <div className="card" style={{ background: 'var(--pop-red)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Marketing Cost</div>
        </div>
        <div className="card-value">
          {loading ? '…' : totalBlendedMarketingSpend > 0 ? formatCurrency(totalBlendedMarketingSpend) : 'No data'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Paid media: {totalPerformanceMarketingCost > 0 ? formatCurrency(totalPerformanceMarketingCost) : '—'} | CPL: {costPerLead !== '—' ? formatCurrency(costPerLead, 2) : '—'}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Cost Per Lead</div>
        </div>
        <div className="card-value">
          {loading ? '…' : costPerLead !== '—' ? formatCurrency(costPerLead, 2) : 'No spend'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Leads: {formatNumber(totalLeads)} | Paid media: {totalPerformanceMarketingCost > 0 ? formatCurrency(totalPerformanceMarketingCost) : '—'}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Cost Per Lease</div>
        </div>
        <div className="card-value">
          {roiLoading ? '…' : roiCostPerLease !== '—' ? formatCurrency(roiCostPerLease, 2) : 'No spend'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          ROI: {blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'} | Leases: {formatNumber(totalLeases)}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">ROAS</div>
        </div>
        <div className="card-value">
          {roiLoading ? '…' : blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : 'No spend'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Net revenue: {roiTotals.netEffectiveRevenue > 0 ? formatCurrency(roiTotals.netEffectiveRevenue) : '—'} | Spend: {roiTotals.marketingSpend > 0 ? formatCurrency(roiTotals.marketingSpend) : '—'}
        </div>
      </div>

      <div className="card span-2">
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>Marketing Plays</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem', fontSize: '0.85rem' }}>
          {totalLeads > 0 && totalApplications / totalLeads < 0.15 && (
            <p>• <strong>Low App Rate</strong>: Only {((totalApplications / totalLeads) * 100).toFixed(0)}% of leads applied. Consider follow-up campaigns.</p>
          )}
          {totalLeads === 0 && (
            <p>• <strong>No Data</strong>: Expand the date range to see metrics.</p>
          )}
          {totalLeads > 0 && (
            <p>• <strong>Top Source</strong>: {leadSourceBreakdown[0]?.name || 'N/A'} drives {leadSourceBreakdown[0]?.value || 0} leads ({totalLeads > 0 ? ((leadSourceBreakdown[0]?.value / totalLeads) * 100).toFixed(0) : 0}%).</p>
          )}
          {totalPerformanceMarketingCost > 0 && (
            <p>• <strong>Cost per Lease</strong>: {costPerLease !== '—' ? `$${costPerLease}` : '—'} based on prorated paid media spend for this range.</p>
          )}
          {totalBlendedMarketingSpend > 0 && (
            <p>• <strong>Total Marketing Spend</strong>: ${totalBlendedMarketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} allocated across the selected days from tracked monthly marketing invoices.</p>
          )}
          {blendedRoi != null && (
            <p>• <strong>Blended ROI</strong>: {(blendedRoi * 100).toFixed(0)}% from ${roiTotals.netEffectiveRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} net effective revenue on ${roiTotals.marketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} spend.</p>
          )}
          {attributedLeaseCount > 0 && (
            <p>• <strong>Attribution Match Rate</strong>: {attributionMatchRate}% of tracked leases are tied back to a lead record for this range.</p>
          )}
        </div>
      </div>

      {/* ── Lead Source Breakdown ── */}
      <div className="card span-2">
        <div className="card-title">Top Lead Sources</div>
        {leadSourceBreakdown.length > 0 ? (
          <MeasuredChart className="analytics-chart analytics-chart--compact" fixedHeight={160}>
            {({ width, height }) => (
            <BarChart width={width} height={height} data={leadSourceBreakdown} layout="vertical" margin={CHART_MARGIN_VERTICAL}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
              <Bar dataKey="value" fill={CHART_COLOR_ORANGE} radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
            )}
          </MeasuredChart>
        ) : (
          <div style={{ opacity: 0.5, fontSize: '0.85rem', marginTop: '1rem' }}>No source data</div>
        )}
      </div>

      {/* ── Performance Trends Chart ── */}
      <div className="chart-container span-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ color: 'white', margin: 0 }}>Daily Performance Trends</h3>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--chart-pink)' }}>● Leads</span>
            <span style={{ color: 'var(--chart-secondary-tan)' }}>● Applications</span>
            <span style={{ color: 'var(--chart-green)' }}>● Leases</span>
          </div>
        </div>
        {dailyChartData.length > 0 ? (
          <MeasuredChart className="analytics-chart analytics-chart--tall" fixedHeight={300}>
            {({ width, height }) => (
            <AreaChart width={width} height={height} data={dailyChartData} margin={CHART_MARGIN_TALL}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_DARK} vertical={false} />
              <XAxis dataKey="label" stroke={CHART_AXIS_DARK} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
              <YAxis stroke={CHART_AXIS_DARK_SOFT} tick={{ fill: CHART_COLOR_TAN }} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
              <Area type="monotone" dataKey="leads" stroke={CHART_COLOR_PINK} fill={CHART_COLOR_PINK} fillOpacity={0.16} name="Leads" />
              <Area type="monotone" dataKey="applications" stroke={CHART_COLOR_SECONDARY_TAN} fill={CHART_COLOR_SECONDARY_TAN} fillOpacity={0.18} name="Applications" />
              <Bar dataKey="leases" fill={CHART_COLOR_GREEN} barSize={6} radius={[4, 4, 0, 0]} name="Leases" />
            </AreaChart>
            )}
          </MeasuredChart>
        ) : (
          <div style={{ color: 'var(--primary-tan)', opacity: 0.5, textAlign: 'center', paddingTop: '4rem' }}>
            {loading ? 'Loading chart data…' : 'No data for this date range'}
          </div>
        )}
      </div>

      <div className="card span-4" style={{ background: 'var(--panel-soft)', color: 'var(--white)' }}>
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>Marketing Spend Breakdown</div>
        {marketingSpendBreakdown.length > 0 ? (
          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.75rem' }}>
            {marketingSpendBreakdown.map((item) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid var(--panel-border)',
                  opacity: item.excluded ? 0.48 : 1
                }}
              >
                <div style={{ maxWidth: '75%' }}>{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <button
                    type="button"
                    className={`marketing-spend-toggle ${item.excluded ? 'is-excluded' : 'is-included'}`}
                    aria-pressed={!item.excluded}
                    onClick={() => toggleMarketingSpendLine(item.label)}
                    title={item.excluded ? 'Include this spend line' : 'Exclude this spend line from totals'}
                  >
                    <span className="marketing-spend-toggle__track">
                      <span className="marketing-spend-toggle__knob" />
                    </span>
                    <span>{item.excluded ? 'Excluded' : 'Included'}</span>
                  </button>
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textDecoration: item.excluded ? 'line-through' : 'none' }}>
                    ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.6, marginTop: '1rem' }}>No marketing spend rows found for this date range.</div>
        )}
      </div>

    </div>
  );

  const getAuditItemText = (item, fallback = 'Review latest audit finding') => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return fallback;
    return item.issue || item.recommendation || item.text || item.message || item.url || fallback;
  };

  const getAuditStatus = ({ score, issueCount = 0, warnCount = 0, healthyWhenZero = false }) => {
    if (issueCount > 0) return { label: 'Issue found', tone: 'danger' };
    if (healthyWhenZero && issueCount === 0 && warnCount === 0) return { label: 'Healthy', tone: 'healthy' };
    if (score == null) return { label: 'Needs review', tone: 'warning' };
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return { label: 'Needs review', tone: 'warning' };
    if (numericScore >= 90) return { label: 'Healthy', tone: 'healthy' };
    if (numericScore >= 70) return { label: 'Needs review', tone: 'warning' };
    return { label: 'Issue found', tone: 'danger' };
  };

  const renderAuditActionCard = ({ title, status, count, finding, details = [] }) => {
    const safeDetails = (details || []).map((item) => getAuditItemText(item)).filter(Boolean);
    return (
      <details className="heatmap-audit-card">
        <summary>
          <div>
            <div className="heatmap-audit-card__title-row">
              <strong>{title}</strong>
              <span className={`heatmap-audit-badge heatmap-audit-badge--${status.tone}`}>{status.label}</span>
            </div>
            <small>{finding}</small>
          </div>
          <div className="heatmap-audit-card__count">{count}</div>
        </summary>
        <div className="heatmap-audit-card__details">
          {safeDetails.length > 0 ? (
            safeDetails.slice(0, 5).map((item, index) => <p key={`${title}-detail-${index}`}>{item}</p>)
          ) : (
            <p>No additional details for this check.</p>
          )}
        </div>
      </details>
    );
  };

  const renderHeatmapAuditPanel = () => (
    <section id="reporting-panel-heatmaps-audit" className="reports-panel">
      <div className="reports-panel__eyebrow">Website Experience</div>
      <div className="reports-panel__title">Heatmaps + Site Audit</div>
      {heatmapPanelError && <div className="reports-empty" style={{ marginBottom: '1rem' }}>{heatmapPanelError}</div>}

      <div className="heatmap-audit-controls">
        <label className="website-manager-field">
          <span className="website-manager-field__label">Page</span>
          <select className="website-manager-field__input" value={selectedHeatmapPath} onChange={(event) => setSelectedHeatmapPath(event.target.value)}>
            {heatmapPageOptions.map((page) => <option key={page.path || page.id} value={page.path || '/'}>{page.title || page.path || '/'}</option>)}
            {heatmapPageOptions.length === 0 && <option value="">No pages tracked yet</option>}
          </select>
        </label>
        <label className="website-manager-field">
          <span className="website-manager-field__label">Device</span>
          <select className="website-manager-field__input" value={selectedHeatmapDevice} onChange={(event) => setSelectedHeatmapDevice(event.target.value)}>
            {HEATMAP_DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{device}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', alignItems: 'end' }}>
          <button type="button" className="website-manager-button website-manager-button--primary" onClick={runSiteAudit} disabled={siteAuditRunning || siteAuditLoading}>
            {siteAuditRunning ? 'Running…' : 'Run Audit'}
          </button>
        </div>
      </div>

      <div className="heatmap-audit-status-grid">
        <div className={`heatmap-audit-status-card ${selectedScreenshot ? 'is-healthy' : 'is-pending'}`}>
          <span>{selectedScreenshot ? 'Screenshot captured' : 'Screenshot pending'}</span>
          <strong>{selectedScreenshot ? `${selectedScreenshot.deviceType || selectedHeatmapDevice} screenshot` : 'Waiting for capture'}</strong>
          <small>{selectedScreenshot?.capturedAt ? getSnapshotTimestampLabel(selectedScreenshot.capturedAt) : 'No screenshot stored for this page/device yet.'}</small>
        </div>
        <div className={`heatmap-audit-status-card ${latestAudit ? 'is-healthy' : 'is-pending'}`}>
          <span>{latestAudit ? 'Audit complete' : 'Audit pending'}</span>
          <strong>{latestAudit ? `Score ${auditPageResult?.score ?? latestAudit?.performance_score ?? '—'}` : 'Run audit'}</strong>
          <small>{latestAudit?.audited_at ? getSnapshotTimestampLabel(latestAudit.audited_at) : 'Audit data is separate from heatmap traffic.'}</small>
        </div>
        <div className={`heatmap-audit-status-card ${Number(heatmapTotals.events || 0) > 0 ? 'is-healthy' : 'is-pending'}`}>
          <span>{Number(heatmapTotals.events || 0) > 0 ? 'Heatmap traffic active' : 'Heatmap traffic pending'}</span>
          <strong>{heatmapSummaryLoading ? 'Loading…' : `${formatNumber(heatmapTotals.events || 0)} events`}</strong>
          <small>{Number(heatmapTotals.events || 0) > 0 ? `${formatNumber(heatmapTotals.sessions || 0)} tracked sessions in range.` : 'Audit and screenshots can be ready before visitor interaction data arrives.'}</small>
        </div>
        <div className={`heatmap-audit-status-card ${selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'is-healthy' : 'is-pending'}`}>
          <span>{selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'Snapshot captured' : 'Snapshot pending'}</span>
          <strong>{selectedAuditPage?.capturedAt || selectedAuditPage?.latestSnapshotId ? 'Page snapshot' : 'Waiting for snapshot'}</strong>
          <small>{selectedAuditPage?.capturedAt ? getSnapshotTimestampLabel(selectedAuditPage.capturedAt) : selectedAuditPage?.latestSnapshotId ? 'Snapshot record available.' : 'No page snapshot yet.'}</small>
        </div>
        <div className={`heatmap-audit-status-card ${lastTrackerEventAt ? 'is-healthy' : 'is-pending'}`}>
          <span>{lastTrackerEventAt ? 'Tracker event seen' : 'Tracker event pending'}</span>
          <strong>{lastTrackerEventAt ? 'Tracker active' : 'No event yet'}</strong>
          <small>{lastTrackerEventAt ? getSnapshotTimestampLabel(lastTrackerEventAt) : 'No tracker event observed for this page yet.'}</small>
        </div>
      </div>

      {reportingAdminEnabled && (
        <div className="heatmap-coordinate-diagnostics">
          <div className="heatmap-coordinate-diagnostics__heading">
            <strong>Coordinate diagnostics</strong>
            <small>Admin-only tracker validation for the selected page/device/range.</small>
          </div>
          <div className="heatmap-coordinate-diagnostics__grid">
            <div><span>Raw events received</span><strong>{formatNumber(heatmapCoordinateDiagnostics.rawEvents)}</strong></div>
            <div><span>Events with coordinates</span><strong>{formatNumber(heatmapCoordinateDiagnostics.withCoordinates)}</strong></div>
            <div><span>Rejected from renderer</span><strong>{formatNumber(heatmapCoordinateDiagnostics.rejectedFromRenderer)}</strong></div>
            <div><span>Device mismatch count</span><strong>{formatNumber(heatmapCoordinateDiagnostics.deviceMismatch)}</strong></div>
          </div>
        </div>
      )}

      <div className="heatmap-audit-layout">
        <div className="heatmap-audit-preview">
          <div className="heatmap-audit-section-heading">
            <div>
              <strong>Page preview</strong>
              <small>{selectedHeatmapPath || '/'} · {selectedHeatmapDevice}</small>
            </div>
            <span>{screenshotPreviewLoading ? 'Loading screenshot' : selectedScreenshot ? 'Screenshot available' : 'No screenshot yet'}</span>
          </div>
          <HeatmapRenderer
            points={heatmapPoints}
            totals={heatmapTotals}
            deviceType={selectedHeatmapDevice}
            screenshotUrl={screenshotPreviewUrl}
            screenshot={selectedScreenshot}
            loading={screenshotPreviewLoading || heatmapSummaryLoading}
            error={screenshotPreviewError}
            activeLayers={heatmapLayers}
            onLayerChange={updateHeatmapLayer}
            formatNumber={formatNumber}
          />
        </div>
        <div className="reports-list heatmap-audit-rail">
          <div className="heatmap-audit-section-heading">
            <div>
              <strong>Audit summary</strong>
              <small>{latestAudit?.audited_at ? `Last audited ${getSnapshotTimestampLabel(latestAudit.audited_at)}` : 'Audit pending'}</small>
            </div>
          </div>
          <div className="heatmap-audit-rail-score">
            <span>Combined score</span>
            <strong>{siteAuditLoading ? '…' : auditPageResult?.score ?? latestAudit?.performance_score ?? '—'}</strong>
            <small>{latestAudit ? 'Weighted deterministic audit' : 'Run audit to score this page'}</small>
          </div>
          {renderAuditActionCard({
            title: 'Audit score',
            status: getAuditStatus({ score: auditPageResult?.score ?? latestAudit?.performance_score, issueCount: (auditIssues || []).length }),
            count: siteAuditLoading ? '…' : auditPageResult?.score ?? latestAudit?.performance_score ?? '—',
            finding: latestAudit ? 'Weighted score across SEO, CTA, freshness, links, structure, and performance proxy.' : 'Run an audit to generate a score.',
            details: auditCategoryScores.length
              ? auditCategoryScores.map((item) => `${item.label}: ${formatNumber(item.score, 1)}${item.weight != null ? ` (${Math.round(Number(item.weight) * 100)}% weight)` : ''}`)
              : auditIssues.length ? auditIssues : auditRecommendations,
          })}
          {auditCategoryScores.length > 0 && (
            <div className="heatmap-audit-category-grid">
              {auditCategoryScores.map((item) => (
                <div key={item.key || item.label} className="heatmap-audit-category">
                  <span>{item.label}</span>
                  <strong>{formatNumber(item.score, 1)}</strong>
                  <small>{item.weight != null ? `${Math.round(Number(item.weight) * 100)}% weight` : 'Category score'}</small>
                </div>
              ))}
            </div>
          )}
          {renderAuditActionCard({
            title: 'CTA / urgency',
            status: getAuditStatus({
              score: latestAudit?.urgency_score,
              issueCount: (auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0) > 0 ? 0 : 1,
            }),
            count: auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0,
            finding: `${auditPageResult?.ctaCount ?? selectedAuditPage?.ctas?.length ?? 0} CTA-like elements detected.`,
            details: selectedAuditPage?.ctas || auditRecommendations,
          })}
          {renderAuditActionCard({
            title: 'Broken/internal links',
            status: getAuditStatus({ score: latestAudit?.link_score, issueCount: Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : 0, healthyWhenZero: true }),
            count: formatNumber(Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : 0),
            finding: Array.isArray(auditBrokenLinks) && auditBrokenLinks.length ? 'Suspicious internal links need review.' : 'No suspicious internal links detected.',
            details: auditBrokenLinks,
          })}
          <div className="reports-list__row"><div><strong>Last captured / audited</strong><small>{selectedAuditPage?.capturedAt ? getSnapshotTimestampLabel(selectedAuditPage.capturedAt) : 'No page capture yet'}</small></div><div>{latestAudit?.audited_at ? getSnapshotTimestampLabel(latestAudit.audited_at) : '—'}</div></div>
          {renderAuditActionCard({
            title: 'Stale date findings',
            status: getAuditStatus({ issueCount: (auditStaleDates || []).length, healthyWhenZero: true }),
            count: formatNumber((auditStaleDates || []).length),
            finding: (auditStaleDates || []).length ? 'Potential stale or expired dates found.' : 'None detected.',
            details: auditStaleDates,
          })}
          {renderAuditActionCard({
            title: 'Recommendations',
            status: getAuditStatus({ warnCount: (auditRecommendations || []).length, score: (auditRecommendations || []).length ? 75 : 100 }),
            count: formatNumber((auditRecommendations || []).length),
            finding: (auditRecommendations || []).length ? 'Suggested improvements are available.' : 'No recommendations generated for this page.',
            details: auditRecommendations,
          })}
          {!latestAudit && <div className="reports-empty">Run an audit after page snapshots are collected to populate recommendations.</div>}
        </div>
      </div>

      <div className="heatmap-audit-interactions">
        <div className="heatmap-audit-section-heading">
          <div>
            <strong>Click and engagement signals</strong>
            <small>Rage clicks, dead clicks, and the top clicked elements for the selected page.</small>
          </div>
        </div>
        <div className="heatmap-audit-interaction-grid">
          <div className="reports-list__row"><div><strong>Rage click clusters</strong><small>Repeated clicks in the same session, element, and page area.</small></div><div>{formatNumber(heatmapClickAnomalies.rageClusters)}</div></div>
          <div className="reports-list__row"><div><strong>Dead clicks</strong><small>Clicks without a CTA label or href signal.</small></div><div>{formatNumber(heatmapClickAnomalies.deadClicks)}</div></div>
          <div className="heatmap-audit-top-clicks">
            <div className="heatmap-audit-list-heading">Top clicked elements</div>
            {heatmapTopTargets.slice(0, 6).map((item) => <div key={item.label} className="reports-list__row"><div><strong>{item.label}</strong><small>Top clicked element</small></div><div>{formatNumber(item.clicks)}</div></div>)}
            {heatmapTopTargets.length === 0 && <div className="heatmap-audit-compact-empty">No clicked elements collected yet for this page and date range.</div>}
          </div>
        </div>
      </div>
    </section>
  );

  const renderAuditCommandCenter = () => (
    <div className="audit-view">
      <div className="audit-shell">
        <div className="audit-hero">
          <div>
            <div className="reports-kicker">Internal Command Center</div>
            <div className="reports-headline">Website audit priorities across every property.</div>
            <div className="reports-subhead">
              Rank sites by audit score, scan CTA and urgency gaps, catch stale dates, flag broken links, and decide where the web team should focus next.
            </div>
          </div>
          <div className="reports-chip-row">
            <div className="reports-chip">All properties</div>
            <div className="reports-chip">{portfolioAuditSummary.urgentProperties} below 70</div>
            <div className="reports-chip">{portfolioAuditSummary.missingAudits} awaiting first audit</div>
          </div>
        </div>

        <div className="audit-kpi-grid">
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Properties tracked</div>
            <div className="reports-kpi-card__value">{formatNumber(portfolioAuditSummary.totalProperties)}</div>
            <div className="reports-kpi-card__meta">Every property visible in this internal-only queue</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Needs urgent cleanup</div>
            <div className="reports-kpi-card__value">{formatNumber(portfolioAuditSummary.urgentProperties)}</div>
            <div className="reports-kpi-card__meta">Properties with audit scores below 70</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Broken link risk</div>
            <div className="reports-kpi-card__value">{formatNumber(portfolioAuditSummary.brokenLinkProperties)}</div>
            <div className="reports-kpi-card__meta">Properties with suspicious internal links</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Outdated date risk</div>
            <div className="reports-kpi-card__value">{formatNumber(portfolioAuditSummary.staleDateProperties)}</div>
            <div className="reports-kpi-card__meta">Properties with stale or expiring date copy</div>
          </div>
        </div>

        <div className="audit-workspace">
          <section className="reports-panel">
            <div className="reports-panel__eyebrow">Priority Queue</div>
            <div className="reports-panel__title">Lowest scores rise to the top</div>
            {portfolioAuditError && <div className="reports-empty">{portfolioAuditError}</div>}
            {!portfolioAuditError && (
              <div className="audit-leaderboard">
                {portfolioAuditLoading && <div className="reports-empty">Loading portfolio audit data…</div>}
                {!portfolioAuditLoading && portfolioAuditProperties.map((property, index) => {
                  const isActive = property.propertyId === selectedPortfolioAudit?.propertyId;
                  const scoreLabel = property.performanceScore != null ? Math.round(property.performanceScore) : '—';
                  const issueSummary = [
                    `${formatNumber(property.issueCount)} issues`,
                    `${formatNumber(property.brokenLinkCount)} broken links`,
                    `${formatNumber(property.staleDateCount)} stale dates`,
                    `${formatNumber(property.ctaMissingPageCount)} CTA gaps`,
                  ].join(' | ');

                  return (
                    <button
                      key={property.propertyId}
                      type="button"
                      className={`audit-leaderboard__row ${isActive ? 'is-active' : ''}`}
                      onClick={() => setSelectedPropertyId(property.propertyId)}
                    >
                      <div className="audit-leaderboard__rank">{String(index + 1).padStart(2, '0')}</div>
                      <div className="audit-leaderboard__content">
                        <div className="audit-leaderboard__topline">
                          <strong>{property.propertyName}</strong>
                          <span>{[property.city, property.state].filter(Boolean).join(', ') || 'Location pending'}</span>
                        </div>
                        <div className="audit-leaderboard__meta">{property.summary || property.topIssue}</div>
                        <div className="audit-leaderboard__signals">{issueSummary}</div>
                      </div>
                      <div className="audit-leaderboard__score">
                        <strong>{scoreLabel}</strong>
                        <span>{property.hasAudit ? 'audit score' : 'needs audit'}</span>
                      </div>
                    </button>
                  );
                })}
                {!portfolioAuditLoading && portfolioAuditProperties.length === 0 && (
                  <div className="reports-empty">No portfolio audit records are available yet.</div>
                )}
              </div>
            )}
          </section>

          <section className="reports-panel">
            <div className="reports-panel__eyebrow">Selected Property</div>
            <div className="reports-panel__title">
              {selectedPortfolioAudit?.propertyName || selectedPropertyLabel || 'Choose a property'}
            </div>
            <div className="audit-detail-toolbar">
              <label className="website-manager-field">
                <span className="website-manager-field__label">Audit page</span>
                <select className="website-manager-field__input" value={selectedHeatmapPath} onChange={(event) => setSelectedHeatmapPath(event.target.value)}>
                  {auditPageOptions.map((page) => <option key={page.path || page.id} value={page.path || '/'}>{page.title || page.path || '/'}</option>)}
                  {auditPageOptions.length === 0 && <option value="">No audit pages captured yet</option>}
                </select>
              </label>
              <label className="website-manager-field">
                <span className="website-manager-field__label">Screenshot device</span>
                <select className="website-manager-field__input" value={selectedHeatmapDevice} onChange={(event) => setSelectedHeatmapDevice(event.target.value)}>
                  {HEATMAP_DEVICE_OPTIONS.map((device) => <option key={device} value={device}>{device}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'end' }}>
                <button type="button" className="website-manager-button website-manager-button--primary" onClick={runSiteAudit} disabled={siteAuditRunning || siteAuditLoading || !selectedPropertyId}>
                  {siteAuditRunning ? 'Running…' : 'Run Audit'}
                </button>
              </div>
            </div>

            <div className="reports-panel__grid reports-panel__grid--three">
              <div className="reports-stat"><span>Audit Score</span><strong>{siteAuditLoading ? '…' : auditPageResult?.score ?? latestAudit?.performance_score ?? selectedPortfolioAudit?.performanceScore ?? '—'}</strong><small>{selectedPortfolioAudit?.summary || 'Latest site audit snapshot'}</small></div>
              <div className="reports-stat"><span>Urgency / CTA</span><strong>{latestAudit?.urgency_score ?? selectedPortfolioAudit?.urgencyScore ?? '—'}</strong><small>{auditPageResult?.ctaCount ?? selectedPortfolioAudit?.ctaMissingPageCount ?? 0} CTA gaps surfaced</small></div>
              <div className="reports-stat"><span>Freshness / Links</span><strong>{latestAudit?.freshness_score ?? selectedPortfolioAudit?.freshnessScore ?? '—'}</strong><small>{formatNumber(Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : selectedPortfolioAudit?.brokenLinkCount || 0)} suspicious links</small></div>
            </div>

            <div className="audit-detail-grid">
              <div className="audit-screenshot-card">
                {screenshotPreviewUrl ? (
                  <img src={screenshotPreviewUrl} alt={`${selectedPortfolioAudit?.propertyName || selectedPropertyLabel} site screenshot`} className="audit-screenshot-card__image" />
                ) : (
                  <div className="audit-screenshot-card__empty">No screenshot preview stored for this page and device yet.</div>
                )}
                <div className="audit-screenshot-card__meta">
                  <strong>Screenshot</strong>
                  <span>{selectedScreenshot?.capturedAt ? getSnapshotTimestampLabel(selectedScreenshot.capturedAt) : 'No capture yet'}</span>
                </div>
              </div>

              <div className="audit-focus-list">
                <div className="reports-list__row">
                  <div>
                    <strong>Call to action</strong>
                    <small>{auditPageResult?.ctaCount ?? 0} CTA-like elements detected on the selected page.</small>
                  </div>
                  <div>{latestAudit?.urgency_score ?? selectedPortfolioAudit?.urgencyScore ?? '—'}</div>
                </div>
                <div className="reports-list__row">
                  <div>
                    <strong>Outdated dates</strong>
                    <small>{(auditStaleDates || []).slice(0, 2).map((item) => (typeof item === 'string' ? item : item.text || item.issue || '')).filter(Boolean).join(' | ') || 'No stale dates flagged yet.'}</small>
                  </div>
                  <div>{formatNumber((auditStaleDates || []).length || selectedPortfolioAudit?.staleDateCount || 0)}</div>
                </div>
                <div className="reports-list__row">
                  <div>
                    <strong>Broken links</strong>
                    <small>{Array.isArray(auditBrokenLinks) && auditBrokenLinks.length ? 'Suspicious internal links need review.' : 'No suspicious internal links detected in the latest audit.'}</small>
                  </div>
                  <div>{formatNumber((auditBrokenLinks || []).length || selectedPortfolioAudit?.brokenLinkCount || 0)}</div>
                </div>
                <div className="reports-list__row">
                  <div>
                    <strong>Value add</strong>
                    <small>{(auditRecommendations || []).slice(0, 2).map((item) => (typeof item === 'string' ? item : item.recommendation || item.text || '')).filter(Boolean).join(' | ') || 'Run a fresh audit to generate recommendations for stronger leasing value.'}</small>
                  </div>
                  <div>{formatNumber((auditRecommendations || []).length || selectedPortfolioAudit?.recommendationCount || 0)}</div>
                </div>
                {(auditIssues || []).slice(0, 4).map((item, index) => (
                  <div key={`audit-command-issue-${index}`} className="reports-list__row">
                    <div>
                      <strong>Issue</strong>
                      <small>{typeof item === 'string' ? item : item.issue || item.text || 'Review latest finding'}</small>
                    </div>
                    <div>Fix</div>
                  </div>
                ))}
                {!latestAudit && !siteAuditLoading && (
                  <div className="reports-empty">Select a property from the queue, then run an audit if this property has not been scored yet.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  const renderReports = () => (
    <div className="reports-view">
      <div className="reports-shell">
        <div className="reports-hero">
          <div>
            <div className="reports-kicker">Reporting Workspace</div>
            <div className="reports-headline">{selectedPropertyLabel}</div>
            <div className="reports-subhead">
              A property-filtered reporting dashboard for asset managers that combines revenue efficiency, budget, funnel, paid media, analytics, and reputation into one configurable view.
            </div>
          </div>
          <div className="reports-chip-row">
            <div className="reports-chip">Entrata {selectedPropertyId}</div>
            <div className="reports-chip">{rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}</div>
            <div className="reports-chip">{activeReportingPanels.length} live panels</div>
            <div className={reportingSourceBadge.className}>{reportingSourceBadge.label}</div>
            {canEditReportingLayout && (
              <button type="button" className={`reports-admin-toggle ${reportingAdminEnabled ? 'active' : ''}`} onClick={toggleReportingAdminMode}>
                {reportingAdminEnabled ? 'Exit Admin Layout' : 'Admin Layout Mode'}
              </button>
            )}
          </div>
        </div>

        <div className="reports-kpi-grid">
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Total Leads</div>
            <div className="reports-kpi-card__value">{formatNumber(totalLeads)}</div>
            <div className="reports-kpi-card__meta">Apps {formatNumber(totalApplications)} | Leases {formatNumber(totalLeases)}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Applications Completed</div>
            <div className="reports-kpi-card__value">{formatNumber(totalApplications)}</div>
            <div className="reports-kpi-card__meta">Lead-to-completed-app {applicationConversion}% | {funnelMetricSource}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Leases Approved</div>
            <div className="reports-kpi-card__value">{formatNumber(totalLeases)}</div>
            <div className="reports-kpi-card__meta">App-to-approved-lease {applicationToLeaseConversion}% | Lead-to-lease {leaseConversion}%</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Marketing Cost</div>
            <div className="reports-kpi-card__value">{totalBlendedMarketingSpend > 0 ? formatCurrency(totalBlendedMarketingSpend) : 'No data'}</div>
            <div className="reports-kpi-card__meta">Paid media {totalPerformanceMarketingCost > 0 ? formatCurrency(totalPerformanceMarketingCost) : '—'} | CPL {costPerLead !== '—' ? formatCurrency(costPerLead, 2) : '—'}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Lead-to-Lease Conversion</div>
            <div className="reports-kpi-card__value">{leaseConversion}%</div>
            <div className="reports-kpi-card__meta">Leads {formatNumber(totalLeads)} | Leases {formatNumber(totalLeases)}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Cost Per Lead</div>
            <div className="reports-kpi-card__value">{costPerLead !== '—' ? formatCurrency(costPerLead, 2) : 'No spend'}</div>
            <div className="reports-kpi-card__meta">Leads {formatNumber(totalLeads)} | Paid media {totalPerformanceMarketingCost > 0 ? formatCurrency(totalPerformanceMarketingCost) : '—'}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Cost Per Lease</div>
            <div className="reports-kpi-card__value">{roiCostPerLease !== '—' ? formatCurrency(roiCostPerLease, 2) : 'No spend'}</div>
            <div className="reports-kpi-card__meta">ROI {blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'} | Leases {formatNumber(totalLeases)}</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">ROAS</div>
            <div className="reports-kpi-card__value">{blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : 'No spend'}</div>
            <div className="reports-kpi-card__meta">Net revenue {roiTotals.netEffectiveRevenue > 0 ? formatCurrency(roiTotals.netEffectiveRevenue) : '—'} | Spend {roiTotals.marketingSpend > 0 ? formatCurrency(roiTotals.marketingSpend) : '—'}</div>
          </div>
        </div>

        <div className="reports-workspace">
          <aside className="reports-minimap">
            <div className="reports-minimap__header">
              <div>
                <div className="reports-minimap__eyebrow">Mini-Map</div>
                <div className="reports-minimap__title">Jump between reporting panels</div>
              </div>
            </div>
            <div className="reports-minimap__list">
              {reportingLayoutDraft.panelOrder.map((panelId, index) => {
                const panel = REPORTING_PANEL_LIBRARY.find((item) => item.id === panelId);
                const isHidden = reportingLayoutDraft.hiddenPanelIds.includes(panelId);
                if (!panel) return null;

                return (
                  <div key={panelId} className={`reports-minimap__item ${isHidden ? 'is-hidden' : ''}`}>
                    <button type="button" className="reports-minimap__jump" onClick={() => scrollToReportingPanel(panelId)} disabled={isHidden}>
                      <span className="reports-minimap__index">{String(index + 1).padStart(2, '0')}</span>
                      <span>
                        <strong>{panel.title}</strong>
                        <small>{reportingPanelSummaries[panelId]}</small>
                      </span>
                    </button>
                    {reportingAdminEnabled && (
                      <div className="reports-minimap__actions">
                        <button type="button" onClick={() => moveReportingPanel(panelId, -1)} disabled={index === 0}>Up</button>
                        <button type="button" onClick={() => moveReportingPanel(panelId, 1)} disabled={index === reportingLayoutDraft.panelOrder.length - 1}>Down</button>
                        <button type="button" onClick={() => toggleReportingPanelVisibility(panelId)}>
                          {isHidden ? 'Show' : 'Hide'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="reports-minimap__footer">
              {reportingLayoutLoading && <div className="reports-layout-message">Loading saved layout…</div>}
              {reportingLayoutError && <div className="reports-layout-message reports-layout-message--error">{reportingLayoutError}</div>}
              {reportingLayoutNotice && <div className="reports-layout-message reports-layout-message--success">{reportingLayoutNotice}</div>}
              {reportingAdminEnabled && (
                <div className="reports-admin-actions">
                  <button type="button" onClick={resetReportingLayoutDraft} disabled={!reportingLayoutDirty || reportingLayoutSaving}>Reset</button>
                  <button type="button" onClick={saveReportingLayoutDraft} disabled={!reportingLayoutDirty || reportingLayoutSaving}>
                    {reportingLayoutSaving ? 'Saving…' : 'Save Layout'}
                  </button>
                </div>
              )}
              {!reportingAdminEnabled && (
                <div className="reports-layout-hint">
                  {canEditReportingLayout
                    ? 'Admin layout mode unlocks per-property panel ordering and hide/show controls.'
                    : 'This account can review reporting, but layout changes are reserved for roles with reporting admin access.'}
                </div>
              )}
            </div>
          </aside>

          <div className="reports-panels">
            {activeReportingPanels.some((panel) => panel.id === 'roi') && (
              <section id="reporting-panel-roi" className="reports-panel">
                <div className="reports-panel__eyebrow">Revenue Efficiency</div>
                <div className="reports-panel__title">ROAS Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Net Effective Revenue</span><strong>{formatCurrency(roiTotals.netEffectiveRevenue)}</strong><small>{formatCurrency(roiTotals.grossLeaseValue)} gross lease value</small></div>
                  <div className="reports-stat"><span>Blended ROAS</span><strong>{blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : '—'}</strong><small>{formatCurrency(roiTotals.marketingSpend)} spend</small></div>
                  <div className="reports-stat"><span>Cost Per Lease</span><strong>{roiCostPerLease !== '—' ? formatCurrency(roiCostPerLease) : '—'}</strong><small>{formatCurrency(roiTotals.concessionTotal)} concessions</small></div>
                </div>
                <div className="reports-list">
                  {roiSourceBreakdown.slice(0, 5).map((item) => (
                    <div key={item.sourceKey} className="reports-list__row">
                      <div>
                        <strong>{item.sourceLabel}</strong>
                        <small>{item.attributedLeases} leases | {formatCurrency(item.marketingSpend)} spend</small>
                      </div>
                      <div>{item.roas != null ? `${item.roas.toFixed(2)}x ROAS` : 'No ROAS yet'}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'budget') && (
              <section id="reporting-panel-budget" className="reports-panel">
                <div className="reports-panel__eyebrow">Spend Control</div>
                <div className="reports-panel__title">Budget Tracking</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Total Marketing</span><strong>{formatCurrency(totalBlendedMarketingSpend)}</strong><small>{activeMarketingSpendLineCount} active marketing GL lines</small></div>
                  <div className="reports-stat"><span>Performance Marketing</span><strong>{formatCurrency(totalPerformanceMarketingCost)}</strong><small>Paid media + PPC management</small></div>
                  <div className="reports-stat"><span>Tracked Cost Lines</span><strong>{formatNumber(activeMarketingSpendLineCount)}</strong><small>{marketingSpendBreakdown.length - activeMarketingSpendLineCount} excluded from totals</small></div>
                </div>
                <div className="reports-list">
                  {marketingSpendBreakdown.slice(0, 6).map((item) => (
                    <div key={item.label} className={`reports-list__row marketing-spend-report-row ${item.excluded ? 'is-excluded' : ''}`}>
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.excluded ? 'Excluded from selected reporting window totals' : 'Included in selected reporting window totals'}</small>
                      </div>
                      <div className="marketing-spend-report-row__actions">
                        <button
                          type="button"
                          className={`marketing-spend-toggle ${item.excluded ? 'is-excluded' : 'is-included'}`}
                          aria-pressed={!item.excluded}
                          onClick={() => toggleMarketingSpendLine(item.label)}
                          title={item.excluded ? 'Include this spend line' : 'Exclude this spend line from totals'}
                        >
                          <span className="marketing-spend-toggle__track">
                            <span className="marketing-spend-toggle__knob" />
                          </span>
                          <span>{item.excluded ? 'Excluded' : 'Included'}</span>
                        </button>
                        <div>{formatCurrency(item.amount)}</div>
                      </div>
                    </div>
                  ))}
                  {marketingSpendBreakdown.length === 0 && <div className="reports-empty">No marketing spend rows matched this date range.</div>}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'entrata') && (
              <section id="reporting-panel-entrata" className="reports-panel">
                <div className="reports-panel__eyebrow">Leads to Leases</div>
                <div className="reports-panel__title">Entrata Funnel</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Lead to App</span><strong>{applicationConversion}%</strong><small>{formatNumber(totalApplications)} applications</small></div>
                  <div className="reports-stat"><span>App to Lease</span><strong>{applicationToLeaseConversion}%</strong><small>{formatNumber(totalLeases)} leases</small></div>
                  <div className="reports-stat"><span>Lead to Lease</span><strong>{leaseConversion}%</strong><small>{attributedLeaseCount} attributed | {unattributedLeaseCount} unattributed</small></div>
                </div>
                <div className="reports-list">
                  {Object.entries(leadStatusBreakdown).slice(0, 6).map(([status, count]) => (
                    <div key={status} className="reports-list__row">
                      <div>
                        <strong>{status}</strong>
                        <small>Current lead status count in scope</small>
                      </div>
                      <div>{formatNumber(count)}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'heatmaps-audit') && renderHeatmapAuditPanel()}

            {activeReportingPanels.some((panel) => panel.id === 'google-ads') && (
              <section id="reporting-panel-google-ads" className="reports-panel">
                <div className="reports-panel__eyebrow">Paid Search</div>
                <div className="reports-panel__title">Google Ads Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Clicks</span><strong>{googleAdsLoading ? '…' : formatNumber(googleAdsOverview?.clicks)}</strong><small>{googleAdsLoading ? 'Loading…' : formatNumber(googleAdsOverview?.impressions)} impressions</small></div>
                  <div className="reports-stat"><span>Spend</span><strong>{googleAdsLoading ? '…' : formatCurrency(googleAdsOverview?.cost)}</strong><small>{googleAdsLoading ? 'Loading…' : formatNumber(googleAdsOverview?.conversions, 1)} conversions</small></div>
                  <div className="reports-stat"><span>CTR</span><strong>{googleAdsLoading ? '…' : formatPercent(googleAdsOverview?.ctr, 1)}</strong><small>{googleAdsStatusMessage || 'Live paid search view'}</small></div>
                </div>
                <div className="reports-list">
                  {googleAdsCampaigns.slice(0, 5).map((item) => (
                    <div key={item.campaignName} className="reports-list__row">
                      <div>
                        <strong>{item.campaignName}</strong>
                        <small>{formatCurrency(item.current.cost)} spend | {formatNumber(item.current.conversions, 1)} conversions</small>
                      </div>
                      <div>{formatNumber(item.current.clicks)} clicks</div>
                    </div>
                  ))}
                  {googleAdsCampaigns.length === 0 && <div className="reports-empty">{googleAdsStatusMessage || 'No Google Ads campaign data is available for this property.'}</div>}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'ga4') && (
              <section id="reporting-panel-ga4" className="reports-panel">
                <div className="reports-panel__eyebrow">Behavior + Demand</div>
                <div className="reports-panel__title">Google Analytics Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Sessions</span><strong>{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4Sessions)}</strong><small>{ga4Loading ? 'Loading…' : ga4Blocked ? ga4StatusMessage : `${formatNumber(ga4NewUsers)} new users`}</small></div>
                  <div className="reports-stat"><span>Tracked Events</span><strong>{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4EventTotal)}</strong><small>{ga4Loading ? 'Loading…' : ga4Blocked ? 'Access required' : formatPercent(ga4ApplyPage?.abandonmentRate, 1)} apply drop-off</small></div>
                  <div className="reports-stat"><span>Top Channel</span><strong>{ga4AcquisitionChannels[0]?.channel || '—'}</strong><small>{ga4StatusMessage || 'Top GA4 acquisition channel in range'}</small></div>
                </div>
                <div className="reports-list">
                  {ga4AcquisitionChannels.slice(0, 5).map((item) => (
                    <div key={item.channel} className="reports-list__row">
                      <div>
                        <strong>{item.channel}</strong>
                        <small>{formatPercent(item.current.engagementRate, 1)} engagement | {formatSignedPercent(item.delta.sessions, 1)} vs prior</small>
                      </div>
                      <div>{formatNumber(item.current.sessions)} sessions</div>
                    </div>
                  ))}
                  {ga4AcquisitionChannels.length === 0 && <div className="reports-empty">{ga4StatusMessage || 'No GA4 acquisition data is available for this property.'}</div>}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'opiniion') && (
              <section id="reporting-panel-opiniion" className="reports-panel">
                <div className="reports-panel__eyebrow">Resident Sentiment</div>
                <div className="reports-panel__title">Opiniion Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Average Rating</span><strong>{reputationLoading ? '…' : formatNumber(reputationAverageRating, 2)}</strong><small>{reputationLoading ? 'Loading…' : formatNumber(reputationReviewCount)} reviews</small></div>
                  <div className="reports-stat"><span>Response Rate</span><strong>{reputationLoading ? '…' : formatPercent(reputationResponseRate, 1)}</strong><small>{reputationStatusMessage || 'Latest Opiniion response coverage'}</small></div>
                  <div className="reports-stat"><span>Sentiment Score</span><strong>{reputationLoading ? '…' : formatNumber(reputationSentimentScore, 1)}</strong><small>{reputationWindow?.start_date || 'Current window'} to {reputationWindow?.end_date || 'today'}</small></div>
                </div>
                <div className="reports-list">
                  {reputationSummary.slice(0, 5).map((item, index) => (
                    <div key={`${item.label || 'summary'}-${index}`} className="reports-list__row">
                      <div>
                        <strong>{item.label || 'Summary point'}</strong>
                        <small>{item.detail || 'Reputation summary insight'}</small>
                      </div>
                      <div>{item.value || '—'}</div>
                    </div>
                  ))}
                  {reputationSummary.length === 0 && <div className="reports-empty">{reputationStatusMessage || 'No Opiniion summary metrics are available for this property.'}</div>}
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'local-falcon') && (
              <section id="reporting-panel-local-falcon" className="reports-panel">
                <div className="reports-panel__eyebrow">Local SEO</div>
                <div className="reports-panel__title">Local Falcon Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Share of Local Voice</span><strong>{localFalconLoading ? '…' : formatNumber(localFalconOverview?.avgSolv, 2)}</strong><small>{localFalconLoading ? 'Loading…' : `${formatNumber(localFalconOverview?.scanCount)} scans in range`}</small></div>
                  <div className="reports-stat"><span>Average Rank</span><strong>{localFalconLoading ? '…' : formatNumber(localFalconOverview?.avgArp, 2)}</strong><small>{localFalconLoading ? 'Loading…' : `${formatNumber(localFalconOverview?.keywordCount)} tracked keywords`}</small></div>
                  <div className="reports-stat"><span>Top Rank Position</span><strong>{localFalconLoading ? '…' : formatNumber(localFalconOverview?.avgAtrp, 2)}</strong><small>{localFalconStatusMessage || localFalconOverview?.lastRunDate || localFalconData?.Status?.message || 'Latest Local Falcon scan set'}</small></div>
                </div>
                <div className="reports-panel__grid reports-panel__grid--three" style={{ marginTop: '0.9rem' }}>
                  <div className="reports-stat"><span>Found In</span><strong>{localFalconLoading ? '…' : `${formatNumber(localFalconOverview?.foundInPercent, 1)}%`}</strong><small>{formatNumber(localFalconOverview?.foundIn)} of {formatNumber(localFalconOverview?.points)} grid points</small></div>
                  <div className="reports-stat"><span>Latest Keyword</span><strong>{localFalconLoading ? '…' : shortenLabel(localFalconLatestScan?.keyword || localFalconLatestReport?.keyword || '—', 28)}</strong><small>{localFalconLatestScan?.date || localFalconOverview?.lastRunDate || 'Latest scan date pending'}</small></div>
                  <div className="reports-stat"><span>Grid</span><strong>{localFalconLoading ? '…' : `${formatNumber(localFalconGridSize)}x${formatNumber(localFalconGridSize)}`}</strong><small>{localFalconLatestScan?.radius ? `${localFalconLatestScan.radius}${localFalconLatestScan.measurement || ''} radius` : 'Grid radius pending'}</small></div>
                </div>

                {(localFalconHeatmapUrl || localFalconReportUrl || localFalconPdfUrl) && (
                  <div className="local-falcon-report-card">
                    <div className="local-falcon-report-card__media">
                      {localFalconHeatmapUrl ? (
                        <img src={localFalconHeatmapUrl} alt="Local Falcon heatmap" />
                      ) : (
                        <div className="reports-empty">No heatmap image is available for the latest scan.</div>
                      )}
                    </div>
                    <div className="local-falcon-report-card__content">
                      <div className="reports-panel__eyebrow">Latest Scan Detail</div>
                      <div className="reports-list">
                        <div className="reports-list__row"><div><strong>{localFalconLatestScan?.keyword || localFalconLatestReport?.keyword || 'Latest Local Falcon scan'}</strong><small>{localFalconLatestScan?.date || localFalconOverview?.lastRunDate || 'Scan date pending'}</small></div><div>{formatNumber(localFalconOverview?.avgSolv, 2)} SoLV</div></div>
                        <div className="reports-list__row"><div><strong>{localFalconLocation?.match?.name || localFalconLocation?.name || 'Matched Local Falcon location'}</strong><small>{localFalconLocation?.placeId || 'Place ID pending'}</small></div><div>{formatNumber(localFalconCompetitors.length)} competitors</div></div>
                      </div>
                      <div className="local-falcon-report-card__actions">
                        {localFalconReportUrl && <a href={localFalconReportUrl} target="_blank" rel="noreferrer">Open Report</a>}
                        {localFalconPdfUrl && <a href={localFalconPdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                      </div>
                    </div>
                  </div>
                )}

                {localFalconGridPoints.length > 0 && (
                  <div className="local-falcon-section">
                    <div className="reports-panel__eyebrow">Grid Rank Map</div>
                    <div className="local-falcon-grid" style={{ gridTemplateColumns: `repeat(${Math.max(localFalconGridSize, 1)}, minmax(0, 1fr))` }}>
                      {localFalconGridPoints.map((point) => (
                        <div key={point.index} className={`local-falcon-grid__cell local-falcon-grid__cell--${getLocalFalconRankTone(point.rank)}`}>
                          <strong>{point.rankLabel}</strong>
                          <small>{formatNumber(point.resultCount)} results</small>
                        </div>
                      ))}
                    </div>
                    <div className="local-falcon-grid-legend">
                      <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--strong" /> 1-3 strong</span>
                      <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--moderate" /> 4-10 moderate</span>
                      <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--weak" /> 11-20 weak</span>
                      <span><i className="local-falcon-grid-legend__dot local-falcon-grid-legend__dot--missing" /> 20+ missing</span>
                    </div>
                  </div>
                )}

                {localFalconTrendChartData.length > 1 && (
                  <div className="local-falcon-section">
                    <div className="reports-panel__eyebrow">Ranking Trend</div>
                    <MeasuredChart className="analytics-chart analytics-chart--compact">
                      {({ width, height }) => (
                        <LineChart width={width} height={height} data={localFalconTrendChartData} margin={CHART_MARGIN_STANDARD}>
                          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_LIGHT} vertical={false} />
                          <XAxis dataKey="name" stroke={CHART_AXIS_LIGHT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                          <YAxis yAxisId="rank" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} reversed />
                          <YAxis yAxisId="solv" orientation="right" stroke={CHART_AXIS_LIGHT_SOFT} tick={{ fontSize: 11, fill: CHART_COLOR_TAN }} />
                          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                          <Line yAxisId="rank" type="monotone" dataKey="arp" name="ARP" stroke={CHART_COLOR_GOLD} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_GOLD }} />
                          <Line yAxisId="rank" type="monotone" dataKey="atrp" name="ATRP" stroke={CHART_COLOR_ORANGE} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_ORANGE }} />
                          <Line yAxisId="solv" type="monotone" dataKey="solv" name="SoLV" stroke={CHART_COLOR_GREEN} strokeWidth={2} dot={{ r: 2, fill: CHART_COLOR_GREEN }} />
                        </LineChart>
                      )}
                    </MeasuredChart>
                  </div>
                )}

                {localFalconCompetitors.length > 0 && (
                  <div className="local-falcon-section">
                    <div className="reports-panel__eyebrow">Competitor Comparison</div>
                    <div className="local-falcon-competitor-table">
                      <div className="local-falcon-competitor-table__head">Business</div>
                      <div className="local-falcon-competitor-table__head">ARP</div>
                      <div className="local-falcon-competitor-table__head">ATRP</div>
                      <div className="local-falcon-competitor-table__head">SoLV</div>
                      <div className="local-falcon-competitor-table__head">Found</div>
                      <div className="local-falcon-competitor-table__head">Rating</div>
                      {localFalconCompetitors.slice(0, 12).map((item) => (
                        <React.Fragment key={item.placeId || item.name}>
                          <div className="local-falcon-competitor-table__cell">
                            <strong>{item.name || 'Unnamed competitor'}{item.isTarget ? ' (Selected)' : ''}</strong>
                            <small>{item.address || item.placeId || 'Address unavailable'}</small>
                          </div>
                          <div className="local-falcon-competitor-table__cell">{formatNumber(item.arp, 2)}</div>
                          <div className="local-falcon-competitor-table__cell">{formatNumber(item.atrp, 2)}</div>
                          <div className="local-falcon-competitor-table__cell">{formatNumber(item.solv, 2)}</div>
                          <div className="local-falcon-competitor-table__cell">{formatNumber(item.foundIn)} pts</div>
                          <div className="local-falcon-competitor-table__cell">{item.rating != null ? `${formatNumber(item.rating, 1)} (${formatNumber(item.reviews)})` : '—'}</div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                <div className="reports-list">
                  {localFalconKeywords.slice(0, 5).map((item) => (
                    <div key={item.keyword || item.lastScanReportKey} className="reports-list__row">
                      <div>
                        <strong>{item.keyword || 'Tracked keyword'}</strong>
                        <small>SoLV {formatNumber(item.solv, 2)} | ARP {formatNumber(item.arp, 2)} | {formatNumber(item.scanCount)} scans</small>
                      </div>
                      <div>{item.solvMove != null ? `${formatSignedPercent(item.solvMove / 100, 1)} SoLV` : '—'}</div>
                    </div>
                  ))}
                  {localFalconKeywords.length === 0 && localFalconReports.slice(0, 5).map((item) => (
                    <div key={item.reportKey || item.keyword} className="reports-list__row">
                      <div>
                        <strong>{item.keyword || 'Local Falcon scan'}</strong>
                        <small>{item.date || 'Latest scan'} | {item.gridSize || 'Grid'} {item.radius ? `${item.radius}${item.measurement || ''}` : ''}</small>
                      </div>
                      <div>{formatNumber(item.solv, 2)} SoLV</div>
                    </div>
                  ))}
                  {localFalconKeywords.length === 0 && localFalconReports.length === 0 && <div className="reports-empty">{localFalconStatusMessage || 'No Local Falcon reports are available for this property and date range.'}</div>}
                </div>
                {(localFalconReportUrl || localFalconHeatmapUrl || localFalconPdfUrl || localFalconLocation?.placeId) && (
                  <div className="reports-list" style={{ marginTop: '0.9rem' }}>
                    <div className="reports-list__row">
                      <div>
                        <strong>{localFalconLocation?.match?.name || localFalconLocation?.name || 'Matched Local Falcon location'}</strong>
                        <small>{localFalconLocation?.placeId || 'Place ID pending'}</small>
                      </div>
                      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {localFalconReportUrl && <a href={localFalconReportUrl} target="_blank" rel="noreferrer">Open report</a>}
                        {localFalconHeatmapUrl && <a href={localFalconHeatmapUrl} target="_blank" rel="noreferrer">Heatmap</a>}
                        {localFalconPdfUrl && <a href={localFalconPdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'meta-ads') && (
              <section id="reporting-panel-meta-ads" className="reports-panel">
                <div className="reports-panel__eyebrow">Paid Social</div>
                <div className="reports-panel__title">Meta Ads Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Clicks</span><strong>{metaAdsLoading ? '…' : formatNumber(metaAdsOverview?.clicks)}</strong><small>{metaAdsLoading ? 'Loading…' : formatCurrency(metaAdsOverview?.spend)} spend</small></div>
                  <div className="reports-stat"><span>CTR</span><strong>{metaAdsLoading ? '…' : formatPercent(metaAdsOverview?.ctr, 1)}</strong><small>{metaAdsLoading ? 'Loading…' : formatNumber(metaAdsOverview?.frequency, 2)} frequency</small></div>
                  <div className="reports-stat"><span>Results</span><strong>{metaAdsLoading ? '…' : formatNumber(metaAdsOverview?.results, 1)}</strong><small>{metaAdsStatusMessage || `${metaAdsOverview?.resultLabel || 'Results'} in range`}</small></div>
                </div>
                <div className="reports-list">
                  {metaAdsCampaigns.slice(0, 5).map((item) => (
                    <div key={item.campaignName} className="reports-list__row">
                      <div>
                        <strong>{item.campaignName}</strong>
                        <small>{formatCurrency(item.current.spend)} spend | {formatPercent(item.current.ctr, 1)} CTR</small>
                      </div>
                      <div>{formatNumber(item.current.clicks)} clicks</div>
                    </div>
                  ))}
                  {metaAdsCampaigns.length === 0 && <div className="reports-empty">{metaAdsStatusMessage || 'No Meta Ads data is available for this property.'}</div>}
                </div>
              </section>
            )}

            <div className="reports-pipeline-grid">
              {renderPipelineStatusCard('YTD ROI Backfill Status', roiPipelineStatus?.roi_ytd_backfill)}
              {renderPipelineStatusCard('Daily ROI Refresh Status', roiPipelineStatus?.roi_daily_refresh)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderReputation = () => (
    <div className="reputation-view">
      <div className="reputation-hero">
        <div>
          <div className="reputation-kicker">Resident Sentiment Layer</div>
          <div className="reputation-headline">Reputation</div>
          <div className="reputation-subhead">
            Opiniion-backed reputation monitoring for {selectedPropertyLabel}. This view reads the live connector when available and falls back to the last cached Firestore snapshot if the refresh path is unavailable.
          </div>
        </div>
        <div className="reputation-pill-row">
          <div className="reputation-pill">{selectedPropertyLabel}</div>
          <div className="reputation-pill">
            {reputationWindow?.startDate && reputationWindow?.endDate
              ? `${reputationWindow.startDate} to ${reputationWindow.endDate}`
              : `${formatDateInputValue(rangeDates.start)} to ${formatDateInputValue(rangeDates.end)}`}
          </div>
          <div className="reputation-pill">
            {reputationLoading ? 'Refreshing…' : reputationError ? 'Cached / blocked' : 'Live connector'}
          </div>
        </div>
      </div>

      <div className="property-info-grid">
        <div className="property-info-card">
          <div className="property-info-card__label">Average Rating</div>
          <div className="property-info-card__value">{reputationLoading ? '…' : formatNumber(reputationAverageRating, 2)}</div>
          <div className="property-info-card__meta">Normalized from the Opiniion payload when a rating-like field is present.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Review Count</div>
          <div className="property-info-card__value">{reputationLoading ? '…' : formatNumber(reputationReviewCount)}</div>
          <div className="property-info-card__meta">Public review volume recognized in the latest response.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Response Rate</div>
          <div className="property-info-card__value">{reputationLoading ? '…' : formatPercent(reputationResponseRate, 1)}</div>
          <div className="property-info-card__meta">Management reply coverage if the API exposes a response-rate field.</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Sentiment Score</div>
          <div className="property-info-card__value">{reputationLoading ? '…' : formatPercent(reputationSentimentScore, 1)}</div>
          <div className="property-info-card__meta">Positive-share / satisfaction-style metric when available.</div>
        </div>
      </div>

      <div className="property-info-panels" style={{ marginTop: '1rem' }}>
        <div className="property-info-panel property-info-panel--wide">
          <div className="property-info-panel__header">
            <div>
              <div className="property-info-panel__eyebrow">Recent Feedback</div>
              <h3 className="property-info-panel__title">Latest reviews pulled into the dashboard</h3>
            </div>
          </div>
          {reputationLoading ? (
            <div className="property-info-panel__empty">Loading reputation feed…</div>
          ) : reputationRecentReviews.length > 0 ? (
            <div className="reputation-review-list">
              {reputationRecentReviews.map((review, index) => (
                <div key={`${review.author}-${review.publishedAt || index}`} className="reputation-review-card">
                  <div className="reputation-review-card__top">
                    <div>
                      <div className="reputation-review-card__author">{review.author || 'Anonymous'}</div>
                      <div className="reputation-review-card__meta">
                        {[review.source, review.publishedAt].filter(Boolean).join(' | ') || 'Review item'}
                      </div>
                    </div>
                    <div className="reputation-review-card__rating">
                      {review.rating != null ? `${formatNumber(review.rating, 1)} / 5` : 'No rating'}
                    </div>
                  </div>
                  <div className="reputation-review-card__body">
                    {review.message || 'This review row did not include a text body in the normalized payload.'}
                  </div>
                  {review.response && (
                    <div className="reputation-review-card__response">
                      Management response: {review.response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="property-info-panel__empty">
              No recognizable review rows were returned yet. Once we confirm the exact Opiniion reputation route and each property’s location mapping, this section should populate automatically.
            </div>
          )}
        </div>

        <div className="property-info-panel">
          <div className="property-info-panel__header">
            <div>
              <div className="property-info-panel__eyebrow">Connector Status</div>
              <h3 className="property-info-panel__title">What the integration recognized</h3>
            </div>
          </div>
          <div className="property-info-panel__stack">
            {reputationError ? (
              <div className="property-info-panel__empty">{reputationError}</div>
            ) : (
              <div className="property-info-panel__empty">
                Live Opiniion refresh succeeded for this property and date window.
              </div>
            )}
            {reputationSummary.map((line) => (
              <div key={line} className="property-info-panel__row">
                <div className="property-info-panel__row-label">{line}</div>
              </div>
            ))}
            <div className="property-info-panel__row">
              <div className="property-info-panel__row-label">Payload keys</div>
              <div className="property-info-panel__row-value">
                {reputationRawKeys.length ? reputationRawKeys.join(', ') : 'No top-level keys captured yet'}
              </div>
            </div>
            <div className="property-info-panel__row">
              <div className="property-info-panel__row-label">Snapshot path</div>
              <div className="property-info-panel__row-value">properties/{selectedPropertyId}/analytics/reputation_dashboard</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWebsiteManager = () => (
    <div className="website-manager-view">
      <div className="website-manager-hero">
        <div>
          <div className="website-manager-kicker">WordPress Content Control Layer</div>
          <div className="website-manager-headline">Website Editor</div>
          <div className="website-manager-subhead">
            Give on-site and regional teams a property-scoped place to update approved website messaging without routing every request through the web team. This tab stores the platform classification and the content payload we want to push into WordPress.
          </div>
        </div>
        <div className="website-manager-pill-row">
          <div className="website-manager-pill">{selectedPropertyLabel}</div>
          <div className={`website-manager-pill website-manager-pill--${websiteManagerEditable ? 'editable' : 'blocked'}`}>
            {websitePlatformMeta.label}
          </div>
          <div className="website-manager-pill">
            {websiteManagerLoading ? 'Loading saved content…' : websiteManagerDirty ? 'Unsaved changes' : 'All changes saved'}
          </div>
        </div>
      </div>

      <div className="website-manager-summary-grid">
        <div className="website-manager-card">
          <div className="website-manager-card__label">Platform status</div>
          <div className="website-manager-card__value">{websitePlatformMeta.label}</div>
          <div className="website-manager-card__meta">{websitePlatformMeta.description}</div>
        </div>
        <div className="website-manager-card">
          <div className="website-manager-card__label">Dashboard editable</div>
          <div className="website-manager-card__value">{websiteManagerEditable ? 'Yes' : 'No'}</div>
          <div className="website-manager-card__meta">
            {websiteManagerEditable
              ? 'This property can keep content drafts here for WordPress injection.'
              : 'Entrata and non-WordPress sites stay read-only until the platform is changed.'}
          </div>
        </div>
        <div className="website-manager-card">
          <div className="website-manager-card__label">Configured fields</div>
          <div className="website-manager-card__value">
            {Object.values(websiteManagerDraft.content).filter((value) => String(value || '').trim()).length}
          </div>
          <div className="website-manager-card__meta">Fields with non-empty content ready for review or deployment.</div>
        </div>
        <div className="website-manager-card">
          <div className="website-manager-card__label">Entrata live sync</div>
          <div className="website-manager-card__value">
            {getSnapshotTimestampLabel(websiteManagerDraft.wordpressSync.latestEntrataSyncAt)}
          </div>
          <div className="website-manager-card__meta">Pricing and specials snapshots refresh on a four-hour cadence.</div>
        </div>
        <div className="website-manager-card">
          <div className="website-manager-card__label">WordPress key</div>
          <div className="website-manager-card__value">
            {websiteManagerDraft.wordpressSiteKey || 'Not set'}
          </div>
          <div className="website-manager-card__meta">Use this for the eventual site-level sync target or content mapping job.</div>
        </div>
      </div>

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

      <div className="website-manager-layout">
        <div className="website-manager-panel website-manager-panel--editor">
          <div className="website-manager-section-head">
            <div>
              <div className="website-manager-panel__eyebrow">Property setup</div>
              <h3 className="website-manager-panel__title">Website classification and sync metadata</h3>
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

          <div className="website-manager-section-head">
            <div>
              <div className="website-manager-panel__eyebrow">Content fields</div>
              <h3 className="website-manager-panel__title">Editable payload for the site</h3>
            </div>
          </div>

          <div className="website-manager-groups">
            {websiteManagerSchemaGroups.map((group) => (
              <div key={group.id} className="website-manager-group">
                <div className="website-manager-group__title">{group.label}</div>
                <div className="website-manager-form-grid">
                  {group.fields.map((field) => (
                    <label key={field.key} className={`website-manager-field ${field.type === 'richtext' ? 'website-manager-field--wide' : ''}`}>
                      <span className="website-manager-field__label">{field.label}</span>
                      {field.type === 'richtext' ? (
                        <textarea
                          value={websiteManagerDraft.content[field.key]}
                          onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                          className="website-manager-field__input website-manager-field__input--textarea"
                          placeholder={field.placeholder || ''}
                          disabled={!websiteManagerEditable || !canEditWebsiteManager}
                        />
                      ) : (
                        <input
                          type="text"
                          value={websiteManagerDraft.content[field.key]}
                          onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                          className="website-manager-field__input"
                          placeholder={field.placeholder || ''}
                          disabled={!websiteManagerEditable || !canEditWebsiteManager}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="website-manager-actions">
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
        </div>

        <div className="website-manager-panel website-manager-panel--sidebar">
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
      </div>
    </div>
  );

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
      setAdminInviteLink(payload?.invite?.actionLink || '');
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
      setAdminPasswordResetLink(payload?.reset?.actionLink || '');
      await loadAdminAccess();
    } catch (error) {
      setAdminAccessError(error.message || 'Unable to create a password reset link.');
      setAdminAccessLoading(false);
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
        </div>
      </div>

      {(adminAccessError || adminAccessNotice) && (
        <div className={`admin-access-banner ${adminAccessError ? 'admin-access-banner--error' : 'admin-access-banner--success'}`}>
          {adminAccessError || adminAccessNotice}
        </div>
      )}

      {adminInviteLink && (
        <div className="admin-access-banner admin-access-banner--info">
          Invite link: <a href={adminInviteLink} target="_blank" rel="noreferrer">{adminInviteLink}</a>
        </div>
      )}

      {adminPasswordResetLink && (
        <div className="admin-access-banner admin-access-banner--info">
          Password reset link: <a href={adminPasswordResetLink} target="_blank" rel="noreferrer">{adminPasswordResetLink}</a>
        </div>
      )}

      {(websiteSchemaError || websiteSchemaNotice) && (
        <div className={`admin-access-banner ${websiteSchemaError ? 'admin-access-banner--error' : 'admin-access-banner--success'}`}>
          {websiteSchemaError || websiteSchemaNotice}
        </div>
      )}

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

          <div className="admin-access-property-picker">
            {adminProperties.map((property) => (
              <label key={property.id} className="admin-access-property-pill">
                <input
                  type="checkbox"
                  checked={adminInviteDraft.propertyIds.includes(property.id)}
                  onChange={() => toggleAdminInviteProperty(property.id)}
                />
                <span>{property.name}</span>
              </label>
            ))}
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

          <div className="admin-access-user-list">
            {adminUsers.map((user) => (
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

              <div className="admin-access-property-picker">
                {adminProperties.map((property) => (
                  <label key={property.id} className="admin-access-property-pill">
                    <input
                      type="checkbox"
                      checked={adminUserDraft.propertyIds.includes(property.id)}
                      onChange={() => toggleAdminUserProperty(property.id)}
                    />
                    <span>{property.name}</span>
                  </label>
                ))}
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
              <div key={group.id} className="website-schema-group">
                <div className="website-schema-group__top">
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

      <div className="admin-access-panel">
        <div className="admin-access-section-head">
          <div className="admin-access-panel__eyebrow">Audit</div>
          <h3 className="admin-access-panel__title">Recent access activity</h3>
        </div>

        {adminAuditLogs.length ? (
          <div className="admin-access-audit-list">
            {adminAuditLogs.map((log) => {
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
          </div>
        ) : (
          <div className="admin-access-empty">No access changes have been logged yet.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className={`dashboard-container ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${activeTab === 'reports' ? 'dashboard-container--reports' : ''}`}>
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

      {/* Main Content */}
      <div className={`main-content ${activeTab === 'reports' ? 'main-content--reports' : ''}`}>
        <div className={`header ${activeTab === 'reports' ? 'header--reports' : ''}`}>
          {activeTab === 'admin' || activeTab === 'audit' ? (
            <div className="property-selector property-selector--admin">
              <span className="property-selector__label">{activeTab === 'audit' ? 'Portfolio scope' : 'Access scope'}</span>
              <div className="property-selector__admin-summary">
                {activeTab === 'audit'
                  ? 'Cross-property audit command center for internal triage and design follow-up.'
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
              <span className="header-status__meta">v2.0 - Live Entrata Data</span>
              <span className="header-status__name">{displayName}</span>
              {currentUser?.email && (
                <span className="header-status__email">{currentUser.email}</span>
              )}
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

        <div className={`content-body ${activeTab === 'reports' ? 'content-body--reports' : ''}`}>
          <div className="dashboard-title-row">
            <h1 className="title">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            {activeTab !== 'website manager' && activeTab !== 'admin' && activeTab !== 'audit' && (
              <div className="global-date-controls">
                <div className="global-date-controls__picker">
                  <div className="global-date-controls__label">Date range</div>
                  <div className="global-date-controls__control">
                    <Calendar size={16} className="global-date-controls__icon" />
                    <select value={draftDateRange} onChange={(e) => handleDateRangeChange(e.target.value)} className="global-date-controls__select">
                      <option value="7d">Last 7 Days</option>
                      <option value="14d">Last 14 Days</option>
                      <option value="28d">Last 28 Days</option>
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
              </div>
            )}
          </div>

          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'website manager' && renderWebsiteManager()}
          {activeTab === 'property info' && renderPropertyInfo()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'audit' && renderAuditCommandCenter()}
          {activeTab === 'analytics' && renderAnalytics()}
          {activeTab === 'reputation' && renderReputation()}
          {activeTab === 'tasks' && renderTasks()}
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
