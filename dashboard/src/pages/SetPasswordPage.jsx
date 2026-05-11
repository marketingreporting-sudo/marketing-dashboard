import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../lib/supabase';

const MIN_PASSWORD_LENGTH = 8;
const SUPPORTED_LINK_TYPES = new Set(['invite', 'recovery']);

const AuthLoadingScreen = ({ title = 'Checking your secure link.' }) => (
  <div className="auth-screen auth-screen--loading">
    <div className="auth-card auth-card--compact">
      <div className="auth-card__eyebrow">Loading session</div>
      <h1 className="auth-card__title">{title}</h1>
      <p className="auth-card__copy">
        We&apos;re restoring your setup session so you can choose a password.
      </p>
    </div>
  </div>
);

const getSetupLinkParams = (location) => {
  const params = new URLSearchParams(location.search);
  const hash = location.hash?.startsWith('#') ? location.hash.slice(1) : location.hash;
  const hashParams = new URLSearchParams(hash || '');

  hashParams.forEach((value, key) => {
    if (!params.has(key)) {
      params.set(key, value);
    }
  });

  return {
    accessToken: params.get('access_token'),
    code: params.get('code'),
    errorDescription: params.get('error_description'),
    refreshToken: params.get('refresh_token'),
    tokenHash: params.get('token_hash') || params.get('token'),
    type: params.get('type'),
  };
};

const SetPasswordPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isConfigured, isAuthenticated, loading, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [verifiedSession, setVerifiedSession] = useState(null);
  const attemptedTokenRef = useRef('');

  const {
    accessToken,
    code: authCode,
    errorDescription,
    refreshToken,
    tokenHash,
    type: setupLinkType,
  } = useMemo(
    () => getSetupLinkParams(location),
    [location]
  );
  const hasSetupLinkToken = Boolean(tokenHash && SUPPORTED_LINK_TYPES.has(setupLinkType));
  const hasImplicitSession = Boolean(accessToken && refreshToken);
  const hasSetupCredentials = Boolean(authCode || hasImplicitSession || hasSetupLinkToken);
  const canSetPassword = isAuthenticated || Boolean(verifiedSession?.user);

  const userEmail = useMemo(
    () => user?.email || verifiedSession?.user?.email || '',
    [user, verifiedSession]
  );

  useEffect(() => {
    if (!isConfigured || !supabase || loading || isAuthenticated || !hasSetupCredentials) {
      return undefined;
    }

    const tokenKey = authCode || `${accessToken || ''}:${refreshToken || ''}:${setupLinkType || ''}:${tokenHash || ''}`;
    if (attemptedTokenRef.current === tokenKey) {
      return undefined;
    }

    let mounted = true;
    attemptedTokenRef.current = tokenKey;

    const verifySetupLink = async () => {
      const { data, error } = authCode
        ? await supabase.auth.exchangeCodeForSession(authCode)
        : hasImplicitSession
          ? await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
          : await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: setupLinkType,
            });

      if (!mounted) return;

      if (error) {
        setErrorMessage(error.message || 'This secure link is invalid or has expired.');
        return;
      }

      setVerifiedSession(data?.session ?? null);
      window.history.replaceState(window.history.state, '', '/set-password');
    };

    verifySetupLink();

    return () => {
      mounted = false;
    };
  }, [
    accessToken,
    authCode,
    hasImplicitSession,
    hasSetupCredentials,
    isAuthenticated,
    isConfigured,
    loading,
    refreshToken,
    setupLinkType,
    tokenHash,
  ]);

  if (!isConfigured) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-card__eyebrow">Redstone Dashboard</div>
          <h1 className="auth-card__title">Set your password.</h1>
          <div className="auth-alert auth-alert--warning">
            <strong>Supabase frontend config is missing.</strong>
            <span>Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before continuing.</span>
          </div>
          <div className="auth-card__footer">
            <Link to="/sign-in">Back to sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || (hasSetupCredentials && !canSetPassword && !errorMessage)) {
    return <AuthLoadingScreen />;
  }

  if (!canSetPassword) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-card__eyebrow">Redstone Dashboard</div>
          <h1 className="auth-card__title">Your secure link is required.</h1>
          <p className="auth-card__copy">
            Open the invite email or password reset email again and use the latest link to set your password.
          </p>
          {(errorMessage || errorDescription) && (
            <div className="auth-alert auth-alert--error">
              {errorMessage || errorDescription}
            </div>
          )}
          <div className="auth-card__footer">
            <Link to="/sign-in">Back to sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    setErrorMessage('');
    setSuccessMessage('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('The passwords do not match yet.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setErrorMessage(error.message || 'Unable to update the password right now.');
      return;
    }

    setSuccessMessage('Password updated. Redirecting you into the dashboard…');
    window.setTimeout(() => {
      navigate('/', { replace: true });
    }, 900);
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-card__eyebrow">Redstone Dashboard</div>
        <h1 className="auth-card__title">Set your password.</h1>
        <p className="auth-card__copy">
          {userEmail
            ? `Finish securing ${userEmail} before entering the dashboard.`
            : 'Finish securing this invited account before entering the dashboard.'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-form__field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className="auth-form__field">
            <span>Confirm password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </label>

          {errorMessage && <div className="auth-alert auth-alert--error">{errorMessage}</div>}
          {successMessage && <div className="auth-alert auth-alert--success">{successMessage}</div>}

          <button type="submit" className="auth-form__submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save password'}
          </button>
        </form>

        <div className="auth-card__footer">
          <span>Password resets and invite links both land here.</span>
          <span>If this link expired, request a fresh one from the sign-in screen.</span>
        </div>
      </div>
    </div>
  );
};

export default SetPasswordPage;
