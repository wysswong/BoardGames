const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

let componentDef;
global.Component = def => { componentDef = def; };
require('../components/chessboard/index.js');

let pageDef;
let toasts = [];
let audioPlays = [];
let audioStops = [];
global.Page = def => { pageDef = def; };
global.wx = {
  navigateTo() {},
  navigateBack() {},
  showToast(opts) { toasts.push(opts.title); },
  createInnerAudioContext() {
    return {
      src: '',
      loop: false,
      volume: 1,
      stop() { audioStops.push(this.src); },
      seek() {},
      play() { audioPlays.push(this.src); },
      destroy() {}
    };
  }
};
require('../pages/game/game.js');

function componentContext() {
  const ctx = {
    data: Object.assign({ board: [], hints: [], selected: -1, lastMove: null }, componentDef.data),
    setData(patch, cb) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    }
  };
  ctx.render = function () {
    return componentDef.methods.render.apply(this, arguments);
  };
  // 模拟小程序：属性写入 data 后触发 properties 级 observer
  ctx.observe = function (board, selected, hints, lastMove) {
    Object.assign(this.data, { board, selected, hints, lastMove });
    return componentDef.methods.onPropChange.apply(this);
  };
  ctx.tap = index => componentDef.methods.onPointTap.call(ctx, {
    currentTarget: { dataset: { index } }
  });
  // 真实组件实例会把 methods 绑定到 this，mock 里补齐以便生命周期直接调用
  Object.keys(componentDef.methods).forEach(name => {
    ctx[name] = function () {
      return componentDef.methods[name].apply(this, arguments);
    };
  });
  return ctx;
}

function pageContext() {
  toasts = [];
  audioPlays = [];
  audioStops = [];
  const ctx = Object.assign({}, pageDef);
  ctx.data = Object.assign({}, pageDef.data);
  ctx.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (typeof cb === 'function') cb();
  };
  // 模拟 selectComponent 返回棋盘组件实例
  ctx.highlightCalls = [];
  ctx.selectComponent = function () {
    return {
      setHighlight(h) { ctx.highlightCalls.push(h); }
    };
  };
  ctx.onLoad();
  return ctx;
}

test('棋盘组件渲染完整棋盘与棋子', () => {
  const ctx = componentContext();
  ctx.observe(R.initialBoard(), -1, [], null);
  assert.strictEqual(ctx.data.points.length, 90);
  assert.strictEqual(ctx.data.pieces.length, 32);
  assert.strictEqual(ctx.data.pieces.find(p => p.text === '帥').side, 'red');
  assert.strictEqual(ctx.data.pieces.find(p => p.text === '將').side, 'black');
  assert.strictEqual(ctx.data.pieces.find(p => p.text === '炮' && p.side === 'black') !== undefined, true);
  assert.strictEqual(ctx.data.hLines.length, 10);
  assert.strictEqual(ctx.data.vLines.length, 16);
  assert.strictEqual(ctx.data.palaceLines.length, 4);
  assert.deepStrictEqual(ctx.data.palaceLines.map(l => l.deg), [45, -45, 45, -45]);
  assert.strictEqual(ctx.data.boardWidth, 370);
  assert.strictEqual(ctx.data.boardHeight, 409);
  // 边框已计入外层尺寸：顶行与底行棋子到棋盘外边缘的留白必须相等
  const topSpace = 24 + 5 - 17;
  const bottomSpace = ctx.data.boardHeight - (24 + 9 * 39) - 5 - 17;
  assert.strictEqual(topSpace, bottomSpace, '上下棋子留白应对称');
  const firstPoint = ctx.data.points[0];
  assert.strictEqual(firstPoint.x - 17 > 5, true);
  const lastPoint = ctx.data.points[89];
  assert.strictEqual(lastPoint.y + 17 < ctx.data.boardHeight - 5, true);
});

test('棋盘组件高亮合法落点并发出点击事件', () => {
  const ctx = componentContext();
  let event;
  ctx.triggerEvent = (name, detail) => { event = { name, detail }; };
  const from = R.pos(9, 0);
  const hints = R.legalMovesFrom(R.initialBoard(), from);
  ctx.observe(R.initialBoard(), from, hints, null);
  assert.strictEqual(ctx.data.points.filter(p => p.hint).length, hints.length);
  assert.strictEqual(ctx.data.pieces.find(p => p.index === from).selected, true);
  ctx.tap(hints[0]);
  assert.strictEqual(event.name, 'pointtap');
  assert.strictEqual(event.detail.index, hints[0]);
});

test('棋盘组件高亮上一步走子的起点与落点', () => {
  const ctx = componentContext();
  const from = R.pos(9, 0);
  const to = R.pos(8, 0);
  const movedBoard = R.applyMove(R.initialBoard(), from, to);
  ctx.observe(movedBoard, -1, [], { from, to, side: 'red' });
  assert.deepStrictEqual(ctx.data.moveFromPoint, { index: from, x: 24, y: 375 });
  assert.deepStrictEqual(ctx.data.moveToPoint, { index: to, x: 24, y: 336 });
  assert.strictEqual(ctx.data.pieces.filter(p => p.lastMove).length, 1);
  assert.strictEqual(ctx.data.pieces.find(p => p.lastMove).index, to);

  ctx.observe(R.initialBoard(), -1, [], null);
  assert.strictEqual(ctx.data.moveFromPoint, null);
  assert.strictEqual(ctx.data.moveToPoint, null);
  assert.strictEqual(ctx.data.pieces.filter(p => p.lastMove).length, 0);
});

test('组件 attached 生命周期完成首屏渲染', () => {
  const ctx = componentContext();
  Object.assign(ctx.data, { board: R.initialBoard(), selected: -1, hints: [], lastMove: null });
  componentDef.lifetimes.attached.call(ctx);
  assert.strictEqual(ctx.data.pieces.length, 32);
  assert.strictEqual(ctx.data.points.length, 90);
});

