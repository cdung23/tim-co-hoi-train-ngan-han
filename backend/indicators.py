"""
indicators.py — Tính toán 8 chỉ báo kỹ thuật từ dữ liệu OHLCV
Chỉ báo: MA10, MA50, RSI(14), MACD(12,26,9), BB(20), OBV, Volume TB20
"""

import pandas as pd
import numpy as np


def calc_ma(df: pd.DataFrame, period: int) -> pd.Series:
    """Simple Moving Average"""
    return df['close'].rolling(window=period).mean()


def calc_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Relative Strength Index (RSI)"""
    delta = df['close'].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=period - 1, min_periods=period).mean()
    avg_loss = loss.ewm(com=period - 1, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calc_macd(df: pd.DataFrame, fast=12, slow=26, signal=9):
    """MACD Line, Signal Line, Histogram"""
    ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
    ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calc_bollinger(df: pd.DataFrame, period: int = 20, std_mult: float = 2.0):
    """Bollinger Bands: Upper, Middle, Lower, %B, Bandwidth"""
    middle = df['close'].rolling(window=period).mean()
    std = df['close'].rolling(window=period).std()
    upper = middle + (std_mult * std)
    lower = middle - (std_mult * std)
    bandwidth = ((upper - lower) / middle) * 100
    pct_b = (df['close'] - lower) / (upper - lower + 1e-10)
    return upper, middle, lower, bandwidth, pct_b


def calc_obv(df: pd.DataFrame) -> pd.Series:
    """On Balance Volume"""
    obv = [0]
    for i in range(1, len(df)):
        if df['close'].iloc[i] > df['close'].iloc[i - 1]:
            obv.append(obv[-1] + df['volume'].iloc[i])
        elif df['close'].iloc[i] < df['close'].iloc[i - 1]:
            obv.append(obv[-1] - df['volume'].iloc[i])
        else:
            obv.append(obv[-1])
    return pd.Series(obv, index=df.index)


def calc_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range (ATR)"""
    high = df['high']
    low = df['low']
    close = df['close']
    
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean()
    return atr


def calc_obv_slope(obv_series: pd.Series, lookback: int = 10) -> pd.Series:
    """Tính độ dốc OBV (On Balance Volume Slope) trên cửa sổ lookback"""
    slopes = [0.0] * len(obv_series)
    for i in range(lookback, len(obv_series)):
        y = obv_series.iloc[i - lookback + 1: i + 1].values
        x = np.arange(lookback)
        slope, _ = np.polyfit(x, y, 1)
        slopes[i] = float(slope)
    return pd.Series(slopes, index=obv_series.index)



def get_obv_trend(obv_series: pd.Series, lookback: int = 20) -> str:
    """Đánh giá xu hướng OBV trong N phiên gần nhất"""
    if len(obv_series) < lookback:
        return "Không đủ dữ liệu"
    recent = obv_series.iloc[-lookback:]
    slope = np.polyfit(range(lookback), recent.values, 1)[0]
    if slope > 0:
        return "Tăng dần (Tích lũy)"
    elif slope < 0:
        return "Giảm dần (Phân phối)"
    else:
        return "Đi ngang"


def get_support_resistance(df: pd.DataFrame, lookback: int = 60):
    """Tính vùng hỗ trợ và kháng cự đơn giản từ min/max N phiên"""
    recent = df.tail(lookback)
    support = round(float(recent['low'].min()), 2)
    resistance = round(float(recent['high'].max()), 2)
    return support, resistance


