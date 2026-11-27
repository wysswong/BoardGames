const assert = require('assert');
const path = require('path');
const Module = require('module');

// mock wx-server-sdk：内存版 rooms 集合 + OPENID 上下文
let store = [];
let seq = 0;
let currentOpenid = '';

// 模拟 wx-server-sdk 的 _.set(value)：返回带标记的包装对象，update 时整体替换字段
function setCmd(value) { return { __set__: value }; }
function applyData(target, data) {
  Object.keys(data).forEach(k => {
    const v = data[k];
    if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '__set__')) {
      target[k] = v.__set__;
    } else {
      target[k] = v;
    }
  });
}

function docOps(id) {
  return {
    async get() {
      const data = store.find(r => r._id === id);
      if (!data) throw new Error('doc not exists');
      return { data };
    },
    async update({ data }) {
      const room = store.find(r => r._id === id);
      if (!room) throw new Error('doc not exists');
      applyData(room, data);
      return { stats: { updated: 1 } };
    }
  };
}

const mockSdk = {
  DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
  init() {},
  getWXContext() { return { OPENID: currentOpenid }; },
  database() {
    return {
      command: { set: setCmd },
      collection() {
        return {
          async add({ data }) {
            const _id = 'room-' + (++seq);
            store.push(Object.assign({ _id }, data));
            return { _id };
          },
          async count() { return { total: store.length }; },
          where(cond) {
            const matched = store.filter(r => Object.keys(cond).every(k => r[k] === cond[k]));
            const copied = matched.slice();
            const query = {
              count() { return Promise.resolve({ total: copied.length }); },
              limit() { return query; },
              get() { return Promise.resolve({ data: copied }); },
              update({ data }) {
                copied.forEach(r => applyData(r, data));
                return Promise.resolve({ stats: { updated: copied.length } });
              }
            };
            return query;
          },
          doc: docOps
        };
      }
    };
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockSdk;
  return originalLoad.call(this, request, parent, isMain);
};
const cloudFn = require('../cloudfunctions/room/index.js');
Module._load = originalLoad;

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log('  PASS  ' + name);
  }).catch(err => {
    console.error('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
    throw err;
  });
}

const RED = 'openid-red';
const GUEST = 'openid-guest';
const SPECTATOR = 'openid-spectator';

