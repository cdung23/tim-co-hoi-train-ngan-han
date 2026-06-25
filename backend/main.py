"""
main.py — FastAPI Backend Server
Endpoints:
  GET /api/stock/{ticker}    → OHLCV + tất cả chỉ báo kỹ thuật
  GET /api/candle/{ticker}   → Nhận diện nến Nhật 5 phiên gần nhất
  GET /api/backtest/{ticker} → Back-testing 15 tháng
  GET /health                → Health check
"""

import sys
import io

# Cấu hình UTF-8 cho stdout/stderr để tránh lỗi UnicodeEncodeError trên terminal Windows
if sys.platform == "win32":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    except Exception:
        pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
import pandas as pd
import traceback

from indicators import calc_all_indicators, get_support_resistance
from candlestick import detect_patterns, get_recent_candles_description
from backtest import run_backtest

app = FastAPI(
    title="Stock Technical Analysis API",
    description="API phân tích kỹ thuật cổ phiếu VN — VNStock + FastAPI",
    version="1.0.0"
)

# CORS — Cho phép frontend gọi từ browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def fetch_ohlcv_kbs(ticker: str, months: int = 120) -> pd.DataFrame:
    """Gọi trực tiếp API của KB Securities không qua vnstock wrapper để tránh Rate Limit"""
    import requests
    from datetime import datetime, timedelta
    import pandas as pd
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=months * 31)
    
    sdate = start_date.strftime('%d-%m-%Y')
    edate = end_date.strftime('%d-%m-%Y')
    
    url = f"https://kbbuddywts.kbsec.com.vn/iis-server/investment/stocks/{ticker.upper()}/data_day"
    params = {
        "sdate": sdate,
        "edate": edate
    }
    headers = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    
    res = requests.get(url, params=params, headers=headers, timeout=15)
    if res.status_code != 200:
        raise ValueError(f"KBS API returned status code {res.status_code}")
        
    json_data = res.json()
    if "data_day" not in json_data:
        raise ValueError(f"Invalid response from KBS: {json_data}")
        
    raw_data = json_data["data_day"]
    if not raw_data:
        raise ValueError(f"No data returned for {ticker}")
        
    # Convert to DataFrame
    df = pd.DataFrame(raw_data)
    df = df.rename(columns={
        't': 'time',
        'o': 'open',
        'h': 'high',
        'l': 'low',
        'c': 'close',
        'v': 'volume'
    })
    
    # Chuẩn hóa kiểu dữ liệu và chia giá cho 1000
    df['time'] = pd.to_datetime(df['time'])
    df['open'] = df['open'] / 1000.0
    df['high'] = df['high'] / 1000.0
    df['low'] = df['low'] / 1000.0
    df['close'] = df['close'] / 1000.0
    df['volume'] = df['volume'].astype(int)
    
    df = df[['time', 'open', 'high', 'low', 'close', 'volume']].dropna()
    df = df.sort_values('time').reset_index(drop=True)
    return df


