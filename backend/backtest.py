"""
backtest.py — Back-testing tín hiệu kỹ thuật trên dữ liệu lịch sử
Hỗ trợ các chiến lược:
1. 'multi_signal_buy': Tín hiệu mua đồng thuận từ nhiều chỉ báo
2. 'macd_hist_bearish_surge': Đánh giá nhận định "MACD histogram từ đỏ nhạt sang đỏ đậm"
3. 'weighted_score': Thuật toán chấm điểm trọng số tối ưu (Optimal Weights) từ Inductive Research
4. 'optimal_induction': Thuật toán Quy nạp Tối ưu (Pro V5) thắt chặt tích lũy và TP/SL động
"""

import pandas as pd
import numpy as np
import json
import os
from indicators import (
    calc_ma, calc_rsi, calc_macd, calc_bollinger, calc_obv, calc_obv_slope
)


def run_backtest(df: pd.DataFrame, strategy: str = "macd_hist_bearish_surge", threshold: int = 3) -> dict:
    """
    Chạy back-testing tín hiệu kỹ thuật trên dữ liệu lịch sử.
    """
    df = df.sort_values('time').reset_index(drop=True)
    n_rows = len(df)
    
    # Chiến lược optimal_induction cần MA200 và slope nên yêu cầu dữ liệu tối thiểu 220 phiên
    min_rows = 220 if strategy == "optimal_induction" else 55
    if n_rows < min_rows:
        return {
            'signals_found': 0,
            'results': [],
            'message': f'Dữ liệu quá ngắn để chạy back-testing (cần tối thiểu {min_rows} phiên)'
        }

    # Đọc optimal_weights.json nếu có
    weights = {}
    weights_file = os.path.join(os.path.dirname(__file__), 'optimal_weights.json')
    if os.path.exists(weights_file):
        try:
            with open(weights_file, 'r', encoding='utf-8') as f:
                weights = json.load(f)
        except Exception:
            pass
            
    if not weights:
        weights = {
            'macd_hist_dir_up': {'weight': 15},
            'bb_below_05': {'weight': 15},
            'rsi_below_65': {'weight': 15},
            'obv_slope_positive': {'weight': 15},
            'price_above_ma20': {'weight': 10},
            'vol_above_1_2x': {'weight': 10},
            'has_bullish_candle': {'weight': 10},
            'near_support': {'weight': 10}
        }

    # 1. Tính toán tất cả các chỉ báo trước (O(N))
    ma10 = calc_ma(df, 10)
    ma20 = calc_ma(df, 20)
    ma50 = calc_ma(df, 50)
    ma100 = calc_ma(df, 100)
    ma200 = calc_ma(df, 200)
    rsi = calc_rsi(df, 14)
    macd_line, signal_line, histogram = calc_macd(df)
    bb_upper, bb_middle, bb_lower, bandwidth, pct_b_series = calc_bollinger(df)
    volume_ma20 = df['volume'].rolling(20).mean()
    obv_series = calc_obv(df)
    obv_slope = calc_obv_slope(obv_series, 10)

    # Chuyển sang numpy array để tối ưu hóa tốc độ vòng lặp
    close_vals = df['close'].values
    open_vals = df['open'].values
    high_vals = df['high'].values
    low_vals = df['low'].values
    time_vals = df['time'].values
    vol_vals = df['volume'].values
    
    ma10_vals = ma10.values
    ma20_vals = ma20.values
    ma50_vals = ma50.values
    ma100_vals = ma100.values
    ma200_vals = ma200.values
    rsi_vals = rsi.values
    macd_vals = macd_line.values
    sig_vals = signal_line.values
    hist_vals = histogram.values
    bbl_vals = bb_lower.values
    bw_vals = bandwidth.values
    pct_b_vals = pct_b_series.values
    vol_ma_vals = volume_ma20.values
    obv_slope_vals = obv_slope.values

    results = []
    signals_found = 0
    
    # Hỗ trợ động để tính khoảng cách hỗ trợ cứng
    supports = []
    for idx in range(len(df)):
        if idx < 60:
            supports.append(0.0)
        else:
            recent_lows = low_vals[idx-60:idx]
            supports.append(float(np.min(recent_lows)))

    # 2. Quét dữ liệu tìm tín hiệu
    start_idx = 200 if strategy in ["optimal_induction", "weighted_score"] else 55
    
    for idx in range(start_idx, n_rows):
        price = float(close_vals[idx])
        is_signal = False
        buy_signals = ""
        score = 0
        rule_name = ""

        if strategy == "macd_hist_bearish_surge":
            # MACD histogram đỏ nhạt -> đỏ đậm + Khối lượng >= 1.1 lần phiên trước
            if (not np.isnan(hist_vals[idx]) and not np.isnan(hist_vals[idx-1]) and not np.isnan(hist_vals[idx-2])
                and hist_vals[idx] < 0 and hist_vals[idx-1] < 0
                and hist_vals[idx-1] > hist_vals[idx-2] 
                and hist_vals[idx] < hist_vals[idx-1]
                and not np.isnan(vol_vals[idx]) and not np.isnan(vol_vals[idx-1])
                and vol_vals[idx] >= 1.1 * vol_vals[idx-1]):
                is_signal = True
                buy_signals = "MACD Bearish Surge"
                rule_name = "Bẫy đảo chiều đỏ nhạt sang đỏ đậm + Vol >= 1.1x"

        elif strategy == "optimal_induction":
            # Thuật toán Quy nạp Tối ưu (Pro V5)
            # 1. Bộ lọc xu hướng dài hạn
            ma200_slope_40 = ma200_vals[idx] - ma200_vals[idx-40] if idx >= 40 and not np.isnan(ma200_vals[idx]) and not np.isnan(ma200_vals[idx-40]) else 0.0
            is_ma200_up = ma200_slope_40 > 0
            is_ma50_above_ma200 = not np.isnan(ma50_vals[idx]) and not np.isnan(ma200_vals[idx]) and ma50_vals[idx] > ma200_vals[idx] * 1.03
            
            # 2. Vùng mua an toàn (Chống mua đuổi)
            dist_to_ma20 = (price - ma20_vals[idx]) / ma20_vals[idx] if not np.isnan(ma20_vals[idx]) else 999.0
            price_above_ma20_tight = (price > ma20_vals[idx]) and (dist_to_ma20 <= 0.025) if not np.isnan(ma20_vals[idx]) else False
            is_not_overextended_long = not np.isnan(ma200_vals[idx]) and price <= ma200_vals[idx] * 1.25
            
            # 3. Tránh hưng phấn quá mua
            is_not_overbought = not np.isnan(rsi_vals[idx]) and rsi_vals[idx] <= 63
            
            # 4. Xung lực MACD Histogram cải thiện
            macd_hist_dir_up = not np.isnan(hist_vals[idx]) and not np.isnan(hist_vals[idx-1]) and hist_vals[idx] > hist_vals[idx-1]
            
            # 5. Dòng tiền OBV tích lũy
            obv_slope_positive = not np.isnan(obv_slope_vals[idx]) and obv_slope_vals[idx] > 0
            
            # 6. Nền tích lũy thắt chặt (Bollinger Bandwidth < 18%)
            is_squeezed = not np.isnan(bw_vals[idx]) and bw_vals[idx] < 18.0
            
            # Kích hoạt khi đồng thuận cả 6 điều kiện thắt chặt
            if is_ma200_up and is_ma50_above_ma200 and price_above_ma20_tight and is_not_overextended_long and is_not_overbought and macd_hist_dir_up and obv_slope_positive and is_squeezed:
                is_signal = True
                buy_signals = "Pro V5 Squeezed"
                rule_name = "Thuật toán Quy nạp Thắt chặt (Pro V5)"

        elif strategy == "weighted_score":
            # Thuật toán chấm điểm trọng số tối ưu từ Inductive Research
            # 1. Độ dốc MACD Histogram tăng
            if not np.isnan(hist_vals[idx]) and not np.isnan(hist_vals[idx-1]) and hist_vals[idx] > hist_vals[idx-1]:
                score += weights.get('macd_hist_dir_up', {}).get('weight', 15)
            # 2. Bollinger Bands %B < 0.5 (Nửa dưới dải)
            if not np.isnan(pct_b_vals[idx]) and pct_b_vals[idx] < 0.5:
                score += weights.get('bb_below_05', {}).get('weight', 15)
            # 3. RSI <= 65 (Chưa quá mua)
            if not np.isnan(rsi_vals[idx]) and rsi_vals[idx] <= 65:
                score += weights.get('rsi_below_65', {}).get('weight', 15)
            # 4. OBV Slope dương
            if not np.isnan(obv_slope_vals[idx]) and obv_slope_vals[idx] > 0:
                score += weights.get('obv_slope_positive', {}).get('weight', 15)
            # 5. Giá nằm trên MA20
            if not np.isnan(ma20_vals[idx]) and price > ma20_vals[idx]:
                score += weights.get('price_above_ma20', {}).get('weight', 10)
            # 6. Khối lượng đột biến > 1.2x
            vol_ma = vol_ma_vals[idx]
            vol_today = vol_vals[idx]
            if not np.isnan(vol_ma) and vol_ma > 0 and vol_today > vol_ma * 1.2:
                score += weights.get('vol_above_1_2x', {}).get('weight', 10)
            # 7. Nến đảo chiều tăng
            is_bullish_candle = False
            if idx >= 1:
                c0_close, c0_open, c0_high, c0_low = close_vals[idx], open_vals[idx], high_vals[idx], low_vals[idx]
                c1_close, c1_open = close_vals[idx-1], open_vals[idx-1]
                body0 = abs(c0_close - c0_open)
                range0 = c0_high - c0_low
                lower0 = min(c0_close, c0_open) - c0_low
                upper0 = c0_high - max(c0_close, c0_open)
                if (c0_close > c0_open or body0 < range0 * 0.3) and lower0 >= body0 * 2 and upper0 <= body0 * 0.5 and c1_close < c1_open:
                    is_bullish_candle = True
                elif c0_close > c0_open and c1_close < c1_open and c0_close > c1_open and c0_open < c1_close:
                    is_bullish_candle = True
            if is_bullish_candle:
                score += weights.get('has_bullish_candle', {}).get('weight', 10)
            # 8. Gần hỗ trợ cứng < 2%
            sup_val = supports[idx]
            if sup_val > 0 and abs(price - sup_val) / sup_val <= 0.02:
                score += weights.get('near_support', {}).get('weight', 10)
                
            if score >= 50:
                is_signal = True
                buy_signals = f"{score} Điểm"
                rule_name = f"Điểm số quy nạp đạt {score}đ"



        else: # multi_signal_buy (Mặc định đồng thuận 6 chỉ báo)
            count = 0
            # MA10
            if price > ma10_vals[idx]:
                count += 1
            # MA50
            if not np.isnan(ma50_vals[idx]) and price > ma50_vals[idx]:
                count += 1
            # MACD
            if not np.isnan(macd_vals[idx]) and not np.isnan(sig_vals[idx]) and macd_vals[idx] > sig_vals[idx]:
                count += 1
            # Bollinger BB Lower
            if not np.isnan(bbl_vals[idx]) and price < bbl_vals[idx]:
                count += 1
            # Volume TB20
            vol_ma = vol_ma_vals[idx]
            vol_today = vol_vals[idx]
            if not np.isnan(vol_ma) and vol_ma > 0 and vol_today > vol_ma * 1.2:
                count += 1
            # RSI
            if not np.isnan(rsi_vals[idx]) and rsi_vals[idx] < 35:
                count += 1

            if count >= threshold:
                is_signal = True
                buy_signals = f"Đồng thuận {count}/{threshold}"
                rule_name = f"Đồng thuận {count} chỉ báo kỹ thuật"

        if is_signal:
            signals_found += 1
            entry_price = price
            entry_date = str(time_vals[idx])[:10]

            # 1. Tính giá tương lai 3, 5, 10, 20 phiên để tương thích ngược
            p3 = float(close_vals[idx + 3]) if idx + 3 < n_rows else None
            p5 = float(close_vals[idx + 5]) if idx + 5 < n_rows else None
            p10 = float(close_vals[idx + 10]) if idx + 10 < n_rows else None
            p20 = float(close_vals[idx + 20]) if idx + 20 < n_rows else None

            def pct(target):
                if target is None:
                    return None
                return round((target - entry_price) / entry_price * 100, 2)

            # 2. Xử lý logic quản trị rủi ro TP/SL cho chiến lược optimal_induction
            # TP: 12% | SL: 6% | Hold: 15 phiên
            tp_pct = 12.0
            sl_pct = 6.0
            max_hold = 15
            
            pct_result = None
            exit_date = None
            exit_price = None
            trade_status = "Đang giữ"
            
            for h in range(1, max_hold + 1):
                future_idx = idx + h
                if future_idx >= n_rows:
                    break
                
                future_close = float(close_vals[future_idx])
                gain = (future_close - entry_price) / entry_price * 100
                
                if gain <= -sl_pct:
                    pct_result = -sl_pct
                    exit_price = entry_price * (1 - sl_pct / 100)
                    exit_date = str(time_vals[future_idx])[:10]
                    trade_status = "Cắt lỗ (SL)"
                    break
                elif gain >= tp_pct:
                    pct_result = tp_pct
                    exit_price = entry_price * (1 + tp_pct / 100)
                    exit_date = str(time_vals[future_idx])[:10]
                    trade_status = "Chốt lời (TP)"
                    break
                    
            if pct_result is None:
                end_idx = min(idx + max_hold, n_rows - 1)
                end_price = float(close_vals[end_idx])
                pct_result = round((end_price - entry_price) / entry_price * 100, 2)
                exit_price = end_price
                exit_date = str(time_vals[end_idx])[:10]
                if end_idx == n_rows - 1 and (n_rows - 1 - idx < max_hold):
                    trade_status = "Đang giữ"
                else:
                    trade_status = "Đóng phiên (15d)"

            results.append({
                'date': entry_date,
                'entry_price': round(entry_price, 2),
                'buy_signals': buy_signals,
                'price_3d': round(p3, 2) if p3 is not None else None,
                'price_5d': round(p5, 2) if p5 is not None else None,
                'price_10d': round(p10, 2) if p10 is not None else None,
                'price_20d': round(p20, 2) if p20 is not None else None,
                'pct_3d': pct(p3),
                'pct_5d': pct(p5),
                'pct_10d': pct(p10),
                'pct_20d': pct(p20),
                # Các thông số quản trị TP/SL động mới
                'pct_result': pct_result,
                'exit_date': exit_date,
                'exit_price': round(exit_price, 2) if exit_price is not None else None,
                'trade_status': trade_status,
                'rule_name': rule_name
            })

    if not results:
        return {
            'signals_found': 0,
            'win_rate': 0,
            'avg_win': 0,
            'avg_loss': 0,
            'expected_value': 0,
            'results': [],
            'message': 'Không tìm thấy đủ tín hiệu trong dữ liệu lịch sử'
        }

    # --- Thống kê cho các mốc thời gian ---
    stats = {}
    periods = [3, 5, 10, 20]
    
    for p in periods:
        pct_key = f'pct_{p}d'
        valid_results = [r for r in results if r[pct_key] is not None]
        wins = [r for r in valid_results if r[pct_key] > 0]
        losses = [r for r in valid_results if r[pct_key] <= 0]
        
        wr = round(len(wins) / len(valid_results) * 100, 1) if valid_results else 0
        avg_w = round(sum(r[pct_key] for r in wins) / len(wins), 2) if wins else 0
        avg_l = round(sum(r[pct_key] for r in losses) / len(losses), 2) if losses else 0
        ev = round((wr / 100 * avg_w) + ((1 - wr / 100) * avg_l), 2)
        
        stats[f'win_rate_{p}d'] = wr
        stats[f'win_count_{p}d'] = len(wins)
        stats[f'loss_count_{p}d'] = len(losses)
        stats[f'avg_win_{p}d'] = avg_w
        stats[f'avg_loss_{p}d'] = avg_l
        stats[f'ev_{p}d'] = ev

    # Thiết lập win_rate và expected_value đại diện dựa trên loại chiến lược
    if strategy == "optimal_induction":
        # Với chiến lược optimal_induction, kết quả được tính theo TP/SL động
        valid_trades = [r for r in results if r['pct_result'] is not None and r['trade_status'] != 'Đang giữ']
        wins = [r for r in valid_trades if r['pct_result'] > 0]
        losses = [r for r in valid_trades if r['pct_result'] <= 0]
        
        main_wr = round(len(wins) / len(valid_trades) * 100, 1) if valid_trades else 0.0
        avg_w = round(sum(r['pct_result'] for r in wins) / len(wins), 2) if wins else 0.0
        avg_l = round(sum(r['pct_result'] for r in losses) / len(losses), 2) if losses else 0.0
        main_ev = round((main_wr / 100 * avg_w) + ((1 - main_wr / 100) * avg_l), 2)
        
        stats['win_rate_15d_dynamic'] = main_wr
        stats['ev_15d_dynamic'] = main_ev
        stats['win_count_15d_dynamic'] = len(wins)
        stats['loss_count_15d_dynamic'] = len(losses)
        stats['avg_win_15d_dynamic'] = avg_w
        stats['avg_loss_15d_dynamic'] = avg_l
    else:
        main_p = 5 if strategy in ["macd_hist_bearish_surge", "weighted_score"] else 10
        main_wr = stats[f'win_rate_{main_p}d']
        main_ev = stats[f'ev_{main_p}d']

    # Xác định Verdict (Nhận xét của thuật toán đối với nhận định của người dùng)
    verdict = ""
    verdict_class = ""
    
    if strategy == "macd_hist_bearish_surge":
        wr_3d = stats['win_rate_3d']
        wr_5d = stats['win_rate_5d']
        ev_3d = stats['ev_3d']
        ev_5d = stats['ev_5d']
        
        if wr_3d >= 50 and wr_5d >= 50 and ev_3d > 0 and ev_5d > 0:
            if wr_3d >= 58 or wr_5d >= 58:
                verdict = "NHẬN ĐỊNH RẤT CHÍNH XÁC! Tín hiệu này có xác suất thắng cao vượt trội sau 3-5 phiên."
                verdict_class = "success"
            else:
                verdict = "NHẬN ĐỊNH ĐÚNG! Tín hiệu này có xác suất thắng tốt (>50%) và Expected Value dương."
                verdict_class = "info"
        elif wr_3d < 50 and wr_5d < 50:
            verdict = "NHẬN ĐỊNH CHƯA CHÍNH XÁC! Dữ liệu cho thấy tỷ lệ thắng sau 3-5 phiên đều dưới 50%."
            verdict_class = "danger"
        else:
            verdict = "NHẬN ĐỊNH TRUNG LẬP / CÓ SAI SỐ! Hiệu quả sau 3 phiên và 5 phiên không đồng nhất hoặc Expected Value quá thấp."
            verdict_class = "warning"
            
    elif strategy == "optimal_induction":
        if main_wr >= 55 and main_ev > 0:
            verdict = f"THUẬT TOÁN ĐẠT HIỆU QUẢ CAO VƯỢT TRỘI! Chiến lược thắt chặt mang lại tỷ lệ thắng {main_wr}% (TP: 12%, SL: 6%, Hold 15 phiên) với Expected Value cực tốt (+{main_ev}%)."
            verdict_class = "success"
        else:
            verdict = f"THUẬT TOÁN ĐẠT HIỆU QUẢ TRUNG BÌNH. Tỷ lệ thắng đạt {main_wr}% với Expected Value đạt +{main_ev}%."
            verdict_class = "info"
            
    elif strategy == "weighted_score":
        wr_5d = stats['win_rate_5d']
        ev_5d = stats['ev_5d']
        
        if wr_5d >= 55 and ev_5d > 0:
            verdict = f"THUẬT TOÁN ĐẠT HIỆU QUẢ CAO! Trọng số tối ưu mang lại tỷ lệ thắng {wr_5d}% sau 5 phiên và Expected Value dương (+{ev_5d}%)."
            verdict_class = "success"
        elif wr_5d >= 48 and ev_5d >= 0:
            verdict = f"THUẬT TOÁN ĐẠT HIỆU QUẢ TRUNG BÌNH. Tỷ lệ thắng đạt {wr_5d}% sau 5 phiên với Expected Value hòa/dương nhẹ."
            verdict_class = "info"
        else:
            verdict = f"THUẬT TOÁN ĐẠT HIỆU QUẢ THẤP. Dữ liệu lịch sử cho thấy tỷ lệ thắng chỉ đạt {wr_5d}% sau 5 phiên (EV: {ev_5d}%)."
            verdict_class = "danger"
            
    else:
        if main_wr >= 55 and main_ev > 0:
            verdict = f"Chiến lược đồng thuận có hiệu quả tốt với tỷ lệ thắng {main_wr}% sau 10 phiên."
            verdict_class = "success"
        else:
            verdict = f"Chiến lược đồng thuận có hiệu quả kém hoặc trung bình (Win Rate {main_wr}%)."
            verdict_class = "warning"

    return {
        'signals_found': signals_found,
        'valid_signals': len(results),
        'stats': stats,
        'win_rate': main_wr,  # Để tương thích ngược với Dashboard
        'expected_value': main_ev, # Tương thích ngược
        'ev_label': '✅ Dương (đáng tin)' if main_ev > 0 else '❌ Âm (cần thận trọng)',
        'reliability': 'Cao' if main_wr >= 55 and main_ev > 0 else ('Trung bình' if main_wr >= 48 else 'Thấp'),
        'verdict': verdict,
        'verdict_class': verdict_class,
        'results': results, # Trả về danh sách để vẽ bảng
        'message': f"Phân tích {signals_found} tín hiệu '{strategy}' trong lịch sử",
        'strategy': strategy
    }