def calc_all_indicators(df: pd.DataFrame) -> dict:
    """Tính toàn bộ chỉ báo và trả về dict kết quả cho phiên mới nhất"""
    df = df.copy()
    df = df.sort_values('time').reset_index(drop=True)

    # --- Tính toán ---
    ma10 = calc_ma(df, 10)
    ma50 = calc_ma(df, 50)
    rsi = calc_rsi(df, 14)
    macd_line, signal_line, histogram = calc_macd(df)
    bb_upper, bb_middle, bb_lower, bandwidth, pct_b = calc_bollinger(df)
    obv = calc_obv(df)
    volume_ma20 = df['volume'].rolling(20).mean()
    support, resistance = get_support_resistance(df)

    # --- Giá trị phiên cuối ---
    last = -1
    price = round(float(df['close'].iloc[last]), 2)
    prev_price = round(float(df['close'].iloc[-2]), 2)
    price_change = round(price - prev_price, 2)
    price_change_pct = round((price_change / prev_price) * 100, 2) if prev_price else 0

    rsi_val = round(float(rsi.iloc[last]), 2)
    macd_val = round(float(macd_line.iloc[last]), 4)
    signal_val = round(float(signal_line.iloc[last]), 4)
    hist_val = round(float(histogram.iloc[last]), 4)
    bb_upper_val = round(float(bb_upper.iloc[last]), 2)
    bb_middle_val = round(float(bb_middle.iloc[last]), 2)
    bb_lower_val = round(float(bb_lower.iloc[last]), 2)
    bandwidth_val = round(float(bandwidth.iloc[last]), 2)
    pct_b_val = round(float(pct_b.iloc[last]), 4)
    obv_val = int(obv.iloc[last])
    obv_trend = get_obv_trend(obv)
    volume_today = int(df['volume'].iloc[last])
    volume_ma20_val = int(volume_ma20.iloc[last]) if not pd.isna(volume_ma20.iloc[last]) else 0
    volume_ratio = round(volume_today / volume_ma20_val, 2) if volume_ma20_val > 0 else 0

    # --- Tín hiệu từng chỉ báo ---
    signals = {}



    # MACD signal
    if macd_val > signal_val and hist_val > 0:
        signals['macd'] = {'signal': 'buy', 'label': '🟢 Bullish', 'macd': macd_val, 'signal_line': signal_val, 'histogram': hist_val}
    elif macd_val < signal_val and hist_val < 0:
        signals['macd'] = {'signal': 'sell', 'label': '🔴 Bearish', 'macd': macd_val, 'signal_line': signal_val, 'histogram': hist_val}
    else:
        signals['macd'] = {'signal': 'neutral', 'label': '⚪ Trung lập', 'macd': macd_val, 'signal_line': signal_val, 'histogram': hist_val}

    # MA signal
    ma10_val = round(float(ma10.iloc[last]), 2)
    ma50_val = round(float(ma50.iloc[last]), 2) if not pd.isna(ma50.iloc[last]) else None
    if price > ma10_val and (ma50_val is None or price > ma50_val):
        signals['ma'] = {'signal': 'buy', 'label': '🟢 Giá > MA10 > MA50', 'ma10': ma10_val, 'ma50': ma50_val}
    elif price < ma10_val and (ma50_val is None or price < ma50_val):
        signals['ma'] = {'signal': 'sell', 'label': '🔴 Giá < MA10 < MA50', 'ma10': ma10_val, 'ma50': ma50_val}
    else:
        signals['ma'] = {'signal': 'neutral', 'label': '⚪ Hỗn hợp', 'ma10': ma10_val, 'ma50': ma50_val}

    # BB signal
    if price > bb_upper_val:
        signals['bb'] = {'signal': 'sell', 'label': '🔴 Trên dải trên', 'upper': bb_upper_val, 'middle': bb_middle_val, 'lower': bb_lower_val, 'bandwidth': bandwidth_val, 'pct_b': pct_b_val}
    elif price < bb_lower_val:
        signals['bb'] = {'signal': 'buy', 'label': '🟢 Dưới dải dưới', 'upper': bb_upper_val, 'middle': bb_middle_val, 'lower': bb_lower_val, 'bandwidth': bandwidth_val, 'pct_b': pct_b_val}
    elif bandwidth_val < 5:
        signals['bb'] = {'signal': 'neutral', 'label': '⚪ BB Squeeze', 'upper': bb_upper_val, 'middle': bb_middle_val, 'lower': bb_lower_val, 'bandwidth': bandwidth_val, 'pct_b': pct_b_val}
    else:
        signals['bb'] = {'signal': 'neutral', 'label': '⚪ Trong dải', 'upper': bb_upper_val, 'middle': bb_middle_val, 'lower': bb_lower_val, 'bandwidth': bandwidth_val, 'pct_b': pct_b_val}



    # Volume signal
    if volume_ratio > 2.0:
        signals['volume'] = {'signal': 'strong', 'label': f'🟡 Đột biến ×{volume_ratio}', 'today': volume_today, 'ma20': volume_ma20_val, 'ratio': volume_ratio}
    elif volume_ratio > 1.2:
        signals['volume'] = {'signal': 'buy', 'label': f'🟢 Cao hơn TB ({volume_ratio}×)', 'today': volume_today, 'ma20': volume_ma20_val, 'ratio': volume_ratio}
    elif volume_ratio < 0.7:
        signals['volume'] = {'signal': 'sell', 'label': f'🔴 Thấp hơn TB ({volume_ratio}×)', 'today': volume_today, 'ma20': volume_ma20_val, 'ratio': volume_ratio}
    else:
        signals['volume'] = {'signal': 'neutral', 'label': f'⚪ Bình thường ({volume_ratio}×)', 'today': volume_today, 'ma20': volume_ma20_val, 'ratio': volume_ratio}

    # --- Đếm tín hiệu đồng thuận ---
    buy_count = sum(1 for s in signals.values() if s.get('signal') in ['buy', 'neutral_buy'])
    sell_count = sum(1 for s in signals.values() if s.get('signal') in ['sell'])

    return {
        'price': price,
        'prev_price': prev_price,
        'price_change': price_change,
        'price_change_pct': price_change_pct,
        'support': support,
        'resistance': resistance,
        'signals': signals,
        'summary': {
            'buy_count': buy_count,
            'sell_count': sell_count,
            'total': 4,
            'recommendation': 'MUA' if buy_count >= 3 else ('BÁN' if sell_count >= 3 else 'CHỜ')
        }
    }
