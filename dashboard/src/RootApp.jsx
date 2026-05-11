import React from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import DashboardApp, { PrivacyPolicyPage, TermsOfServicePage } from './App';
import { AuthProvider } from './auth/AuthProvider';
import ProtectedRoute from './auth/ProtectedRoute';
import { useAuth } from './auth/useAuth';
import { AccessProvider } from './access/AccessProvider';
import { useAccess } from './access/useAccess';
import SignInPage from './pages/SignInPage';
import SetPasswordPage from './pages/SetPasswordPage';
import { supabase } from './lib/supabase';
import { CLIENT_REPORT_BASE_DOMAIN } from './apiConfig';

const AccessLoadingScreen = () => (
  <div className="auth-screen auth-screen--loading">
    <div className="auth-card auth-card--compact">
      <div className="auth-card__eyebrow">Loading access</div>
      <h1 className="auth-card__title">Checking property memberships and permissions.</h1>
      <p className="auth-card__copy">
        We&apos;re verifying which properties and tabs this account can access.
      </p>
    </div>
  </div>
);

const AccessStateScreen = ({ title, body }) => (
  <div className="auth-screen">
    <div className="auth-card">
      <div className="auth-card__eyebrow">Access required</div>
      <h1 className="auth-card__title">{title}</h1>
      <p className="auth-card__copy">{body}</p>
    </div>
  </div>
);

const getReportSlugFromHostname = () => {
  if (typeof window === 'undefined') return '';

  const hostname = window.location.hostname.toLowerCase().replace(/^www\./, '');
  if (!CLIENT_REPORT_BASE_DOMAIN || hostname === CLIENT_REPORT_BASE_DOMAIN) return '';
  if (!hostname.endsWith(`.${CLIENT_REPORT_BASE_DOMAIN}`)) return '';

  const slug = hostname.slice(0, -(CLIENT_REPORT_BASE_DOMAIN.length + 1));
  return slug && slug !== 'www' ? slug : '';
};

const AuthenticatedDashboard = ({ reportMode = false }) => {
  const { reportSlug = '' } = useParams();
  const { user } = useAuth();
  const { loading, error, hasAnyPropertyAccess, properties, propertyAccessById, defaultPropertyId } = useAccess();
  const resolvedReportSlug = reportSlug || getReportSlugFromHostname();

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  if (loading) {
    return <AccessLoadingScreen />;
  }

  if (error) {
    return (
      <AccessStateScreen
        title="We couldn't load your access profile."
        body={error}
      />
    );
  }

  if (!hasAnyPropertyAccess) {
    return (
      <AccessStateScreen
        title="No properties are assigned to this account yet."
        body="Ask an administrator to add at least one property membership before using the dashboard."
      />
    );
  }

  return (
    <DashboardApp
      currentUser={user}
      onSignOut={handleSignOut}
      availableProperties={properties}
      propertyAccessById={propertyAccessById}
      defaultPropertyId={defaultPropertyId}
      clientReportSlug={reportMode || resolvedReportSlug ? resolvedReportSlug : ''}
    />
  );
};

const LegalPageFrame = ({ children }) => (
  <>
    {children}
    <div className="legal-page-nav">
      <Link to="/sign-in">Back to sign in</Link>
    </div>
  </>
);

const RootApp = () => (
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route
          path="/privacy-policy"
          element={
            <LegalPageFrame>
              <PrivacyPolicyPage />
            </LegalPageFrame>
          }
        />
        <Route
          path="/terms-of-service"
          element={
            <LegalPageFrame>
              <TermsOfServicePage />
            </LegalPageFrame>
          }
        />
        <Route element={<ProtectedRoute />}>
          <Route
            path="/reports/:reportSlug"
            element={(
              <AccessProvider>
                <AuthenticatedDashboard reportMode />
              </AccessProvider>
            )}
          />
          <Route
            path="/"
            element={(
              <AccessProvider>
                <AuthenticatedDashboard />
              </AccessProvider>
            )}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);

export default RootApp;
