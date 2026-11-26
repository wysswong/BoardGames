/**
 * 中国象棋规则引擎（纯函数，无平台依赖）
 *
 * 棋盘：长度 90 的一维数组，index = row * 9 + col
 *   row 0-3 黑方阵地，row 6-9 红方阵地
 * 棋子：字符串，红方大写 'KABNRCP'，黑方小写 'kabnrcp'，null 为空
 *   K 将/帅  A 士/仕  B 象/相  N 马/傌  R 车/俥  C 炮  P 卒/兵
 * 方向：红方 row 递减（向上），黑方 row 递增（向下）
 */

const COLS = 9;
const ROWS = 10;
const SIZE = ROWS * COLS;

const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const HORSE_MOVES = [
  [-2, -1, -1, 0], [-2, 1, -1, 0],
  [2, -1, 1, 0], [2, 1, 1, 0],
  [-1, -2, 0, -1], [1, -2, 0, -1],
  [-1, 2, 0, 1], [1, 2, 0, 1]
];
const ELEPHANT_MOVES = [
  [-2, -2, -1, -1], [-2, 2, -1, 1],
  [2, -2, 1, -1], [2, 2, 1, 1]
];
const DIAGONAL = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function pos(row, col) {
  return row * COLS + col;
}

function rowOf(p) {
  return Math.floor(p / COLS);
}

function colOf(p) {
  return p % COLS;
}

function sideOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? 'red' : 'black';
}

function typeOf(piece) {
  return piece ? piece.toUpperCase() : null;
}

function opposite(side) {
  return side === 'red' ? 'black' : 'red';
}

