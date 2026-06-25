/**
 * app.js — Logic Frontend cho StockAI
 * Tích hợp: Backend API + TradingView Charts + Gemini API Streaming
 */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : 'https://tim-co-hoi-train-ngan-han.onrender.com';

// Hàm helper định dạng số chuẩn Việt Nam (Dấu phẩy phân cách thập phân, dấu chấm phân cách hàng nghìn)
function formatNumber(num, decimals = 2, showSign = false) {
  if (num === null || num === undefined || isNaN(num)) return '--';
  let formatted = Number(num).toLocaleString('vi-VN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
  if (showSign && num > 0) {
    return '+' + formatted;
  }
  return formatted;
}

// ===== STATE =====
let currentTicker = '';
let stockData = null;
let candleData = null;
let mainChart = null;
let subChart = null;
let currentSubChart = 'macd';
let currentTimeframe = '1y';
let isSyncing = false;

// ===== DOM SHORTCUTS =====
const $ = id => document.getElementById(id);

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  checkServerStatus();
  setupKeyInput();
  setupSearch();
  setTimeframe('1y');
  // Load demo ticker on start
  setTimeout(() => {
    $('ticker-input').value = 'GEX';
    loadStock('GEX');
  }, 800);
});

// ===== SERVER STATUS =====
async function checkServerStatus() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      $('server-status').textContent = '✅ Online';
      $('server-status').style.color = 'var(--green)';
    } else throw new Error('Not OK');
  } catch {
    $('server-status').textContent = '❌ Offline';
    $('server-status').style.color = 'var(--red)';
    showToast('Backend chưa khởi động! Mở start.bat trong thư mục backend.', 'error');
  }
}

// ===== GEMINI KEY =====
function setupKeyInput() {
  const inp = $('gemini-key-input');
  const dot = $('key-dot');
  const eyeIcon = $('key-eye-icon');
  const modelSelect = $('gemini-model-select');

  // Load saved key
  const defaultKey = '';
  const saved = localStorage.getItem('gemini_api_key') || defaultKey;
  if (saved) {
    inp.value = saved;
    dot.classList.add('active');
    if (!localStorage.getItem('gemini_api_key') && defaultKey) {
      localStorage.setItem('gemini_api_key', defaultKey);
    }
  }

  // Load saved model
  const savedModel = localStorage.getItem('gemini_model');
  if (savedModel && modelSelect) {
    modelSelect.value = savedModel;
  }

  inp.addEventListener('input', () => {
    const val = inp.value.trim();
    localStorage.setItem('gemini_api_key', val);
    dot.classList.toggle('active', val.length > 10);
  });

  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      localStorage.setItem('gemini_model', modelSelect.value);
    });
  }

  $('btn-toggle-key').addEventListener('click', () => {
    if (inp.type === 'password') {
      inp.type = 'text';
      eyeIcon.className = 'fa-solid fa-eye';
    } else {
      inp.type = 'password';
      eyeIcon.className = 'fa-solid fa-eye-slash';
    }
  });
}

function getGeminiKey() {
  const defaultKey = '';
  return ($('gemini-key-input').value || '').trim() || defaultKey;
}

// ===== SEARCH =====
function setupSearch() {
  const inp = $('ticker-input');
  $('btn-search').addEventListener('click', () => {
    const t = inp.value.trim().toUpperCase();
    if (t) loadStock(t);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const t = inp.value.trim().toUpperCase();
      if (t) loadStock(t);
    }
  });
}

// ===== TAB SWITCHING =====
function switchTab(tab) {
  const views = ['dashboard', 'deepsearch', 'intraday', 'backtest', 'scanner'];
  views.forEach(v => {
    $(`view-${v}`).style.display = v === tab ? 'block' : 'none';
    $(`tab-${v}`).classList.toggle('active', v === tab);
    $(`nav-${v}`)?.classList.toggle('active', v === tab);
  });
  if (tab === 'intraday' && currentTicker) loadIntradayAndPutThrough(currentTicker);
  if (tab === 'backtest' && currentTicker) loadBacktest();
}

