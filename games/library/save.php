<?php
// 夜の文字館：セーブデータをサーバーに保存する簡単な PHP（データベース不要）
// 使い方：このファイルを index.html と同じフォルダに置き、main.js の SERVER_SAVE_URL を './save.php' にする。
//   saves/ フォルダは PHP が書き込める権限（705 や 755）にしてください。saves/.htaccess で外から直接読めないようにしてあります。
// 仕組み：ブラウザが作ったランダムな ID ごとに saves/<ID>.json を 1 つ作る。ログインは無く、ID を知っている人だけが読み書きできる。

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const SAVE_DIR = __DIR__ . '/saves';
const MAX_BYTES = 4096;   // これより大きいデータは受け付けない
const N_LEVELS = 5;       // 階の数（main.js の LEVELS と合わせる）

function fail(int $code, string $msg): void {
  http_response_code($code);
  echo json_encode(['error' => $msg]);
  exit;
}

function validId($id): bool {
  return is_string($id) && preg_match('/^[a-f0-9-]{36}$/', $id) === 1;
}

// セーブの形が正しいか確認し、余計な項目を捨てて作り直す
function cleanData($d): ?array {
  if (!is_array($d) || !isset($d['got'], $d['cp']) || !is_array($d['got']) || !is_array($d['cp'])) return null;
  if (count($d['got']) > 10) return null;
  $lv = fn($v) => is_int($v) && $v >= 0 && $v < N_LEVELS;
  if (!$lv($d['level'] ?? null) || !$lv($d['cp']['level'] ?? null)) return null;
  if (!is_numeric($d['cp']['x'] ?? null) || !is_numeric($d['cp']['y'] ?? null)) return null;
  return [
    'level' => $d['level'],
    'got' => array_map('boolval', array_values($d['got'])),
    'doorOpen' => !empty($d['doorOpen']),
    'key' => !empty($d['key']),
    'cp' => ['level' => $d['cp']['level'], 'x' => (float)$d['cp']['x'], 'y' => (float)$d['cp']['y']],
    'met' => !empty($d['met']),
    'caught' => max(0, (int)($d['caught'] ?? 0)),
    'ended' => !empty($d['ended']),
    'updatedAt' => (int)($d['updatedAt'] ?? 0),
  ];
}

if (!is_dir(SAVE_DIR) && !mkdir(SAVE_DIR, 0755, true)) fail(500, 'no save dir');

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $id = $_GET['id'] ?? '';
  if (!validId($id)) fail(400, 'bad id');
  $file = SAVE_DIR . "/$id.json";
  if (!is_file($file)) { echo json_encode(['data' => null]); exit; }
  echo json_encode(['data' => json_decode(file_get_contents($file), true)]);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
  if ($raw === false || strlen($raw) > MAX_BYTES) fail(413, 'too large');
  $body = json_decode($raw, true);
  if (!is_array($body) || !validId($body['id'] ?? null)) fail(400, 'bad id');
  $data = cleanData($body['data'] ?? null);
  if ($data === null) fail(400, 'bad data');
  $file = SAVE_DIR . '/' . $body['id'] . '.json';
  $tmp = $file . '.tmp';
  // いったん別名で書いてから置き換える（書き込み途中で壊れないように）
  if (file_put_contents($tmp, json_encode($data), LOCK_EX) === false || !rename($tmp, $file)) fail(500, 'write failed');
  echo json_encode(['ok' => true]);
  exit;
}

fail(405, 'method not allowed');
