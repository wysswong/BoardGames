const assert = require('assert');
const R = require('../utils/rules.js');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.error('  FAIL  ' + name + '\n        ' + err.message);
    process.exit(1);
  }
}

// 带双方将帅的基础棋盘，将帅不同列以避免照面干扰测试
function board() {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(9, 4)] = 'K';
  b[R.pos(0, 3)] = 'k';
  return b;
}

function put(b, piece, row, col) {
  b[R.pos(row, col)] = piece;
  return b;
}

function movesFrom(b, row, col) {
  return R.legalMovesFrom(b, R.pos(row, col));
}

function has(moves, row, col) {
  return moves.includes(R.pos(row, col));
}

test('初始棋盘布局与标准走法数', () => {
  const b = R.initialBoard();
  assert.strictEqual(b.length, 90);
  assert.strictEqual(b[R.pos(9, 4)], 'K');
  assert.strictEqual(b[R.pos(0, 4)], 'k');
  assert.strictEqual(b.filter(p => p === 'P').length, 5);
  assert.strictEqual(b.filter(p => p === 'p').length, 5);
  assert.strictEqual(R.allLegalMoves(b, 'red').length, 44);
  assert.strictEqual(R.allLegalMoves(b, 'black').length, 44);
});

test('applyMove 返回新棋盘且不修改原棋盘', () => {
  const b = put(board(), 'R', 5, 0);
  const next = R.applyMove(b, R.pos(5, 0), R.pos(4, 0));
  assert.strictEqual(b[R.pos(5, 0)], 'R');
  assert.strictEqual(next[R.pos(5, 0)], null);
  assert.strictEqual(next[R.pos(4, 0)], 'R');
});

test('车：直线走、吃对方子、不越子', () => {
  const b = put(board(), 'R', 5, 4);
  put(b, 'P', 5, 6);
  put(b, 'p', 3, 4);
  const m = movesFrom(b, 5, 4);
  assert.strictEqual(has(m, 3, 4), true, '应能吃对方子');
  assert.strictEqual(has(m, 2, 4), false, '不能越过对方子');
  assert.strictEqual(has(m, 5, 5), true);
  assert.strictEqual(has(m, 5, 6), false, '不能吃己方子');
  assert.strictEqual(has(m, 5, 7), false, '不能越己方子');
});

test('马：蹩马腿', () => {
  const b = put(board(), 'N', 5, 2);
  assert.strictEqual(has(movesFrom(b, 5, 2), 3, 1), true);
  assert.strictEqual(has(movesFrom(b, 5, 2), 3, 3), true);
  put(b, 'P', 4, 2);
  const m = movesFrom(b, 5, 2);
  assert.strictEqual(has(m, 3, 1), false, '上方马腿被蹩');
  assert.strictEqual(has(m, 3, 3), false, '上方马腿被蹩');
  assert.strictEqual(has(m, 4, 4), true, '横向马腿不受影响');
});

test('炮：必须隔恰好一子吃子', () => {
  const b = put(board(), 'C', 6, 1);
  put(b, 'p', 4, 1);
  put(b, 'r', 2, 1);
  const m = movesFrom(b, 6, 1);
  assert.strictEqual(has(m, 4, 1), false, '炮架本身不可吃');
  assert.strictEqual(has(m, 2, 1), true, '隔一子可吃');
  assert.strictEqual(has(m, 1, 1), false, '越过炮架后无子不可落');

  const b2 = put(board(), 'C', 6, 1);
  put(b2, 'r', 2, 1);
  assert.strictEqual(has(movesFrom(b2, 6, 1), 2, 1), false, '无炮架不可吃');
});

test('象：不过河、塞象眼', () => {
  const b = put(board(), 'B', 9, 2);
  const m1 = movesFrom(b, 9, 2);
  assert.strictEqual(has(m1, 7, 0), true);
  assert.strictEqual(has(m1, 7, 4), true);
  assert.strictEqual(has(m1, 5, 2), false, '不可过河');
  put(b, 'P', 8, 1);
  assert.strictEqual(has(movesFrom(b, 9, 2), 7, 0), false, '塞象眼');
});

test('士：只在九宫斜走', () => {
  const b = put(board(), 'A', 9, 3);
  const m = movesFrom(b, 9, 3);
  assert.strictEqual(has(m, 8, 4), true);
  assert.strictEqual(has(m, 8, 2), false, '九宫外不可走');
});

test('兵：过河前只能前进，过河后可横走不可退', () => {
  const b = put(board(), 'P', 6, 2);
  assert.deepStrictEqual(movesFrom(b, 6, 2), [R.pos(5, 2)]);
  put(b, 'P', 4, 2);
  const m = movesFrom(b, 4, 2);
  assert.strictEqual(has(m, 3, 2), true);
  assert.strictEqual(has(m, 4, 1), true);
  assert.strictEqual(has(m, 4, 3), true);
  assert.strictEqual(has(m, 5, 2), false, '不可后退');
});

