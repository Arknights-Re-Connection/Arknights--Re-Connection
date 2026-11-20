import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { CardDefinition, Direction, Position, Side, Unit } from '../../../packages/rules/types';
import { BOARD_ROWS, BOARD_COLS } from '../../../packages/rules/engine';

export const TILE = 80, PAD = 50;
export const BOARD_W = PAD * 2 + BOARD_COLS * TILE; // 660
export const BOARD_H = PAD * 2 + BOARD_ROWS * TILE; // 820
const FONT = '"Rajdhani", "Segoe UI", "Microsoft YaHei", sans-serif';

// 明日方舟棋盘配色：深色近黑底 + 钢蓝网格 + 琥珀金高亮
const C = {
  bg: 0x0c0f13,
  frame: 0x33404e,
  line: 0x27313d,
  innerLine: 0x232c37,
  terrain: [0x12161c, 0x141920, 0x13171d, 0x151a21] as number[],
  friendlyTile: 0x1c2a33, friendlyEdge: 0x3d5a66,
  enemyTile: 0x2a1c1c, enemyEdge: 0x5c3a34,
  contour: 0x1c2530,
  friendlyHatch: 0x2e4a56, enemyHatch: 0x4a2e2a,
  gold: 0xf0b429, goldBright: 0xffd166,
  danger: 0xd9644a,
  steel: 0x4d7c8a, steelDim: 0x41586a,
  mutedText: '#5c6b7a', footer: '#4a5a68',
  text: '#d7e0e8', textDim: '#8a94a0',
};

export interface BoardUnit extends Unit { data: CardDefinition }
export interface BoardModel {
  viewer: Side; active: Side; turn: number; units: BoardUnit[]; selected?: string;
  highlights: Position[]; costs: Record<string, number>; focused?: Position; kind?: string;
  dropPick?: Position; dropDirection?: Direction; dropHover?: Position;
}
interface BoardProps {
  model: BoardModel;
  onCell: (p: Position) => void;
  onHover: (p?: Position) => void;
  onRight?: () => void;
  onDirectionHover?: (direction?: Direction) => void;
  onDirection?: (direction: Direction) => void;
}
export function displayPosition(p: Position, viewer: Side): Position { return viewer === 'blue' ? p : { r: BOARD_ROWS + 1 - p.r, c: BOARD_COLS + 1 - p.c }; }
// 把鼠标屏幕坐标换算成棋盘内部坐标（含缩放比例与视角翻转），UI 拖拽与棋盘命中共用同一套换算
export function screenToBoard(x: number, y: number, rect: DOMRect, viewer: Side): Position | undefined {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
  const r = Math.floor(((y - rect.top) * BOARD_H / rect.height - PAD) / TILE) + 1;
  const c = Math.floor(((x - rect.left) * BOARD_W / rect.width - PAD) / TILE) + 1;
  if (r < 1 || r > BOARD_ROWS || c < 1 || c > BOARD_COLS) return;
  return displayPosition({ r, c }, viewer);
}

