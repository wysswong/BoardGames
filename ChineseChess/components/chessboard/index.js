const R = require('../../utils/rules.js');

const CELL = 39;
const PAD = 24;
const BORDER = 5;
// .board 用 border-box + 实体边框，子元素坐标相对边框内侧定位；
// 外层尺寸需把上下/左右各 5px 边框补回来，否则底行棋子会比顶行低一截。
const BASE_W = PAD * 2 + CELL * (R.COLS - 1) + BORDER * 2;
const BASE_H = PAD * 2 + CELL * (R.ROWS - 1) + BORDER * 2;

const TEXT = {
  red: { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' },
  black: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '炮', P: '卒' }
};

Component({
  properties: {
    board: { type: Array, value: [], observer: 'onPropChange' },
    selected: { type: Number, value: -1, observer: 'onPropChange' },
    hints: { type: Array, value: [], observer: 'onPropChange' },
    lastMove: { type: Object, value: null, observer: 'onPropChange' },
    // 黑方视角：棋盘旋转 180°（坐标做行列反转），但棋子文字保持正向、点击索引不变
    flip: { type: Boolean, value: false, observer: 'onPropChange' }
  },

  data: {
    points: [],
    markers: [],
    pieces: [],
    hLines: [],
    vLines: [],
    palaceLines: [],
    moveFromPoint: null,
    moveToPoint: null,
    captureFx: [],
    facingFx: [],
    selfCheckFx: [],
    resultFx: null,
    _highlight: null,
    boardWidth: BASE_W,
    boardHeight: BASE_H,
    scale: 1,
    scaledWidth: BASE_W,
    scaledHeight: BASE_H
  },

  lifetimes: {
    attached() {
      this._updateScale();
      this.render();
      if (typeof wx !== 'undefined' && typeof wx.onWindowResize === 'function') {
        this._resizeHandler = size => this._updateScale(size);
        wx.onWindowResize(this._resizeHandler);
      }
    },
    detached() {
      if (this._resizeHandler && typeof wx !== 'undefined' && typeof wx.offWindowResize === 'function') {
        wx.offWindowResize(this._resizeHandler);
      }
      this._resizeHandler = null;
    }
  },

  methods: {
    // 按视口可用区域计算缩放，手机保持原尺寸，平板/横屏自动放大
    _updateScale(size) {
      let winW = size && size.windowWidth;
      let winH = size && size.windowHeight;
      if (!winW || !winH) {
        let info = null;
        try {
          if (typeof wx !== 'undefined') {
            if (typeof wx.getWindowInfo === 'function') {
              info = wx.getWindowInfo();
            } else if (typeof wx.getSystemInfoSync === 'function') {
              info = wx.getSystemInfoSync();
            }
          }
        } catch (e) {
          info = null;
        }
        winW = info && info.windowWidth;
        winH = info && info.windowHeight;
      }
      winW = Number(winW) || 375;
      winH = Number(winH) || 667;
      // 预留：页面左右 padding、顶部状态栏、底部按钮与提示
      const availW = Math.max(240, winW - 32);
      const availH = Math.max(300, winH - 170);
      const raw = Math.min(availW / BASE_W, availH / BASE_H);
      const scale = Math.min(3.2, Math.max(0.72, raw));
      this.setData({
        scale,
        scaledWidth: Math.round(BASE_W * scale),
        scaledHeight: Math.round(BASE_H * scale)
      });
    },

    onPropChange() {
      this.render();
    },

    // 供页面在落子后直接调用，绕开自定义属性传值链路
    setHighlight(highlight) {
      this.setData({ _highlight: highlight }, () => this.render());
    },

    render() {
      const { board, selected, hints } = this.data;
      // 黑方视角：把行、列坐标按棋盘中心翻转，索引本身不变（点击仍用真实 index）
      const flip = !!this.data.flip;
      const fx = col => PAD + (flip ? (R.COLS - 1 - col) : col) * CELL;
      const fy = row => PAD + (flip ? (R.ROWS - 1 - row) : row) * CELL;
      const selectedSide = selected >= 0 && board[selected] ? R.sideOf(board[selected]) : null;
      // 优先用页面直接设置的高亮；兼容通过属性传入的 lastMove
      const highlight = this.data._highlight || this.data.lastMove;
      const from = highlight ? highlight.from : -1;
      const to = highlight ? highlight.to : -1;
      const checkedKing = highlight && typeof highlight.checkedKing === 'number'
        ? highlight.checkedKing : -1;
      const captureSeq = highlight && typeof highlight.captureSeq === 'number'
        ? highlight.captureSeq : 0;
      const facingKings = highlight && Array.isArray(highlight.facingKings)
        ? highlight.facingKings : [];
      const facingSeq = highlight && typeof highlight.facingSeq === 'number'
        ? highlight.facingSeq : 0;
      const selfCheckKing = highlight && typeof highlight.selfCheckKing === 'number'
        && highlight.selfCheckKing >= 0 ? highlight.selfCheckKing : -1;
      const selfCheckSeq = highlight && typeof highlight.selfCheckSeq === 'number'
        ? highlight.selfCheckSeq : 0;
      const winner = highlight && (highlight.winner === 'red' || highlight.winner === 'black')
        ? highlight.winner : null;
      const loser = highlight && (highlight.loser === 'red' || highlight.loser === 'black')
        ? highlight.loser : null;
      const loserKing = highlight && typeof highlight.loserKing === 'number'
        && highlight.loserKing >= 0 ? highlight.loserKing : -1;
      const draw = !!(highlight && highlight.draw);

      // 独立的高亮坐标层：放在棋子之后渲染，避免被棋子/交点覆盖
      const moveFromPoint = from >= 0 ? {
        index: from,
        x: fx(R.colOf(from)),
        y: fy(R.rowOf(from))
      } : null;
      const moveToPoint = to >= 0 ? {
        index: to,
        x: fx(R.colOf(to)),
        y: fy(R.rowOf(to))
      } : null;

      // 吃子特效：captureSeq 递增作为 wx:key，确保连续吃子时动画重新播放
      // capturedPiece 是被吃棋子的原始字符（如 'p'），落子方棋子从更新后的 board[to] 读取
      const capturedPiece = highlight && highlight.capturedPiece ? highlight.capturedPiece : null;
      const movedPiece = to >= 0 ? board[to] : null;
      const captureFx = (highlight && highlight.capture && moveToPoint) ? [{
        seq: captureSeq,
        x: moveToPoint.x,
        y: moveToPoint.y,
        capturedText: capturedPiece ? TEXT[R.sideOf(capturedPiece)][R.typeOf(capturedPiece)] : '',
        capturedSide: capturedPiece ? R.sideOf(capturedPiece) : '',
        movedText: movedPiece ? TEXT[R.sideOf(movedPiece)][R.typeOf(movedPiece)] : '',
        movedSide: movedPiece ? R.sideOf(movedPiece) : ''
      }] : [];

      // 照面警示：将帅两子都打标记，序号用于重播动画
      const facingFx = facingKings.map((idx, i) => ({
        key: facingSeq + '-' + i,
        x: fx(R.colOf(idx)),
        y: fy(R.rowOf(idx))
      }));

      // 送将警示：己方将帅打红色脉冲 + 一次性扩散环，序号保证连续触发可重播
      const selfCheckFx = selfCheckKing >= 0 ? [{
        key: 'sc-' + selfCheckSeq,
        x: fx(R.colOf(selfCheckKing)),
        y: fy(R.rowOf(selfCheckKing))
      }] : [];

      // 结算：分出胜负时标记胜方/败方；和棋只显示中性横幅，不给任何棋子打胜负标记
      const resultFx = (winner && loser) ? {
        winner, loser, loserKing
      } : (draw ? { draw: true } : null);

      const points = [];
      for (let row = 0; row < R.ROWS; row++) {
        for (let col = 0; col < R.COLS; col++) {
          const index = R.pos(row, col);
          // 落点上有棋子时，绿点会被棋子盖住，交给棋子自身的 capturable 描边显示
          const isHint = hints.indexOf(index) >= 0;
          points.push({
            index,
            x: fx(col),
            y: fy(row),
            hint: isHint && !board[index]
          });
        }
      }

      // 炮位与兵卒位的传统角标：棋盘固有标记，与当前棋子无关
      const markers = [];
      const markRows = [[2, 1], [2, 7], [7, 1], [7, 7],
        [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
        [6, 0], [6, 2], [6, 4], [6, 6], [6, 8]];
      markRows.forEach(pair => {
        markers.push({
          key: pair[0] + '-' + pair[1],
          x: fx(pair[1]),
          y: fy(pair[0])
        });
      });

      const pieces = [];
      for (let i = 0; i < board.length; i++) {
        const piece = board[i];
        if (!piece) continue;
        const side = R.sideOf(piece);
        pieces.push({
          index: i,
          x: fx(R.colOf(i)),
          y: fy(R.rowOf(i)),
          text: TEXT[side][R.typeOf(piece)],
          side,
          selected: i === selected,
          lastMove: i === to,
          checked: i === checkedKing,
          facing: facingKings.indexOf(i) >= 0,
          selfCheck: i === selfCheckKing,
          // 胜负结算：胜方棋子金色庆祝，败方将帅灰化
          winner: !!winner && side === winner,
          loser: i === loserKing,
          // 对方棋子处于合法落点 = 可吃，用绿色描边环标记，避免绿点被棋子遮挡
          capturable: !resultFx && hints.indexOf(i) >= 0 && R.sideOf(piece) !== selectedSide
        });
      }

      const hLines = [];
      for (let row = 0; row < R.ROWS; row++) {
        hLines.push({ x: PAD, y: PAD + row * CELL, w: CELL * (R.COLS - 1) });
      }

      const vLines = [];
      for (let col = 0; col < R.COLS; col++) {
        const x = PAD + col * CELL;
        if (col === 0 || col === R.COLS - 1) {
          vLines.push({ x, y: PAD, h: CELL * (R.ROWS - 1) });
        } else {
          vLines.push({ x, y: PAD, h: CELL * 4 });
          vLines.push({ x, y: PAD + CELL * 5, h: CELL * 4 });
        }
      }

      // 九宫（皇宫）斜线：黑方 row0-2、红方 row7-9，各画两条对角线
      const palaceLines = [];
      const palaceDiag = 2 * CELL * Math.SQRT2;
      for (const topRow of [0, 7]) {
        const cx = PAD + 4 * CELL;
        const cy = PAD + (topRow + 1) * CELL;
        palaceLines.push({ x: cx, y: cy, w: palaceDiag, deg: 45 });
        palaceLines.push({ x: cx, y: cy, w: palaceDiag, deg: -45 });
      }

      this.setData({ points, markers, pieces, hLines, vLines, palaceLines, moveFromPoint, moveToPoint, captureFx, facingFx, selfCheckFx, resultFx });
    },

    onPointTap(e) {
      this.triggerEvent('pointtap', { index: Number(e.currentTarget.dataset.index) });
    }
  }
});
