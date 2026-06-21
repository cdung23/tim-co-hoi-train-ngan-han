"""
candlestick.py — Nhận diện 15+ mô hình nến Nhật tự động
Phân loại: Bullish Reversal / Bearish Reversal / Continuation
Kèm đánh giá độ tin cậy dựa trên vị trí hỗ trợ/kháng cự
"""

import pandas as pd
import numpy as np


def body_size(row) -> float:
    """Kích thước thân nến"""
    return abs(row['close'] - row['open'])


def total_range(row) -> float:
    """Tổng biên độ nến (High - Low)"""
    return row['high'] - row['low']


def upper_shadow(row) -> float:
    """Bóng nến trên"""
    return row['high'] - max(row['close'], row['open'])


def lower_shadow(row) -> float:
    """Bóng nến dưới"""
    return min(row['close'], row['open']) - row['low']


def is_bullish(row) -> bool:
    return row['close'] > row['open']


def is_bearish(row) -> bool:
    return row['close'] < row['open']


def detect_patterns(df: pd.DataFrame, support: float = None, resistance: float = None) -> list:
    """
    Nhận diện mô hình nến từ 5 phiên cuối
    Trả về list các pattern được phát hiện
    """
    patterns = []
    if len(df) < 3:
        return patterns

    df = df.sort_values('time').reset_index(drop=True)
    n = len(df)

    # --- Phân tích nến hiện tại (phiên cuối) ---
    c0 = df.iloc[-1]   # Nến hiện tại
    c1 = df.iloc[-2]   # Nến trước
    c2 = df.iloc[-3] if n >= 3 else None

    body0 = body_size(c0)
    body1 = body_size(c1)
    range0 = total_range(c0)
    upper0 = upper_shadow(c0)
    lower0 = lower_shadow(c0)
    upper1 = upper_shadow(c1)
    lower1 = lower_shadow(c1)

    avg_body = df['close'].iloc[-10:].diff().abs().mean() if len(df) >= 10 else body0

    def near_support(price):
        if support is None:
            return False
        return abs(price - support) / (support + 1e-10) < 0.03

    def near_resistance(price):
        if resistance is None:
            return False
        return abs(price - resistance) / (resistance + 1e-10) < 0.03

    # ===========================================================
    # BULLISH REVERSAL PATTERNS
    # ===========================================================

    # 1. Hammer (Búa): thân nhỏ ở trên, bóng dưới dài, xuất hiện sau downtrend
    if (is_bullish(c0) or body0 < range0 * 0.3) and \
       lower0 >= body0 * 2 and \
       upper0 <= body0 * 0.5 and \
       is_bearish(c1):
        confidence = 'Cao' if near_support(c0['low']) else 'Trung bình'
        patterns.append({
            'name': 'Hammer (Búa)',
            'type': 'bullish',
            'emoji': '🔨',
            'description': 'Bóng dưới dài ≥2× thân nến, thân nhỏ ở đỉnh — Tín hiệu đảo chiều tăng',
            'confidence': confidence,
            'candle_index': n - 1
        })

    # 2. Inverted Hammer: thân nhỏ ở dưới, bóng trên dài
    if (is_bullish(c0) or body0 < range0 * 0.3) and \
       upper0 >= body0 * 2 and \
       lower0 <= body0 * 0.5 and \
       is_bearish(c1):
        patterns.append({
            'name': 'Inverted Hammer (Búa ngược)',
            'type': 'bullish',
            'emoji': '🔄',
            'description': 'Bóng trên dài ≥2× thân — Tín hiệu đảo chiều tăng tiềm năng, cần xác nhận',
            'confidence': 'Thấp',
            'candle_index': n - 1
        })

    # 3. Bullish Engulfing: nến xanh "nuốt" hoàn toàn thân nến đỏ trước
    if is_bullish(c0) and is_bearish(c1) and \
       c0['open'] <= c1['close'] and c0['close'] >= c1['open'] and \
       body0 > body1:
        confidence = 'Cao' if near_support(c0['low']) else 'Trung bình'
        patterns.append({
            'name': 'Bullish Engulfing (Bao phủ tăng)',
            'type': 'bullish',
            'emoji': '📈',
            'description': 'Nến xanh nuốt hoàn toàn nến đỏ trước — Tín hiệu đảo chiều tăng mạnh',
            'confidence': confidence,
            'candle_index': n - 1
        })

    # 4. Morning Star: 3 nến Đỏ lớn → Doji → Xanh lớn
    if c2 is not None and is_bearish(c2) and is_bullish(c0) and \
       body_size(c2) > avg_body * 1.2 and body0 > avg_body * 1.2 and \
       body1 < avg_body * 0.5 and \
       c0['close'] > (c2['open'] + c2['close']) / 2:
        patterns.append({
            'name': 'Morning Star (Sao mai)',
            'type': 'bullish',
            'emoji': '⭐',
            'description': 'Nến đỏ → Doji → Nến xanh — Tín hiệu đảo chiều tăng rất đáng tin',
            'confidence': 'Cao',
            'candle_index': n - 1
        })

    # 5. Piercing Line
    if is_bearish(c1) and is_bullish(c0) and \
       c0['open'] < c1['close'] and \
       c0['close'] > (c1['open'] + c1['close']) / 2 and \
       c0['close'] < c1['open']:
        patterns.append({
            'name': 'Piercing Line (Đường xuyên thấu)',
            'type': 'bullish',
            'emoji': '💉',
            'description': 'Nến xanh mở dưới và đóng trên 50% thân nến đỏ — Đảo chiều tăng',
            'confidence': 'Trung bình',
            'candle_index': n - 1
        })

    # ===========================================================
    # BEARISH REVERSAL PATTERNS
    # ===========================================================

    # 6. Shooting Star: thân nhỏ ở dưới, bóng trên dài, sau uptrend
    if (is_bearish(c0) or body0 < range0 * 0.3) and \
       upper0 >= body0 * 2 and \
       lower0 <= body0 * 0.5 and \
       is_bullish(c1):
        confidence = 'Cao' if near_resistance(c0['high']) else 'Trung bình'
        patterns.append({
            'name': 'Shooting Star (Sao băng)',
            'type': 'bearish',
            'emoji': '💫',
            'description': 'Bóng trên dài ≥2× thân, thân nhỏ ở đáy — Tín hiệu đảo chiều giảm',
            'confidence': confidence,
            'candle_index': n - 1
        })

    # 7. Hanging Man: giống Hammer nhưng xuất hiện sau uptrend
    if (is_bearish(c0) or body0 < range0 * 0.3) and \
       lower0 >= body0 * 2 and \
       upper0 <= body0 * 0.5 and \
       is_bullish(c1):
        patterns.append({
            'name': 'Hanging Man (Người treo cổ)',
            'type': 'bearish',
            'emoji': '🪝',
            'description': 'Bóng dưới dài sau uptrend — Cảnh báo đảo chiều giảm, cần xác nhận',
            'confidence': 'Thấp',
            'candle_index': n - 1
        })

    # 8. Bearish Engulfing: nến đỏ nuốt hoàn toàn nến xanh
    if is_bearish(c0) and is_bullish(c1) and \
       c0['open'] >= c1['close'] and c0['close'] <= c1['open'] and \
       body0 > body1:
        confidence = 'Cao' if near_resistance(c0['high']) else 'Trung bình'
        patterns.append({
            'name': 'Bearish Engulfing (Bao phủ giảm)',
            'type': 'bearish',
            'emoji': '📉',
            'description': 'Nến đỏ nuốt hoàn toàn nến xanh — Tín hiệu đảo chiều giảm mạnh',
            'confidence': confidence,
            'candle_index': n - 1
        })

    # 9. Evening Star: 3 nến Xanh lớn → Doji → Đỏ lớn
    if c2 is not None and is_bullish(c2) and is_bearish(c0) and \
       body_size(c2) > avg_body * 1.2 and body0 > avg_body * 1.2 and \
       body1 < avg_body * 0.5 and \
       c0['close'] < (c2['open'] + c2['close']) / 2:
        patterns.append({
            'name': 'Evening Star (Sao hôm)',
            'type': 'bearish',
            'emoji': '🌆',
            'description': 'Nến xanh → Doji → Nến đỏ — Tín hiệu đảo chiều giảm rất đáng tin',
            'confidence': 'Cao',
            'candle_index': n - 1
        })

    # 10. Dark Cloud Cover
    if is_bullish(c1) and is_bearish(c0) and \
       c0['open'] > c1['close'] and \
       c0['close'] < (c1['open'] + c1['close']) / 2 and \
       c0['close'] > c1['open']:
        patterns.append({
            'name': 'Dark Cloud Cover (Mây đen)',
            'type': 'bearish',
            'emoji': '☁️',
            'description': 'Nến đỏ mở trên đỉnh và đóng dưới 50% thân xanh — Đảo chiều giảm',
            'confidence': 'Trung bình',
            'candle_index': n - 1
        })

    # ===========================================================
    # CONTINUATION / NEUTRAL PATTERNS
    # ===========================================================

    # 11. Doji: thân rất nhỏ (do dự)
    if body0 < range0 * 0.1 and range0 > 0:
        patterns.append({
            'name': 'Doji (Do dự)',
            'type': 'neutral',
            'emoji': '➕',
            'description': 'Thân nến gần như bằng 0 — Thị trường do dự, chờ xác nhận nến tiếp theo',
            'confidence': 'Thấp',
            'candle_index': n - 1
        })

    # 12. Marubozu tăng: nến xanh lớn, không có bóng
    if is_bullish(c0) and body0 > avg_body * 1.5 and \
       upper0 < body0 * 0.05 and lower0 < body0 * 0.05:
        patterns.append({
            'name': 'Bullish Marubozu (Tăng mạnh)',
            'type': 'bullish',
            'emoji': '🚀',
            'description': 'Nến xanh lớn không có bóng — Lực mua áp đảo, xu hướng tăng tiếp diễn',
            'confidence': 'Cao',
            'candle_index': n - 1
        })

    # 13. Marubozu giảm
    if is_bearish(c0) and body0 > avg_body * 1.5 and \
       upper0 < body0 * 0.05 and lower0 < body0 * 0.05:
        patterns.append({
            'name': 'Bearish Marubozu (Giảm mạnh)',
            'type': 'bearish',
            'emoji': '⬇️',
            'description': 'Nến đỏ lớn không có bóng — Lực bán áp đảo, xu hướng giảm tiếp diễn',
            'confidence': 'Cao',
            'candle_index': n - 1
        })

    # 14. Three White Soldiers
    if n >= 3 and c2 is not None:
        if is_bullish(c0) and is_bullish(c1) and is_bullish(c2) and \
           c0['close'] > c1['close'] > c2['close'] and \
           body0 > avg_body * 0.8 and body1 > avg_body * 0.8:
            patterns.append({
                'name': 'Three White Soldiers (3 lính trắng)',
                'type': 'bullish',
                'emoji': '⚔️',
                'description': '3 nến xanh tăng dần liên tiếp — Xu hướng tăng mạnh, momentum tốt',
                'confidence': 'Cao',
                'candle_index': n - 1
            })

    # 15. Three Black Crows
    if n >= 3 and c2 is not None:
        if is_bearish(c0) and is_bearish(c1) and is_bearish(c2) and \
           c0['close'] < c1['close'] < c2['close'] and \
           body0 > avg_body * 0.8 and body1 > avg_body * 0.8:
            patterns.append({
                'name': 'Three Black Crows (3 quạ đen)',
                'type': 'bearish',
                'emoji': '🐦‍⬛',
                'description': '3 nến đỏ giảm dần liên tiếp — Xu hướng giảm mạnh, momentum xấu',
                'confidence': 'Cao',
                'candle_index': n - 1
            })

    # Nếu không có mô hình nào
    if not patterns:
        patterns.append({
            'name': 'Không có mô hình rõ',
            'type': 'neutral',
            'emoji': '❓',
            'description': 'Nến hiện tại không khớp với mô hình chuẩn nào. Cần quan sát thêm.',
            'confidence': 'Thấp',
            'candle_index': n - 1
        })

    return patterns


def get_recent_candles_description(df: pd.DataFrame, n: int = 5) -> list:
    """Trả về mô tả 5 nến gần nhất"""
    result = []
    recent = df.tail(n).sort_values('time')
    for _, row in recent.iterrows():
        color = 'Xanh' if is_bullish(row) else 'Đỏ'
        body = body_size(row)
        rng = total_range(row)
        up_sh = upper_shadow(row)
        lo_sh = lower_shadow(row)
        desc = f"{color}"
        if body < rng * 0.1:
            desc += " (Doji)"
        elif body > rng * 0.8:
            desc += " (Marubozu)"
        elif up_sh > body * 1.5:
            desc += " (bóng trên dài)"
        elif lo_sh > body * 1.5:
            desc += " (bóng dưới dài)"
        else:
            desc += " (thân thường)"
        result.append({
            'date': str(row['time'])[:10],
            'open': round(float(row['open']), 2),
            'high': round(float(row['high']), 2),
            'low': round(float(row['low']), 2),
            'close': round(float(row['close']), 2),
            'volume': int(row['volume']),
            'description': desc
        })
    return result
