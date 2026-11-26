const R = require('../../utils/rules.js');

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
    bgmOn: true
  },

  onLoad() {
    this._initAudio();
    this.reset();
  },

  onShow() {
    if (this.data.bgmOn) this._startBgm();
  },

  onHide() {
    this._stopBgm();
  },

  onUnload() {
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
      notice: ''
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

  onBoardTap(e) {
    if (this.data.over) return;

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
    if (selected >= 0 && R.pseudoMoves(board, selected).indexOf(index) >= 0) {
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
        return;
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
        return;
      }
    }

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

  onRestart() {
    this.reset();
  },

  onBack() {
    wx.navigateBack({ delta: 1 });
  }
});
