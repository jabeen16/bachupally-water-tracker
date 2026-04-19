const GITHUB_API = 'https://api.github.com';
let DATA = null;

// ── GitHub API ──

function getConfig() {
  const token = localStorage.getItem('gh_token');
  const owner = localStorage.getItem('gh_owner') || 'jabeen16';
  const repo = localStorage.getItem('gh_repo') || 'bachupally-water-tracker';
  return { token, owner, repo };
}

async function fetchData() {
  const { token, owner, repo } = getConfig();
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/data.json`, { headers });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
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
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
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
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function periodLabel(p) {
  return `${fmtDate(p.from)} \u2192 ${fmtDate(p.to)}`;
}

function numFmt(n) {
  return n.toLocaleString('en-IN');
}

function roomLabel(r) {
  return r.name ? `${r.room} (${r.name})` : r.room;
}

// ── Setup ──

function showSetup() {
  const { token, owner, repo } = getConfig();
  if (token) document.getElementById('token-input').value = '';
  if (owner) document.getElementById('repo-owner').value = owner;
  if (repo) document.getElementById('repo-name').value = repo;
  document.getElementById('setup-modal').classList.remove('hidden');
}

async function saveSetup(onSuccess) {
  const token = document.getElementById('token-input').value.trim();
  const owner = document.getElementById('repo-owner').value.trim();
  const repo = document.getElementById('repo-name').value.trim();
  const errorEl = document.getElementById('setup-error');
  errorEl.classList.add('hidden');

  if (!token || !owner || !repo) {
    errorEl.textContent = 'All fields are required.';
    errorEl.classList.remove('hidden');
    return;
  }

  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo', repo);

  try {
    const { data } = await fetchData();
    DATA = data;
    document.getElementById('setup-modal').classList.add('hidden');
    if (onSuccess) onSuccess();
  } catch (e) {
    errorEl.textContent = `Connection failed: ${e.message}. Check your token and repo.`;
    errorEl.classList.remove('hidden');
  }
}

async function loadData(onSuccess) {
  try {
    const { data } = await fetchData();
    DATA = data;
    onSuccess();
  } catch (e) {
    showSetup();
  }
}

function initSetupListeners(onSuccess) {
  document.getElementById('settings-btn').addEventListener('click', showSetup);
  document.getElementById('save-token-btn').addEventListener('click', () => saveSetup(onSuccess));
  document.getElementById('cancel-setup-btn').addEventListener('click', () => {
    document.getElementById('setup-modal').classList.add('hidden');
  });
}