test('组件 setHighlight 由页面直接调用可生成高亮', () => {
  const ctx = componentContext();
  const from = R.pos(9, 0);
  const to = R.pos(8, 0);
  const movedBoard = R.applyMove(R.initialBoard(), from, to);
  ctx.observe(movedBoard, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, { from, to, side: 'red' });
  assert.deepStrictEqual(ctx.data.moveFromPoint, { index: from, x: 24, y: 375 });
  assert.deepStrictEqual(ctx.data.moveToPoint, { index: to, x: 24, y: 336 });
  assert.strictEqual(ctx.data.pieces.find(p => p.index === to).lastMove, true);
});

test('组件标记被将军的将/帅', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  const kingPos = R.pos(0, 4);
  board[kingPos] = 'k';
  board[R.pos(9, 4)] = 'K';
  ctx.observe(board, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'red', checkedKing: kingPos
  });
  assert.strictEqual(ctx.data.pieces.filter(p => p.checked).length, 1);
  assert.strictEqual(ctx.data.pieces.find(p => p.index === kingPos).checked, true);

  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'red', checkedKing: -1
  });
  assert.strictEqual(ctx.data.pieces.filter(p => p.checked).length, 0);
});

test('将军时页面给出警示状态并将被将军棋子传给棋盘', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(1, 0)] = 'R';
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  page.onBoardTap({ detail: { index: R.pos(1, 0) } });
  page.onBoardTap({ detail: { index: R.pos(1, 4) } });

  assert.strictEqual(page.data.isCheck, true);
  assert.strictEqual(page.data.checkedKing, R.pos(0, 4));
  assert.strictEqual(page.data.statusText, '将军！黑方应将');
  const calls = page.highlightCalls.filter(Boolean);
  assert.strictEqual(calls[calls.length - 1].checkedKing, R.pos(0, 4));

  // 应将过程中点选棋子，将军提示不应被覆盖
  page.onBoardTap({ detail: { index: R.pos(0, 4) } });
  assert.strictEqual(page.data.statusText, '将军！黑方应将 · 请选择落点');
});

test('组件渲染吃子特效层并按序号重建', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  board[R.pos(9, 4)] = 'K';
  board[R.pos(8, 0)] = 'R'; // 落子方棋子已占据落点
  ctx.observe(board, -1, [], null);
  const to = R.pos(8, 0);
  componentDef.methods.setHighlight.call(ctx, {
    from: R.pos(9, 0), to, side: 'red', checkedKing: -1,
    capture: true, captureSeq: 3, capturedPiece: 'p'
  });
  assert.strictEqual(ctx.data.captureFx.length, 1);
  assert.strictEqual(ctx.data.captureFx[0].seq, 3);
  assert.strictEqual(ctx.data.captureFx[0].x, 24);
  assert.strictEqual(ctx.data.captureFx[0].y, 336);
  // 被吃棋子与落子方棋子的文字、阵营都要传给特效层
  assert.strictEqual(ctx.data.captureFx[0].capturedText, '卒');
  assert.strictEqual(ctx.data.captureFx[0].capturedSide, 'black');
  assert.strictEqual(ctx.data.captureFx[0].movedText, '車');
  assert.strictEqual(ctx.data.captureFx[0].movedSide, 'red');

  // 非吃子走子清空特效
  componentDef.methods.setHighlight.call(ctx, {
    from: R.pos(9, 0), to, side: 'red', checkedKing: -1,
    capture: false, captureSeq: 3, capturedPiece: null
  });
  assert.strictEqual(ctx.data.captureFx.length, 0);
});

test('吃子落子递增序号并通知棋盘', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 3)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(1, 0)] = 'R';   // 红车
  board[R.pos(1, 2)] = 'p';   // 黑卒，将被吃掉
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  page.onBoardTap({ detail: { index: R.pos(1, 0) } });
  page.onBoardTap({ detail: { index: R.pos(1, 2) } });

  assert.strictEqual(page.data.board[R.pos(1, 2)], 'R');
  assert.strictEqual(page.data.board[R.pos(1, 0)], null);
  assert.strictEqual(page.data.captureSeq, 1);
  const calls = page.highlightCalls.filter(Boolean);
  const last = calls[calls.length - 1];
  assert.strictEqual(last.capture, true);
  assert.strictEqual(last.captureSeq, 1);
  assert.strictEqual(last.capturedPiece, 'p', '被吃的黑卒应传给棋盘播放消失动画');
  assert.deepStrictEqual(audioPlays, ['/audio/capture.mp3'], '吃子应播放语音音效');
});

test('音效：预加载两种音效、普通走子与吃子分别播放、卸载销毁', () => {
  const page = pageContext();
  assert.ok(page._captureAudio, 'onLoad 应预创建吃子音频上下文');
  assert.ok(page._moveAudio, 'onLoad 应预创建落子音频上下文');
  assert.strictEqual(page._captureAudio.src, '/audio/capture.mp3');
  assert.strictEqual(page._moveAudio.src, '/audio/move.mp3');

  // 普通走子播放落子音效，不播放吃子音效
  page.onBoardTap({ detail: { index: R.pos(9, 0) } });
  page.onBoardTap({ detail: { index: R.pos(8, 0) } });
  assert.deepStrictEqual(audioPlays, ['/audio/move.mp3']);

  // 连续两次吃子分别播放吃子音效
  audioPlays = [];
  const board = Array(90).fill(null);
  board[R.pos(0, 0)] = 'k';
  board[R.pos(9, 8)] = 'K';
  board[R.pos(1, 0)] = 'R';
  board[R.pos(1, 4)] = 'R';
  board[R.pos(1, 2)] = 'p';
  board[R.pos(1, 6)] = 'p';
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });
  page.onBoardTap({ detail: { index: R.pos(1, 0) } });
  page.onBoardTap({ detail: { index: R.pos(1, 2) } });
  page.setData({ turn: 'red' });
  page.onBoardTap({ detail: { index: R.pos(1, 4) } });
  page.onBoardTap({ detail: { index: R.pos(1, 6) } });
  assert.deepStrictEqual(audioPlays, ['/audio/capture.mp3', '/audio/capture.mp3']);

  // 卸载时两个音频上下文都释放
  let captureDestroyed = false;
  let moveDestroyed = false;
  page._captureAudio.destroy = () => { captureDestroyed = true; };
  page._moveAudio.destroy = () => { moveDestroyed = true; };
  page.onUnload();
  assert.strictEqual(captureDestroyed, true, '页面卸载应销毁吃子音频上下文');
  assert.strictEqual(moveDestroyed, true, '页面卸载应销毁落子音频上下文');
  assert.strictEqual(page._captureAudio, null);
  assert.strictEqual(page._moveAudio, null);
});

