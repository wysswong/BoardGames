const assert = require('assert');
const R = require('../utils/rules.js');
const Room = require('../utils/room.js');

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

const RED = 'openid-red';
const BLACK = 'openid-black';
const GUEST = 'openid-guest';

function playingRoom() {
  const room = Room.createRoom(RED, '123456');
  const joined = Room.joinRoom(room, BLACK);
  return Object.assign({}, room, joined.patch);
}

test('创建房间：房主红方、等待状态、标准初始棋盘', () => {
  const room = Room.createRoom(RED, '123456');
  assert.strictEqual(room.code, '123456');
  assert.strictEqual(room.redOpenid, RED);
  assert.strictEqual(room.blackOpenid, null);
  assert.strictEqual(room.status, 'waiting');
  assert.strictEqual(room.turn, 'red');
  assert.deepStrictEqual(room.board, R.initialBoard());
  assert.strictEqual(room.history.length, 0);
  assert.strictEqual(Room.seatOf(room, RED), 'red');
  assert.strictEqual(Room.seatOf(room, BLACK), null);
});

test('加入房间：第二人执黑、对局开始；满员与本人加入被拒绝', () => {
  const room = Room.createRoom(RED, '123456');
  assert.strictEqual(Room.joinRoom(room, RED).ok, false, '房主不能加入自己房间');
  const joined = Room.joinRoom(room, BLACK);
  assert.strictEqual(joined.ok, true);
  assert.strictEqual(joined.seat, 'black');
  assert.strictEqual(joined.patch.blackOpenid, BLACK);
  assert.strictEqual(joined.patch.status, 'playing');
  const full = Object.assign({}, room, joined.patch);
  assert.strictEqual(Room.joinRoom(full, GUEST).ok, false, '满员应拒绝');
  assert.strictEqual(Room.seatOf(full, GUEST), null, '第三人无席位（可观战）');
});

test('服务端走子校验：非玩家、未开始、非回合、非法着法均被拒', () => {
  const waiting = Room.createRoom(RED, '123456');
  assert.strictEqual(Room.move(waiting, BLACK, 0, 1).ok, false, '未加入不能走');
  const room = playingRoom();
  assert.strictEqual(Room.move(room, GUEST, R.pos(9, 0), R.pos(8, 0)).ok, false, '观众不能走');
  assert.strictEqual(Room.move(room, BLACK, R.pos(0, 0), R.pos(1, 0)).ok, false, '黑方未在回合不能走');
  assert.strictEqual(Room.move(room, RED, R.pos(9, 0), R.pos(8, 1)).ok, false, '非法着法被拒');
  assert.strictEqual(Room.move(room, RED, R.pos(0, 0), R.pos(1, 0)).ok, false, '不能走对方棋子');
});

test('合法走子：更新棋盘、交替回合、步数递增、写入落子记录', () => {
  const room = playingRoom();
  const from = R.pos(9, 0);
  const to = R.pos(8, 0);
  const result = Room.move(room, RED, from, to);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.board[to], 'R');
  assert.strictEqual(result.patch.board[from], null);
  assert.strictEqual(result.patch.turn, 'black');
  assert.strictEqual(result.patch.moveCount, 1);
  assert.strictEqual(result.patch.lastMove.from, from);
  assert.strictEqual(result.patch.lastMove.to, to);
  assert.strictEqual(result.patch.lastMove.statusText, '黑方走棋', 'lastMove 应带状态文案供 watch 端展示');
  assert.strictEqual(result.patch.status, 'playing');
  assert.strictEqual(result.effect.capture, false);
  assert.strictEqual(result.effect.statusText, '黑方走棋');
});

test('吃子：服务端标记被吃棋子供动画使用', () => {
  const room = playingRoom();
  const board = new Array(R.SIZE).fill(null);
  board[R.pos(9, 4)] = 'K';
  board[R.pos(0, 3)] = 'k';   // 错开列，避免将帅照面
  board[R.pos(9, 0)] = 'R';
  board[R.pos(1, 0)] = 'p';
  room.board = board;
  // 清空路径后红车从 (9,0) 直吃 (1,0) 的黑卒
  const result = Room.move(room, RED, R.pos(9, 0), R.pos(1, 0));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.lastMove.capturedPiece, 'p');
  assert.strictEqual(result.effect.capture, true);
  assert.strictEqual(result.patch.board[R.pos(1, 0)], 'R');
});

test('将死：服务端判红胜并置对局结束', () => {
  const room = playingRoom();
  const board = new Array(R.SIZE).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(0, 0)] = 'R';
  board[R.pos(0, 8)] = 'R';
  board[R.pos(2, 4)] = 'R';   // 红车走到 (1,4) 即成将死
  room.board = board;
  room.turn = 'red';
  const result = Room.move(room, RED, R.pos(2, 4), R.pos(1, 4));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.winner, 'red');
  assert.strictEqual(result.patch.loser, 'black');
  assert.strictEqual(result.patch.overReason, '将死');
  assert.strictEqual(result.patch.status, 'finished');
  assert.ok(/红方胜/.test(result.effect.statusText));
});

