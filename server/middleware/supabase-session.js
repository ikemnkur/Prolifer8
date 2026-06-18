const { createSupabaseServerClient } = require('../config/supabase');

function parseCookies(headerValue = '') {
  return headerValue
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf('=');
      if (idx === -1) return acc;
      const key = decodeURIComponent(pair.slice(0, idx).trim());
      const value = decodeURIComponent(pair.slice(idx + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

function getRefreshToken(req, cookies) {
  return (
    req.headers['x-refresh-token'] ||
    cookies['sb-refresh-token'] ||
    cookies['supabase-refresh-token'] ||
    null
  );
}

async function supabaseSessionMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const accessToken = getBearerToken(req) || cookies['sb-access-token'] || cookies['supabase-access-token'] || null;
  const refreshToken = getRefreshToken(req, cookies);

  req.supabaseSession = null;
  req.supabaseUser = null;

  if (!accessToken && !refreshToken) {
    return next();
  }

  try {
    const supabase = createSupabaseServerClient();

    if (accessToken) {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (!error && data?.user) {
        req.supabaseUser = data.user;
        req.supabaseSession = { access_token: accessToken, refresh_token: refreshToken || null };
        return next();
      }
    }

    if (refreshToken) {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data?.session) {
        req.supabaseSession = data.session;
        req.supabaseUser = data.user || null;

        // Non-breaking header exposure so frontend can rotate tokens without changing existing auth paths yet.
        res.setHeader('x-supabase-access-token', data.session.access_token || '');
        res.setHeader('x-supabase-refresh-token', data.session.refresh_token || '');
      }
    }
  } catch (error) {
    console.warn('Supabase session middleware warning:', error.message || error);
  }

  return next();
}

module.exports = {
  supabaseSessionMiddleware,
};
