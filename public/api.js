/* Robbin da Hood — tiny API client (window.RHApi) */
(function () {
  const TOKEN_KEY = 'rh.token';

  function token() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  window.RHApi = {
    token, setToken,
    register: (username, password) => call('POST', '/api/register', { username, password }),
    login: (username, password) => call('POST', '/api/login', { username, password }),
    logout: () => call('POST', '/api/logout'),
    me: () => call('GET', '/api/me'),
    setWallet: (wallet) => call('POST', '/api/wallet', { wallet }),
    getState: () => call('GET', '/api/state'),
    saveState: (state) => call('PUT', '/api/state', { state }),
    provide: (pts) => call('POST', '/api/provide', { pts }),
    reportCycle: (pts) => call('POST', '/api/cycle', { pts }),
    leaderboard: () => call('GET', '/api/leaderboard')
  };
})();
