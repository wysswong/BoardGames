const Cloud = require('../../utils/cloud.js');

Page({
  data: {
    codeInput: '',
    creating: false,
    joining: false,
    cloudError: '',
    joinedCode: '',
    mySeat: ''
  },

  onLoad() {
    if (typeof getApp === 'function') {
      const app = getApp();
      if (app && !app.globalData.cloudReady) {
        this.setData({ cloudError: '云开发未就绪：请在开发者工具中开通云开发并上传 room 云函数' });
      }
    }
  },

  onCodeInput(e) {
    this.setData({ codeInput: (e.detail.value || '').replace(/\D/g, '').slice(0, 6) });
  },

  async onCreate() {
    if (this.data.creating) return;
    this.setData({ creating: true, cloudError: '', joinedCode: '' });
    const res = await Cloud.call('create');
    this.setData({ creating: false });
    if (!res.ok) {
      this.setData({ cloudError: res.error });
      return;
    }
    this._enterGame(res.data.roomId, res.data.code, res.data.seat);
  },

  async onJoin() {
    const code = this.data.codeInput;
    if (!/^\d{6}$/.test(code)) {
      this.setData({ cloudError: '请输入 6 位房间号' });
      return;
    }
    if (this.data.joining) return;
    this.setData({ joining: true, cloudError: '' });
    const res = await Cloud.call('join', { code });
    this.setData({ joining: false });
    if (!res.ok) {
      this.setData({ cloudError: res.error });
      return;
    }
    this._enterGame(res.data.roomId, res.data.code, res.data.seat);
  },

  // 观战入口：凭房间号以只读身份进入
  async onWatch() {
    const code = this.data.codeInput;
    if (!/^\d{6}$/.test(code)) {
      this.setData({ cloudError: '请输入 6 位房间号' });
      return;
    }
    const res = await Cloud.call('queryByCode', { code });
    if (!res.ok) {
      this.setData({ cloudError: res.error });
      return;
    }
    this._enterGame(res.data.roomId, res.data.code, 'spectator');
  },

  onBack() {
    wx.navigateBack({ delta: 1 });
  },

  _enterGame(roomId, code, seat) {
    wx.navigateTo({
      url: '/pages/game/game?mode=online&roomId=' + encodeURIComponent(roomId)
        + '&code=' + code + '&seat=' + seat
    });
  }
});
