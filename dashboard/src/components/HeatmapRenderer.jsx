import React, { useEffect, useMemo, useState } from 'react';

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

const getViewportLabel = (deviceType) => {
  if (deviceType === 'mobile') return 'Mobile viewport';
  if (deviceType === 'tablet') return 'Tablet viewport';
  return 'Desktop viewport';
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
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const hasData = aggregateCells.length > 0 || (layers.scroll && maxScroll > 0);
  const screenshotWidth = Number(screenshot?.width || 0);
  const screenshotHeight = Number(screenshot?.height || 0);
  const pageAspectRatio = screenshotWidth > 0 && screenshotHeight > 0
    ? `${screenshotWidth} / ${screenshotHeight}`
    : '16 / 36';
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

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [screenshotUrl]);

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
          aspectRatio: '16 / 9',
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
            overflowX: 'hidden',
            scrollbarColor: 'rgba(255,255,255,0.32) transparent',
            background: 'rgba(14,30,35,0.82)',
          }}
        >
          <div
            style={{
              position: 'relative',
              width: '100%',
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
            {layers.scroll && maxScroll > 0 && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 0,
                    height: `${Math.max(2, maxScroll * 100)}%`,
                    background: 'linear-gradient(180deg, rgba(71,190,125,0.28), rgba(238,196,94,0.22))',
                    mixBlendMode: showScreenshot ? 'multiply' : 'screen',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  title={`Maximum scroll depth: ${Math.round(maxScroll * 100)}%`}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${maxScroll * 100}%`,
                    height: 2,
                    background: 'rgba(255,214,99,0.9)',
                    boxShadow: '0 0 16px rgba(255,214,99,0.55)',
                    pointerEvents: 'none',
                  }}
                />
              </>
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
                    background: `rgba(${rgb}, ${0.20 + cell.intensity * 0.48})`,
                    boxShadow: `0 0 ${18 + cell.intensity * 34}px rgba(${rgb}, ${0.34 + cell.intensity * 0.28})`,
                    border: `1px solid rgba(${rgb}, 0.38)`,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
            {!loading && !hasData && (
              <div style={{ position: 'sticky', top: '34%', display: 'grid', placeItems: 'center', color: 'var(--primary-tan)', padding: '2rem', textAlign: 'center', pointerEvents: 'none' }}>
                No heatmap events for the selected page, device, and date range yet.
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
