import { supabase } from './supabase';

export const authFetch = async (input, init = {}) => {
  const nextHeaders = new Headers(init.headers || {});

  if (supabase) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.access_token) {
      nextHeaders.set('Authorization', `Bearer ${session.access_token}`);
    }
  }

  return fetch(input, {
    ...init,
    headers: nextHeaders,
  });
};