// ===== LOAD STOCK =====
async function loadStock(ticker) {
  currentTicker = ticker;
  $('header-ticker').textContent = ticker;

  // Reset UI
  setHeaderLoading();
  resetSignalGrid();

  try {
    const res = await fetch(`${API_BASE}/api/stock/${ticker}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Lỗi không xác định');
    }
    stockData = await res.json();

    updateHeader(stockData);
    updateKPIs(stockData);
    updateSignals(stockData);
    renderChartsWithTimeframe(currentTimeframe);

    showToast(`✅ Đã tải dữ liệu ${ticker} (${stockData.total_days} phiên)`, 'success');

    if ($('view-intraday').style.display === 'block') loadIntradayAndPutThrough(ticker);

  } catch (err) {
    showToast(`❌ Lỗi: ${err.message}`, 'error');
    console.error(err);
  }
}

// ===== UPDATE HEADER =====
function updateHeader(data) {
  const { analysis, last_date, ticker, support, resistance } = data;
  const { price, price_change, price_change_pct } = analysis;

  $('header-price').textContent = formatNumber(price, 2);
  const chEl = $('header-change');
  chEl.textContent = `${price_change >= 0 ? '+' : ''}${formatNumber(price_change, 2)} (${price_change_pct >= 0 ? '+' : ''}${formatNumber(price_change_pct, 2)}%)`;
  chEl.className = `header-change ${price_change >= 0 ? 'positive' : 'negative'}`;
  $('header-date').textContent = last_date;
  $('header-support').textContent = formatNumber(support, 2);
  $('header-resistance').textContent = formatNumber(resistance, 2);
}

function setHeaderLoading() {
  $('header-price').textContent = '--';
  $('header-change').textContent = '--';
  $('header-change').className = 'header-change';
}

// ===== UPDATE KPIs =====
function updateKPIs(data) {
  const { analysis } = data;
  const { price, price_change, price_change_pct, signals } = analysis;

  // Price KPI
  $('kpi-price').textContent = formatNumber(price, 2);
  const changeSub = $('kpi-change-sub');
  changeSub.textContent = `${price_change >= 0 ? '▲' : '▼'} ${formatNumber(Math.abs(price_change), 2)} (${formatNumber(Math.abs(price_change_pct), 2)}%)`;
  changeSub.className = `kpi-sub ${price_change >= 0 ? 'bull' : 'bear'}`;

  // MACD KPI
  const macdSig = signals.macd;
  if (macdSig) {
    $('kpi-macd').textContent = macdSig.label || '--';
    const macdSub = $('kpi-macd-sub');
    macdSub.textContent = `Val: ${formatNumber(macdSig.macd, 4)} | Sig: ${formatNumber(macdSig.signal_line, 4)}`;
    macdSub.className = `kpi-sub ${macdSig.signal === 'buy' ? 'bull' : macdSig.signal === 'sell' ? 'bear' : ''}`;
  }

  // Volume KPI
  const volSig = signals.volume;
  if (volSig) {
    const ratio = volSig.ratio || 1;
    $('kpi-volume').textContent = formatNumber(volSig.today / 1000, 0) + 'K';
    $('kpi-volume-sub').textContent = `×${formatNumber(ratio, 2)} so với TB20`;
    $('kpi-volume-sub').className = `kpi-sub ${ratio > 1.2 ? 'bull' : ratio < 0.7 ? 'bear' : ''}`;
  }

  // MA Trend KPI
  const maSig = signals.ma;
  if (maSig) {
    $('kpi-ma').textContent = maSig.label || '--';
    const maSub = $('kpi-ma-sub');
    maSub.textContent = `MA10: ${formatNumber(maSig.ma10, 2)} | MA50: ${formatNumber(maSig.ma50, 2) || 'N/A'}`;
    maSub.className = `kpi-sub ${maSig.signal === 'buy' ? 'bull' : maSig.signal === 'sell' ? 'bear' : ''}`;
  }
}

// ===== UPDATE SIGNALS =====
function updateSignals(data) {
  const { analysis } = data;
  const { signals, summary } = analysis;

  const signalMap = {
    'macd':   { label: 'MACD (12,26,9)', icon: 'fa-chart-line' },
    'ma':     { label: 'MA10 / MA50', icon: 'fa-lines-leaning' },
    'bb':     { label: 'Bollinger Bands', icon: 'fa-wave-square' },
    'volume': { label: 'Volume', icon: 'fa-cubes' }
  };

  let html = '';
  let buyCount = 0, sellCount = 0, neutralCount = 0;

  Object.entries(signalMap).forEach(([key, meta]) => {
    const sig = signals[key];
    if (!sig) return;
    const sType = sig.signal;
    const badgeClass = sType === 'buy' || sType === 'neutral_buy' ? 'buy' : sType === 'sell' ? 'sell' : sType === 'strong' ? 'strong' : 'neutral';
    if (sType === 'buy' || sType === 'neutral_buy') buyCount++;
    else if (sType === 'sell') sellCount++;
    else neutralCount++;
    html += `
      <div class="signal-row">
        <span class="signal-name"><i class="fa-solid ${meta.icon}" style="margin-right:6px;opacity:0.6;"></i>${meta.label}</span>
        <span class="signal-badge ${badgeClass}">${sig.label}</span>
      </div>`;
  });

  $('signal-grid').innerHTML = html;

  // Consensus Score
  const total = buyCount + sellCount + neutralCount;
  const scoreEl = $('consensus-score');
  scoreEl.textContent = `${buyCount}/${total}`;
  const rec = summary?.recommendation || (buyCount >= 3 ? 'MUA' : sellCount >= 3 ? 'BÁN' : 'CHỜ');
  scoreEl.className = `consensus-score ${rec === 'MUA' ? 'buy' : rec === 'BÁN' ? 'sell' : 'hold'}`;
  $('consensus-label').textContent = `Khuyến nghị: ${rec}`;
  $('consensus-fill').style.width = `${(buyCount / Math.max(total, 1)) * 100}%`;
  $('cnt-buy').textContent = buyCount;
  $('cnt-sell').textContent = sellCount;
  $('cnt-neutral').textContent = neutralCount;

  // Indicator values
  const maVal = signals.ma;
  const macdVal = signals.macd;
  const bbVal = signals.bb;
  if (maVal) {
    $('val-ma10').textContent = formatNumber(maVal.ma10, 2);
    $('val-ma50').textContent = formatNumber(maVal.ma50, 2);
  }
  if (macdVal) {
    $('val-macd').textContent = formatNumber(macdVal.macd, 4);
    $('val-signal').textContent = formatNumber(macdVal.signal_line, 4);
  }
  if (bbVal) {
    $('val-bb-upper').textContent = formatNumber(bbVal.upper, 2);
    $('val-bb-lower').textContent = formatNumber(bbVal.lower, 2);
  }
}

function resetSignalGrid() {
  $('signal-grid').innerHTML = Array(6).fill('<div class="signal-row shimmer" style="height:36px;border-radius:6px;"></div>').join('');
}

// ===== TIMEFRAME SELECTOR =====
function setTimeframe(tf) {
  currentTimeframe = tf;
  document.querySelectorAll('.tf-btn').forEach(b => {
    b.classList.toggle('active', b.id === `tf-${tf}`);
  });
  if (stockData) {
    renderChartsWithTimeframe(tf);
  }
}

function renderChartsWithTimeframe(tf) {
  if (!stockData) return;
  const filteredOhlcv = filterDataByTimeframe(stockData.ohlcv, tf);
  if (filteredOhlcv.length === 0) return;
  
  const startTime = filteredOhlcv[0].time;
  const tempStockData = {
    ...stockData,
    ohlcv: filteredOhlcv,
    series: {
      ma10: (stockData.series.ma10 || []).filter(d => d.time >= startTime),
      ma50: (stockData.series.ma50 || []).filter(d => d.time >= startTime),
      bb_upper: (stockData.series.bb_upper || []).filter(d => d.time >= startTime),
      bb_lower: (stockData.series.bb_lower || []).filter(d => d.time >= startTime),
      rsi: (stockData.series.rsi || []).filter(d => d.time >= startTime),
      macd: (stockData.series.macd || []).filter(d => d.time >= startTime),
      obv: (stockData.series.obv || []).filter(d => d.time >= startTime)
    }
  };
  
  drawMainChart(tempStockData);
}

function filterDataByTimeframe(ohlcv, timeframe) {
  if (!ohlcv || ohlcv.length === 0) return [];
  const lastItem = ohlcv[ohlcv.length - 1];
  const lastDate = new Date(lastItem.time * 1000);
  let startDate = new Date(lastDate);

  if (timeframe === '1n') startDate.setDate(lastDate.getDate() - 1);
  else if (timeframe === '5n') startDate.setDate(lastDate.getDate() - 5);
  else if (timeframe === '1p') startDate.setMonth(lastDate.getMonth() - 1);
  else if (timeframe === '3p') startDate.setMonth(lastDate.getMonth() - 3);
  else if (timeframe === '6p') startDate.setMonth(lastDate.getMonth() - 6);
  else if (timeframe === '1y') startDate.setFullYear(lastDate.getFullYear() - 1);
  else if (timeframe === '5y') startDate.setFullYear(lastDate.getFullYear() - 5);
  else if (timeframe === '10y') startDate.setFullYear(lastDate.getFullYear() - 10);

  const startTimestamp = Math.floor(startDate.getTime() / 1000);
  let filtered = ohlcv.filter(d => d.time >= startTimestamp);
  
  if (filtered.length < 10) {
    let limit = 30;
    if (timeframe === '1n') limit = 10;
    else if (timeframe === '5n') limit = 15;
    filtered = ohlcv.slice(-limit);
  }
  return filtered;
}

// ===== CHARTS =====
function drawMainChart(data) {
  const container = $('main-chart');
  container.innerHTML = '';

  const chartOptions = {
    layout: {
      background: { color: 'transparent' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: 'rgba(59,130,246,0.06)' },
      horzLines: { color: 'rgba(59,130,246,0.06)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
      borderColor: 'rgba(59,130,246,0.2)',
      minimumWidth: 80,
      scaleMargins: {
        top: 0.08,    // Chừa 8% phía trên cùng cho giá
        bottom: 0.38, // Chừa 38% phía dưới để làm khoảng trống vẽ chỉ báo dưới
      },
    },
    leftPriceScale: {
      borderColor: 'rgba(59,130,246,0.2)',
      visible: true,
      minimumWidth: 80,
      scaleMargins: {
        top: 0.70,    // Chỉ báo phụ sẽ vẽ ở vùng 70% đến 95% chiều cao đồ thị
        bottom: 0.05,
      },
    },
    timeScale: {
      borderColor: 'rgba(59,130,246,0.2)',
      timeVisible: true,
    },
    handleScroll: true,
    handleScale: true,
  };

  mainChart = LightweightCharts.createChart(container, {
    ...chartOptions,
    width: container.clientWidth,
    height: 470,
  });

  // Candlestick series
  const candleSeries = mainChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#10b981',
    downColor: '#ef4444',
    borderUpColor: '#10b981',
    borderDownColor: '#ef4444',
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444',
  });
  candleSeries.setData(data.ohlcv);

  // MA10
  if (data.series.ma10?.length) {
    const ma10 = mainChart.addSeries(LightweightCharts.LineSeries, { color: '#60a5fa', lineWidth: 1.5, priceLineVisible: false });
    ma10.setData(data.series.ma10);
  }

  // MA50
  if (data.series.ma50?.length) {
    const ma50 = mainChart.addSeries(LightweightCharts.LineSeries, { color: '#fbbf24', lineWidth: 1.5, priceLineVisible: false });
    ma50.setData(data.series.ma50);
  }

  // BB Upper
  if (data.series.bb_upper?.length) {
    const bbU = mainChart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(148,163,184,0.35)', lineWidth: 1, priceLineVisible: false, lineStyle: 2 });
    bbU.setData(data.series.bb_upper);
  }

  // BB Lower
  if (data.series.bb_lower?.length) {
    const bbL = mainChart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(148,163,184,0.35)', lineWidth: 1, priceLineVisible: false, lineStyle: 2 });
    bbL.setData(data.series.bb_lower);
  }

  // ===== VẼ CHỈ BÁO PHỤ (LỚP SCALE TRÁI - GỘP BIỂU ĐỒ) =====
  document.querySelectorAll('.sub-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase().includes(currentSubChart.toLowerCase()));
  });

  if (currentSubChart === 'rsi' && data.series.rsi?.length) {
    const rsiSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: '#06b6d4',
      lineWidth: 1.5,
      priceScaleId: 'left',
      priceLineVisible: false
    });
    rsiSeries.setData(data.series.rsi);

    // Vạch quá mua/bán (70/30) của RSI
    const obLine = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: 'rgba(239,68,68,0.3)',
      lineWidth: 1,
      priceScaleId: 'left',
      priceLineVisible: false,
      lineStyle: 1
    });
    obLine.setData(data.series.rsi.map(d => ({ time: d.time, value: 70 })));

    const osLine = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: 'rgba(16,185,129,0.3)',
      lineWidth: 1,
      priceScaleId: 'left',
      priceLineVisible: false,
      lineStyle: 1
    });
    osLine.setData(data.series.rsi.map(d => ({ time: d.time, value: 30 })));

  } else if (currentSubChart === 'macd' && data.series.macd?.length) {
    const macdLine = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: '#3b82f6',
      lineWidth: 1.5,
      priceScaleId: 'left',
      priceLineVisible: false
    });
    macdLine.setData(data.series.macd.map(d => ({ time: d.time, value: d.macd })));

    const signalLine = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: '#f59e0b',
      lineWidth: 1,
      priceScaleId: 'left',
      priceLineVisible: false
    });
    signalLine.setData(data.series.macd.map(d => ({ time: d.time, value: d.signal })));

    const histSeries = mainChart.addSeries(LightweightCharts.HistogramSeries, {
      color: '#10b981',
      priceScaleId: 'left',
      priceLineVisible: false,
    });
    histSeries.setData(data.series.macd.map(d => ({
      time: d.time,
      value: d.hist,
      color: d.hist >= 0 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'
    })));

  } else if (currentSubChart === 'obv' && data.series.obv?.length) {
    const obvSeries = mainChart.addSeries(LightweightCharts.LineSeries, {
      color: '#8b5cf6',
      lineWidth: 1.5,
      priceScaleId: 'left',
      priceLineVisible: false
    });
    obvSeries.setData(data.series.obv);
  }

  mainChart.timeScale().fitContent();

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (mainChart) mainChart.resize(container.clientWidth, 470);
  });
  ro.observe(container);
}

function setSubChart(type) {
  currentSubChart = type;
  if (stockData) {
    renderChartsWithTimeframe(currentTimeframe);
  }
}



// ===== BACK-TESTING =====
async function loadBacktest() {
  if (!currentTicker) { showToast('Vui lòng tìm kiếm mã cổ phiếu trước', 'error'); return; }
  
  const strategy = $('bt-strategy-select')?.value || 'macd_hist_bearish_surge';
  
  // Reset Stats elements
  ['3d', '5d', '10d', '20d'].forEach(p => {
    $(`bt-wr-${p}`).textContent = '...';
    $(`bt-ev-${p}`).textContent = '...';
  });
  $('bt-signals').textContent = '...';
  $('bt-summary-text').textContent = 'Đang chạy back-testing lịch sử...';
  $('backtest-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;"><div class="spinner"></div> Đang tính toán...</td></tr>';
  
  // Hide verdict card initially
  const verdictCard = $('bt-verdict-card');
  if (verdictCard) verdictCard.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/backtest/${currentTicker}?strategy=${strategy}`);
    const data = await res.json();

    if (!data.results || data.signals_found === 0) {
      $('backtest-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Không tìm thấy tín hiệu nào trong lịch sử.</td></tr>';
      $('bt-summary-text').textContent = data.message || 'Không có tín hiệu';
      return;
    }

    // Populate Stats Grid
    const stats = data.stats || {};
    const label1 = $('bt-label-1');
    const label2 = $('bt-label-2');
    const label3 = $('bt-label-3');
    const label4 = $('bt-label-4');

    if (strategy === 'optimal_induction') {
      // Thiết lập nhãn động cho chiến lược optimal_induction
      if (label1) label1.textContent = 'Tỷ lệ thắng động';
      if (label2) label2.textContent = 'Lợi nhuận TB thắng';
      if (label3) label3.textContent = 'Mức lỗ TB thua';
      if (label4) label4.textContent = 'Kỳ vọng toán học';

      // Ô 1: Tỷ lệ thắng động
      const wrVal = stats['win_rate_15d_dynamic'] || 0;
      const wrEl = $('bt-wr-3d');
      if (wrEl) {
        wrEl.textContent = `${formatNumber(wrVal, 1)}%`;
        wrEl.className = `stat-value ${wrVal >= 55 ? 'good' : wrVal >= 45 ? 'neutral' : 'bad'}`;
      }
      const evEl1 = $('bt-ev-3d');
      if (evEl1) {
        const evVal = stats['ev_15d_dynamic'] || 0;
        evEl1.textContent = `EV: ${evVal > 0 ? '+' : ''}${formatNumber(evVal, 2)}%`;
        evEl1.style.color = evVal > 0 ? 'var(--green)' : evVal < 0 ? 'var(--red)' : 'var(--text-muted)';
      }

      // Ô 2: Lợi nhuận TB thắng
      const winCount = stats['win_count_15d_dynamic'] || 0;
      const avgWin = stats['avg_win_15d_dynamic'] || 0;
      const valEl2 = $('bt-wr-5d');
      if (valEl2) {
        valEl2.textContent = `+${formatNumber(avgWin, 2)}%`;
        valEl2.className = 'stat-value good';
      }
      const subEl2 = $('bt-ev-5d');
      if (subEl2) {
        subEl2.textContent = `Thắng: ${formatNumber(winCount, 0)} lệnh`;
        subEl2.style.color = 'var(--text-muted)';
      }

      // Ô 3: Mức lỗ TB thua
      const lossCount = stats['loss_count_15d_dynamic'] || 0;
      const avgLoss = stats['avg_loss_15d_dynamic'] || 0;
      const valEl3 = $('bt-wr-10d');
      if (valEl3) {
        valEl3.textContent = `${formatNumber(avgLoss, 2)}%`;
        valEl3.className = 'stat-value bad';
      }
      const subEl3 = $('bt-ev-10d');
      if (subEl3) {
        subEl3.textContent = `Thua: ${formatNumber(lossCount, 0)} lệnh`;
        subEl3.style.color = 'var(--text-muted)';
      }

      // Ô 4: Kỳ vọng toán học (EV)
      const evVal = stats['ev_15d_dynamic'] || 0;
      const valEl4 = $('bt-wr-20d');
      if (valEl4) {
        valEl4.textContent = `${evVal > 0 ? '+' : ''}${formatNumber(evVal, 2)}%`;
        valEl4.className = `stat-value ${evVal > 0 ? 'good' : evVal < 0 ? 'bad' : 'neutral'}`;
      }
      const subEl4 = $('bt-ev-20d');
      if (subEl4) {
        subEl4.textContent = evVal > 0 ? '✅ Dương' : '❌ Âm';
        subEl4.style.color = evVal > 0 ? 'var(--green)' : 'var(--red)';
      }

    } else {
      // Trả lại nhãn cũ
      if (label1) label1.textContent = 'Sau 3 phiên (3d)';
      if (label2) label2.textContent = 'Sau 5 phiên (5d)';
      if (label3) label3.textContent = 'Sau 10 phiên (10d)';
      if (label4) label4.textContent = 'Sau 20 phiên (20d)';

      ['3d', '5d', '10d', '20d'].forEach(p => {
        const wrEl = $(`bt-wr-${p}`);
        const wrVal = stats[`win_rate_${p}`] || 0;
        if (wrEl) {
          wrEl.textContent = `${wrVal}%`;
          wrEl.className = `stat-value ${wrVal >= 55 ? 'good' : wrVal >= 45 ? 'neutral' : 'bad'}`;
        }

        const evEl = $(`bt-ev-${p}`);
        const evVal = stats[`ev_${p}`] || 0;
        if (evEl) {
          evEl.textContent = `EV: ${evVal > 0 ? '+' : ''}${evVal}%`;
          evEl.style.color = evVal > 0 ? 'var(--green)' : evVal < 0 ? 'var(--red)' : 'var(--text-muted)';
        }
      });
    }

    $('bt-signals').textContent = formatNumber(data.valid_signals, 0);

    // Build summary text
    const mainP = strategy === 'macd_hist_bearish_surge' ? '5d' : (strategy === 'optimal_induction' ? '15d_dynamic' : '10d');
    const labelP = strategy === 'optimal_induction' ? 'Động (15d)' : `đại diện (${mainP})`;
    const totalWins = stats[`win_count_${mainP}`] || 0;
    const totalLosses = stats[`loss_count_${mainP}`] || 0;
    const avgW = stats[`avg_win_${mainP}`] || 0;
    const avgL = stats[`avg_loss_${mainP}`] || 0;

    $('bt-summary-text').innerHTML = `
      <strong style="color:var(--text-primary);">${data.message}</strong><br/>
      Hiệu suất ${labelP}: 
      Thắng: <span style="color:var(--green);">${formatNumber(totalWins, 0)}</span> | 
      Thua: <span style="color:var(--red);">${formatNumber(totalLosses, 0)}</span> | 
      Avg Win: <span style="color:var(--green);">+${formatNumber(avgW, 2)}%</span> | 
      Avg Loss: <span style="color:var(--red);">${formatNumber(avgL, 2)}%</span>`;

    // Render Verdict Card
    if (verdictCard && data.verdict) {
      verdictCard.style.display = 'block';
      $('bt-verdict-text').textContent = data.verdict;
      
      const vClass = data.verdict_class || 'info';
      let bgColor = 'rgba(56, 189, 248, 0.08)';
      let border = '1px solid var(--blue-bright)';
      let color = 'var(--blue-bright)';
      let icon = '💡';
      
      if (vClass === 'success') {
        bgColor = 'rgba(16, 185, 129, 0.08)';
        border = '1px solid var(--green)';
        color = 'var(--green)';
        icon = '🏆';
      } else if (vClass === 'danger') {
        bgColor = 'rgba(244, 63, 94, 0.08)';
        border = '1px solid var(--red)';
        color = 'var(--red)';
        icon = '❌';
      } else if (vClass === 'warning') {
        bgColor = 'rgba(245, 158, 11, 0.08)';
        border = '1px solid var(--amber)';
        color = 'var(--amber)';
        icon = '⚠️';
      }
      
      verdictCard.style.backgroundColor = bgColor;
      verdictCard.style.border = border;
      verdictCard.style.color = color;
      $('bt-verdict-icon').textContent = icon;
    }

    // Build Table Body
    let tbody = '';
    
    // Sắp xếp các tín hiệu gần đây lên trước (đảo ngược mảng để xem tín hiệu mới nhất lên trên)
    const reversedResults = [...data.results].reverse();
    
    reversedResults.forEach(r => {
      // Xác định thắng thua dựa trên period chính của chiến lược
      let resultLabel = '';
      if (strategy === 'optimal_induction') {
        const status = r.trade_status || 'Đang giữ';
        const resVal = r.pct_result;
        if (status === 'Đang giữ') {
          resultLabel = '<span style="color:var(--text-muted);">⏳ Đang giữ</span>';
        } else {
          const isWin = resVal > 0;
          resultLabel = `<span class="${isWin ? 'text-green' : 'text-red'}" style="font-weight:600;">${isWin ? '✅' : '❌'} ${status} (${isWin ? '+' : ''}${formatNumber(resVal, 2)}%)</span>`;
        }
      } else {
        const targetPct = strategy === 'macd_hist_bearish_surge' ? r.pct_5d : r.pct_10d;
        if (targetPct === null || targetPct === undefined) {
          resultLabel = '<span style="color:var(--text-muted);">⏳ Chờ</span>';
        } else {
          resultLabel = targetPct > 0 
            ? '<span style="color:var(--green);">✅ Thắng</span>' 
            : '<span style="color:var(--red);">❌ Thua</span>';
        }
      }
      
      const fmtPct = v => v == null ? '--' : `<span class="${v >= 0 ? 'win' : 'loss'}">${v >= 0 ? '+' : ''}${formatNumber(v, 2)}%</span>`;
      
      let badgeLabel = '';
      if (strategy === 'macd_hist_bearish_surge') {
        badgeLabel = '<span style="background:rgba(239,68,68,0.15);color:var(--red);padding:2px 7px;border-radius:4px;font-size:11px;">🔴 Bearish Surge</span>';
      } else if (strategy === 'optimal_induction') {
        badgeLabel = '<span style="background:rgba(16,185,129,0.15);color:var(--green);padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700;"><i class="fa-solid fa-bolt" style="margin-right:3px;"></i>Pro V5 Squeezed</span>';
      } else if (strategy === 'weighted_score') {
        badgeLabel = `<span style="background:rgba(59,130,246,0.15);padding:2px 7px;border-radius:4px;font-size:11px;">${r.buy_signals} Mua</span>`;
      } else {
        badgeLabel = `<span style="background:rgba(148,163,184,0.15);padding:2px 7px;border-radius:4px;font-size:11px;">${r.buy_signals}</span>`;
      }

      tbody += `
        <tr>
          <td>${r.date}</td>
          <td class="font-mono">${formatNumber(r.entry_price, 2)}</td>
          <td>${badgeLabel}</td>
          <td>${fmtPct(r.pct_3d)}</td>
          <td>${fmtPct(r.pct_5d)}</td>
          <td>${fmtPct(r.pct_10d)}</td>
          <td>${fmtPct(r.pct_20d)}</td>
          <td>${resultLabel}</td>
        </tr>`;
    });
    $('backtest-tbody').innerHTML = tbody || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted);">Không có dữ liệu</td></tr>';

  } catch (err) {
    showToast(`Lỗi back-testing: ${err.message}`, 'error');
    $('backtest-tbody').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--red);">Lỗi: ${err.message}</td></tr>`;
  }
}



