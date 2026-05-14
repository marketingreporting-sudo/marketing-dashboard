import React from 'react';
import {
  ChevronDown,
  ExternalLink,
  FileCheck,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';

export default function PropertyInfoView(props) {
  const {
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
  } = props;

  const specialItems = React.useMemo(() => (
    extractSpecialItems(specialsSnapshot)
  ), [extractSpecialItems, specialsSnapshot]);

  const floorplanItems = React.useMemo(() => (
    Array.isArray(availabilityPricingSnapshot?.floorplans) ? availabilityPricingSnapshot.floorplans : []
  ), [availabilityPricingSnapshot]);

  const propertyUnitItems = React.useMemo(() => (
    Array.isArray(availabilityPricingSnapshot?.units) ? availabilityPricingSnapshot.units : []
  ), [availabilityPricingSnapshot]);

  const floorplanTableRows = React.useMemo(() => (
    [...floorplanItems]
      .sort((a, b) => {
        const availableA = Number.parseInt(a?.DisplayedUnitsAvailable || a?.UnitsAvailable || '0', 10) > 0 ? 0 : 1;
        const availableB = Number.parseInt(b?.DisplayedUnitsAvailable || b?.UnitsAvailable || '0', 10) > 0 ? 0 : 1;
        if (availableA !== availableB) return availableA - availableB;
        const priceA = getFloorplanPriceRange(a).min ?? Number.MAX_SAFE_INTEGER;
        const priceB = getFloorplanPriceRange(b).min ?? Number.MAX_SAFE_INTEGER;
        return priceA - priceB;
      })
      .slice(0, 14)
  ), [floorplanItems, getFloorplanPriceRange]);

  const unitTableRows = React.useMemo(() => {
    if (propertyUnitItems.length === 0) return [];
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
  }, [getAvailabilityStatus, getPropertyUnitPriceRange, getPropertyUnitSpaces, propertyUnitItems]);

  return (
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
          <div className="property-info-card__label">Active Marketing Items</div>
          <div className="property-info-card__value">{renderMetricValue(marketingBudgetLoading, formatNumber(activeMarketingBudgetItems.length))}</div>
          <div className="property-info-card__meta">Marketing items with Active status</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Available Units</div>
          <div className="property-info-card__value">{renderMetricValue(propertyInfoLoading, formatNumber(availabilitySummary.availableCount))}</div>
          <div className="property-info-card__meta">
            {formatNumber(availabilitySummary.unitCount)} units across {formatNumber(availabilitySummary.floorplanCount)} floorplans
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Price Range</div>
          <div className="property-info-card__value">
            {renderMetricValue(propertyInfoLoading, availabilitySummary.minPrice != null ? `${formatCurrency(availabilitySummary.minPrice)} - ${formatCurrency(availabilitySummary.maxPrice)}` : 'No pricing')}
          </div>
          <div className="property-info-card__meta">
            Next available {availabilitySummary.nextAvailableDate ? formatReadableDate(availabilitySummary.nextAvailableDate) : '-'}
          </div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Funnel Snapshot</div>
          <div className="property-info-card__value">{renderMetricValue(loading, `${formatNumber(totalLeads)} / ${formatNumber(totalApplications)} / ${formatNumber(totalLeases)}`)}</div>
          <div className="property-info-card__meta">Leads / apps / leases in selected range</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Scheduled Spend</div>
          <div className="property-info-card__value">{renderMetricValue(marketingBudgetLoading, formatCurrency(activeApprovedMarketingBudget))}</div>
          <div className="property-info-card__meta">{formatNumber(activeMarketingBudgetItems.length)} active status item{activeMarketingBudgetItems.length === 1 ? '' : 's'}</div>
        </div>
        <div className="property-info-card">
          <div className="property-info-card__label">Last 30 GL Spend</div>
          <div className="property-info-card__value">{renderMetricValue(actualMarketingSpendLoading, formatCurrency(actualMarketingSpendLast30))}</div>
          <div className="property-info-card__meta">From posted marketing invoices</div>
        </div>
      </div>

      <div className="property-info-panels">
        <div className="property-info-panel property-info-panel--marketing-budget">
          <div className="property-info-panel__header">
            <div>
              <div className="property-info-panel__eyebrow">Approved Marketing Budget</div>
              <div className="property-info-panel__title">Property budget items</div>
              <div className="property-info-panel__subhead">
                Track approved monthly spend, listing links, contracts, notes, active status, and the last modified date for this property.
              </div>
            </div>
            <button type="button" className="property-budget-refresh" onClick={loadMarketingBudgetItems} disabled={marketingBudgetLoading || marketingBudgetSaving}>
              Refresh
            </button>
          </div>

          {marketingBudgetError && <div className="property-budget-alert property-budget-alert--error">{marketingBudgetError}</div>}
          {marketingBudgetNotice && <div className="property-budget-alert">{marketingBudgetNotice}</div>}
          {actualMarketingSpendError && <div className="property-budget-alert property-budget-alert--error">{actualMarketingSpendError}</div>}

          <div className="property-budget-summary-grid">
            <div className="property-budget-summary-card">
              <span>Budgeted spend now</span>
              <strong>{renderMetricValue(marketingBudgetLoading, formatCurrency(activeApprovedMarketingBudget))}</strong>
              <small>
                {formatNumber(activeMarketingBudgetItems.length)} active item{activeMarketingBudgetItems.length === 1 ? '' : 's'}
                {futureMarketingBudgetItems.length > 0 ? ` | ${formatNumber(futureMarketingBudgetItems.length)} future/new` : ''}
              </small>
            </div>
            <div className="property-budget-summary-card">
              <span>Actual GL spend, last 30 days</span>
              <strong>{renderMetricValue(actualMarketingSpendLoading, formatCurrency(actualMarketingSpendLast30))}</strong>
              <small>{formatCurrency(actualPerformanceMarketingSpendLast30)} performance marketing | {formatNumber(actualMarketingSpendBreakdown.length)} GL line{actualMarketingSpendBreakdown.length === 1 ? '' : 's'}</small>
            </div>
            <div className="property-budget-summary-card">
              <span>Budget less actual</span>
              <strong>{renderMetricValue(actualMarketingSpendLoading || marketingBudgetLoading, formatCurrency(marketingBudgetVarianceLast30))}</strong>
              <small>Budget uses Active status rows; actuals use posted invoice allocation.</small>
            </div>
          </div>

          <div className="property-budget-create">
            <label className="property-budget-field property-budget-field--item">
              <span>Item name</span>
              <input
                type="text"
                value={marketingBudgetDraft.itemName}
                onChange={(event) => updateMarketingBudgetDraft('itemName', event.target.value)}
                placeholder="Apartments.com listing"
              />
            </label>
            <label className="property-budget-field">
              <span>Status</span>
              <select
                value={marketingBudgetDraft.status}
                onChange={(event) => updateMarketingBudgetDraft('status', event.target.value)}
              >
                {MARKETING_BUDGET_STATUSES.map((status) => (
                  <option key={status.id} value={status.id}>{status.label}</option>
                ))}
              </select>
            </label>
            <label className="property-budget-field">
              <span>Start date</span>
              <input
                type="date"
                value={marketingBudgetDraft.startDate}
                onChange={(event) => updateMarketingBudgetDraft('startDate', event.target.value)}
              />
            </label>
            <label className="property-budget-field">
              <span>End date</span>
              <input
                type="date"
                value={marketingBudgetDraft.endDate}
                onChange={(event) => updateMarketingBudgetDraft('endDate', event.target.value)}
              />
            </label>
            <label className="property-budget-field">
              <span>Monthly amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={marketingBudgetDraft.monthlyAmount}
                onChange={(event) => updateMarketingBudgetDraft('monthlyAmount', event.target.value)}
                placeholder="1000"
              />
            </label>
            <label className="property-budget-field property-budget-field--url">
              <span>Listing link</span>
              <input
                type="url"
                value={marketingBudgetDraft.listingUrl}
                onChange={(event) => updateMarketingBudgetDraft('listingUrl', event.target.value)}
                placeholder="https://www.apartments.com/..."
              />
            </label>
            <label className="property-budget-field property-budget-field--notes">
              <span>Notes</span>
              <textarea
                value={marketingBudgetDraft.notes}
                onChange={(event) => updateMarketingBudgetDraft('notes', event.target.value)}
                rows={2}
                placeholder="Package level, terms, renewal notes"
              />
            </label>
            <label className="property-budget-upload">
              <input
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] || null;
                  event.target.value = '';
                  updateMarketingBudgetDraft('contractFile', file);
                }}
              />
              <Upload size={15} />
              {marketingBudgetDraft.contractFile?.name || 'Attach contract'}
            </label>
            <button
              type="button"
              className="property-budget-save"
              onClick={() => saveMarketingBudgetItem(marketingBudgetDraft, marketingBudgetDraft.contractFile)}
              disabled={marketingBudgetSaving || marketingBudgetLoading}
            >
              <Plus size={15} />
              Add row
            </button>
          </div>

          <div className="property-budget-items">
            <button
              type="button"
              className={`property-budget-items-toggle ${propertyBudgetItemsExpanded ? 'is-expanded' : ''}`}
              onClick={() => setPropertyBudgetItemsExpanded((current) => !current)}
              aria-expanded={propertyBudgetItemsExpanded}
            >
              <span>
                <strong>Budget item table</strong>
                <small>{formatNumber(marketingBudgetItems.length)} total row{marketingBudgetItems.length === 1 ? '' : 's'} | {formatNumber(activeMarketingBudgetItems.length)} active</small>
              </span>
              <ChevronDown size={18} />
            </button>

            {propertyBudgetItemsExpanded && (
              marketingBudgetLoading ? (
                <div className="property-info-empty">Loading approved budget items...</div>
              ) : marketingBudgetItems.length === 0 ? (
                <div className="property-info-empty">No approved marketing budget items are stored for this property yet.</div>
              ) : (
                <div className="property-budget-table-wrap">
                  <table className="property-budget-table">
                    <thead>
                      <tr>
                        <th aria-sort={getPropertyBudgetAriaSort('status')}>{renderPropertyBudgetSortHeader('status', 'Status')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('itemName')}>{renderPropertyBudgetSortHeader('itemName', 'Item')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('startDate')}>{renderPropertyBudgetSortHeader('startDate', 'Start')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('endDate')}>{renderPropertyBudgetSortHeader('endDate', 'End')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('monthlyAmount')}>{renderPropertyBudgetSortHeader('monthlyAmount', 'Monthly')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('contractFileName')}>{renderPropertyBudgetSortHeader('contractFileName', 'Contract')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('listingUrl')}>{renderPropertyBudgetSortHeader('listingUrl', 'Listing')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('notes')}>{renderPropertyBudgetSortHeader('notes', 'Notes')}</th>
                        <th aria-sort={getPropertyBudgetAriaSort('updatedAt')}>{renderPropertyBudgetSortHeader('updatedAt', 'Modified On')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMarketingBudgetItems.map((item) => {
                        const listingUrl = normalizeExternalUrl(item.listingUrl);
                        return (
                          <tr key={item.id} className={`property-budget-row property-budget-row--${item.status}`}>
                            <td>
                              <select
                                value={item.status}
                                onChange={(event) => updateMarketingBudgetField(item.id, 'status', event.target.value)}
                              >
                                {MARKETING_BUDGET_STATUSES.map((status) => (
                                  <option key={status.id} value={status.id}>{status.label}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={item.itemName}
                                disabled={Boolean(item.id)}
                                title="Locked after creation"
                                onChange={(event) => updateMarketingBudgetField(item.id, 'itemName', event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                value={item.startDate}
                                disabled={Boolean(item.id)}
                                title="Locked after creation"
                                onChange={(event) => updateMarketingBudgetField(item.id, 'startDate', event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                value={item.endDate}
                                disabled={Boolean(item.id)}
                                title="Locked after creation"
                                onChange={(event) => updateMarketingBudgetField(item.id, 'endDate', event.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.monthlyAmount}
                                disabled={Boolean(item.id)}
                                title="Locked after creation"
                                onChange={(event) => updateMarketingBudgetField(item.id, 'monthlyAmount', event.target.value)}
                              />
                            </td>
                            <td>
                              <div className="property-budget-file-actions">
                                {item.contractStoragePath ? (
                                  <>
                                    <button type="button" onClick={() => openMarketingBudgetContract(item)}>
                                      <FileCheck size={14} />
                                      Open
                                    </button>
                                    <button
                                      type="button"
                                      className="property-budget-remove-file"
                                      onClick={() => removeMarketingBudgetContract(item)}
                                      disabled={marketingBudgetSaving}
                                    >
                                      <Trash2 size={14} />
                                      Remove
                                    </button>
                                  </>
                                ) : (
                                  <span>No file</span>
                                )}
                                <label>
                                  <input
                                    type="file"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0] || null;
                                      event.target.value = '';
                                      if (file) await saveMarketingBudgetItem(item, file);
                                    }}
                                  />
                                  <Upload size={14} />
                                  Upload
                                </label>
                              </div>
                              {item.contractFileName && <small>{item.contractFileName}</small>}
                            </td>
                            <td>
                              <input
                                type="url"
                                value={item.listingUrl}
                                onChange={(event) => updateMarketingBudgetField(item.id, 'listingUrl', event.target.value)}
                                placeholder="https://"
                              />
                              {listingUrl && (
                                <a className="property-budget-link" href={listingUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink size={13} />
                                  View
                                </a>
                              )}
                            </td>
                            <td>
                              <textarea
                                value={item.notes}
                                onChange={(event) => updateMarketingBudgetField(item.id, 'notes', event.target.value)}
                                rows={3}
                              />
                            </td>
                            <td>
                              <div className="property-budget-modified">{formatReadableDate(item.updatedAt)}</div>
                              <div className="property-budget-row-actions">
                                <button type="button" onClick={() => saveMarketingBudgetItem(item)} disabled={marketingBudgetSaving}>
                                  <Save size={14} />
                                  Save
                                </button>
                                <button type="button" onClick={() => deleteMarketingBudgetItem(item.id)} disabled={marketingBudgetSaving || !item.id}>
                                  <Trash2 size={14} />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>

        <div className="property-info-panel property-info-panel--specials">
          <div className="property-info-panel__eyebrow">Specials</div>
          <div className="property-info-panel__title">Current leasing offers</div>
          <div className="property-info-panel__subhead">
            Stored from the daily getSpecials sync and only rewritten when the payload changes.
          </div>
          {propertyInfoLoading ? (
            <div className="property-info-empty">Loading specials...</div>
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
            Stored from the dedicated getUnitsAvailabilityAndPricing availability/pricing snapshot.
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
                      {floorplan?.Name || '-'}
                      {deposit.min != null ? ` | Deposit ${formatCurrency(deposit.min)}` : ''}
                    </div>
                    <div className="property-info-table__cell">
                      {getRoomCount(floorplan?.Room, 'Bedroom') || '-'} / {getRoomCount(floorplan?.Room, 'Bathroom') || '-'}
                    </div>
                    <div className="property-info-table__cell">{floorplan?.UnitCount || '-'}</div>
                    <div className="property-info-table__cell">{floorplan?.DisplayedUnitsAvailable || floorplan?.UnitsAvailable || '0'}</div>
                    <div className="property-info-table__cell">
                      {price.min != null ? `${formatCurrency(price.min)} - ${formatCurrency(price.max ?? price.min)}` : '-'}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {propertyInfoLoading ? (
            <div className="property-info-empty">Loading availability...</div>
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
                    {unit._unitAttrs?.UnitNumber || unit?.['@attributes']?.MarketingUnitNumber || unit.unitNumber || unit.name || unit.unitId || '-'}
                  </div>
                  <div className="property-info-table__cell">
                    {unit._unitAttrs?.FloorPlanName || unit.floorplanName || unit.floorPlanName || unit.floorplan || '-'}
                  </div>
                  <div className="property-info-table__cell">
                    {unit._unitAttrs?.OccupancyType || unit.bedCount || unit.beds || '-'} / {unit.bathCount || unit.baths || '-'}
                  </div>
                  <div className="property-info-table__cell">
                    {(() => {
                      const range = getPropertyUnitPriceRange(unit);
                      return range.min != null ? `${formatCurrency(range.min)} - ${formatCurrency(range.max ?? range.min)}` : '-';
                    })()}
                  </div>
                  <div className="property-info-table__cell">
                    {getAvailabilityStatus(unit)}
                    {getAvailabilityDate(unit) ? ` | ${formatReadableDate(getAvailabilityDate(unit))}` : ''}
                  </div>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
