const GITHUB_API = 'https://api.github.com';
let DATA = null;

// ── GitHub API ──

function getConfig() {
  const token = localStorage.getItem('gh_token');
  const owner = localStorage.getItem('gh_owner') || 'jabeen16';
  const repo = localStorage.getItem('gh_repo') || 'bachupally-water-tracker';
  return { token, owner, repo };
}

function friendlyErrorMessage(status) {
  if (status === 401 || status === 403) return 'Your access token has expired or is invalid. Please enter a new one.';
  if (status === 404) return "Couldn't find the data file. Please check your setup.";
  if (status === 409) return 'Someone else saved changes while you were editing. Please reload the page.';
  if (status === 422) return "Couldn't save — the data on GitHub has changed. Please reload the page.";
  if (status >= 500) return 'GitHub is having issues right now. Please try again in a few minutes.';
  return `Couldn't save (error ${status}). Check your internet connection and try again.`;
}

function httpError(status) {
  const err = new Error(friendlyErrorMessage(status));
  err.status = status;
  return err;
}

function isAuthError(err) {
  return err && (err.status === 401 || err.status === 403);
}

async function fetchData() {
  const { token, owner, repo } = getConfig();
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`, { headers });
  if (!res.ok) throw httpError(res.status);
  const file = await res.json();
  const content = atob(file.content);
  return { data: JSON.parse(content), sha: file.sha };
}

async function saveData(data, sha) {
  const { token, owner, repo } = getConfig();
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Update readings - ${new Date().toISOString().split('T')[0]}`,
      content,
      sha
    })
  });
  if (!res.ok) throw httpError(res.status);
  return res.json();
}

// ── Computation ──

function computeConsumption(data) {
  const dates = data.dates;
  const periods = [];
  for (let i = 0; i < dates.length - 1; i++) {
    periods.push({ from: dates[i], to: dates[i + 1] });
  }

  const rows = data.residents.map(r => {
    const consumption = {};
    const perDay = {};
    let total = 0;
    let totalDays = 0;

    periods.forEach(p => {
      const r1 = r.readings[p.from];
      const r2 = r.readings[p.to];
      if (r1 != null && r2 != null) {
        const diff = r2 - r1;
        const days = (new Date(p.to) - new Date(p.from)) / (1000 * 60 * 60 * 24);
        consumption[`${p.from}_${p.to}`] = diff;
        perDay[`${p.from}_${p.to}`] = Math.round((diff / days) * 10) / 10;
        total += diff;
        totalDays += days;
      }
    });

    return {
      name: r.name,
      room: r.room,
      consumption,
      perDay,
      total,
      totalPerDay: totalDays > 0 ? Math.round((total / totalDays) * 10) / 10 : 0
    };
  });

  return { periods, rows };
}

// ── Format helpers ──

function fmtDate(d) {
  const dt = new Date(d.substring(0, 10) + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtTime(d) {
  if (d.length <= 10) return '';
  const t = d.substring(11, 16);
  return t === '00:00' ? '' : t;
}

function periodLabel(p) {
  const sameDay = p.from.substring(0, 10) === p.to.substring(0, 10);
  if (sameDay) {
    const fromT = d => d.length > 10 ? d.substring(11, 16) : '00:00';
    return `${fmtDate(p.from)} ${fromT(p.from)} \u2192 ${fromT(p.to)}`;
  }
  return `${fmtDate(p.from)} \u2192 ${fmtDate(p.to)}`;
}

function numFmt(n) {
  return n.toLocaleString('en-IN');
}

function roomLabel(r) {
  return r.name ? `${r.room} (${r.name})` : r.room;
}

// ── Month filtering ──

function getMonths(dates) {
  const months = new Set();
  dates.forEach(d => months.add(d.substring(0, 7))); // "2026-04"
  return Array.from(months).sort();
}

function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  const dt = new Date(parseInt(y), parseInt(m) - 1);
  return dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function filterDatesByMonth(dates, month) {
  if (month === 'all') return dates;
  return dates.filter(d => d.startsWith(month));
}

function getFilteredData(month) {
  const filteredDates = filterDatesByMonth(DATA.dates, month);
  return {
    ...DATA,
    dates: filteredDates
  };
}

function populateMonthSelect(selectEl, onChange) {
  const months = getMonths(DATA.dates);
  selectEl.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = 'all';
  allOpt.textContent = 'All Months';
  selectEl.appendChild(allOpt);

  months.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = fmtMonth(m);
    selectEl.appendChild(opt);
  });

  // Default to latest month
  if (months.length > 0) {
    selectEl.value = months[months.length - 1];
  }

  selectEl.addEventListener('change', () => onChange(selectEl.value));
}

// ── Setup ──

function showSetup(errorMessage, reauth = false) {
  const { token, owner, repo } = getConfig();
  if (token) document.getElementById('token-input').value = '';
  if (owner) document.getElementById('repo-owner').value = owner;
  if (repo) document.getElementById('repo-name').value = repo;
  const modal = document.getElementById('setup-modal');
  modal.dataset.reauth = reauth ? '1' : '0';
  const errorEl = document.getElementById('setup-error');
  if (errorMessage) {
    errorEl.textContent = errorMessage;
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
  }
  const cancelBtn = document.getElementById('cancel-setup-btn');
  if (DATA === null) {
    cancelBtn.classList.add('hidden');
  } else {
    cancelBtn.classList.remove('hidden');
  }
  modal.classList.remove('hidden');
}

async function saveSetup(onSuccess) {
  const token = document.getElementById('token-input').value.trim();
  const owner = document.getElementById('repo-owner').value.trim();
  const repo = document.getElementById('repo-name').value.trim();
  const modal = document.getElementById('setup-modal');
  const errorEl = document.getElementById('setup-error');
  errorEl.classList.add('hidden');

  if (!token) {
    errorEl.textContent = 'Token is required.';
    errorEl.classList.remove('hidden');
    return;
  }

  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo', repo);

  const reauth = modal.dataset.reauth === '1';

  try {
    if (reauth) {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      if (!res.ok) throw httpError(res.status);
    } else {
      const { data } = await fetchData();
      DATA = data;
    }
    modal.classList.add('hidden');
    modal.dataset.reauth = '0';
    if (!reauth && onSuccess) onSuccess();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.classList.remove('hidden');
  }
}

async function loadData(onSuccess) {
  try {
    const { data } = await fetchData();
    DATA = data;
    onSuccess();
  } catch (e) {
    if (document.getElementById('setup-modal')) {
      showSetup(e.message);
    } else {
      alert(`Couldn't load data. ${e.message}`);
    }
  }
}

function initSetupListeners(onSuccess) {
  document.getElementById('settings-btn').addEventListener('click', () => showSetup(undefined, DATA !== null));
  document.getElementById('save-token-btn').addEventListener('click', () => saveSetup(onSuccess));
  document.getElementById('cancel-setup-btn').addEventListener('click', () => {
    document.getElementById('setup-modal').classList.add('hidden');
  });
}
