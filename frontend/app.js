/**
 * app.js — Logic Frontend cho StockAI
 * Tích hợp: Backend API + TradingView Charts + Gemini API Streaming
 */

const API_BASE = 'https://tim-co-hoi-train-ngan-han.onrender.com';

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
  const saved = localStorage.getItem('gemini_api_key');
  if (saved) {
    inp.value = saved;
    dot.classList.add('active');
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
  return ($('gemini-key-input').value || '').trim();
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
  const views = ['dashboard', 'candle', 'ai', 'backtest'];
  views.forEach(v => {
    $(`view-${v}`).style.display = v === tab ? 'block' : 'none';
    $(`tab-${v}`).classList.toggle('active', v === tab);
    $(`nav-${v}`)?.classList.toggle('active', v === tab);
  });
  if (tab === 'candle' && currentTicker && !candleData) loadCandle(currentTicker);
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

    // Auto reload candle if tab is open
    candleData = null;
    if ($('view-candle').style.display === 'block') loadCandle(ticker);

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

// ===== CANDLESTICK PATTERNS =====
async function loadCandle(ticker) {
  $('candle-patterns').innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:30px;"><div class="spinner"></div><br/>Đang phân tích nến...</div>';
  try {
    const res = await fetch(`${API_BASE}/api/candle/${ticker}`);
    candleData = await res.json();
    renderCandlePatterns(candleData);
    renderRecentCandles(candleData);
  } catch (err) {
    $('candle-patterns').innerHTML = `<div style="color:var(--red);text-align:center;padding:20px;">Lỗi: ${err.message}</div>`;
  }
}

function renderCandlePatterns(data) {
  const { patterns } = data;
  let html = '';
  patterns.forEach(p => {
    const confClass = p.confidence === 'Cao' ? 'conf-high' : p.confidence === 'Trung bình' ? 'conf-mid' : 'conf-low';
    html += `
      <div class="pattern-card">
        <div class="pattern-emoji">${p.emoji}</div>
        <div>
          <div class="pattern-name ${p.type}">${p.name}</div>
          <div class="pattern-desc">${p.description}</div>
          <span class="pattern-confidence ${confClass}">Độ tin cậy: ${p.confidence}</span>
        </div>
      </div>`;
  });
  $('candle-patterns').innerHTML = html;
}

function renderRecentCandles(data) {
  const { recent_candles } = data;
  let html = `<div style="display:flex;flex-direction:column;gap:8px;">`;
  recent_candles.forEach(c => {
    const isGreen = c.close >= c.open;
    html += `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-input);border-radius:6px;border:1px solid var(--border);">
        <span style="width:12px;height:12px;border-radius:3px;background:${isGreen ? 'var(--green)' : 'var(--red)'};flex-shrink:0;"></span>
        <div style="flex:1;">
          <div style="font-size:12px;color:var(--text-secondary);">${c.date} — <span class="font-mono" style="color:${isGreen ? 'var(--green)' : 'var(--red)'};">${c.description}</span></div>
          <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">O:${formatNumber(c.open, 2)} H:${formatNumber(c.high, 2)} L:${formatNumber(c.low, 2)} C:${formatNumber(c.close, 2)} | Vol:${formatNumber(c.volume/1000, 0)}K</div>
        </div>
      </div>`;
  });
  html += '</div>';
  $('recent-candles-body').innerHTML = html;
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

// ===== AI ANALYSIS — GEMINI =====
function buildPrompt() {
  if (!stockData) return '';
  const { analysis, ticker, last_date, support, resistance } = stockData;
  const { price, price_change, price_change_pct, signals } = analysis;
  const macd = signals.macd || {};
  const ma = signals.ma || {};
  const bb = signals.bb || {};
  const vol = signals.volume || {};

  return `Bạn là Chuyên gia Phân tích Kỹ thuật Cổ phiếu cấp cao (Senior Technical Analyst) với hơn 15 năm kinh nghiệm tại thị trường chứng khoán Việt Nam. 
HÃY VIẾT PHÂN TÍCH CỰC KỲ CÔ ĐỌNG, đi thẳng vào số liệu thực tế của cổ phiếu, không giải thích lý thuyết các chỉ báo kỹ thuật. Giới hạn phân tích mỗi bước từ 1 đến 6 trong tối đa 3 câu ngắn gọn nhưng cực kỳ chuyên sâu và chính xác. Điều này để đảm bảo câu trả lời đầy đủ, không bị cắt cụt.

## DỮ LIỆU CỔ PHIẾU

<stock_info>
Mã: ${ticker} | Ngày: ${last_date}
Giá đóng cửa: ${price} | Thay đổi: ${price_change >= 0 ? '+' : ''}${price_change} (${price_change_pct}%)
Hỗ trợ: ${support} | Kháng cự: ${resistance}
</stock_info>

<indicators>
MA10: ${ma.ma10 || 'N/A'} | MA50: ${ma.ma50 || 'N/A'} | Xu hướng MA: ${ma.label || 'N/A'}
MACD Line: ${macd.macd || 'N/A'} | Signal: ${macd.signal_line || 'N/A'} | Histogram: ${macd.histogram || 'N/A'} → ${macd.label || 'N/A'}
BB Upper: ${bb.upper || 'N/A'} | BB Middle: ${bb.middle || 'N/A'} | BB Lower: ${bb.lower || 'N/A'} | BW: ${bb.bandwidth || 'N/A'}% → ${bb.label || 'N/A'}
Volume hôm nay: ${vol.today ? (vol.today/1000).toFixed(0)+'K' : 'N/A'} | TB20: ${vol.ma20 ? (vol.ma20/1000).toFixed(0)+'K' : 'N/A'} | Tỷ lệ: ${vol.ratio || 'N/A'}× → ${vol.label || 'N/A'}
</indicators>

## NHIỆM VỤ — PHÂN TÍCH 7 BƯỚC

Kết thúc mỗi bước bằng: **→ Tín hiệu: [🟢 Tích cực / 🔴 Tiêu cực / ⚪ Trung lập] — Lý do 1 câu ngắn**

**BƯỚC 1 — Giá & Xu hướng:** Xác định Uptrend/Downtrend/Sideway, vùng S/R gần nhất, cấu trúc giá (Higher High / Lower High).

**BƯỚC 2 — Mô hình Nến Nhật:** Nhận diện mô hình nến 3-5 phiên gần nhất, đánh giá độ tin cậy (vị trí S/R + volume).

**BƯỚC 3 — Phân tích Volume:** So sánh với TB20, nhận định Tích lũy hay Phân phối.

**BƯỚC 4 — MA10 & MA50:** Vị trí giá so với MA, Golden/Death Cross, khoảng cách mean reversion.

**BƯỚC 5 — MACD:** Vị trí Line vs Signal, momentum histogram, phân kỳ MACD-Giá.

**BƯỚC 6 — Bollinger Bands:** Vị trí trong dải, Squeeze (bandwidth <5%), nguy cơ breakout.

**BƯỚC 7 — Bảng đồng thuận chỉ báo:** Lập bảng 4 chỉ báo (MACD, MA, BB, Volume) × [🟢/🔴/⚪] với độ trễ so với giá, kết luận tổng hợp.

## KẾT LUẬN & PHƯƠNG ÁN GIAO DỊCH

Đưa ra bảng 3 kịch bản (Markdown table):
| Kịch bản | Điều kiện | Hành động | Vào lệnh | SL | TP1 | TP2 | R:R |

**KHUYẾN NGHỊ:** [MUA/BÁN/CHỜ] — Mức độ tự tin: [Cao/Trung bình/Thấp]

Trả lời bằng **tiếng Việt**, rõ ràng, chuyên nghiệp. Nếu thiếu dữ liệu, ghi "⚠️ Cần bổ sung" thay vì suy đoán.`;
}

async function runAIAnalysis() {
  const key = getGeminiKey();
  if (!key) { showToast('Vui lòng nhập Gemini API Key ở sidebar!', 'error'); return; }
  if (!stockData) { showToast('Vui lòng tìm kiếm mã cổ phiếu trước!', 'error'); return; }

  const btn = $('btn-analyze');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Đang phân tích...';

  const output = $('ai-output');
  output.className = 'ai-output streaming';
  output.innerHTML = '<div style="color:var(--blue-bright); margin-bottom:8px;"><div class="spinner" style="display:inline-block;margin-right:8px;"></div>Gemini đang phân tích 7 bước...</div>';

  const prompt = buildPrompt();
  const model = $('gemini-model-select').value || 'gemini-3.5-flash';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;

  try {
    const response = await fetch(`${apiUrl}?key=${key}&alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Lỗi Gemini API');
    }

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
            output.innerHTML = marked.parse(fullText) + '<span class="pulse" style="display:inline-block;width:8px;height:14px;background:var(--blue);border-radius:2px;margin-left:2px;vertical-align:middle;"></span>';
            output.scrollTop = output.scrollHeight;
          } catch {}
        }
      }
    }

    output.innerHTML = marked.parse(fullText);
    showToast('✅ Phân tích AI hoàn tất!', 'success');

  } catch (err) {
    output.innerHTML = `<div style="color:var(--red);padding:10px;background:rgba(239,68,68,0.08);border-radius:6px;">
      ❌ <strong>Lỗi Gemini API:</strong> ${err.message}<br/>
      <small style="color:var(--text-muted);">Kiểm tra lại API Key và kết nối internet.</small>
    </div>`;
    showToast(`Lỗi: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-sparkles"></i> Phân tích toàn diện';
  }
}

function markdownToHtml(md) {
  return md
    .replace(/^## (.*$)/gim, '<h3 style="color:var(--blue-bright);margin:14px 0 6px;font-size:13px;border-bottom:1px solid var(--border);padding-bottom:4px;">$1</h3>')
    .replace(/^### (.*$)/gim, '<h4 style="color:var(--text-primary);margin:10px 0 4px;font-size:12px;">$1</h4>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
    .replace(/🟢/g, '<span class="text-green">🟢</span>')
    .replace(/🔴/g, '<span class="text-red">🔴</span>')
    .replace(/→ Tín hiệu:/g, '<br/><span style="color:var(--amber);">→ Tín hiệu:</span>')
    .replace(/^\| (.*)/gim, (match) => {
      if (match.includes('---')) return '';
      const cells = match.split('|').filter(c => c.trim());
      const isHeader = /Kịch bản|BƯỚC|Chỉ báo/.test(cells[0]);
      const tag = isHeader ? 'th' : 'td';
      return `<tr>${cells.map(c => `<${tag} style="padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;">${c.trim()}</${tag}>`).join('')}</tr>`;
    })
    .replace(/(<tr>.*<\/tr>)/gms, (m) => {
      if (!m.includes('<table>')) return `<div style="overflow-x:auto;margin:8px 0;"><table style="width:100%;border-collapse:collapse;font-size:12px;background:var(--bg-input);border-radius:6px;overflow:hidden;">${m}</table></div>`;
      return m;
    })
    .replace(/^- (.*$)/gim, '<div style="padding:2px 0 2px 12px;border-left:2px solid var(--blue);margin:3px 0;font-size:12.5px;color:var(--text-secondary);">$1</div>')
    .replace(/\n\n/g, '<br/>')
    .replace(/\n/g, '<br/>');
}

function copyPrompt() {
  const prompt = buildPrompt();
  if (!prompt) { showToast('Tìm kiếm mã cổ phiếu trước!', 'error'); return; }
  navigator.clipboard.writeText(prompt).then(() => {
    showToast('✅ Đã copy prompt vào clipboard!', 'success');
  });
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

// ===== WINDOW RESIZE =====
window.addEventListener('resize', () => {
  const mc = $('main-chart');
  if (mainChart && mc) mainChart.resize(mc.clientWidth, 470);
});

