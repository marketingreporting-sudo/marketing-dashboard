import React, { useEffect, useMemo, useState } from 'react';

const LAYER_META = {
  click: { label: 'Click / tap', shortLabel: 'Clicks', color: '255, 91, 91' },
  cursor: { label: 'Cursor density', shortLabel: 'Cursor', color: '92, 185, 255' },
  scroll: { label: 'Scroll depth', shortLabel: 'Scroll', color: '238, 196, 94' },
  engagement: { label: 'Engagement', shortLabel: 'Engagement', color: '255, 210, 95' },
};

const EVENT_TO_LAYER = {
  click: 'click',
  cta_click: 'click',
  pointerdown: 'click',
  touchstart: 'click',
  mousemove: 'cursor',
  pointermove: 'cursor',
  scroll: 'scroll',
  engagement: 'engagement',
};

const clampPercent = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const parsePercent = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampPercent(parsed);
};

const getViewportLabel = (deviceType) => {
  if (deviceType === 'mobile') return 'Mobile viewport';
  if (deviceType === 'tablet') return 'Tablet viewport';
  return 'Desktop viewport';
};

const ZOOM_OPTIONS = [
  { key: 'fit', label: 'Fit width' },
  { key: '100', label: '100%' },
  { key: '150', label: '150%' },
];

const SCROLL_HEAT_COLORS = {
  hot: 'rgba(235, 45, 45, 0.62)',
  warm: 'rgba(255, 198, 52, 0.58)',
  mid: 'rgba(86, 205, 112, 0.52)',
  cool: 'rgba(45, 139, 255, 0.46)',
  cold: 'rgba(68, 91, 255, 0.34)',
};

const normalizeTargetKey = (value) => String(value || '').trim().toLowerCase();

const getCellTargetKeys = (cell) => [
  cell.targetKey,
  cell.trackId,
  cell.targetTrackId,
  cell.selector,
  cell.targetSelector,
  cell.label,
  cell.category,
].map(normalizeTargetKey).filter(Boolean);

const cellMatchesTarget = (cell, target) => {
  if (!target) return false;
  const targetKeys = [
    target.targetKey,
    target.trackId,
    target.targetTrackId,
    target.selector,
    target.targetSelector,
    target.label,
    target.category,
  ].map(normalizeTargetKey).filter(Boolean);
  if (!targetKeys.length) return false;
  const cellKeys = getCellTargetKeys(cell);
  return targetKeys.some((targetKey) => cellKeys.some((cellKey) => cellKey === targetKey || cellKey.includes(targetKey) || targetKey.includes(cellKey)));
};

const getConfidence = (eventCount) => {
  const count = Number(eventCount || 0);
  if (count <= 0) return { label: 'Waiting for traffic', detail: 'Screenshot and audit can be ready before interaction data arrives.', tone: 'pending' };
  if (count < 10) return { label: 'Low confidence', detail: 'Treat patterns as anecdotal until more events arrive.', tone: 'low' };
  if (count < 50) return { label: 'Directional', detail: 'Useful for QA and early trends.', tone: 'medium' };
  return { label: 'High confidence', detail: 'Enough interaction volume for stronger pattern reads.', tone: 'high' };
};

const formatPercent = (value, digits = 0) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return '0%';
  return `${Math.round(parsed * 100 * (10 ** digits)) / (10 ** digits)}%`;
};

const scrollColorForPercent = (percentReached) => {
  const value = Number(percentReached || 0);
  if (value >= 0.75) return SCROLL_HEAT_COLORS.hot;
  if (value >= 0.5) return SCROLL_HEAT_COLORS.warm;
  if (value >= 0.3) return SCROLL_HEAT_COLORS.mid;
  if (value >= 0.12) return SCROLL_HEAT_COLORS.cool;
  return SCROLL_HEAT_COLORS.cold;
};

