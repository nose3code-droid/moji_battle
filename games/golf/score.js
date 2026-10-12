// スコアの呼び名とランク
export function holeName(strokes, par) {
  if (strokes === 1 && par > 1) return 'ホールインワン';
  const d = strokes - par;
  if (d <= -3) return 'アルバトロス';
  return { '-2': 'イーグル', '-1': 'バーディ', '0': 'パー', '1': 'ボギー', '2': 'ダブルボギー' }[d] || 'トリプルボギー以上';
}

export const fmtDiff = d => (d > 0 ? '+' + d : d === 0 ? '±0' : String(d));

// 全ホールの合計（パー比）→ ランク
export function rankOf(diff) {
  if (diff <= -4) return { rank: 'S', title: '文字ゴルフの神様' };
  if (diff <= -1) return { rank: 'A', title: 'プロ級' };
  if (diff <= 3) return { rank: 'B', title: '上級者' };
  if (diff <= 8) return { rank: 'C', title: 'なかなか' };
  return { rank: 'D', title: '練習あるのみ' };
}

// 字の性格 → ひとこと
export function describe(t) {
  const out = [];
  if (t.flat >= 0.6) out.push('平たくて氷のように滑る');
  else if (t.roll >= 0.7) out.push('丸くてよく転がり、止まりにくい');
  else if (t.roll <= 0.3) out.push('角ばっていて転がりにくく、止まりやすい');
  else out.push('ふつうに転がる');
  if (t.heavy >= 0.6) out.push('重くて壁で跳ね返りにくい（砂にも沈む）');
  else if (t.heavy <= 0.2) out.push('軽くて壁でよく跳ねる');
  return out.join('。') + '。';
}
