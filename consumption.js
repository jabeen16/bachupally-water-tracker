let allRoomsChart = null;
let singleRoomChart = null;

const COLORS = [
  '#4472c4', '#ed7d31', '#2f5597', '#ffc000', '#5b9bd5',
  '#70ad47', '#ff5050', '#9b59b6', '#00b0f0', '#00b050'
];

function legendClickHandler(e, legendItem, legend) {
  const chart = legend.chart;
  const ci = legendItem.datasetIndex;
  const allVisible = chart.data.datasets.every((ds, i) => chart.isDatasetVisible(i));

  if (allVisible) {
    chart.data.datasets.forEach((ds, i) => { chart.setDatasetVisibility(i, i === ci); });
  } else if (chart.isDatasetVisible(ci)) {
    chart.setDatasetVisibility(ci, false);
    const stillVisible = chart.data.datasets.filter((ds, i) => chart.isDatasetVisible(i)).length;
    if (stillVisible === 0) {
      chart.data.datasets.forEach((ds, i) => { chart.setDatasetVisibility(i, true); });
    }
  } else {
    chart.setDatasetVisibility(ci, true);
  }
  chart.update();
}

function renderCards(computed) {
  const container = document.getElementById('summary-cards');
  const totalUsage = computed.rows.reduce((s, r) => s + r.total, 0);
  const highestRoom = computed.rows.reduce((a, b) => a.totalPerDay > b.totalPerDay ? a : b);
  const lowestRoom = computed.rows.reduce((a, b) => a.totalPerDay < b.totalPerDay ? a : b);

  container.innerHTML = `
    <div class="card">
      <div class="label">Total Building Usage</div>
      <div class="value">${numFmt(totalUsage)}</div>
      <div class="sub">litres (all rooms combined)</div>
    </div>
    <div class="card">
      <div class="label">Highest Per Day</div>
      <div class="value">${numFmt(highestRoom.totalPerDay)}</div>
      <div class="sub">${roomLabel(highestRoom)}</div>
    </div>
    <div class="card">
      <div class="label">Lowest Per Day</div>
      <div class="value">${numFmt(lowestRoom.totalPerDay)}</div>
      <div class="sub">${roomLabel(lowestRoom)}</div>
    </div>
    <div class="card">
      <div class="label">Readings Recorded</div>
      <div class="value">${DATA.dates.length}</div>
      <div class="sub">${fmtDate(DATA.dates[0])} to ${fmtDate(DATA.dates[DATA.dates.length - 1])}</div>
    </div>
  `;
}

function renderAllRoomsChart(computed) {
  const ctx = document.getElementById('all-rooms-chart').getContext('2d');
  const labels = computed.rows.map(r => roomLabel(r));
  const datasets = [];

  computed.periods.forEach((p, i) => {
    const key = `${p.from}_${p.to}`;
    datasets.push({
      label: periodLabel(p),
      data: computed.rows.map(r => r.perDay[key] || 0),
      backgroundColor: COLORS[i % COLORS.length],
      borderRadius: 4
    });
  });

  datasets.push({
    label: 'Total Per Day',
    data: computed.rows.map(r => r.totalPerDay),
    backgroundColor: '#c00000',
    borderRadius: 4
  });

  if (allRoomsChart) allRoomsChart.destroy();
  allRoomsChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', onClick: legendClickHandler },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${numFmt(ctx.parsed.x)} litres/day`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          title: { display: true, text: 'Litres / Day' },
          ticks: { callback: v => numFmt(v) }
        },
        y: {
          ticks: { autoSkip: false }
        }
      }
    }
  });
}

function renderLineChart(computed) {
  const ctx = document.getElementById('single-room-chart').getContext('2d');
  const labels = computed.periods.map(p => periodLabel(p));

  const datasets = computed.rows.map((r, i) => ({
    label: roomLabel(r),
    data: computed.periods.map(p => r.perDay[`${p.from}_${p.to}`] || 0),
    borderColor: COLORS[i % COLORS.length],
    backgroundColor: COLORS[i % COLORS.length] + '20',
    borderWidth: 2.5,
    pointRadius: 6,
    pointBackgroundColor: COLORS[i % COLORS.length],
    pointHoverRadius: 9,
    tension: 0.3
  }));

  if (singleRoomChart) singleRoomChart.destroy();
  singleRoomChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 15 },
          onClick: legendClickHandler
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${numFmt(ctx.parsed.y)} litres/day`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Litres / Day' },
          ticks: { callback: v => numFmt(v) }
        }
      }
    }
  });
}

function renderTables(computed) {
  const cTable = document.getElementById('consumption-table');
  let cHtml = '<thead><tr><th>Room</th><th>Tenant</th>';
  computed.periods.forEach(p => { cHtml += `<th>${periodLabel(p)}</th>`; });
  cHtml += '<th>Total</th></tr></thead><tbody>';

  const allPerDay = computed.rows.map(r => r.totalPerDay);
  const avgPerDay = allPerDay.reduce((a, b) => a + b, 0) / allPerDay.length;

  computed.rows.forEach(r => {
    cHtml += `<tr><td>${r.room}</td><td>${r.name}</td>`;
    computed.periods.forEach(p => {
      const key = `${p.from}_${p.to}`;
      cHtml += `<td>${r.consumption[key] != null ? numFmt(r.consumption[key]) : ''}</td>`;
    });
    cHtml += `<td><strong>${numFmt(r.total)}</strong></td></tr>`;
  });
  cHtml += '</tbody>';
  cTable.innerHTML = cHtml;

  const pTable = document.getElementById('perday-table');
  let pHtml = '<thead><tr><th>Room</th><th>Tenant</th>';
  computed.periods.forEach(p => { pHtml += `<th>${periodLabel(p)}</th>`; });
  pHtml += '<th>Total/Day</th></tr></thead><tbody>';

  computed.rows.forEach(r => {
    pHtml += `<tr><td>${r.room}</td><td>${r.name}</td>`;
    computed.periods.forEach(p => {
      const key = `${p.from}_${p.to}`;
      const val = r.perDay[key];
      const cls = val != null && val > avgPerDay * 1.5 ? 'high' : val != null && val < avgPerDay * 0.3 ? 'low' : '';
      pHtml += `<td class="${cls}">${val != null ? numFmt(val) : ''}</td>`;
    });
    const cls = r.totalPerDay > avgPerDay * 1.5 ? 'high' : r.totalPerDay < avgPerDay * 0.3 ? 'low' : '';
    pHtml += `<td class="${cls}"><strong>${numFmt(r.totalPerDay)}</strong></td></tr>`;
  });
  pHtml += '</tbody>';
  pTable.innerHTML = pHtml;
}

function renderForMonth(month) {
  const filtered = getFilteredData(month);
  const computed = computeConsumption(filtered);
  renderCards(computed);
  renderTables(computed);
  renderAllRoomsChart(computed);
  renderLineChart(computed);
}

function renderAll() {
  const select = document.getElementById('month-select');
  populateMonthSelect(select, renderForMonth);
  renderForMonth(select.value);
}

document.addEventListener('DOMContentLoaded', () => {
  loadData(renderAll);
});
