"""
research.py — Module phân tích nghiên cứu quy nạp (Inductive Research)
Phát hiện các sự kiện lớn trong quá khứ, reverse-engineer trạng thái chỉ báo trước đó,
thống kê tần suất và tính toán trọng số tối ưu cho thuật toán Weighted Scoring.
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import traceback
import json
import os

from indicators import (
    calc_ma, calc_macd, calc_bollinger, calc_obv, calc_atr, calc_obv_slope, calc_rsi
)
from candlestick import detect_patterns


def find_events(df: pd.DataFrame, ticker: str) -> list:
    """
    Xác định các sự kiện biến động lớn trong lịch sử:
    - Tăng mạnh (surge_up): Giá tại phiên T+h tăng >= 5% so với phiên T (với h = 3, 4, hoặc 5).
    - Giảm mạnh (surge_down): Giá tại phiên T+h giảm >= 5% so với phiên T (với h = 3, 4, hoặc 5).
    
    Để tránh nhiễu và đếm trùng lặp nhiều phiên trong cùng một sóng, áp dụng khoảng cách tối thiểu 10 phiên giữa các sự kiện cùng loại.
    """
    df = df.sort_values('time').reset_index(drop=True)
    n_rows = len(df)
    events = []
    
    if n_rows < 20:
        return events

    last_event_idx = {
        'surge_up': -100,
        'surge_down': -100
    }

    close_vals = df['close'].values
    time_vals = df['time'].values

    # Duyệt qua các phiên từ 55 đến n_rows - 5 để đảm bảo đủ dữ liệu chỉ báo quá khứ và tương lai
    for i in range(55, n_rows - 5):
        close_i = float(close_vals[i])
        
        # 1. Kiểm tra biến động tăng mạnh >= 5% sau 3-5 ngày
        is_bull = False
        for h in [3, 4, 5]:
            future_close = float(close_vals[i + h])
            chg = (future_close - close_i) / close_i
            if chg >= 0.05:
                is_bull = True
                break
                
        # 2. Kiểm tra biến động giảm mạnh <= -5% sau 3-5 ngày
        is_bear = False
        for h in [3, 4, 5]:
            future_close = float(close_vals[i + h])
            chg = (future_close - close_i) / close_i
            if chg <= -0.05:
                is_bear = True
                break
                
        if is_bull and (i - last_event_idx['surge_up'] >= 10):
            events.append({
                'ticker': ticker,
                'index': i + 5,            # Phiên kết thúc chu kỳ (đại diện)
                'trigger_index': i,        # Phiên kích hoạt mua (đáy)
                'date': pd.to_datetime(time_vals[i + 5]).strftime('%d/%m/%Y'),
                'trigger_date': pd.to_datetime(time_vals[i]).strftime('%d/%m/%Y'),
                'type': 'surge_up',
                'price_at_trigger': round(close_i, 2),
                'price_change_pct': round(((float(close_vals[i+5]) - close_i) / close_i) * 100, 2)
            })
            last_event_idx['surge_up'] = i
            continue

        if is_bear and (i - last_event_idx['surge_down'] >= 10):
            events.append({
                'ticker': ticker,
                'index': i + 5,
                'trigger_index': i,        # Phiên kích hoạt bán (đỉnh)
                'date': pd.to_datetime(time_vals[i + 5]).strftime('%d/%m/%Y'),
                'trigger_date': pd.to_datetime(time_vals[i]).strftime('%d/%m/%Y'),
                'type': 'surge_down',
                'price_at_trigger': round(close_i, 2),
                'price_change_pct': round(((float(close_vals[i+5]) - close_i) / close_i) * 100, 2)
            })
            last_event_idx['surge_down'] = i
            continue

    return events


def analyze_indicators_at_trigger(df: pd.DataFrame, trigger_idx: int) -> dict:
    """
    Phân tích ngược (reverse-engineer) trạng thái của các chỉ báo kỹ thuật tại phiên kích hoạt (trigger_idx)
    """
    T = trigger_idx
    
    close_vals = df['close'].values
    open_vals = df['open'].values
    high_vals = df['high'].values
    low_vals = df['low'].values
    vol_vals = df['volume'].values
    
    ma10_vals = df['ma10'].values
    ma20_vals = df['ma20'].values
    ma50_vals = df['ma50'].values
    ma100_vals = df['ma100'].values
    ma200_vals = df['ma200'].values
    
    macd_vals = df['macd_line'].values
    sig_vals = df['signal_line'].values
    hist_vals = df['macd_hist'].values
    
    pct_b_vals = df['bb_pct_b'].values
    vol_ma20_vals = df['volume_ma20'].values
    obv_slope_vals = df['obv_slope'].values
    rsi_vals = df['rsi'].values
    
    support = df['support'].iloc[T]
    resistance = df['resistance'].iloc[T]

    # --- Tính toán trạng thái cụ thể ---
    
    # 1. MACD Histogram Direction & Color
    hist_T = float(hist_vals[T])
    hist_prev = float(hist_vals[T - 1]) if T > 0 else 0.0
    
    macd_hist_dir = "tăng" if hist_T > hist_prev else "giảm"
    
    if hist_T < 0:
        macd_hist_color = "đỏ nhạt" if hist_T > hist_prev else "đỏ đậm"
    else:
        macd_hist_color = "xanh đậm" if hist_T > hist_prev else "xanh nhạt"

    # 2. MACD Golden/Death Cross trong 3 phiên gần nhất [T-2, T]
    macd_cross = "Không"
    if T >= 2:
        for idx in range(T - 2, T + 1):
            macd_curr = macd_vals[idx]
            sig_curr = sig_vals[idx]
            macd_prev = macd_vals[idx - 1]
            sig_prev = sig_vals[idx - 1]
            
            if macd_prev <= sig_prev and macd_curr > sig_curr:
                macd_cross = "Golden Cross"
                break
            elif macd_prev >= sig_prev and macd_curr < sig_curr:
                macd_cross = "Death Cross"
                break
    
    macd_vs_signal = "trên" if macd_vals[T] > sig_vals[T] else "dưới"

    # 3. Xu hướng MA (Giá vs MA10, MA20, MA50)
    close_T = float(close_vals[T])
    price_vs_ma10 = "trên" if not pd.isna(ma10_vals[T]) and close_T > ma10_vals[T] else "dưới"
    price_vs_ma20 = "trên" if not pd.isna(ma20_vals[T]) and close_T > ma20_vals[T] else "dưới"
    price_vs_ma50 = "trên" if not pd.isna(ma50_vals[T]) and close_T > ma50_vals[T] else "dưới"

    # 4. Bollinger Bands %B
    pct_b_T = float(pct_b_vals[T])
    if pct_b_T < 0.2:
        bb_position = "%B < 0.2"
    elif pct_b_T > 0.8:
        bb_position = "%B > 0.8"
    else:
        bb_position = "0.2 <= %B <= 0.8"

    # 5. Volume Ratio vs MA20
    vol_T = float(vol_vals[T])
    vol_ma_T = float(vol_ma20_vals[T]) if not pd.isna(vol_ma20_vals[T]) else 0.0
    vol_ratio = vol_T / vol_ma_T if vol_ma_T > 0 else 0.0
    
    if vol_ratio > 1.5:
        volume_status = "> 1.5x"
    elif vol_ratio > 1.2:
        volume_status = "> 1.2x"
    elif vol_ratio < 0.7:
        volume_status = "< 0.7x"
    else:
        volume_status = "Bình thường"

    # 6. Mô hình nến Nhật
    sub_df = df.iloc[:T + 1].copy()
    patterns = detect_patterns(sub_df, support, resistance)
    has_bullish_candle = False
    has_bearish_candle = False
    candle_names = []
    
    for p in patterns:
        candle_names.append(p['name'])
        if p['type'] == 'bullish':
            has_bullish_candle = True
        elif p['type'] == 'bearish':
            has_bearish_candle = True
            
    candle_pattern = ", ".join(candle_names) if candle_names else "Không có"

    # 7. OBV Slope
    obv_slope_val = float(obv_slope_vals[T]) if not pd.isna(obv_slope_vals[T]) else 0.0
    obv_slope_status = "Dương" if obv_slope_val > 0 else "Âm"

    # 8. Hỗ trợ / Kháng cự
    near_support = "Không"
    if support > 0 and abs(close_T - support) / support <= 0.02:
        near_support = "Có"
        
    near_resistance = "Không"
    if resistance > 0 and abs(close_T - resistance) / resistance <= 0.02:
        near_resistance = "Có"
        
    # 9. Chỉ báo bổ sung cho Contrastive Analysis
    rsi_T = float(rsi_vals[T]) if not pd.isna(rsi_vals[T]) else 50.0
    ma200_val = ma200_vals[T]
    ma200_slope_40 = ma200_val - ma200_vals[T-40] if T >= 40 and not pd.isna(ma200_val) and not pd.isna(ma200_vals[T-40]) else 0.0
    is_ma200_up = "Có" if ma200_slope_40 > 0 else "Không"
    is_ma50_above_ma200 = "Có" if not pd.isna(ma50_vals[T]) and not pd.isna(ma200_val) and ma50_vals[T] > ma200_val * 1.03 else "Không"
    is_not_overextended_long = "Có" if not pd.isna(ma200_val) and close_T <= ma200_val * 1.20 else "Không"

    return {
        'macd_hist_dir': macd_hist_dir,
        'macd_hist_color': macd_hist_color,
        'macd_cross': macd_cross,
        'macd_vs_signal': macd_vs_signal,
        'price_vs_ma10': price_vs_ma10,
        'price_vs_ma20': price_vs_ma20,
        'price_vs_ma50': price_vs_ma50,
        'bb_position': bb_position,
        'bb_pct_b': round(pct_b_T, 4),
        'volume_ratio': round(vol_ratio, 2),
        'volume_status': volume_status,
        'candle_pattern': candle_pattern,
        'has_bullish_candle': has_bullish_candle,
        'has_bearish_candle': has_bearish_candle,
        'obv_slope_status': obv_slope_status,
        'near_support': near_support,
        'near_resistance': near_resistance,
        'rsi_val': rsi_T,
        'rsi_below_65': "Có" if rsi_T <= 65 else "Không",
        'rsi_below_35': "Có" if rsi_T < 35 else "Không",
        'ma200_up_40': is_ma200_up,
        'ma50_above_ma200': is_ma50_above_ma200,
        'price_below_ma200_120': is_not_overextended_long
    }


def aggregate_patterns(events_with_context: list) -> dict:
    """
    Tổng hợp thống kê tần suất xuất hiện của các chỉ báo trước các loại sự kiện
    """
    categories = ['surge_up', 'surge_down']
    stats = {}

    for cat in categories:
        cat_events = [e for e in events_with_context if e['type'] == cat]
        total = len(cat_events)
        
        if total == 0:
            stats[cat] = {'total_events': 0, 'metrics': {}}
            continue
            
        metrics = {
            'macd_hist_dir_up': sum(1 for e in cat_events if e['context']['macd_hist_dir'] == 'tăng'),
            'macd_hist_red_light': sum(1 for e in cat_events if e['context']['macd_hist_color'] == 'đỏ nhạt'),
            'macd_golden_cross': sum(1 for e in cat_events if e['context']['macd_cross'] == 'Golden Cross'),
            'macd_vs_signal_above': sum(1 for e in cat_events if e['context']['macd_vs_signal'] == 'trên'),
            'price_above_ma10': sum(1 for e in cat_events if e['context']['price_vs_ma10'] == 'trên'),
            'price_above_ma20': sum(1 for e in cat_events if e['context']['price_vs_ma20'] == 'trên'),
            'price_above_ma50': sum(1 for e in cat_events if e['context']['price_vs_ma50'] == 'trên'),
            'bb_below_02': sum(1 for e in cat_events if e['context']['bb_position'] == '%B < 0.2'),
            'bb_below_05': sum(1 for e in cat_events if e['context']['bb_pct_b'] < 0.5),
            'vol_above_1_2x': sum(1 for e in cat_events if e['context']['volume_status'] in ['> 1.2x', '> 1.5x']),
            'vol_above_1_5x': sum(1 for e in cat_events if e['context']['volume_status'] == '> 1.5x'),
            'has_bullish_candle': sum(1 for e in cat_events if e['context']['has_bullish_candle']),
            'has_bearish_candle': sum(1 for e in cat_events if e['context']['has_bearish_candle']),
            'obv_slope_positive': sum(1 for e in cat_events if e['context']['obv_slope_status'] == 'Dương'),
            'near_support': sum(1 for e in cat_events if e['context']['near_support'] == 'Có'),
            'near_resistance': sum(1 for e in cat_events if e['context']['near_resistance'] == 'Có'),
            'rsi_below_65': sum(1 for e in cat_events if e['context']['rsi_below_65'] == 'Có'),
            'rsi_below_35': sum(1 for e in cat_events if e['context']['rsi_below_35'] == 'Có'),
            'ma200_up_40': sum(1 for e in cat_events if e['context']['ma200_up_40'] == 'Có'),
            'ma50_above_ma200': sum(1 for e in cat_events if e['context']['ma50_above_ma200'] == 'Có'),
            'price_below_ma200_120': sum(1 for e in cat_events if e['context']['price_below_ma200_120'] == 'Có')
        }
        
        # Đổi thành phần trăm
        metrics_pct = {}
        for key, val in metrics.items():
            metrics_pct[key] = {
                'count': val,
                'pct': round((val / total) * 100, 2)
            }
            
        stats[cat] = {
            'total_events': total,
            'metrics': metrics_pct
        }
        
    return stats


def compute_optimal_weights(pattern_stats: dict) -> dict:
    """
    Tính toán trọng số tối ưu (Optimal Weights) cho các chỉ báo kỹ thuật dựa trên tần suất tương quan.
    Tập trung vào các sự kiện tăng giá (surge_up).
    """
    up_stats = pattern_stats.get('surge_up', {}).get('metrics', {})
    
    indicators_to_weight = {
        'macd_hist_dir_up': 'Độ dốc MACD Histogram tăng',
        'macd_hist_red_light': 'MACD Histogram màu đỏ nhạt (thu nhỏ âm)',
        'macd_golden_cross': 'MACD Golden Cross gần đây',
        'price_above_ma10': 'Giá nằm trên MA10',
        'price_above_ma20': 'Giá nằm trên MA20',
        'bb_below_05': 'Bollinger Bands %B < 0.5 (Nửa dưới dải)',
        'vol_above_1_2x': 'Khối lượng đột biến > 1.2x',
        'has_bullish_candle': 'Có mô hình nến đảo chiều tăng',
        'obv_slope_positive': 'Xu hướng OBV tăng (Dòng tiền tích lũy)',
        'near_support': 'Giá gần vùng hỗ trợ (< 2%)',
        'rsi_below_65': 'RSI <= 65 (Chưa quá mua)',
        'rsi_below_35': 'RSI < 35 (Quá bán sâu)',
        'ma200_up_40': 'MA200 hướng lên (40 phiên)',
        'ma50_above_ma200': 'MA50 > MA200 * 1.03 (Uptrend mạnh)',
        'price_below_ma200_120': 'Giá <= MA200 * 1.20 (Chống mua đuổi)'
    }
    
    raw_scores = {}
    for key, name in indicators_to_weight.items():
        pct_up = up_stats.get(key, {}).get('pct', 0.0)
        
        raw_scores[key] = {
            'name': name,
            'raw_score': pct_up
        }
        
    # Chuẩn hóa về tổng = 100
    total_raw = sum(item['raw_score'] for item in raw_scores.values())
    
    weights = {}
    if total_raw > 0:
        accumulated_weight = 0
        keys = list(raw_scores.keys())
        for idx, key in enumerate(keys):
            item = raw_scores[key]
            w = int(round((item['raw_score'] / total_raw) * 100))
            
            if idx == len(keys) - 1:
                w = 100 - accumulated_weight
            
            accumulated_weight += w
            weights[key] = {
                'name': item['name'],
                'weight': w,
                'correlation': round(item['raw_score'], 2)
            }
    else:
        default_w = 100 // len(indicators_to_weight)
        accumulated_weight = 0
        for idx, (key, name) in enumerate(indicators_to_weight.items()):
            w = default_w
            if idx == len(indicators_to_weight) - 1:
                w = 100 - accumulated_weight
            accumulated_weight += w
            weights[key] = {
                'name': name,
                'weight': w,
                'correlation': 50.0
            }
            
    return weights


def clean_nan_inf(obj):
    """Đệ quy làm sạch các giá trị NaN và Infinity trong dict/list để tránh lỗi JSON Compliant"""
    if isinstance(obj, dict):
        return {k: clean_nan_inf(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_nan_inf(x) for x in obj]
    elif isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return obj
    elif isinstance(obj, (np.float64, np.float32)):
        val = float(obj)
        if np.isnan(val) or np.isinf(val):
            return 0.0
        return val
    elif isinstance(obj, (np.int64, np.int32)):
        return int(obj)
    return obj


def run_full_research(tickers: list) -> dict:
    """
    Pipeline hoàn chỉnh của nghiên cứu quy nạp:
    1. Fetch dữ liệu 5 năm lịch sử cho từng ticker
    2. Tính toán toàn bộ chỉ báo kỹ thuật trên DataFrame
    3. Tìm kiếm các sự kiện biến động lớn (surge/reversal)
    4. Phân tích ngược trạng thái các chỉ báo tại từng sự kiện
    5. Tổng hợp tần suất xuất hiện và tính toán trọng số tối ưu chung
    """
    all_events_context = []
    ticker_results = {}
    
    from main import fetch_ohlcv

    for ticker in tickers:
        ticker = ticker.upper().strip()
        try:
            # Fetch 10 năm dữ liệu để đảm bảo mẫu thống kê đủ lớn và uy tín
            df = fetch_ohlcv(ticker, months=120)
            if df is None or df.empty or len(df) < 120:
                print(f"[-] Ticker {ticker} không đủ dữ liệu hoặc lỗi fetch.")
                continue
                
            df['ma10'] = calc_ma(df, 10)
            df['ma20'] = calc_ma(df, 20)
            df['ma50'] = calc_ma(df, 50)
            df['ma100'] = calc_ma(df, 100)
            df['ma200'] = calc_ma(df, 200)
            df['rsi'] = calc_rsi(df, 14)
            
            macd_line, signal_line, histogram = calc_macd(df)
            df['macd_line'] = macd_line
            df['signal_line'] = signal_line
            df['macd_hist'] = histogram
            
            _, _, _, _, pct_b = calc_bollinger(df)
            df['bb_pct_b'] = pct_b
            
            df['volume_ma20'] = df['volume'].rolling(20).mean()
            df['atr'] = calc_atr(df, 14)
            
            obv = calc_obv(df)
            df['obv'] = obv
            df['obv_slope'] = calc_obv_slope(obv, 10)
            
            supports = []
            resistances = []
            for idx in range(len(df)):
                if idx < 60:
                    supports.append(0.0)
                    resistances.append(0.0)
                else:
                    recent = df.iloc[idx-60:idx]
                    supports.append(float(recent['low'].min()))
                    resistances.append(float(recent['high'].max()))
            df['support'] = supports
            df['resistance'] = resistances

            # Tìm sự kiện biến động
            events = find_events(df, ticker)
            
            # Phân tích ngược trạng thái chỉ báo
            events_context = []
            for ev in events:
                t_idx = ev['trigger_index']
                if t_idx < 55 or t_idx >= len(df):
                    continue
                context = analyze_indicators_at_trigger(df, t_idx)
                ev['context'] = context
                events_context.append(ev)
                all_events_context.append(ev)
                
            ticker_results[ticker] = {
                'data_points': len(df),
                'events_count': len(events),
                'events': events_context[:20]  # Giới hạn 20 sự kiện gần nhất trả về cho UI
            }
            print(f"[+] Hoàn thành phân tích cho {ticker}: {len(events)} sự kiện.")
            
        except Exception as e:
            print(f"[-] Lỗi phân tích ticker {ticker}: {str(e)}")
            traceback.print_exc()

    # Tổng hợp tần suất & Trọng số tối ưu
    if all_events_context:
        pattern_stats = aggregate_patterns(all_events_context)
        optimal_weights = compute_optimal_weights(pattern_stats)
    else:
        pattern_stats = {}
        optimal_weights = {}

    # Lưu optimal_weights.json
    try:
        weights_file = os.path.join(os.path.dirname(__file__), 'optimal_weights.json')
        clean_weights = clean_nan_inf(optimal_weights)
        with open(weights_file, 'w', encoding='utf-8') as f:
            json.dump(clean_weights, f, ensure_ascii=False, indent=2)
        print(f"[+] Đã lưu trọng số tối ưu vào file: {weights_file}")
    except Exception as e:
        print(f"[-] Lỗi lưu file trọng số: {str(e)}")

    result = {
        'status': 'success',
        'timestamp': datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
        'optimal_weights': optimal_weights,
        'pattern_stats': pattern_stats,
        'ticker_results': ticker_results,
        'total_events_analyzed': len(all_events_context)
    }
    
    return clean_nan_inf(result)


if __name__ == '__main__':
    print("Bắt đầu test research pipeline nâng cao...")
    import sys
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    
    test_tickers = ['GEX', 'VIX', 'HPG', 'MBB', 'MWG']
    res = run_full_research(test_tickers)
    print("Kết quả test weights:")
    for k, v in res.get('optimal_weights', {}).items():
        print(f"  {v['name']}: {v['weight']}% (Correlation: {v['correlation']}%)")