test('将帅照面：造成照面的着法非法', () => {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(9, 4)] = 'K';
  b[R.pos(0, 4)] = 'k';
  b[R.pos(5, 4)] = 'R';
  const m = movesFrom(b, 5, 4);
  assert.strictEqual(has(m, 5, 5), false, '车横移导致照面应非法');
  assert.strictEqual(has(m, 4, 4), true, '车沿线移动仍隔开应合法');
});

test('将军检测', () => {
  const b = put(board(), 'R', 1, 3);
  assert.strictEqual(R.isUnderCheck(b, 'black'), true);
  assert.strictEqual(R.gameStatus(b, 'black'), 'check');
});

test('不可送将：走后自己被将军的着法被过滤', () => {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(9, 4)] = 'K';
  b[R.pos(0, 4)] = 'k';
  b[R.pos(5, 4)] = 'P';
  b[R.pos(8, 0)] = 'r';
  const m = movesFrom(b, 9, 4);
  assert.strictEqual(has(m, 8, 4), false, '走到黑车控制线应非法');
  assert.strictEqual(has(m, 9, 3), true);
  assert.strictEqual(has(m, 9, 5), true);
});

test('将死判定', () => {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(0, 4)] = 'k';
  b[R.pos(9, 4)] = 'K';
  b[R.pos(0, 0)] = 'R';
  b[R.pos(0, 8)] = 'R';
  b[R.pos(1, 4)] = 'R';
  b[R.pos(3, 3)] = 'N';
  assert.strictEqual(R.isUnderCheck(b, 'black'), true);
  assert.strictEqual(R.gameStatus(b, 'black'), 'checkmate');
});

test('困毙判定', () => {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(0, 4)] = 'k';
  b[R.pos(9, 3)] = 'K';
  b[R.pos(1, 3)] = 'R';
  b[R.pos(1, 5)] = 'R';
  assert.strictEqual(R.isUnderCheck(b, 'black'), false);
  assert.strictEqual(R.gameStatus(b, 'black'), 'stalemate');
});

test('和棋判定：双方均无攻击棋子', () => {
  // 只剩将帅
  const bare = new Array(R.SIZE).fill(null);
  bare[R.pos(0, 4)] = 'k';
  bare[R.pos(9, 4)] = 'K';
  assert.strictEqual(R.isDraw(bare), true);

  // 加士象仍无法取胜
  bare[R.pos(0, 3)] = 'a';
  bare[R.pos(9, 3)] = 'A';
  assert.strictEqual(R.isDraw(bare), true);

  // 任一方有车/马/炮/兵即不算和
  for (const attacker of ['R', 'N', 'C', 'P', 'r', 'n', 'c', 'p']) {
    const b = bare.slice();
    b[R.pos(5, 4)] = attacker;
    assert.strictEqual(R.isDraw(b), false, attacker + ' 应视为攻击棋子');
  }
  assert.strictEqual(R.isDraw(R.initialBoard()), false);
});

test('局面键与重复判定：只给提示不判胜负', () => {
  const b = new Array(R.SIZE).fill(null);
  b[R.pos(0, 4)] = 'k';
  b[R.pos(9, 3)] = 'K';
  b[R.pos(2, 4)] = 'R';

  const key = R.positionKey(b, 'black');
  assert.strictEqual(key, R.positionKey(b.slice(), 'black'), '相同局面键应一致');
  assert.notStrictEqual(key, R.positionKey(b, 'red'), '走棋方不同键不同');
  const moved = R.applyMove(b, R.pos(2, 4), R.pos(2, 3));
  assert.notStrictEqual(key, R.positionKey(moved, 'black'), '棋盘变化键不同');

  // 仅两次重复不触发
  assert.strictEqual(R.judgeRepetition([
    { key, mover: 'red', givesCheck: true },
    { key: 'other', mover: 'black', givesCheck: false },
    { key, mover: 'red', givesCheck: true }
  ]), null);

  // 同一方三次都将军 → 只提示长将方，不返回判负信息
  assert.deepStrictEqual(R.judgeRepetition([
    { key, mover: 'red', givesCheck: true },
    { key: 'o1', mover: 'black', givesCheck: false },
    { key, mover: 'red', givesCheck: true },
    { key: 'o2', mover: 'black', givesCheck: false },
    { key, mover: 'red', givesCheck: true }
  ]), { type: 'perpetualCheck', side: 'red' });

  // 三次重复但非持续将军 → 只提示重复，不判和
  assert.deepStrictEqual(R.judgeRepetition([
    { key, mover: 'red', givesCheck: false },
    { key: 'o1', mover: 'black', givesCheck: false },
    { key, mover: 'red', givesCheck: false },
    { key: 'o2', mover: 'black', givesCheck: false },
    { key, mover: 'red', givesCheck: false }
  ]), { type: 'threefold' });
});

console.log('\n全部通过：' + passed + ' 项规则测试');