// ===== TOAST =====
function showToast(message, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `${icon} ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ===== INDUCTIVE RESEARCH (REMOVED) =====

// ===== REAL-TIME MARKET SCANNER =====
function toggleScannerThreshold() {
  const select = $('scanner-strategy-select');
  const wrap = $('scanner-threshold-wrap');
  if (select && wrap) {
    wrap.style.display = select.value === 'multi_signal_buy' ? 'flex' : 'none';
  }
}

function viewTickerFromScanner(ticker) {
  if (!ticker) return;
  $('ticker-input').value = ticker;
  switchTab('dashboard');
  loadStock(ticker);
}

async function runMarketScan() {
  const strategy = $('scanner-strategy-select').value;
  const thresholdInput = $('scanner-threshold-input');
  const threshold = thresholdInput ? parseInt(thresholdInput.value) || 3 : 3;
  
  const btn = $('btn-run-scan');
  const progressContainer = $('scanner-progress-container');
  const progressBar = $('scanner-progress-bar');
  const progressPercent = $('scanner-progress-percent');
  const progressStatus = $('scanner-progress-status');
  const tbody = $('scanner-tbody');
  const resultCount = $('scanner-result-count');
  
  // Reset UI và bật tiến trình
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Đang quét...';
  
  if (progressContainer) progressContainer.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressPercent) progressPercent.textContent = '0%';
  if (progressStatus) progressStatus.textContent = 'Bắt đầu gửi yêu cầu rà soát 50 cổ phiếu...';
  
  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align:center; padding:40px; color:var(--text-muted);">
        <div class="spinner" style="margin-bottom:10px; display:inline-block;"></div>
        <div style="font-size:13px; font-weight:500;">Đang quét toàn bộ thị trường...</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Hệ thống đang tải dữ liệu lịch sử và phân tích các chỉ báo kỹ thuật cho 50 mã chứng khoán hàng đầu Việt Nam.</div>
      </td>
    </tr>
  `;
  if (resultCount) resultCount.textContent = 'Tìm thấy: -- tín hiệu';
  
  // Chạy progress bar giả lập
  let progress = 0;
  const progressInterval = setInterval(() => {
    if (progress < 90) {
      // Tăng so le chậm dần để tạo trải nghiệm tự nhiên
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress > 90) progress = 90;
      if (progressBar) progressBar.style.width = `${progress}%`;
      if (progressPercent) progressPercent.textContent = `${progress}%`;
      
      if (progress < 30) {
        if (progressStatus) progressStatus.textContent = 'Đang kết nối API và lấy dữ liệu 50 mã...';
      } else if (progress < 60) {
        if (progressStatus) progressStatus.textContent = 'Đang tính toán các chỉ báo (MA10, MA50, MACD, Volume)...';
      } else {
        if (progressStatus) progressStatus.textContent = 'Đang rà soát tín hiệu mua theo chiến lược đã chọn...';
      }
    }
  }, 350);
  
  try {
    const res = await fetch(`${API_BASE}/api/scanner?strategy=${strategy}&threshold=${threshold}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Lỗi rà soát thị trường');
    }
    const data = await res.json();
    
    // Dừng giả lập và đẩy lên 100%
    clearInterval(progressInterval);
    if (progressBar) progressBar.style.width = '100%';
    if (progressPercent) progressPercent.textContent = '100%';
    if (progressStatus) progressStatus.textContent = 'Rà soát hoàn tất thành công!';
    
    // Render kết quả
    const results = data.results || [];
    if (resultCount) resultCount.textContent = `Tìm thấy: ${results.length} tín hiệu`;
    
    if (results.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding:45px; color:var(--text-muted);">
            <i class="fa-solid fa-circle-info" style="font-size:24px; margin-bottom:10px; display:block; color:var(--amber);"></i>
            Không có cổ phiếu nào đáp ứng điều kiện mua của chiến lược hiện tại.
            <div style="font-size:11px; margin-top:4px;">Bạn có thể đổi sang phong cách quét khác hoặc điều chỉnh ngưỡng đồng thuận thấp hơn và thử lại.</div>
          </td>
        </tr>
      `;
    } else {
      let html = '';
      results.forEach(item => {
        const isGreen = item.price_change >= 0;
        const changePctStr = formatNumber(item.price_change_pct, 2, true);
        const changeColorClass = isGreen ? 'win' : 'loss';
        
        // Tạo chuỗi mô tả phong cách và chi tiết tín hiệu
        let strategyLabel = '';
        let detailLabel = '';
        let recommendation = '';
        let recommendationClass = '';
        
        if (strategy === 'macd_hist_bearish_surge') {
          strategyLabel = '<span style="color:#f43f5e;font-weight:600;"><i class="fa-solid fa-chart-bar" style="margin-right:4px;"></i>MACD Histogram</span>';
          detailLabel = 'Histogram chuyển màu (Đỏ nhạt → Đỏ đậm) + Vol đột biến &ge; 1,1x TB20';
          recommendation = '🟢 MUA (Đảo chiều sớm)';
          recommendationClass = 'buy';
        } else {
          strategyLabel = '<span style="color:#8b5cf6;font-weight:600;"><i class="fa-solid fa-list-check" style="margin-right:4px;"></i>Đồng thuận chỉ báo</span>';
          
          const sigsList = Array.isArray(item.buy_signals) ? item.buy_signals : [];
          const sigsUpper = sigsList.map(s => s.toUpperCase()).join(', ');
          detailLabel = `<strong>${sigsList.length}/6</strong> chỉ báo BUY: <span style="color:var(--text-secondary); font-family:monospace;">(${sigsUpper})</span>`;
          
          if (sigsList.length >= 5) {
            recommendation = '🔥 MUA MẠNH (Tự tin Rất Cao)';
            recommendationClass = 'strong';
          } else if (sigsList.length >= 3) {
            recommendation = '🟢 MUA (Tự tin Trung bình)';
            recommendationClass = 'buy';
          } else {
            recommendation = '⚪ THEO DÕI';
            recommendationClass = 'neutral';
          }
        }
        
        html += `
          <tr>
            <td style="font-weight:bold; color:var(--text-primary); font-size:13px; font-family:'JetBrains Mono',monospace;">${item.ticker}</td>
            <td class="font-mono" style="font-weight:600;">${formatNumber(item.price, 2)}</td>
            <td class="font-mono ${changeColorClass}" style="font-weight:600;">${changePctStr}%</td>
            <td class="font-mono">${item.date}</td>
            <td>${strategyLabel}</td>
            <td>${detailLabel}</td>
            <td><span class="signal-badge ${recommendationClass}" style="font-size:11px; font-weight:700;">${recommendation}</span></td>
            <td style="text-align:center;">
              <button class="btn-analyze" onclick="viewTickerFromScanner('${item.ticker}')" style="padding:4px 10px; font-size:11px; border-radius:4px; box-shadow:none;">
                <i class="fa-solid fa-chart-line" style="margin-right:3px;"></i> Xem đồ thị
              </button>
            </td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }
    
    showToast(`✅ Đã rà soát xong 50 mã. Tìm thấy ${results.length} tín hiệu.`, 'success');
  } catch (err) {
    clearInterval(progressInterval);
    if (progressStatus) progressStatus.textContent = `Lỗi rà soát: ${err.message}`;
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:40px; color:var(--red);">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:24px; margin-bottom:10px; display:block;"></i>
          Lỗi: ${err.message}
          <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Vui lòng kiểm tra xem server backend có đang hoạt động tốt hay không.</div>
        </td>
      </tr>
    `;
    showToast(`❌ Lỗi rà soát: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Bắt đầu rà soát';
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
    }, 1500);
  }
}


// ===== GOOGLE DEEP RESEARCH =====
async function runDeepResearch() {
  const key = getGeminiKey();
  if (!key) { showToast('Vui lòng nhập Gemini API Key ở sidebar!', 'error'); return; }
  if (!stockData) { showToast('Vui lòng tìm kiếm mã cổ phiếu trước!', 'error'); return; }

  const btn = $('btn-run-deepsearch');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Đang nghiên cứu...';

  // Show status logger
  const statusWrap = $('ds-status-wrap');
  const statusText = $('ds-status-text');
  const statusSub = $('ds-status-sub');
  
  if (statusWrap) statusWrap.style.display = 'block';
  if (statusText) statusText.textContent = 'Khởi động tác vụ Deep Research...';
  if (statusSub) statusSub.textContent = 'Đang chuẩn bị kết nối dữ liệu...';

  const output = $('ds-output');
  output.className = 'ai-output streaming';
  output.innerHTML = '<div style="color:var(--blue-bright); margin-bottom:8px;"><div class="spinner" style="display:inline-block;margin-right:8px;border-top-color:var(--blue-bright);"></div>Đang tải dữ liệu tin tức...</div>';

  const sourcesWrap = $('ds-sources-wrap');
  const sourcesList = $('ds-sources-list');
  if (sourcesWrap) sourcesWrap.style.display = 'none';
  if (sourcesList) sourcesList.innerHTML = '';

  // Lấy chỉ báo hiện tại để đưa vào ngữ cảnh
  const { analysis, ticker, last_date, support, resistance } = stockData;
  const { price, price_change, price_change_pct, signals } = analysis;
  const macd = signals.macd || {};
  const ma = signals.ma || {};
  const bb = signals.bb || {};
  const vol = signals.volume || {};

  const mode = $('ds-mode').value || 'deep';

  // Tải tin tức từ backend CafeF scraper
  let newsList = [];
  try {
    if (statusText) statusText.textContent = 'Đang tải tin tức cổ phiếu...';
    if (statusSub) statusSub.textContent = 'Đang cào dữ liệu tin tức thời gian thực từ CafeF...';
    
    const newsRes = await fetch(`${API_BASE}/api/news/${ticker}`);
    if (newsRes.ok) {
      const newsData = await newsRes.json();
      if (newsData.status === 'success') {
        newsList = newsData.news || [];
      }
    }
  } catch (err_news) {
    console.warn("Lỗi cào tin tức ở backend:", err_news);
  }

  let newsContext = '';
  if (newsList.length > 0) {
    newsContext = newsList.map((item, idx) => {
      return `- Bài viết ${idx+1}: "${item.title}"\n  Nguồn/Link: ${item.url}\n  Tóm tắt (Sapo): ${item.sapo || 'Không có tóm tắt'}`;
    }).join('\n\n');
  } else {
    newsContext = 'Không tìm thấy tin tức trực tuyến mới nào gần đây của doanh nghiệp.';
  }

  const prompt = `Bạn là một Chuyên gia Phân tích Hành vi Giá & Dòng tiền Tạo lập (Market Maker / Smart Money Flow Analyst) với hơn 20 năm kinh nghiệm thực chiến tại thị trường chứng khoán Việt Nam.
Hãy thực hiện một báo cáo Nghiên cứu Chuyên sâu (Deep Research) về mã cổ phiếu ${ticker} tại thị trường chứng khoán Việt Nam.

Để hỗ trợ bạn, dưới đây là dữ liệu kỹ thuật hiện tại của cổ phiếu:
- Ngày cập nhật gần nhất: ${last_date}
- Giá đóng cửa gần đây nhất: ${price} (Thay đổi: ${price_change >= 0 ? '+' : ''}${price_change} / ${price_change_pct}%)
- Hỗ trợ: ${support} | Kháng cự: ${resistance}
- MA10: ${ma.ma10 || 'N/A'} | MA50: ${ma.ma50 || 'N/A'} | Xu hướng MA: ${ma.label || 'N/A'}
- MACD Line: ${macd.macd || 'N/A'} | Signal: ${macd.signal_line || 'N/A'} | Histogram: ${macd.histogram || 'N/A'}
- Bollinger Bands: BB Upper: ${bb.upper || 'N/A'} | BB Lower: ${bb.lower || 'N/A'}
- Volume hôm nay: ${vol.today ? (vol.today/1000).toFixed(0)+'K' : 'N/A'} | TB20: ${vol.ma20 ? (vol.ma20/1000).toFixed(0)+'K' : 'N/A'} (Tỷ lệ: ${vol.ratio || 'N/A'}x)

Hãy phân tích các tin tức nóng hổi thời gian thực liên quan đến cổ phiếu ${ticker} được cung cấp dưới đây để thực hiện báo cáo:

<tin_tuc_thi_truong>
${newsContext}
</tin_tuc_thi_truong>

Hãy viết một báo cáo cực kỳ thực chiến, chuyên nghiệp và có chiều sâu (tránh lý thuyết sáo rỗng) để phân tách rõ ràng các mục sau:

1. PHÂN TÍCH GIAO DỊCH TRONG PHIÊN & HÀNH VI TẠO LẬP (INTRADAY BEHAVIOR):
   Dựa trên biến động kỹ thuật và tin tức giao dịch thu thập được, hãy phân tích để người dùng nhìn ra dấu hiệu gom hàng hay xả hàng của dòng tiền lớn (Smart Money):
   - Phân tích các bất thường giao dịch trong phiên gần đây (nếu có): Khối lượng giao dịch đột biến tại các khung giờ cụ thể, cơ cấu mua/bán chủ động, chênh lệch cung cầu (Bid-Ask Spread).
   - Chỉ rõ các dấu hiệu GOM HÀNG (Accumulation) của tạo lập: Kìm giá đi ngang tích lũy, các nhịp "Ép bán - Rũ bỏ" (Shakeout) giảm sâu rồi rút chân nhanh trong phiên với volume lớn, hoặc có lệnh lớn gom hàng âm thầm bảo vệ các mốc hỗ trợ cứng.
   - Chỉ rõ các dấu hiệu XẢ HÀNG/KÉO XẢ (Distribution): Giá kéo tăng mạnh fomo đầu phiên nhưng bị bán cụt đầu cuối phiên hoặc sát ATC kèm volume lớn, dao động biên rộng vùng đỉnh nhưng không thể bứt phá, kê lệnh ảo bên mua để xả thẳng tay bên bán.

2. PHÂN TÍCH TIN ĐỒN & THÔNG TIN TÁC ĐỘNG (RUMORS & NEWS ANALYSIS):
   - Phân tích và đánh giá các đồn đoán, tin tức được cung cấp trong danh sách bài báo trên.
   - Liệt kê và phân tích tác động cụ thể thành 2 nhóm rõ ràng:
     * CÁC THÔNG TIN TIỀM NĂNG CÓ LỢI (Bullish Catalyst): như dự án mới được cấp phép, kế hoạch tăng vốn, kết quả kinh doanh quý tới ước đạt tích cực, có đối tác chiến lược...
     * CÁC THÔNG TIN TIỀM NĂNG CÓ HẠI (Bearish Catalyst): như vướng mắc pháp lý dự án, nợ vay quá lớn, tin đồn thanh tra, biến động nhân sự cấp cao...
   
3. TRIỂN VỌNG DÒNG TIỀN & PHƯƠNG ÁN GIAO DỊCH CHO DANH MỤC:
   - Tổng hợp đánh giá xem Dòng tiền tạo lập hiện tại đang nghiêng về xu thế tích lũy gom hàng tiếp tục hay đang phân phối thoát hàng.
   - Khuyến nghị cụ thể cho danh mục: [MUA/BÁN/THEO DÕI] kèm mức độ tin cậy.
   - Đưa ra kế hoạch hành động cụ thể để người dùng chủ động: Vùng giá gom an toàn, điểm cắt lỗ cứng để bảo vệ vốn, và các điểm chốt lời kỳ vọng.

YÊU CẦU TRÍCH NGUỒN CỤ THỂ (CITATIONS REQUIRED):
Với mỗi tin tức vĩ mô, đồn đoán rò rỉ, hay giao dịch bất thường được đưa ra trong báo cáo, bạn BẮT BUỘC phải ghi rõ nguồn trích dẫn lấy từ đâu (sử dụng chính xác tiêu đề và link URL của bài viết đã được cung cấp trong danh sách tin tức trên) và đặt đường link bài viết đó trực tiếp trong bài phân tích dưới dạng markdown [Tiêu đề bài viết](URL). Không tự tiện bịa đặt nguồn hoặc liên kết không tồn tại.

Hãy trả lời bằng tiếng Việt, rõ ràng và mạch lạc.`;

  const model = $('gemini-model-select').value || 'gemini-3.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;

  let updateLoggerInterval = null;
  let currentLogStepIndex = 0;
  const logSteps = [
    'Đang lập kế hoạch nghiên cứu & phân tích cú pháp...',
    'Đang phân tích cấu trúc tin tức & tin đồn doanh nghiệp...',
    'Đang bóc tách dữ liệu giao dịch trong phiên và cấu trúc lệnh...',
    'Đang tổng hợp thông tin và viết báo cáo chuyên sâu...',
  ];

  if (statusText) {
    statusText.textContent = `Deep Research — Bước 1/${logSteps.length + 1}`;
    statusSub.textContent = logSteps[0];
    
    updateLoggerInterval = setInterval(() => {
      if (currentLogStepIndex < logSteps.length - 1) {
        currentLogStepIndex++;
        statusText.textContent = `Deep Research — Bước ${currentLogStepIndex + 1}/${logSteps.length + 1}`;
        statusSub.textContent = logSteps[currentLogStepIndex];
      }
    }, 2800);
  }

  try {
    if (statusText) statusText.textContent = 'Đang gửi yêu cầu phân tích chuyên sâu cho AI...';
    if (statusSub) statusSub.textContent = 'Đang thiết lập kết nối luồng dữ liệu thời gian thực...';

    const response = await fetch(`${apiUrl}?key=${key}&alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Lỗi kết nối Gemini API');
    }

    clearInterval(updateLoggerInterval);
    if (statusText) statusText.textContent = 'Đang nhận báo cáo nghiên cứu tình báo...';
    if (statusSub) statusSub.textContent = 'Dòng dữ liệu đang được phân tích và hiển thị trực tiếp...';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    output.innerHTML = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const json = JSON.parse(line.slice(6));
            const part = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            fullText += part;
            
            output.innerHTML = marked.parse(fullText) + '<span class="pulse" style="display:inline-block;width:8px;height:14px;background:var(--blue-bright);border-radius:2px;margin-left:2px;vertical-align:middle;"></span>';
            output.scrollTop = output.scrollHeight;
          } catch {}
        }
      }
    }

    output.innerHTML = marked.parse(fullText);
    
    if (statusWrap) statusWrap.style.display = 'none';

    // Hiển thị nguồn trích dẫn từ CafeF đã cào được
    if (newsList.length > 0) {
      if (sourcesWrap) sourcesWrap.style.display = 'block';
      if (sourcesList) {
        sourcesList.innerHTML = '';
        newsList.forEach(item => {
          const aTag = document.createElement('a');
          aTag.className = 'source-item';
          aTag.href = item.url;
          aTag.target = '_blank';
          aTag.title = item.title;
          
          let domain = 'CafeF';
          try {
            domain = new URL(item.url).hostname.replace('www.', '');
          } catch {}

          aTag.innerHTML = `
            <i class="fa-solid fa-file-invoice-dollar"></i>
            <span class="source-title">${item.title}</span>
            <span class="source-domain">${domain}</span>
          `;
          sourcesList.appendChild(aTag);
        });
      }
    } else {
      if (sourcesWrap) sourcesWrap.style.display = 'none';
    }

    showToast('✅ Đã hoàn thành Deep Research!', 'success');

  } catch (err) {
    clearInterval(updateLoggerInterval);
    if (statusWrap) statusWrap.style.display = 'none';
    output.innerHTML = `<div style="color:var(--red);padding:14px;background:rgba(239,68,68,0.08);border-radius:6px;font-size:12.5px;line-height:1.5;">
      ❌ <strong>Lỗi thực hiện Deep Research:</strong> ${err.message}<br/>
      <small style="color:var(--text-muted);display:block;margin-top:4px;">Hãy kiểm tra lại API Key, model đang chọn và kết nối mạng.</small>
    </div>`;
    showToast(`Lỗi: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-brain"></i> Bắt đầu nghiên cứu';
  }
}


// ===== INTRADAY & PUT-THROUGH LOGIC =====
let intradayData = null;
let putthroughData = null;

async function loadIntradayAndPutThrough(ticker) {
  if (!ticker) return;
  
  // Set loading states
  $('intra-kpi-vol').textContent = '...';
  $('intra-kpi-val').textContent = 'Giá trị: ...';
  $('intra-kpi-buy-vol').textContent = '...';
  $('intra-kpi-buy-val').textContent = 'Giá trị: ...';
  $('intra-kpi-sell-vol').textContent = '...';
  $('intra-kpi-sell-val').textContent = 'Giá trị: ...';
  $('intra-kpi-net-vol').textContent = '...';
  $('intra-kpi-net-val').textContent = 'Net value: ...';
  $('intra-flow-buy-pct').textContent = '0%';
  $('intra-flow-sell-pct').textContent = '0%';
  $('intra-flow-bar').style.width = '50%';
  $('intra-flow-verdict').textContent = 'Đang phân tích cấu trúc dòng tiền...';
  $('intra-shark-count').textContent = 'Khớp: ...';
  $('intra-shark-buy').textContent = '...';
  $('intra-shark-sell').textContent = '...';
  $('intra-shark-net').textContent = '...';
  $('intra-shark-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px;"><div class="spinner"></div> Đang tải dữ liệu khớp lệnh...</td></tr>';
  $('intra-putthrough-count').textContent = 'Tìm thấy: ...';
  $('intra-putthrough-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px;"><div class="spinner"></div> Đang tải giao dịch thỏa thuận...</td></tr>';

  try {
    // 1. Tải Intraday
    const intraRes = await fetch(`${API_BASE}/api/stock/${ticker}/intraday`);
    if (intraRes.ok) {
      intradayData = await intraRes.json();
      renderIntradayData(intradayData);
    } else {
      throw new Error("Không thể kết nối API Intraday");
    }

    // 2. Tải Put-through
    const ptRes = await fetch(`${API_BASE}/api/stock/${ticker}/put-through`);
    if (ptRes.ok) {
      putthroughData = await ptRes.json();
      renderPutthroughData(putthroughData);
    } else {
      throw new Error("Không thể kết nối API Put-through");
    }
    
    showToast(`✅ Đã cập nhật dòng tiền & thỏa thuận cho ${ticker}`, 'success');
  } catch (err) {
    showToast(`❌ Lỗi tải dữ liệu trong phiên: ${err.message}`, 'error');
    $('intra-shark-tbody').innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--red); padding:20px;">Lỗi: ${err.message}</td></tr>`;
    $('intra-putthrough-tbody').innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--red); padding:20px;">Lỗi: ${err.message}</td></tr>`;
  }
}