test('背景音乐：循环低音量预加载、onShow 播放、onHide 停止、开关切换', () => {
  const page = pageContext();
  assert.ok(page._bgmAudio, 'onLoad 应预创建背景音乐音频上下文');
  assert.strictEqual(page._bgmAudio.src, '/audio/bgm.mp3');
  assert.strictEqual(page._bgmAudio.loop, true, '背景音乐应循环播放');
  assert.ok(page._bgmAudio.volume > 0 && page._bgmAudio.volume < 0.5, '背景音乐音量应低于音效');
  assert.strictEqual(page.data.bgmOn, true);

  // 页面显示播放、隐藏停止
  audioPlays = [];
  audioStops = [];
  page.onShow();
  assert.deepStrictEqual(audioPlays, ['/audio/bgm.mp3']);
  page.onHide();
  assert.deepStrictEqual(audioStops, ['/audio/bgm.mp3']);

  // 关闭音乐：停止播放，再 onShow 不自动播放
  page.onToggleBgm();
  assert.strictEqual(page.data.bgmOn, false);
  audioPlays = [];
  page.onShow();
  assert.strictEqual(audioPlays.length, 0, '关闭后页面显示不应播放');

  // 重新开启：立即播放
  page.onToggleBgm();
  assert.strictEqual(page.data.bgmOn, true);
  assert.deepStrictEqual(audioPlays, ['/audio/bgm.mp3']);
});

test('连续吃子时特效序号递增', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 0)] = 'k';
  board[R.pos(9, 8)] = 'K';
  board[R.pos(1, 0)] = 'R';   // 红车 1
  board[R.pos(1, 4)] = 'R';   // 红车 2
  board[R.pos(1, 2)] = 'p';   // 黑卒 1
  board[R.pos(1, 6)] = 'p';   // 黑卒 2
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  page.onBoardTap({ detail: { index: R.pos(1, 0) } });
  page.onBoardTap({ detail: { index: R.pos(1, 2) } });
  page.setData({ turn: 'red' }); // 手动保持红方回合，专注测试序号
  page.onBoardTap({ detail: { index: R.pos(1, 4) } });
  page.onBoardTap({ detail: { index: R.pos(1, 6) } });

  assert.strictEqual(page.data.captureSeq, 2);
  const calls = page.highlightCalls.filter(Boolean);
  const captures = calls.filter(c => c.capture);
  assert.strictEqual(captures.length, 2);
  assert.deepStrictEqual(captures.map(c => c.captureSeq), [1, 2]);
});

test('组件渲染照面警示标记与特效环', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  const redKing = R.pos(9, 4);
  const blackKing = R.pos(0, 4);
  board[redKing] = 'K';
  board[blackKing] = 'k';
  ctx.observe(board, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'red', checkedKing: -1,
    capture: false, captureSeq: 0,
    facingKings: [redKing, blackKing], facingSeq: 2
  });
  assert.strictEqual(ctx.data.pieces.find(p => p.index === redKing).facing, true);
  assert.strictEqual(ctx.data.pieces.find(p => p.index === blackKing).facing, true);
  assert.strictEqual(ctx.data.facingFx.length, 2);
  assert.strictEqual(ctx.data.facingFx[0].key, '2-0');
  assert.strictEqual(ctx.data.facingFx[1].key, '2-1');

  // 清空警示
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'red', checkedKing: -1, capture: false, captureSeq: 0
  });
  assert.strictEqual(ctx.data.facingFx.length, 0);
  assert.strictEqual(ctx.data.pieces.filter(p => p.facing).length, 0);
});

test('可吃的对方棋子显示绿色描边，空格落点仍显示绿点', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(4, 7)] = 'C';   // 红炮（选中）
  board[R.pos(4, 4)] = 'p';   // 炮架
  board[R.pos(4, 0)] = 'p';   // 隔炮架可吃的黑卒
  board[R.pos(1, 1)] = 'p';   // 不在炮线上的黑卒，不可吃
  const from = R.pos(4, 7);
  const hints = R.legalMovesFrom(board, from);
  ctx.observe(board, from, hints, null);
  assert.strictEqual(hints.indexOf(R.pos(4, 0)) >= 0, true, '炮应能隔架吃到(4,0)的卒');

  // 可吃的黑卒(4,0)：棋子加 capturable 描边，交点不再画绿点
  const targetPiece = ctx.data.pieces.find(p => p.index === R.pos(4, 0));
  assert.strictEqual(targetPiece.capturable, true);
  assert.strictEqual(ctx.data.points.find(p => p.index === R.pos(4, 0)).hint, false);
  // 空格落点(4,6)：仍用绿点，且无 capturable
  assert.strictEqual(ctx.data.points.find(p => p.index === R.pos(4, 6)).hint, true);
  assert.strictEqual(ctx.data.pieces.find(p => p.index === R.pos(4, 6)), undefined);
  // 非炮线上的黑卒(1,1)：无描边标记
  const notCapturable = ctx.data.pieces.find(p => p.index === R.pos(1, 1));
  assert.strictEqual(notCapturable.capturable, false);
  // 选中的红炮自身不应被标为可吃
  assert.strictEqual(ctx.data.pieces.find(p => p.index === from).capturable, false);
});

