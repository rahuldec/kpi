/* Client-based Zoho OAuth (implicit flow) for browser-only apps.
   Zoho client-based clients require response_type=token — not authorization
   code / PKCE. See: https://www.zoho.com/accounts/protocol/oauth/js-apps/access-token.html */
(function (global) {
  'use strict';

  const SESSION_KEY = 'kpi.zoho.session';

  const DC_ACCOUNTS = {
    in: 'https://accounts.zoho.in',
    com: 'https://accounts.zoho.com',
    eu: 'https://accounts.zoho.eu',
    au: 'https://accounts.zoho.com.au',
    jp: 'https://accounts.zoho.jp',
    uk: 'https://accounts.zoho.uk',
    ca: 'https://accounts.zohocloud.ca',
  };

  const ZOHO = {
    /* Set this after creating the client-based app in Zoho API Console
       (Analytics project). Leave empty to disable auth (local dev / QA). */
    clientId: '1000.6XOPXM5YDUATFMNXLRPIF45156MZSU',
    accountsUrl: 'https://accounts.zoho.in',
    scopes: 'AaaServer.profile.READ',
    get redirectUri() {
      const { protocol, hostname, port, pathname } = location;
      const host = hostname === '127.0.0.1' ? 'localhost' : hostname;
      const portPart = port ? ':' + port : '';
      return protocol + '//' + host + portPart + pathname;
    }
  };

  const readStore = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const writeStore = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const dropStore = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  function accountsUrlFor(session) {
    if (session && session.accountsUrl) return session.accountsUrl;
    return ZOHO.accountsUrl;
  }

  function isTestMode() {
    if (!ZOHO.clientId) return true;
    if (location.hostname === 'kpi.test') return true;
    try { return new URLSearchParams(location.search).has('noauth'); } catch (e) { return false; }
  }

  function getStoredSession() {
    try {
      const raw = readStore(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function storeSession(data) {
    writeStore(SESSION_KEY, JSON.stringify(data));
  }

  function clearSession() {
    dropStore(SESSION_KEY);
  }

  function isTokenValid(session) {
    return !!(session && session.access_token && session.expires_at > Date.now() + 60000);
  }

  async function fetchUserInfo(accessToken, accountsUrl) {
    const base = accountsUrl || ZOHO.accountsUrl;
    /* Zoho blocks browser CORS on /oauth/user/info — proxied via /api/zoho-user. */
    const res = await fetch('/api/zoho-user?accounts=' + encodeURIComponent(base), {
      headers: { Authorization: 'Zoho-oauthtoken ' + accessToken },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('Could not load profile (' + res.status + ')');
    const data = await res.json();
    return {
      email: data.Email || data.email || '',
      name: data.Display_Name || data.display_name || data.First_Name || 'User'
    };
  }

  function cleanCallbackUrl() {
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(null, '', url.pathname + url.search);
  }

  function parseHashParams() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    return new URLSearchParams(hash);
  }

  async function sessionFromFragment(params) {
    const error = params.get('error');
    if (error) throw new Error(params.get('error_description') || error);

    const accessToken = params.get('access_token');
    if (!accessToken) return null;

    const loc = params.get('location') || '';
    const accountsUrl = DC_ACCOUNTS[loc] || ZOHO.accountsUrl;
    const user = await fetchUserInfo(accessToken, accountsUrl);
    return {
      access_token: accessToken,
      expires_at: Date.now() + (Number(params.get('expires_in')) || 3600) * 1000,
      granted_for_session: params.get('granted_for_session') === 'true',
      accountsUrl,
      location: loc,
      user
    };
  }

  async function handleTokenRedirect() {
    const params = parseHashParams();
    if (!params) return false;
    const session = await sessionFromFragment(params);
    if (!session) return false;
    storeSession(session);
    cleanCallbackUrl();
    return true;
  }

  function authUrl(path) {
    const url = new URL(accountsUrlFor(getStoredSession()) + path);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('client_id', ZOHO.clientId);
    url.searchParams.set('scope', ZOHO.scopes);
    url.searchParams.set('redirect_uri', ZOHO.redirectUri);
    return url.toString();
  }

  function startLogin() {
    location.href = authUrl('/oauth/v2/auth');
  }

  function startRefresh() {
    location.href = authUrl('/oauth/v2/auth/refresh');
  }

  async function ensureAuth() {
    if (isTestMode()) {
      return { ok: true, user: { name: 'QA', email: '' }, test: true };
    }

    if (location.hash && location.hash.includes('access_token')) {
      await handleTokenRedirect();
    }
    if (location.hash && location.hash.includes('error')) {
      await handleTokenRedirect();
    }

    let session = getStoredSession();
    if (isTokenValid(session)) {
      return { ok: true, user: session.user };
    }

    if (session && session.granted_for_session) {
      startRefresh();
      return { ok: false, refreshing: true };
    }

    return { ok: false };
  }

  function logout() {
    clearSession();
    location.reload();
  }

  global.ZohoAuth = {
    ZOHO,
    ensureAuth,
    startLogin,
    logout,
    clearSession,
    isTestMode
  };
})(typeof window !== 'undefined' ? window : globalThis);