def fetch_ohlcv(ticker: str, months: int = 120) -> pd.DataFrame:
    """Lấy dữ liệu OHLCV từ VNStock với cơ chế fallback nếu số tháng yêu cầu bị lỗi"""
    last_err = None
    
    # 1. Thử gọi trực tiếp API KBS (Không bị giới hạn Rate Limit, cực kỳ nhanh)
    try:
        df = fetch_ohlcv_kbs(ticker, months)
        if df is not None and not df.empty:
            return df
    except Exception as e_direct_kbs:
        last_err = e_direct_kbs
        
    # Fallback sang cách gọi qua vnstock wrapper nếu gọi trực tiếp thất bại
    test_months = [months]
    for m in [60, 36, 15]:
        if m not in test_months and m < months:
            test_months.append(m)
            
    for m in test_months:
        try:
            # 1. Thử nguồn KBS (Không bị giới hạn Rate Limit, cực kỳ ổn định)
            try:
                from vnstock.api.quote import Quote
                q = Quote(symbol=ticker.upper(), source='kbs')
                end_date = datetime.now().strftime('%Y-%m-%d')
                start_date = (datetime.now() - timedelta(days=m * 31)).strftime('%Y-%m-%d')
                df = q.history(start=start_date, end=end_date, interval='1D')
                if df is not None and not df.empty:
                    # Chuẩn hóa cột
                    col_map = {}
                    for col in df.columns:
                        cl = col.lower()
                        if 'open' in cl: col_map[col] = 'open'
                        elif 'high' in cl: col_map[col] = 'high'
                        elif 'low' in cl: col_map[col] = 'low'
                        elif 'close' in cl: col_map[col] = 'close'
                        elif 'volume' in cl or 'vol' in cl: col_map[col] = 'volume'
                        elif 'time' in cl or 'date' in cl: col_map[col] = 'time'
                    df = df.rename(columns=col_map)
                    df['time'] = pd.to_datetime(df['time'])
                    df = df[['time', 'open', 'high', 'low', 'close', 'volume']].dropna()
                    df = df.sort_values('time').reset_index(drop=True)
                    return df
            except Exception as e_kbs:
                last_err = e_kbs
                
            # 2. Dự phòng 1: Thử vnstock v4.0+ VCI
            try:
                from vnstock.api.quote import Quote
                q = Quote(symbol=ticker.upper(), source='VCI')
                end_date = datetime.now().strftime('%Y-%m-%d')
                start_date = (datetime.now() - timedelta(days=m * 31)).strftime('%Y-%m-%d')
                df = q.history(start=start_date, end=end_date, interval='1D')
                if df is not None and not df.empty:
                    col_map = {}
                    for col in df.columns:
                        cl = col.lower()
                        if 'open' in cl: col_map[col] = 'open'
                        elif 'high' in cl: col_map[col] = 'high'
                        elif 'low' in cl: col_map[col] = 'low'
                        elif 'close' in cl: col_map[col] = 'close'
                        elif 'volume' in cl or 'vol' in cl: col_map[col] = 'volume'
                        elif 'time' in cl or 'date' in cl: col_map[col] = 'time'
                    df = df.rename(columns=col_map)
                    df['time'] = pd.to_datetime(df['time'])
                    df = df[['time', 'open', 'high', 'low', 'close', 'volume']].dropna()
                    df = df.sort_values('time').reset_index(drop=True)
                    return df
            except Exception as e_new:
                last_err = e_new
                
            # 3. Dự phòng 2: Thử vnstock v4.0+ SSI
            try:
                from vnstock.api.quote import Quote
                q = Quote(symbol=ticker.upper(), source='SSI')
                end_date = datetime.now().strftime('%Y-%m-%d')
                start_date = (datetime.now() - timedelta(days=m * 31)).strftime('%Y-%m-%d')
                df = q.history(start=start_date, end=end_date, interval='1D')
                if df is not None and not df.empty:
                    col_map = {}
                    for col in df.columns:
                        cl = col.lower()
                        if 'open' in cl: col_map[col] = 'open'
                        elif 'high' in cl: col_map[col] = 'high'
                        elif 'low' in cl: col_map[col] = 'low'
                        elif 'close' in cl: col_map[col] = 'close'
                        elif 'volume' in cl or 'vol' in cl: col_map[col] = 'volume'
                        elif 'time' in cl or 'date' in cl: col_map[col] = 'time'
                    df = df.rename(columns=col_map)
                    df['time'] = pd.to_datetime(df['time'])
                    df = df[['time', 'open', 'high', 'low', 'close', 'volume']].dropna()
                    df = df.sort_values('time').reset_index(drop=True)
                    return df
            except Exception as e_ssi:
                last_err = e_ssi
        except Exception as e:
            last_err = e
            
    # Nếu tất cả các mốc tháng đều thất bại
    raise HTTPException(
        status_code=500,
        detail=f"Lỗi lấy dữ liệu VNStock cho mã {ticker}: {str(last_err)}"
    )


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Server đang chạy", "time": datetime.now().isoformat()}