test('长将三次循环只提示不判负，对局继续', () => {
  const page = pageContext();
  const boardWith = (rookRow, rookCol, kingRow, kingCol) => {
    const b = Array(90).fill(null);
    b[R.pos(kingRow, kingCol)] = 'k';
    b[R.pos(9, 5)] = 'K';
    b[R.pos(rookRow, rookCol)] = 'R';
    return b;
  };
  const A = boardWith(2, 4, 0, 4);
  const B = boardWith(2, 4, 0, 3);
  const C = boardWith(2, 3, 0, 3);
  const D = boardWith(2, 3, 0, 4);
  const keyA = R.positionKey(A, 'black');
  const keyB = R.positionKey(B, 'red');
  const keyC = R.positionKey(C, 'black');
  const keyD = R.positionKey(D, 'red');
  assert.notStrictEqual(keyA, keyC);

  // 预置 A→B→C→D→A 五步，当前处于 D，红车走回 (2,4) 使 A 第三次出现
  page.setData({ board: D, turn: 'red', selected: -1, hints: [], over: false });
  page._history = [
    { key: keyA, mover: 'red', givesCheck: true },
    { key: keyB, mover: 'black', givesCheck: false },
    { key: keyC, mover: 'red', givesCheck: true },
    { key: keyD, mover: 'black', givesCheck: false },
    { key: keyA, mover: 'red', givesCheck: true }
  ];

  page.onBoardTap({ detail: { index: R.pos(2, 3) } });
  page.onBoardTap({ detail: { index: R.pos(2, 4) } });

  assert.strictEqual(page.data.over, false, '长将不得直接结束对局');
  assert.strictEqual(page.data.overReason, '');
  assert.strictEqual(page.data.winner, null, '长将不得判对方胜');
  assert.strictEqual(page.data.loser, null, '长将不得判负');
  assert.strictEqual(page.data.notice, '长将');
  assert.strictEqual(page.data.statusText, '红方一直将军，换一招吧 · 将军！黑方应将');
  assert.ok(toasts.some(t => t === '一直将军哦，换一招吧'), '应有弹窗提示');
  const last = page.highlightCalls.filter(Boolean).pop();
  assert.strictEqual(last.winner, null);
  assert.strictEqual(last.loser, null);
  assert.strictEqual(last.draw, false);

  // 提示后对局仍可继续：黑方应将
  page.onBoardTap({ detail: { index: R.pos(0, 4) } });
  page.onBoardTap({ detail: { index: R.pos(0, 3) } });
  assert.strictEqual(page.data.board[R.pos(0, 3)], 'k');
  assert.strictEqual(page.data.over, false);
  assert.strictEqual(page.data.notice, '');
});

test('三次重复局面只提示不判和，对局继续', () => {
  const page = pageContext();
  const boardWith = (rookCol, kingCol) => {
    const b = Array(90).fill(null);
    b[R.pos(0, kingCol)] = 'k';
    b[R.pos(9, 5)] = 'K';
    b[R.pos(5, rookCol)] = 'R';
    return b;
  };
  const E = boardWith(0, 3);
  const F = boardWith(0, 4);
  const G = boardWith(1, 4);
  const H = boardWith(1, 3);
  const keyE = R.positionKey(E, 'black');
  const keyF = R.positionKey(F, 'red');
  const keyG = R.positionKey(G, 'black');
  const keyH = R.positionKey(H, 'red');

  page.setData({ board: H, turn: 'red', selected: -1, hints: [], over: false });
  page._history = [
    { key: keyE, mover: 'red', givesCheck: false },
    { key: keyF, mover: 'black', givesCheck: false },
    { key: keyG, mover: 'red', givesCheck: false },
    { key: keyH, mover: 'black', givesCheck: false },
    { key: keyE, mover: 'red', givesCheck: false },
    { key: keyF, mover: 'black', givesCheck: false }
  ];

  page.onBoardTap({ detail: { index: R.pos(5, 1) } });
  page.onBoardTap({ detail: { index: R.pos(5, 0) } });

  assert.strictEqual(page.data.over, false, '三次重复不得直接结束对局');
  assert.strictEqual(page.data.overReason, '');
  assert.strictEqual(page.data.winner, null);
  assert.strictEqual(page.data.loser, null);
  assert.strictEqual(page.data.notice, '重复局面');
  assert.strictEqual(page.data.statusText, '这局面走了三遍啦，换个下法 · 黑方走棋');
  assert.ok(toasts.some(t => t === '走了三遍啦，换个下法'), '应有弹窗提示');
  const last = page.highlightCalls.filter(Boolean).pop();
  assert.strictEqual(last.draw, false, '不得按和棋处理');
  assert.strictEqual(last.winner, null);

  // 提示后仍可继续落子；走到非重复格后提示状态清除
  page.onBoardTap({ detail: { index: R.pos(0, 3) } });
  page.onBoardTap({ detail: { index: R.pos(1, 3) } });
  assert.strictEqual(page.data.board[R.pos(1, 3)], 'k');
  assert.strictEqual(page.data.over, false);
  assert.strictEqual(page.data.notice, '');
});

test('双方无法胜出时页面判定和棋且无胜败方', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';   // 黑将
  board[R.pos(0, 3)] = 'a';   // 黑士
  board[R.pos(9, 3)] = 'K';   // 红帅（与黑将不同列，避免照面）
  board[R.pos(9, 4)] = 'A';   // 本步红仕走斜线
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  page.onBoardTap({ detail: { index: R.pos(9, 4) } });
  page.onBoardTap({ detail: { index: R.pos(8, 3) } });

  assert.strictEqual(page.data.over, true);
  assert.strictEqual(page.data.overReason, 'draw');
  assert.strictEqual(page.data.statusText, '势均力敌，握手言和');
  assert.strictEqual(page.data.winner, null);
  assert.strictEqual(page.data.loser, null);
  const calls = page.highlightCalls.filter(Boolean);
  const last = calls[calls.length - 1];
  assert.strictEqual(last.draw, true);
  assert.strictEqual(last.winner, null);
  assert.strictEqual(last.loser, null);

  page.onRestart();
  assert.strictEqual(page.data.overReason, '');
});

