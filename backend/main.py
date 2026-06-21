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


def fetch_ohlcv(ticker: str, months: int = 120) -> pd.DataFrame:
    """Lấy dữ liệu OHLCV từ VNStock với cơ chế fallback nếu số tháng yêu cầu bị lỗi"""
    last_err = None
    test_months = [months]
    for m in [60, 36, 15]:
        if m not in test_months and m < months:
            test_months.append(m)
            
    for m in test_months:
        try:
            # 1. Thử vnstock v4.0+ API mới (dùng Quote trực tiếp để tránh cảnh báo deprecation gây lỗi unicode)
            try:
                from vnstock.api.quote import Quote
                q = Quote(symbol=ticker.upper(), source='VCI')
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
            except Exception as e_new:
                last_err = e_new
                
            # 2. Dự phòng: Thử vnstock v4.0+ SSI hoặc nguồn dữ liệu khác nếu VCI lỗi
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





if __name__ == "__main__":
    import uvicorn
    print("[Server] Khoi dong server phan tich ky thuat co phieu...")
    print("[Server] Truy cap: http://localhost:8000")
    print("[Server] API Docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
