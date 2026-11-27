const R = require('../../utils/rules.js');
const Cloud = require('../../utils/cloud.js');

const SIDE_TEXT = { red: '红方', black: '黑方' };

Page({
  data: {
    board: [],
    selected: -1,
    hints: [],
    turn: 'red',
    statusText: '红方先行',
    moveCount: 0,
    over: false,
    lastMove: null,
    checkedKing: -1,
    isCheck: false,
    isFacing: false,
    isSelfCheck: false,
    captureSeq: 0,
    facingSeq: 0,
    selfCheckSeq: 0,
    winner: null,
    loser: null,
    overReason: '',
    notice: '',
    bgmOn: true,
    // 在线模式
    mode: 'local',
    roomId: '',
    roomCode: '',
    seat: '',
    spectator: false,
    waiting: false,
    onlineStatus: '',
    // 棋盘视角：黑方玩家翻转棋盘，使己方棋子在下方；本地热座与观战保持红方视角
    flip: false
  },

  onLoad(options) {
    this._initAudio();
    const opts = options || {};
    if (opts.mode === 'online') {
      this.setData({
        mode: 'online',
        roomId: opts.roomId || '',
        roomCode: opts.code || '',
        seat: opts.seat || '',
        spectator: opts.seat === 'spectator',
        waiting: true,
        onlineStatus: '正在连接房间…'
      }, () => {
        this._joinRoomWatcher();
      });
    } else {
      this.reset();
    }
  },

  onShow() {
    if (this.data.bgmOn) this._startBgm();
  },

  onHide() {
    this._stopBgm();
  },

  onUnload() {
    this._closeWatcher();
    this._stopBgm();
    if (this._captureAudio) {
      this._captureAudio.destroy();
      this._captureAudio = null;
    }
    if (this._moveAudio) {
      this._moveAudio.destroy();
      this._moveAudio = null;
    }
    if (this._bgmAudio) {
      this._bgmAudio.destroy();
      this._bgmAudio = null;
    }
  },

  _initAudio() {
    if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return;
    this._captureAudio = wx.createInnerAudioContext();
    this._captureAudio.src = '/audio/capture.mp3';
    this._moveAudio = wx.createInnerAudioContext();
    this._moveAudio.src = '/audio/move.mp3';
    this._bgmAudio = wx.createInnerAudioContext();
    this._bgmAudio.src = '/audio/bgm.mp3';
    this._bgmAudio.loop = true;
    this._bgmAudio.volume = 0.35;
  },

  _playAudio(audio) {
    if (!audio) return;
    audio.stop();
    audio.seek(0);
    audio.play();
  },

  _playCaptureAudio() {
    this._playAudio(this._captureAudio);
  },

  _playMoveAudio() {
    this._playAudio(this._moveAudio);
  },

  _startBgm() {
    if (this._bgmAudio) this._bgmAudio.play();
  },

  _stopBgm() {
    if (this._bgmAudio) this._bgmAudio.stop();
  },

  onToggleBgm() {
    const bgmOn = !this.data.bgmOn;
    this.setData({ bgmOn });
    if (bgmOn) {
      this._startBgm();
    } else {
      this._stopBgm();
    }
  },

  reset() {
    this._history = [];
    this.setData({
      board: R.initialBoard(),
      selected: -1,
      hints: [],
      turn: 'red',
      statusText: '红方先行',
      moveCount: 0,
      over: false,
      lastMove: null,
      checkedKing: -1,
      isCheck: false,
      isFacing: false,
      isSelfCheck: false,
      captureSeq: 0,
      facingSeq: 0,
      selfCheckSeq: 0,
      winner: null,
      loser: null,
      overReason: '',
      notice: '',
      flip: false
    }, () => {
      this._applyHighlight(null);
    });
  },

  _applyHighlight(highlight) {
    const boardComponent = this.selectComponent('#chessboard');
    if (boardComponent) {
      boardComponent.setHighlight(highlight);
    }
  },

  _notify(text) {
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: text, icon: 'none', duration: 2500 });
    }
  },

  // 走法可达但被合法着法过滤的落点：照面 / 送将，分别给出警示特效。
  // 返回 true 表示已处理（非法着法），调用方应直接 return，不清空选中态。
  // 本地热座与在线对战共用，避免在线模式点击送将落点静默无反馈。
  _warnIllegalMove(index, board, selected, turn) {
    if (selected < 0 || R.pseudoMoves(board, selected).indexOf(index) < 0) return false;
    const after = R.applyMove(board, selected, index);
    if (R.kingsFacing(after)) {
      const seq = this.data.facingSeq + 1;
      const highlight = {
        from: -1, to: -1, side: turn, checkedKing: -1,
        capture: false, captureSeq: this.data.captureSeq,
        facingKings: [R.findKing(after, 'red'), R.findKing(after, 'black')],
        facingSeq: seq, selfCheckKing: -1, selfCheckSeq: 0
      };
      this.setData({
        isFacing: true,
        isSelfCheck: false,
        notice: '',
        facingSeq: seq,
        statusText: '将帅不能照面，此步非法'
      }, () => {
        this._applyHighlight(highlight);
      });
      return true;
    }
    // 送将：走后己方将/帅被将军（如把炮走到对方炮的炮架线上），本步非法
    // 复用将军的红色脉冲特效标记己方将帅，避免玩家把将送给对方
    if (R.isUnderCheck(after, turn)) {
      const ownKing = R.findKing(after, turn);
      const seq = this.data.selfCheckSeq + 1;
      const highlight = {
        from: -1, to: -1, side: turn, checkedKing: ownKing,
        capture: false, captureSeq: this.data.captureSeq,
        facingKings: [], facingSeq: 0,
        selfCheckKing: ownKing, selfCheckSeq: seq
      };
      this.setData({
        isFacing: false,
        isSelfCheck: true,
        notice: '',
        selfCheckSeq: seq,
        statusText: '送将！己方将被攻击，此步非法'
      }, () => {
        this._applyHighlight(highlight);
      });
      return true;
    }
    return false;
  },

  // ---------- 在线模式 ----------

  _closeWatcher() {
    if (this._watchTimer) {
      clearTimeout(this._watchTimer);
      this._watchTimer = null;
    }
    if (this._watcher && typeof this._watcher.close === 'function') {
      this._watcher.close();
    }
    this._watcher = null;
  },

  // 解析 watch 错误，暴露真实原因并区分权限/网络问题，便于定位
  _watchErrorInfo(err) {
    let detail = '';
    if (err) detail = err.message || err.errMsg || String(err);
    const isPermission = /permission|denied|forbidden|权限/i.test(detail);
    return {
      detail,
      isPermission,
      hint: isPermission
        ? '请在云开发控制台把 rooms 集合权限设为「所有用户可读」'
        : '请检查网络后退出重进'
    };
  },

  async _joinRoomWatcher() {
    if (!this.data.roomId) {
      this.setData({ onlineStatus: '房间号缺失', waiting: false });
      return;
    }
    this._watchRetry = 0;
    await this._queryAndWatch();
  },

  async _queryAndWatch() {
    const roomId = this.data.roomId;
    // 每次（重）连接都先拉全量，补上断线期间可能漏掉的走子
    const res = await Cloud.call('query', { roomId });
    if (!res.ok) {
      this.setData({ onlineStatus: res.error, waiting: false });
      return;
    }
    const room = res.data.room;
    const seat = this.data.spectator ? 'spectator' : res.data.seat;
    // 执黑时翻转棋盘，让己方棋子在下方；观战保持红方视角
    this.setData({ seat, flip: seat === 'black' }, () => {
      this._applyRoom(room);
      this._openWatcher();
    });
  },

  _openWatcher() {
    this._closeWatcher();
    this._watcher = Cloud.watch(this.data.roomId,
      doc => {
        this._watchRetry = 0; // 收到推送说明连接已恢复
        this._applyRoom(doc);
      },
      err => this._onWatchError(err)
    );
  },

  _onWatchError(err) {
    const info = this._watchErrorInfo(err);
    const retry = (this._watchRetry || 0) + 1;
    this._watchRetry = retry;
    this._closeWatcher();
    if (retry <= 3) {
      this.setData({ onlineStatus: '连接不稳定，正在重连 ' + retry + '/3…' });
      this._watchTimer = setTimeout(() => {
        this._watchTimer = null;
        if (this.data.mode === 'online') this._queryAndWatch();
      }, 600 * retry);
    } else {
      this.setData({
        onlineStatus: '连接中断：' + (info.detail || '未知错误') + ' · ' + info.hint,
        waiting: false
      });
    }
  },

  // 把房间文档映射为页面展示状态；落子特效由 lastMove 变化驱动
  _applyRoom(room) {
    if (!room) return;
    const last = room.lastMove || null;
    const statusText = last && last.statusText ? last.statusText : '对局进行中';
    const checkedKing = last && typeof last.checkedKing === 'number' ? last.checkedKing : -1;
    const winner = room.winner || null;
    const loser = room.loser || null;
    const draw = !!room.draw;
    const notice = last && last.notice ? last.notice : '';
    const seat = this.data.seat;
    const myTurn = !this.data.spectator && !!seat && room.turn === seat && room.status === 'playing';
    const waiting = room.status === 'waiting';

    // 只在检测到新的落子时播放音效与特效，watch 重连导致的重复推送不重播
    const moveKey = room.moveCount + ':' + (last ? last.from + '-' + last.to : '');
    const isNewMove = !!last && moveKey !== this._lastMoveKey;
    // 关键：组件用 highlight.captureSeq 作为特效节点 wx:key 来重播 CSS 动画。
    // 云函数写入的 lastMove 不含 captureSeq，必须在这里补上递增序号，
    // 否则连续吃子时 key 恒为 0、节点复用，第二次起动画不再播放（时有时无）。
    const nextCaptureSeq = isNewMove && last.capture
      ? this.data.captureSeq + 1 : this.data.captureSeq;
    const highlight = last ? Object.assign({}, last, { captureSeq: nextCaptureSeq }) : null;
    if (isNewMove) {
      this._lastMoveKey = moveKey;
      if (last.reason === 'leave') {
        // 对手离开：胜负由状态栏与结算特效呈现，这里只弹一次结算提示
        this._notify(last.statusText || '对手离开，对局结束');
      } else {
        if (last.capture) this._playCaptureAudio();
        else this._playMoveAudio();
        if (notice === '长将') this._notify('一直将军哦，换一招吧');
        else if (notice === '重复局面') this._notify('走了三遍啦，换个下法');
      }
    }

    let onlineStatus = '';
    if (waiting) {
      onlineStatus = '房间号 ' + this.data.roomCode + ' · 等待好友加入';
    } else if (this.data.spectator) {
      onlineStatus = '观战中 · ' + statusText;
    } else if (room.status === 'finished') {
      onlineStatus = '对局结束';
    } else if (myTurn) {
      onlineStatus = '轮到你走棋（' + SIDE_TEXT[seat] + '）';
    } else {
      onlineStatus = '等待对手走棋…';
    }

    this.setData({
      board: room.board || [],
      turn: room.turn || 'red',
      moveCount: room.moveCount || 0,
      statusText,
      checkedKing,
      isCheck: !!(last && last.isCheck) && !room.winner,
      isFacing: false,
      isSelfCheck: false,
      winner,
      loser,
      overReason: room.overReason || '',
      over: room.status === 'finished',
      draw,
      notice,
      waiting,
      onlineStatus,
      captureSeq: nextCaptureSeq,
      lastMove: highlight,
      selected: -1,
      hints: []
    }, () => {
      if (highlight) this._applyHighlight(highlight);
    });
  },

  onBoardTap(e) {
    if (this.data.over) return;

    if (this.data.mode === 'online') {
      this._onBoardTapOnline(e);
      return;
    }

    const index = e.detail.index;
    const { board, selected, hints, turn, moveCount } = this.data;

    if (selected >= 0 && hints.indexOf(index) >= 0) {
      // 落点原本有对方棋子即为吃子；记录被吃棋子供棋盘播放缓慢消失动画
      const capturedPiece = board[index] || null;
      const captured = !!capturedPiece;
      if (captured) {
        this._playCaptureAudio();
      } else {
        this._playMoveAudio();
      }
      const nextCaptureSeq = captured ? this.data.captureSeq + 1 : this.data.captureSeq;
      const next = R.applyMove(board, selected, index);
      const nextTurn = R.opposite(turn);
      const status = R.gameStatus(next, nextTurn);
      const key = R.positionKey(next, nextTurn);
      this._history.push({ key, mover: turn, givesCheck: status === 'check' });
      const repetition = R.judgeRepetition(this._history);
      let draw = R.isDraw(next);

      let statusText;
      let checkedKing = -1;
      let isCheck = false;
      let winner = null;
      let loser = null;
      let loserKing = -1;
      let overReason = '';
      let isOver = false;
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
        isOver = true;
      } else if (draw) {
        // 双方均无攻击棋子，确实无法将死对方，才判和
        overReason = 'draw';
        statusText = '势均力敌，握手言和';
        isOver = true;
      } else {
        if (status === 'check') {
          statusText = '将军！' + SIDE_TEXT[nextTurn] + '应将';
          checkedKing = R.findKing(next, nextTurn);
          isCheck = true;
        } else {
          statusText = SIDE_TEXT[nextTurn] + '走棋';
        }
        // 长将、三次重复仅作提示，不判胜负、不结束对局
        if (repetition && repetition.type === 'perpetualCheck') {
          notice = '长将';
          statusText = SIDE_TEXT[repetition.side] + '一直将军，换一招吧 · ' + statusText;
          this._notify('一直将军哦，换一招吧');
        } else if (repetition && repetition.type === 'threefold') {
          notice = '重复局面';
          statusText = '这局面走了三遍啦，换个下法 · ' + statusText;
          this._notify('走了三遍啦，换个下法');
        }
      }

      const highlight = {
        from: selected, to: index, side: turn, checkedKing,
        capture: captured, captureSeq: nextCaptureSeq, capturedPiece,
        winner, loser, loserKing, draw
      };
      this.setData({
        board: next,
        selected: -1,
        hints: [],
        turn: nextTurn,
        statusText,
        moveCount: moveCount + 1,
        over: isOver,
        lastMove: highlight,
        checkedKing,
        isCheck,
        isFacing: false,
        isSelfCheck: false,
        captureSeq: nextCaptureSeq,
        winner,
        loser,
        overReason,
        notice
      }, () => {
        this._applyHighlight(highlight);
      });
      return;
    }

    const piece = board[index];
    if (piece && R.sideOf(piece) === turn) {
      this.setData({
        selected: index,
        hints: R.legalMovesFrom(board, index),
        isFacing: false,
        isSelfCheck: false,
        notice: '',
        statusText: this.data.isCheck
          ? '将军！' + SIDE_TEXT[turn] + '应将 · 请选择落点'
          : '已选' + SIDE_TEXT[turn] + '棋子，请选择落点'
      });
      return;
    }

    // 走法可达但被合法着法过滤的落点：照面 / 送将，分别给出警示特效
    if (this._warnIllegalMove(index, board, selected, turn)) return;

    this.setData({
      selected: -1,
      hints: [],
      isFacing: false,
      isSelfCheck: false,
      notice: '',
      statusText: this.data.isCheck
        ? '将军！' + SIDE_TEXT[turn] + '应将'
        : SIDE_TEXT[turn] + '走棋'
    });
  },

  async _onBoardTapOnline(e) {
    if (this.data.spectator) {
      this._notify('观战模式不能落子');
      return;
    }
    if (this.data.waiting) {
      this._notify('等待好友加入房间…');
      return;
    }
    if (this.data.turn !== this.data.seat) {
      this._notify('还没轮到你走棋');
      return;
    }

    const index = e.detail.index;
    const { board, selected, hints } = this.data;

    if (selected >= 0 && hints.indexOf(index) >= 0) {
      if (this._submitting) return;
      const from = selected;
      this._submitting = true;
      const res = await Cloud.call('move', {
        roomId: this.data.roomId,
        from,
        to: index
      });
      this._submitting = false;
      if (!res.ok) {
        this._notify(res.error);
        // 服务端状态可能已变化，重新拉取以对齐
        this._joinRoomWatcher();
        return;
      }
      // 棋盘由 watch 回推更新；这里先清空选中态避免重复提交
      this.setData({ selected: -1, hints: [] });
      return;
    }

    const piece = board[index];
    if (piece && R.sideOf(piece) === this.data.seat) {
      this.setData({
        selected: index,
        hints: R.legalMovesFrom(board, index),
        isFacing: false,
        isSelfCheck: false,
        notice: '',
        statusText: '已选' + SIDE_TEXT[this.data.seat] + '棋子，请选择落点'
      });
      return;
    }

    // 走法可达但被合法着法过滤的落点：照面 / 送将，给出警示特效
    // 与本地热座共用口径，避免在线模式点击送将落点静默无反馈
    if (this._warnIllegalMove(index, board, selected, this.data.seat)) return;

    this.setData({ selected: -1, hints: [] });
  },

  async onRestart() {
    if (this.data.mode === 'online') {
      if (this.data.spectator) {
        this._notify('观战模式不能重开对局');
        return;
      }
      const res = await Cloud.call('restart', { roomId: this.data.roomId });
      if (!res.ok) {
        this._notify(res.error);
      } else {
        this._lastMoveKey = '';
        this._joinRoomWatcher();
      }
      return;
    }
    this.reset();
  },

  onCopyCode() {
    if (!this.data.roomCode) return;
    if (typeof wx !== 'undefined' && wx.setClipboardData) {
      wx.setClipboardData({
        data: this.data.roomCode,
        success: () => this._notify('房间号已复制')
      });
    }
  },

  async onLeave() {
    if (this.data.mode !== 'online' || this.data.spectator) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    const res = await Cloud.call('leave', { roomId: this.data.roomId });
    if (!res.ok) this._notify(res.error);
    this._closeWatcher();
    wx.navigateBack({ delta: 1 });
  },

  onBack() {
    wx.navigateBack({ delta: 1 });
  }
});