test('将死时页面判定胜方败方并生成结算特效数据', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';   // 黑将
  board[R.pos(9, 4)] = 'K';   // 红帅
  board[R.pos(0, 0)] = 'R';   // 红车封底行
  board[R.pos(0, 1)] = 'R';   // 红车封底行
  board[R.pos(1, 0)] = 'R';   // 本步走子：横走到(1,4)将死
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  page.onBoardTap({ detail: { index: R.pos(1, 0) } });
  page.onBoardTap({ detail: { index: R.pos(1, 4) } });

  assert.strictEqual(page.data.over, true);
  assert.strictEqual(page.data.winner, 'red');
  assert.strictEqual(page.data.loser, 'black');
  assert.strictEqual(page.data.overReason, '将死');
  assert.strictEqual(page.data.statusText, '将死，红方胜 · 黑方败');
  const calls = page.highlightCalls.filter(Boolean);
  const last = calls[calls.length - 1];
  assert.strictEqual(last.winner, 'red');
  assert.strictEqual(last.loser, 'black');
  assert.strictEqual(last.loserKing, R.pos(0, 4), '应标记黑将为败方');

  // 重开后结算状态清空
  page.onRestart();
  assert.strictEqual(page.data.winner, null);
  assert.strictEqual(page.data.loser, null);
  assert.strictEqual(page.data.overReason, '');
});

test('组件渲染和棋横幅且不给任何棋子打胜负标记', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 3)] = 'K';
  ctx.observe(board, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: R.pos(9, 3), side: 'red', checkedKing: -1,
    capture: false, captureSeq: 0,
    winner: null, loser: null, loserKing: -1, draw: true
  });
  assert.deepStrictEqual(ctx.data.resultFx, { draw: true });
  assert.strictEqual(ctx.data.pieces.filter(p => p.winner).length, 0, '和棋不标记胜方');
  assert.strictEqual(ctx.data.pieces.filter(p => p.loser).length, 0, '和棋不标记败方');
});

test('组件渲染胜负特效：胜方金色光晕与败方灰化及横幅', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(1, 4)] = 'R';
  ctx.observe(board, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: R.pos(1, 4), side: 'red', checkedKing: R.pos(0, 4),
    capture: false, captureSeq: 0,
    winner: 'red', loser: 'black', loserKing: R.pos(0, 4)
  });
  assert.strictEqual(ctx.data.pieces.filter(p => p.winner).length, 2, '红帅与红车均为胜方');
  assert.strictEqual(ctx.data.pieces.find(p => p.index === R.pos(0, 4)).loser, true);
  assert.deepStrictEqual(ctx.data.resultFx, {
    winner: 'red', loser: 'black', loserKing: R.pos(0, 4)
  });

  // 清空结算
  componentDef.methods.setHighlight.call(ctx, null);
  assert.strictEqual(ctx.data.resultFx, null);
  assert.strictEqual(ctx.data.pieces.filter(p => p.winner).length, 0);
  assert.strictEqual(ctx.data.pieces.filter(p => p.loser).length, 0);
});

test('组件渲染送将警示：己方将帅红色脉冲与扩散环', () => {
  const ctx = componentContext();
  const board = Array(90).fill(null);
  const blackKing = R.pos(0, 4);
  board[R.pos(9, 4)] = 'K';
  board[blackKing] = 'k';
  ctx.observe(board, -1, [], null);
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'black', checkedKing: blackKing,
    capture: false, captureSeq: 0, facingKings: [], facingSeq: 0,
    selfCheckKing: blackKing, selfCheckSeq: 4
  });
  assert.strictEqual(ctx.data.pieces.find(p => p.index === blackKing).selfCheck, true);
  assert.strictEqual(ctx.data.pieces.find(p => p.index === blackKing).checked, true);
  assert.strictEqual(ctx.data.selfCheckFx.length, 1);
  assert.strictEqual(ctx.data.selfCheckFx[0].key, 'sc-4');
  assert.deepStrictEqual(ctx.data.selfCheckFx[0], { key: 'sc-4', x: 180, y: 24 });

  // 清空警示
  componentDef.methods.setHighlight.call(ctx, {
    from: -1, to: -1, side: 'black', checkedKing: -1,
    capture: false, captureSeq: 0, selfCheckKing: -1, selfCheckSeq: 0
  });
  assert.strictEqual(ctx.data.selfCheckFx.length, 0);
  assert.strictEqual(ctx.data.pieces.filter(p => p.selfCheck).length, 0);
});

test('点击送将落点触发将军特效', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  // 复现截图局面：黑将在(0,4)、红炮在(6,4)，黑炮从(3,1)横走到(3,4)后
  // 自己成了红炮的炮架，红炮可隔子吃黑将 —— 该步属送将，规则引擎已过滤
  board[R.pos(0, 4)] = 'k';
  board[R.pos(9, 4)] = 'K';
  board[R.pos(3, 1)] = 'c';
  board[R.pos(6, 4)] = 'C';
  page.setData({ board, turn: 'black', selected: -1, hints: [], over: false });

  // 选中黑炮，确认目标落点走法可达但不在合法提示里
  page.onBoardTap({ detail: { index: R.pos(3, 1) } });
  assert.strictEqual(R.pseudoMoves(board, R.pos(3, 1)).indexOf(R.pos(3, 4)) >= 0, true);
  assert.strictEqual(page.data.hints.indexOf(R.pos(3, 4)), -1);

  // 点击送将落点，应触发将军特效而非落子
  page.onBoardTap({ detail: { index: R.pos(3, 4) } });
  assert.strictEqual(page.data.isSelfCheck, true);
  assert.strictEqual(page.data.selfCheckSeq, 1);
  assert.strictEqual(page.data.statusText, '送将！己方将被攻击，此步非法');
  // 棋盘未改变，仍轮到黑方
  assert.strictEqual(page.data.board[R.pos(3, 1)], 'c');
  assert.strictEqual(page.data.board[R.pos(3, 4)], null);
  assert.strictEqual(page.data.turn, 'black');
  const calls = page.highlightCalls.filter(Boolean);
  const last = calls[calls.length - 1];
  assert.strictEqual(last.checkedKing, R.pos(0, 4), '应标记己方黑将');
  assert.strictEqual(last.selfCheckKing, R.pos(0, 4));
  assert.strictEqual(last.selfCheckSeq, 1);

  // 重新选子后警示状态被清除
  page.onBoardTap({ detail: { index: R.pos(3, 1) } });
  assert.strictEqual(page.data.isSelfCheck, false);
});

