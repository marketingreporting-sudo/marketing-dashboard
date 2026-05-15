import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_PROPERTY_ID, PROPERTY_CATALOG_BY_ID } from '../propertyCatalog';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../lib/supabase';
import { AccessContext } from './AccessContext';

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const PROPERTY_SELECT_BASE = 'id, name, city, state, portfolio, org_slug, google_ads_id, google_analytics_id, meta_ads_account_id, meta_ads_match_terms, opiniion_location_id, opiniion_location_name';
const PROPERTY_SELECT_PROFILE = `${PROPERTY_SELECT_BASE}, local_falcon_location_id, marketing_account_manager, regional_manager, vice_president_operations, client, website_type, website_url, property_type, legal_entity, entrata_api_access, is_active`;

const isMissingPropertyProfileColumnError = (error) => (
  error?.code === '42703'
  || String(error?.message || '').includes('does not exist')
);

const normalizePropertyRecord = (row) => {
  const fallback = PROPERTY_CATALOG_BY_ID[row?.id] || {};

  return {
    propertyId: row?.id || fallback.propertyId || '',
    name: row?.name || fallback.name || `Property ${row?.id || ''}`.trim(),
    city: row?.city || fallback.city || '',
    state: row?.state || fallback.state || '',
    portfolio: row?.portfolio || fallback.portfolio || '',
    orgSlug: row?.org_slug || fallback.orgSlug || '',
    googleAdsId: row?.google_ads_id || fallback.googleAdsId || '',
    googleAnalyticsId: row?.google_analytics_id || fallback.googleAnalyticsId || '',
    metaAdsAccountId: row?.meta_ads_account_id || fallback.metaAdsAccountId || '',
    localFalconLocationId: row?.local_falcon_location_id || fallback.localFalconLocationId || '',
    metaAdsMatchTerms: normalizeArray(row?.meta_ads_match_terms).length
      ? normalizeArray(row?.meta_ads_match_terms)
      : normalizeArray(fallback.metaAdsMatchTerms),
    opiniionLocationId: row?.opiniion_location_id || fallback.opiniionLocationId || '',
    opiniionLocationName: row?.opiniion_location_name || fallback.opiniionLocationName || '',
    marketingAccountManager: row?.marketing_account_manager || fallback.marketingAccountManager || '',
    regionalManager: row?.regional_manager || fallback.regionalManager || '',
    vicePresidentOperations: row?.vice_president_operations || fallback.vicePresidentOperations || '',
    client: row?.client || fallback.client || '',
    websiteType: row?.website_type || fallback.websiteType || '',
    websiteUrl: row?.website_url || fallback.websiteUrl || '',
    propertyType: row?.property_type || fallback.propertyType || '',
    legalEntity: row?.legal_entity || fallback.legalEntity || '',
    entrataApiAccess: Boolean(row?.entrata_api_access || fallback.entrataApiAccess),
  };
};

const buildPropertyAccessMap = ({ properties, memberships, profileRole, rolePermissions }) => {
  const propertyById = new Map(properties.map((property) => [property.propertyId, property]));
  const permissionsByRole = rolePermissions.reduce((accumulator, row) => {
    const current = accumulator.get(row.role) || new Set();
    current.add(row.permission);
    accumulator.set(row.role, current);
    return accumulator;
  }, new Map());

  const globalPermissions = profileRole ? permissionsByRole.get(profileRole) || new Set() : new Set();

  return properties.reduce((accumulator, property) => {
    const membership = memberships.find((item) => item.property_id === property.propertyId) || null;
    const membershipPermissions = membership?.role
      ? permissionsByRole.get(membership.role) || new Set()
      : new Set();
    const permissionSet = new Set([...globalPermissions, ...membershipPermissions]);

    accumulator[property.propertyId] = {
      property: propertyById.get(property.propertyId) || property,
      role: membership?.role || profileRole || null,
      permissions: Array.from(permissionSet).sort(),
    };
    return accumulator;
  }, {});
};

const fetchPropertyRows = async ({ hasGlobalPropertyAccess, propertyIds }) => {
  if (!hasGlobalPropertyAccess && propertyIds.length === 0) {
    return { data: [], error: null };
  }

  const buildQuery = (selectColumns, includeActiveFilter) => {
    let query = supabase
      .from('properties')
      .select(selectColumns);

    if (!hasGlobalPropertyAccess) {
      query = query.in('id', propertyIds);
    }
    if (includeActiveFilter) {
      query = query.eq('is_active', true);
    }
    return query.order('name', { ascending: true });
  };

  const profileResponse = await buildQuery(PROPERTY_SELECT_PROFILE, true);
  if (!profileResponse.error || !isMissingPropertyProfileColumnError(profileResponse.error)) {
    return profileResponse;
  }

  return buildQuery(PROPERTY_SELECT_BASE, false);
};

