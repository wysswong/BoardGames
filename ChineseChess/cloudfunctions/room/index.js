/**
 * 中国象棋房间云函数
 * action: create | join | query | move | restart | leave
 * 身份一律取云调用上下文 OPENID，客户端传来的 openid 不可信。
 */
const cloud = require('wx-server-sdk');
const Room = require('./room.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'rooms';

function ok(extra) {
  return Object.assign({ ok: true }, extra || {});
}
function fail(error) {
  return { ok: false, error };
}

// 6 位数字房间号，避开易混淆的 0/1
function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += String(2 + Math.floor(Math.random() * 8));
  }
  return code;
}

async function findAvailableCode() {
  for (let i = 0; i < 10; i++) {
    const code = genCode();
    const res = await db.collection(COLLECTION).where({ code }).count();
    if (res.total === 0) return code;
  }
  return null;
}

async function getRoomById(roomId) {
  const res = await db.collection(COLLECTION).doc(roomId).get();
  return res.data;
}

async function getRoomByCode(code) {
  const res = await db.collection(COLLECTION).where({ code }).limit(1).get();
  return res.data && res.data[0] ? res.data[0] : null;
}

exports.main = async event => {
  const action = event && event.action;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) return fail('无法获取用户身份，请在微信内打开');

  try {
    switch (action) {
      case 'create': {
        const code = await findAvailableCode();
        if (!code) return fail('房间号生成失败，请重试');
        const room = Room.createRoom(openid, code);
        const res = await db.collection(COLLECTION).add({ data: room });
        return ok({ roomId: res._id, code, seat: 'red' });
      }

      case 'join': {
        const code = String(event.code || '').trim();
        if (!/^\d{6}$/.test(code)) return fail('房间号应为 6 位数字');
        const room = await getRoomByCode(code);
        const joined = Room.joinRoom(room, openid);
        if (!joined.ok) return fail(joined.error);
        await db.collection(COLLECTION).doc(room._id).update({ data: joined.patch });
        return ok({ roomId: room._id, code, seat: joined.seat });
      }

      case 'queryByCode': {
        const code = String(event.code || '').trim();
        if (!/^\d{6}$/.test(code)) return fail('房间号应为 6 位数字');
        const room = await getRoomByCode(code);
        if (!room) return fail('房间不存在或已解散');
        return ok({
          roomId: room._id,
          code: room.code,
          status: room.status,
          spectator: true
        });
      }

      case 'query': {
        const roomId = event.roomId;
        if (!roomId) return fail('缺少房间号');
        const room = await getRoomById(roomId);
        if (!room) return fail('房间不存在或已解散');
        return ok({
          room,
          seat: Room.seatOf(room, openid),
          spectator: !Room.seatOf(room, openid)
        });
      }

      case 'move': {
        const roomId = event.roomId;
        if (!roomId) return fail('缺少房间号');
        const room = await getRoomById(roomId);
        const moved = Room.move(room, openid, event.from, event.to);
        if (!moved.ok) return fail(moved.error);
        // 用 doc().update() 写入（与 join 一致，云端权限兼容最稳）。
        // 并发保护由服务端每次重新读取最新 room + 校验 turn === seat 保证：
        // 轮次校验通过才写，双方不可能在同一回合各自落子覆盖。
        // 关键：lastMove 用 _.set 整体替换，否则 SDK 会把对象展开成 lastMove.from 等
        // 点路径更新，而初始 lastMove 为 null 时 MongoDB 无法在 null 上创建子字段，
        // 报 "Cannot create field 'xxx' in element {lastMove: null}"。
        const data = Object.assign({}, moved.patch, {
          lastMove: _.set(moved.patch.lastMove)
        });
        await db.collection(COLLECTION).doc(roomId).update({ data });
        return ok({ effect: moved.effect });
      }

      case 'restart': {
        const roomId = event.roomId;
        if (!roomId) return fail('缺少房间号');
        const room = await getRoomById(roomId);
        const restarted = Room.restartRoom(room, openid);
        if (!restarted.ok) return fail(restarted.error);
        await db.collection(COLLECTION).doc(roomId).update({ data: restarted.patch });
        return ok();
      }

      case 'leave': {
        const roomId = event.roomId;
        if (!roomId) return fail('缺少房间号');
        const room = await getRoomById(roomId);
        const left = Room.leaveRoom(room, openid);
        if (!left.ok) return fail(left.error);
        // 与 move 分支同理：lastMove 用 _.set 整体替换，避免初始为 null 时
        // SDK 展开成 lastMove.xxx 导致 "Cannot create field" 报错。
        const data = Object.assign({}, left.patch, {
          lastMove: _.set(left.patch.lastMove)
        });
        await db.collection(COLLECTION).doc(roomId).update({ data });
        return ok();
      }

      default:
        return fail('未知操作：' + action);
    }
  } catch (err) {
    const detail = (err && (err.message || err.errMsg)) || String(err);
    console.error('[room] ' + action + ' 失败：', err);
    return fail('服务异常：' + detail);
  }
};
