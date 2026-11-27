App({
  globalData: {
    mode: 'local',
    cloudReady: false
  },
  onLaunch() {
    // 云开发初始化：DYNAMIC_CURRENT_ENV 自动使用当前环境，无需硬编码环境 ID。
    // 未开通云开发时 wx.cloud 可能不存在，此处做防御，保证本地热座对战仍可用。
    if (typeof wx === 'undefined' || !wx.cloud) return;
    try {
      wx.cloud.init({ env: wx.cloud.DYNAMIC_CURRENT_ENV, traceUser: true });
      this.globalData.cloudReady = true;
    } catch (e) {
      console.warn('[ChineseChess] 云开发初始化失败，在线对战不可用：', e);
      this.globalData.cloudReady = false;
    }
  }
});
