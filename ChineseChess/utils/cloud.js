/**
 * 云函数调用封装。统一处理云开发未开通、调用异常与业务失败。
 * 返回 { ok, data, error }，不抛异常，调用方按 ok 分支处理。
 */
function call(action, payload) {
  return new Promise(resolve => {
    if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      resolve({ ok: false, error: '云开发未开通，请先在开发者工具中开通云开发' });
      return;
    }
    wx.cloud.callFunction({
      name: 'room',
      data: Object.assign({ action }, payload || {}),
      success(res) {
        const result = res && res.result;
        if (result && result.ok) {
          resolve({ ok: true, data: result });
        } else {
          resolve({ ok: false, error: (result && result.error) || '服务返回异常' });
        }
      },
      fail(err) {
        resolve({ ok: false, error: (err && err.errMsg) || '网络异常，请重试' });
      }
    });
  });
}

function watch(roomId, onChange, onError) {
  if (typeof wx === 'undefined' || !wx.cloud || !wx.cloud.database) return null;
  const db = wx.cloud.database();
  return db.collection('rooms').doc(roomId).watch({
    onChange(snapshot) {
      const doc = snapshot && snapshot.docs && snapshot.docs[0];
      if (doc) onChange(doc);
    },
    onError(err) {
      if (onError) onError(err);
    }
  });
}

module.exports = { call, watch };
