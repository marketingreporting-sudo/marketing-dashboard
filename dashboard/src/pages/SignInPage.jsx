import React, { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../lib/supabase';

const SignInPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

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
          <form className="auth-form" onSubmit={handleSubmit}>
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

            {errorMessage && <div className="auth-alert auth-alert--error">{errorMessage}</div>}

            <button type="submit" className="auth-form__submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        <div className="auth-card__footer">
          <span>Need access?</span>
          <span>Use an invited account or ask an administrator to provision one for you.</span>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
