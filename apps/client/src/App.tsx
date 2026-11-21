import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { catalog, defaultDeck, definitions, validateDeck } from '../../../packages/content';
import { actionCost, applyAction, attackRange, blocked, canEnter, createGame, damageValue, definition,
  deploymentArea, elementName, ELEMENT_THRESHOLD, frozen, getView, inRange, isDeployment, legalMoves, loadGame, moveCost, other, sideName, unitsAt } from '../../../packages/rules/engine';
import type { Action, CardInstance, Direction, GameState, Position, Side, Unit } from '../../../packages/rules/types';
import { Board, displayPosition, screenToBoard } from './Board';
import type { BoardModel } from './Board';
import { readSave, saveGame } from './storage';
import { CardArt } from './OperatorArt';

type Intent = 'inspect' | 'deploy' | 'move' | 'attack' | 'heal' | 'command';
type Pending = { action: Action; title: string; description: string; direction?: boolean };
type Panel = 'rules' | 'settings' | 'save' | 'pile' | undefined;
const professions = ['先锋', '近卫', '重装', '特种', '狙击', '术士', '医疗', '辅助'];
const arrows = ['↑', '→', '↓', '←'];
const professionShort: Record<string, string> = { 先锋: 'V', 近卫: 'G', 重装: 'D', 特种: 'S', 狙击: 'N', 术士: 'C', 医疗: 'M', 辅助: 'A' };

// 悬浮磁贴定位：锚定在鼠标旁，做视口边缘翻转，避免溢出屏幕
function tooltipPosition(a: { x: number; y: number } | undefined): React.CSSProperties | undefined {
  if (!a) return undefined;
  const W = 300, H = 480;
  let x = a.x + 22, y = a.y - 40;
  if (x + W > window.innerWidth - 12) x = a.x - W - 22;
  if (x < 12) x = 12;
  if (y + H > window.innerHeight - 12) y = window.innerHeight - H - 12;
  if (y < 12) y = 12;
  return { left: x, top: y };
}

function HandCardFace({ data, cost }: { data: (typeof definitions)[number]; cost: number }) {
  return <>
    <div className="card-top"><span>{data.profession ?? `${data.grade} 指令`}</span><b className={cost > data.cost ? 'increased' : ''}>◇{cost}</b></div>
    <CardArt data={data} /><div className="card-bottom"><strong>{data.name}</strong><span>{data.kind === 'operator' ? `${data.mode === 'melee' ? '近战' : '远程'} · ${data.profession === '医疗' ? '医疗' : data.damage === 'arts' ? '法术' : data.damage === 'true' ? '真实' : '物理'}` : data.target === 'global' ? '全局指令' : data.target === 'ally' ? '己方目标' : '敌方目标'}</span></div>
    {data.kind === 'operator' && <div className="card-combat"><b title={data.profession === '医疗' ? '治疗量' : '攻击力'}>{data.power}</b><span>{professionShort[data.profession!]}</span><b title="生命">{data.hp}</b></div>}<i className="test-stamp">TEST</i>
  </>;
}

function Mark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'brand-mark small' : 'brand-mark'} viewBox="0 0 60 60" fill="none" aria-hidden="true">
    <path d="M30 4 55 30 30 56 5 30Z" stroke="currentColor" strokeWidth="3" />
    <path d="M30 15 43 30 30 45 17 30Z" fill="currentColor" opacity=".18" />
    <path d="M30 4v11M30 45v11M5 30h11M44 30h11" stroke="currentColor" strokeWidth="2" />
    <circle cx="30" cy="30" r="4.5" fill="currentColor" />
  </svg>;
}
function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
    <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><span className="eyebrow">RE:CONNECTION</span><h2>{title}</h2></div>
        {onClose && <button className="icon-button" aria-label="关闭窗口" onClick={onClose}>×</button>}</div>
      {children}
    </section>
  </div>;
}
function Resource({ player, enemy = false }: { player: { cp: number; cap: number }; enemy?: boolean }) {
  return <div className={`resource ${enemy ? 'enemy' : ''}`}><span className="eyebrow">{enemy ? '敌方' : '我方'}指挥点</span>
    <div className="resource-number"><span className="diamond">◇</span><strong>{player.cp.toString().padStart(2, '0')}</strong><span> / {player.cap}</span></div>
    <div className="resource-line"><i style={{ width: `${100 * player.cp / player.cap}%` }} /></div>
  </div>;
}