async function run() {
  store = [];
  seq = 0;

  await test('create：生成房间号、房主执红、落库', async () => {
    currentOpenid = RED;
    const res = await cloudFn.main({ action: 'create' });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.seat, 'red');
    assert.strictEqual(/^\d{6}$/.test(res.code), true);
    assert.strictEqual(store.length, 1);
    assert.strictEqual(store[0].status, 'waiting');
  });

  let roomId;
  let code;
  await test('join：第二人加入后对局开始，第三人被拒', async () => {
    roomId = store[0]._id;
    code = store[0].code;
    currentOpenid = GUEST;
    assert.strictEqual((await cloudFn.main({ action: 'join', code })).ok, true);
    currentOpenid = RED;
    const again = await cloudFn.main({ action: 'join', code });
    assert.strictEqual(again.ok, false);
    assert.ok(/自己|开始/.test(again.error));
  });

  await test('query：玩家有席位，第三人标记为观众', async () => {
    currentOpenid = RED;
    const asRed = await cloudFn.main({ action: 'query', roomId });
    assert.strictEqual(asRed.seat, 'red');
    assert.strictEqual(asRed.spectator, false);
    currentOpenid = SPECTATOR;
    const asSpectator = await cloudFn.main({ action: 'query', roomId });
    assert.strictEqual(asSpectator.seat, null);
    assert.strictEqual(asSpectator.spectator, true, '无席位者可作为观众只读观战');
  });

  await test('queryByCode：凭房间号查到房间，供观战使用', async () => {
    currentOpenid = SPECTATOR;
    const res = await cloudFn.main({ action: 'queryByCode', code });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.roomId, roomId);
    assert.strictEqual(res.spectator, true);
    const missing = await cloudFn.main({ action: 'queryByCode', code: '222222' });
    assert.strictEqual(missing.ok, false);
  });

  await test('move：观众与非回合方被拒，红方合法落子写入', async () => {
    currentOpenid = SPECTATOR;
    const denied = await cloudFn.main({ action: 'move', roomId, from: 81, to: 72 });
    assert.strictEqual(denied.ok, false);
    currentOpenid = GUEST;
    const notTurn = await cloudFn.main({ action: 'move', roomId, from: 81, to: 72 });
    assert.strictEqual(notTurn.ok, false);
    currentOpenid = RED;
    // 走子前 lastMove 是 null（初始局面），走子后应整体替换为完整对象
    assert.strictEqual(store[0].lastMove, null, '初始 lastMove 应为 null');
    const moved = await cloudFn.main({ action: 'move', roomId, from: 81, to: 72 });
    assert.strictEqual(moved.ok, true);
    assert.strictEqual(store[0].moveCount, 1);
    assert.strictEqual(store[0].turn, 'black');
    // 关键回归：lastMove 整体写入成功（用 _.set 避免 null 上建子字段报错）
    assert.ok(store[0].lastMove && typeof store[0].lastMove === 'object', 'lastMove 应整体写入为对象');
    assert.strictEqual(store[0].lastMove.from, 81);
    assert.strictEqual(store[0].lastMove.to, 72);
    assert.ok(Object.prototype.hasOwnProperty.call(store[0].lastMove, 'capture'), 'lastMove 应含 capture 字段');
    assert.strictEqual(typeof store[0].lastMove.statusText, 'string');
  });

  await test('move：过期请求（非当前回合方再落子）被服务端回合校验拒绝且不写入', async () => {
    const before = store[0].moveCount;
    // 上一步后轮到黑方(GUEST)，红方(RED)若用过期状态再次提交应被拒
    currentOpenid = RED;
    const stale = await cloudFn.main({ action: 'move', roomId, from: 81, to: 72 });
    assert.strictEqual(stale.ok, false);
    assert.ok(/轮到/.test(stale.error));
    assert.strictEqual(store[0].moveCount, before, '被拒的请求不应写入棋盘');
  });

  await test('restart：对局中拒绝，结束后房主可重开', async () => {
    currentOpenid = RED;
    assert.strictEqual((await cloudFn.main({ action: 'restart', roomId })).ok, false);
    store[0].status = 'finished';
    const res = await cloudFn.main({ action: 'restart', roomId });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(store[0].status, 'playing');
    assert.strictEqual(store[0].moveCount, 0);
  });

  await test('leave：离开后对手获胜，身份清空', async () => {
    currentOpenid = GUEST;
    const res = await cloudFn.main({ action: 'leave', roomId });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(store[0].status, 'finished');
    assert.strictEqual(store[0].blackOpenid, null);
    assert.strictEqual(store[0].winner, 'red');
  });

  await test('leave：结算型 lastMove 整体落库（_.set），前端可据此显示胜负', async () => {
    const lm = store[0].lastMove;
    assert.ok(lm && typeof lm === 'object' && !lm.__set__, 'lastMove 应被整体替换为对象');
    assert.strictEqual(lm.reason, 'leave');
    assert.strictEqual(lm.winner, 'red');
    assert.strictEqual(lm.loser, 'black');
    assert.strictEqual(typeof lm.loserKing, 'number');
    assert.ok(/对手离开/.test(lm.statusText));
  });

  await test('未知 action 与缺少身份均返回失败', async () => {
    currentOpenid = RED;
    assert.strictEqual((await cloudFn.main({ action: 'unknown' })).ok, false);
    currentOpenid = '';
    assert.strictEqual((await cloudFn.main({ action: 'create' })).ok, false);
  });

  console.log('\n全部通过：' + passed + ' 项云函数测试');
}

run().catch(() => process.exit(1));