const normalizeScrollBands = (scrollSummary, maxScroll) => {
  const explicitBands = Array.isArray(scrollSummary?.bands) ? scrollSummary.bands : [];
  const bands = explicitBands
    .map((band) => {
      const startPct = Number(band.startPct ?? band.start ?? 0);
      const endPct = Number(band.endPct ?? band.end ?? 0);
      const percentReached = parsePercent(band.percentReached ?? band.percent ?? 0);
      const sessionsReached = Number(band.sessionsReached ?? band.sessions ?? 0);
      if (!Number.isFinite(startPct) || !Number.isFinite(endPct) || endPct <= startPct) return null;
      return { startPct, endPct, percentReached, sessionsReached };
    })
    .filter(Boolean)
    .sort((a, b) => a.startPct - b.startPct);
  if (bands.length) return bands;

  const reach = scrollSummary?.reach && typeof scrollSummary.reach === 'object' ? scrollSummary.reach : {};
  const reachBands = Object.entries(reach)
    .map(([threshold, payload]) => {
      const endPct = Number(payload?.thresholdPct ?? threshold);
      const percentReached = parsePercent(payload?.percent ?? 0);
      const sessionsReached = Number(payload?.sessions ?? 0);
      if (!Number.isFinite(endPct) || endPct <= 0) return null;
      return {
        startPct: Math.max(0, endPct - 10),
        endPct,
        percentReached,
        sessionsReached,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startPct - b.startPct);
  if (reachBands.length) return reachBands;

  if (maxScroll > 0) {
    const reachedPct = Math.round(maxScroll * 100);
    return [
      { startPct: 0, endPct: reachedPct, percentReached: 1, sessionsReached: 0 },
      { startPct: reachedPct, endPct: 100, percentReached: 0, sessionsReached: 0 },
    ].filter((band) => band.endPct > band.startPct);
  }
  return [];
};

const getScrollDropoffInsight = (scrollSummary, totals) => {
  const avgAbandonment = Number(totals?.avgAbandonmentDepthPct || scrollSummary?.avgAbandonmentDepthPct || 0);
  if (avgAbandonment > 0) {
    return `Most visitors drop off around ${Math.round(avgAbandonment * 100)}%.`;
  }
  const distribution = Array.isArray(scrollSummary?.abandonmentDepthDistribution)
    ? scrollSummary.abandonmentDepthDistribution
    : [];
  const largestBand = distribution
    .filter((band) => Number(band.sessions || 0) > 0)
    .sort((a, b) => Number(b.sessions || 0) - Number(a.sessions || 0))[0];
  if (!largestBand) return '';
  const midpoint = (Number(largestBand.startPct || 0) + Number(largestBand.endPct || 0)) / 2;
  return `Most visitors drop off around ${Math.round(midpoint)}%.`;
};

const getFoldPercent = (screenshot) => {
  const captureMetrics = screenshot?.captureMetrics || {};
  const viewportHeight = Number(captureMetrics.viewportHeight || screenshot?.viewportHeight || 0);
  const documentHeight = Number(captureMetrics.documentHeight || screenshot?.height || 0);
  if (!Number.isFinite(viewportHeight) || !Number.isFinite(documentHeight) || viewportHeight <= 0 || documentHeight <= 0) return null;
  return clampPercent(viewportHeight / documentHeight);
};

const coordinatePercent = (point, axis, screenshot) => {
  const pctKey = axis === 'x' ? 'xPct' : 'yPct';
  const pageKey = axis === 'x' ? 'pageX' : 'pageY';
  const documentKey = axis === 'x' ? 'documentWidth' : 'documentHeight';
  const screenshotKey = axis === 'x' ? 'width' : 'height';
  const captureMetrics = screenshot?.captureMetrics || {};
  const pageValue = Number(point[pageKey]);
  if (captureMetrics.screenshotMode === 'clipped' && Number.isFinite(pageValue)) {
    const clip = captureMetrics.clip || {};
    const clipStart = Number(axis === 'x' ? clip.x : clip.y) || 0;
    const clipSize = Number(axis === 'x' ? clip.width : clip.height)
      || Number(captureMetrics[axis === 'x' ? 'screenshotWidth' : 'screenshotHeight'])
      || Number(screenshot?.[screenshotKey]);
    if (Number.isFinite(clipSize) && clipSize > 0) {
      if (pageValue < clipStart || pageValue > clipStart + clipSize) return null;
      return clampPercent((pageValue - clipStart) / clipSize);
    }
  }
  const direct = parsePercent(point[pctKey]);
  if (direct != null) return direct;
  const documentValue = Number(point[documentKey] || captureMetrics[documentKey] || screenshot?.[screenshotKey]);
  if (Number.isFinite(pageValue) && Number.isFinite(documentValue) && documentValue > 0) {
    return clampPercent(pageValue / documentValue);
  }
  return null;
};

const aggregatePoints = (points, activeLayers, screenshot, gridSize = 24) => {
  const cells = new Map();
  points.forEach((point) => {
    const layer = EVENT_TO_LAYER[point.type] || point.type;
    if (!activeLayers[layer] || layer === 'scroll') return;
    const xPct = coordinatePercent(point, 'x', screenshot);
    const yPct = coordinatePercent(point, 'y', screenshot);
    if (xPct == null || yPct == null) return;
    if (xPct <= 0.001 && yPct <= 0.001 && !point.targetLabel && !point.targetHref) return;
    const gridX = Math.min(gridSize - 1, Math.floor(xPct * gridSize));
    const gridY = Math.min(gridSize - 1, Math.floor(yPct * gridSize));
    const key = `${layer}:${gridX}:${gridY}`;
    const current = cells.get(key) || {
      key,
      layer,
      gridX,
      gridY,
      count: 0,
      xTotal: 0,
      yTotal: 0,
      label: point.targetLabel || point.targetTrackId || point.targetSelector || point.targetId || point.targetTag || LAYER_META[layer]?.label || layer,
      category: point.targetCategory || '',
      selector: point.targetSelector || '',
    };
    current.count += 1;
    current.xTotal += xPct;
    current.yTotal += yPct;
    cells.set(key, current);
  });
  const values = Array.from(cells.values());
  const maxCount = Math.max(1, ...values.map((cell) => cell.count));
  return values.map((cell) => ({
    ...cell,
    xPct: cell.xTotal / cell.count,
    yPct: cell.yTotal / cell.count,
    intensity: cell.count / maxCount,
  }));
};

const normalizeAggregateCells = (cells, activeLayers) => {
  const visibleCells = (Array.isArray(cells) ? cells : [])
    .map((cell) => {
      const layer = cell.layer || EVENT_TO_LAYER[cell.eventType] || EVENT_TO_LAYER[cell.type] || cell.type;
      if (!activeLayers[layer] || layer === 'scroll') return null;
      const xPct = parsePercent(cell.xPct ?? cell.avgXPct);
      const yPct = parsePercent(cell.yPct ?? cell.avgYPct);
      if (xPct == null || yPct == null) return null;
      const count = Number(cell.count ?? cell.eventCount ?? 0);
      if (!Number.isFinite(count) || count <= 0) return null;
      return {
        key: cell.key || `${layer}:${cell.gridX ?? 'x'}:${cell.gridY ?? 'y'}:${cell.eventType || cell.type || 'event'}`,
        layer,
        count,
        xPct,
        yPct,
        intensity: Number(cell.intensity || 0),
        label: cell.label || cell.targetLabel || cell.eventType || LAYER_META[layer]?.label || layer,
        category: cell.category || '',
        selector: cell.selector || '',
        trackId: cell.trackId || cell.targetTrackId || '',
        eventType: cell.eventType || cell.type || '',
      };
    })
    .filter(Boolean);
  const maxCount = Math.max(1, ...visibleCells.map((cell) => cell.count));
  return visibleCells.map((cell) => ({
    ...cell,
    intensity: cell.intensity > 0 ? cell.intensity : cell.count / maxCount,
  }));
};

const getTargetBounds = (target) => {
  const bounds = target?.bounds || target?.targetBounds;
  if (!bounds || typeof bounds !== 'object') return null;
  const leftPct = parsePercent(bounds.leftPct);
  const topPct = parsePercent(bounds.topPct);
  if (leftPct == null || topPct == null) return null;
  return {
    leftPct,
    topPct,
    widthPct: parsePercent(bounds.widthPct) ?? 0,
    heightPct: parsePercent(bounds.heightPct) ?? 0,
  };
};

const normalizeTargetHotspots = (targets) => {
  const visibleTargets = (Array.isArray(targets) ? targets : [])
    .map((target, index) => {
      const bounds = getTargetBounds(target);
      const xPct = bounds
        ? clampPercent(bounds.leftPct + (bounds.widthPct / 2))
        : parsePercent(target?.xPct ?? target?.avgXPct);
      const yPct = bounds
        ? clampPercent(bounds.topPct + (bounds.heightPct / 2))
        : parsePercent(target?.yPct ?? target?.avgYPct);
      const clicks = Number(target?.clicks || target?.clickCount || 0);
      const ctaClicks = Number(target?.ctaClicks || target?.cta_click_count || 0);
      if (xPct == null || yPct == null || clicks + ctaClicks <= 0) return null;
      return {
        ...target,
        rank: index + 1,
        key: target.targetKey || target.trackId || target.selector || target.label || `${index}:${xPct}:${yPct}`,
        xPct,
        yPct,
        bounds,
        clicks,
        ctaClicks,
        taps: Number(target?.taps || target?.tapCount || 0),
        sessions: Number(target?.sessions || target?.sessionCount || 0),
        deadClicks: Number(target?.deadClicks || 0),
        rageClicks: Number(target?.rageClicks || 0),
        label: target.label || target.trackId || target.selector || 'Clicked element',
        category: target.category || 'unknown',
      };
    })
    .filter(Boolean);
  const maxClicks = Math.max(1, ...visibleTargets.map((target) => target.clicks + target.ctaClicks));
  return visibleTargets.map((target) => ({
    ...target,
    intensity: (target.clicks + target.ctaClicks) / maxClicks,
  }));
};

export default function HeatmapRenderer({
  points = [],
  cells = [],
  targetHotspots = [],
  totals = {},
  deviceType = 'desktop',
  screenshotUrl = '',
  screenshot = null,
  loading = false,
  error = '',
  activeLayers,
  onLayerChange,
  highlightedTarget = null,
  scrollSummary = {},
  formatNumber = (value) => String(value ?? 0),
}) {
  const layers = useMemo(() => ({
    click: activeLayers?.click !== false,
    cursor: activeLayers?.cursor === true,
    scroll: activeLayers?.scroll === true,
    engagement: activeLayers?.engagement === true,
  }), [activeLayers?.click, activeLayers?.cursor, activeLayers?.scroll, activeLayers?.engagement]);
  const activeLayerCount = Object.values(layers).filter(Boolean).length;
  const aggregateCells = useMemo(() => {
    const serverCells = normalizeAggregateCells(cells, layers);
    return serverCells.length > 0 ? serverCells : aggregatePoints(points, layers, screenshot);
  }, [cells, points, layers, screenshot]);
  const clickHotspots = useMemo(() => (
    layers.click ? normalizeTargetHotspots(targetHotspots).slice(0, 25) : []
  ), [layers.click, targetHotspots]);
  const maxScroll = clampPercent(totals.maxScrollDepthPct);
  const scrollBands = useMemo(() => normalizeScrollBands(scrollSummary, maxScroll), [scrollSummary, maxScroll]);
  const hasScrollReach = scrollBands.some((band) => Number(band.percentReached || 0) > 0);
  const foldPercent = getFoldPercent(screenshot);
  const scrollDropoffInsight = getScrollDropoffInsight(scrollSummary, totals);
  const hasScreenshot = Boolean(screenshotUrl);
  const [hoveredScrollBand, setHoveredScrollBand] = useState(null);
  const [zoomMode, setZoomMode] = useState('fit');
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const hasData = aggregateCells.length > 0 || (layers.scroll && (maxScroll > 0 || hasScrollReach));
  const trafficEvents = Number(totals.events || 0);
  const confidence = getConfidence(trafficEvents);
  const layerTotals = useMemo(() => {
    const cellTotals = aggregateCells.reduce((totalsByLayer, cell) => {
      totalsByLayer[cell.layer] = (totalsByLayer[cell.layer] || 0) + Number(cell.count || 0);
      return totalsByLayer;
    }, {});
    const clickTotal = Number(totals.clicks || 0) + Number(totals.ctaClicks || 0);
    return {
      click: clickTotal || cellTotals.click || 0,
      cursor: Number(totals.cursorSamples || 0) || Number(totals.mouseMoves || 0) + Number(totals.pointerMoves || 0) || cellTotals.cursor || 0,
      scroll: Number(totals.scrolls || 0),
      engagement: Number(totals.engagements || 0) || cellTotals.engagement || 0,
    };
  }, [aggregateCells, totals]);
  const activeCell = selectedCell || hoveredCell;
  const activeTarget = selectedTarget;
  const hasExplicitHighlightedCells = useMemo(
    () => Boolean(highlightedTarget) && aggregateCells.some((cell) => cellMatchesTarget(cell, highlightedTarget)),
    [aggregateCells, highlightedTarget],
  );
  const screenshotWidth = Number(screenshot?.width || 0);
  const screenshotHeight = Number(screenshot?.height || 0);
  const pageAspectRatio = screenshotWidth > 0 && screenshotHeight > 0
    ? `${screenshotWidth} / ${screenshotHeight}`
    : '16 / 36';
  const pageWidthPercent = deviceType === 'mobile' ? '44%' : deviceType === 'tablet' ? '64%' : '100%';
  const pageMinWidth = deviceType === 'mobile' ? 320 : deviceType === 'tablet' ? 620 : 960;
  const nativePreviewWidth = Math.max(pageMinWidth, screenshotWidth || pageMinWidth);
  const pageSurfaceStyle = zoomMode === 'fit'
    ? {
        width: pageWidthPercent,
        minWidth: 0,
        maxWidth: '100%',
        margin: '0 auto',
      }
    : {
        width: `${Math.round(nativePreviewWidth * (zoomMode === '150' ? 1.5 : 1))}px`,
        maxWidth: 'none',
        margin: '0 auto',
      };
  const showScreenshot = hasScreenshot && imageLoaded && !imageFailed;
  const previewStatus = loading
    ? 'Loading screenshot...'
    : showScreenshot
      ? 'Screenshot loaded'
      : hasScreenshot && imageFailed
        ? 'Screenshot image failed to load'
        : screenshot
          ? `Screenshot preview unavailable${error ? `: ${error}` : ''}`
          : 'Blank page frame';
  const emptyMessage = activeLayerCount === 0
    ? 'Waiting for interaction data. The screenshot is ready, and overlays will appear once clicks or scroll activity are collected.'
    : 'No heatmap events for the selected page, device, and date range yet.';

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
    setSelectedCell(null);
    setSelectedTarget(null);
    setHoveredCell(null);
    setHoveredScrollBand(null);
  }, [screenshotUrl]);

  return (
    <div className="heatmap-renderer">
      <div className="heatmap-renderer-toolbar">
        <div className="heatmap-layer-control" aria-label="Heatmap layers">
          {Object.entries(LAYER_META).map(([layer, meta]) => (
            <button
              key={layer}
              type="button"
              className={`heatmap-layer-toggle${layers[layer] ? ' is-active' : ''}`}
              aria-pressed={Boolean(layers[layer])}
              onClick={() => onLayerChange?.(layer, !layers[layer])}
              style={{ '--layer-rgb': meta.color }}
            >
              <span className="heatmap-layer-toggle__dot" aria-hidden="true" />
              <span>{meta.shortLabel}</span>
              <strong>{formatNumber(layerTotals[layer] || 0)}</strong>
            </button>
          ))}
        </div>
        <div className="heatmap-zoom-control" aria-label="Preview zoom">
          {ZOOM_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`heatmap-zoom-toggle${zoomMode === option.key ? ' is-active' : ''}`}
              aria-pressed={zoomMode === option.key}
              onClick={() => setZoomMode(option.key)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="heatmap-zoom-toggle"
            disabled={!screenshotUrl}
            onClick={() => {
              if (screenshotUrl) window.open(screenshotUrl, '_blank', 'noopener,noreferrer');
            }}
          >
            Open preview
          </button>
        </div>
      </div>
      <div className="heatmap-analyst-strip">
        <div className={`heatmap-confidence heatmap-confidence--${confidence.tone}`}>
          <strong>{confidence.label}</strong>
          <span>{confidence.detail}</span>
        </div>
        <div className="heatmap-layer-legend">
          {Object.entries(LAYER_META).map(([layer, meta]) => (
            <span key={layer} style={{ '--layer-rgb': meta.color }}>
              <i aria-hidden="true" />
              {meta.label}: {formatNumber(layerTotals[layer] || 0)}
            </span>
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: 'clamp(420px, 54vw, 760px)',
          minHeight: 0,
          border: '1px solid var(--panel-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, rgba(8,18,22,0.96), rgba(18,39,45,0.96))',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
        }}
      >
        <div
          style={{
            height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '0 0.75rem',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(6,14,17,0.78)',
            color: 'var(--primary-tan)',
            fontSize: '0.75rem',
          }}
        >
          <span>{getViewportLabel(deviceType)}</span>
          <span style={{ color: 'rgba(255,255,255,0.72)' }}>
            {previewStatus}
          </span>
        </div>
        <div
          style={{
            position: 'absolute',
            inset: '34px 0 0',
            overflowY: 'auto',
            overflowX: 'auto',
            scrollbarColor: 'rgba(255,255,255,0.32) transparent',
            background: 'rgba(14,30,35,0.82)',
          }}
        >
          <div
            style={{
              position: 'relative',
              ...pageSurfaceStyle,
              minHeight: '100%',
              aspectRatio: pageAspectRatio,
              background: showScreenshot
                ? 'rgba(10,20,24,0.42)'
                : 'linear-gradient(180deg, rgba(230,213,184,0.10), rgba(255,255,255,0.03))',
            }}
          >
            {hasScreenshot && (
              <img
                src={screenshotUrl}
                alt=""
                aria-hidden="true"
                onLoad={() => {
                  setImageLoaded(true);
                  setImageFailed(false);
                }}
                onError={() => {
                  setImageLoaded(false);
                  setImageFailed(true);
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'fill',
                  opacity: showScreenshot ? 0.86 : 0,
                  pointerEvents: 'none',
                }}
              />
            )}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)' }} />
            {layers.scroll && (hasScrollReach || maxScroll > 0) && (
              <>
                <div className="heatmap-scroll-overlay" aria-label="Scroll reach heatmap">
                  {scrollBands.map((band) => {
                    const top = Math.max(0, Math.min(100, Number(band.startPct || 0)));
                    const bottom = Math.max(top, Math.min(100, Number(band.endPct || 0)));
                    const percentReached = Number(band.percentReached || 0);
                    const label = `${Math.round(percentReached * 100)}% reached ${Math.round(bottom)}%`;
                    return (
                      <button
                        key={`${band.startPct}-${band.endPct}`}
                        type="button"
                        className="heatmap-scroll-band"
                        aria-label={label}
                        title={label}
                        onMouseEnter={() => setHoveredScrollBand(band)}
                        onMouseLeave={() => setHoveredScrollBand(null)}
                        onFocus={() => setHoveredScrollBand(band)}
                        onBlur={() => setHoveredScrollBand(null)}
                        style={{
                          top: `${top}%`,
                          height: `${Math.max(0.4, bottom - top)}%`,
                          background: scrollColorForPercent(percentReached),
                          mixBlendMode: showScreenshot ? 'multiply' : 'screen',
                        }}
                      />
                    );
                  })}
                </div>
                {scrollBands.map((band) => {
                  const endPct = Math.max(0, Math.min(100, Number(band.endPct || 0)));
                  const percentReached = Number(band.percentReached || 0);
                  if (![25, 50, 75, 90, 100].includes(Math.round(endPct)) && endPct % 10 !== 0) return null;
                  return (
                    <div
                      key={`threshold-${endPct}`}
                      className="heatmap-scroll-threshold"
                      style={{ top: `${endPct}%` }}
                    >
                      <span>{Math.round(percentReached * 100)}% reached this line</span>
                    </div>
                  );
                })}
                {foldPercent != null && (
                  <div
                    className="heatmap-scroll-fold-marker"
                    style={{ top: `${foldPercent * 100}%` }}
                  >
                    <span>Average fold</span>
                  </div>
                )}
                {maxScroll > 0 && (
                  <div
                    title={`Maximum scroll depth: ${Math.round(maxScroll * 100)}%`}
                    className="heatmap-scroll-max-marker"
                    style={{ top: `${maxScroll * 100}%` }}
                  />
                )}
                {hoveredScrollBand && (
                  <div
                    className="heatmap-scroll-tooltip"
                    style={{
                      top: `${Math.min(92, Math.max(4, (Number(hoveredScrollBand.startPct || 0) + Number(hoveredScrollBand.endPct || 0)) / 2))}%`,
                    }}
                  >
                    <strong>{formatPercent(hoveredScrollBand.percentReached)} of sessions reached this point</strong>
                    <span>{formatNumber(hoveredScrollBand.sessionsReached || 0)} sessions reached {Math.round(Number(hoveredScrollBand.endPct || 0))}% depth</span>
                  </div>
                )}
                {scrollDropoffInsight && (
                  <div className="heatmap-scroll-insight">
                    {scrollDropoffInsight}
                  </div>
                )}
              </>
            )}
            {aggregateCells.map((cell) => {
              const rgb = LAYER_META[cell.layer]?.color || '255, 210, 95';
              const isHighlighted = cellMatchesTarget(cell, highlightedTarget)
                || (highlightedTarget && !hasExplicitHighlightedCells && cell.layer === 'click' && cell.intensity >= 0.75);
              const isSelected = activeCell?.key === cell.key;
              const size = cell.layer === 'cursor'
                ? 14 + Math.round(cell.intensity * 34)
                : cell.layer === 'engagement'
                  ? 16 + Math.round(cell.intensity * 36)
                  : 18 + Math.round(cell.intensity * 42);
              const opacity = isHighlighted || isSelected ? 0.86 : 0.20 + cell.intensity * 0.48;
              return (
                <button
                  key={cell.key}
                  type="button"
                  aria-label={`${LAYER_META[cell.layer]?.label || cell.layer}: ${cell.count} events`}
                  title={`${LAYER_META[cell.layer]?.label || cell.layer}: ${cell.count} events${cell.label ? ` | ${cell.label}` : ''}${cell.category ? ` | ${cell.category}` : ''}`}
                  onMouseEnter={() => setHoveredCell(cell)}
                  onMouseLeave={() => setHoveredCell(null)}
                  onClick={() => setSelectedCell((current) => (current?.key === cell.key ? null : cell))}
                  style={{
                    position: 'absolute',
                    left: `${cell.xPct * 100}%`,
                    top: `${cell.yPct * 100}%`,
                    width: size,
                    height: size,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: cell.layer === 'cursor' ? 6 : '50%',
                    background: `rgba(${rgb}, ${opacity})`,
                    boxShadow: `0 0 ${18 + cell.intensity * 34}px rgba(${rgb}, ${isHighlighted || isSelected ? 0.72 : 0.34 + cell.intensity * 0.28})`,
                    border: `${isHighlighted || isSelected ? 2 : 1}px solid rgba(${rgb}, ${isHighlighted || isSelected ? 0.95 : 0.38})`,
                    outline: isHighlighted || isSelected ? '2px solid rgba(255,255,255,0.72)' : 'none',
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    padding: 0,
                    font: 'inherit',
                    zIndex: isHighlighted || isSelected ? 5 : cell.layer === 'click' ? 4 : cell.layer === 'engagement' ? 3 : 2,
                    clipPath: cell.layer === 'engagement' ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : 'none',
                  }}
                />
              );
            })}
            {clickHotspots.map((target) => {
              const isHighlighted = cellMatchesTarget(target, highlightedTarget);
              const isSelected = activeTarget?.key === target.key;
              const size = 22 + Math.round(target.intensity * 16);
              return (
                <button
                  key={target.key}
                  type="button"
                  className={`heatmap-click-hotspot${isHighlighted || isSelected ? ' is-highlighted' : ''}`}
                  aria-label={`${target.rank}. ${target.label}: ${target.clicks + target.ctaClicks} clicks`}
                  title={`${target.label}: ${target.clicks + target.ctaClicks} clicks · ${target.sessions} sessions`}
                  onMouseEnter={() => setSelectedTarget(target)}
                  onMouseLeave={() => setSelectedTarget(null)}
                  onFocus={() => setSelectedTarget(target)}
                  onBlur={() => setSelectedTarget(null)}
                  onClick={() => setSelectedTarget((current) => (current?.key === target.key ? null : target))}
                  style={{
                    left: `${target.xPct * 100}%`,
                    top: `${target.yPct * 100}%`,
                    width: size,
                    height: size,
                  }}
                >
                  {target.rank}
                </button>
              );
            })}
            {clickHotspots.map((target) => {
              const bounds = target.bounds;
              if (!bounds) return null;
              const isHighlighted = cellMatchesTarget(target, highlightedTarget) || activeTarget?.key === target.key;
              if (!isHighlighted) return null;
              return (
                <div
                  key={`bounds-${target.key}`}
                  className="heatmap-click-target-bounds"
                  style={{
                    left: `${bounds.leftPct * 100}%`,
                    top: `${bounds.topPct * 100}%`,
                    width: `${Math.max(0.5, bounds.widthPct * 100)}%`,
                    height: `${Math.max(0.5, bounds.heightPct * 100)}%`,
                  }}
                />
              );
            })}
            {!loading && !hasData && (
              <div style={{ position: 'sticky', top: '34%', display: 'grid', placeItems: 'center', color: 'var(--primary-tan)', padding: '2rem', textAlign: 'center', pointerEvents: 'none' }}>
                {emptyMessage}
              </div>
            )}
            {activeCell && (
              <div className="heatmap-cell-detail" style={{ pointerEvents: 'auto' }}>
                <div>
                  <span>{LAYER_META[activeCell.layer]?.label || activeCell.layer}</span>
                  <button type="button" onClick={() => setSelectedCell(null)} aria-label="Close cell detail">x</button>
                </div>
                <strong>{formatNumber(activeCell.count)} events in this cell</strong>
                <small>{activeCell.label || 'No element label'}{activeCell.category ? ` · ${activeCell.category}` : ''}</small>
                <dl>
                  <dt>Position</dt>
                  <dd>{Math.round(activeCell.xPct * 100)}% x / {Math.round(activeCell.yPct * 100)}% y</dd>
                  <dt>Selector</dt>
                  <dd>{activeCell.selector || activeCell.trackId || 'Not available'}</dd>
                </dl>
              </div>
            )}
            {activeTarget && (
              <div className="heatmap-cell-detail heatmap-target-detail" style={{ pointerEvents: 'auto' }}>
                <div>
                  <span>{activeTarget.category || 'Clicked element'}</span>
                  <button type="button" onClick={() => setSelectedTarget(null)} aria-label="Close target detail">x</button>
                </div>
                <strong>{activeTarget.rank}. {activeTarget.label}</strong>
                <small>{formatNumber(activeTarget.clicks + activeTarget.ctaClicks)} clicks · {formatNumber(activeTarget.sessions)} sessions</small>
                <dl>
                  <dt>CTA clicks</dt>
                  <dd>{formatNumber(activeTarget.ctaClicks || 0)}</dd>
                  <dt>Rage / dead</dt>
                  <dd>{formatNumber(activeTarget.rageClicks || 0)} / {formatNumber(activeTarget.deadClicks || 0)}</dd>
                  <dt>Selector</dt>
                  <dd>{activeTarget.selector || activeTarget.trackId || 'Not available'}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 10,
            display: 'flex',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '0.35rem 0.5rem',
            borderRadius: 6,
            fontSize: '0.72rem',
            color: 'var(--white)',
            background: 'rgba(6,14,17,0.66)',
            opacity: 0.88,
            pointerEvents: 'none',
          }}
        >
          <span>{deviceType}</span>
          <span>{formatNumber(aggregateCells.length)} cells | {Math.round(maxScroll * 100)}% max scroll</span>
        </div>
      </div>
    </div>
  );
}
