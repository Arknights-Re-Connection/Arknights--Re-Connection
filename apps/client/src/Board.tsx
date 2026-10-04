import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { CardDefinition, Position, Side, Unit } from '../../../packages/rules/types';

export const BOARD_SIZE = 820;
const TILE = 80, PAD = 50;
export interface BoardUnit extends Unit { data: CardDefinition }
export interface BoardModel {
  viewer: Side; active: Side; turn: number; units: BoardUnit[]; selected?: string;
  highlights: Position[]; costs: Record<string, number>; focused?: Position; kind?: string;
}
interface BoardProps { model: BoardModel; onCell: (p: Position) => void; onHover: (p?: Position) => void }
export function displayPosition(p: Position, viewer: Side): Position { return viewer === 'blue' ? p : { r: 10 - p.r, c: 10 - p.c }; }

class TacticalScene extends Phaser.Scene {
  dataModel?: BoardModel;
  cellClick: (p: Position) => void = () => {};
  cellHover: (p?: Position) => void = () => {};
  private art?: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private lastHover = '';
  create() {
    this.art = this.add.graphics();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      const p = this.position(pointer.x, pointer.y);
      if (p) this.cellClick(p);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p = this.position(pointer.x, pointer.y); const key = p ? `${p.r}:${p.c}` : '';
      if (key !== this.lastHover) { this.lastHover = key; this.cellHover(p); }
    });
    this.input.on('gameout', () => { this.lastHover = ''; this.cellHover(undefined); });
    this.paint();
  }
  private position(x: number, y: number): Position | undefined {
    const p = { r: Math.floor((y - PAD) / TILE) + 1, c: Math.floor((x - PAD) / TILE) + 1 };
    if (p.r < 1 || p.r > 9 || p.c < 1 || p.c > 9) return;
    return displayPosition(p, this.dataModel?.viewer ?? 'blue');
  }
  private text(x: number, y: number, text: string, size = 13, color = '#424e3c', origin = 0.5) {
    const label = this.add.text(x, y, text, { fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif', fontSize: size, color }).setOrigin(origin);
    this.labels.push(label); return label;
  }
  paint() {
    if (!this.art || !this.dataModel) return;
    const m = this.dataModel, g = this.art;
    this.labels.forEach(label => label.destroy()); this.labels = []; g.clear();
    g.fillStyle(0xb9b7a0); g.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    g.lineStyle(2, 0x69735c); g.strokeRect(PAD - 8, PAD - 8, TILE * 9 + 16, TILE * 9 + 16);
    g.lineStyle(1, 0x6d755d, .4); g.strokeRect(14, 14, BOARD_SIZE - 28, BOARD_SIZE - 28);
    const highlights = new Set(m.highlights.map(p => `${p.r}:${p.c}`));
    for (let row = 1; row <= 9; row++) {
      this.text(25, PAD + (row - .5) * TILE, String(row).padStart(2, '0'), 13);
      this.text(PAD + (row - .5) * TILE, 25, String(row).padStart(2, '0'), 13);
      for (let col = 1; col <= 9; col++) {
        const internal = displayPosition({ r: row, c: col }, m.viewer);
        const x = PAD + (col - 1) * TILE, y = PAD + (row - 1) * TILE;
        const friendlyDeploy = (row === 9 && col >= 3 && col <= 7) || (row === 8 && col >= 4 && col <= 6);
        const enemyDeploy = (row === 1 && col >= 3 && col <= 7) || (row === 2 && col >= 4 && col <= 6);
        const isTarget = (row === 1 || row === 9) && col === 5;
        const terrain = [0x9aa28c, 0x969e89, 0x9ca48f, 0x959f8c][(row * 13 + col * 17) % 4];
        g.fillStyle(friendlyDeploy ? 0x879879 : enemyDeploy ? 0xa1917a : terrain);
        g.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
        g.lineStyle(1, friendlyDeploy ? 0x657754 : enemyDeploy ? 0x88795f : 0x6d795f, .65);
        g.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
        // Faint contour hatching gives the fixed grid the material of a printed operations map.
        g.lineStyle(1, 0x56654d, .12);
        for (let contour = 0; contour < 3; contour++) {
          const offset = (row * 9 + col * 7 + contour * 16) % 48;
          g.lineBetween(x + 7, y + 14 + offset, x + 28, y + 7 + offset);
          g.lineBetween(x + 28, y + 7 + offset, x + 53, y + 14 + offset);
          g.lineBetween(x + 53, y + 14 + offset, x + 73, y + 8 + offset);
        }
        if (friendlyDeploy || enemyDeploy) {
          g.lineStyle(1, friendlyDeploy ? 0x495f3c : 0x805c43, .4);
          for (let k = 10; k < 70; k += 14) g.lineBetween(x + k, y + 66, x + k + 10, y + 76);
        }
        if (isTarget) {
          const color = row === 9 ? 0x4d6340 : 0x82583f;
          g.fillStyle(0xc5c2a2, .8); g.fillRect(x + 12, y + 10, 56, 56);
          g.lineStyle(2, color, .9); g.strokeRect(x + 14, y + 12, 52, 52);
          g.lineBetween(x + 26, y + 44, x + 40, y + 30); g.lineBetween(x + 40, y + 30, x + 54, y + 44);
          g.lineBetween(x + 29, y + 41, x + 29, y + 54); g.lineBetween(x + 51, y + 41, x + 51, y + 54);
          this.text(x + 40, y + 72, row === 9 ? '我方目标' : '敌方目标', 11, row === 9 ? '#3e5531' : '#744731');
        }
        if (highlights.has(`${internal.r}:${internal.c}`)) {
          const attack = m.kind === 'attack' || m.kind === 'command-enemy';
          const color = attack ? 0xa64f33 : 0xecd279;
          g.fillStyle(color, .2); g.fillRect(x + 3, y + 3, TILE - 6, TILE - 6);
          g.lineStyle(2, color, .85); g.strokeRect(x + 4, y + 4, TILE - 8, TILE - 8);
          const cost = m.costs[`${internal.r}:${internal.c}`];
          if (cost !== undefined) this.text(x + 65, y + 12, String(cost) + '◇', 12, '#34472b');
        }
        if (m.focused && m.focused.r === internal.r && m.focused.c === internal.c) {
          g.lineStyle(2, 0xf7e7ba, .9); g.strokeRect(x + 5, y + 5, TILE - 10, TILE - 10);
        }
      }
    }
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
      const color = friendly ? 0x536b42 : 0x856044;
      const left = x - width / 2, top = y - height / 2;
      g.fillStyle(0x292b20, .3); g.fillRect(left + 3, top + 4, width, height);
      g.fillStyle(friendly ? 0xd8d3b3 : 0xcebc9e); g.fillRect(left, top, width, height);
      g.lineStyle(1.5, color); g.strokeRect(left, top, width, height);
      g.fillStyle(friendly ? 0x808f75 : 0x918475); g.fillRect(left + 3, top + 3, width - 6, 34);
      // The tabletop token is a small operator card, with printed portrait and live combat values.
      g.fillStyle(0x303f38, .65); g.fillTriangle(x - 11, top + 33, x, top + 15, x + 11, top + 33);
      g.fillStyle(0xc9bba0); g.fillCircle(x, top + 13, 5);
      g.fillStyle(0x35433b); g.fillRect(x - 5, top + 7, 10, 4);
      g.fillStyle(0xc4b47e); g.fillTriangle(x - 6, top + 19, x, top + 24, x + 6, top + 19);
      this.text(x, top + 43, u.data.name, hasEnemy ? 8 : 11, '#31432d');
      const badge = hasEnemy ? 12 : 15;
      g.fillStyle(0x415336); g.fillRect(left + 2, top + 48, badge, 12);
      g.fillStyle(0x704b34); g.fillRect(left + width - badge - 2, top + 48, badge, 12);
      this.text(left + 2 + badge / 2, top + 54, String(u.data.power), 10, '#efe7c9');
      this.text(left + width - badge / 2 - 2, top + 54, String(u.hp), 10, '#efe7c9');
      if (m.selected === u.id) { g.lineStyle(2.5, 0xf1d17e); g.strokeRect(left - 3, top - 3, width + 6, height + 6); }
      const displayedDirection = m.viewer === 'blue' ? u.direction : (u.direction + 2) % 4;
      const vector = [[0, -1], [1, 0], [0, 1], [-1, 0]][displayedDirection];
      const directionX = x + vector[0] * (width / 2 + 4), directionY = y + vector[1] * 35;
      g.fillStyle(color); g.fillCircle(directionX, directionY, 2.5);
      g.lineStyle(2, color); g.lineBetween(directionX, directionY, directionX + vector[0] * 5, directionY + vector[1] * 5);
      const badges = [u.skillActive ? '技' : '', u.frozenUntil >= m.turn ? '冻' : '', u.cold ? `寒${u.cold}` : '', u.smoke ? '烟' : '', u.nerve ? '神' : ''].filter(Boolean);
      if (badges.length) { g.fillStyle(0x31432c); g.fillRect(left - 2, top - 11, width + 4, 10); this.text(x, top - 6, badges.join('·'), 9, '#f0db9e'); }
    }
    this.text(BOARD_SIZE / 2, BOARD_SIZE - 17, 'RHODES ISLAND  /  OPERATIONS MAP 09', 10, '#647254');
  }
}
export function Board({ model, onCell, onHover }: BoardProps) {
  const container = useRef<HTMLDivElement>(null), scene = useRef<TacticalScene | null>(null);
  const current = useRef({ model, onCell, onHover }); current.current = { model, onCell, onHover };
  useEffect(() => {
    const tactical = new TacticalScene({ key: 'tactical' });
    tactical.dataModel = current.current.model;
    tactical.cellClick = p => current.current.onCell(p); tactical.cellHover = p => current.current.onHover(p);
    scene.current = tactical;
    const game = new Phaser.Game({ type: Phaser.CANVAS, width: BOARD_SIZE, height: BOARD_SIZE, parent: container.current!,
      backgroundColor: '#b9b7a0', scene: tactical, render: { antialias: true }, audio: { noAudio: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
    return () => { game.destroy(true); scene.current = null; };
  }, []);
  useEffect(() => { if (scene.current) { scene.current.dataModel = model; scene.current.paint(); } }, [model]);
  return <div className="board-canvas" ref={container} data-testid="board" aria-label="9乘9战术地图" />;
}
