import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Action, CardDefinition, Direction, Position, Side, Unit } from '../../../packages/rules/types';
import { BOARD_ROWS, BOARD_COLS } from '../../../packages/rules/engine';
import { ensureBoardFxTextures, ensureOperatorTexture } from './CharacterArt';

export const TILE = 80, PAD = 50;
export const BOARD_W = PAD * 2 + BOARD_COLS * TILE; // 660
export const BOARD_H = PAD * 2 + BOARD_ROWS * TILE; // 820
const FONT = '"Rajdhani", "Segoe UI", "Microsoft YaHei", sans-serif';

// 工业终端 + 伪 3D 战术棋盘：所有视觉素材均为程序化原创绘制。
const C = {
  bg: 0x080c11,
  frame: 0x425362,
  line: 0x2c3a47,
  innerLine: 0x23303c,
  terrain: [0x17212a, 0x19242e, 0x151f28, 0x1a252e] as number[],
  tileSide: 0x0b1118,
  tileLight: 0x3b4d5b,
  friendlyTile: 0x1d3540, friendlyEdge: 0x4d7d89,
  enemyTile: 0x392524, enemyEdge: 0x75473e,
  contour: 0x2c3b47,
  friendlyHatch: 0x3d6572, enemyHatch: 0x624039,
  gold: 0xf0b429, goldBright: 0xffd166,
  danger: 0xd9644a,
  steel: 0x70b7c5, steelDim: 0x41586a,
  mutedText: '#687b89', footer: '#526574',
  text: '#d7e0e8', textDim: '#8a94a0',
};