test('长将与三次重复：服务端只提示不判胜负，对局继续', () => {
  const room = playingRoom();
  const board = new Array(R.SIZE).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 5)] = 'K';
  board[R.pos(2, 4)] = 'R';
  room.board = board;
  room.turn = 'red';
  room.history = [
    { key: 'a', mover: 'red', givesCheck: true },
    { key: 'b', mover: 'black', givesCheck: false },
    { key: 'c', mover: 'red', givesCheck: true },
    { key: 'd', mover: 'black', givesCheck: false },
    { key: 'a', mover: 'red', givesCheck: true },
    { key: 'b', mover: 'black', givesCheck: false }
  ];
  // 红车在 (2,4) 将军，走到 (2,3) 再走回需要黑方配合；此处直接构造历史末步同键
  room.history[5] = { key: 'a', mover: 'black', givesCheck: false };
  const result = Room.move(room, RED, R.pos(2, 4), R.pos(2, 3));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.winner, null);
  assert.strictEqual(result.patch.status, 'playing');
  assert.strictEqual(result.patch.draw, false);
});

test('重开：进行中拒绝，结束后重置棋盘并保留双方', () => {
  const room = playingRoom();
  assert.strictEqual(Room.restartRoom(room, RED).ok, false, '对局中不能重开');
  room.status = 'finished';
  const result = Room.restartRoom(room, RED);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'playing');
  assert.deepStrictEqual(result.patch.board, R.initialBoard());
  assert.strictEqual(result.patch.turn, 'red');
  assert.strictEqual(result.patch.redOpenid, RED);
  assert.strictEqual(result.patch.blackOpenid, BLACK);
  assert.strictEqual(result.patch.moveCount, 0);
});

test('离开：留下的一方获胜，对局结束', () => {
  const room = playingRoom();
  const result = Room.leaveRoom(room, BLACK);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'finished');
  assert.strictEqual(result.patch.blackOpenid, null);
  assert.strictEqual(result.patch.winner, 'red');
  assert.strictEqual(result.patch.loser, 'black');
  assert.strictEqual(result.patch.overReason, '对手离开');
});

test('离开：对局中离开写入结算型 lastMove，驱动前端胜负特效', () => {
  const room = playingRoom();
  const result = Room.leaveRoom(room, BLACK);
  const lm = result.patch.lastMove;
  assert.ok(lm, '离开必须写入 lastMove，否则前端 watch 无结算特效');
  assert.strictEqual(lm.reason, 'leave');
  assert.strictEqual(lm.winner, 'red');
  assert.strictEqual(lm.loser, 'black');
  assert.strictEqual(lm.loserKing, R.findKing(room.board, 'black'));
  assert.strictEqual(lm.draw, false);
  assert.strictEqual(lm.capture, false);
  assert.ok(/对手离开/.test(lm.statusText) && /红方胜/.test(lm.statusText));
});

test('离开：红方中途离开则黑方获胜', () => {
  const room = playingRoom();
  const result = Room.leaveRoom(room, RED);
  assert.strictEqual(result.patch.winner, 'black');
  assert.strictEqual(result.patch.loser, 'red');
  assert.strictEqual(result.patch.redOpenid, null);
  assert.ok(/黑方胜/.test(result.patch.lastMove.statusText));
});

test('离开：等待阶段房主离开解散房间，不判胜负', () => {
  const room = Room.createRoom(RED, '123456');
  const result = Room.leaveRoom(room, RED);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.patch.status, 'finished');
  assert.strictEqual(result.patch.redOpenid, null);
  assert.strictEqual(result.patch.winner, null, '对手尚未入座，不能判黑方获胜');
  assert.strictEqual(result.patch.loser, null);
  assert.strictEqual(result.patch.overReason, '房间解散');
  assert.ok(/房间解散/.test(result.patch.lastMove.statusText));
});

test('离开：已结束的对局离开保留原胜负，不覆盖结果', () => {
  const room = playingRoom();
  const finished = Object.assign({}, room, {
    status: 'finished', winner: 'black', loser: 'red', overReason: '将死'
  });
  const result = Room.leaveRoom(finished, RED);
  assert.strictEqual(result.patch.winner, 'black', '不得把原胜方改掉');
  assert.strictEqual(result.patch.loser, 'red');
  assert.strictEqual(result.patch.overReason, '将死');
});

test('纯函数不修改原房间对象', () => {
  const room = playingRoom();
  const snapshot = JSON.stringify(room);
  Room.move(room, RED, R.pos(9, 0), R.pos(8, 0));
  Room.restartRoom(Object.assign({}, room, { status: 'finished' }), RED);
  assert.strictEqual(JSON.stringify(room), snapshot, '原对象不应被修改');
});

console.log('\n全部通过：' + passed + ' 项房间逻辑测试');
