import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

const AuthLoadingScreen = () => (
  <div className="auth-screen auth-screen--loading">
    <div className="auth-card auth-card--compact">
      <div className="auth-card__eyebrow">Loading session</div>
      <h1 className="auth-card__title">Checking your dashboard access.</h1>
      <p className="auth-card__copy">
        We&apos;re restoring your secure session and routing you into the right workspace.
      </p>
    </div>
  </div>
);

const ProtectedRoute = () => {
  const { loading, isAuthenticated, isConfigured } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isConfigured) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
