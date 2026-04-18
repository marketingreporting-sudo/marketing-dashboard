import React, { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../lib/supabase';

const MIN_PASSWORD_LENGTH = 8;

const SetPasswordPage = () => {
  const navigate = useNavigate();
  const { isConfigured, isAuthenticated, user } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const userEmail = useMemo(() => user?.email || '', [user]);

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

  if (!isAuthenticated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-card__eyebrow">Redstone Dashboard</div>
          <h1 className="auth-card__title">Your secure link is required.</h1>
          <p className="auth-card__copy">
            Open the invite email or password reset email again and use the latest link to set your password.
          </p>
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
