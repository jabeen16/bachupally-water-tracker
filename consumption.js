let allRoomsChart = null;
let singleRoomChart = null;

const COLORS = [
  '#4472c4', '#ed7d31', '#2f5597', '#ffc000', '#5b9bd5',
  '#70ad47', '#ff5050', '#9b59b6', '#00b0f0', '#00b050'
];

function wireClearSelectionButton(chart, buttonId) {
  const clearButton = document.getElementById(buttonId);
  if (!clearButton) return;
  const syncDisabledState = () => {
    const allVisible = chart.data.datasets.every((ds, i) => chart.isDatasetVisible(i));
    clearButton.disabled = allVisible;
  };
  clearButton.onclick = () => {
    chart.data.datasets.forEach((ds, i) => chart.setDatasetVisibility(i, true));
    chart.update();
    syncDisabledState();
  };
  const legendOpts = chart.options.plugins.legend;
  const originalLegendClick = legendOpts.onClick;
  legendOpts.onClick = function (e, legendItem, legend) {
    originalLegendClick.call(this, e, legendItem, legend);
    syncDisabledState();
  };
  syncDisabledState();
}

function makeSubDayPattern(baseColor) {
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const tileCtx = tile.getContext('2d');
  tileCtx.fillStyle = baseColor;
  tileCtx.fillRect(0, 0, 8, 8);
  tileCtx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  tileCtx.lineWidth = 2;
  tileCtx.beginPath();
  tileCtx.moveTo(-2, 2); tileCtx.lineTo(2, -2);
  tileCtx.moveTo(0, 8);  tileCtx.lineTo(8, 0);
  tileCtx.moveTo(6, 10); tileCtx.lineTo(10, 6);
  tileCtx.stroke();
  return tileCtx.createPattern(tile, 'repeat');
}

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

function computeMedianPerDay(computed) {
  const sortedRates = computed.rows.map(r => r.totalPerDay).filter(v => v != null).sort((a, b) => a - b);
  if (sortedRates.length === 0) return 0;
  const middleIndex = Math.floor(sortedRates.length / 2);
  if (sortedRates.length % 2 === 0) {
    return Math.round(((sortedRates[middleIndex - 1] + sortedRates[middleIndex]) / 2) * 10) / 10;
  }
  return sortedRates[middleIndex];
}

function isOvernightPeriod(p) {
  const fromDate = p.from.substring(0, 10);
  const toDate = p.to.substring(0, 10);
  if (fromDate === toDate) return false;
  const fromHour = p.from.length > 10 ? parseInt(p.from.substring(11, 13), 10) : 0;
  const toHour = p.to.length > 10 ? parseInt(p.to.substring(11, 13), 10) : 0;
  if (fromHour < 18 || toHour > 9) return false;
  const dayDiffMs = new Date(toDate + 'T00:00:00') - new Date(fromDate + 'T00:00:00');
  return Math.round(dayDiffMs / 86400000) === 1;
}

function computePerRoomAnomalies(computed) {
  const anomalies = [];
  computed.rows.forEach(row => {
    if (!row.totalPerDay || row.totalPerDay === 0) return;
    computed.periods.forEach(p => {
      const periodKey = `${p.from}_${p.to}`;
      const periodRate = row.perDay[periodKey];
      if (periodRate == null) return;
      if (periodRate > row.totalPerDay * 1.5 && periodRate > row.totalPerDay + 50) {
        anomalies.push({
          room: row.room,
          name: row.name,
          period: p,
          rate: periodRate,
          baseline: row.totalPerDay,
          ratio: periodRate / row.totalPerDay
        });
      }
    });
  });
  return anomalies.sort((a, b) => b.ratio - a.ratio);
}

function computeOvernightAlerts(computed) {
  const OVERNIGHT_RATE_THRESHOLD = 120;
  const alerts = [];
  computed.periods.forEach(p => {
    if (!isOvernightPeriod(p)) return;
    computed.rows.forEach(row => {
      const periodKey = `${p.from}_${p.to}`;
      const periodRate = row.perDay[periodKey];
      if (periodRate != null && periodRate >= OVERNIGHT_RATE_THRESHOLD) {
        alerts.push({
          room: row.room,
          name: row.name,
          period: p,
          rate: periodRate
        });
      }
    });
  });
  return alerts.sort((a, b) => b.rate - a.rate);
}