export function App() {
  const autoDemo = new URLSearchParams(window.location.search).has('demo');
  const [game, setGame] = useState<GameState | null>(() => autoDemo ? createGame('demo', 42) : null);
  const [page, setPage] = useState<'home' | 'battle' | 'deck'>(() => autoDemo ? 'battle' : 'home');
  const [viewer, setViewer] = useState<Side>('blue');
  const [handoff, setHandoff] = useState<Side>();
  const [selected, setSelected] = useState<string>();
  const [previewed, setPreviewed] = useState<string>();
  const [draggedCard, setDraggedCard] = useState<{ cardId: string; x: number; y: number; position?: Position }>();
  const [intent, setIntent] = useState<Intent>('inspect');
  const [focused, setFocused] = useState<Position>();
  const [hovered, setHovered] = useState<Position>();
  const [pending, setPending] = useState<Pending>();
  const [panel, setPanel] = useState<Panel>();
  const [pile, setPile] = useState<{ side: Side; zone: 'discard' | 'removed' }>();
  const [toast, setToast] = useState<string>();
  const [canResume, setCanResume] = useState(false);
  const [deck, setDeck] = useState<string[]>(defaultDeck);
  const [deckFilter, setDeckFilter] = useState('全部');
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);
  const [dropPick, setDropPick] = useState<{ cardId: string; position: Position; direction?: Direction }>();
  const [gridCoords, setGridCoords] = useState(true);
  const [hoveredUnit, setHoveredUnit] = useState<string>();
  const [tooltipAnchor, setTooltipAnchor] = useState<{ x: number; y: number }>();
  const hideTimer = useRef<number | undefined>(undefined);
  const mouseRef = useRef({ x: 0, y: 0 });
  const importInput = useRef<HTMLInputElement>(null);
  const mapRef = useRef<HTMLElement | null>(null);
  const handRef = useRef<HTMLDivElement | null>(null);
  const handLayout = useRef<Map<string, DOMRect> | undefined>(undefined);
  const pointerDrag = useRef<{ pointerId: number; cardId: string; startX: number; startY: number; dragging: boolean; element?: HTMLElement } | undefined>(undefined);
  const lastSaved = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const previous = handLayout.current;
    const root = handRef.current;
    handLayout.current = undefined;
    if (!previous || !root) return;
    for (const element of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const before = previous.get(element.dataset.cardId ?? '');
      if (!before) continue;
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left, dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        // 回位动画期间禁用指针事件，避免正在归位的卡牌遮挡并拦截紧随其后的落点方向选择。
        element.style.pointerEvents = 'none';
        const animation = element.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
          duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)',
        });
        animation.onfinish = () => { element.style.pointerEvents = ''; };
      }
    }
  }, [draggedCard?.cardId]);
  useEffect(() => { readSave().then(s => setCanResume(!!s)).catch(() => {}); }, []);
  useEffect(() => {
    if (!game || lastSaved.current === game.turn || game.phase === 'discard') return;
    lastSaved.current = game.turn;
    saveGame(game).then(() => setCanResume(true)).catch(e => setToast(e.message));
  }, [game]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(undefined), 4500); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPending(undefined); setPanel(undefined); setIntent('inspect'); setSelected(undefined); setDropPick(undefined); setDraggedCard(undefined); releaseDrag(); } };
    window.addEventListener('keydown', cancel); return () => window.removeEventListener('keydown', cancel);
  }, []);
  useEffect(() => {
    const move = (e: PointerEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, []);
  useEffect(() => () => { if (hideTimer.current !== undefined) { clearTimeout(hideTimer.current); hideTimer.current = undefined; } }, []);
  function cancelHideTooltip() { if (hideTimer.current !== undefined) { clearTimeout(hideTimer.current); hideTimer.current = undefined; } }
  function scheduleHideTooltip() { cancelHideTooltip(); hideTimer.current = window.setTimeout(() => setHoveredUnit(undefined), 150); }
  function handleHoverUnit(id?: string) {
    if (id) { cancelHideTooltip(); setTooltipAnchor({ x: mouseRef.current.x, y: mouseRef.current.y }); setPreviewed(undefined); setHoveredUnit(id); }
    else scheduleHideTooltip();
  }
  const view = useMemo(() => game ? getView(game, viewer) : undefined, [game, viewer]);
  const shown = selected ?? previewed;
  const selectedCard = shown ? view?.visibleCards[shown] : undefined;
  const data = selectedCard ? catalog[selectedCard.definition] : undefined;
  const unit = shown ? game?.units[shown] : undefined;
  const friendly = unit && unit.owner === viewer;
  const active = game?.active === viewer;
  const hoveredUnitObj = hoveredUnit ? game?.units[hoveredUnit] : undefined;
  const hoveredUnitData = hoveredUnitObj && game ? definition(game, hoveredUnitObj.id) : undefined;
  const hoveredFriendly = hoveredUnitObj?.owner === viewer;
  const tooltipCard = previewed && !handoff ? view?.visibleCards[previewed] : undefined;
  const tooltipCardData = tooltipCard ? catalog[tooltipCard.definition] : undefined;
  const onAction = (action: Action) => {
    if (!game) return;
    const result = applyAction(game, action);
    if (!result.ok) { setToast(result.error); return; }
    setGame(result.state); setPending(undefined); setDiscardSelection([]); setIntent('inspect');
    if (result.state.active !== game.active && result.state.phase !== 'over') {
      setHandoff(result.state.active); setSelected(undefined); setFocused(undefined); setPreviewed(undefined); setDropPick(undefined);
    }
    if (selected && result.state.cards[selected]?.zone !== 'board') { setSelected(undefined); setPreviewed(undefined); }
  };
  function start(mode: 'local' | 'demo') {
    const invalid = validateDeck(deck); if (invalid && mode === 'local') { setToast(invalid); return; }
    const next = createGame(mode, mode === 'demo' ? 42 : Date.now(), mode === 'demo' ? undefined : { blue: deck, red: deck });
    setGame(next); setViewer('blue'); setPage('battle'); setSelected(undefined); setPreviewed(undefined); setIntent('inspect'); setPanel(undefined); setHandoff(undefined);
    lastSaved.current = undefined;
  }
  async function resume() {
    try { const saved = await readSave(); if (!saved) return setToast('没有可继续的本地对局');
      setGame(saved); setPage('battle'); setViewer(saved.active); setHandoff(saved.phase === 'over' ? undefined : saved.active);
      setSelected(undefined); setPreviewed(undefined); setPanel(undefined); setPending(undefined); setIntent('inspect');
      lastSaved.current = undefined;
    } catch (e) { setToast(e instanceof Error ? e.message : '存档读取失败'); }
  }
  function requestCommand(card: CardInstance, target?: string) {
    const d = catalog[card.definition];
    setPending({ action: { type: 'command', card: card.id, target }, title: `使用「${d.name}」`,
      description: `支付 ${card.cost} 指挥点。${d.description} 使用完成后，这张卡的后续费用增加 15。` });
  }
  function chooseUnit(target: Unit) {
    if (!game) return;
    if (intent === 'command' && selectedCard && data?.kind === 'command') { requestCommand(selectedCard, target.id); return; }
    if ((intent === 'attack' || intent === 'heal') && unit) {
      const amount = intent === 'attack' ? damageValue(game, unit, target, unitsAt(game, target, target.owner)[0]?.id !== target.id) :
        Math.min(definition(game, target.id).hp! - target.hp, data!.power! + (unit.skillActive ? data!.skill!.bonus : 0));
      setPending({ action: { type: intent, unit: unit.id, target: target.id }, title: intent === 'attack' ? '确认攻击' : '确认治疗',
        description: `${data!.name} → ${definition(game, target.id).name}。预计${intent === 'attack' ? '普通伤害' : '恢复生命'} ${amount}，费用 ${actionCost(game, unit, intent === 'heal')}。` });
      return;
    }
    setSelected(target.id); setIntent('inspect'); setFocused({ r: target.r, c: target.c });
  }
  function cellClick(p: Position) {
    if (!game || handoff) return;
    if (dropPick) {
      // 拖拽流程：点击 5 格中的箭头格即按该方向部署
      const dr = p.r - dropPick.position.r, dc = p.c - dropPick.position.c;
      const dir: number = dr === -1 && dc === 0 ? 0 : dr === 0 && dc === 1 ? 1 : dr === 1 && dc === 0 ? 2 : dr === 0 && dc === -1 ? 3 : -1;
      setDropPick(undefined);
      if (dir >= 0) onAction({ type: 'deploy', card: dropPick.cardId, position: dropPick.position, direction: dir as Direction });
      else setToast('点击箭头格选择部署朝向，或右键取消');
      return;
    }
    if (intent === 'move' && unit) {
      setPending({ action: { type: 'move', unit: unit.id, position: p, direction: unit.direction }, title: '确认移动与朝向',
        description: `移动费用 ${moveCost(game, unit, p)}。若有效抵达敌方目标点，得分后该干员本局永久移除，不返还费用。`, direction: true }); return;
    }
    const options = unitsAt(game, p).filter(u =>
      intent === 'attack' ? u.owner !== viewer && !u.smoke : intent === 'heal' ? u.owner === viewer :
        intent === 'command' ? data?.target === 'ally' ? u.owner === viewer : u.owner !== viewer && !u.smoke : true);
    setFocused(p);
    if (options.length === 1) chooseUnit(options[0]);
    else if (options.length > 1) setToast('此格有多名干员，请在队列面板中选择');
    else if (intent !== 'inspect') setToast('此区块没有对应的目标');
    else setSelected(undefined);
  }
  function dropCardAt(id: string, x: number, y: number) {
    if (!game || !active || game.phase !== 'action') return;
    const card = view?.visibleCards[id];
    if (!card || card.owner !== viewer || card.zone !== 'hand') return;
    const canvas = mapRef.current?.querySelector('canvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const d = catalog[card.definition];
    setDropPick(undefined);
    if (d.kind === 'operator') {
      const p = screenToBoard(x, y, rect, viewer);
      if (!p) return;
      // 拖拽部署：跳过确认弹窗，直接进入 5 格方向选择
      if (game.players[viewer].deployed >= 2) { setToast('本回合已部署两次'); return; }
      if (card.cost > game.players[viewer].cp) { setToast('指挥点不足，无法部署'); return; }
      if (!isDeployment(viewer, p) || !canEnter(game, p, viewer)) { setToast('只能部署在己方部署区的空余格子'); return; }
      setSelected(id); setIntent('deploy'); setDropPick({ cardId: id, position: p });
    } else if (d.target === 'global') {
      // 全局指令（draw/cap）无需精确落点，落在画布内即可触发
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
      requestCommand(card);
    } else {
      const p = screenToBoard(x, y, rect, viewer);
      if (!p) return;
      const targets = unitsAt(game, p).filter(u => d.target === 'ally' ? u.owner === viewer : u.owner !== viewer && !u.smoke);
      if (targets.length === 0) { setToast('请将指令拖向合法的场上干员'); return; }
      setSelected(id); setIntent('command'); setFocused(p);
      if (targets.length === 1) requestCommand(card, targets[0].id);
      else setToast('此格有多名目标，请在队列面板中选择');
    }
  }
  function captureHandLayout() {
    const root = handRef.current;
    if (!root) return;
    handLayout.current = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-card-id]'),
      element => [element.dataset.cardId ?? '', element.getBoundingClientRect()]));
  }
  function mapPositionAt(x: number, y: number): Position | undefined {
    const canvas = mapRef.current?.querySelector('canvas');
    if (!canvas) return;
    return screenToBoard(x, y, canvas.getBoundingClientRect(), viewer);
  }
  function startCardDrag(card: CardInstance, e: React.PointerEvent<HTMLButtonElement>) {
    if (!active || !game || game.phase !== 'action' || e.button !== 0) return;
    pointerDrag.current = { pointerId: e.pointerId, cardId: card.id, startX: e.clientX, startY: e.clientY, dragging: false, element: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function releaseDrag() {
    const drag = pointerDrag.current;
    if (drag?.element && drag.element.hasPointerCapture(drag.pointerId)) {
      try { drag.element.releasePointerCapture(drag.pointerId); } catch { /* noop */ }
    }
    pointerDrag.current = undefined;
  }
  function moveCardDrag(card: CardInstance, e: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!drag.dragging && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 7) return;
    if (!drag.dragging) {
      drag.dragging = true;
      captureHandLayout();
    }
    const position = mapPositionAt(e.clientX, e.clientY);
    setDraggedCard({ cardId: card.id, x: e.clientX, y: e.clientY, position: position && canDropCard(card, position) ? position : undefined });
  }
  function endCardDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    pointerDrag.current = undefined;
    // 显式释放指针捕获：pointerup 处理期间 releasePointerCapture 在部分浏览器环境下会被忽略，
    // 这里同步 + 宏任务兜底各释放一次，避免下一次指针交互（落点方向选择）仍被手牌按钮捕获。
    const el = drag.element, pid = drag.pointerId;
    if (el?.hasPointerCapture(pid)) { try { el.releasePointerCapture(pid); } catch { /* noop */ } }
    setTimeout(() => { if (el?.hasPointerCapture(pid)) { try { el.releasePointerCapture(pid); } catch { /* noop */ } } }, 0);
    if (!drag.dragging) return;
    e.preventDefault();
    captureHandLayout();
    setDraggedCard(undefined);
    dropCardAt(drag.cardId, e.clientX, e.clientY);
  }
  function cancelCardDrag(e: React.PointerEvent<HTMLButtonElement>) {
    if (pointerDrag.current?.pointerId !== e.pointerId) return;
    releaseDrag();
    setDraggedCard(undefined);
  }
  function canDropCard(card: CardInstance, position: Position) {
    if (!game || !view) return false;
    const definition = catalog[card.definition];
    if (definition.kind === 'operator') {
      return game.players[viewer].deployed < 2 && card.cost <= game.players[viewer].cp &&
        isDeployment(viewer, position) &&
        canEnter(game, position, viewer);
    }
    return definition.target === 'global' || unitsAt(game, position).some(target =>
      definition.target === 'ally' ? target.owner === viewer : target.owner !== viewer && !target.smoke);
  }
  const highlighted = useMemo(() => {
    if (!game || !active || game.phase !== 'action') return [];
    if (intent === 'deploy' && selectedCard) return game.players[viewer].deployed < 2 && game.players[viewer].cp >= selectedCard.cost
      ? deploymentArea(viewer).filter(p => canEnter(game, p, viewer)) : [];
    if (intent === 'move' && unit) return legalMoves(game, unit.id);
    if ((intent === 'attack' || intent === 'heal') && unit) return attackRange(game, unit).filter(p => unitsAt(game, p).some(t =>
      intent === 'heal' ? t.owner === viewer && t.hp < definition(game, t.id).hp! : t.owner !== viewer && !t.smoke));
    if (intent === 'command' && data?.target !== 'global') return Object.values(game.units).filter(u =>
      data?.target === 'ally' ? u.owner === viewer : u.owner !== viewer && !u.smoke).map(u => ({ r: u.r, c: u.c }));
    return [];
  }, [game, active, intent, selectedCard, unit, viewer, data]);
  const boardModel = useMemo<BoardModel | undefined>(() => game ? ({ viewer, active: game.active, turn: game.turn,
    units: Object.values(game.units).map(u => ({ ...u, data: definition(game, u.id) })), selected,
    dropPick: dropPick?.position, dropDirection: dropPick?.direction,
    dropHover: draggedCard?.position,
    highlights: highlighted, focused: hovered ?? focused,  kind: intent === 'command' ? `command-${data?.target}` : intent,
    costs: intent === 'move' && unit ? Object.fromEntries(highlighted.map(p => [`${p.r}:${p.c}`, moveCost(game, unit, p)])) : {} }) : undefined,
    [game, viewer, selected, highlighted, hovered, focused, intent, unit, data, dropPick, draggedCard]);
  const pendingResult = useMemo(() => game && pending ? applyAction(game, pending.action) : undefined, [game, pending]);
  function exportGame() {
    if (!game) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(game, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `再连接-回合${game.turn}-私有对局.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setToast('已导出私有对局，包含双方手牌，仅供本机保存或复现');
  }
  function changeDeck(id: string, amount: number) {
    if (amount < 0) { const copy = [...deck]; const index = copy.indexOf(id); if (index >= 0) copy.splice(index, 1); setDeck(copy); return; }
    const d = catalog[id], count = deck.filter(x => x === id).length;
    const max = d.kind === 'operator' ? 1 : { A: 1, B: 2, C: 3, D: 4 }[d.grade!];
    if (count >= max) return setToast('已达同名携带上限');
    if (deck.length >= 30) return setToast('牌组已满，请先移除一张');
    setDeck([...deck, id]);
  }
  const rulesContent = <div className="rules-copy">
    <h3>让三名干员抵达敌方目标点</h3><p>有效抵达的干员永久移出本局，不进入弃牌堆，也不返还费用。目标点仍有能阻挡的敌人时，先交战，不能直接得分。</p>
    <div className="rule-grid"><div><b>30 张</b><span>每方牌组</span></div><div><b>8 张</b><span>手牌上限</span></div><div><b>+8</b><span>己方回合收入</span></div><div><b>2 次</b><span>每回合部署</span></div></div>
    <h3>指挥点与循环</h3><p>初始 5/100。首次回合同样 +8。被击败后卡费 +15，撤退后卡费 +5，使用指令后其费用 +15：这些增加卡牌下次使用的费用，不回复余额。超限弃牌不涨价。</p>
    <h3>移动与战斗</h3><p>每名干员每己方回合移动一次。刚部署不能主动行动。先锋相邻移动免费，十字两格 3 点；近卫与特种 3，重装 1，其余 2。主动近战 1、远程 2，反击免费且绝不连锁。</p>
    <h3>同格与技能</h3><p>每格每方最多三人；敌方能阻挡队首决定准入容量。双方同格时自动交战，存活即对峙，下回合继续。技能在双方每回合开始充能。普通技能攻击费用倍增；弹药技能每次 +1 并耗弹。</p>
    <h3>状态与元素</h3><p>寒冷一层 +1、二层 +3，三层冻结；每个全局回合结束寒冷 −1。冻结仍阻挡。元素基础每次 1 点，合计九次按最多类型爆发；之后两回合不累计。烟雾阻止敌方指向，主动移动或攻击后解除。</p>
    <h3>原型边界</h3><p>当前卡牌与原创矢量插画为测试内容。无正式卡池、AI、联机及反制卡；支持本机轮流对局和预设演练。灼燃保留“再次爆发变 3 点”，免疫期间基础元素仍为 1。双方各二十回合后依次比得分、指挥点上限。</p>
  </div>;

  return   <div className={`app ${viewer} page-${page}`} onContextMenu={e => { e.preventDefault(); setPending(undefined); setIntent('inspect'); setSelected(undefined); setDropPick(undefined); setDraggedCard(undefined); releaseDrag(); }}>
    <header className="topbar"><button className="brand" onClick={() => { setPage('home'); setPanel(undefined); }}><Mark small /><span>RE:CONNECTION<small>明日方舟 — 再连接</small></span></button>
      <span className="build-badge"><i /> 战术牌桌 <b>0.2</b></span>
      <nav><button onClick={() => setPanel('rules')}>规则手册</button><button onClick={() => setPanel('settings')}>设置</button>
        {game && <button onClick={() => setPanel('save')}>对局存档</button>}</nav></header>

    {page === 'home' && <main className="home">
      <div className="hero-copy">
        <span className="eyebrow">ARKNIGHTS / RE:CONNECTION</span>
        <h1>再连接<span>战术牌桌</span></h1>
        <p className="hero-description">将每一次部署，变成突破防线的可能。<br />在七乘九的战场上，用卡牌构筑你的战术。</p>
        <div className="hero-actions">
          <button className="primary" onClick={() => start('local')}>
            <span className="btn-text">开始本机对局</span>
            <span className="btn-icon">↗</span>
          </button>
          <button className="secondary" onClick={() => start('demo')}>
            <span className="btn-text">进入战术演练</span>
            <span className="btn-icon">→</span>
          </button>
        </div>
        <div className="hero-links">
          <button className="link-button" onClick={() => setPage('deck')}>
            配置测试牌组 · {deck.length}/30
            <span className="link-arrow">→</span>
          </button>
          {canResume && <button className="link-button" onClick={resume}>继续已保存对局 →</button>}
          {game && <button className="link-button" onClick={() => setPage('battle')}>返回当前对局 →</button>}
        </div>
        <div className="prototype-note">
          <span className="note-badge">OPERATIONS · 02</span>
          <p>本机双人 · 7×9 战场 · 30 张构筑<br />先进入战术演练，熟悉部署与突破防线。</p>
        </div>
      </div>
      <div className="hero-visual">
        <div className="war-dossier">
          <span className="dossier-header">RHODES ISLAND / OPERATIONS DIVISION</span>
          <h2>行动部署图</h2>
          <div className="hero-grid">{Array.from({ length: 63 }, (_, i) => <i key={i} className={[10, 17, 24, 31, 38, 45, 52].includes(i) ? 'route' : ''} />)}</div>
          <small className="grid-label">机密 · 作战规划 / 07 × 09</small>
        </div>
        <div className="cover-cards">
          {['v1', 'g1', 'd1'].map(id => (
            <div className="cover-card" key={id}>
              <span className="card-profession">{catalog[id].profession}<b className="card-cost">{catalog[id].cost}</b></span>
              <CardArt data={catalog[id]} large />
              <h3 className="card-name">{catalog[id].name}</h3>
              <div className="card-stats">
                <b className="card-power">{catalog[id].power}</b>
                <Mark small />
                <b className="card-hp">{catalog[id].hp}</b>
              </div>
            </div>
          ))}
        </div>
        <div className="hero-label bottom">
          <b className="label-number">3</b>
          <span className="label-text">突破防线<br />重新建立连接</span>
        </div>
      </div>
      <div className="home-bottom">
        <span className="step-indicator"><span className="step-number">01</span> / 先行部署</span>
        <span className="step-indicator"><span className="step-number">02</span> / 突破防线</span>
        <span className="step-indicator"><span className="step-number">03</span> / 抵达目标</span>
      </div>
    </main>}

    {page === 'deck' && <main className="deck-builder"><div className="page-heading"><div><span className="eyebrow">DECK PREPARATION</span><h1>测试牌组配置</h1><p>双方使用同一套所选测试牌组，各自独立洗牌。卡牌均为规则验证内容。</p></div>
      <div className="deck-summary"><strong>{deck.length}<small>/30</small></strong><span>{deck.filter(id => catalog[id].kind === 'operator').length} 干员 · {deck.filter(id => catalog[id].kind === 'command').length} 指令</span>
        <button className="primary" disabled={!!validateDeck(deck)} onClick={() => setPage('home')}>使用此牌组</button></div></div>
      <div className="filters">{['全部', ...professions, '指令'].map(f => <button className={deckFilter === f ? 'active' : ''} key={f} onClick={() => setDeckFilter(f)}>{f}</button>)}
        <button className="reset" onClick={() => setDeck(defaultDeck)}>恢复推荐构筑</button></div>
      {validateDeck(deck) && <p className="notice">{validateDeck(deck)}</p>}
      <div className="catalog-grid">{definitions.filter(d => deckFilter === '全部' || d.profession === deckFilter || deckFilter === '指令' && d.kind === 'command').map(d =>
        <article className="catalog-card" key={d.id}><div className="catalog-title"><span>{d.profession ?? `${d.grade} 级指令`}</span><b>◇ {d.cost}</b></div><CardArt data={d} large />
          <h3>{d.name}<small>测试</small></h3><p>{d.description}</p><div className="deck-adjust"><button onClick={() => changeDeck(d.id, -1)} aria-label={`移除${d.name}`}>−</button>
            <span>{deck.filter(id => id === d.id).length}</span><button onClick={() => changeDeck(d.id, 1)} aria-label={`加入${d.name}`}>+</button></div></article>)}</div>
    </main>}

    {page === 'battle' && game && view && boardModel && <main className="battle" inert={!!handoff}>
      <aside className="side-panel">
        <div className="battle-heading"><div><span className="eyebrow">TACTICAL OPERATION / {game.mode === 'demo' ? '预设演练' : '本机双人'}</span>
          <h1>再连接作战 <span>测试地图 01</span></h1></div><div className="round-info"><span>全局回合</span><b>{String(game.turn).padStart(2, '0')}<small>/40</small></b><i /> <span>{sideName(viewer)}视角</span></div></div>
        <section className="opponent-rail" aria-label="敌方牌区">
          <Resource player={view.players[other(viewer)]} enemy />
          <div className="enemy-hand"><span className="eyebrow">敌方手牌 / {view.players[other(viewer)].handCount}</span><div>{Array.from({ length: view.players[other(viewer)].handCount }, (_, i) => <div className="card-back" key={i}><Mark small /></div>)}</div></div>
          <div className="side-piles">
            <button className="pile deck" title="敌方抽牌堆内容隐藏" onClick={() => setToast('敌方抽牌堆仅公开剩余张数')}><Mark small /><b>{view.players[other(viewer)].deckCount}</b><span>抽牌堆</span></button>
            <button className="pile discard" onClick={() => { setPile({ side: other(viewer), zone: 'discard' }); setPanel('pile'); }}><span className="pile-glyph">▤</span><b>{view.players[other(viewer)].discard.length}</b><span>弃牌堆</span></button>
          </div>
        </section>
        <div className="section-label">回合信标 <span>TURN</span></div>
        <div className="turn-lamps"><div className={!active ? 'lit enemy' : 'enemy'}><i className="triangle up" /><span>敌方回合</span></div><div className={active ? 'lit' : ''}><i className="triangle down" /><span>我方回合</span></div></div>
        <div className="score-panel"><span className="section-label">抵达进度 <span>GOAL</span></span>
          {[viewer, other(viewer)].map(side => <div className={`score-row ${side !== viewer ? 'enemy' : ''}`} key={side}><span>{side === viewer ? '我方' : '敌方'}</span><div>{[0, 1, 2].map(i => <i key={i} className={i < game.players[side].score ? 'scored' : ''} />)}</div><b>{game.players[side].score}/3</b></div>)}
          <button onClick={() => { setPile({ side: viewer, zone: 'removed' }); setPanel('pile'); }}>查看永久移除 →</button></div>
        <div className="mission-info"><span className="eyebrow">作战目标</span><p>让三名干员抵达<br /><b>敌方目标点</b></p><small>抵达即永久移出本局</small></div>
        <div className="action-quota"><span>本回合部署</span><b>{game.players[game.active].deployed}<small>/2</small></b></div>
        <div className="board-key"><span><i className="friendly-dot" /> 我方部署区</span><span><i className="enemy-dot" /> 敌方部署区</span></div>
        <div className="own-resource"><Resource player={view.players[viewer]} /></div>
        <div className="side-piles">
          <button className="pile discard" onClick={() => { setPile({ side: viewer, zone: 'discard' }); setPanel('pile'); }}><span className="pile-glyph">▤</span><b>{view.players[viewer].discard.length}</b><span>弃牌堆</span></button>
          <button className="pile deck" onClick={() => setToast('己方抽牌堆顺序隐藏；自己的回合开始自动抽 2 张')}><Mark small /><b>{view.players[viewer].deckCount}</b><span>抽牌堆</span></button>
        </div>
        <div className="log-strip"><span>作战记录</span><p>{game.logs.at(-1)?.text}</p><button onClick={() => setPanel('save')}>日志与存档 ↗</button></div>
      </aside>
      <section className="map-section" ref={mapRef}>
        <div className="map-topline"><span>战场网格 · 7 × 9</span><span>{hovered && gridCoords ? `R${displayPosition(hovered, viewer).r}C${displayPosition(hovered, viewer).c}` : '选择卡牌或干员'}</span></div>
        <Board model={boardModel} onCell={cellClick} onHover={setHovered} onHoverUnit={handleHoverUnit}
          onRight={() => { setDropPick(undefined); setDraggedCard(undefined); }}
          onDirectionHover={direction => setDropPick(current => current && current.direction !== direction ? { ...current, direction } : current)}
          onDirection={direction => {
            if (!dropPick) return;
            const { cardId, position } = dropPick;
            setDropPick(undefined);
            onAction({ type: 'deploy', card: cardId, position, direction });
          }} />
        {dropPick && <div className="aiming-hud" aria-live="polite"><i>{arrows[((dropPick.direction ?? (game.active === 'blue' ? 0 : 2)) + (viewer === 'red' ? 2 : 0)) % 4]}</i><span>部署朝向</span><small>拖动定向 · 点击箭头</small></div>}
        <div className="map-bottomline"><span>{dropPick ? '拖出中心标记确定朝向 · 点击周围箭头也可确认' : intent === 'deploy' ? '选择部署区与朝向' : intent === 'move' ? '选择落点与朝向' : intent === 'attack' ? '选择敌方干员' : intent === 'heal' ? '选择受伤的己方干员' : intent === 'command' ? '选择指令目标' : '拖动卡牌部署 · 悬停查看 · 右键取消 · Esc 返回'}</span>
          {intent !== 'inspect' && <button onClick={() => { setIntent('inspect'); setSelected(undefined); setDropPick(undefined); }}>取消选择 ×</button>}</div>
        {focused && unitsAt(game, focused).length > 1 && <div className="cell-queue"><span className="eyebrow">当前区块队列</span>{unitsAt(game, focused).map((u, i) => <button key={u.id} onClick={() => chooseUnit(u)}><i className={u.owner === viewer ? 'friendly-dot' : 'enemy-dot'} /><span>{definition(game, u.id).name}</span><small>{u.hp} HP</small><b>#{i + 1}</b></button>)}</div>}
      </section>
      <section className={`friendly-rail ${draggedCard ? 'card-in-hand' : ''}`} aria-label="我方牌区">
        <div className="hand-area"><div className="hand-label"><span>我方手牌 <b>{view.players[viewer].handCount}/8</b></span><span>{active ? '拖动卡牌部署' : '等待回合交接'}</span></div>
          <div className={`hand-cards ${draggedCard ? 'card-dragging' : ''}`} ref={handRef}>{handoff ? Array.from({ length: view.players[viewer].handCount }, (_, i) => <div className="card-back" key={i}><Mark small /></div>) : view.players[viewer].hand?.map((card, index, cards) => {
            const d = catalog[card.definition];
            const inHand = draggedCard?.cardId === card.id;
            return <button className={`hand-card ${d.kind === 'command' ? 'command' : ''} ${inHand ? 'drag-card-proxy' : ''}`} key={card.id}
              style={{ '--fan': `${(index - (cards.length - 1) / 2) * 2.4}deg`, '--fan-lift': `${Math.abs(index - (cards.length - 1) / 2) * 2}px`,
                ...(inHand ? { left: draggedCard.x, top: draggedCard.y } : {}) } as React.CSSProperties}
              data-testid={`card-${card.definition}`} data-card-id={card.id} aria-label={`${d.name}，${card.cost}费`}
              onMouseEnter={e => { cancelHideTooltip(); setHoveredUnit(undefined); setTooltipAnchor({ x: e.clientX, y: e.clientY }); setPreviewed(card.id); }} onMouseLeave={() => setPreviewed(p => (p === card.id ? undefined : p))}
              onPointerDown={e => startCardDrag(card, e)} onPointerMove={e => moveCardDrag(card, e)}
              onPointerUp={endCardDrag} onPointerCancel={cancelCardDrag}>
              <HandCardFace data={d} cost={card.cost} />
              {inHand && <span className="drag-hint">已拿起 · 拖至战场</span>}
            </button>;
          })}</div></div>
        <button className="end-turn" disabled={!active || game.phase !== 'action'} onClick={() => onAction({ type: 'end' })}>结束回合 <span>→</span></button>
      </section>
    </main>}

    {game && tooltipCardData && tooltipCard && <div className="floating-tooltip card" style={tooltipPosition(tooltipAnchor)}>
      <div className="tooltip-title"><span>{tooltipCardData.profession ?? `${tooltipCardData.grade} 级指令`} <i>测试卡</i></span><h2>{tooltipCardData.name}</h2></div>
      <CardArt data={tooltipCardData} large />
      <div className="cost-detail"><span>当前费用</span><b>{tooltipCard.cost} ◇</b></div>
      <p className="tooltip-desc">{tooltipCardData.description}</p>
      {tooltipCardData.kind === 'operator' && <p className="hint">拖动到己方部署区即可部署；悬停查看信息。</p>}
    </div>}
    {game && hoveredUnitData && hoveredUnitObj && <div className="floating-tooltip unit" style={tooltipPosition(tooltipAnchor)} onMouseEnter={cancelHideTooltip} onMouseLeave={scheduleHideTooltip}>
      <div className="tooltip-title"><span>{hoveredUnitData.profession ?? `${hoveredUnitData.grade} 级指令`} <i>测试卡</i></span><h2>{hoveredUnitData.name}</h2><p>{hoveredUnitData.description}</p></div>
      <div className="tooltip-stats"><div><span>生命</span><b>{hoveredUnitObj.hp}<small>/{hoveredUnitData.hp}</small></b></div><div><span>{hoveredUnitData.profession === '医疗' ? '治疗' : hoveredUnitData.damage === 'arts' ? '法伤' : hoveredUnitData.damage === 'true' ? '真伤' : '物伤'}</span><b>{hoveredUnitData.power}</b></div>
        <div><span>物抗 / 法抗</span><b>{hoveredUnitData.armor}<small> / {hoveredUnitData.resist}</small></b></div><div><span>阻挡</span><b>{hoveredUnitData.block}</b></div></div>
      <div className="status-tags">{hoveredUnitObj.deployed === game.turn && <span>部署休整</span>}{hoveredUnitObj.moved && <span>本回合已移动</span>}{blocked(game, hoveredUnitObj) && <span>被阻挡</span>}
        {frozen(game, hoveredUnitObj) && <span>冻结</span>}{hoveredUnitObj.cold > 0 && <span>寒冷 {hoveredUnitObj.cold} 层</span>}{hoveredUnitObj.smoke && <span>烟雾</span>}{hoveredUnitObj.nerve && <span>神经待发</span>}{hoveredUnitObj.immuneUntil >= game.turn && <span>元素免疫</span>}</div>
      <div className="skill-box"><div><b>{hoveredUnitData.skill!.name}</b><span>{hoveredUnitObj.skillActive ? hoveredUnitData.skill!.type === 'ammo' ? `弹药 ${hoveredUnitObj.ammo}` : '技能生效中' : `${hoveredUnitObj.charge}/${hoveredUnitData.skill!.turns + hoveredUnitObj.extraCharge}`}</span></div>
        <div className="charge-line"><i style={{ width: `${hoveredUnitObj.skillActive ? 100 : 100 * hoveredUnitObj.charge / (hoveredUnitData.skill!.turns + hoveredUnitObj.extraCharge)}%` }} /></div></div>
      <div className="element-detail"><span>元素累计 {Object.values(hoveredUnitObj.elements).reduce((a, b) => a + b, 0)}/{ELEMENT_THRESHOLD}</span><div>{(['burn', 'nerve', 'decay'] as const).map(e => <small key={e}>{elementName[e]} {hoveredUnitObj.elements[e]}</small>)}</div></div>
      {hoveredFriendly && active && <div className="operator-actions">
        <button onClick={() => { setSelected(hoveredUnit); setIntent('move'); setHoveredUnit(undefined); }}>移动 <span>{hoveredUnitObj.moved ? '已使用' : '选择范围'}</span></button>
        <button onClick={() => { setSelected(hoveredUnit); setIntent(hoveredUnitData.profession === '医疗' ? 'heal' : 'attack'); setHoveredUnit(undefined); }}>{hoveredUnitData.profession === '医疗' ? '治疗' : '攻击'}<span>{actionCost(game, hoveredUnitObj, hoveredUnitData.profession === '医疗')} ◇</span></button>
        <button onClick={() => onAction({ type: hoveredUnitObj.skillActive ? 'closeSkill' : 'skill', unit: hoveredUnitObj.id })}>{hoveredUnitObj.skillActive ? '关闭技能' : '开启技能'}</button>
        <button className="retreat" onClick={() => setPending({ action: { type: 'retreat', unit: hoveredUnitObj.id }, title: '撤退干员', description: `「${hoveredUnitData.name}」洗入弃牌堆，后续部署费 +5，不回复指挥点；撤退不限次数。` })}>撤退</button>
      </div>}
    </div>}

    {pending && game && <Modal title={pending.title} onClose={() => setPending(undefined)}><p className="confirm-description">{pending.description}</p>
      {pending.direction && 'direction' in pending.action && <div className="direction-picker"><span>落地朝向</span>{arrows.map((arrow, index) => {
        const direction = ((index + (viewer === 'red' ? 2 : 0)) % 4) as Direction;
        return <button key={arrow} className={pending.action && 'direction' in pending.action && pending.action.direction === direction ? 'active' : ''}
          onClick={() => setPending({ ...pending, action: { ...pending.action, direction } as Action })}>{arrow}</button>;
      })}</div>}
      <div className="preview-events">{pendingResult && !pendingResult.ok ? <p className="error">{pendingResult.error}</p> : pendingResult?.ok && pendingResult.state.logs.filter(e => e.id > game.sequence).map(e => <p key={e.id}>{e.text}</p>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={() => setPending(undefined)}>取消</button><button className="primary" disabled={!pendingResult?.ok} onClick={() => onAction(pending.action)}>确认执行</button></div>
    </Modal>}

    {handoff && <div className="handoff-screen"><Mark /><span className="eyebrow">PASS THE COMMAND</span><h1>请交给{sideName(handoff)}指挥官</h1><p>双方手牌已遮蔽。下一位玩家确认后，<br />地图旋转至其视角，显示自己的手牌。</p>
      <button className="primary" onClick={() => { setViewer(handoff); setHandoff(undefined); setIntent('inspect'); setSelected(undefined); setPending(undefined); setPanel(undefined); setDropPick(undefined); }}>我是{sideName(handoff)}，开始回合 →</button></div>}

    {game?.phase === 'discard' && !handoff && page === 'battle' && <Modal title={`手牌超限 · 请选择 ${game.players[game.active].hand.length - 8} 张弃牌`}>
      <p className="confirm-description">被弃置的牌洗入弃牌堆，不增加费用。选择完成前不能继续行动。</p>
      <div className="discard-options">{game.players[game.active].hand.map(id => <button className={discardSelection.includes(id) ? 'active' : ''} key={id} onClick={() => setDiscardSelection(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id])}>
        <span>{catalog[game.cards[id].definition].name}</span><b>◇{game.cards[id].cost}</b></button>)}</div>
      <button className="primary full" disabled={discardSelection.length !== game.players[game.active].hand.length - 8} onClick={() => onAction({ type: 'discard', cards: discardSelection })}>确认弃置 {discardSelection.length} 张</button>
    </Modal>}

    {game?.phase === 'over' && page === 'battle' && <Modal title={game.winner === 'draw' ? '作战结束 · 平局' : `作战结束 · ${sideName(game.winner as Side)}胜利`}>
      <div className="result-scores"><b>{game.players.blue.score}<span>蓝方抵达</span></b><Mark /><b>{game.players.red.score}<span>红方抵达</span></b></div><p>{game.result}</p><p className="hint">全局 {game.turn} 回合 · 蓝方上限 {game.players.blue.cap} / 红方上限 {game.players.red.cap}</p>
      <div className="modal-actions"><button className="secondary" onClick={() => setPage('home')}>返回主菜单</button><button className="primary" onClick={() => start('local')}>开始新对局</button></div>
    </Modal>}

    {panel === 'rules' && <Modal title="作战规则速查" wide onClose={() => setPanel(undefined)}>{rulesContent}</Modal>}
    {panel === 'settings' && <Modal title="界面设置" onClose={() => setPanel(undefined)}><label className="setting-row"><span>显示悬停区块坐标</span><input type="checkbox" checked={gridCoords} onChange={e => setGridCoords(e.target.checked)} /></label>
      <p className="hint">此雏形采用静音模式。卡面为原创矢量插画，卡牌仍是用于验证规则的测试构筑。</p><button className="secondary full" onClick={() => { setPage('deck'); setPanel(undefined); }}>配置测试牌组</button></Modal>}
    {panel === 'save' && <Modal title="对局存档与作战记录" wide onClose={() => setPanel(undefined)}>
      <div className="save-actions"><button className="primary" disabled={!game} onClick={() => game && saveGame(game).then(() => { setToast('已保存当前对局'); setCanResume(true); }).catch(e => setToast(e.message))}>保存当前对局</button>
        <button className="secondary" onClick={resume} disabled={!canResume}>载入本地存档</button><button className="secondary" onClick={exportGame} disabled={!game}>导出对局 JSON</button><button className="secondary" onClick={() => importInput.current?.click()}>导入对局</button></div>
      <p className="hint">自动保存于回合起点；可随时手动保存。导出的私有对局包含双方手牌，仅用于本机存档或开发复现。</p>
      <div className="full-log">{game?.logs.slice().reverse().map(entry => <div key={entry.id}><span>T{entry.turn.toString().padStart(2, '0')}</span><p>{entry.text}</p></div>)}</div>
    </Modal>}
    {panel === 'pile' && pile && game && <Modal title={`${pile.side === viewer ? '我方' : '敌方'}${pile.zone === 'discard' ? '弃牌堆' : '永久移除区'}`} onClose={() => setPanel(undefined)}>
      <p className="hint">{pile.zone === 'discard' ? '卡费保留；只有抽牌堆为空且需要抽牌时才洗回。展示顺序不代表未来抽牌顺序。' : '已抵达干员本局无法再使用，不参与牌库循环。'}</p>
      <div className="pile-list">{game.players[pile.side][pile.zone].map(id => <div key={id}><span>{catalog[game.cards[id].definition].name}</span><b>当前费用 ◇{game.cards[id].cost}</b></div>)}</div>
      {!game.players[pile.side][pile.zone].length && <div className="empty-state">此区域暂无卡牌</div>}
    </Modal>}
    <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024) { setToast('文件过大，导入上限为 2 MB'); e.target.value = ''; return; }
      try { const next = loadGame(await file.text()); setGame(next); setPage('battle'); setHandoff(next.phase === 'over' ? undefined : next.active); setPanel(undefined); setSelected(undefined); setPending(undefined); setToast('对局导入成功'); }
      catch (error) { setToast(error instanceof Error ? error.message : '导入失败，原对局已保留'); }
      e.target.value = '';
    }} />
    {toast && <div className="toast" role="status"><span>◇</span>{toast}</div>}
  </div>;
}
