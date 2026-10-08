// ブラウザとサーバー（server.js）で共有する設定
// フォント：Noto Sans JP Bold（OFL、静的版）。世界ランキングの結果が変わらないよう、コミットを固定する
// （可変版は輪郭が重なっていて穴の判定が崩れるので使わない）
export const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf';

// コースや物理を変えたら上げる。世界ランキングはこの番号ごとに別になる
export const COURSE_VERSION = 1;

export const NAME_MAX = 12;   // ニックネームの最大文字数