export interface BoardUnit extends Unit { data: CardDefinition }
export interface BoardModel {
  viewer: Side; active: Side; turn: number; units: BoardUnit[]; selected?: string;
  highlights: Position[]; costs: Record<string, number>; focused?: Position; kind?: string;
  dropPick?: Position; dropDirection?: Direction; dropHover?: Position;
  // 表现层只读信号：不改变 GameState，也不参与存档。
  revision?: number;
  action?: Action;
}
interface BoardProps {
  model: BoardModel;
  onCell: (p: Position) => void;
  onHover: (p?: Position) => void;
  onHoverUnit?: (id?: string) => void;
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

interface UnitLayout { x: number; y: number; scale: number; crowded: boolean }
interface UnitActor {
  image: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  targetX: number;
  targetY: number;
  displayScale: number;
  phase: number;
  motion: boolean;
  ringActive: boolean;
  statusTint?: number;
}

class TacticalScene extends Phaser.Scene {
  dataModel?: BoardModel;
  cellClick: (p: Position) => void = () => {};
  cellHover: (p?: Position) => void = () => {};
  cellHoverUnit: (id?: string) => void = () => {};
  cellRight: () => void = () => {};
  directionHover: (direction?: Direction) => void = () => {};
  directionSelect: (direction: Direction) => void = () => {};
  private staticArt?: Phaser.GameObjects.Graphics;
  private art?: Phaser.GameObjects.Graphics;
  private unitUi?: Phaser.GameObjects.Graphics;
  private aimArt?: Phaser.GameObjects.Graphics;
  private pool: Phaser.GameObjects.Text[] = [];
  private poolCursor = 0;
  private poolSizes = new Map<Phaser.GameObjects.Text, number>();
  private lastHover = '';
  private lastHoverUnit = '';
  private unitHits: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private orientationGesture = false;
  private previewDirection?: Direction;
  private actors = new Map<string, UnitActor>();
  private previousUnits = new Map<string, BoardUnit>();
  private lastRevision = -1;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  create() {
    ensureBoardFxTextures(this);
    this.staticArt = this.add.graphics().setDepth(0);
    this.drawStatic();
    this.art = this.add.graphics().setDepth(20);
    this.unitUi = this.add.graphics().setDepth(4000);
    this.aimArt = this.add.graphics().setDepth(5000);
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
      const hit = this.hitUnit(pointer.x, pointer.y); const hitId = hit ?? '';
      if (hitId !== this.lastHoverUnit) { this.lastHoverUnit = hitId; this.cellHoverUnit(hit); }
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
      this.lastHoverUnit = ''; this.cellHoverUnit(undefined);
      if (!this.orientationGesture) this.setPreviewDirection(undefined);
    });
    this.applyDpr();
    this.paint();
  }

  // 高分屏适配：逻辑坐标保持 BOARD_W×BOARD_H，输入命中不受影响。
  private applyDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr <= 1) return;
    const canvas = this.game.canvas;
    canvas.width = BOARD_W * dpr;
    canvas.height = BOARD_H * dpr;
    const renderer = this.game.renderer as { width: number; height: number };
    renderer.width = BOARD_W * dpr;
    renderer.height = BOARD_H * dpr;
    this.cameras.main.setZoom(dpr);
  }

  private hitUnit(x: number, y: number): string | undefined {
    for (let i = this.unitHits.length - 1; i >= 0; i--) {
      const h = this.unitHits[i];
      if (x >= h.x - h.w / 2 && x <= h.x + h.w / 2 && y >= h.y - h.h / 2 && y <= h.y + h.h / 2) return h.id;
    }
    return undefined;
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
    return this.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color }).setOrigin(origin).setDepth(2);
  }
  private pooled(x: number, y: number, str: string, size = 13, color = C.mutedText, origin = 0.5) {
    let t = this.pool[this.poolCursor];
    if (!t) {
      t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color }).setOrigin(origin).setDepth(6000);
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

  // 静态层：带侧面厚度与顶光的 63 格地形；输入仍使用原始平面格坐标。
  private drawStatic() {
    const g = this.staticArt!;
    g.fillStyle(C.bg); g.fillRect(0, 0, BOARD_W, BOARD_H);
    g.fillStyle(0x111a23, .55); g.fillTriangle(0, 0, BOARD_W * .72, 0, 0, BOARD_H * .62);
    g.lineStyle(2, C.frame); g.strokeRect(PAD - 8, PAD - 8, TILE * BOARD_COLS + 16, TILE * BOARD_ROWS + 16);
    g.lineStyle(1, C.innerLine, .7); g.strokeRect(14, 14, BOARD_W - 28, BOARD_H - 28);
    for (let row = 1; row <= BOARD_ROWS; row++) {
      for (let col = 1; col <= BOARD_COLS; col++) {
        const x = PAD + (col - 1) * TILE, y = PAD + (row - 1) * TILE;
        const friendlyDeploy = (row === 9 && col >= 2 && col <= 6) || (row === 8 && col >= 3 && col <= 5);
        const enemyDeploy = (row === 1 && col >= 2 && col <= 6) || (row === 2 && col >= 3 && col <= 5);
        const isTarget = (row === 1 || row === 9) && col === 4;
        const terrain = C.terrain[(row * 13 + col * 17) % 4];
        // 底面与右/下侧面先画，形成连续的悬浮地图板块。
        g.fillStyle(0x05090d, .75); g.fillRect(x + 4, y + 7, TILE - 2, TILE - 1);
        g.fillStyle(C.tileSide); g.fillRect(x + 2, y + TILE - 8, TILE - 3, 7);
        g.fillStyle(friendlyDeploy ? C.friendlyTile : enemyDeploy ? C.enemyTile : terrain);
        g.fillRect(x + 1, y + 1, TILE - 3, TILE - 9);
        g.fillStyle(0xffffff, .025); g.fillTriangle(x + 2, y + 2, x + TILE - 4, y + 2, x + 2, y + TILE - 10);
        g.lineStyle(1, friendlyDeploy ? C.friendlyEdge : enemyDeploy ? C.enemyEdge : C.line, .78);
        g.strokeRect(x + 1, y + 1, TILE - 3, TILE - 9);
        g.lineStyle(1, C.tileLight, .35); g.lineBetween(x + 4, y + 3, x + TILE - 6, y + 3);
        g.lineStyle(1, C.contour, .16);
        for (let contour = 0; contour < 2; contour++) {
          const offset = (row * 9 + col * 7 + contour * 19) % 43;
          g.lineBetween(x + 9, y + 13 + offset, x + 29, y + 7 + offset);
          g.lineBetween(x + 29, y + 7 + offset, x + 54, y + 13 + offset);
        }
        if (friendlyDeploy || enemyDeploy) {
          g.lineStyle(1, friendlyDeploy ? C.friendlyHatch : C.enemyHatch, .45);
          for (let k = 10; k < 66; k += 14) g.lineBetween(x + k, y + 59, x + k + 9, y + 68);
        }
        if (isTarget) {
          g.fillStyle(C.gold, .18); g.fillRect(x + 12, y + 8, 56, 56);
          g.lineStyle(2, C.gold, .95); g.strokeRect(x + 14, y + 10, 52, 52);
          g.fillStyle(C.gold, .9);
          g.fillTriangle(x + 40, y + 20, x + 54, y + 36, x + 40, y + 52);
          g.fillTriangle(x + 40, y + 20, x + 26, y + 36, x + 40, y + 52);
        }
      }
    }
    this.staticText(BOARD_W / 2, BOARD_H - 17, 'RE:CONNECTION  /  TACTICAL MAP 07×09', 10, C.footer);
  }

  private groundPosition(unit: Unit, viewer: Side): Position & { x: number; y: number } {
    const p = displayPosition(unit, viewer);
    return { ...p, x: PAD + (p.c - .5) * TILE, y: PAD + (p.r - .5) * TILE + 12 };
  }

  private createActor(unit: BoardUnit, layout: UnitLayout): UnitActor {
    const faction = unit.owner === this.dataModel?.viewer ? 'blue' : 'red';
    const facing = (this.dataModel?.viewer === 'red' ? unit.direction + 2 : unit.direction) % 4 as Direction;
    const texture = ensureOperatorTexture(this, unit.data, faction, facing);
    const shadow = this.add.image(layout.x, layout.y + 8, 'unit-shadow').setScale(.5 * layout.scale).setDepth(100 + layout.y);
    const ring = this.add.image(layout.x, layout.y + 8, `unit-ring-${faction}`).setScale(.44 * layout.scale).setDepth(101 + layout.y).setAlpha(0);
    const image = this.add.image(layout.x, layout.y, texture).setOrigin(.5, .78).setScale(.5 * layout.scale).setDepth(200 + layout.y);
    const actor: UnitActor = { image, shadow, ring, targetX: layout.x, targetY: layout.y, displayScale: .5 * layout.scale, phase: this.actors.size * 1.37, motion: false, ringActive: false };
    this.actors.set(unit.id, actor);
    return actor;
  }

  private stopActorMotion(actor: UnitActor) {
    this.tweens.killTweensOf([actor.image, actor.shadow, actor.ring]);
    actor.motion = false;
    actor.image.setPosition(actor.targetX, actor.targetY).setAlpha(1).setAngle(0).setScale(actor.displayScale);
    actor.shadow.setPosition(actor.targetX, actor.targetY + 8).setAlpha(1).setScale(actor.displayScale);
  }

  private animateDeploy(actor: UnitActor) {
    if (this.reducedMotion) return;
    this.stopActorMotion(actor);
    actor.motion = true;
    actor.image.setPosition(actor.targetX, actor.targetY - 28).setScale(actor.displayScale * .72).setAlpha(0);
    actor.shadow.setAlpha(0);
    actor.ring.setAlpha(.8).setScale(actor.displayScale * 1.4);
    this.tweens.add({ targets: actor.image, y: actor.targetY, alpha: 1, scaleX: actor.displayScale, scaleY: actor.displayScale, duration: 360, ease: 'Back.easeOut', onComplete: () => { actor.motion = false; } });
    this.tweens.add({ targets: actor.shadow, alpha: 1, duration: 280 });
    this.tweens.add({ targets: actor.ring, alpha: 0, scaleX: actor.displayScale * .88, scaleY: actor.displayScale * .88, duration: 460 });
  }

  private animateMove(actor: UnitActor, from: { x: number; y: number }) {
    if (this.reducedMotion) return;
    this.stopActorMotion(actor);
    actor.motion = true;
    actor.image.setPosition(from.x, from.y);
    actor.shadow.setPosition(from.x, from.y + 8);
    const progress = { value: 0 };
    this.tweens.add({ targets: progress, value: 1, duration: 360, ease: 'Sine.easeInOut',
      onUpdate: () => {
        const t = progress.value;
        const x = Phaser.Math.Linear(from.x, actor.targetX, t);
        actor.image.setPosition(x, Phaser.Math.Linear(from.y, actor.targetY, t) - Math.sin(t * Math.PI) * 18);
        actor.shadow.setPosition(x, Phaser.Math.Linear(from.y, actor.targetY, t) + 8).setScale(actor.displayScale * (1 - Math.sin(t * Math.PI) * .25));
        actor.image.setDepth(200 + actor.image.y);
      },
      onComplete: () => { actor.motion = false; actor.image.setPosition(actor.targetX, actor.targetY); actor.shadow.setPosition(actor.targetX, actor.targetY + 8); },
    });
  }

  private animateAttack(actor: UnitActor, target?: { x: number; y: number }) {
    if (this.reducedMotion || !target) return;
    this.stopActorMotion(actor);
    actor.motion = true;
    const dx = target.x - actor.targetX, dy = target.y - actor.targetY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const lungeX = actor.targetX + dx / length * 18, lungeY = actor.targetY + dy / length * 12 - 4;
    this.tweens.add({ targets: actor.image, x: lungeX, y: lungeY, scaleY: actor.displayScale * 1.06, duration: 110, yoyo: true, ease: 'Quad.easeOut', onComplete: () => { actor.motion = false; actor.image.setPosition(actor.targetX, actor.targetY).setScale(actor.displayScale); } });
    this.spawnSlash(target.x, target.y - 34, actor.image.flipX ? -1 : 1);
  }

  private animateHit(actor: UnitActor, amount: number, heal = false, shake = true) {
    this.floatText(actor.targetX, actor.targetY - 78, `${heal ? '+' : '−'}${Math.abs(amount)}`, heal ? '#8fe0bd' : '#ff9a79');
    if (this.reducedMotion) return;
    if (!heal) {
      actor.image.setTintFill(0xffd5c5);
      this.time.delayedCall(110, () => { if (actor.image.active) { actor.image.clearTint(); if (actor.statusTint) actor.image.setTint(actor.statusTint); } });
    }
    if (shake && !actor.motion) {
      actor.motion = true;
      this.tweens.add({ targets: actor.image, x: actor.targetX + (heal ? 0 : 4), duration: 55, yoyo: true, repeat: heal ? 0 : 2, onComplete: () => { actor.motion = false; actor.image.setX(actor.targetX); } });
    }
  }

  private animateSkill(actor: UnitActor) {
    if (this.reducedMotion) return;
    actor.ring.setAlpha(.95).setScale(actor.displayScale * .72);
    this.tweens.add({ targets: actor.ring, alpha: .28, scaleX: actor.displayScale * 1.35, scaleY: actor.displayScale * 1.35, duration: 420, ease: 'Sine.easeOut' });
    this.floatText(actor.targetX, actor.targetY - 92, 'SKILL', '#ffd166');
  }

  private animateRemoval(actor: UnitActor) {
    this.actors.forEach((value, key) => { if (value === actor) this.actors.delete(key); });
    if (this.reducedMotion) { actor.image.destroy(); actor.shadow.destroy(); actor.ring.destroy(); return; }
    this.tweens.add({ targets: actor.image, alpha: 0, y: actor.image.y - 12, scaleY: actor.displayScale * .72, duration: 240, onComplete: () => actor.image.destroy() });
    this.tweens.add({ targets: [actor.shadow, actor.ring], alpha: 0, duration: 200, onComplete: () => { actor.shadow.destroy(); actor.ring.destroy(); } });
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const label = this.add.text(x, y, text, { fontFamily: FONT, fontSize: 16, fontStyle: 'bold', color, stroke: '#071016', strokeThickness: 3 }).setOrigin(.5).setDepth(7000);
    if (this.reducedMotion) { this.time.delayedCall(450, () => label.destroy()); return; }
    this.tweens.add({ targets: label, y: y - 26, alpha: 0, duration: 620, ease: 'Cubic.easeOut', onComplete: () => label.destroy() });
  }

  private spawnSlash(x: number, y: number, direction: number) {
    if (this.reducedMotion) return;
    const slash = this.add.graphics().setDepth(6500);
    slash.lineStyle(4, C.goldBright, .95);
    slash.beginPath(); slash.arc(x, y, 25, direction > 0 ? -1.2 : 1.9, direction > 0 ? .8 : 3.9); slash.strokePath();
    slash.lineStyle(1.5, 0xffffff, .8);
    slash.beginPath(); slash.arc(x, y, 18, direction > 0 ? -1.1 : 2, direction > 0 ? .65 : 3.75); slash.strokePath();
    this.tweens.add({ targets: slash, alpha: 0, scale: 1.35, duration: 210, onComplete: () => slash.destroy() });
  }

  private syncActors(m: BoardModel, layouts: Map<string, UnitLayout>) {
    const revision = m.revision ?? 0;
    const changed = revision !== this.lastRevision;
    const action = changed ? m.action : undefined;
    const nextIds = new Set(m.units.map(u => u.id));
    for (const unit of m.units) {
      const layout = layouts.get(unit.id)!;
      const previous = this.previousUnits.get(unit.id);
      const actor = this.actors.get(unit.id) ?? this.createActor(unit, layout);
      actor.targetX = layout.x; actor.targetY = layout.y; actor.displayScale = .5 * layout.scale;
      const faction = unit.owner === m.viewer ? 'blue' : 'red';
      const facing = (m.viewer === 'red' ? unit.direction + 2 : unit.direction) % 4 as Direction;
      actor.image.setTexture(ensureOperatorTexture(this, unit.data, faction, facing));
      actor.ring.setTexture(`unit-ring-${faction}`);
      actor.statusTint = unit.frozenUntil >= m.turn ? 0xa6d9ef : unit.cold > 0 ? 0xc0e4ef : undefined;
      if (!actor.motion) {
        actor.image.setPosition(layout.x, layout.y).setScale(actor.displayScale).setAlpha(unit.smoke ? .68 : 1);
        actor.shadow.setPosition(layout.x, layout.y + 8).setScale(actor.displayScale);
        actor.ring.setPosition(layout.x, layout.y + 8).setScale(actor.displayScale * .88);
        if (actor.statusTint) actor.image.setTint(actor.statusTint); else actor.image.clearTint();
      }
      actor.image.setDepth(200 + layout.y);
      actor.shadow.setDepth(100 + layout.y);
      actor.ring.setDepth(101 + layout.y);
      const ringActive = m.selected === unit.id || unit.skillActive;
      actor.ringActive = ringActive;
      if (ringActive && actor.ring.alpha === 0) actor.ring.setAlpha(unit.skillActive ? .48 : .72);
      if (!ringActive && !actor.motion) actor.ring.setAlpha(0);

      if (changed && !previous) this.animateDeploy(actor);
      if (changed && previous) {
        const moved = previous.r !== unit.r || previous.c !== unit.c;
        if (action?.type === 'move' && action.unit === unit.id || moved) {
          const from = this.groundPosition(previous, m.viewer);
          this.animateMove(actor, from);
        }
        if (action?.type === 'attack' && action.unit === unit.id) {
          const target = layouts.get(action.target) ?? (this.previousUnits.get(action.target) ? this.groundPosition(this.previousUnits.get(action.target)!, m.viewer) : undefined);
          this.animateAttack(actor, target);
        }
        if (unit.hp !== previous.hp) this.animateHit(actor, unit.hp - previous.hp, unit.hp > previous.hp, !actor.motion);
        if (unit.skillActive !== previous.skillActive && unit.skillActive) this.animateSkill(actor);
      }
    }
    if (changed) {
      for (const [id, previous] of this.previousUnits) {
        if (nextIds.has(id)) continue;
        const actor = this.actors.get(id);
        if (actor) {
          if (action?.type === 'attack' && action.target === id) this.spawnSlash(actor.targetX, actor.targetY - 34, 1);
          this.animateRemoval(actor);
        }
      }
    }
    this.previousUnits = new Map(m.units.map(unit => [unit.id, unit]));
    this.lastRevision = revision;
  }

  paint() {
    if (!this.art || !this.unitUi || !this.aimArt || !this.dataModel) return;
    const m = this.dataModel, g = this.art, ui = this.unitUi, aim = this.aimArt;
    this.resetPool(); g.clear(); ui.clear(); aim.clear();
    this.unitHits = [];
    const layouts = new Map<string, UnitLayout>();
    const counts = new Map<string, number>();
    for (const unit of m.units) {
      const p = displayPosition(unit, m.viewer), key = `${p.r}:${p.c}:${unit.owner}`;
      const index = counts.get(key) ?? 0; counts.set(key, index + 1);
      const friendly = unit.owner === m.viewer;
      const hasEnemy = m.units.some(v => v.r === unit.r && v.c === unit.c && v.owner !== unit.owner);
      let x = PAD + (p.c - .5) * TILE, y = PAD + (p.r - .5) * TILE + 12;
      if (hasEnemy) { x += friendly ? -19 : 19; y += index * 4 - 2; }
      else { x += index * 7 - Math.min(counts.get(key)! - 1, 2) * 2; y += index * 4 - 2; }
      const scale = hasEnemy ? .82 : 1;
      layouts.set(unit.id, { x, y, scale, crowded: hasEnemy });
      this.unitHits.push({ id: unit.id, x, y: y - 32, w: 56 * scale, h: 86 * scale });
    }
    this.syncActors(m, layouts);

    const highlights = new Set(m.highlights.map(p => `${p.r}:${p.c}`));
    for (let row = 1; row <= BOARD_ROWS; row++) {
      for (let col = 1; col <= BOARD_COLS; col++) {
        const internal = displayPosition({ r: row, c: col }, m.viewer);
        const x = PAD + (col - 1) * TILE, y = PAD + (row - 1) * TILE;
        if (highlights.has(`${internal.r}:${internal.c}`)) {
          const attack = m.kind === 'attack' || m.kind === 'command-enemy';
          const color = attack ? C.danger : C.gold;
          g.fillStyle(color, .16); g.fillRect(x + 3, y + 3, TILE - 7, TILE - 13);
          g.lineStyle(2, color, .9); g.strokeRect(x + 4, y + 4, TILE - 9, TILE - 15);
          g.fillStyle(color, .8); g.fillTriangle(x + 8, y + 8, x + 19, y + 8, x + 8, y + 19);
          const cost = m.costs[`${internal.r}:${internal.c}`];
          if (cost !== undefined) this.pooled(x + 65, y + 12, String(cost) + '◇', 12, '#ffd166');
        }
        if (m.focused && m.focused.r === internal.r && m.focused.c === internal.c) {
          g.lineStyle(2, C.goldBright, .9); g.strokeRect(x + 5, y + 5, TILE - 11, TILE - 17);
        }
        if (m.dropHover && m.dropHover.r === internal.r && m.dropHover.c === internal.c) {
          g.fillStyle(C.gold, .24); g.fillRect(x + 3, y + 3, TILE - 7, TILE - 13);
          g.lineStyle(4, C.goldBright, .98); g.strokeRect(x + 4, y + 4, TILE - 9, TILE - 15);
          g.lineStyle(1, 0xfff4d6, .85); g.strokeRect(x + 9, y + 9, TILE - 19, TILE - 25);
        }
      }
    }
    for (let r = 1; r <= BOARD_ROWS; r++) {
      const logicR = displayPosition({ r, c: 1 }, m.viewer).r;
      this.pooled(25, PAD + (r - .5) * TILE, String(logicR).padStart(2, '0'), 13);
    }
    for (let c = 1; c <= BOARD_COLS; c++) {
      const logicC = displayPosition({ r: 1, c }, m.viewer).c;
      this.pooled(PAD + (c - .5) * TILE, 25, String(logicC).padStart(2, '0'), 13);
    }
    this.pooled(PAD + 3 * TILE + 40, PAD + 72, '我方目标', 11, '#f0b429');
    this.pooled(PAD + 3 * TILE + 40, PAD + (BOARD_ROWS - 1) * TILE + 72, '敌方目标', 11, '#d9644a');

    // 非卡牌式数值 HUD：只保留姓名、血条与必要的攻防信息。
    for (const unit of m.units) {
      const layout = layouts.get(unit.id)!;
      const friendly = unit.owner === m.viewer;
      const color = friendly ? C.steel : C.danger;
      const x = layout.x, y = layout.y;
      const compact = layout.crowded;
      this.pooled(x, y - 84 * layout.scale, unit.data.name, compact ? 9 : 11, C.text);
      const barW = compact ? 40 : 52, barY = y + 18;
      ui.fillStyle(0x05090d, .9); ui.fillRect(x - barW / 2 - 1, barY - 1, barW + 2, 6);
      ui.fillStyle(0x26323c); ui.fillRect(x - barW / 2, barY, barW, 4);
      ui.fillStyle(unit.hp / unit.data.hp! > .3 ? color : C.danger); ui.fillRect(x - barW / 2, barY, barW * Math.max(0, unit.hp / unit.data.hp!), 4);
      this.pooled(x + barW / 2 + 10, barY + 2, String(unit.hp), 10, '#ffffff');
      this.pooled(x - barW / 2 - 10, barY + 2, String(unit.data.power), 10, '#ffd166');
      if (m.selected === unit.id) {
        ui.lineStyle(2, C.goldBright, .95);
        ui.lineBetween(x - 30, y - 57, x - 30, y - 67); ui.lineBetween(x - 30, y - 67, x - 20, y - 67);
        ui.lineBetween(x + 30, y - 57, x + 30, y - 67); ui.lineBetween(x + 30, y - 67, x + 20, y - 67);
      }
      const badges = [unit.skillActive ? '技' : '', unit.frozenUntil >= m.turn ? '冻' : '', unit.cold ? `寒${unit.cold}` : '', unit.smoke ? '烟' : '', unit.nerve ? '神' : ''].filter(Boolean);
      if (badges.length) this.pooled(x, y - 98 * layout.scale, badges.join(' · '), 9, '#ffd166');
    }

    // 部署朝向选择始终位于角色与 HUD 之上。
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
        aim.fillStyle(C.gold, activeDirection ? .5 : .2);
        aim.fillRect(PAD + (cc - 1) * TILE + 2, PAD + (rr - 1) * TILE + 2, TILE - 4, TILE - 10);
        aim.lineStyle(activeDirection ? 4 : 2, activeDirection ? C.goldBright : C.gold, activeDirection ? 1 : .75);
        aim.strokeRect(PAD + (cc - 1) * TILE + 3, PAD + (rr - 1) * TILE + 3, TILE - 6, TILE - 12);
      }
      const vector = [[0, -1], [1, 0], [0, 1], [-1, 0]][screenDirection];
      aim.lineStyle(5, C.goldBright, .95);
      aim.lineBetween(cx, cy - vector[1] * 2, cx + vector[0] * 43, cy + vector[1] * 43);
      aim.fillStyle(C.goldBright, 1);
      aim.fillTriangle(cx + vector[0] * 55, cy + vector[1] * 55,
        cx + vector[0] * 35 - vector[1] * 10, cy + vector[1] * 35 + vector[0] * 10,
        cx + vector[0] * 35 + vector[1] * 10, cy + vector[1] * 35 - vector[0] * 10);
      aim.fillStyle(0x0c0f13, .92); aim.fillCircle(cx, cy, 19);
      aim.lineStyle(3, C.gold, .98); aim.strokeCircle(cx, cy, 19);
      aim.lineStyle(1, C.goldBright, .9); aim.strokeCircle(cx, cy, 14);
      aim.fillStyle(C.gold, 1);
      aim.fillTriangle(cx, cy - 10, cx + 7, cy + 5, cx, cy + 2);
      aim.fillTriangle(cx, cy - 10, cx - 7, cy + 5, cx, cy + 2);
      aim.fillStyle(0xfff4d6, .95); aim.fillCircle(cx, cy + 8, 3);
      aim.lineStyle(1, 0xfff4d6, .8); aim.lineBetween(cx - 7, cy + 13, cx + 7, cy + 13);
      aim.lineStyle(3, C.gold, 1);
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Array<[number, number]>) {
        const rr = center.r + dr, cc = center.c + dc;
        if (rr < 1 || rr > BOARD_ROWS || cc < 1 || cc > BOARD_COLS) continue;
        const mx = PAD + (cc - .5) * TILE, my = PAD + (rr - .5) * TILE;
        aim.fillTriangle(mx + dc * 22, my + dr * 22, mx - dc * 8 - dr * 11, my - dr * 8 + dc * 11, mx - dc * 8 + dr * 11, my - dr * 8 - dc * 11);
        aim.lineBetween(mx - dc * 16, my - dr * 16, mx - dc * 2, my - dr * 2);
      }
    }
  }

  update(time: number) {
    if (this.reducedMotion) return;
    for (const actor of this.actors.values()) {
      if (actor.motion) continue;
      const wave = Math.sin(time / 620 + actor.phase);
      actor.image.y = actor.targetY + wave * 1.35;
      actor.image.angle = wave * .35;
      actor.shadow.scaleX = actor.displayScale * (1 - wave * .025);
      if (!actor.ringActive) actor.ring.alpha = Math.max(0, actor.ring.alpha - .08);
    }
  }
}

