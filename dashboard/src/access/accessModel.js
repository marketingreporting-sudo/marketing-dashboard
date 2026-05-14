export const TAB_PERMISSIONS = {
  dashboard: 'dashboard.view',
  'website manager': 'website_manager.view',
  'property info': 'property_info.view',
  reports: 'reports.view',
  'call prep': 'reports.view',
  recommendations: 'reports.view',
  audit: 'properties.view_all',
  analytics: 'analytics.view',
  reputation: 'reputation.view',
  tasks: 'tasks.view',
  tickets: 'tasks.view',
  admin: 'users.manage',
  'red-list': 'users.manage',
};

export const DEFAULT_TAB_ORDER = [
  'dashboard',
  'reports',
  'call prep',
  'recommendations',
  'audit',
  'analytics',
  'reputation',
  'website manager',
  'property info',
  'tickets',
  'tasks',
  'red-list',
  'admin',
];

export const REPORTING_LAYOUT_EDIT_PERMISSION = 'reports.layout.edit';
export const WEBSITE_MANAGER_EDIT_PERMISSION = 'website_manager.edit';