function renderAlerts(computed) {
  const container = document.getElementById('alerts');
  const overnightAlerts = computeOvernightAlerts(computed);
  const roomAnomalies = computePerRoomAnomalies(computed);

  if (overnightAlerts.length === 0 && roomAnomalies.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  let html = '<div class="alert-banner"><h3>⚠ Possible water issues</h3><ul>';
  overnightAlerts.forEach(a => {
    html += `<li><strong>${a.room} (${a.name})</strong>: overnight rate <strong>${numFmt(Math.round(a.rate))} L/day</strong> from ${fmtDateTime(a.period.from)} to ${fmtDateTime(a.period.to)} — overnight usage should be near zero.</li>`;
  });
  roomAnomalies.forEach(a => {
    html += `<li><strong>${a.room} (${a.name})</strong>: <strong>${numFmt(Math.round(a.rate))} L/day</strong> during ${fmtDateTime(a.period.from)} → ${fmtDateTime(a.period.to)} — ${a.ratio.toFixed(1)}× their typical ${numFmt(Math.round(a.baseline))} L/day.</li>`;
  });
  html += '</ul></div>';
  container.innerHTML = html;
  container.classList.remove('hidden');
}

function renderCards(computed) {
  const container = document.getElementById('summary-cards');
  const totalUsage = computed.rows.reduce((s, r) => s + r.total, 0);
  const highestRoom = computed.rows.reduce((a, b) => a.totalPerDay > b.totalPerDay ? a : b);
  const lowestRoom = computed.rows.reduce((a, b) => a.totalPerDay < b.totalPerDay ? a : b);
  const medianPerDay = computeMedianPerDay(computed);

  container.innerHTML = `
    <div class="card">
      <div class="label">Total Building Usage</div>
      <div class="value">${numFmt(totalUsage)}</div>
      <div class="sub">litres (all rooms combined)</div>
    </div>
    <div class="card">
      <div class="label">Typical Per Day (median)</div>
      <div class="value">${numFmt(medianPerDay)}</div>
      <div class="sub">litres / day per resident — half use more, half less</div>
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
      <div class="sub">${fmtDateTime(DATA.dates[0])} to ${fmtDateTime(DATA.dates[DATA.dates.length - 1])}</div>
    </div>
  `;
}

function renderAllRoomsChart(computed) {
  const ctx = document.getElementById('all-rooms-chart').getContext('2d');
  const labels = computed.rows.map(r => roomLabel(r));
  const datasets = [];

  computed.periods.forEach((p, i) => {
    const key = `${p.from}_${p.to}`;
    const baseColor = COLORS[i % COLORS.length];
    datasets.push({
      label: periodLabel(p),
      data: computed.rows.map(r => r.perDay[key] || 0),
      backgroundColor: isSubDayPeriod(p) ? makeSubDayPattern(baseColor) : baseColor,
      borderRadius: 4,
      period: p
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
            label: ctx => {
              const period = ctx.dataset.period;
              const rateLabel = `${ctx.dataset.label}: ${numFmt(ctx.parsed.x)} litres/day`;
              if (!period) return rateLabel;
              return `${rateLabel} (over ${fmtPeriodDuration(period)})`;
            }
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
  wireClearSelectionButton(allRoomsChart, 'all-rooms-toggle');
}

function renderLineChart(computed) {
  const ctx = document.getElementById('single-room-chart').getContext('2d');
  const labels = computed.periods.map(p => periodLabel(p));
  const periodsByIndex = computed.periods;

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
            label: ctx => {
              const period = periodsByIndex[ctx.dataIndex];
              const rateLabel = `${ctx.dataset.label}: ${numFmt(ctx.parsed.y)} litres/day`;
              if (!period) return rateLabel;
              return `${rateLabel} (over ${fmtPeriodDuration(period)})`;
            }
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
  wireClearSelectionButton(singleRoomChart, 'single-room-toggle');
}

function renderTables(computed) {
  const cTable = document.getElementById('consumption-table');
  let cHtml = '<thead><tr><th>Room</th><th>Tenant</th>';
  computed.periods.forEach(p => { cHtml += `<th>${periodLabelHtml(p)}</th>`; });
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
  computed.periods.forEach(p => { pHtml += `<th>${periodLabelHtml(p)}</th>`; });
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
  renderAlerts(computed);
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
