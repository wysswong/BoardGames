/**
 * 在线对战房间逻辑（纯函数，无 wx / 数据库依赖）。
 * 客户端与云函数共用，保证走子校验与结算口径一致。
 *
 * 云数据库集合 rooms 的文档结构：
 * {
 *   code, status: 'waiting'|'playing'|'finished',
 *   redOpenid, blackOpenid, board[90], turn,
 *   moveCount, winner, loser, loserKing, overReason, draw,
 *   lastMove, history:[{key,mover,givesCheck}],
 *   createdAt, updatedAt
 * }
 * 观众 = openid 既不是 redOpenid 也不是 blackOpenid，只读。
 */
const R = require('./rules.js');

const SIDE_TEXT = { red: '红方', black: '黑方' };

function freshBoardState() {
  return {
    board: R.initialBoard(),
    turn: 'red',
    moveCount: 0,
    winner: null,
    loser: null,
    loserKing: -1,
    overReason: '',
    draw: false,
    lastMove: null,
    history: []
  };
}

function createRoom(openid, code) {
  return Object.assign({
    code,
    status: 'waiting',
    redOpenid: openid,
    blackOpenid: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }, freshBoardState());
}

function seatOf(room, openid) {
  if (!room || !openid) return null;
  if (room.redOpenid === openid) return 'red';
  if (room.blackOpenid === openid) return 'black';
  return null;
}

function joinRoom(room, openid) {
  if (!room) return { ok: false, error: '房间不存在' };
  if (room.status !== 'waiting') return { ok: false, error: '房间已开始或已结束' };
  if (room.redOpenid === openid) return { ok: false, error: '不能加入自己的房间' };
  if (room.blackOpenid) return { ok: false, error: '房间已满' };
  return {
    ok: true,
    seat: 'black',
    patch: { blackOpenid: openid, status: 'playing', updatedAt: Date.now() }
  };
}

/**
 * 落子结算（与本地热座口径完全一致，纯函数）。
 * 返回 { ok, error?, ...state, lastMove, statusText, notice }
 */
function settleMove(board, turn, from, to, history, moveCount) {
  if (!Array.isArray(board) || board.length !== R.SIZE) return { ok: false, error: '棋盘数据异常' };
  if (turn !== 'red' && turn !== 'black') return { ok: false, error: '回合数据异常' };
  if (!Number.isInteger(from) || from < 0 || from >= R.SIZE) return { ok: false, error: '起点异常' };
  if (!Number.isInteger(to) || to < 0 || to >= R.SIZE) return { ok: false, error: '落点异常' };

  const piece = board[from];
  if (!piece || R.sideOf(piece) !== turn) return { ok: false, error: '只能走己方棋子' };
  if (R.legalMovesFrom(board, from).indexOf(to) < 0) return { ok: false, error: '非法着法' };

  const capturedPiece = board[to] || null;
  const next = R.applyMove(board, from, to);
  const nextTurn = R.opposite(turn);
  const status = R.gameStatus(next, nextTurn);
  const key = R.positionKey(next, nextTurn);
  const nextHistory = (history || []).concat([{ key, mover: turn, givesCheck: status === 'check' }]);
  const repetition = R.judgeRepetition(nextHistory);
  const draw = R.isDraw(next);

  let statusText;
  let checkedKing = -1;
  let isCheck = false;
  let winner = null;
  let loser = null;
  let loserKing = -1;
  let overReason = '';
  let over = false;
  let notice = '';

  if (status === 'checkmate' || status === 'stalemate') {
    winner = turn;
    loser = nextTurn;
    loserKing = R.findKing(next, nextTurn);
    overReason = status === 'checkmate' ? '将死' : '困毙';
    statusText = overReason + '，' + SIDE_TEXT[winner] + '胜 · ' + SIDE_TEXT[loser] + '败';
    if (status === 'checkmate') {
      checkedKing = loserKing;
      isCheck = true;
    }
    over = true;
  } else if (draw) {
    overReason = 'draw';
    statusText = '势均力敌，握手言和';
    over = true;
  } else {
    if (status === 'check') {
      statusText = '将军！' + SIDE_TEXT[nextTurn] + '应将';
      checkedKing = R.findKing(next, nextTurn);
      isCheck = true;
    } else {
      statusText = SIDE_TEXT[nextTurn] + '走棋';
    }
    // 长将、三次重复仅提示，不判胜负、不结束对局
    if (repetition && repetition.type === 'perpetualCheck') {
      notice = '长将';
      statusText = SIDE_TEXT[repetition.side] + '一直将军，换一招吧 · ' + statusText;
    } else if (repetition && repetition.type === 'threefold') {
      notice = '重复局面';
      statusText = '这局面走了三遍啦，换个下法 · ' + statusText;
    }
  }

  return {
    ok: true,
    board: next,
    turn: nextTurn,
    moveCount: (moveCount || 0) + 1,
    winner,
    loser,
    loserKing,
    overReason,
    draw,
    over,
    checkedKing,
    isCheck,
    notice,
    statusText,
    history: nextHistory,
    lastMove: {
      from,
      to,
      side: turn,
      capturedPiece,
      checkedKing,
      capture: !!capturedPiece,
      isCheck,
      winner,
      loser,
      loserKing,
      draw,
      statusText,
      notice
    }
  };
}