function inBoard(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function inPalace(side, row, col) {
  if (col < 3 || col > 5) return false;
  return side === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

function crossedRiver(side, row) {
  return side === 'red' ? row <= 4 : row >= 5;
}

function initialBoard() {
  const board = new Array(SIZE).fill(null);
  const backRank = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
  for (let col = 0; col < COLS; col++) {
    board[pos(0, col)] = backRank[col].toLowerCase();
    board[pos(9, col)] = backRank[col];
  }
  board[pos(2, 1)] = 'c';
  board[pos(2, 7)] = 'c';
  board[pos(7, 1)] = 'C';
  board[pos(7, 7)] = 'C';
  for (const col of [0, 2, 4, 6, 8]) {
    board[pos(3, col)] = 'p';
    board[pos(6, col)] = 'P';
  }
  return board;
}

function findKing(board, side) {
  const king = side === 'red' ? 'K' : 'k';
  return board.indexOf(king);
}

/**
 * 两个将/帅是否在同一列且中间无子（照面）
 */
function kingsFacing(board) {
  const redKing = findKing(board, 'red');
  const blackKing = findKing(board, 'black');
  if (redKing < 0 || blackKing < 0 || colOf(redKing) !== colOf(blackKing)) return false;
  const lo = rowOf(redKing);
  const hi = rowOf(blackKing);
  for (let row = Math.min(lo, hi) + 1; row < Math.max(lo, hi); row++) {
    if (board[pos(row, colOf(redKing))]) return false;
  }
  return true;
}

/**
 * 伪合法走法：只按棋子走法生成，不检查走后自己是否被将军
 * @returns {number[]} 目标位置数组
 */
function pseudoMoves(board, from) {
  const piece = board[from];
  if (!piece) return [];
  const side = sideOf(piece);
  const type = typeOf(piece);
  const row = rowOf(from);
  const col = colOf(from);
  const moves = [];

  const tryAdd = (r, c) => {
    if (!inBoard(r, c)) return;
    const to = pos(r, c);
    const target = board[to];
    if (target && sideOf(target) === side) return;
    moves.push(to);
  };

  switch (type) {
    case 'R': {
      for (const [dr, dc] of ORTHOGONAL) {
        for (let r = row + dr, c = col + dc; inBoard(r, c); r += dr, c += dc) {
          const to = pos(r, c);
          if (!board[to]) {
            moves.push(to);
            continue;
          }
          if (sideOf(board[to]) !== side) moves.push(to);
          break;
        }
      }
      break;
    }
    case 'C': {
      for (const [dr, dc] of ORTHOGONAL) {
        let hasScreen = false;
        for (let r = row + dr, c = col + dc; inBoard(r, c); r += dr, c += dc) {
          const to = pos(r, c);
          if (!hasScreen) {
            if (!board[to]) {
              moves.push(to);
            } else {
              hasScreen = true;
            }
          } else if (board[to]) {
            if (sideOf(board[to]) !== side) moves.push(to);
            break;
          }
        }
      }
      break;
    }
    case 'N': {
      for (const [dr, dc, lr, lc] of HORSE_MOVES) {
        if (!inBoard(row + lr, col + lc)) continue;
        if (board[pos(row + lr, col + lc)]) continue;
        tryAdd(row + dr, col + dc);
      }
      break;
    }
    case 'B': {
      for (const [dr, dc, er, ec] of ELEPHANT_MOVES) {
        const r = row + dr;
        const c = col + dc;
        if (!inBoard(r, c) || crossedRiver(side, r)) continue;
        if (board[pos(row + er, col + ec)]) continue;
        tryAdd(r, c);
      }
      break;
    }
    case 'A': {
      for (const [dr, dc] of DIAGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(side, r, c)) continue;
        tryAdd(r, c);
      }
      break;
    }
    case 'K': {
      for (const [dr, dc] of ORTHOGONAL) {
        const r = row + dr;
        const c = col + dc;
        if (!inPalace(side, r, c)) continue;
        tryAdd(r, c);
      }
      // 照面时可将帅直接互吃，用于将军检测
      const enemyKing = findKing(board, opposite(side));
      if (enemyKing >= 0 && kingsFacing(board)) moves.push(enemyKing);
      break;
    }
    case 'P': {
      const forward = side === 'red' ? -1 : 1;
      tryAdd(row + forward, col);
      if (crossedRiver(side, row)) {
        tryAdd(row, col - 1);
        tryAdd(row, col + 1);
      }
      break;
    }
  }
  return moves;
}

function applyMove(board, from, to) {
  const next = board.slice();
  next[to] = next[from];
  next[from] = null;
  return next;
}

function allPseudoMoves(board, side) {
  const moves = [];
  for (let i = 0; i < SIZE; i++) {
    if (board[i] && sideOf(board[i]) === side) {
      for (const to of pseudoMoves(board, i)) moves.push([i, to]);
    }
  }
  return moves;
}

/**
 * 该方是否被将军
 */
function isUnderCheck(board, side) {
  const king = findKing(board, side);
  if (king < 0) return true;
  if (kingsFacing(board)) return true;
  for (const [, to] of allPseudoMoves(board, opposite(side))) {
    if (to === king) return true;
  }
  return false;
}

/**
 * 某个棋子的合法走法：过滤掉走后自己被将军的着法
 */
function legalMovesFrom(board, from) {
  const piece = board[from];
  if (!piece) return [];
  const side = sideOf(piece);
  return pseudoMoves(board, from).filter(to => {
    const next = applyMove(board, from, to);
    return kingsFacing(next) === false && isUnderCheck(next, side) === false;
  });
}

function allLegalMoves(board, side) {
  const moves = [];
  for (let i = 0; i < SIZE; i++) {
    if (board[i] && sideOf(board[i]) === side) {
      for (const to of legalMovesFrom(board, i)) moves.push([i, to]);
    }
  }
  return moves;
}

/**
 * 轮到 sideToMove 时的对局状态
 * 'ongoing' | 'check' | 'checkmate' | 'stalemate'
 */
function gameStatus(board, sideToMove) {
  const checked = isUnderCheck(board, sideToMove);
  if (allLegalMoves(board, sideToMove).length > 0) {
    return checked ? 'check' : 'ongoing';
  }
  return checked ? 'checkmate' : 'stalemate';
}

/**
 * 双方均无攻击棋子（只剩将/帅与士/象）时谁也无法将死对方，判和。
 * 长将、三次重复不在此判胜负，仅由局面记录给出提示。
 */
function isDraw(board) {
  for (let i = 0; i < board.length; i++) {
    const piece = board[i];
    if (!piece) continue;
    const t = typeOf(piece);
    if (t === 'N' || t === 'R' || t === 'C' || t === 'P') return false;
  }
  return true;
}

/**
 * 规范化局面键：棋盘 + 轮到谁走。用于重复局面检测。
 */
function positionKey(board, sideToMove) {
  return (sideToMove === 'red' ? 'r:' : 'b:') + board.map(p => p || '.').join('');
}

/**
 * 重复局面提示。records 按时间顺序，元素为 { key, mover, givesCheck }（含当前步）。
 * 同一局面出现 3 次时：若三次均由同一方走出且每步都在将军对方，返回长将提示（side 为长将方）；否则返回三次重复提示。
 * 注意：这里只做提示，不裁决胜负、不结束对局，由页面决定是否继续。
 */
function judgeRepetition(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const currentKey = records[records.length - 1].key;
  const same = records.filter(r => r.key === currentKey);
  if (same.length < 3) return null;

  const movers = new Set(same.map(r => r.mover));
  if (movers.size === 1 && same.every(r => r.givesCheck)) {
    return { type: 'perpetualCheck', side: same[0].mover };
  }
  return { type: 'threefold' };
}

module.exports = {
  COLS, ROWS, SIZE,
  pos, rowOf, colOf, sideOf, typeOf, opposite, inPalace, crossedRiver,
  initialBoard, findKing, kingsFacing,
  pseudoMoves, legalMovesFrom, allLegalMoves, allPseudoMoves,
  applyMove, isUnderCheck, gameStatus, isDraw, positionKey, judgeRepetition
};
