import React, { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../lib/supabase';

const SignInPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isConfigured } = useAuth();
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const nextPath = useMemo(() => {
    const fallback = '/';
    const candidate = location.state?.from?.pathname;
    return typeof candidate === 'string' && candidate ? candidate : fallback;
  }, [location.state]);

  if (isAuthenticated) {
    return <Navigate to={nextPath} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(error.message || 'Unable to sign in with that account.');
      setSubmitting(false);
      return;
    }

    navigate(nextPath, { replace: true });
  };

  const handlePasswordReset = async (event) => {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`,
    });

    setSubmitting(false);

    if (error) {
      setErrorMessage(error.message || 'Unable to send a password reset email.');
      return;
    }

    setSuccessMessage('Password reset email sent. Open the latest email to choose a new password.');
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-card__eyebrow">Redstone Dashboard</div>
        <h1 className="auth-card__title">Sign in to continue.</h1>
        <p className="auth-card__copy">
          This dashboard now requires a Supabase-authenticated session before the analytics
          workspace loads.
        </p>

        {!isConfigured ? (
          <div className="auth-alert auth-alert--warning">
            <strong>Supabase frontend config is missing.</strong>
            <span>
              Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the dashboard environment
              before signing in.
            </span>
          </div>
        ) : (
          <>
            <div className="auth-mode-toggle" role="tablist" aria-label="Authentication options">
              <button
                type="button"
                className={`auth-mode-toggle__button ${mode === 'sign-in' ? 'active' : ''}`}
                onClick={() => {
                  setMode('sign-in');
                  setErrorMessage('');
                  setSuccessMessage('');
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-mode-toggle__button ${mode === 'reset' ? 'active' : ''}`}
                onClick={() => {
                  setMode('reset');
                  setErrorMessage('');
                  setSuccessMessage('');
                }}
              >
                Reset password
              </button>
            </div>

            <form className="auth-form" onSubmit={mode === 'sign-in' ? handleSubmit : handlePasswordReset}>
              <label className="auth-form__field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>

              {mode === 'sign-in' && (
                <label className="auth-form__field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
              )}

              {errorMessage && <div className="auth-alert auth-alert--error">{errorMessage}</div>}
              {successMessage && <div className="auth-alert auth-alert--success">{successMessage}</div>}

              <button type="submit" className="auth-form__submit" disabled={submitting}>
                {submitting
                  ? mode === 'sign-in'
                    ? 'Signing in…'
                    : 'Sending reset…'
                  : mode === 'sign-in'
                    ? 'Sign in'
                    : 'Send reset email'}
              </button>
            </form>

            <div className="auth-helper-copy">
              {mode === 'sign-in'
                ? 'Invited users should use the email link once, set a password, and then return here for future sign-ins.'
                : 'We will send a secure link that opens the set-password screen for this account.'}
            </div>
          </>
        )}

        <div className="auth-card__footer">
          <span>Need access?</span>
          <span>Use an invited account or ask an administrator to provision one for you.</span>
          <Link to="/set-password">Already have an invite link? Finish setup here.</Link>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