/**
 * 服务端权威走子：校验身份、回合、着法后结算。
 * 返回 { ok, error?, patch? }
 */
function move(room, openid, from, to) {
  if (!room) return { ok: false, error: '房间不存在' };
  const seat = seatOf(room, openid);
  if (!seat) return { ok: false, error: '你不在该对局中' };
  if (room.status !== 'playing') return { ok: false, error: '对局未开始或已结束' };
  if (room.turn !== seat) return { ok: false, error: '还没轮到你走棋' };

  const result = settleMove(room.board, room.turn, from, to, room.history, room.moveCount);
  if (!result.ok) return result;

  return {
    ok: true,
    patch: {
      board: result.board,
      turn: result.turn,
      moveCount: result.moveCount,
      winner: result.winner,
      loser: result.loser,
      loserKing: result.loserKing,
      overReason: result.overReason,
      draw: result.draw,
      status: result.over ? 'finished' : 'playing',
      lastMove: result.lastMove,
      history: result.history,
      updatedAt: Date.now()
    },
    effect: {
      capturedPiece: result.lastMove.capturedPiece,
      capture: result.lastMove.capture,
      checkedKing: result.checkedKing,
      notice: result.notice,
      statusText: result.statusText,
      winner: result.winner,
      loser: result.loser
    }
  };
}

function restartRoom(room, openid) {
  if (!room) return { ok: false, error: '房间不存在' };
  if (!seatOf(room, openid)) return { ok: false, error: '你不在该对局中' };
  if (room.status === 'playing') return { ok: false, error: '对局进行中，不能重开' };
  return {
    ok: true,
    patch: Object.assign(freshBoardState(), {
      status: 'playing',
      code: room.code,
      redOpenid: room.redOpenid,
      blackOpenid: room.blackOpenid,
      createdAt: room.createdAt,
      updatedAt: Date.now()
    })
  };
}

function leaveRoom(room, openid) {
  if (!room) return { ok: false, error: '房间不存在' };
  const seat = seatOf(room, openid);
  if (!seat) return { ok: false, error: '你不在该对局中' };
  const other = R.opposite(seat);
  const base = {
    status: 'finished',
    [seat + 'Openid']: null,
    updatedAt: Date.now()
  };

  // 只有对局进行中才判胜负；等待阶段对手尚未入座，离开即解散房间，不判胜负
  if (room.status === 'playing') {
    const loserKing = R.findKing(room.board || [], seat);
    const statusText = '对手离开，' + SIDE_TEXT[other] + '胜 · ' + SIDE_TEXT[seat] + '败';
    return {
      ok: true,
      patch: Object.assign(base, {
        winner: other,
        loser: seat,
        loserKing,
        overReason: '对手离开',
        // 结算型 lastMove：watch 回推后前端据此显示状态文字、胜负特效和提示
        lastMove: {
          from: -1, to: -1, side: seat, checkedKing: -1,
          capture: false, capturedPiece: null, isCheck: false,
          winner: other, loser: seat, loserKing, draw: false,
          statusText, notice: '', reason: 'leave'
        }
      })
    };
  }

  // 等待/已结束阶段离开：保留已有胜负，仅解散房间，不覆盖对局结果
  return {
    ok: true,
    patch: Object.assign(base, {
      winner: room.winner || null,
      loser: room.loser || null,
      loserKing: typeof room.loserKing === 'number' ? room.loserKing : -1,
      overReason: room.status === 'waiting' ? '房间解散' : (room.overReason || ''),
      lastMove: room.status === 'waiting'
        ? {
          from: -1, to: -1, side: seat, checkedKing: -1,
          capture: false, capturedPiece: null, isCheck: false,
          winner: null, loser: null, loserKing: -1, draw: false,
          statusText: '房主离开，房间解散', notice: '', reason: 'leave'
        }
        : (room.lastMove || null)
    })
  };
}

module.exports = {
  SIDE_TEXT,
  freshBoardState,
  createRoom,
  seatOf,
  joinRoom,
  settleMove,
  move,
  restartRoom,
  leaveRoom
};