function renderIntradayData(data) {
  if (data.total_rows === 0 || !data.summary) {
    $('intra-shark-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:var(--text-muted);">Không có dữ liệu khớp lệnh trong phiên hôm nay.</td></tr>';
    $('intra-flow-verdict').textContent = 'Chưa có giao dịch khớp lệnh.';
    return;
  }

  const s = data.summary;
  const shark = data.shark_stats;

  // Cập nhật KPIs
  $('intra-kpi-vol').textContent = formatNumber(s.total_volume, 0);
  $('intra-kpi-val').textContent = `Giá trị: ${formatNumber(s.total_value, 0)} VNĐ`;
  
  $('intra-kpi-buy-vol').textContent = formatNumber(s.buy_active_volume, 0);
  $('intra-kpi-buy-val').textContent = `Giá trị: ${formatNumber(s.buy_active_value, 0)} VNĐ`;
  
  $('intra-kpi-sell-vol').textContent = formatNumber(s.sell_active_volume, 0);
  $('intra-kpi-sell-val').textContent = `Giá trị: ${formatNumber(s.sell_active_value, 0)} VNĐ`;
  
  const netVol = s.net_active_volume;
  const netVal = s.net_active_value;
  const netEl = $('intra-kpi-net-vol');
  netEl.textContent = `${netVol >= 0 ? '+' : ''}${formatNumber(netVol, 0)}`;
  netEl.className = `kpi-value ${netVol >= 0 ? 'text-green' : 'text-red'}`;
  $('intra-kpi-net-val').textContent = `Net value: ${netVal >= 0 ? '+' : ''}${formatNumber(netVal, 0)} VNĐ`;

  // Cập nhật Flow Bar Tương quan
  const buyPct = Math.round((s.buy_active_volume / Math.max(s.buy_active_volume + s.sell_active_volume, 1)) * 100);
  const sellPct = 100 - buyPct;
  $('intra-flow-buy-pct').textContent = `${buyPct}%`;
  $('intra-flow-sell-pct').textContent = `${sellPct}%`;
  $('intra-flow-bar').style.width = `${buyPct}%`;

  // Verdict Dòng tiền
  let verdictText = '';
  if (buyPct >= 58) {
    verdictText = '🔥 Dòng tiền chủ động đang GOM HÀNG quyết liệt (Lực mua áp đảo hoàn toàn)';
  } else if (buyPct >= 52) {
    verdictText = '🟢 Dòng tiền chủ động nghiêng nhẹ về bên MUA (Tích lũy chủ động)';
  } else if (buyPct >= 48) {
    verdictText = '⚪ Trạng thái cân bằng cung cầu (Sideway đi ngang)';
  } else if (buyPct >= 42) {
    verdictText = '🔴 Dòng tiền chủ động nghiêng về bên BÁN (Áp lực phân phối nhẹ)';
  } else {
    verdictText = '💥 Lực xả hàng chủ động cực mạnh (Phân phối thoát hàng quyết liệt)';
  }
  $('intra-flow-verdict').innerHTML = `<strong style="color:var(--text-primary);">${verdictText}</strong>`;

  // Cập nhật Shark Stats
  $('intra-shark-count').textContent = `Khớp: ${shark.total_shark_orders} lệnh`;
  $('intra-shark-buy').textContent = formatNumber(shark.shark_buy_volume, 0);
  $('intra-shark-sell').textContent = formatNumber(shark.shark_sell_volume, 0);
  
  const sharkNetVol = shark.shark_net_volume;
  const sharkNetEl = $('intra-shark-net');
  sharkNetEl.textContent = `${sharkNetVol >= 0 ? '+' : ''}${formatNumber(sharkNetVol, 0)} CP (${shark.shark_net_value >= 0 ? '+' : ''}${formatNumber(shark.shark_net_value, 0)} VNĐ)`;
  sharkNetEl.className = sharkNetVol >= 0 ? 'text-green' : 'text-red';

  // Render Shark Table
  const orders = data.large_orders || [];
  if (orders.length === 0) {
    $('intra-shark-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center; padding:35px; color:var(--text-muted);">Không phát hiện lệnh khớp quy mô lớn (Cá mập) nào trong phiên.</td></tr>';
  } else {
    let html = '';
    orders.forEach(o => {
      const isBuy = o.type === 'buy';
      html += `
        <tr style="background:${isBuy ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)'};">
          <td class="font-mono">${o.time}</td>
          <td class="font-mono" style="font-weight:600;">${formatNumber(o.price, 2)}</td>
          <td class="font-mono ${isBuy ? 'text-green' : 'text-red'}" style="font-weight:700;">${formatNumber(o.volume, 0)}</td>
          <td class="font-mono">${formatNumber(o.value, 0)}</td>
          <td><span class="signal-badge ${isBuy ? 'buy' : 'sell'}" style="font-size:10px; padding:2px 6px;">${isBuy ? 'MUA CHỦ ĐỘNG' : 'BÁN CHỦ ĐỘNG'}</span></td>
        </tr>
      `;
    });
    $('intra-shark-tbody').innerHTML = html;
  }
}

function renderPutthroughData(data) {
  const trades = data.trades || [];
  $('intra-putthrough-count').textContent = `Tìm thấy: ${trades.length} GD`;

  if (trades.length === 0) {
    $('intra-putthrough-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">Không có giao dịch thỏa thuận nào của cổ phiếu này trong ngày hôm nay.</td></tr>';
  } else {
    let html = '';
    trades.forEach(t => {
      let badgeClass = 'badge-success';
      if (t.status.includes('Đáng ngờ')) badgeClass = 'badge-danger';
      else if (t.status.includes('Bất thường')) badgeClass = 'badge-warning';

      const diffSign = t.diff_pct >= 0 ? '+' : '';
      const diffColor = t.diff_pct > 0 ? 'text-green' : t.diff_pct < 0 ? 'text-red' : 'var(--text-muted)';

      html += `
        <tr>
          <td class="font-mono">${t.time}</td>
          <td class="font-mono" style="font-weight:600;">${formatNumber(t.price, 2)}</td>
          <td class="font-mono" style="font-weight:600;">${formatNumber(t.volume, 0)}</td>
          <td class="font-mono" style="color:var(--text-secondary);">${formatNumber(t.value, 0)}</td>
          <td class="font-mono ${diffColor}" style="font-weight:600;">${diffSign}${t.diff_pct}%</td>
          <td>
            <span class="${badgeClass}" title="Lý do: ${t.anomaly_reason}">${t.status}</span>
          </td>
        </tr>
      `;
    });
    $('intra-putthrough-tbody').innerHTML = html;
  }
}

function refreshIntradayData() {
  if (currentTicker) {
    loadIntradayAndPutThrough(currentTicker);
  } else {
    showToast('Vui lòng tìm kiếm mã cổ phiếu trước!', 'error');
  }
}

// ===== WINDOW RESIZE =====
window.addEventListener('resize', () => {
  const mc = $('main-chart');
  if (mainChart && mc) mainChart.resize(mc.clientWidth, 470);
});