class TacticalScene extends Phaser.Scene {
  dataModel?: BoardModel;
  cellClick: (p: Position) => void = () => {};
  cellHover: (p?: Position) => void = () => {};
  cellRight: () => void = () => {};
  directionHover: (direction?: Direction) => void = () => {};
  directionSelect: (direction: Direction) => void = () => {};
  // 静态层：地形 / 网格 / 等高线 / 部署区 / 目标点，只绘制一次（与视角无关）
  private staticArt?: Phaser.GameObjects.Graphics;
  // 动态层：单位 / 高亮 / 焦点 / 朝向，每次 paint 清空重画
  private art?: Phaser.GameObjects.Graphics;
  // 动态文本对象池：复用而非每帧 destroy/recreate
  private pool: Phaser.GameObjects.Text[] = [];
  private poolCursor = 0;
  private poolSizes = new Map<Phaser.GameObjects.Text, number>();
  private lastHover = '';
  private orientationGesture = false;
  private previewDirection?: Direction;
  create() {
    this.staticArt = this.add.graphics();
    this.drawStatic();
    this.art = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) { this.cellRight(); return; }
      const p = this.position(pointer.x, pointer.y);
      const target = this.dataModel?.dropPick;
      if (p && target && p.r === target.r && p.c === target.c) {
        this.orientationGesture = true;
        this.setPreviewDirection(undefined);
        return;
      }
      if (p) this.cellClick(p);
    });
    this.input.on('pointerup', () => {
      if (!this.orientationGesture) return;
      this.orientationGesture = false;
      if (this.previewDirection !== undefined) this.directionSelect(this.previewDirection);
      else this.paint();
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p = this.position(pointer.x, pointer.y); const key = p ? `${p.r}:${p.c}` : '';
      if (key !== this.lastHover) { this.lastHover = key; this.cellHover(p); }
      const target = this.dataModel?.dropPick;
      if (target) {
        const visible = displayPosition(target, this.dataModel?.viewer ?? 'blue');
        const centerX = PAD + (visible.c - .5) * TILE, centerY = PAD + (visible.r - .5) * TILE;
        let direction: Direction | undefined;
        if (this.orientationGesture) {
          const dx = pointer.x - centerX, dy = pointer.y - centerY;
          if (Math.max(Math.abs(dx), Math.abs(dy)) >= 12) {
            const screenDirection = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
            direction = ((screenDirection + (this.dataModel?.viewer === 'red' ? 2 : 0)) % 4) as Direction;
          }
        } else if (p) {
          const dr = p.r - target.r, dc = p.c - target.c;
          if (Math.abs(dr) + Math.abs(dc) === 1) direction = (dr < 0 ? 0 : dc > 0 ? 1 : dr > 0 ? 2 : 3) as Direction;
        }
        this.setPreviewDirection(direction);
      }
    });
    this.input.on('gameout', () => {
      this.lastHover = ''; this.cellHover(undefined);
      if (!this.orientationGesture) this.setPreviewDirection(undefined);
    });
    this.paint();
  }
  private setPreviewDirection(direction?: Direction) {
    if (direction === this.previewDirection) return;
    this.previewDirection = direction;
    this.directionHover(direction);
    this.paint();
  }
  private position(x: number, y: number): Position | undefined {
    const p = { r: Math.floor((y - PAD) / TILE) + 1, c: Math.floor((x - PAD) / TILE) + 1 };
    if (p.r < 1 || p.r > BOARD_ROWS || p.c < 1 || p.c > BOARD_COLS) return;
    return displayPosition(p, this.dataModel?.viewer ?? 'blue');
  }
  private staticText(x: number, y: number, str: string, size = 13, color = C.mutedText, origin = 0.5) {
    return this.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color }).setOrigin(origin);
  }
  private pooled(x: number, y: number, str: string, size = 13, color = C.mutedText, origin = 0.5) {
    let t = this.pool[this.poolCursor];
    if (!t) {
      t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color }).setOrigin(origin);
      this.pool.push(t); this.poolSizes.set(t, size);
    } else {
      t.setOrigin(origin); t.setPosition(x, y);
      if (this.poolSizes.get(t) !== size) { t.setFontSize(size); this.poolSizes.set(t, size); }
      t.setText(str); t.setColor(color); t.setVisible(true);
    }
    this.poolCursor++;
    return t;
  }
  private resetPool() { for (const t of this.pool) t.setVisible(false); this.poolCursor = 0; }
  // 静态层：背景、边框、81 格地形 + 等高线 + 部署区斜纹 + 目标点 + 行列号 + 页脚（与视角无关，只画一次）
  private drawStatic() {
    const g = this.staticArt!;
    g.fillStyle(C.bg); g.fillRect(0, 0, BOARD_W, BOARD_H);
    g.lineStyle(2, C.frame); g.strokeRect(PAD - 8, PAD - 8, TILE * BOARD_COLS + 16, TILE * BOARD_ROWS + 16);
    g.lineStyle(1, C.innerLine, .6); g.strokeRect(14, 14, BOARD_W - 28, BOARD_H - 28);
    for (let row = 1; row <= BOARD_ROWS; row++)
      this.staticText(25, PAD + (row - .5) * TILE, String(row).padStart(2, '0'), 13);
    for (let col = 1; col <= BOARD_COLS; col++)
      this.staticText(PAD + (col - .5) * TILE, 25, String(col).padStart(2, '0'), 13);
    for (let row = 1; row <= BOARD_ROWS; row++) {
      for (let col = 1; col <= BOARD_COLS; col++) {
        const x = PAD + (col - 1) * TILE, y = PAD + (row - 1) * TILE;
        const friendlyDeploy = (row === 9 && col >= 2 && col <= 6) || (row === 8 && col >= 3 && col <= 5);
        const enemyDeploy = (row === 1 && col >= 2 && col <= 6) || (row === 2 && col >= 3 && col <= 5);
        const isTarget = (row === 1 || row === 9) && col === 4;
        const terrain = C.terrain[(row * 13 + col * 17) % 4];
        g.fillStyle(friendlyDeploy ? C.friendlyTile : enemyDeploy ? C.enemyTile : terrain);
        g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.lineStyle(1, friendlyDeploy ? C.friendlyEdge : enemyDeploy ? C.enemyEdge : C.line, .7);
        g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        // 细密等高线纹理，模拟打印作战地图的质感
        g.lineStyle(1, C.contour, .14);
        for (let contour = 0; contour < 3; contour++) {
          const offset = (row * 9 + col * 7 + contour * 16) % 48;
          g.lineBetween(x + 7, y + 14 + offset, x + 28, y + 7 + offset);
          g.lineBetween(x + 28, y + 7 + offset, x + 53, y + 14 + offset);
          g.lineBetween(x + 53, y + 14 + offset, x + 73, y + 8 + offset);
        }
        if (friendlyDeploy || enemyDeploy) {
          g.lineStyle(1, friendlyDeploy ? C.friendlyHatch : C.enemyHatch, .4);
          for (let k = 10; k < 70; k += 14) g.lineBetween(x + k, y + 66, x + k + 10, y + 76);
        }
        if (isTarget) {
          const color = row === 9 ? C.gold : C.danger;
          g.fillStyle(C.gold, .5); g.fillRect(x + 12, y + 10, 56, 56);
          g.lineStyle(2, color, .95); g.strokeRect(x + 14, y + 12, 52, 52);
          // 菱形目标标记
          g.fillStyle(C.gold, .9);
          g.fillTriangle(x + 40, y + 22, x + 54, y + 38, x + 40, y + 54);
          g.fillTriangle(x + 40, y + 22, x + 26, y + 38, x + 40, y + 54);
          this.staticText(x + 40, y + 72, row === 9 ? '我方目标' : '敌方目标', 11, row === 9 ? '#f0b429' : '#d9644a');
        }
      }
    }
    this.staticText(BOARD_W / 2, BOARD_H - 17, 'RHODES ISLAND  /  OPERATIONS MAP 07', 10, C.footer);
  }
  paint() {
    if (!this.art || !this.dataModel) return;
    const m = this.dataModel, g = this.art;
    this.resetPool(); g.clear();
    const highlights = new Set(m.highlights.map(p => `${p.r}:${p.c}`));
    // 动态层：每格的高亮 / 焦点 / 落点预览（内部坐标随视角翻转）
    for (let row = 1; row <= BOARD_ROWS; row++) {
      for (let col = 1; col <= BOARD_COLS; col++) {
        const internal = displayPosition({ r: row, c: col }, m.viewer);
        const x = PAD + (col - 1) * TILE, y = PAD + (row - 1) * TILE;
        if (highlights.has(`${internal.r}:${internal.c}`)) {
          const attack = m.kind === 'attack' || m.kind === 'command-enemy';
          const color = attack ? C.danger : C.gold;
          g.fillStyle(color, .2); g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
          g.lineStyle(2, color, .85); g.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
          const cost = m.costs[`${internal.r}:${internal.c}`];
          if (cost !== undefined) this.pooled(x + 65, y + 12, String(cost) + '◇', 12, '#ffd166');
        }
        if (m.focused && m.focused.r === internal.r && m.focused.c === internal.c) {
          g.lineStyle(2, C.goldBright, .9); g.strokeRect(x + 5, y + 5, TILE - 10, TILE - 10);
        }
        if (m.dropHover && m.dropHover.r === internal.r && m.dropHover.c === internal.c) {
          g.fillStyle(C.gold, .26); g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
          g.lineStyle(4, C.goldBright, .98); g.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
          g.lineStyle(1, 0xfff4d6, .85); g.strokeRect(x + 9, y + 9, TILE - 18, TILE - 18);
        }
      }
    }
    // 单位棋子
    const counts = new Map<string, number>();
    for (const u of m.units) {
      const p = displayPosition(u, m.viewer), key = `${p.r}:${p.c}:${u.owner}`;
      const index = counts.get(key) ?? 0; counts.set(key, index + 1);
      const friendly = u.owner === m.viewer;
      const hasEnemy = m.units.some(v => v.r === u.r && v.c === u.c && v.owner !== u.owner);
      let x = PAD + (p.c - .5) * TILE, y = PAD + (p.r - .5) * TILE;
      if (hasEnemy) { x += friendly ? -18 : 18; y += index * 5 - 2; }
      else { x += index * 6 - Math.min(counts.get(key)! - 1, 2) * 2; y += index * 5 - 2; }
      const width = hasEnemy ? 32 : 48, height = 62;
      const color = friendly ? C.steel : C.danger;
      const body = friendly ? 0x1c232d : 0x241a1a;
      const inner = friendly ? 0x2c4a57 : 0x5a2f2a;
      const left = x - width / 2, top = y - height / 2;
      g.fillStyle(0x000000, .35); g.fillRect(left + 3, top + 4, width, height);
      g.fillStyle(body); g.fillRect(left, top, width, height);
      g.lineStyle(1.5, color); g.strokeRect(left, top, width, height);
      g.fillStyle(inner); g.fillRect(left + 3, top + 3, width - 6, 34);
      // 干员小卡 token：暗色卡面 + 头像 + 实时攻防数值
      g.fillStyle(0x141920, .65); g.fillTriangle(x - 11, top + 33, x, top + 15, x + 11, top + 33);
      g.fillStyle(0x2e3844); g.fillCircle(x, top + 13, 5);
      g.fillStyle(0x1a222b); g.fillRect(x - 5, top + 7, 10, 4);
      g.fillStyle(C.gold); g.fillTriangle(x - 6, top + 19, x, top + 24, x + 6, top + 19);
      this.pooled(x, top + 43, u.data.name, hasEnemy ? 8 : 11, C.text);
      const badge = hasEnemy ? 12 : 15;
      g.fillStyle(C.gold); g.fillRect(left + 2, top + 48, badge, 12);
      g.fillStyle(C.steelDim); g.fillRect(left + width - badge - 2, top + 48, badge, 12);
      this.pooled(left + 2 + badge / 2, top + 54, String(u.data.power), 10, '#16130a');
      this.pooled(left + width - badge / 2 - 2, top + 54, String(u.hp), 10, '#ffffff');
      if (m.selected === u.id) { g.lineStyle(2.5, C.goldBright); g.strokeRect(left - 3, top - 3, width + 6, height + 6); }
      const displayedDirection = m.viewer === 'blue' ? u.direction : (u.direction + 2) % 4;
      const vector = [[0, -1], [1, 0], [0, 1], [-1, 0]][displayedDirection];
      const directionX = x + vector[0] * (width / 2 + 4), directionY = y + vector[1] * 35;
      g.fillStyle(color); g.fillCircle(directionX, directionY, 2.5);
      g.lineStyle(2, color); g.lineBetween(directionX, directionY, directionX + vector[0] * 5, directionY + vector[1] * 5);
      const badges = [u.skillActive ? '技' : '', u.frozenUntil >= m.turn ? '冻' : '', u.cold ? `寒${u.cold}` : '', u.smoke ? '烟' : '', u.nerve ? '神' : ''].filter(Boolean);
      if (badges.length) { g.fillStyle(0x1a2028); g.fillRect(left - 2, top - 11, width + 4, 10); this.pooled(x, top - 6, badges.join('·'), 9, '#f0b429'); }
    }
    // 部署朝向选择覆盖层
    if (m.dropPick) {
      const center = displayPosition(m.dropPick, m.viewer);
      const internalDirection = m.dropDirection ?? (m.active === 'blue' ? 0 : 2);
      const screenDirection = (internalDirection + (m.viewer === 'red' ? 2 : 0)) % 4;
      const cx = PAD + (center.c - .5) * TILE, cy = PAD + (center.r - .5) * TILE;
      for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const rr = center.r + dr, cc = center.c + dc;
        if (rr < 1 || rr > BOARD_ROWS || cc < 1 || cc > BOARD_COLS) continue;
        const direction = dr < 0 ? 0 : dc > 0 ? 1 : dr > 0 ? 2 : dc < 0 ? 3 : undefined;
        const activeDirection = direction !== undefined && direction === screenDirection;
        g.fillStyle(activeDirection ? C.gold : C.gold, activeDirection ? .55 : .24);
        g.fillRect(PAD + (cc - 1) * TILE + 2, PAD + (rr - 1) * TILE + 2, TILE - 4, TILE - 4);
        g.lineStyle(activeDirection ? 4 : 2, activeDirection ? C.goldBright : C.gold, activeDirection ? 1 : .75);
        g.strokeRect(PAD + (cc - 1) * TILE + 3, PAD + (rr - 1) * TILE + 3, TILE - 6, TILE - 6);
      }
      if (screenDirection !== undefined) {
        const vector = [[0, -1], [1, 0], [0, 1], [-1, 0]][screenDirection];
        g.lineStyle(5, C.goldBright, .95);
        g.lineBetween(cx, cy - vector[1] * 2, cx + vector[0] * 43, cy + vector[1] * 43);
        g.fillStyle(C.goldBright, 1);
        g.fillTriangle(
          cx + vector[0] * 55, cy + vector[1] * 55,
          cx + vector[0] * 35 - vector[1] * 10, cy + vector[1] * 35 + vector[0] * 10,
          cx + vector[0] * 35 + vector[1] * 10, cy + vector[1] * 35 - vector[0] * 10,
        );
      }
      g.fillStyle(0x0c0f13, .9); g.fillCircle(cx, cy, 19);
      g.lineStyle(3, C.gold, .98); g.strokeCircle(cx, cy, 19);
      g.lineStyle(1, C.goldBright, .9); g.strokeCircle(cx, cy, 14);
      g.fillStyle(C.gold, 1);
      g.fillTriangle(cx, cy - 10, cx + 7, cy + 5, cx, cy + 2);
      g.fillTriangle(cx, cy - 10, cx - 7, cy + 5, cx, cy + 2);
      g.fillStyle(0xfff4d6, .95); g.fillCircle(cx, cy + 8, 3);
      g.lineStyle(1, 0xfff4d6, .8);
      g.lineBetween(cx - 7, cy + 13, cx + 7, cy + 13);
      g.fillStyle(C.gold); g.lineStyle(3, C.gold, 1);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const rr = center.r + dr, cc = center.c + dc;
        if (rr < 1 || rr > BOARD_ROWS || cc < 1 || cc > BOARD_COLS) continue;
        const mx = PAD + (cc - .5) * TILE, my = PAD + (rr - .5) * TILE;
        // 三角形：尖端指向 (dr,dc)，底边在格中心后方
        g.fillTriangle(mx + dc * 22, my + dr * 22, mx - dc * 8 - dr * 11, my - dr * 8 + dc * 11, mx - dc * 8 + dr * 11, my - dr * 8 - dc * 11);
        g.lineBetween(mx - dc * 16, my - dr * 16, mx - dc * 2, my - dr * 2);
      }
    }
  }
}
export function Board({ model, onCell, onHover, onRight, onDirectionHover, onDirection }: BoardProps) {
  const container = useRef<HTMLDivElement>(null), scene = useRef<TacticalScene | null>(null);
  const current = useRef({ model, onCell, onHover, onRight, onDirectionHover, onDirection });
  current.current = { model, onCell, onHover, onRight, onDirectionHover, onDirection };
  useEffect(() => {
    const tactical = new TacticalScene({ key: 'tactical' });
    tactical.dataModel = current.current.model;
    tactical.cellClick = p => current.current.onCell(p); tactical.cellHover = p => current.current.onHover(p); tactical.cellRight = () => current.current.onRight?.();
    tactical.directionHover = direction => current.current.onDirectionHover?.(direction);
    tactical.directionSelect = direction => current.current.onDirection?.(direction);
    scene.current = tactical;
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: BOARD_W, height: BOARD_H, parent: container.current!,
      backgroundColor: '#0c0f13', scene: tactical, render: { antialias: true }, audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    return () => { game.destroy(true); scene.current = null; };
  }, []);
  useEffect(() => { if (scene.current) { scene.current.dataModel = model; scene.current.paint(); } }, [model]);
  return <div className={`board-canvas ${model.dropPick ? 'aiming' : ''}`} ref={container} data-testid="board" aria-label="7乘9战术地图" />;
}
