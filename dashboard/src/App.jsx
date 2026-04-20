import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import {
  ADMIN_ACCESS_USERS_URL,
  GA4_DASHBOARD_URL,
  GOOGLE_ADS_DASHBOARD_URL,
  META_ADS_DASHBOARD_URL,
  PROPERTY_REPORTING_OVERVIEW_URL,
  RENDER_API_BASE_URL,
  REPORTING_LAYOUT_URL,
  REPUTATION_DASHBOARD_URL,
  ROI_PIPELINE_STATUS_URL,
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
  WEBSITE_MANAGER_FIELD_GROUPS,
  WEBSITE_MANAGER_TOKEN_DEFINITIONS,
  getWebsitePlatformMeta,
  isWebsiteManagerEditable,
  normalizeWebsiteManagerRecord,
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
  X
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, LineChart, Line
} from 'recharts';

const FALLBACK_AVAILABILITY_PRICE_KEYS = [
  'bestPrice',
  'bestprice',
  'effectiveRent',
  'effective_rent',
  'rent',
  'marketRent',
  'price',
  'unitRent'
];

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
const ACTIVE_ADVERTISING_PATTERNS = [
  'apartments.com',
  'google ads',
  'facebook ads',
  'meta ads',
  'social ads',
  'rent college pads',
  'rentcollegepads',
  'zillow',
  'find my place',
  'myplace',
  'geofencing',
  'digible'
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
const REPORTING_PANEL_LIBRARY = [
  { id: 'executive', title: 'Executive Snapshot', eyebrow: 'Asset Manager Lens' },
  { id: 'roi', title: 'ROI Metrics', eyebrow: 'Revenue Efficiency' },
  { id: 'budget', title: 'Budget Tracking', eyebrow: 'Spend Control' },
  { id: 'entrata', title: 'Entrata Funnel', eyebrow: 'Leads to Leases' },
  { id: 'google-ads', title: 'Google Ads', eyebrow: 'Paid Search' },
  { id: 'ga4', title: 'Google Analytics', eyebrow: 'Behavior + Demand' },
  { id: 'opiniion', title: 'Opiniion', eyebrow: 'Resident Sentiment' },
  { id: 'meta-ads', title: 'Meta Ads', eyebrow: 'Paid Social' }
];
const REPORTING_PANEL_IDS = REPORTING_PANEL_LIBRARY.map((panel) => panel.id);
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: TAB_PERMISSIONS.dashboard },
  { id: 'website manager', label: 'Website Manager', icon: Globe, permission: TAB_PERMISSIONS['website manager'] },
  { id: 'property info', label: 'Property Info', icon: Home, permission: TAB_PERMISSIONS['property info'] },
  { id: 'reports', label: 'Reports', icon: FileText, permission: TAB_PERMISSIONS.reports },
  { id: 'analytics', label: 'Analytics', icon: TrendingUp, permission: TAB_PERMISSIONS.analytics },
  { id: 'reputation', label: 'Reputation', icon: MessageSquareText, permission: TAB_PERMISSIONS.reputation },
  { id: 'notes', label: 'Notes', icon: ClipboardList, permission: TAB_PERMISSIONS.notes },
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

const PROFILE_AVATAR_BUCKET = 'profile-avatars';
const PROFILE_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_AVATAR_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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
  let parts = null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    parts = normalized.split('-');
  } else if (/^\d{4}\/\d{2}\/\d{2}$/.test(normalized)) {
    parts = normalized.split('/');
  } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    const [month, day, year] = normalized.split('/');
    parts = [year, month, day];
  }

  if (!parts) return null;

  const [year, month, day] = parts.map((part) => Number.parseInt(part, 10));
  if (![year, month, day].every(Number.isFinite)) return null;

  return new Date(year, month - 1, day);
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

const isActiveAdvertisingInvoice = (invoice) => {
  const searchSpace = collectPrimitiveValues(invoice).join(' ').toLowerCase();
  return ACTIVE_ADVERTISING_PATTERNS.some((pattern) => searchSpace.includes(pattern));
};

const getApplicationKey = (event) => {
  const candidates = [
    event.leaseIntervalId,
    event.leaseId,
    event.applicationId,
    event.applicantId,
    event.eventId
  ];

  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return String(stableId);
  return JSON.stringify(event);
};

const getLeaseKey = (event) => {
  const candidates = [
    event.leaseIntervalId,
    event.leaseId,
    event.applicationId,
    event.eventId
  ];

  const stableId = candidates.find((value) => value != null && value !== '');
  if (stableId) return String(stableId);
  return JSON.stringify(event);
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
  if (stableId) return String(stableId);
  return JSON.stringify(lead);
};

const getLeadCohortIdentifiers = (lead) => {
  return [
    lead.applicationId,
    lead.leaseIntervalId,
    lead.leaseId,
    lead.prospectId,
    lead.prospectID,
    lead.customerId,
    lead.customerID,
    lead.leadId,
    lead.leadID
  ]
    .filter((value) => value != null && value !== '')
    .map((value) => String(value));
};

