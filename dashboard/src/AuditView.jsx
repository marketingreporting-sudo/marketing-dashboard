import React from 'react';
import { SITE_AUDIT_PORTFOLIO_URL } from './apiConfig';
import { authFetch } from './lib/authFetch';
import useWebsiteExperienceData from './useWebsiteExperienceData';

const readAuditFindingWorkflowState = (storageKey) => {
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

const writeAuditFindingWorkflowState = (storageKey, state) => {
  if (typeof window === 'undefined' || !storageKey) return;
  window.localStorage.setItem(storageKey, JSON.stringify(state && typeof state === 'object' ? state : {}));
};

export default function AuditView(props) {
  const {
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
    heatmapSiteKey,
    propertyMatchesAuditFilter,
    normalizeAuditRubricStatus,
    rangeDates,
    renderMetricValue,
    selectedPropertyId,
    selectedPropertyLabel,
    setSelectedPropertyId,
  } = props;
  const [portfolioAuditLoading, setPortfolioAuditLoading] = React.useState(false);
  const [portfolioAuditError, setPortfolioAuditError] = React.useState(null);
  const [portfolioAuditProperties, setPortfolioAuditProperties] = React.useState([]);
  const [auditTableFilter, setAuditTableFilter] = React.useState('all');
  const [auditPortfolioFilter, setAuditPortfolioFilter] = React.useState('all');
  const [auditRegionFilter, setAuditRegionFilter] = React.useState('all');
  const [auditTableSort, setAuditTableSort] = React.useState({ key: 'propertyRiskScore', direction: 'desc' });
  const [auditReviewTab, setAuditReviewTab] = React.useState('overview');
  const [auditFindingWorkflowState, setAuditFindingWorkflowState] = React.useState(() => readAuditFindingWorkflowState(auditFindingWorkflowStorageKey));
  const auditFindingWorkflowStatusIds = React.useMemo(
    () => AUDIT_FINDING_WORKFLOW_STATUSES.map((status) => status.id),
    [AUDIT_FINDING_WORKFLOW_STATUSES]
  );
  const {
    auditPageOptions,
    runSiteAudit,
    screenshotPreviewUrl,
    selectedHeatmapDevice,
    selectedHeatmapPath,
    selectedScreenshot,
    setSelectedHeatmapDevice,
    setSelectedHeatmapPath,
    siteAuditSummaryData,
    siteAuditLoading,
    siteAuditNotice,
    siteAuditRunning,
  } = useWebsiteExperienceData({
    enabled: true,
    formatDateInputValue,
    heatmapSiteKey,
    rangeDates,
    selectedPropertyId,
    selectedPropertyLabel,
  });

  React.useEffect(() => {
    setAuditFindingWorkflowState(readAuditFindingWorkflowState(auditFindingWorkflowStorageKey));
  }, [auditFindingWorkflowStorageKey]);

  React.useEffect(() => {
    writeAuditFindingWorkflowState(auditFindingWorkflowStorageKey, auditFindingWorkflowState);
  }, [auditFindingWorkflowState, auditFindingWorkflowStorageKey]);

  React.useEffect(() => {
    let cancelled = false;

    const loadPortfolioAudit = async () => {
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
        if (!cancelled) {
          setPortfolioAuditProperties(Array.isArray(payload.properties) ? payload.properties : []);
        }
      } catch (error) {
        if (!cancelled) {
          setPortfolioAuditProperties([]);
          setPortfolioAuditError(error.message || 'Unable to load portfolio audit data.');
        }
      } finally {
        if (!cancelled) setPortfolioAuditLoading(false);
      }
    };

    loadPortfolioAudit();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAuditFindingWorkflow = React.useCallback((findingKey, status) => {
    if (!findingKey || !auditFindingWorkflowStatusIds.includes(status)) return;
    setAuditFindingWorkflowState((current) => ({
      ...current,
      [findingKey]: {
        status,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, [auditFindingWorkflowStatusIds]);

  const latestAudit = siteAuditSummaryData?.audit || null;
  const latestAuditRawData = latestAudit?.raw_data || latestAudit?.rawData || {};
  const aiAuditMeta = latestAuditRawData?.aiAudit || {};
  const isAiAudit = String(latestAuditRawData?.algorithm || '').includes('ai') || ['ok', 'partial'].includes(aiAuditMeta?.status);
  const auditModeLabel = isAiAudit ? 'AI screenshot audit' : 'Deterministic audit';
  const auditPageResult = React.useMemo(() => {
    const pages = Array.isArray(latestAudit?.pages) ? latestAudit.pages : [];
    return pages.find((page) => (page.path || '/') === selectedHeatmapPath) || pages[0] || null;
  }, [latestAudit, selectedHeatmapPath]);
  const auditIssues = React.useMemo(() => (
    auditPageResult?.issues || latestAudit?.issues || []
  ), [auditPageResult, latestAudit]);
  const auditRecommendations = React.useMemo(() => (
    auditPageResult?.recommendations || latestAudit?.recommendations || []
  ), [auditPageResult, latestAudit]);
  const auditStaleDates = React.useMemo(() => (
    auditPageResult?.staleDateStrings || latestAudit?.stale_date_findings || latestAudit?.staleDateFindings || []
  ), [auditPageResult, latestAudit]);
  const auditBrokenLinks = React.useMemo(() => (
    auditPageResult?.suspiciousLinks || latestAudit?.broken_links || latestAudit?.brokenLinks || []
  ), [auditPageResult, latestAudit]);
  const aiAuditChecklist = React.useMemo(() => {
    const directChecklist = auditPageResult?.aiAudit?.checklist;
    if (Array.isArray(directChecklist)) return directChecklist;
    const note = (latestAudit?.performance_notes || latestAudit?.performanceNotes || [])
      .find((item) => item?.path === auditPageResult?.path || item?.path === selectedHeatmapPath);
    return Array.isArray(note?.aiChecklist) ? note.aiChecklist : [];
  }, [auditPageResult, latestAudit, selectedHeatmapPath]);
  const auditCategoryScores = React.useMemo(() => {
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
        page_load_desktop_mobile: 'Desktop/mobile load',
        application_flow_visible: 'Application flow',
        floor_plan_availability: 'Floor plan availability',
        pricing_accuracy: 'Pricing',
        homepage_cta: 'Homepage CTA',
        homepage_value_add: 'Homepage value-add',
        special_offers_current: 'Special offers',
        leasing_verbiage: 'Leasing verbiage',
        contact_info_hours: 'Contact/hours',
      };
      return Object.entries(pageCategories).map(([key, score]) => ({
        key,
        label: labels[key] || key,
        score,
      })).filter((item) => item.score != null);
    }
    return [
      { key: 'ctaClarity', label: 'CTA clarity', score: latestAudit?.urgency_score },
      { key: 'staleDates', label: 'Stale dates', score: latestAudit?.freshness_score },
      { key: 'internalLinks', label: 'Internal links', score: latestAudit?.link_score },
    ].filter((item) => item.score != null);
  }, [latestAudit, auditPageResult]);

  const selectedPortfolioAudit = React.useMemo(
    () => portfolioAuditProperties.find((property) => property.propertyId === selectedPropertyId) || portfolioAuditProperties[0] || null,
    [portfolioAuditProperties, selectedPropertyId]
  );
  const selectedPortfolioRegressionEvents = React.useMemo(() => {
    const events = selectedPortfolioAudit?.regressionEvents || selectedPortfolioAudit?.trend?.regressionEvents;
    return Array.isArray(events) ? events : [];
  }, [selectedPortfolioAudit]);
  const auditPortfolioOptions = React.useMemo(() => (
    [...new Set(portfolioAuditProperties.map((property) => property.portfolio).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)))
  ), [portfolioAuditProperties]);
  const auditRegionOptions = React.useMemo(() => (
    [...new Set(portfolioAuditProperties.map((property) => [property.state, property.city].filter(Boolean).join(' / ')).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)))
  ), [portfolioAuditProperties]);
  const filteredPortfolioAuditProperties = React.useMemo(() => {
    const sortMultiplier = auditTableSort.direction === 'asc' ? 1 : -1;
    const getSortValue = (property) => {
      if (auditTableSort.key === 'propertyName') return String(property.propertyName || '').toLowerCase();
      if (auditTableSort.key === 'riskTier') return AUDIT_RISK_ORDER[property.riskTier] || 0;
      if (auditTableSort.key === 'propertyRiskScore') return property.propertyRiskScore == null ? -1 : Number(property.propertyRiskScore);
      if (auditTableSort.key === 'performanceScore') return property.performanceScore == null ? -1 : Number(property.performanceScore);
      if (auditTableSort.key === 'scoreChange') return property.scoreChange == null ? -999 : Number(property.scoreChange);
      if (auditTableSort.key === 'topSeverity') return Number(property.topSeverityScore || 0);
      if (auditTableSort.key === 'trend') return (
        (Number(property.newIssueCount || 0) * 4)
        + (Number(property.recurringIssueCount || 0) * 1)
        + (Number(property.regressedIssueCount || 0) * 5)
        + (Number(property.screenshotChangedCount || 0) * 3)
        + (Number(property.pageDisappearedCount || 0) * 8)
        + (property.trackingStoppedReporting ? 10 : 0)
        - (Number(property.resolvedIssueCount || 0) * 2)
        - Number(property.scoreChange || 0)
      );
      if (auditTableSort.key === 'topFailingRubric') return Number(property.topFailingRubric?.score ?? 101);
      if (auditTableSort.key === 'auditedAt') return property.auditedAt ? new Date(property.auditedAt).getTime() : 0;
      if (auditTableSort.key === 'issueCount') return Number(property.issueCount || 0);
      if (auditTableSort.key === 'confidence') return Number(property.confidence?.score || 0);
      if (auditTableSort.key === 'auditStatus') return String(property.auditStatus || '').toLowerCase();
      return 0;
    };
    return portfolioAuditProperties
      .filter((property) => propertyMatchesAuditFilter(property, auditTableFilter))
      .filter((property) => auditPortfolioFilter === 'all' || property.portfolio === auditPortfolioFilter)
      .filter((property) => auditRegionFilter === 'all' || [property.state, property.city].filter(Boolean).join(' / ') === auditRegionFilter)
      .sort((a, b) => {
        const left = getSortValue(a);
        const right = getSortValue(b);
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left).localeCompare(String(right)) * sortMultiplier;
        }
        if (left === right) return String(a.propertyName || '').localeCompare(String(b.propertyName || ''));
        return (Number(left) - Number(right)) * sortMultiplier;
      });
  }, [AUDIT_RISK_ORDER, auditPortfolioFilter, auditRegionFilter, auditTableFilter, auditTableSort, portfolioAuditProperties, propertyMatchesAuditFilter]);
  const selectedAuditReasonPool = React.useMemo(() => {
    const portfolioReasons = Array.isArray(selectedPortfolioAudit?.flaggedReasons) ? selectedPortfolioAudit.flaggedReasons : [];
    const baseReasons = portfolioReasons.length ? portfolioReasons : (auditIssues || []).map((item) => ({
      category: 'Website QA',
      issue: typeof item === 'string' ? item : item.issue || item.text || 'Review latest finding',
      evidence: typeof item === 'string' ? 'Detected in latest audit output.' : item.evidence || item.path || 'Detected in latest audit output.',
      recommendation: typeof item === 'string' ? 'Review the affected page and update website content as needed.' : item.recommendation || 'Review the affected page and update website content as needed.',
      confidence: selectedPortfolioAudit?.confidence?.label || 'Medium',
    }));
    return baseReasons.map((reason, index) => {
      const workflowKey = getAuditFindingKey(selectedPortfolioAudit?.propertyId || selectedPropertyId, reason, index);
      const workflow = auditFindingWorkflowState[workflowKey] || { status: 'new' };
      return {
        ...reason,
        workflowKey,
        workflowStatus: workflow.status || 'new',
        workflowUpdatedAt: workflow.updatedAt || null,
      };
    });
  }, [auditFindingWorkflowState, auditIssues, getAuditFindingKey, selectedPortfolioAudit, selectedPropertyId]);
  const selectedAuditFlaggedReasons = React.useMemo(() => (
    selectedAuditReasonPool.slice(0, 3)
  ), [selectedAuditReasonPool]);
  const auditRubricRows = React.useMemo(() => {
    const checklistByKey = new Map(
      (aiAuditChecklist || [])
        .filter((item) => item && item.key)
        .map((item) => [item.key, item])
    );
    const categoryByKey = new Map(
      (auditCategoryScores || [])
        .filter((item) => item && item.key)
        .map((item) => [item.key, item])
    );
    return AUDIT_RUBRIC_ITEMS.map((rubric) => {
      const checklistItem = checklistByKey.get(rubric.key);
      const fallbackCategory = categoryByKey.get(AUDIT_RUBRIC_FALLBACK_MAP[rubric.key]);
      const score = checklistItem?.score ?? fallbackCategory?.score;
      const status = normalizeAuditRubricStatus(checklistItem?.status, score);
      const source = checklistItem
        ? 'AI screenshot audit'
        : fallbackCategory
          ? 'Deterministic metadata proxy'
          : 'Not evaluated';
      return {
        key: rubric.key,
        label: checklistItem?.label || rubric.label,
        status,
        score,
        evidence: checklistItem?.evidence || (fallbackCategory ? `${fallbackCategory.label || rubric.label} proxy score ${formatNumber(fallbackCategory.score, 0)}.` : 'No evidence captured for this rubric item yet.'),
        source,
        confidence: checklistItem ? selectedPortfolioAudit?.confidence?.label || 'Medium' : fallbackCategory ? 'Medium' : 'Low',
        recommendation: checklistItem?.recommendation || (status === 'pass' ? 'No immediate fix needed.' : 'Run a fresh AI screenshot audit or manually verify this item.'),
      };
    });
  }, [AUDIT_RUBRIC_FALLBACK_MAP, AUDIT_RUBRIC_ITEMS, aiAuditChecklist, auditCategoryScores, formatNumber, normalizeAuditRubricStatus, selectedPortfolioAudit]);
  const auditScreenshotAnnotations = React.useMemo(() => {
    const rubricAnnotations = auditRubricRows
      .filter((row) => row.status === 'fail' || row.status === 'warn')
      .map((row) => {
        const label = {
          homepage_cta: 'CTA missing above fold',
          pricing_accuracy: 'Pricing not visible here',
          application_flow_visible: 'Application path needs review',
          floor_plan_availability: 'Availability not clear',
          special_offers_current: 'Special offer mismatch',
          page_load_desktop_mobile: 'Device/load issue',
          homepage_value_add: 'Value-add unclear',
          leasing_verbiage: 'Leasing copy needs review',
          contact_info_hours: 'Contact info/hours need review',
        }[row.key] || row.label;
        return {
          label,
          status: row.status,
          evidence: row.evidence,
          source: row.source,
        };
      });
    const reasonAnnotations = selectedAuditReasonPool.map((reason) => ({
      label: reason.category || reason.rubricLabel || 'Audit finding',
      status: String(reason.severity || '').toLowerCase() === 'high' ? 'fail' : 'warn',
      evidence: reason.evidence || getAuditReasonText(reason),
      source: 'Ranked audit finding',
    }));
    const seen = new Set();
    return [...rubricAnnotations, ...reasonAnnotations].filter((item) => {
      const key = `${item.label}-${item.evidence}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }, [auditRubricRows, getAuditReasonText, selectedAuditReasonPool]);
  const portfolioAuditSummary = React.useMemo(() => {
    const totalProperties = portfolioAuditProperties.length;
    const missingAudits = portfolioAuditProperties.filter((property) => !property.hasAudit).length;
    const urgentProperties = portfolioAuditProperties.filter((property) => property.riskTier === 'Critical' || Number(property.propertyRiskScore ?? 0) >= 74).length;
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

  const sortButton = (key, label) => (
        <button
          type="button"
          className="audit-table__sort"
          onClick={() => setAuditTableSort((current) => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
          }))}
        >
          <span>{label}</span>
          <span aria-hidden="true">{auditTableSort.key === key ? (auditTableSort.direction === 'desc' ? 'v' : '^') : ''}</span>
        </button>
      );
      const activeAuditReviewTab = AUDIT_REVIEW_TABS.some((tab) => tab.id === auditReviewTab) ? auditReviewTab : 'overview';
      const selectAuditProperty = (propertyId) => {
        setSelectedPropertyId(propertyId);
        setAuditReviewTab('overview');
      };
      const renderAuditTrendPanel = () => (
        <div className="audit-trend-panel">
          <div className="audit-trend-panel__chart">
            <AuditScoreSparkline points={selectedPortfolioAudit?.scoreHistory || selectedPortfolioAudit?.trend?.scoreHistory || []} />
            <div>
              <strong>{formatAuditScoreChange(selectedPortfolioAudit?.scoreChange)}</strong>
              <small>{selectedPortfolioAudit?.lastChangeReason || selectedPortfolioAudit?.trend?.lastChangeReason || 'No prior audit comparison yet.'}</small>
            </div>
          </div>
          <div className="audit-trend-panel__counts">
            <span><strong>{formatNumber(selectedPortfolioAudit?.newIssueCount || 0)}</strong> new</span>
            <span><strong>{formatNumber(selectedPortfolioAudit?.recurringIssueCount || selectedPortfolioAudit?.trend?.recurringIssueCount || 0)}</strong> recurring</span>
            <span><strong>{formatNumber(selectedPortfolioAudit?.regressedIssueCount || 0)}</strong> regressed</span>
            <span><strong>{formatNumber(selectedPortfolioAudit?.resolvedIssueCount || 0)}</strong> resolved</span>
            <span><strong>{formatNumber(selectedPortfolioAudit?.screenshotChangedCount || selectedPortfolioAudit?.trend?.screenshotChangedCount || 0)}</strong> screenshots</span>
            <span><strong>{formatNumber(selectedPortfolioAudit?.pageDisappearedCount || selectedPortfolioAudit?.trend?.pageDisappearedCount || 0)}</strong> pages gone</span>
            <span className={selectedPortfolioAudit?.trackingStoppedReporting || selectedPortfolioAudit?.trend?.trackingStoppedReporting ? 'audit-trend-panel__count--alert' : ''}><strong>{selectedPortfolioAudit?.trackingStoppedReporting || selectedPortfolioAudit?.trend?.trackingStoppedReporting ? 'Yes' : 'No'}</strong> tracking stopped</span>
          </div>
          {selectedPortfolioRegressionEvents.length > 0 && (
            <div className="audit-trend-events">
              {selectedPortfolioRegressionEvents.slice(0, 5).map((event, index) => (
                <span key={`${event.type || 'event'}-${event.path || index}`}>{event.label || event.type}{event.path ? ` · ${event.path}` : ''}</span>
              ))}
            </div>
          )}
        </div>
      );
      const renderAuditWorkflowQueue = () => (
        <div className="audit-workflow-queue">
          <div className="audit-workflow-queue__header">
            <strong>Finding workflow</strong>
            <small>Move each active finding through the operating queue.</small>
          </div>
          {selectedAuditReasonPool.length > 0 ? selectedAuditReasonPool.map((reason, index) => (
            <div key={reason.workflowKey || `${reason.category}-${index}`} className="audit-workflow-row">
              <div>
                <strong>{reason.issue || reason.rubricLabel || reason.category || `Finding ${index + 1}`}</strong>
                <small>{getAuditFindingWorkflowLabel(reason.workflowStatus)}{reason.workflowUpdatedAt ? ` · updated ${getSnapshotTimestampLabel(reason.workflowUpdatedAt)}` : ''}</small>
              </div>
              <select value={reason.workflowStatus || 'new'} onChange={(event) => updateAuditFindingWorkflow(reason.workflowKey, event.target.value)}>
                {AUDIT_FINDING_WORKFLOW_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </div>
          )) : (
            <div className="reports-empty">No active findings are available for this property yet.</div>
          )}
        </div>
      );
      const renderAuditWhyPanel = ({ includeWorkflowQueue = false } = {}) => (
        <div className="audit-why-panel">
          <div className="audit-why-panel__header">
            <div>
              <strong>Why this is flagged</strong>
              <small>Top problems ranked by resident and business impact.</small>
            </div>
            <span>{formatNumber(selectedAuditFlaggedReasons.length)} shown</span>
          </div>
          {selectedAuditFlaggedReasons.length > 0 ? selectedAuditFlaggedReasons.map((reason, index) => (
            <div key={`${reason.category || 'reason'}-${index}`} className="audit-why-row">
              <div className="audit-why-row__rank">{index + 1}</div>
              <div>
                <div className="audit-why-row__topline">
                  <strong>{reason.issue || reason.rubricLabel || 'Review website finding'}</strong>
                  <span>
                    {reason.category || 'Website QA'} · {reason.severity || 'medium'} severity · {reason.confidence || selectedPortfolioAudit?.confidence?.label || 'Medium'} confidence · {reason.riskScore != null ? `${Math.round(reason.riskScore)} risk` : 'risk pending'}
                  </span>
                </div>
                <small>{reason.evidence || 'Evidence is available in the latest audit output.'}</small>
                {reason.recommendation && <em>{reason.recommendation}</em>}
                <div className="audit-risk-factors">
                  <span>Page {reason.pageImportance?.label || 'Medium'}</span>
                  <span>Urgency {reason.businessUrgency?.label || 'Medium'}</span>
                  {reason.confidenceScore != null && <span>Confidence {formatNumber(reason.confidenceScore)}%</span>}
                  {reason.businessUrgency?.signals?.length > 0 && <span>{reason.businessUrgency.signals.slice(0, 2).join(' · ')}</span>}
                </div>
              </div>
              <label className="audit-workflow-select">
                <span>Workflow</span>
                <select value={reason.workflowStatus || 'new'} onChange={(event) => updateAuditFindingWorkflow(reason.workflowKey, event.target.value)}>
                  {AUDIT_FINDING_WORKFLOW_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                </select>
              </label>
            </div>
          )) : (
            <div className="reports-empty">No ranked reasons are available yet. Run or refresh the audit to populate impact-based findings.</div>
          )}
          {includeWorkflowQueue && renderAuditWorkflowQueue()}
        </div>
      );
      const renderAuditRubricPanel = () => (
        <div className="audit-rubric-panel">
          <div className="audit-rubric-panel__header">
            <div>
              <strong>9-point audit rubric</strong>
              <small>Compact evidence rows for the selected page and latest property audit.</small>
            </div>
            <span>{auditModeLabel}</span>
          </div>
          <div className="audit-rubric-table">
            {auditRubricRows.map((row) => (
              <div key={row.key} className="audit-rubric-row">
                <div className="audit-rubric-row__status">
                  <span className={`audit-rubric-status audit-rubric-status--${row.status}`}>{getAuditRubricStatusLabel(row.status)}</span>
                  <strong>{row.score != null ? Math.round(row.score) : '—'}</strong>
                </div>
                <div className="audit-rubric-row__main">
                  <strong>{row.label}</strong>
                  <small>{row.evidence}</small>
                </div>
                <div className="audit-rubric-row__meta">
                  <span>{row.source}</span>
                  <span>{row.confidence} confidence</span>
                </div>
                <div className="audit-rubric-row__fix">{row.recommendation}</div>
              </div>
            ))}
          </div>
        </div>
      );
      const renderAuditScreenshotPanel = () => (
        <div className="audit-detail-grid">
          <div className="audit-screenshot-card">
            <div className="audit-screenshot-card__header">
              <div>
                <strong>Screenshot review</strong>
                <small>Full-page scroll preview with audit callouts.</small>
              </div>
              <div className="audit-device-tabs" role="tablist" aria-label="Screenshot device">
                {HEATMAP_DEVICE_OPTIONS.map((device) => (
                  <button
                    key={device}
                    type="button"
                    role="tab"
                    aria-selected={selectedHeatmapDevice === device}
                    className={`audit-device-tab${selectedHeatmapDevice === device ? ' is-active' : ''}`}
                    onClick={() => setSelectedHeatmapDevice(device)}
                  >
                    {device}
                  </button>
                ))}
              </div>
            </div>
            <div className="audit-screenshot-card__viewport">
              {screenshotPreviewUrl ? (
                <div className="audit-screenshot-card__scroll">
                  <img src={screenshotPreviewUrl} alt={`${selectedPortfolioAudit?.propertyName || selectedPropertyLabel} site screenshot`} className="audit-screenshot-card__image" />
                  {auditScreenshotAnnotations.length > 0 && (
                    <div className="audit-screenshot-card__annotations" aria-label="Screenshot annotations">
                      {auditScreenshotAnnotations.slice(0, 3).map((annotation, index) => (
                        <div key={`${annotation.label}-${index}`} className={`audit-screenshot-annotation audit-screenshot-annotation--${annotation.status}`}>
                          <strong>{annotation.label}</strong>
                          <span>{annotation.evidence}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="audit-screenshot-card__empty">No screenshot preview stored for this page and device yet.</div>
              )}
            </div>
            <div className="audit-screenshot-card__meta">
              <strong>Screenshot</strong>
              <span>{selectedScreenshot?.capturedAt ? getSnapshotTimestampLabel(selectedScreenshot.capturedAt) : 'No capture yet'}</span>
            </div>
            <div className="audit-screenshot-callouts">
              {auditScreenshotAnnotations.length > 0 ? auditScreenshotAnnotations.map((annotation, index) => (
                <div key={`${annotation.source}-${annotation.label}-${index}`} className="audit-screenshot-callout">
                  <span className={`audit-rubric-status audit-rubric-status--${annotation.status}`}>{getAuditRubricStatusLabel(annotation.status)}</span>
                  <div>
                    <strong>{annotation.label}</strong>
                    <small>{annotation.source} · {annotation.evidence}</small>
                  </div>
                </div>
              )) : (
                <div className="audit-screenshot-callout">
                  <span className="audit-rubric-status audit-rubric-status--pass">Pass</span>
                  <div>
                    <strong>No visual callouts yet</strong>
                    <small>Run an AI screenshot audit to attach page-specific visual findings.</small>
                  </div>
                </div>
              )}
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
              <div className="reports-empty">Select a property from the table, then run an audit if this property has not been scored yet.</div>
            )}
          </div>
        </div>
      );

      return (
        <div className="audit-view">
          <div className="audit-shell">
            <div className="audit-hero">
              <div>
                <div className="reports-kicker">Internal Command Center</div>
                <div className="reports-headline">Website audit priorities across every property.</div>
                <div className="reports-subhead">
                  Rank sites by risk tier, confidence, audit movement, failing rubric, and issue load so web cleanup starts with the properties most likely to cost leases.
                </div>
              </div>
              <div className="reports-chip-row">
                <div className="reports-chip">All properties</div>
                <div className="reports-chip">{portfolioAuditSummary.urgentProperties} urgent</div>
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
                <div className="reports-kpi-card__meta">Critical risk or audit score below 70</div>
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
              <section className="reports-panel audit-table-panel">
                <div className="reports-panel__eyebrow">Priority Table</div>
                <div className="reports-panel__title">Sortable audit triage</div>
                <div className="audit-filter-bar">
                  <div className="audit-filter-tabs" aria-label="Audit risk filters">
                    {AUDIT_TABLE_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        className={`audit-filter-tab${auditTableFilter === filter.id ? ' is-active' : ''}`}
                        onClick={() => setAuditTableFilter(filter.id)}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                  <div className="audit-filter-selects">
                    <label className="website-manager-field">
                      <span className="website-manager-field__label">Portfolio</span>
                      <select className="website-manager-field__input" value={auditPortfolioFilter} onChange={(event) => setAuditPortfolioFilter(event.target.value)}>
                        <option value="all">All portfolios</option>
                        {auditPortfolioOptions.map((portfolio) => <option key={portfolio} value={portfolio}>{portfolio}</option>)}
                      </select>
                    </label>
                    <label className="website-manager-field">
                      <span className="website-manager-field__label">Region</span>
                      <select className="website-manager-field__input" value={auditRegionFilter} onChange={(event) => setAuditRegionFilter(event.target.value)}>
                        <option value="all">All regions</option>
                        {auditRegionOptions.map((region) => <option key={region} value={region}>{region}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
                {portfolioAuditError && <div className="reports-empty">{portfolioAuditError}</div>}
                {!portfolioAuditError && (
                  <div className="audit-table-wrap">
                    {portfolioAuditLoading && <div className="reports-empty">Loading portfolio audit data…</div>}
                    {!portfolioAuditLoading && (
                      <table className="audit-table">
                        <thead>
                          <tr>
                            <th>{sortButton('propertyName', 'Property')}</th>
                            <th>{sortButton('riskTier', 'Risk')}</th>
                            <th>{sortButton('propertyRiskScore', 'Risk score')}</th>
                            <th>{sortButton('performanceScore', 'Score')}</th>
                            <th>{sortButton('scoreChange', 'Change')}</th>
                            <th>{sortButton('topSeverity', 'Severity')}</th>
                            <th>{sortButton('trend', 'Trend')}</th>
                            <th>{sortButton('topFailingRubric', 'Top failing rubric')}</th>
                            <th>{sortButton('auditedAt', 'Last audited')}</th>
                            <th>{sortButton('issueCount', 'Issues')}</th>
                            <th>{sortButton('confidence', 'Confidence')}</th>
                            <th>{sortButton('auditStatus', 'Status')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPortfolioAuditProperties.map((property) => {
                            const isActive = property.propertyId === selectedPortfolioAudit?.propertyId;
                            const riskClass = getAuditRiskClass(property.riskTier);
                            return (
                              <tr
                                key={property.propertyId}
                                className={isActive ? 'is-active' : ''}
                                onClick={() => selectAuditProperty(property.propertyId)}
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="audit-table__property"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      selectAuditProperty(property.propertyId);
                                    }}
                                  >
                                    <strong>{property.propertyName}</strong>
                                    <span>{[property.city, property.state].filter(Boolean).join(', ') || 'Location pending'}</span>
                                  </button>
                                </td>
                                <td><span className={`audit-risk-pill audit-risk-pill--${riskClass}`}>{property.riskTier || 'Unknown'}</span></td>
                                <td>
                                  <div className="audit-table__confidence">
                                    <strong>{property.propertyRiskScore != null ? Math.round(property.propertyRiskScore) : '—'}</strong>
                                    <span>{property.propertyRisk?.reason || 'Business impact weighted'}</span>
                                  </div>
                                </td>
                                <td><strong>{property.performanceScore != null ? Math.round(property.performanceScore) : '—'}</strong></td>
                                <td><span className={`audit-delta audit-delta--${getDeltaTone(property.scoreChange)}`}>{formatAuditScoreChange(property.scoreChange)}</span></td>
                                <td>
                                  <div className="audit-table__confidence">
                                    <strong>{property.topSeverity || '—'}</strong>
                                    <span>{property.topSeverityScore != null ? `${formatNumber(property.topSeverityScore)} severity` : '—'}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="audit-trend-cell">
                                    <AuditScoreSparkline points={property.scoreHistory || property.trend?.scoreHistory || []} />
                                    <span>
                                      +{formatNumber(property.newIssueCount || 0)} new · {formatNumber(property.recurringIssueCount || property.trend?.recurringIssueCount || 0)} recurring · {formatNumber(property.resolvedIssueCount || 0)} resolved
                                    </span>
                                    {(property.trackingStoppedReporting || property.pageDisappearedCount || property.screenshotChangedCount) && (
                                      <span>
                                        {property.trackingStoppedReporting ? 'tracking stopped · ' : ''}{formatNumber(property.pageDisappearedCount || 0)} gone · {formatNumber(property.screenshotChangedCount || 0)} screenshots
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <div className="audit-table__rubric">
                                    <strong>{property.topFailingRubric?.label || '—'}</strong>
                                    <span>{property.topFailingRubric?.score != null ? `${Math.round(property.topFailingRubric.score)} score` : property.hasAudit ? 'No failing rubric' : 'Audit needed'}</span>
                                  </div>
                                </td>
                                <td>{property.auditedAt ? getSnapshotTimestampLabel(property.auditedAt) : 'Never'}</td>
                                <td>{formatNumber(property.issueCount || 0)}</td>
                                <td>
                                  <div className="audit-table__confidence">
                                    <strong>{property.confidence?.label || 'None'}</strong>
                                    <span>{property.confidence?.score != null ? `${formatNumber(property.confidence.score)}%` : '—'}</span>
                                  </div>
                                </td>
                                <td>{property.auditStatus || (property.hasAudit ? 'ok' : 'not started')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {!portfolioAuditLoading && filteredPortfolioAuditProperties.length === 0 && (
                      <div className="reports-empty">No properties match the selected audit filters.</div>
                    )}
                  </div>
                )}
              </section>

              <section className="reports-panel audit-review-panel">
                <div className="reports-panel__eyebrow">Selected Property</div>
                <div className="reports-panel__title">
                  {selectedPortfolioAudit?.propertyName || selectedPropertyLabel || 'Choose a property'}
                </div>
                {siteAuditNotice && <div className="reports-empty" style={{ marginBottom: '1rem' }}>{siteAuditNotice}</div>}
                <div className="audit-detail-toolbar">
                  <label className="website-manager-field">
                    <span className="website-manager-field__label">Audit page</span>
                    <select className="website-manager-field__input" value={selectedHeatmapPath} onChange={(event) => setSelectedHeatmapPath(event.target.value)}>
                      {auditPageOptions.map((page) => <option key={page.path || page.id} value={page.path || '/'}>{page.title || page.path || '/'}</option>)}
                      {auditPageOptions.length === 0 && <option value="">No audit pages captured yet</option>}
                    </select>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <button type="button" className="website-manager-button website-manager-button--primary" onClick={runSiteAudit} disabled={siteAuditRunning || siteAuditLoading || !selectedPropertyId}>
                      {siteAuditRunning ? 'Queueing…' : 'Queue AI Audit'}
                    </button>
                  </div>
                </div>

                <div className="reports-panel__grid reports-panel__grid--three">
                  <div className="reports-stat"><span>Property Risk Score</span><strong>{renderMetricValue(siteAuditLoading, selectedPortfolioAudit?.propertyRiskScore != null ? Math.round(selectedPortfolioAudit.propertyRiskScore) : '—')}</strong><small>{selectedPortfolioAudit?.propertyRisk?.reason || 'Severity × confidence × page importance × business urgency'}</small></div>
                  <div className="reports-stat"><span>Audit Score</span><strong>{renderMetricValue(siteAuditLoading, auditPageResult?.score ?? latestAudit?.performance_score ?? selectedPortfolioAudit?.performanceScore ?? '—')}</strong><small>{selectedPortfolioAudit?.summary || 'Latest site audit snapshot'} · {auditModeLabel}</small></div>
                  <div className="reports-stat"><span>Severity / Confidence</span><strong>{selectedPortfolioAudit?.topSeverity || '—'} / {selectedPortfolioAudit?.confidence?.label || 'No'}</strong><small>{selectedPortfolioAudit?.confidence?.detail || 'Audit evidence pending'}</small></div>
                  <div className="reports-stat"><span>Freshness / Links</span><strong>{latestAudit?.freshness_score ?? selectedPortfolioAudit?.freshnessScore ?? '—'}</strong><small>{formatNumber(Array.isArray(auditBrokenLinks) ? auditBrokenLinks.length : selectedPortfolioAudit?.brokenLinkCount || 0)} suspicious links</small></div>
                </div>

                <div className="audit-review-tabs" role="tablist" aria-label="Audit review sections">
                  {AUDIT_REVIEW_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={activeAuditReviewTab === tab.id}
                      className={`audit-review-tab${activeAuditReviewTab === tab.id ? ' is-active' : ''}`}
                      onClick={() => setAuditReviewTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="audit-review-scroll">
                  {activeAuditReviewTab === 'overview' && (
                    <>
                      {renderAuditTrendPanel()}
                      {renderAuditWhyPanel()}
                    </>
                  )}
                  {activeAuditReviewTab === 'rubric' && renderAuditRubricPanel()}
                  {activeAuditReviewTab === 'screenshot' && renderAuditScreenshotPanel()}
                  {activeAuditReviewTab === 'workflow' && renderAuditWorkflowQueue()}
                </div>
              </section>
            </div>
          </div>
        </div>
      );
}
