
export type Side = 'blue' | 'red';
export type Direction = 0 | 1 | 2 | 3;
export type Position = { r: number; c: number };
export type Profession = '先锋' | '近卫' | '重装' | '特种' | '医疗' | '辅助' | '术士' | '狙击';
export type Element = 'burn' | 'nerve' | 'decay';
export type Zone = 'deck' | 'hand' | 'board' | 'discard' | 'removed';
export type Effect = 'heal' | 'cold' | 'smoke' | 'burn' | 'nerve' | 'decay' | 'draw' | 'cap' | 'damage';
export interface SkillDefinition {
  name: string; turns: number; type: 'burst' | 'ammo'; ammo?: number; bonus: number;
}
export interface CardDefinition {
  id: string; name: string; kind: 'operator' | 'command'; cost: number; description: string;
  profession?: Profession; hp?: number; power?: number; damage?: 'physical' | 'arts' | 'true';
  armor?: number; resist?: number; block?: number; mode?: 'melee' | 'ranged';
  range?: number[][]; skill?: SkillDefinition; grade?: 'A' | 'B' | 'C' | 'D';
  effect?: Effect; amount?: number; target?: 'ally' | 'enemy' | 'global'; element?: Element;
}
export interface CardInstance { id: string; definition: string; owner: Side; cost: number; zone: Zone }
export interface Unit extends Position {
  id: string; owner: Side; direction: Direction; entered: number; hp: number; deployed: number;
  moved: boolean; attacked: boolean; charge: number; skillActive: boolean; skillK: number;
  ammo: number; skillOpened: number; extraCharge: number; cold: number;
  frozenUntil: number; burnUntil: number; immuneUntil: number; smoke: boolean; nerve: boolean;
  lockUntilOwnTurn: number; elements: Record<Element, number>; lastElement: Record<Element, number>;
}
export interface Player {
  cp: number; cap: number; score: number; ownTurn: number; deployed: number;
  deck: string[]; hand: string[]; discard: string[]; removed: string[];
}
export interface LogEntry { id: number; turn: number; text: string }
export interface GameState {
  schema: 1; rulesVersion: string; contentVersion: string; mode: 'local' | 'demo';
  turn: number; active: Side; phase: 'action' | 'discard' | 'over'; discardReturn: 'action' | 'over';
  players: Record<Side, Player>; cards: Record<string, CardInstance>; units: Record<string, Unit>;
  rng: number; sequence: number; revision: number; logs: LogEntry[];
  pendingStart: boolean;
  winner?: Side | 'draw'; result?: string;
}
export type Action =
  | { type: 'deploy'; card: string; position: Position; direction: Direction }
  | { type: 'move'; unit: string; position: Position; direction: Direction }
  | { type: 'attack'; unit: string; target: string }
  | { type: 'heal'; unit: string; target: string }
  | { type: 'skill'; unit: string }
  | { type: 'closeSkill'; unit: string }
  | { type: 'retreat'; unit: string }
  | { type: 'command'; card: string; target?: string }
  | { type: 'discard'; cards: string[] }
  | { type: 'end' };
export type Outcome = { ok: true; state: GameState } | { ok: false; error: string };
export interface PlayerView {
  state: Omit<GameState, 'cards' | 'players' | 'rng'>;
  players: Record<Side, Omit<Player, 'deck' | 'hand'> & { deckCount: number; handCount: number; hand?: CardInstance[] }>;
  visibleCards: Record<string, CardInstance>;
}
