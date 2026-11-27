Page({
  goLocal() {
    wx.navigateTo({ url: '/pages/game/game' });
  },

  goOnline() {
    wx.navigateTo({ url: '/pages/online/online' });
  }
});