test('点击造成将帅照面的落点时触发警示特效', () => {
  const page = pageContext();
  const board = Array(90).fill(null);
  board[R.pos(0, 4)] = 'k';   // 黑将 col4
  board[R.pos(9, 4)] = 'K';   // 红帅 col4
  board[R.pos(5, 4)] = 'R';   // 红车挡在中间，是唯一遮挡
  page.setData({ board, turn: 'red', selected: -1, hints: [], over: false });

  // 选中红车
  page.onBoardTap({ detail: { index: R.pos(5, 4) } });
  assert.strictEqual(page.data.selected, R.pos(5, 4));
  // 该落点走法可达（车横走），但移开后将帅照面
  assert.strictEqual(R.pseudoMoves(board, R.pos(5, 4)).indexOf(R.pos(5, 3)) >= 0, true);
  assert.strictEqual(page.data.hints.indexOf(R.pos(5, 3)), -1);

  // 点击非法落点，应触发照面警示
  page.onBoardTap({ detail: { index: R.pos(5, 3) } });
  assert.strictEqual(page.data.isFacing, true);
  assert.strictEqual(page.data.facingSeq, 1);
  assert.strictEqual(page.data.statusText, '将帅不能照面，此步非法');
  // 棋盘未改变，仍轮到红方
  assert.strictEqual(page.data.board[R.pos(5, 4)], 'R');
  assert.strictEqual(page.data.turn, 'red');
  const calls = page.highlightCalls.filter(Boolean);
  const last = calls[calls.length - 1];
  assert.deepStrictEqual(last.facingKings, [R.pos(9, 4), R.pos(0, 4)]);
  assert.strictEqual(last.facingSeq, 1);

  // 再次点击另一照面点，序号递增以便动画重播
  page.onBoardTap({ detail: { index: R.pos(5, 5) } });
  assert.strictEqual(page.data.facingSeq, 2);
});

test('对局页初始状态正确', () => {
  const page = pageContext();
  assert.strictEqual(page.data.board.length, 90);
  assert.strictEqual(page.data.turn, 'red');
  assert.strictEqual(page.data.moveCount, 0);
  assert.strictEqual(page.data.over, false);
  assert.strictEqual(page.data.lastMove, null);
  assert.strictEqual(page.data.isCheck, false);
  assert.strictEqual(page.data.checkedKing, -1);
});

test('对局页选子与取消选子', () => {
  const page = pageContext();
  page.onBoardTap({ detail: { index: R.pos(9, 0) } });
  assert.strictEqual(page.data.selected, R.pos(9, 0));
  assert.strictEqual(page.data.hints.length, 2);
  page.onBoardTap({ detail: { index: R.pos(0, 0) } });
  assert.strictEqual(page.data.selected, -1);
  assert.strictEqual(page.data.hints.length, 0);
});

test('对局页落子后切换回合并更新棋盘', () => {
  const page = pageContext();
  page.onBoardTap({ detail: { index: R.pos(9, 0) } });
  page.onBoardTap({ detail: { index: R.pos(8, 0) } });
  assert.strictEqual(page.data.board[R.pos(8, 0)], 'R');
  assert.strictEqual(page.data.board[R.pos(9, 0)], null);
  assert.strictEqual(page.data.turn, 'black');
  assert.strictEqual(page.data.moveCount, 1);
  assert.strictEqual(page.data.statusText, '黑方走棋');
  assert.deepStrictEqual(page.data.lastMove, {
    from: R.pos(9, 0), to: R.pos(8, 0), side: 'red', checkedKing: -1,
    capture: false, captureSeq: 0, capturedPiece: null,
    winner: null, loser: null, loserKing: -1, draw: false
  });
  // 页面必须通过直接调用把高亮传给棋盘组件（reset 会先记一次 null，需过滤）
  const highlightCalls = page.highlightCalls.filter(Boolean);
  assert.strictEqual(highlightCalls.length, 1);
  assert.deepStrictEqual(highlightCalls[0], {
    from: R.pos(9, 0), to: R.pos(8, 0), side: 'red', checkedKing: -1,
    capture: false, captureSeq: 0, capturedPiece: null,
    winner: null, loser: null, loserKing: -1, draw: false
  });
});

test('对局结束后忽略继续落子并可重开', () => {
  const page = pageContext();
  page.setData({ over: true });
  const before = page.data.board.slice();
  page.onBoardTap({ detail: { index: R.pos(9, 0) } });
  page.onBoardTap({ detail: { index: R.pos(8, 0) } });
  assert.deepStrictEqual(page.data.board, before);
  page.onRestart();
  assert.strictEqual(page.data.turn, 'red');
  assert.strictEqual(page.data.moveCount, 0);
  assert.strictEqual(page.data.over, false);
  assert.strictEqual(page.data.lastMove, null);
  assert.strictEqual(page.data.isCheck, false);
  assert.strictEqual(page.data.checkedKing, -1);
});