export function Board({ model, onCell, onHover, onHoverUnit, onRight, onDirectionHover, onDirection }: BoardProps) {
  const container = useRef<HTMLDivElement>(null), scene = useRef<TacticalScene | null>(null);
  const current = useRef({ model, onCell, onHover, onHoverUnit, onRight, onDirectionHover, onDirection });
  current.current = { model, onCell, onHover, onHoverUnit, onRight, onDirectionHover, onDirection };
  useEffect(() => {
    const tactical = new TacticalScene({ key: 'tactical' });
    tactical.dataModel = current.current.model;
    tactical.cellClick = p => current.current.onCell(p); tactical.cellHover = p => current.current.onHover(p); tactical.cellHoverUnit = id => current.current.onHoverUnit?.(id); tactical.cellRight = () => current.current.onRight?.();
    tactical.directionHover = direction => current.current.onDirectionHover?.(direction);
    tactical.directionSelect = direction => current.current.onDirection?.(direction);
    scene.current = tactical;
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: BOARD_W, height: BOARD_H, parent: container.current!,
      backgroundColor: '#080c11', scene: tactical, render: { antialias: true }, audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    return () => { game.destroy(true); scene.current = null; };
  }, []);
  useEffect(() => { if (scene.current) { scene.current.dataModel = model; scene.current.paint(); } }, [model]);
  return <div className={`board-canvas ${model.dropPick ? 'aiming' : ''}`} ref={container} data-testid="board" aria-label="7乘9战术地图" />;
}