const getAvailabilityPrice = (unit) => {
  for (const key of FALLBACK_AVAILABILITY_PRICE_KEYS) {
    const parsed = parseNumber(unit?.[key]);
    if (parsed != null) return parsed;
  }
  return null;
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

const isClosedLeaseEvent = (event) => {
  const reason = String(event.eventReason || event.type || '').toLowerCase();
  return event.typeId === 13 && reason.includes('approved');
};

const isGuestCardLead = (lead) => {
  const searchSpace = collectPrimitiveValues(lead).join(' ').toLowerCase();
  return searchSpace.includes('guest card') || searchSpace.includes('guestcard');
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

const getDeltaTone = (value) => {
  if (value == null || Number.isNaN(Number(value))) return 'neutral';
  if (Number(value) > 0) return 'positive';
  if (Number(value) < 0) return 'negative';
  return 'neutral';
};

const shortenLabel = (value, max = 20) => {
  const text = String(value || '(not set)');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const normalizeAnalyticsError = (message) => {
  const text = String(message || '').trim();
  if (!text) return null;
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
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dateRange, setDateRange] = useState('28d');
  const [customRange, setCustomRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 27);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return {
      start: formatDateInputValue(start),
      end: formatDateInputValue(end),
    };
  });
  const [selectedPropertyId, setSelectedPropertyId] = useState(defaultPropertyId);
  const [loading, setLoading] = useState(true);
  const [invoiceLoading, setInvoiceLoading] = useState(true);
  const [roiLoading, setRoiLoading] = useState(true);
  const [propertyInfoLoading, setPropertyInfoLoading] = useState(true);
  const [roiPipelineStatusLoading, setRoiPipelineStatusLoading] = useState(true);
  const [ga4Loading, setGa4Loading] = useState(true);
  const [googleAdsLoading, setGoogleAdsLoading] = useState(true);
  const [metaAdsLoading, setMetaAdsLoading] = useState(true);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [metaAdsAttributionMode, setMetaAdsAttributionMode] = useState('account_default');
  const [websiteManagerLoading, setWebsiteManagerLoading] = useState(true);
  const [websiteManagerSaving, setWebsiteManagerSaving] = useState(false);
  const [websiteManagerAction, setWebsiteManagerAction] = useState('save');
  const [websiteManagerError, setWebsiteManagerError] = useState(null);
  const [websiteManagerNotice, setWebsiteManagerNotice] = useState(null);
  const [websiteManagerDoc, setWebsiteManagerDoc] = useState(WEBSITE_MANAGER_DEFAULT_RECORD);
  const [websiteManagerDraft, setWebsiteManagerDraft] = useState(WEBSITE_MANAGER_DEFAULT_RECORD);
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
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [availabilityItems, setAvailabilityItems] = useState([]);
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
  const [adminAccessLoading, setAdminAccessLoading] = useState(false);
  const [adminAccessError, setAdminAccessError] = useState(null);
  const [adminAccessNotice, setAdminAccessNotice] = useState(null);
  const [adminInviteLink, setAdminInviteLink] = useState('');
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
  const reportingLayoutUsesStagedAdapter = Boolean(REPORTING_LAYOUT_URL);
  const analyticsEndpointsConfigured = Boolean(
    GA4_DASHBOARD_URL && GOOGLE_ADS_DASHBOARD_URL && META_ADS_DASHBOARD_URL && REPUTATION_DASHBOARD_URL
  );
  const analyticsUsesRenderAdapter = useMemo(
    () => [GA4_DASHBOARD_URL, GOOGLE_ADS_DASHBOARD_URL, META_ADS_DASHBOARD_URL, REPUTATION_DASHBOARD_URL].every(isRenderAdapterUrl),
    []
  );
  const selectedProperty = useMemo(() => {
    const base = availableProperties.find((property) => property.propertyId === selectedPropertyId) || null;
    if (!base) return null;
    return {
      ...base,
      opiniionSkip: OPINIION_SKIPPED_PROPERTY_IDS.has(selectedPropertyId),
    };
  }, [availableProperties, selectedPropertyId]);
  const currentPropertyPermissionSet = useMemo(
    () => new Set(propertyAccessById[selectedPropertyId]?.permissions || []),
    [propertyAccessById, selectedPropertyId]
  );
  const displayName = profile?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'Account';
  const accountAvatarUrl = profile?.avatar_url || accountDraft.avatarUrl || '';
  const accountInitials = useMemo(() => getInitials(displayName), [displayName]);
  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => currentPropertyPermissionSet.has(item.permission)),
    [currentPropertyPermissionSet]
  );
  const canEditReportingLayout = currentPropertyPermissionSet.has(REPORTING_LAYOUT_EDIT_PERMISSION);
  const canEditWebsiteManager = currentPropertyPermissionSet.has(WEBSITE_MANAGER_EDIT_PERMISSION);
  const canManageUsers = currentPropertyPermissionSet.has(TAB_PERMISSIONS.admin);
  const adminGlobalRoles = useMemo(
    () => adminRoles.filter((role) => role.scope === 'global'),
    [adminRoles]
  );
  const adminPropertyRoles = useMemo(
    () => adminRoles.filter((role) => role.scope === 'property'),
    [adminRoles]
  );

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
    const nextPropertyId = defaultPropertyId || availableProperties[0]?.propertyId || null;
    if (!selectedPropertyId || !allowedIds.has(selectedPropertyId)) {
      setSelectedPropertyId(nextPropertyId);
    }
  }, [availableProperties, defaultPropertyId, selectedPropertyId]);

  useEffect(() => {
    const preferredTab = DEFAULT_TAB_ORDER.find((tabId) => visibleNavItems.some((item) => item.id === tabId));
    if (!preferredTab) return;
    if (!visibleNavItems.some((item) => item.id === activeTab)) {
      setActiveTab(preferredTab);
    }
  }, [activeTab, visibleNavItems]);

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
      start = new Date(customRange.start);
      if (customRange.end) end.setTime(new Date(customRange.end).getTime());
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
      if (!selectedPropertyId) {
        setParentDocs([]);
        setLeadItems([]);
        setEventItems([]);
        setInvoiceItems([]);
        setAvailabilityItems([]);
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
        setInvoiceItems([]);
        setAvailabilityItems([]);
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
          property_id: selectedPropertyId,
          start_date: formatDateInputValue(rangeDates.start),
          end_date: formatDateInputValue(rangeDates.end),
        });
        const response = await authFetch(`${PROPERTY_REPORTING_OVERVIEW_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.message || `Property overview fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        setParentDocs(Array.isArray(payload.parent_docs) ? payload.parent_docs : []);
        setLeadItems(Array.isArray(payload.lead_items) ? payload.lead_items : []);
        setEventItems(Array.isArray(payload.event_items) ? payload.event_items : []);
        setInvoiceItems(Array.isArray(payload.invoice_items) ? payload.invoice_items : []);
        setAvailabilityItems(Array.isArray(payload.availability_items) ? payload.availability_items : []);
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
          setInvoiceItems([]);
          setAvailabilityItems([]);
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
  }, [rangeDates, selectedPropertyId, reportingUsesStagedOverview]);

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
        setWebsiteManagerError('Website manager endpoint is not configured.');
        setWebsiteManagerLoading(false);
        return;
      }

      setWebsiteManagerLoading(true);
      setWebsiteManagerError(null);
      setWebsiteManagerNotice(null);

      try {
        const params = new URLSearchParams({ property_id: selectedPropertyId });
        const response = await authFetch(`${WEBSITE_MANAGER_URL}?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok || payload?.status === 'error') {
          throw new Error(payload?.error || `Website manager fetch failed: ${response.status}`);
        }

        if (cancelled) return;

        const normalized = normalizeWebsiteManagerRecord(payload.record);
        setWebsiteManagerDoc(normalized);
        setWebsiteManagerDraft(normalized);
        setWebsiteManagerLoading(false);
      } catch (error) {
        console.error('Website manager staged fetch failed', error);
        if (cancelled) return;
        const fallback = normalizeWebsiteManagerRecord(null);
        setWebsiteManagerDoc(fallback);
        setWebsiteManagerDraft(fallback);
        setWebsiteManagerError('Unable to load website manager content from the staged adapter.');
        setWebsiteManagerLoading(false);
      }
    };

    loadWebsiteManager();
    return () => {
      cancelled = true;
    };
  }, [selectedPropertyId, websiteManagerUsesStagedAdapter]);

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
      if (!selectedPropertyId) {
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
        const params = new URLSearchParams({ property_id: selectedPropertyId });
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
  }, [selectedPropertyId, reportingLayoutUsesStagedAdapter]);

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
    if (!selectedPropertyId) {
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
          property_id: selectedPropertyId,
          ga4_property_id: ga4PropertyId,
          start_date: rangeDates.start.toISOString().slice(0, 10),
          end_date: rangeDates.end.toISOString().slice(0, 10)
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
  }, [rangeDates, selectedPropertyId, selectedProperty]);

  useEffect(() => {
    if (!selectedPropertyId) {
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
          property_id: selectedPropertyId,
          google_ads_customer_id: googleAdsCustomerId,
          property_name: selectedProperty?.name || '',
          start_date: rangeDates.start.toISOString().slice(0, 10),
          end_date: rangeDates.end.toISOString().slice(0, 10)
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
  }, [rangeDates, selectedPropertyId, selectedProperty]);

  useEffect(() => {
    if (!selectedPropertyId) {
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
          property_id: selectedPropertyId,
          meta_ads_account_id: metaAdsAccountId,
          property_name: selectedProperty?.name || '',
          attribution_mode: metaAdsAttributionMode,
          start_date: rangeDates.start.toISOString().slice(0, 10),
          end_date: rangeDates.end.toISOString().slice(0, 10)
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
  }, [metaAdsAttributionMode, rangeDates, selectedPropertyId, selectedProperty]);

  useEffect(() => {
    if (!selectedPropertyId) {
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
          property_id: selectedPropertyId,
          property_name: selectedProperty?.name || '',
          property_city: selectedProperty?.city || '',
          start_date: rangeDates.start.toISOString().slice(0, 10),
          end_date: rangeDates.end.toISOString().slice(0, 10)
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
  }, [rangeDates, selectedPropertyId, selectedProperty]);

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

  const canonicalLeadItems = useMemo(() => {
    return allCanonicalLeadItems.filter((lead) => !isGuestCardLead(lead));
  }, [allCanonicalLeadItems]);

  const totalLeads = allCanonicalLeadItems.length;
  const leadCohortIds = useMemo(() => {
    const ids = new Set();
    canonicalLeadItems.forEach((lead) => {
      getLeadCohortIdentifiers(lead).forEach((id) => ids.add(id));
    });
    return ids;
  }, [canonicalLeadItems]);

  const cohortEventItems = useMemo(() => {
    return eventItems.filter((event) => {
      const identifiers = [
        event.applicationId,
        event.leaseIntervalId,
        event.leaseId,
        event.prospectId,
        event.prospectID,
        event.customerId,
        event.customerID,
        event.leadId,
        event.leadID
      ]
        .filter((value) => value != null && value !== '')
        .map((value) => String(value));

      return identifiers.some((id) => leadCohortIds.has(id));
    });
  }, [eventItems, leadCohortIds]);

  const uniqueApplicationEvents = useMemo(() => {
    const uniqueApplications = new Map();
    cohortEventItems.forEach((event) => {
      if (!isStartedApplicationEvent(event)) return;
      const key = getApplicationKey(event);
      if (!uniqueApplications.has(key)) {
        uniqueApplications.set(key, event);
      }
    });
    return Array.from(uniqueApplications.values());
  }, [cohortEventItems]);

  const uniqueLeaseEvents = useMemo(() => {
    const uniqueLeases = new Map();
    cohortEventItems.forEach((event) => {
      if (!isClosedLeaseEvent(event)) return;
      const key = getLeaseKey(event);
      if (!uniqueLeases.has(key)) {
        uniqueLeases.set(key, event);
      }
    });
    return Array.from(uniqueLeases.values());
  }, [cohortEventItems]);

  const totalApplications = uniqueApplicationEvents.length;

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
      return (
        inPerformanceGl &&
        isActiveAdvertisingInvoice(invoice) &&
        getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end) > 0
      );
    });
  }, [normalizedInvoiceItems, rangeDates]);

  // Lead status breakdown
  const leadStatusBreakdown = useMemo(() => {
    const statuses = {};
    canonicalLeadItems.forEach(l => {
      const s = l.status || 'Unknown';
      statuses[s] = (statuses[s] || 0) + 1;
    });
    return statuses;
  }, [canonicalLeadItems]);

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
    performanceMarketingInvoices.forEach(inv => {
      total += getAllocatedInvoiceAmountInRange(inv, rangeDates.start, rangeDates.end);
    });
    return total;
  }, [performanceMarketingInvoices, rangeDates]);

  const totalBlendedMarketingSpend = useMemo(() => {
    let total = 0;
    allMarketingInvoices.forEach((invoice) => {
      total += getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end);
    });
    return total;
  }, [allMarketingInvoices, rangeDates]);

  const marketingSpendBreakdown = useMemo(() => {
    const groupedSpend = new Map();

    allMarketingInvoices.forEach((invoice) => {
      const label = getInvoiceBreakdownLabel(invoice);
      const amount = getAllocatedInvoiceAmountInRange(invoice, rangeDates.start, rangeDates.end);
      if (amount === 0) return;
      groupedSpend.set(label, (groupedSpend.get(label) || 0) + amount);
    });

    return Array.from(groupedSpend.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [allMarketingInvoices, rangeDates]);

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
    const units = propertyUnitItems.length > 0 ? propertyUnitItems.flatMap(getPropertyUnitSpaces) : (availabilityItems || []);
    const pricedUnits = units
      .map((unit) => {
        if (propertyUnitItems.length > 0) {
          const range = getPropertyUnitPriceRange(unit);
          return range.min ?? range.max;
        }
        return getAvailabilityPrice(unit);
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
  }, [availabilityItems, propertyUnitItems, floorplanItems]);

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

    return [...availabilityItems]
      .sort((a, b) => {
        const statusA = String(getAvailabilityStatus(a)).toLowerCase();
        const statusB = String(getAvailabilityStatus(b)).toLowerCase();
        const availableA = statusA.includes('available') ? 0 : 1;
        const availableB = statusB.includes('available') ? 0 : 1;
        if (availableA !== availableB) return availableA - availableB;
        const priceA = getAvailabilityPrice(a) ?? Number.MAX_SAFE_INTEGER;
        const priceB = getAvailabilityPrice(b) ?? Number.MAX_SAFE_INTEGER;
        return priceA - priceB;
      })
      .slice(0, 14);
  }, [availabilityItems, propertyUnitItems]);

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
        roi: item.marketingSpend > 0 ? (item.netEffectiveRevenue - item.marketingSpend) / item.marketingSpend : null
      }))
      .sort((a, b) => b.netEffectiveRevenue - a.netEffectiveRevenue);
  }, [roiDailyItems]);

  // Daily chart data
  const dailyChartData = useMemo(() => {
    const dateMap = {};
    
    // Initialize dates from parent docs
    parentDocs.forEach(p => {
      if (p.date) {
        dateMap[p.date] = { date: p.date, leads: 0, leases: 0, applications: 0 };
      }
    });

    // Count leads per day
    allCanonicalLeadItems.forEach(l => {
      if (l._date && dateMap[l._date]) {
        dateMap[l._date].leads += 1;
      }
    });

    uniqueApplicationEvents.forEach((event) => {
      if (event._date && dateMap[event._date]) {
        dateMap[event._date].applications += 1;
      }
    });

    uniqueLeaseEvents.forEach((event) => {
      if (event._date && dateMap[event._date]) {
        dateMap[event._date].leases += 1;
      }
    });

    return Object.values(dateMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        label: new Date(d.date + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })
      }));
  }, [parentDocs, allCanonicalLeadItems, uniqueApplicationEvents, uniqueLeaseEvents]);

  // Conversion rates
  const attributedLeaseCount = roiTotals.attributedLeases;
  const unattributedLeaseCount = roiTotals.unattributedLeases;
  const totalTrackedLeaseCount = attributedLeaseCount + unattributedLeaseCount;
  const totalLeases = totalTrackedLeaseCount > 0 ? totalTrackedLeaseCount : uniqueLeaseEvents.length;
  const leaseConversion = totalLeads > 0 ? ((totalLeases / totalLeads) * 100).toFixed(1) : '0.0';
  const applicationConversion = totalLeads > 0 ? ((totalApplications / totalLeads) * 100).toFixed(1) : '0.0';
  const costPerLead = totalLeads > 0 && totalPerformanceMarketingCost > 0 ? (totalPerformanceMarketingCost / totalLeads).toFixed(2) : '—';
  const costPerLease = totalLeases > 0 && totalPerformanceMarketingCost > 0 ? (totalPerformanceMarketingCost / totalLeases).toFixed(2) : '—';
  const attributionMatchRate = totalTrackedLeaseCount > 0 ? ((attributedLeaseCount / totalTrackedLeaseCount) * 100).toFixed(1) : '0.0';
  const applicationToLeaseConversion = totalApplications > 0 ? ((totalLeases / totalApplications) * 100).toFixed(1) : '0.0';
  const blendedRoi = roiTotals.marketingSpend > 0 ? ((roiTotals.netEffectiveRevenue - roiTotals.marketingSpend) / roiTotals.marketingSpend) : null;
  const blendedRoas = roiTotals.marketingSpend > 0 ? (roiTotals.netEffectiveRevenue / roiTotals.marketingSpend) : null;
  const roiCostPerLease = attributedLeaseCount > 0 && roiTotals.marketingSpend > 0 ? (roiTotals.marketingSpend / attributedLeaseCount).toFixed(2) : '—';
  const selectedPropertyLabel = useMemo(() => {
    if (selectedProperty) {
      const location = [selectedProperty.city, selectedProperty.state].filter(Boolean).join(', ');
      return location ? `${selectedProperty.name} (${location})` : selectedProperty.name;
    }

    const propertyId = parentDocs[0]?.property_id;
    return propertyId ? `Property ${propertyId}` : 'Live Property Data';
  }, [selectedProperty, parentDocs]);
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
  }, [reportingDataSource]);
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
  const websiteManagerPreviewItems = useMemo(() => (
    [
      { label: 'Homepage headline', value: websiteManagerDraft.content.heroHeadline },
      { label: 'Homepage subheadline', value: websiteManagerDraft.content.heroSubheadline },
      { label: 'Primary CTA', value: websiteManagerDraft.content.heroPrimaryCtaLabel },
      { label: 'Banner headline', value: websiteManagerDraft.content.bannerHeadline },
      { label: 'Floor plans headline', value: websiteManagerDraft.content.floorplansHeadline },
      { label: 'Availability note', value: websiteManagerDraft.content.availabilityNote },
      { label: 'Live pricing', value: websiteManagerDraft.derivedContent.pricingSummary },
      { label: 'Live specials', value: websiteManagerDraft.derivedContent.specialsSummary },
      { label: 'Live availability', value: websiteManagerDraft.derivedContent.availabilitySummary }
    ]
      .filter((item) => String(item.value || '').trim())
      .map((item) => ({
        ...item,
        resolved: resolveMustacheTokens(item.value, websiteManagerTokenValues)
      }))
  ), [websiteManagerDraft.content, websiteManagerTokenValues]);
  const websiteManagerDirty = useMemo(
    () => JSON.stringify(websiteManagerDraft) !== JSON.stringify(websiteManagerDoc),
    [websiteManagerDraft, websiteManagerDoc]
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
      setWebsiteManagerError('Your current role can view website manager content, but cannot edit it.');
      return;
    }

    setWebsiteManagerSaving(true);
    setWebsiteManagerAction(publish ? 'publish' : 'save');
    setWebsiteManagerError(null);
    setWebsiteManagerNotice(null);

    try {
      if (!websiteManagerUsesStagedAdapter) {
        throw new Error('Website manager endpoint is not configured.');
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
        throw new Error(payload?.error || `Website manager save failed: ${response.status}`);
      }
      const savedRecord = normalizeWebsiteManagerRecord(payload.record);
      setWebsiteManagerDoc(savedRecord);
      setWebsiteManagerDraft(savedRecord);
      if (publish) {
        setWebsiteManagerNotice('Website content was saved and pushed to the linked WordPress site.');
      } else {
        setWebsiteManagerNotice('Website manager content saved for this property.');
      }
    } catch (error) {
      console.error('Website manager save failed', error);
      setWebsiteManagerError(error.message || 'Unable to save website manager content.');
    } finally {
      setWebsiteManagerSaving(false);
      setWebsiteManagerAction('save');
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
  const ga4Blocked = Boolean(ga4StatusMessage && !ga4Data);
  const reportingPanelSummaries = useMemo(() => ({
    executive: `${formatCurrency(roiTotals.netEffectiveRevenue)} net revenue | ${formatCurrency(totalBlendedMarketingSpend)} spend`,
    roi: blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}% ROI | ${blendedRoas != null ? `${blendedRoas.toFixed(2)}x ROAS` : 'ROAS pending'}` : 'Waiting on spend and revenue data',
    budget: `${marketingSpendBreakdown.length} tracked spend lines | ${formatCurrency(totalPerformanceMarketingCost)} paid media`,
    entrata: `${totalLeads} leads | ${totalApplications} apps | ${totalLeases} leases`,
    'google-ads': googleAdsLoading ? 'Loading paid search metrics' : `${formatNumber(googleAdsOverview?.clicks)} clicks | ${formatCurrency(googleAdsOverview?.cost)} spend`,
    ga4: ga4Loading ? 'Loading analytics metrics' : ga4Blocked ? 'GA4 access required' : `${formatNumber(ga4Sessions)} sessions | ${formatNumber(ga4EventTotal)} tracked events`,
    opiniion: reputationLoading ? 'Loading reputation metrics' : `${formatNumber(reputationReviewCount)} reviews | ${formatNumber(reputationAverageRating, 2)} avg rating`,
    'meta-ads': metaAdsLoading ? 'Loading paid social metrics' : `${formatNumber(metaAdsOverview?.clicks)} clicks | ${formatCurrency(metaAdsOverview?.spend)} spend`
  }), [
    blendedRoi,
    blendedRoas,
    ga4Blocked,
    ga4EventTotal,
    ga4Loading,
    ga4Sessions,
    googleAdsLoading,
    googleAdsOverview,
    marketingSpendBreakdown.length,
    metaAdsLoading,
    metaAdsOverview,
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
          <div className="property-info-pill">Specials synced {specialItems.length}</div>
          <div className="property-info-pill">
            Availability snapshot {latestAvailabilityDate ? formatReadableDate(latestAvailabilityDate) : 'Not loaded'}
          </div>
        </div>
      </div>

      <div className="property-info-grid">
        <div className="property-info-card">
          <div className="property-info-card__label">Current Specials</div>
          <div className="property-info-card__value">{propertyInfoLoading ? '…' : specialItems.length}</div>
          <div className="property-info-card__meta">
            Last synced {getSnapshotTimestampLabel(specialsSnapshot?.last_synced_at)}
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Available Units</div>
          <div className="property-info-card__value">{propertyInfoLoading ? '…' : availabilitySummary.availableCount}</div>
          <div className="property-info-card__meta">
            {availabilitySummary.unitCount} units across {availabilitySummary.floorplanCount} floorplans
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
          <div className="property-info-card__value">{loading ? '…' : `${totalLeads} / ${totalApplications} / ${totalLeases}`}</div>
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
            Prioritizing the dedicated `getUnitsAvailabilityAndPricing` snapshot when available, with the older raw availability pull as a fallback.
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
            <div className="property-info-empty">No availability rows were found in this date window.</div>
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
                    {propertyUnitItems.length > 0
                      ? (() => {
                          const range = getPropertyUnitPriceRange(unit);
                          return range.min != null ? `${formatCurrency(range.min)} - ${formatCurrency(range.max ?? range.min)}` : '—';
                        })()
                      : (getAvailabilityPrice(unit) != null ? formatCurrency(getAvailabilityPrice(unit)) : '—')}
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

        <div className="property-info-panel">
          <div className="property-info-panel__eyebrow">Range Summary</div>
          <div className="property-info-panel__title">Lead and lease activity</div>
          <div className="property-info-metrics">
            <div className="property-info-metrics__row"><span>Leads</span><strong>{loading ? '…' : totalLeads}</strong></div>
            <div className="property-info-metrics__row"><span>Applications</span><strong>{loading ? '…' : totalApplications}</strong></div>
            <div className="property-info-metrics__row"><span>Leases</span><strong>{loading ? '…' : totalLeases}</strong></div>
            <div className="property-info-metrics__row"><span>Lead to app</span><strong>{applicationConversion}%</strong></div>
            <div className="property-info-metrics__row"><span>Lead to lease</span><strong>{leaseConversion}%</strong></div>
            <div className="property-info-metrics__row"><span>Attributed lease rate</span><strong>{attributionMatchRate}%</strong></div>
          </div>
        </div>

        <div className="property-info-panel">
          <div className="property-info-panel__eyebrow">Spend Summary</div>
          <div className="property-info-panel__title">Marketing cost and revenue</div>
          <div className="property-info-metrics">
            <div className="property-info-metrics__row"><span>Total marketing</span><strong>{formatCurrency(totalBlendedMarketingSpend)}</strong></div>
            <div className="property-info-metrics__row"><span>Paid media</span><strong>{formatCurrency(totalPerformanceMarketingCost)}</strong></div>
            <div className="property-info-metrics__row"><span>Net revenue</span><strong>{formatCurrency(roiTotals.netEffectiveRevenue)}</strong></div>
            <div className="property-info-metrics__row"><span>Gross lease value</span><strong>{formatCurrency(roiTotals.grossLeaseValue)}</strong></div>
            <div className="property-info-metrics__row"><span>Live ROI</span><strong>{blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'}</strong></div>
            <div className="property-info-metrics__row"><span>Cost per lease</span><strong>{costPerLease !== '—' ? `$${costPerLease}` : '—'}</strong></div>
          </div>
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
        <div className="card-value">{loading ? '…' : totalLeads.toLocaleString()}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Apps: {totalApplications.toLocaleString()} | Leases: {totalLeases.toLocaleString()}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileCheck size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Applications</div>
        </div>
        <div className="card-value">{loading ? '…' : totalApplications.toLocaleString()}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Lead-to-app: {applicationConversion}% | Guest cards excluded
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Home size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Leases Signed</div>
        </div>
        <div className="card-value">{loading ? '…' : totalLeases.toLocaleString()}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          App-to-lease: {applicationToLeaseConversion}% | Lead-to-lease: {leaseConversion}%
        </div>
      </div>

      <div className="card" style={{ background: 'var(--pop-red)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Marketing Cost</div>
        </div>
        <div className="card-value">
          {loading ? '…' : totalBlendedMarketingSpend > 0 ? `$${totalBlendedMarketingSpend.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}` : 'No data'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Paid media: {totalPerformanceMarketingCost > 0 ? `$${totalPerformanceMarketingCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'} | CPL: {costPerLead !== '—' ? `$${costPerLead}` : '—'}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <DollarSign size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Net Lease Revenue</div>
        </div>
        <div className="card-value">
          {roiLoading ? '…' : roiTotals.netEffectiveRevenue > 0 ? `$${roiTotals.netEffectiveRevenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : 'No data'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Gross: {roiTotals.grossLeaseValue > 0 ? `$${roiTotals.grossLeaseValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'} | Concessions: {roiTotals.concessionTotal > 0 ? `$${roiTotals.concessionTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <TrendingUp size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Live ROI</div>
        </div>
        <div className="card-value">
          {roiLoading ? '…' : blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : 'No spend'}
        </div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          ROAS: {blendedRoas != null ? `${blendedRoas.toFixed(2)}x` : '—'} | Cost / Attributed Lease: {roiCostPerLease !== '—' ? `$${roiCostPerLease}` : '—'}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Home size={16} style={{ opacity: 0.6 }} />
          <div className="card-title">Attributed Leases</div>
        </div>
        <div className="card-value">{roiLoading ? '…' : attributedLeaseCount.toLocaleString()}</div>
        <div style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.7 }}>
          Match rate: {attributionMatchRate}% | Unattributed: {unattributedLeaseCount.toLocaleString()}
        </div>
      </div>

      {/* ── Lead Status Breakdown ── */}
      <div className="card span-2">
        <div className="card-title">Lead Status Breakdown</div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {Object.entries(leadStatusBreakdown).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([status, count]) => (
            <div key={status} style={{ flex: '1 1 28%', minWidth: '80px', padding: '0.5rem', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{count}</div>
            </div>
          ))}
          {Object.keys(leadStatusBreakdown).length === 0 && !loading && (
            <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>No lead data for this period</div>
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

      <div className="card span-2" style={{ background: 'var(--panel-soft)', color: 'var(--white)' }}>
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>ROI by Source</div>
        {roiSourceBreakdown.length > 0 ? (
          <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.6rem' }}>
            {roiSourceBreakdown.slice(0, 6).map((item) => (
              <div
                key={item.sourceKey}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 0.7fr 0.9fr 0.9fr',
                  gap: '0.75rem',
                  paddingBottom: '0.6rem',
                  borderBottom: '1px solid var(--panel-border)',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{item.sourceLabel}</div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{item.attributedLeases} leases</div>
                </div>
                <div style={{ fontSize: '0.82rem' }}>
                  ${item.marketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: '0.82rem' }}>
                  ${item.netEffectiveRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: item.roi != null && item.roi < 0 ? 'var(--primary-red)' : 'var(--white)' }}>
                  {item.roi != null ? `${(item.roi * 100).toFixed(0)}%` : '—'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.6, marginTop: '1rem' }}>No ROI source data yet. Run the ROI aggregation after lease attribution backfill.</div>
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

      {/* ── Summary Stats Row ── */}
      <div className="card span-2" style={{ background: 'var(--panel-alt)', color: 'var(--white)' }}>
        <div className="card-title" style={{ color: 'var(--primary-tan)', fontWeight: 'bold' }}>Conversion Funnel</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem' }}>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalLeads}</div>
            <div style={{ fontSize: '0.7rem' }}>Leads</div>
          </div>
          <TrendingUp size={16} style={{ opacity: 0.4 }} />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalApplications}</div>
            <div style={{ fontSize: '0.7rem' }}>Applications</div>
          </div>
          <TrendingUp size={16} style={{ opacity: 0.4 }} />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalLeases}</div>
            <div style={{ fontSize: '0.7rem' }}>Leases</div>
          </div>
          <TrendingUp size={16} style={{ opacity: 0.4 }} />
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
              {totalBlendedMarketingSpend > 0 ? `$${totalBlendedMarketingSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </div>
            <div style={{ fontSize: '0.7rem' }}>Total Marketing</div>
          </div>
        </div>
      </div>

      <div className="card span-2" style={{ background: 'var(--panel-alt)', color: 'var(--white)' }}>
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
                  gap: '1rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid var(--panel-border)'
                }}
              >
                <div style={{ maxWidth: '75%' }}>{item.label}</div>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                  ${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

  const renderReports = () => (
    <div className="reports-view">
      <div className="reports-shell">
        <div className="reports-hero">
          <div>
            <div className="reports-kicker">Reporting Workspace</div>
            <div className="reports-headline">{selectedPropertyLabel}</div>
            <div className="reports-subhead">
              A property-filtered reporting dashboard for asset managers that combines ROI, budget, funnel, paid media, analytics, and reputation into one configurable view.
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
            <div className="reports-kpi-card__label">Net Revenue</div>
            <div className="reports-kpi-card__value">{formatCurrency(roiTotals.netEffectiveRevenue)}</div>
            <div className="reports-kpi-card__meta">Attributed lease revenue in the selected window</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Blended ROI</div>
            <div className="reports-kpi-card__value">{blendedRoi != null ? `${(blendedRoi * 100).toFixed(0)}%` : '—'}</div>
            <div className="reports-kpi-card__meta">Net effective revenue minus spend, divided by spend</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Leases</div>
            <div className="reports-kpi-card__value">{formatNumber(totalLeases)}</div>
            <div className="reports-kpi-card__meta">{applicationToLeaseConversion}% app to lease conversion</div>
          </div>
          <div className="reports-kpi-card">
            <div className="reports-kpi-card__label">Paid Media Spend</div>
            <div className="reports-kpi-card__value">{formatCurrency(totalPerformanceMarketingCost)}</div>
            <div className="reports-kpi-card__meta">Google Ads + Meta-aligned performance spend</div>
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
            {activeReportingPanels.some((panel) => panel.id === 'executive') && (
              <section id="reporting-panel-executive" className="reports-panel">
                <div className="reports-panel__eyebrow">Asset Manager Lens</div>
                <div className="reports-panel__title">Executive Snapshot</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat">
                    <span>Marketing Spend</span>
                    <strong>{formatCurrency(totalBlendedMarketingSpend)}</strong>
                    <small>{formatCurrency(totalPerformanceMarketingCost)} performance media</small>
                  </div>
                  <div className="reports-stat">
                    <span>Pipeline</span>
                    <strong>{formatNumber(totalLeads)} / {formatNumber(totalApplications)} / {formatNumber(totalLeases)}</strong>
                    <small>Leads, applications, leases</small>
                  </div>
                  <div className="reports-stat">
                    <span>Health Check</span>
                    <strong>{attributionMatchRate}%</strong>
                    <small>Attributed lease match rate</small>
                  </div>
                </div>
              </section>
            )}

            {activeReportingPanels.some((panel) => panel.id === 'roi') && (
              <section id="reporting-panel-roi" className="reports-panel">
                <div className="reports-panel__eyebrow">Revenue Efficiency</div>
                <div className="reports-panel__title">ROI Metrics</div>
                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Net Effective Revenue</span><strong>{formatCurrency(roiTotals.netEffectiveRevenue)}</strong><small>{formatCurrency(roiTotals.grossLeaseValue)} gross lease value</small></div>
                  <div className="reports-stat"><span>Blended ROI</span><strong>{blendedRoi != null ? `${(blendedRoi * 100).toFixed(1)}%` : '—'}</strong><small>{blendedRoas != null ? `${blendedRoas.toFixed(2)}x ROAS` : 'ROAS unavailable'}</small></div>
                  <div className="reports-stat"><span>Cost Per Lease</span><strong>{roiCostPerLease !== '—' ? formatCurrency(roiCostPerLease) : '—'}</strong><small>{formatCurrency(roiTotals.concessionTotal)} concessions</small></div>
                </div>
                <div className="reports-list">
                  {roiSourceBreakdown.slice(0, 5).map((item) => (
                    <div key={item.sourceKey} className="reports-list__row">
                      <div>
                        <strong>{item.sourceLabel}</strong>
                        <small>{item.attributedLeases} leases | {formatCurrency(item.marketingSpend)} spend</small>
                      </div>
                      <div>{item.roi != null ? `${(item.roi * 100).toFixed(0)}% ROI` : 'No ROI yet'}</div>
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
                  <div className="reports-stat"><span>Total Marketing</span><strong>{formatCurrency(totalBlendedMarketingSpend)}</strong><small>All tracked marketing GL codes</small></div>
                  <div className="reports-stat"><span>Performance Marketing</span><strong>{formatCurrency(totalPerformanceMarketingCost)}</strong><small>Paid media + PPC management</small></div>
                  <div className="reports-stat"><span>Tracked Cost Lines</span><strong>{formatNumber(marketingSpendBreakdown.length)}</strong><small>Invoice buckets in range</small></div>
                </div>
                <div className="reports-list">
                  {marketingSpendBreakdown.slice(0, 6).map((item) => (
                    <div key={item.label} className="reports-list__row">
                      <div>
                        <strong>{item.label}</strong>
                        <small>Allocated within the selected reporting window</small>
                      </div>
                      <div>{formatCurrency(item.amount)}</div>
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
                  <div className="reports-stat"><span>Sessions</span><strong>{ga4Loading ? '…' : ga4Blocked ? 'Locked' : formatNumber(ga4Sessions)}</strong><small>{ga4Loading ? 'Loading…' : ga4Blocked ? ga4StatusMessage : formatNumber(ga4NewUsers)} new users</small></div>
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
              : `${rangeDates.start.toISOString().slice(0, 10)} to ${rangeDates.end.toISOString().slice(0, 10)}`}
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
          <div className="website-manager-headline">Website Manager</div>
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

      {!canEditWebsiteManager && (
        <div className="website-manager-banner">
          Your current role can view website manager content for this property, but editing is disabled.
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
              <div className="website-manager-panel__eyebrow">Content fields</div>
              <h3 className="website-manager-panel__title">Editable payload for the site</h3>
            </div>
          </div>

          <div className="website-manager-groups">
            {WEBSITE_MANAGER_FIELD_GROUPS.map((group) => (
              <div key={group.title} className="website-manager-group">
                <div className="website-manager-group__title">{group.title}</div>
                <div className="website-manager-form-grid">
                  {group.fields.map((field) => (
                    <label key={field.key} className={`website-manager-field ${field.input === 'textarea' ? 'website-manager-field--wide' : ''}`}>
                      <span className="website-manager-field__label">{field.label}</span>
                      {field.input === 'textarea' ? (
                        <textarea
                          value={websiteManagerDraft.content[field.key]}
                          onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                          className="website-manager-field__input website-manager-field__input--textarea"
                          placeholder={field.placeholder}
                          disabled={!websiteManagerEditable || !canEditWebsiteManager}
                        />
                      ) : (
                        <input
                          type="text"
                          value={websiteManagerDraft.content[field.key]}
                          onChange={(event) => updateWebsiteManagerContentField(field.key, event.target.value)}
                          className="website-manager-field__input"
                          placeholder={field.placeholder}
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

  const renderNotes = () => (
    <div className="notes-view">
      <h2 className="title">Change Log & Notes</h2>
      <div className="notes-container">
        <div style={{ borderLeft: '4px solid var(--pop-red)', paddingLeft: '1rem' }}>
          <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>No notes source configured</div>
          <div style={{ marginTop: '0.25rem' }}>
            This section is intentionally empty until notes are backed by persisted data.
          </div>
        </div>
      </div>
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
              </div>
            </>
          ) : (
            <div className="admin-access-empty">Choose a user to edit roles and property memberships.</div>
          )}
        </div>
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
    <div className={`dashboard-container ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
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
      <div className="main-content">
        <div className="header">
          {activeTab === 'admin' ? (
            <div className="property-selector property-selector--admin">
              <span className="property-selector__label">Access scope</span>
              <div className="property-selector__admin-summary">
                Manage user invites, global roles, and property assignments.
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

        <div className="content-body">
          <div className="dashboard-title-row">
            <h1 className="title">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</h1>
            {activeTab !== 'website manager' && activeTab !== 'admin' && (
              <div className="global-date-controls">
                <div className="global-date-controls__picker">
                  <div className="global-date-controls__label">Date range</div>
                  <div className="global-date-controls__control">
                    <Calendar size={16} className="global-date-controls__icon" />
                    <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className="global-date-controls__select">
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
                  {dateRange === 'custom' && (
                    <div className="global-date-controls__custom-range">
                      <input
                        type="date"
                        value={customRange.start}
                        onChange={(e) => setCustomRange({ ...customRange, start: e.target.value })}
                        className="global-date-controls__input"
                      />
                      <span className="global-date-controls__to">to</span>
                      <input
                        type="date"
                        value={customRange.end}
                        onChange={(e) => setCustomRange({ ...customRange, end: e.target.value })}
                        className="global-date-controls__input"
                      />
                    </div>
                  )}
                </div>
                <div className="global-date-controls__meta">
                  <span>Live window</span>
                  <strong>{rangeDates.start.toLocaleDateString()} - {rangeDates.end.toLocaleDateString()}</strong>
                </div>
              </div>
            )}
          </div>

          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'website manager' && renderWebsiteManager()}
          {activeTab === 'property info' && renderPropertyInfo()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'analytics' && renderAnalytics()}
          {activeTab === 'reputation' && renderReputation()}
          {activeTab === 'notes' && renderNotes()}
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
