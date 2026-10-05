
// 规则引擎：全部游戏裁定的唯一实现，不依赖任何界面；网页 / 桌面 / 联机共用。
// 约定：动作总是在克隆状态上执行，校验失败抛错，由 applyAction 统一捕获返回。
import { catalog, defaultDeck, validateDeck, CONTENT_VERSION } from '../content';
import type { Action, CardDefinition, CardInstance, Direction, Element, GameState, Outcome, Player, PlayerView, Position, Side, Unit } from './types';

export const RULES_VERSION = 'prd-v1-prototype-0.1';
export const sides: Side[] = ['blue', 'red'];
export const other = (side: Side): Side => side === 'blue' ? 'red' : 'blue';
export const sideName = (side: Side) => side === 'blue' ? '蓝方' : '红方';
export const elementName: Record<Element, string> = { burn: '灼燃', nerve: '神经', decay: '凋亡' };
export const samePosition = (a: Position, b: Position) => a.r === b.r && a.c === b.c;
export const inside = (p: Position) => Number.isInteger(p.r) && Number.isInteger(p.c) && p.r >= 1 && p.r <= 9 && p.c >= 1 && p.c <= 9;
// 统一失败出口：任何校验不通过都抛错
function fail(message: string): never { throw new Error(message); }
// 由卡实例 id 查其卡牌定义（数值面板）
export function definition(s: GameState, id: string): CardDefinition {
  const card = s.cards[id];
  if (!card || !catalog[card.definition]) return fail('卡牌不存在');
  return catalog[card.definition];
}
// 写作战日志，最多保留 100 条
function log(s: GameState, text: string) {
  s.logs.push({ id: ++s.sequence, turn: s.turn, text });
  if (s.logs.length > 100) s.logs.shift();
}
// 线性同余伪随机：种子相同则整局洗牌序列一致，可复现
function random(s: GameState) {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
// Fisher–Yates 洗牌，随机源取自状态内 rng
function shuffle<T>(s: GameState, list: T[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
}
// 双方部署区：底线 5 格 + 第二行 3 格
export function deploymentArea(side: Side): Position[] {
  return side === 'blue'
    ? [3, 4, 5, 6, 7].map(c => ({ r: 9, c })).concat([4, 5, 6].map(c => ({ r: 8, c })))
    : [3, 4, 5, 6, 7].map(c => ({ r: 1, c })).concat([4, 5, 6].map(c => ({ r: 2, c })));
}
export const isDeployment = (side: Side, p: Position) => deploymentArea(side).some(x => samePosition(x, p));
export const targetFor = (side: Side): Position => ({ r: side === 'blue' ? 1 : 9, c: 5 });
// 某格上的单位，按进场先后排序（队首在最前）
export function unitsAt(s: GameState, p: Position, side?: Side) {
  return Object.values(s.units).filter(u => samePosition(u, p) && (!side || u.owner === side)).sort((a, b) => a.entered - b.entered);
}
// 某格某方的阻挡干员（block > 0 才参与阻挡与自动交战）
function fightersAt(s: GameState, p: Position, side: Side) {
  return unitsAt(s, p, side).filter(u => definition(s, u.id).block! > 0);
}
// 准入容量：格内有敌方阻挡位时以其 block 数为限，否则 3
export function capacity(s: GameState, p: Position, side: Side) {
  const enemy = fightersAt(s, p, other(side))[0];
  return enemy ? Math.min(3, definition(s, enemy.id).block!) : 3;
}
// 该方单位能否进入此格：不超容量也不超同格 3 人
export function canEnter(s: GameState, p: Position, side: Side) {
  return inside(p) && unitsAt(s, p, side).length < capacity(s, p, side) && unitsAt(s, p, side).length < 3;
}
// 干员是否被敌方阻挡（被贴脸阻挡时不能主动移动）
export function blocked(s: GameState, u: Unit) {
  return definition(s, u.id).block! > 0 && fightersAt(s, u, other(u.owner)).length > 0;
}
export const frozen = (s: GameState, u: Unit) => u.frozenUntil >= s.turn;
// 把卡面相对坐标按朝向旋转（0上 1右 2下 3左）
export function rotatedOffset(dr: number, dc: number, direction: Direction): [number, number] {
  for (let k = 0; k < direction; k++) [dr, dc] = [dc, -dr];
  return [dr, dc];
}
// 当前朝向下的范围格（裁掉地图外的）
export function attackRange(s: GameState, u: Unit) {
  return definition(s, u.id).range!.map(([dr, dc]) => {
    const [r, c] = rotatedOffset(dr, dc, u.direction);
    return { r: u.r + r, c: u.c + c };
  }).filter(inside);
}
export function inRange(s: GameState, u: Unit, p: Position) {
  return attackRange(s, u).some(x => samePosition(x, p));
}
// 寒冷层数带来的额外行动费：1 层 +1，2 层 +3
export function coldCost(u: Unit) { return u.cold === 1 ? 1 : u.cold >= 2 ? 3 : 0; }
// 移动费按职业区分：先锋近距 0/远距 3、重装 1、近卫/特种 3、其余 2，再叠加寒冷
export function moveCost(s: GameState, u: Unit, p: Position) {
  const profession = definition(s, u.id).profession;
  const distance = Math.abs(u.r - p.r) + Math.abs(u.c - p.c);
  const base = profession === '先锋' ? (distance === 1 || distance === 0 ? 0 : 3)
    : profession === '重装' ? 1 : profession === '近卫' || profession === '特种' ? 3 : 2;
  return base + coldCost(u);
}
// 攻击/治疗费：治疗与远程 2 点、近战 1 点；技能期间弹药型每次 +skillK、爆发型按次数翻倍
export function actionCost(s: GameState, u: Unit, healing = false) {
  const d = definition(s, u.id);
  const base = healing || d.mode === 'ranged' ? 2 : 1;
  const cost = u.skillActive ? d.skill!.type === 'ammo' ? base + u.skillK : base * 2 ** u.skillK : base;
  return cost + (healing ? 0 : coldCost(u));
}
// 扣指挥点，不足则失败
function pay(s: GameState, side: Side, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || s.players[side].cp < amount) fail(`指挥点不足，需要 ${amount} 点`);
  s.players[side].cp -= amount;
}
// 取当前回合方的场上单位，否则失败
function requireUnit(s: GameState, id: string) {
  const u = s.units[id];
  if (!u) return fail('干员不在场上');
  if (u.owner !== s.active) fail('只能操作当前回合方的干员');
  return u;
}
// 行动前置限制：部署当回合与冻结期不能行动
function readyToAct(s: GameState, u: Unit) {
  if (u.deployed === s.turn) fail('部署当回合不能移动、攻击或治疗');
  if (frozen(s, u)) fail('干员被冻结');
}
// 关闭技能并清空弹药与次数计数（进入回转）
function closeSkill(u: Unit) { u.skillActive = false; u.charge = 0; u.ammo = 0; u.skillK = 0; }
// 卡实例进弃牌堆：increment 为本次事件带来的费用增长（封顶于指挥点上限）
function discardInstance(s: GameState, id: string, increment: number) {
  const card = s.cards[id];
  card.zone = 'discard';
  card.cost = Math.min(s.players[card.owner].cap, card.cost + increment);
  s.players[card.owner].discard.push(id);
  shuffle(s, s.players[card.owner].discard);
}
// 单位离场：得分=永久移除并计 1 分；被击败/撤退=进弃牌堆且卡费 +15/+5
function removeUnit(s: GameState, id: string, reason: 'defeat' | 'retreat' | 'score') {
  const u = s.units[id];
  if (!u) return;
  const d = definition(s, id);
  const player = s.players[u.owner];
  delete s.units[id];
  if (reason === 'score') {
    s.cards[id].zone = 'removed'; player.removed.push(id); player.score++;
    log(s, `${sideName(u.owner)}「${d.name}」抵达，得分 ${player.score}/3；本局永久移除，不返费`);
    if (player.score >= 3) finish(s, u.owner, '三名干员有效抵达目标点');
  } else {
    discardInstance(s, id, reason === 'defeat' ? 15 : 5);
    log(s, `${sideName(u.owner)}「${d.name}」${reason === 'defeat' ? '被击败' : '撤退'}，进入弃牌堆，后续部署费 ${s.cards[id].cost}`);
  }
}
// 结束对局并记录胜负原因
function finish(s: GameState, winner: Side | 'draw', result: string) {
  s.phase = 'over'; s.winner = winner; s.result = result; s.pendingStart = false;
  log(s, `${winner === 'draw' ? '平局' : `${sideName(winner)}胜利`}：${result}`);
}
// 清理场上所有生命 ≤0 的单位
function defeatCheck(s: GameState) {
  const ids = Object.values(s.units).filter(u => u.hp <= 0).map(u => u.id);
  ids.forEach(id => removeUnit(s, id, 'defeat'));
}
// 结算抵达得分：目标点无敌方阻挡位时，站在上面的己方单位逐一得分并永久移除
function checkScores(s: GameState) {
  for (const side of sides) {
    const p = targetFor(side);
    if (fightersAt(s, p, other(side)).length) continue;
    for (const unit of unitsAt(s, p, side)) {
      if (s.phase === 'over') return;
      removeUnit(s, unit.id, 'score');
    }
  }
}
// 伤害公式：力量（含技能加成）− 物甲/法抗；法术打灼燃目标 +1，打队首 −1；医疗与冻结者输出为 0
export function damageValue(s: GameState, from: Unit, to: Unit, rear = false) {
  const a = definition(s, from.id), b = definition(s, to.id);
  if (a.profession === '医疗' || frozen(s, from)) return 0;
  const power = a.power! + (from.skillActive ? a.skill!.bonus : 0);
  const defense = a.damage === 'physical' ? b.armor! : a.damage === 'arts' ? b.resist! : 0;
  return Math.max(0, Math.max(0, power - defense) + (a.damage === 'arts' && to.burnUntil >= s.turn ? 1 : 0) - (rear ? 1 : 0));
}
// 同格自动交战：双方队首互殴；只有出现减员才继续结算，双方存活则等下一个全局回合
function resolveClash(s: GameState, p: Position) {
  // Continue only after a casualty; two survivors wait for the next global turn.
  while (s.phase !== 'over') {
    const blue = fightersAt(s, p, 'blue')[0], red = fightersAt(s, p, 'red')[0];
    if (!blue || !red) break;
    const toRed = damageValue(s, blue, red), toBlue = damageValue(s, red, blue);
    blue.hp -= toBlue; red.hp -= toRed;
    log(s, `R${p.r}C${p.c} 自动交战：${definition(s, blue.id).name} −${toBlue} / ${definition(s, red.id).name} −${toRed}`);
    const casualty = blue.hp <= 0 || red.hp <= 0;
    defeatCheck(s);
    if (!casualty) break;
  }
  checkScores(s);
}
// 全图扫描所有对峙格并逐一结算
function resolveAllClashes(s: GameState) {
  for (let r = 1; r <= 9 && !s.winner; r++) for (let c = 1; c <= 9 && !s.winner; c++) {
    if (fightersAt(s, { r, c }, 'blue').length && fightersAt(s, { r, c }, 'red').length) resolveClash(s, { r, c });
  }
  checkScores(s);
}
// 抽牌：牌库空则把弃牌堆洗回（卡费保留）；手牌超 8 张进入弃牌阶段
function draw(s: GameState, side: Side, amount: number) {
  const p = s.players[side]; let count = 0;
  for (let i = 0; i < amount; i++) {
    if (!p.deck.length && p.discard.length) {
      p.deck = p.discard.splice(0); shuffle(s, p.deck);
      p.deck.forEach(id => { s.cards[id].zone = 'deck'; });
      log(s, `${sideName(side)}弃牌堆洗回抽牌堆，卡费保留`);
    }
    const id = p.deck.shift(); if (!id) break;
    p.hand.push(id); s.cards[id].zone = 'hand'; count++;
  }
  log(s, `${sideName(side)}抽 ${count} 张牌`);
  if (p.hand.length > 8) { s.phase = 'discard'; log(s, `${sideName(side)}手牌超限，需弃 ${p.hand.length - 8} 张`); }
}
// 回合开始：回 8 指挥点、重置己方行动标记、非技能单位充能 +1、抽 2 张，随后结算自动交战
function beginTurn(s: GameState) {
  const p = s.players[s.active]; p.ownTurn++; p.deployed = 0; p.cp = Math.min(p.cap, p.cp + 8);
  s.phase = 'action'; s.pendingStart = true;
  for (const u of Object.values(s.units)) {
    const d = definition(s, u.id);
    if (u.owner === s.active) { u.moved = false; u.attacked = false; }
    if (!u.skillActive) u.charge = Math.min(d.skill!.turns + u.extraCharge, u.charge + 1);
  }
  log(s, `${sideName(s.active)}回合开始，指挥点 +8（${p.cp}/${p.cap}）`);
  draw(s, s.active, 2);
  if (s.phase === 'action') { s.pendingStart = false; resolveAllClashes(s); }
}
// 初始玩家状态：5 指挥点、上限 100、0 分
function emptyPlayer(): Player {
  return { cp: 5, cap: 100, score: 0, ownTurn: 0, deployed: 0, deck: [], hand: [], discard: [], removed: [] };
}
// 按卡定义新建场上单位（满生命、零充能与状态）
export function newUnit(s: GameState, id: string, p: Position, direction: Direction): Unit {
  return { id, owner: s.cards[id].owner, ...p, direction, entered: ++s.sequence, hp: definition(s, id).hp!, deployed: s.turn,
    moved: false, attacked: false, charge: 0, skillActive: false, skillK: 0, ammo: 0, skillOpened: -1, extraCharge: 0,
    cold: 0, frozenUntil: 0, burnUntil: 0, immuneUntil: 0, smoke: false, nerve: false, lockUntilOwnTurn: 0,
    elements: { burn: 0, nerve: 0, decay: 0 }, lastElement: { burn: 0, nerve: 0, decay: 0 } };
}
// 开局：校验双方构筑 → 生成各 30 张实例并洗牌 → 先手 13 点/5 张、后手 5 点/4 张
export function createGame(mode: 'local' | 'demo' = 'local', seed = Date.now(), decks: Record<Side, string[]> = { blue: defaultDeck, red: defaultDeck }): GameState {
  for (const side of sides) { const error = validateDeck(decks[side]); if (error) fail(error); }
  const s: GameState = { schema: 1, rulesVersion: RULES_VERSION, contentVersion: CONTENT_VERSION, mode, turn: 1, active: 'blue',
    phase: 'action', discardReturn: 'action', players: { blue: emptyPlayer(), red: emptyPlayer() }, cards: {}, units: {},
    rng: seed >>> 0, sequence: 0, revision: 0, logs: [], pendingStart: false };
  for (const side of sides) {
    decks[side].forEach((definition, i) => {
      const id = `${side}-${i}`; s.cards[id] = { id, owner: side, definition, cost: catalog[definition].cost, zone: 'deck' };
      s.players[side].deck.push(id);
    });
    shuffle(s, s.players[side].deck); draw(s, side, side === 'blue' ? 3 : 4);
  }
  beginTurn(s);
  if (mode === 'demo') setDemo(s);
  return s;
}
// 演练模式：预置双方棋子、24 指挥点与指定手牌，便于快速体验战斗
function setDemo(s: GameState) {
  s.turn = 5; s.players.blue.ownTurn = 3; s.players.red.ownTurn = 2;
  s.players.blue.cp = 24; s.players.red.cp = 24;
  const setups: [Side, string, Position][] = [
    ['blue', 'g1', { r: 6, c: 4 }], ['blue', 'v1', { r: 7, c: 5 }], ['blue', 'n1', { r: 6, c: 6 }], ['blue', 'm1', { r: 7, c: 4 }],
    ['red', 'd1', { r: 4, c: 4 }], ['red', 'v2', { r: 3, c: 5 }], ['red', 'c1', { r: 4, c: 6 }],
  ];
  for (const [side, def, position] of setups) {
    const id = Object.values(s.cards).find(c => c.owner === side && c.definition === def)!.id;
    s.players[side].deck = s.players[side].deck.filter(x => x !== id);
    s.players[side].hand = s.players[side].hand.filter(x => x !== id);
    s.cards[id].zone = 'board'; s.units[id] = newUnit(s, id, position, side === 'blue' ? 0 : 2);
    s.units[id].deployed = 1; s.units[id].charge = catalog[def].skill!.turns;
  }
  const blueGuard = Object.values(s.units).find(u => u.owner === 'blue' && s.cards[u.id].definition === 'g1');
  if (blueGuard) blueGuard.hp = 17;
  const wanted = ['v3', 'd3', 'mist', 'cold', 'burn'];
  for (const side of sides) {
    for (const id of s.players[side].hand) { s.cards[id].zone = 'deck'; s.players[side].deck.push(id); }
    s.players[side].hand = [];
    for (const def of wanted) {
      const id = s.players[side].deck.find(x => s.cards[x].definition === def);
      if (id) { s.players[side].deck = s.players[side].deck.filter(x => x !== id); s.players[side].hand.push(id); s.cards[id].zone = 'hand'; }
    }
  }
  log(s, '战术演练：预设场上单位与 24 点指挥点，仅用于快速体验；正常对局按 PRD 空场开局');
}
function validateDirection(direction: Direction) { if (![0, 1, 2, 3].includes(direction)) fail('朝向不合法'); }
// 移动合法性：先查通用限制，再按职业查路径（特种落点须在范围内、先锋十字 1~2 格、其余相邻一格）
function validateMove(s: GameState, u: Unit, p: Position) {
  readyToAct(s, u);
  if (u.moved) fail('本回合已经移动');
  if (definition(s, u.id).block === 0) fail('0 阻挡干员不能主动移动');
  if (blocked(s, u)) fail('被敌方阻挡，不能主动移动');
  if (!inside(p)) fail('移动超出地图');
  if (samePosition(u, p)) return;
  const d = definition(s, u.id), dr = p.r - u.r, dc = p.c - u.c;
  if (d.profession === '特种') { if (!inRange(s, u, p)) fail('落点不在当前攻击范围内'); }
  else if (d.profession === '先锋') {
    if (!((dr === 0 || dc === 0) && Math.abs(dr + dc) <= 2)) fail('先锋只能十字方向移动一格或两格');
    if (Math.abs(dr + dc) === 2) {
      const midpoint = { r: u.r + dr / 2, c: u.c + dc / 2 };
      if (fightersAt(s, midpoint, other(u.owner)).length) fail('不能跨过中间格的阻挡干员');
    }
  } else if (Math.abs(dr) + Math.abs(dc) !== 1) fail('只能移动至相邻十字格');
  if (!canEnter(s, p, u.owner)) fail('目的格已达准入容量');
}
// 穷举全图格子，返回当前指挥点够得着的合法落点（供界面高亮）
export function legalMoves(s: GameState, id: string): Position[] {
  const u = s.units[id]; if (!u || u.owner !== s.active || s.phase !== 'action') return [];
  const list: Position[] = [];
  for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++) {
    try { validateMove(s, u, { r, c }); if (!samePosition(u, { r, c }) && s.players[u.owner].cp >= moveCost(s, u, { r, c })) list.push({ r, c }); } catch { /* Illegal positions are deliberately excluded. */ }
  }
  return list;
}
// 消耗一次攻击/治疗次数并扣费：非技能一回合一次；技能期间放开次数（弹药型耗弹药）
function consumeAttack(s: GameState, u: Unit, healing: boolean) {
  readyToAct(s, u);
  if (!u.skillActive && u.attacked) fail(healing ? '本回合已经治疗' : '本回合已经攻击');
  const d = definition(s, u.id);
  if (u.skillActive && d.skill!.type === 'ammo' && u.ammo <= 0) fail('弹药不足');
  pay(s, u.owner, actionCost(s, u, healing)); u.attacked = true;
  if (u.skillActive) { u.skillK++; if (d.skill!.type === 'ammo') u.ammo--; }
}
// 施加元素伤害：每次 1 点真实伤害；累计满 9 层触发损伤，之后两回合免疫不再累计
export function applyElement(s: GameState, id: string, element: Element, amount = 1) {
  for (let i = 0; i < amount; i++) {
    const u = s.units[id]; if (!u) return;
    u.hp--;
    log(s, `${definition(s, id).name}受到 ${elementName[element]}元素伤害 1`);
    if (u.hp <= 0) { defeatCheck(s); return; }
    if (u.immuneUntil >= s.turn) continue;
    u.elements[element]++; u.lastElement[element] = ++s.sequence;
    if (Object.values(u.elements).reduce((a, b) => a + b, 0) < 9) continue;
    const keys: Element[] = ['burn', 'nerve', 'decay'];
    const highest = Math.max(...keys.map(k => u.elements[k]));
    const chosen = keys.filter(k => u.elements[k] === highest).sort((a, b) => u.lastElement[b] - u.lastElement[a])[0];
    const wasReady = u.charge >= definition(s, id).skill!.turns + u.extraCharge;
    u.elements = { burn: 0, nerve: 0, decay: 0 }; u.lastElement = { burn: 0, nerve: 0, decay: 0 }; u.immuneUntil = s.turn + 2;
    if (chosen === 'burn') { u.hp -= u.burnUntil >= s.turn ? 3 : 4; u.burnUntil = s.turn + 2; }
    if (chosen === 'nerve') u.nerve = true;
    if (chosen === 'decay') { u.hp -= 8; u.extraCharge++; if (wasReady) u.lockUntilOwnTurn = s.players[u.owner].ownTurn + 1; }
    log(s, `${definition(s, id).name}触发${elementName[chosen]}损伤；两回合内不累计元素`);
    defeatCheck(s);
  }
}
// 使用指令卡：校验手牌与目标阵营 → 扣费 → 结算效果（此时卡不在弃牌堆）→ 完事后入弃牌堆且卡费 +15
function useCommand(s: GameState, a: Extract<Action, { type: 'command' }>) {
  const card = s.cards[a.card]; if (!card || card.owner !== s.active || card.zone !== 'hand') fail('指令不在己方手牌中');
  const d = definition(s, a.card); if (d.kind !== 'command') fail('这不是指令卡');
  const target = a.target ? s.units[a.target] : undefined;
  if (d.target !== 'global') {
    if (!target) fail('需要选择场上干员');
    if ((d.target === 'ally') !== (target!.owner === s.active)) fail('目标阵营不合法');
    if (d.target === 'enemy' && target!.smoke) fail('烟雾干员无法被敌方指向');
    if (d.effect === 'heal' && target!.hp >= definition(s, target!.id).hp!) fail('目标已是满生命');
  }
  pay(s, s.active, card.cost);
  s.players[s.active].hand = s.players[s.active].hand.filter(x => x !== card.id);
  log(s, `${sideName(s.active)}使用测试指令「${d.name}」，支付 ${card.cost}`);
  // A resolving command is not in the discard pile until its own effect completes.
  if (d.effect === 'heal') target!.hp = Math.min(definition(s, target!.id).hp!, target!.hp + d.amount!);
  if (d.effect === 'smoke') target!.smoke = true;
  if (d.effect === 'cold' && !frozen(s, target!)) {
    target!.cold += d.amount!;
    if (target!.cold >= 3) { target!.cold = 0; target!.frozenUntil = s.turn + 2; log(s, `${definition(s, target!.id).name}被冻结，仍提供阻挡`); }
  }
  if (d.effect === 'burn' || d.effect === 'nerve' || d.effect === 'decay') applyElement(s, target!.id, d.effect, d.amount!);
  if (d.effect === 'damage') { target!.hp -= d.amount!; defeatCheck(s); }
  if (d.effect === 'draw') draw(s, s.active, d.amount!);
  if (d.effect === 'cap') s.players[s.active].cap = Math.min(150, s.players[s.active].cap + d.amount!);
  discardInstance(s, card.id, 15);
  if (target && !s.units[target.id]) resolveClash(s, target);
  checkScores(s);
}
// 动作总入口：弃牌阶段只收弃牌；end 结算状态衰减与回合交替（第 40 回合终局判定）
function perform(s: GameState, a: Action) {
  if (s.phase === 'over') fail('对局已经结束');
  if (s.phase === 'discard') {
    if (a.type !== 'discard') fail('请先处理手牌超限');
    const p = s.players[s.active];
    if (new Set(a.cards).size !== a.cards.length || a.cards.length !== p.hand.length - 8 || a.cards.some(id => !p.hand.includes(id))) fail('请选择正确数量的手牌弃置');
    for (const id of a.cards) { p.hand = p.hand.filter(x => x !== id); discardInstance(s, id, 0); }
    log(s, `${sideName(s.active)}超限弃置 ${a.cards.length} 张，费用不变`);
    s.phase = 'action';
    if (s.pendingStart) { s.pendingStart = false; resolveAllClashes(s); }
    return;
  }
  if (a.type === 'discard') fail('当前无需超限弃牌');
  if (a.type === 'end') {
    // 结束回合：全场状态衰减（寒冷/冻结/灼燃/免疫），爆发型技能关闭
    for (const u of Object.values(s.units)) {
      u.cold = Math.max(0, u.cold - 1);
      if (u.frozenUntil === s.turn) u.frozenUntil = 0;
      if (u.burnUntil === s.turn) u.burnUntil = 0;
      if (u.immuneUntil === s.turn) u.immuneUntil = 0;
      if (u.owner === s.active && u.skillActive && definition(s, u.id).skill!.type === 'burst') closeSkill(u);
    }
    if (s.turn === 40) {
      const b = s.players.blue, r = s.players.red;
      const winner = b.score !== r.score ? b.score > r.score ? 'blue' : 'red' : b.cap !== r.cap ? b.cap > r.cap ? 'blue' : 'red' : 'draw';
      finish(s, winner, '双方各 20 回合：依次比较抵达分与指挥点上限'); return;
    }
    s.active = other(s.active); s.turn++; beginTurn(s); return;
  }
  if (a.type === 'command') { useCommand(s, a); return; }
  if (a.type === 'deploy') {
    // 部署：校验手牌、每回合 2 次上限、部署区与容量 → 扣费落位 → 结算该格交战
    validateDirection(a.direction);
    const card = s.cards[a.card];
    if (!card || card.owner !== s.active || card.zone !== 'hand' || definition(s, a.card).kind !== 'operator') fail('干员不在己方手牌中');
    if (s.players[s.active].deployed >= 2) fail('本回合已部署两次');
    if (!isDeployment(s.active, a.position)) fail('只能部署在己方部署区');
    if (!canEnter(s, a.position, s.active)) fail('目的格已达准入容量');
    pay(s, s.active, card.cost); s.players[s.active].deployed++;
    s.players[s.active].hand = s.players[s.active].hand.filter(x => x !== card.id);
    card.zone = 'board'; s.units[card.id] = newUnit(s, card.id, a.position, a.direction);
    log(s, `${sideName(s.active)}部署「${definition(s, card.id).name}」至 R${a.position.r}C${a.position.c}，支付 ${card.cost}`);
    resolveClash(s, a.position); return;
  }
  const u = requireUnit(s, a.unit), d = definition(s, u.id);
  if (a.type === 'retreat') { const p = { r: u.r, c: u.c }; removeUnit(s, u.id, 'retreat'); resolveClash(s, p); return; }
  if (a.type === 'skill') {
    // 开启技能：需充能完成，且同一己方回合只能开一次
    if (frozen(s, u)) fail('冻结期间不能开启技能');
    if (u.skillActive) fail('技能已经开启');
    if (u.skillOpened === s.players[u.owner].ownTurn) fail('同一己方回合只能开启一次技能');
    if (u.lockUntilOwnTurn > s.players[u.owner].ownTurn) fail('技能被封锁至下个己方回合');
    if (u.charge < d.skill!.turns + u.extraCharge) fail('技能尚未充能完成');
    u.skillActive = true; u.charge = 0; u.skillK = 0; u.ammo = d.skill!.ammo ?? 0; u.skillOpened = s.players[u.owner].ownTurn;
    log(s, `${d.name}开启「${d.skill!.name}」，攻击/治疗次数放开`); return;
  }
  if (a.type === 'closeSkill') { if (!u.skillActive) fail('技能未开启'); closeSkill(u); log(s, `${d.name}关闭技能，进入回转`); return; }
  if (a.type === 'move') {
    // 移动：先扣费再判定神经损伤——神经状态下费用照付但移动无效
    validateDirection(a.direction); validateMove(s, u, a.position);
    if (samePosition(u, a.position) && a.direction === u.direction) fail('请选择不同位置或朝向');
    const cost = moveCost(s, u, a.position); pay(s, u.owner, cost); u.moved = true; u.smoke = false;
    if (u.nerve) { u.nerve = false; log(s, `${d.name}的移动因神经损伤无效，仍支付 ${cost}`); return; }
    Object.assign(u, a.position); u.direction = a.direction; u.entered = ++s.sequence;
    log(s, `${d.name}移动至 R${u.r}C${u.c}，支付 ${cost}`); resolveClash(s, u); return;
  }
  const t = s.units[a.target]; if (!t) fail('目标不在场上');
  if (!inRange(s, u, t)) fail('目标不在当前朝向范围内');
  if (a.type === 'heal') {
    // 治疗：只对己方、目标未满生命，实际恢复量不超出最大生命
    if (d.profession !== '医疗' || t.owner !== u.owner) fail('医疗只能治疗己方干员');
    if (t.hp >= definition(s, t.id).hp!) fail('目标已是满生命');
    const amount = Math.min(definition(s, t.id).hp! - t.hp, d.power! + (u.skillActive ? d.skill!.bonus : 0));
    consumeAttack(s, u, true); t.hp += amount; log(s, `${d.name}治疗${definition(s, t.id).name} +${amount}`);
  } else {
    // 主动攻击：医疗不能攻击、不能打己方与烟雾目标；近战只能打队首；若对方也够得着你则受一次反击
    if (d.profession === '医疗') fail('医疗干员不能攻击');
    if (t.owner === u.owner) fail('不能攻击己方干员');
    if (t.smoke) fail('目标处于烟雾，不能被主动指定');
    const rear = unitsAt(s, t, t.owner)[0]?.id !== t.id;
    if (rear && d.mode === 'melee') fail('近战不能越过队首攻击后排');
    const cost = actionCost(s, u);
    consumeAttack(s, u, false); u.smoke = false;
    if (u.nerve) { u.nerve = false; log(s, `${d.name}的攻击因神经损伤无效，仍支付 ${cost}`); }
    else {
      const dealt = damageValue(s, u, t, rear);
      const retaliation = inRange(s, t, u) ? damageValue(s, t, u) : 0;
      t.hp -= dealt; u.hp -= retaliation;
      log(s, `${d.name}攻击${definition(s, t.id).name}，伤害 ${dealt}${retaliation ? `，受到一次反击 ${retaliation}` : '，无反击伤害'}，支付 ${cost}`);
      defeatCheck(s);
      if (s.units[t.id] && d.element) applyElement(s, t.id, d.element);
      resolveClashAfterCasualty(s, t, u);
    }
  }
  if (s.units[u.id] && u.skillActive && d.skill!.type === 'ammo' && u.ammo <= 0) closeSkill(u);
  checkScores(s);
}
function resolveClashAfterCasualty(s: GameState, ...previous: Unit[]) {
  // An ordinary attack must not create an extra clash if neither unit left.
  // 只在攻击造成减员的格子补一次交战结算，避免无谓的额外互殴
  const positions = new Map(previous.filter(u => !s.units[u.id]).map(u => [`${u.r}:${u.c}`, u]));
  for (const p of positions.values()) resolveClash(s, p);
}
// 对外唯一动作接口：克隆状态执行，成功返回新状态，失败返回错误消息（原状态永不污染）
export function applyAction(state: GameState, action: Action): Outcome {
  const s = structuredClone(state);
  try { perform(s, action); s.revision++; return { ok: true, state: s }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : '操作失败' }; }
}
// 玩家视图：剥离卡池随机源，只暴露该玩家可见的牌（己方手牌、双方弃牌/移除/场上），防作弊
export function getView(s: GameState, viewer: Side): PlayerView {
  const { cards: _cards, players: _players, rng: _rng, ...state } = structuredClone(s);
  const visibleCards: Record<string, CardInstance> = {};
  for (const c of Object.values(s.cards)) if (c.zone === 'board' || c.zone === 'discard' || c.zone === 'removed' || c.zone === 'hand' && c.owner === viewer) visibleCards[c.id] = { ...c };
  const players = Object.fromEntries(sides.map(side => {
    const { hand, deck, ...rest } = structuredClone(s.players[side]);
    return [side, { ...rest, deckCount: deck.length, handCount: hand.length, ...(side === viewer ? { hand: hand.map(id => visibleCards[id]) } : {}) }];
  })) as PlayerView['players'];
  return { state, players, visibleCards };
}
// 存档校验：版本、字段范围、卡牌守恒（双方共 60 张不重不漏）、构筑合法性逐项检查
export function assertState(s: GameState) {
  if (!s || s.schema !== 1 || s.rulesVersion !== RULES_VERSION || s.contentVersion !== CONTENT_VERSION ||
    !s.players || !s.cards || !s.units || !sides.includes(s.active) || !['local', 'demo'].includes(s.mode) ||
    !['action', 'discard', 'over'].includes(s.phase) || !Number.isInteger(s.turn) || s.turn < 1 || s.turn > 40 ||
    !Number.isInteger(s.rng) || s.rng < 0 || s.rng > 4294967295 || !Number.isInteger(s.revision) || s.revision < 0 ||
    !Number.isInteger(s.sequence) || s.sequence < 0 || typeof s.pendingStart !== 'boolean' || !Array.isArray(s.logs) ||
    s.logs.some(e => !e || typeof e.text !== 'string' || !Number.isInteger(e.id) || e.id < 0 || e.id > s.sequence ||
      !Number.isInteger(e.turn) || e.turn < 1 || e.turn > s.turn) ||
    (s.phase === 'over' ? !['blue', 'red', 'draw'].includes(s.winner!) || typeof s.result !== 'string' : s.winner !== undefined)) fail('存档格式或规则版本不兼容');
  const found = new Set<string>();
  for (const side of sides) {
    const p = s.players[side];
    if (!p || !Number.isInteger(p.cp) || !Number.isInteger(p.cap) || p.cp < 0 || p.cp > p.cap || p.cap < 100 || p.cap > 150 ||
      !Number.isInteger(p.score) || p.score < 0 || p.score > 3 || !Number.isInteger(p.deployed) || p.deployed < 0 || p.deployed > 2 ||
      !Number.isInteger(p.ownTurn) || p.ownTurn < 0 || p.ownTurn > 20) fail('存档玩家状态不合法');
    for (const zone of ['deck', 'hand', 'discard', 'removed'] as const) {
      if (!Array.isArray(p[zone])) fail('存档牌区不合法');
      for (const id of p[zone]) {
        const c = s.cards[id];
        if (!c || c.owner !== side || c.zone !== zone || found.has(id)) fail('存档卡牌区域冲突');
        found.add(id);
      }
    }
    if (p.score !== p.removed.length || (p.hand.length > 8 && !(s.phase === 'discard' && s.active === side))) fail('存档手牌或得分不合法');
  }
  for (const [id, u] of Object.entries(s.units)) {
    if (!u || id !== u.id || !sides.includes(u.owner) || !inside(u) || ![0, 1, 2, 3].includes(u.direction) || !Number.isInteger(u.hp) || u.hp <= 0 ||
      !s.cards[id] || s.cards[id].zone !== 'board' || s.cards[id].owner !== u.owner || found.has(id) ||
      catalog[s.cards[id].definition]?.kind !== 'operator' || u.hp > definition(s, id).hp! ||
      !Number.isInteger(u.cold) || u.cold < 0 || u.cold > 2 || !u.elements || !u.lastElement ||
      ['moved', 'attacked', 'smoke', 'nerve', 'skillActive'].some(key => typeof u[key as keyof Unit] !== 'boolean') ||
      !Number.isInteger(u.skillOpened) || u.skillOpened < -1 || !Number.isInteger(u.lockUntilOwnTurn) || u.lockUntilOwnTurn < 0 ||
      ['burn', 'nerve', 'decay'].some(key => !Number.isInteger(u.elements[key as Element]) || u.elements[key as Element] < 0 ||
        !Number.isInteger(u.lastElement[key as Element]) || u.lastElement[key as Element] < 0) ||
      Object.values(u.elements).reduce((a, b) => a + b, 0) > 8 ||
      ['charge', 'ammo', 'extraCharge', 'skillK', 'deployed', 'entered', 'frozenUntil', 'burnUntil', 'immuneUntil'].some(key => !Number.isInteger(u[key as keyof Unit]) || Number(u[key as keyof Unit]) < 0)) fail('存档干员状态不合法');
    if (unitsAt(s, u, u.owner).length > 3) fail('存档区块人数超过三人');
    found.add(id);
  }
  if (Object.keys(s.cards).length !== 60 || found.size !== 60) fail('存档卡牌不守恒');
  for (const [id, c] of Object.entries(s.cards)) if (!c || c.id !== id || !sides.includes(c.owner) || !catalog[c.definition] ||
    !Number.isInteger(c.cost) || c.cost < 0 || c.cost > s.players[c.owner]?.cap || !found.has(id)) fail('存档卡牌费用不合法');
  for (const side of sides) if (validateDeck(Object.values(s.cards).filter(c => c.owner === side).map(c => c.definition))) fail('存档构筑不合法');
}
// 从 JSON 文本恢复对局，校验不过直接抛错
export function loadGame(text: string): GameState {
  const s = JSON.parse(text) as GameState; assertState(s); return s;
}
