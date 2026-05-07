import React, { useMemo } from 'react';

const LAYER_META = {
  click: { label: 'Clicks', color: '255, 91, 91' },
  cursor: { label: 'Cursor', color: '92, 185, 255' },
  scroll: { label: 'Scroll', color: '238, 196, 94' },
  engagement: { label: 'Engagement', color: '255, 210, 95' },
};

const EVENT_TO_LAYER = {
  click: 'click',
  cta_click: 'click',
  mousemove: 'cursor',
  scroll: 'scroll',
  engagement: 'engagement',
};

const clampPercent = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const getAspectRatio = (deviceType) => {
  if (deviceType === 'mobile') return '9 / 16';
  if (deviceType === 'tablet') return '3 / 4';
  return '16 / 10';
};

const aggregatePoints = (points, activeLayers, gridSize = 24) => {
  const cells = new Map();
  points.forEach((point) => {
    const layer = EVENT_TO_LAYER[point.type] || point.type;
    if (!activeLayers[layer] || layer === 'scroll') return;
    if (point.xPct == null || point.yPct == null) return;
    const xPct = clampPercent(point.xPct);
    const yPct = clampPercent(point.yPct);
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
      label: point.targetLabel || point.targetId || point.targetTag || LAYER_META[layer]?.label || layer,
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

export default function HeatmapRenderer({
  points = [],
  totals = {},
  deviceType = 'desktop',
  screenshotUrl = '',
  screenshot = null,
  loading = false,
  error = '',
  activeLayers,
  onLayerChange,
  formatNumber = (value) => String(value ?? 0),
}) {
  const layers = {
    click: activeLayers?.click !== false,
    cursor: activeLayers?.cursor === true,
    scroll: activeLayers?.scroll === true,
    engagement: activeLayers?.engagement === true,
  };
  const aggregateCells = useMemo(() => aggregatePoints(points, layers), [points, layers]);
  const maxScroll = clampPercent(totals.maxScrollDepthPct);
  const hasScreenshot = Boolean(screenshotUrl);
  const hasData = aggregateCells.length > 0 || (layers.scroll && maxScroll > 0);
  const screenshotWidth = Number(screenshot?.width || 0);
  const screenshotHeight = Number(screenshot?.height || 0);
  const aspectRatio = screenshotWidth > 0 && screenshotHeight > 0
    ? `${screenshotWidth} / ${screenshotHeight}`
    : getAspectRatio(deviceType);
  const backgroundStyle = hasScreenshot
    ? 'linear-gradient(180deg, rgba(11,14,18,0.18), rgba(11,14,18,0.30))'
    : 'linear-gradient(180deg, rgba(230,213,184,0.10), rgba(255,255,255,0.03))';

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
        {Object.entries(LAYER_META).map(([layer, meta]) => (
          <label key={layer} className="website-manager-pill" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(layers[layer])}
              onChange={(event) => onLayerChange?.(layer, event.target.checked)}
              style={{ marginRight: 6 }}
            />
            {meta.label}
          </label>
        ))}
      </div>
      <div
        style={{
          position: 'relative',
          minHeight: deviceType === 'mobile' ? 420 : 340,
          maxHeight: 760,
          aspectRatio,
          border: '1px solid var(--panel-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: backgroundStyle,
        }}
      >
        {hasScreenshot && (
          <img
            src={screenshotUrl}
            alt=""
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'fill',
              opacity: 0.82,
              pointerEvents: 'none',
            }}
          />
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateRows: '64px 1fr 80px', opacity: 0.68, pointerEvents: 'none' }}>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '1rem', color: 'var(--primary-tan)', fontSize: '0.8rem' }}>
            {loading ? 'Loading screenshot background...' : hasScreenshot ? 'Latest screenshot background' : screenshot ? `Screenshot preview unavailable${error ? `: ${error}` : ''}` : 'Blank page frame'}
          </div>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }} />
          <div />
        </div>
        {layers.scroll && maxScroll > 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(180deg, rgba(71,190,125,0.32) 0%, rgba(238,196,94,0.30) ${Math.round(maxScroll * 100)}%, rgba(211,84,84,0.18) 100%)`,
              mixBlendMode: 'screen',
            }}
          />
        )}
        {aggregateCells.map((cell) => {
          const rgb = LAYER_META[cell.layer]?.color || '255, 210, 95';
          const size = 18 + Math.round(cell.intensity * 42);
          return (
            <span
              key={cell.key}
              title={`${LAYER_META[cell.layer]?.label || cell.layer}: ${cell.count} events${cell.label ? ` | ${cell.label}` : ''}`}
              style={{
                position: 'absolute',
                left: `${cell.xPct * 100}%`,
                top: `${cell.yPct * 100}%`,
                width: size,
                height: size,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: `rgba(${rgb}, ${0.18 + cell.intensity * 0.46})`,
                boxShadow: `0 0 ${18 + cell.intensity * 32}px rgba(${rgb}, ${0.30 + cell.intensity * 0.28})`,
                border: `1px solid rgba(${rgb}, 0.34)`,
              }}
            />
          );
        })}
        {!loading && !hasData && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--primary-tan)', padding: '2rem', textAlign: 'center' }}>
            No heatmap events for the selected page, device, and date range yet.
          </div>
        )}
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.75rem', color: 'var(--white)', opacity: 0.78 }}>
          <span>{deviceType}</span>
          <span>{formatNumber(aggregateCells.length)} cells | {Math.round(maxScroll * 100)}% max scroll</span>
        </div>
      </div>
    </div>
  );
}