@app.get("/api/stock/{ticker}")
def get_stock_analysis(ticker: str):
    """
    Lấy OHLCV 10 năm + tính toán toàn bộ chỉ báo kỹ thuật
    """
    try:
        df = fetch_ohlcv(ticker, months=120)

        # Tính indicators
        indicator_result = calc_all_indicators(df)
        support, resistance = get_support_resistance(df)

        # OHLCV cho biểu đồ (chuyển sang list dict)
        ohlcv_list = []
        for _, row in df.iterrows():
            ohlcv_list.append({
                'time': int(row['time'].timestamp()),
                'open': round(float(row['open']), 2),
                'high': round(float(row['high']), 2),
                'low': round(float(row['low']), 2),
                'close': round(float(row['close']), 2),
                'volume': int(row['volume'])
            })

        # MA series cho biểu đồ
        from indicators import calc_ma, calc_bollinger
        ma10_series = calc_ma(df, 10)
        ma50_series = calc_ma(df, 50)
        bb_upper, bb_middle, bb_lower, _, _ = calc_bollinger(df)

        ma10_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': round(float(v), 2)}
                     for i, v in enumerate(ma10_series) if not pd.isna(v)]
        ma50_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': round(float(v), 2)}
                     for i, v in enumerate(ma50_series) if not pd.isna(v)]
        bb_upper_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': round(float(v), 2)}
                         for i, v in enumerate(bb_upper) if not pd.isna(v)]
        bb_lower_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': round(float(v), 2)}
                         for i, v in enumerate(bb_lower) if not pd.isna(v)]

        # RSI series
        from indicators import calc_rsi
        rsi_series = calc_rsi(df, 14)
        rsi_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': round(float(v), 2)}
                    for i, v in enumerate(rsi_series) if not pd.isna(v)]

        # MACD series
        from indicators import calc_macd
        macd_line, signal_line, histogram = calc_macd(df)
        macd_list = [{'time': int(df['time'].iloc[i].timestamp()),
                      'macd': round(float(m), 4), 'signal': round(float(s), 4), 'hist': round(float(h), 4)}
                     for i, (m, s, h) in enumerate(zip(macd_line, signal_line, histogram))
                     if not (pd.isna(m) or pd.isna(s))]

        # OBV series
        from indicators import calc_obv
        obv_series = calc_obv(df)
        obv_list = [{'time': int(df['time'].iloc[i].timestamp()), 'value': int(v)}
                    for i, v in enumerate(obv_series)]

        last_date = str(df['time'].iloc[-1])[:10]

        return {
            'ticker': ticker.upper(),
            'last_date': last_date,
            'total_days': len(df),
            'ohlcv': ohlcv_list,
            'series': {
                'ma10': ma10_list,
                'ma50': ma50_list,
                'bb_upper': bb_upper_list,
                'bb_lower': bb_lower_list,
                'rsi': rsi_list,
                'macd': macd_list,
                'obv': obv_list
            },
            'analysis': indicator_result,
            'support': support,
            'resistance': resistance
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi phân tích: {str(e)}")


@app.get("/api/candle/{ticker}")
def get_candlestick_patterns(ticker: str):
    """
    Nhận diện mô hình nến Nhật từ 5 phiên gần nhất
    """
    try:
        df = fetch_ohlcv(ticker, months=3)
        support, resistance = get_support_resistance(df)
        patterns = detect_patterns(df, support=support, resistance=resistance)
        recent_candles = get_recent_candles_description(df, n=5)

        return {
            'ticker': ticker.upper(),
            'patterns': patterns,
            'recent_candles': recent_candles,
            'support': support,
            'resistance': resistance
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi phân tích nến: {str(e)}")


@app.get("/api/backtest/{ticker}")
def get_backtest(ticker: str, strategy: str = "macd_hist_bearish_surge", threshold: int = 3, months: int = 120):
    """
    Chạy back-testing tín hiệu mua trên dữ liệu lịch sử
    strategy: Tên chiến lược cần test (macd_hist_bearish_surge hoặc multi_signal_buy)
    threshold: Số chỉ báo BUY tối thiểu (cho multi_signal_buy)
    """
    try:
        df = fetch_ohlcv(ticker, months=months)
        result = run_backtest(df, strategy=strategy, threshold=threshold)
        result['ticker'] = ticker.upper()
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi back-testing: {str(e)}")


@app.get("/api/research")
def get_research(tickers: str = "GEX,VIX,HPG,MBB,MWG"):
    """
    Chạy pipeline nghiên cứu quy nạp (Inductive Research) cho danh sách cổ phiếu
    """
    try:
        from research import run_full_research
        ticker_list = [t.strip().upper() for t in tickers.split(',')]
        result = run_full_research(ticker_list)
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Lỗi chạy nghiên cứu: {str(e)}")


@app.get("/api/scanner")
def run_market_scanner(strategy: str = "multi_signal_buy", threshold: int = 3):
    """
    Rà soát toàn thị trường cho danh sách 50 cổ phiếu theo thời gian thực
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    
    tickers_list = [
        "ACB", "BCM", "BID", "BVH", "CTG", "FPT", "GAS", "GVR", "HDB", "HPG", 
        "MBB", "MSN", "MWG", "PLX", "POW", "SAB", "SHB", "SSB", "SSI", "STB", 
        "TCB", "TPB", "VCB", "VHM", "VIB", "VIC", "VJC", "VNM", "VPB", "VRE",
        "GEX", "VIX", "VND", "DIG", "DXG", "CEO", "NVL", "PDR", "HSG", "NKG", 
        "VCG", "KBC", "DGC", "PVD", "PVS", "HHV", "LCG", "ANV", "VHC", "DCM"
    ]
    
    results = []
    
    def scan_single_ticker(ticker: str):
        try:
            # Tải dữ liệu 6 tháng (125 phiên) để quét cực nhanh
            df = fetch_ohlcv(ticker, months=6)
            if df is None or df.empty or len(df) < 10:
                return None
                
            last_row = df.iloc[-1]
            last_date_str = str(last_row['time'])[:10]
            close_price = float(last_row['close'])
            
            # Tính % thay đổi phiên hôm nay so với phiên trước
            price_change = 0.0
            price_change_pct = 0.0
            if len(df) >= 2:
                prev_close = float(df.iloc[-2]['close'])
                price_change = round(close_price - prev_close, 2)
                price_change_pct = round((close_price - prev_close) / prev_close * 100, 2)
            
            # Chạy backtest để tìm tín hiệu lịch sử
            bt_res = run_backtest(df, strategy=strategy, threshold=threshold)
            
            # Kiểm tra xem có tín hiệu kích hoạt vào ngày cuối cùng không
            bt_signals = bt_res.get('results', [])
            has_signal = False
            signal_detail = None
            
            for sig in bt_signals:
                if sig.get('date') == last_date_str:
                    has_signal = True
                    signal_detail = sig
                    break
            
            # Dự phòng: nếu ngày kích hoạt lệch 1 phiên do múi giờ hoặc dữ liệu chưa khớp ngày hiện tại
            if not has_signal and len(bt_signals) > 0:
                last_sig = bt_signals[-1]
                # Nếu tín hiệu cuối cùng cách ngày hiện tại không quá 2 ngày
                try:
                    sig_date = datetime.strptime(last_sig.get('date'), '%Y-%m-%d')
                    curr_date = datetime.strptime(last_date_str, '%Y-%m-%d')
                    if (curr_date - sig_date).days <= 2:
                        has_signal = True
                        signal_detail = last_sig
                except Exception:
                    pass
            
            if has_signal and signal_detail:
                return {
                    'ticker': ticker,
                    'price': close_price,
                    'price_change': price_change,
                    'price_change_pct': price_change_pct,
                    'date': signal_detail.get('date'),
                    'buy_signals': signal_detail.get('buy_signals'),
                    'rule_name': signal_detail.get('rule_name', 'Tín hiệu mua kỹ thuật'),
                }
        except Exception as e:
            # Ghi lỗi ra console nhưng không làm sập toàn bộ tiến trình quét
            print(f"[Scanner Error] Lỗi quét mã {ticker}: {str(e)}")
        return None

    # Sử dụng ThreadPoolExecutor quét song song 50 mã (giới hạn max_workers để tránh rate limit)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(scan_single_ticker, t): t for t in tickers_list}
        for future in as_completed(futures):
            res = future.result()
            if res is not None:
                results.append(res)
                
    # Sắp xếp kết quả: Tín hiệu mới nhất lên đầu, sau đó theo phần trăm tăng giá giảm dần
    results.sort(key=lambda x: (x['date'], x['price_change_pct']), reverse=True)
    
    return {
        'total_scanned': len(tickers_list),
        'signals_found': len(results),
        'results': results,
        'time': datetime.now().isoformat()
    }


TICKER_MAP = {
    "GEX": "Gelex",
    "VIX": "VIX",
    "HPG": "Hòa Phát",
    "MBB": "Ngân hàng Quân đội",
    "MWG": "Thế giới Di động",
    "FPT": "FPT",
    "VND": "VNDirect",
    "DIG": "DIC Corp",
    "DXG": "Đất Xanh",
    "CEO": "Tập đoàn CEO",
    "NVL": "Novaland",
    "PDR": "Phát Đạt",
    "HSG": "Hoa Sen",
    "NKG": "Nam Kim",
    "VCG": "Vinaconex",
    "KBC": "Kinh Bắc",
    "DGC": "Hóa chất Đức Giang",
    "PVD": "Khoan Dầu khí",
    "PVS": "Dịch vụ Dầu khí",
    "HHV": "Hạ tầng Giao thông Đèo Cả",
    "LCG": "Lizen",
    "ANV": "Nam Việt",
    "VHC": "Vĩnh Hoàn",
    "DCM": "Phân bón Dầu khí Cà Mau",
    "ACB": "Ngân hàng Á Châu",
    "BCM": "Becamex",
    "BID": "BIDV",
    "BVH": "Bảo Việt",
    "CTG": "VietinBank",
    "GAS": "PV Gas",
    "GVR": "Cao su Việt Nam",
    "HDB": "HDBank",
    "MSN": "Masan",
    "PLX": "Petrolimex",
    "POW": "PV Power",
    "SAB": "Sabeco",
    "SHB": "Ngân hàng SHB",
    "SSB": "SeABank",
    "SSI": "Chứng khoán SSI",
    "STB": "Sacombank",
    "TCB": "Techcombank",
    "TPB": "TPBank",
    "VCB": "Vietcombank",
    "VHM": "Vinhomes",
    "VIB": "Ngân hàng VIB",
    "VIC": "Vingroup",
    "VJC": "Vietjet",
    "VNM": "Vinamilk",
    "VPB": "VPBank",
    "VRE": "Vincom Retail"
}

def extract_date_from_url(url: str):
    import re
    # Thử tìm chuỗi số liên tục độ dài 8 chữ số dạng YYYYMMDD (ví dụ: 20260625)
    match = re.search(r'-(\d{8})\d*\.chn', url)
    if match:
        date_str = match.group(1)
        try:
            return datetime.strptime(date_str, "%Y%m%d")
        except ValueError:
            pass
            
    # Thử tìm định dạng Solr cũ của CafeF: chứa 188 và theo sau là 6 chữ số ngày YYMMDD
    # Ví dụ: -188260605...chn -> 260605 -> 05/06/2026
    match_solr = re.search(r'-188(\d{6})\d*\.chn', url)
    if match_solr:
        date_str = match_solr.group(1)
        try:
            return datetime.strptime(f"20{date_str}", "%Y%m%d")
        except ValueError:
            pass
            
    # Nếu không tìm thấy, thử tìm bất kỳ chuỗi 8 chữ số nào có dạng YYYYMMDD
    match_any = re.search(r'\b(20[1-3]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b', url)
    if match_any:
        try:
            return datetime(int(match_any.group(1)), int(match_any.group(2)), int(match_any.group(3)))
        except ValueError:
            pass
            
    # Mặc định trả về ngày cũ nhất
    return datetime(2020, 1, 1)

def scrape_cafef_keyword(term: str):
    import requests
    from bs4 import BeautifulSoup
    url = f"https://cafef.vn/tim-kiem.chn?keywords={term}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    items = []
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            for element in soup.find_all(["li", "div"]):
                a_tag = element.find("a")
                if a_tag and a_tag.get("href") and (".chn" in a_tag.get("href")):
                    href = a_tag.get("href")
                    if not href.startswith("http"):
                        href = f"https://cafef.vn{href}"
                        
                    if "tim-kiem.chn" in href:
                        continue
                        
                    title = a_tag.get("title") or a_tag.text.strip()
                    if len(title) < 20:
                        continue
                        
                    sapo = ""
                    sapo_tag = element.find(class_="sapo") or element.find(class_="desc")
                    if sapo_tag:
                        sapo = sapo_tag.text.strip()
                    
                    items.append({
                        "title": title,
                        "url": href,
                        "sapo": sapo
                    })
    except Exception as e:
        print(f"[News Scraper] Lỗi cào từ khóa '{term}': {str(e)}")
    return items

@app.get("/api/news/{ticker}")
def get_stock_news(ticker: str):
    """
    Cào tối đa 8 tin tức mới nhất của cổ phiếu từ CafeF theo cơ chế cào kép (ticker + tiếng Việt) và lọc/sắp xếp theo ngày
    """
    ticker = ticker.upper().strip()
    keywords = [ticker]
    if ticker in TICKER_MAP:
        keywords.append(TICKER_MAP[ticker])
        
    all_news = []
    seen_urls = set()
    
    for kw in keywords:
        kw_news = scrape_cafef_keyword(kw)
        for item in kw_news:
            url = item["url"]
            if url not in seen_urls:
                seen_urls.add(url)
                # Trích xuất ngày đăng
                pub_date = extract_date_from_url(url)
                item["pub_date"] = pub_date
                # Lưu trữ chuỗi ngày hiển thị
                item["date_str"] = pub_date.strftime("%d/%m/%Y") if pub_date.year > 2020 else "N/A"
                all_news.append(item)
                
    # Sắp xếp giảm dần theo pub_date
    all_news.sort(key=lambda x: x["pub_date"], reverse=True)
    
    # Lấy tối đa 8 tin tức mới nhất
    latest_news = all_news[:8]
    
    # Loại bỏ object datetime để tránh lỗi JSON serialization của FastAPI
    cleaned_news = []
    for item in latest_news:
        cleaned_news.append({
            "title": item["title"],
            "url": item["url"],
            "sapo": item["sapo"],
            "date": item["date_str"]
        })
        
    return {"status": "success", "ticker": ticker, "news": cleaned_news}



if __name__ == "__main__":
    import uvicorn
    print("[Server] Khoi dong server phan tich ky thuat co phieu...")
    print("[Server] Truy cap: http://localhost:8000")
    print("[Server] API Docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