test('走子高亮为金色系且无残留红色', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const segment = wxss.slice(wxss.indexOf('.move-from-mark'), wxss.indexOf('.piece {'));
  // 只截取走子高亮段，不包含后面的将军/照面/送将警示色（它们是刻意用红色的）
  const lastMoveSegment = wxss.slice(wxss.indexOf('.piece.last-move'), wxss.indexOf('.piece.checked'));
  const combined = segment + lastMoveSegment;
  assert.strictEqual(/#a8730c/.test(combined), true, '应使用深琥珀金描边');
  assert.strictEqual(/rgba\(230, 180, 40/.test(combined), true, '应使用亮金发光');
  assert.strictEqual(/#c0392b|rgba\(192, 57, 43/.test(combined), false, '不应残留红色');
});

test('吃子特效为缓慢落下与消失动画', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxml'), 'utf8');

  assert.strictEqual(/\.captured-ghost/.test(wxss), true, '应有被吃棋子残影样式');
  assert.strictEqual(/\.drop-ghost/.test(wxss), true, '应有落子方落下残影样式');
  assert.strictEqual(/@keyframes captured-sink/.test(wxss), true);
  assert.strictEqual(/@keyframes piece-drop/.test(wxss), true);
  assert.strictEqual(/animation: captured-sink 1\.2s/.test(wxss), true, '被吃棋子消失应缓慢');
  assert.strictEqual(/animation: piece-drop 0\.95s/.test(wxss), true, '落子应有缓慢落下过程');
  assert.strictEqual(/animation: capture-burst 1\.1s/.test(wxss), true, '金色光圈应放慢');
  assert.strictEqual(/class="captured-ghost/.test(wxml), true);
  assert.strictEqual(/class="drop-ghost/.test(wxml), true);
});

test('胜负特效包含胜方金色光晕、败方灰化与结算横幅', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxml'), 'utf8');
  assert.strictEqual(/\.piece\.victory/.test(wxss), true, '应有胜方棋子样式');
  assert.strictEqual(/animation: victory-glow/.test(wxss), true, '胜方应有光晕动画');
  assert.strictEqual(/\.piece\.defeat/.test(wxss), true, '应有败方灰化样式');
  assert.strictEqual(/\.result-banner/.test(wxss), true, '应有结算横幅样式');
  assert.strictEqual(/animation: banner-in/.test(wxss), true, '横幅应有入场动画');

  // 横幅需半透明，方便败方看清被遮挡的棋子复盘
  const bannerBlock = wxss.match(/\.result-banner\s*\{([\s\S]*?)\}/);
  assert.ok(bannerBlock, '应有 .result-banner 样式块');
  const bgLine = bannerBlock[1].match(/background:\s*linear-gradient\([^;]+;/);
  assert.ok(bgLine, '横幅应有渐变背景');
  const alphas = (bgLine[0].match(/rgba\([^)]*\)/g) || [])
    .map(s => parseFloat(s.replace(/.*,\s*([\d.]+)\)$/, '$1')));
  assert.strictEqual(alphas.length > 0 && alphas.every(a => a <= 0.35), true, '结算横幅背景应高度透明（alpha 约 0.3）');
  assert.strictEqual(/0 6px 16px rgba\(20, 12, 6, 0\.28\)/.test(bannerBlock[1]), true, '横幅投影应弱化');
  assert.strictEqual(/\.result-title[\s\S]{0,240}text-shadow:/.test(wxss), true, '透明背景上标题应有投影保证可读');
  assert.strictEqual(/class="result-layer/.test(wxml), true, 'WXML 应渲染结算层');
  assert.strictEqual(/resultFx\.winner === 'red' \? '红方胜'/.test(wxml), true, '应显示胜方文字');
  assert.strictEqual(/result-sub|红方败|黑方败/.test(wxml), false, '弹窗内不应显示败方文字');

  // 和棋横幅与状态栏
  assert.strictEqual(/\.result-banner\.draw/.test(wxss), true, '应有和棋横幅样式');
  assert.strictEqual(/result-draw-sub/.test(wxml), true, '和棋横幅应有副标题');
  assert.strictEqual(/势均力敌/.test(wxml), true, '和棋横幅标题');
  assert.strictEqual(/握手言和/.test(wxml), true, '和棋横幅副标题');
  const gameWxss = fs.readFileSync(path.join(__dirname, '../pages/game/game.wxss'), 'utf8');
  assert.strictEqual(/\.status-text\.draw/.test(gameWxss), true, '状态栏应有和棋样式');
  const gameJs = fs.readFileSync(path.join(__dirname, '../pages/game/game.js'), 'utf8');
  assert.strictEqual(/势均力敌，握手言和/.test(gameJs), true, '状态栏应有和棋文案');
});

test('送将警示使用将军同色系红色脉冲与扩散环', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxml'), 'utf8');
  assert.strictEqual(/\.piece\.self-check/.test(wxss), true, '应有送将棋子红色脉冲样式');
  assert.strictEqual(/animation: self-check-pulse/.test(wxss), true);
  assert.strictEqual(/@keyframes self-check-burst/.test(wxss), true, '应有送将扩散环动画');
  assert.strictEqual(/class="self-check-fx/.test(wxml), true, 'WXML 应渲染送将扩散环层');
});

test('长将与三次重复只提示：金色状态栏与弹窗，代码无判胜负分支', () => {
  const gameWxss = fs.readFileSync(path.join(__dirname, '../pages/game/game.wxss'), 'utf8');
  const gameWxml = fs.readFileSync(path.join(__dirname, '../pages/game/game.wxml'), 'utf8');
  const gameJs = fs.readFileSync(path.join(__dirname, '../pages/game/game.js'), 'utf8');
  const rulesJs = fs.readFileSync(path.join(__dirname, '../utils/rules.js'), 'utf8');

  assert.strictEqual(/\.status-text\.notice\s*\{/.test(gameWxss), true, '状态栏应有提示专用样式');
  assert.strictEqual(/notice \? 'notice'/.test(gameWxml), true, '状态栏应应用提示样式');
  assert.strictEqual(/isCheck \|\| isFacing \|\| isSelfCheck \|\| notice/.test(gameWxml), true, '提示应有警示前缀');
  assert.strictEqual(/showToast/.test(gameJs), true, '应有弹窗提示');
  assert.strictEqual(/一直将军哦，换一招吧/.test(gameJs), true);
  assert.strictEqual(/这局面走了三遍啦，换个下法/.test(gameJs), true);
  assert.strictEqual(/loser: repetition\.loser/.test(gameJs), false, '不得再按长将判负');
  assert.strictEqual(/repetition\.type === 'threefold' \|\| draw/.test(gameJs), false, '不得再按三次重复判和');
  assert.strictEqual(/perpetualCheck', loser:/.test(rulesJs), false, '规则层不得再返回判负方');
});

test('棋盘按视口自适应：手机保持原尺寸，平板与横屏自动放大', () => {
  const ctx = componentContext();
  const measure = (w, h) => {
    componentDef.methods._updateScale.call(ctx, { windowWidth: w, windowHeight: h });
    return ctx.data;
  };

  const phone = measure(375, 667);
  assert.ok(phone.scale > 0.7 && phone.scale <= 1, '手机尺寸不应放大棋盘');
  assert.strictEqual(phone.scaledWidth, Math.round(370 * phone.scale));

  const pad = measure(1024, 1366);
  assert.ok(pad.scale > 2.5, '平板竖屏应明显放大棋盘');
  assert.ok(pad.scaledWidth <= 1024 - 32, '放大后不应超出可用宽度');
  assert.ok(pad.scaledHeight <= 1366 - 170, '放大后不应超出可用高度');

  const land = measure(1366, 1024);
  assert.ok(land.scale > 1.5, '横屏应放大棋盘');
  assert.ok(land.scaledHeight <= 1024 - 170, '横屏应按可用高度限制');
});

test('自适应缩放容器与窗口变化监听', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const gameWxss = fs.readFileSync(path.join(__dirname, '../pages/game/game.wxss'), 'utf8');
  assert.strictEqual(/class="board-scaler"/.test(wxml), true, '应有缩放容器');
  assert.strictEqual(/transform:scale\(\{\{scale\}\}\)/.test(wxml), true, '棋盘应按 scale 缩放');
  assert.strictEqual(/\.board-scaler\s*\{/.test(wxss), true);
  assert.strictEqual(/\.board-wrap\s*\{[^}]*width:\s*100%/.test(gameWxss), true, '页面棋盘区不应再固定 360px');

  let resizeCb = null;
  let offCb = null;
  const originalWx = global.wx;
  global.wx = Object.assign({}, originalWx, {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
    onWindowResize(cb) { resizeCb = cb; },
    offWindowResize(cb) { offCb = cb; }
  });
  try {
    const ctx = componentContext();
    componentDef.lifetimes.attached.call(ctx);
    assert.strictEqual(typeof resizeCb, 'function', 'attached 应监听窗口变化');
    resizeCb({ windowWidth: 1024, windowHeight: 1366 });
    assert.ok(ctx.data.scale > 2.5, '窗口变化后应重算缩放');
    componentDef.lifetimes.detached.call(ctx);
    assert.strictEqual(offCb, resizeCb, 'detached 应解绑同一回调');
  } finally {
    global.wx = originalWx;
  }
});

test('棋子与吃子特效文字加粗，楚河汉界保持原粗细', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  const block = selector => {
    const m = wxss.match(new RegExp('\\' + selector + ' \\{[\\s\\S]*?\\}'));
    assert.ok(m, '应存在 ' + selector + ' 样式块');
    return m[0];
  };
  assert.strictEqual(/font-weight:\s*bold/.test(block('.piece')), true, '棋子文字应加粗');
  assert.strictEqual(/font-weight:\s*bold/.test(block('.captured-ghost')), true, '被吃棋子残影应同步加粗');
  assert.strictEqual(/font-weight:\s*bold/.test(block('.drop-ghost')), true, '落子残影应同步加粗');
  assert.strictEqual(/font-weight:\s*500/.test(block('.river')), true, '楚河汉界保持原粗细');
});

test('炮位与兵卒位显示传统角标且不拦截点击', () => {
  const ctx = componentContext();
  ctx.observe(R.initialBoard(), -1, [], null);
  assert.strictEqual(ctx.data.markers.length, 14, '4 个炮位 + 10 个兵卒位');
  const coords = ctx.data.markers.map(m => m.x + ',' + m.y);
  const expected = [[2, 1], [2, 7], [7, 1], [7, 7],
    [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
    [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]];
  expected.forEach(pair => {
    const coord = (24 + pair[1] * 39) + ',' + (24 + pair[0] * 39);
    assert.strictEqual(coords.indexOf(coord) >= 0, true, '缺少标记 ' + coord);
  });

  const wxml = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../components/chessboard/index.wxss'), 'utf8');
  assert.strictEqual(/class="pos-mark"/.test(wxml), true, 'WXML 应渲染角标层');
  assert.strictEqual(wxml.indexOf('class="pos-mark"') < wxml.indexOf('class="piece {{item.side}}'), true, '角标应在棋子之下');
  assert.strictEqual(/\.pos-mark\s*\{[\s\S]*?pointer-events:\s*none/.test(wxss), true, '角标不应拦截点击');
  assert.strictEqual(/\.corner\.tl/.test(wxss) && /\.corner\.tr/.test(wxss)
    && /\.corner\.bl/.test(wxss) && /\.corner\.br/.test(wxss), true, '四个角都应有样式');
  assert.strictEqual(/\.pos-mark \.corner \{[\s\S]*?width:\s*6px/.test(wxss), true, '角标边长应缩小到 6px');
});

console.log('\n全部通过：' + passed + ' 项 UI 逻辑测试');