export const AccessProvider = ({ children }) => {
  const { user, isAuthenticated, isConfigured } = useAuth();
  const [loading, setLoading] = useState(Boolean(isAuthenticated && isConfigured));
  const [profile, setProfile] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [properties, setProperties] = useState([]);
  const [propertyAccessById, setPropertyAccessById] = useState({});
  const [error, setError] = useState('');
  const loadAccess = useCallback(async (cancelledRef) => {
      if (!isAuthenticated || !user || !supabase || !isConfigured) {
        return;
      }

      setLoading(true);
      setError('');

      const profileResponse = await supabase
        .from('profiles')
        .select('id, email, full_name, avatar_path, avatar_url, global_role, is_active')
        .eq('id', user.id)
        .maybeSingle();

      if (profileResponse.error) {
        if (!cancelledRef.current) {
          setError(profileResponse.error.message || 'Unable to load the user profile.');
          setLoading(false);
        }
        return;
      }

      const profileRecord = profileResponse.data || null;

      const membershipsResponse = await supabase
        .from('property_memberships')
        .select('property_id, role, is_active')
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (membershipsResponse.error) {
        if (!cancelledRef.current) {
          setError(membershipsResponse.error.message || 'Unable to load property memberships.');
          setLoading(false);
        }
        return;
      }

      const membershipRows = membershipsResponse.data || [];
      const propertyIds = Array.from(new Set(membershipRows.map((row) => row.property_id).filter(Boolean)));

      let propertyRows = [];
      const roles = Array.from(
        new Set([
          ...(profileRecord?.global_role ? [profileRecord.global_role] : []),
          ...membershipRows.map((row) => row.role).filter(Boolean),
        ])
      );

      let rolePermissions = [];
      if (roles.length > 0) {
        const permissionsResponse = await supabase
          .from('role_permissions')
          .select('role, permission')
          .in('role', roles);

        if (permissionsResponse.error) {
          if (!cancelledRef.current) {
            setError(permissionsResponse.error.message || 'Unable to load role permissions.');
            setLoading(false);
          }
          return;
        }

        rolePermissions = permissionsResponse.data || [];
      }

      const globalPermissionSet = new Set(
        rolePermissions
          .filter((row) => row.role === profileRecord?.global_role)
          .map((row) => row.permission)
      );
      const hasGlobalPropertyAccess = globalPermissionSet.has('properties.view_all');

      const propertiesResponse = await fetchPropertyRows({ hasGlobalPropertyAccess, propertyIds });
      if (propertiesResponse.error) {
        if (!cancelledRef.current) {
          setError(propertiesResponse.error.message || 'Unable to load property catalog.');
          setLoading(false);
        }
        return;
      }
      propertyRows = propertiesResponse.data || [];

      const mergedProperties = Array.from(
        new Map(
          propertyRows
            .map((row) => normalizePropertyRecord(row))
            .map((property) => [property.propertyId, property])
        ).values()
      ).sort((left, right) => left.name.localeCompare(right.name));

      if (cancelledRef.current) return;

      setProfile(profileRecord);
      setMemberships(membershipRows);
      setProperties(mergedProperties);
      setPropertyAccessById(
        buildPropertyAccessMap({
          properties: mergedProperties,
          memberships: membershipRows,
          profileRole: profileRecord?.global_role || null,
          rolePermissions,
        })
      );
      setLoading(false);
    }, [isAuthenticated, isConfigured, user]);

  useEffect(() => {
    if (!isAuthenticated || !user || !supabase || !isConfigured) {
      return;
    }

    const cancelledRef = { current: false };
    queueMicrotask(() => {
      void loadAccess(cancelledRef);
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [isAuthenticated, isConfigured, user, loadAccess]);

  const defaultPropertyId = useMemo(() => {
    if (properties.some((property) => property.propertyId === DEFAULT_PROPERTY_ID)) {
      return DEFAULT_PROPERTY_ID;
    }
    return properties[0]?.propertyId || null;
  }, [properties]);

  const value = useMemo(
    () => ({
      loading: isAuthenticated ? loading : false,
      error: isAuthenticated ? error : '',
      profile: isAuthenticated ? profile : null,
      memberships: isAuthenticated ? memberships : [],
      properties: isAuthenticated ? properties : [],
      propertyAccessById: isAuthenticated ? propertyAccessById : {},
      defaultPropertyId,
      hasAnyPropertyAccess: isAuthenticated ? properties.length > 0 : false,
      refreshAccess: () => loadAccess({ current: false }),
    }),
    [defaultPropertyId, error, isAuthenticated, loading, memberships, profile, properties, propertyAccessById, loadAccess]
  );

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
};
