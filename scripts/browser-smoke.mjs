import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.PROTOTYPE_URL || 'http://127.0.0.1:5173';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.text()} (${m.location().url})`); });
page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`); });
let exportIndex = 0;
async function check(name, work) { await work(); checks.push(name); console.log(`PASS ${name}`); }
// 屏幕坐标换算：7 列×9 行，棋盘逻辑宽 660 高 820，边距 50，格 80
function cellPoint(rect, r, c, viewer = 'blue') {
  if (viewer === 'red') { r = 10 - r; c = 8 - c; }
  return { x: rect.x + (50 + (c - .5) * 80) / 660 * rect.width, y: rect.y + (50 + (r - .5) * 80) / 820 * rect.height };
}
async function cell(r, c, viewer = 'blue') {
  const rect = await page.locator('canvas').boundingBox();
  assert.ok(rect);
  const p = cellPoint(rect, r, c, viewer);
  await page.mouse.click(p.x, p.y);
}
// 拖拽手牌卡到棋盘指定格（干员进入瞄准态，指令触发确认弹窗）
async function dragCard(testid, r, c) {
  const box = await page.getByTestId(testid).first().boundingBox();
  assert.ok(box, `找不到卡牌 ${testid}`);
  const rect = await page.locator('canvas').boundingBox();
  assert.ok(rect);
  const p = cellPoint(rect, r, c);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
  // 等待 FLIP 回位动画结束（期间卡牌 pointer-events:none），避免下一次拖拽落空
  await page.waitForTimeout(400);
}
// 从部署瞄准中心拖出方向并确认部署
async function dragDirection(r, c, dx, dy) {
  const rect = await page.locator('canvas').boundingBox();
  const p = cellPoint(rect, r, c);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 7 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.board-canvas.aiming'));
}
// 悬停棋盘上的单位，等待其悬浮磁贴出现
async function hoverUnitAt(r, c, viewer = 'blue') {
  const rect = await page.locator('canvas').boundingBox();
  const p = cellPoint(rect, r, c, viewer);
  await page.mouse.move(p.x, p.y);
  await page.locator('.floating-tooltip.unit').waitFor({ timeout: 3000 });
}
async function confirm() {
  const button = page.getByRole('button', { name: '确认执行', exact: true });
  assert.equal(await button.isEnabled(), true, await page.getByRole('dialog').innerText());
  await button.click();
}
async function state() {
  await page.getByRole('button', { name: '对局存档', exact: true }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出对局 JSON', exact: true }).click();
  const download = await waiting;
  const path = `artifacts/browser-save-${++exportIndex}.json`;
  await download.saveAs(path);
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  return JSON.parse(await readFile(path, 'utf8'));
}
async function importState(value) {
  await page.locator('input[type=file]').setInputFiles({ name: 'test-save.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
}
const card = (s, side, def) => Object.values(s.cards).find(c => c.owner === side && c.definition === def);
try {
  await page.goto(base);
  await check('主页与 28 种测试卡牌构筑', async () => {
    await page.getByRole('button', { name: /开始本机对局/ }).waitFor();
    await page.screenshot({ path: 'artifacts/home.png', fullPage: true });
    await page.getByRole('button', { name: /配置测试牌组/ }).click();
    assert.equal(await page.locator('.catalog-grid article').count(), 28);
    await page.getByRole('button', { name: '移除引路', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '使用此牌组', exact: true }).isEnabled(), false);
    await page.getByRole('button', { name: '恢复推荐构筑', exact: true }).click();
    await page.getByRole('button', { name: '使用此牌组', exact: true }).click();
  });
  await check('正式开局为空场、13 指挥点、5 张先手牌', async () => {
    await page.getByRole('button', { name: /开始本机对局/ }).click();
    await page.locator('canvas').waitFor();
    const s = await state();
    assert.equal(s.players.blue.cp, 13); assert.equal(s.players.blue.hand.length, 5);
    assert.equal(s.players.red.hand.length, 4); assert.equal(Object.keys(s.units).length, 0);
    await page.getByRole('button', { name: /RE:CONNECTION/ }).click();
  });
  await page.getByRole('button', { name: /进入战术演练/ }).click();
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(150);
  const initial = await state();
  const blue = def => card(initial, 'blue', def).id;
  const red = def => card(initial, 'red', def).id;
  await check('桌面布局：左栏+居中棋盘+底部手牌，棋盘为 7 列×9 行', async () => {
    await page.waitForTimeout(4500);
    assert.equal(await page.locator('.triangle.up').count(), 1); assert.equal(await page.locator('.triangle.down').count(), 1);
    assert.equal(await page.locator('.side-panel').count(), 1);
    assert.equal(await page.locator('.friendly-rail .end-turn').count(), 1);
    const rect = await page.locator('canvas').boundingBox();
    assert.ok(Math.abs(rect.width / rect.height - 660 / 820) < 0.03, `棋盘宽高比异常: ${rect.width}/${rect.height}`);
    for (const [width, height] of [[1440, 1000], [1280, 720], [1920, 1080]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(120);
      const rail = await page.locator('.friendly-rail').boundingBox();
      assert.ok(rail.y + rail.height <= height + 1, `手牌区超出 ${width}×${height}: ${rail.y + rail.height}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `artifacts/demo-${width}x${height}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(120);
    await page.screenshot({ path: 'artifacts/demo.png' });
  });
  await check('手机、平板、4:3 与 2:1 视口保持地图和手牌可用', async () => {
    for (const [width, height, minimumBoard] of [
      [390, 844, 280], [360, 800, 260], [844, 422, 150],
      [800, 600, 240], [1024, 768, 280], [1280, 640, 220],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      const layout = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const board = canvas?.getBoundingClientRect();
        const handLabel = document.querySelector('.hand-label');
        const cards = document.querySelectorAll('.hand-card');
        const ownResource = document.querySelector('.side-panel .own-resource');
        return {
          pageWidth: document.documentElement.scrollWidth,
          board: board ? { width: board.width, height: board.height, left: board.left, right: board.right } : null,
          handFont: handLabel ? Number.parseFloat(getComputedStyle(handLabel).fontSize) : 0,
          cards: cards.length,
          ownResourceVisible: ownResource ? getComputedStyle(ownResource).display !== 'none' : false,
        };
      });
      assert.ok(layout.board, `找不到 ${width}×${height} 视口的棋盘`);
      assert.ok(layout.board.width >= minimumBoard, `${width}×${height} 棋盘过小: ${layout.board.width}px`);
      assert.ok(layout.board.left >= 0 && layout.board.right <= width, `${width}×${height} 棋盘超出屏幕`);
      assert.ok(layout.pageWidth <= width, `${width}×${height} 页面出现横向溢出: ${layout.pageWidth}px`);
      assert.ok(layout.handFont >= 10, `${width}×${height} 手牌字号过小: ${layout.handFont}px`);
      assert.ok(layout.cards > 0, `${width}×${height} 没有可操作的手牌`);
      assert.ok(layout.ownResourceVisible, `${width}×${height} 看不到己方指挥点`);
      await page.screenshot({ path: `artifacts/responsive-${width}x${height}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await check('非法拖拽部署被拒绝，合法拖拽部署实际扣费', async () => {
    await dragCard('card-v3', 5, 5); // 非部署区，被拒
    await page.locator('.toast').filter({ hasText: '只能部署' }).waitFor();
    assert.equal(await page.locator('.board-canvas.aiming').count(), 0);
    // 回归：非法拖拽被拒后，点击部署格不应复活「点击落点部署」（纯拖拽模式无点击选中）
    await cell(8, 5);
    await page.waitForTimeout(150);
    assert.equal(await page.getByRole('dialog').count(), 0, '非法拖拽后点击部署格不应弹出部署确认');
    assert.equal(await page.locator('.board-canvas.aiming').count(), 0);
    await dragCard('card-v3', 8, 5); // 合法部署区 → 瞄准
    await page.locator('.board-canvas.aiming').waitFor();
    await dragDirection(8, 5, 0, -44); // 向上 = 朝向 0
    const s = await state(); assert.equal(s.players.blue.cp, 21); assert.equal(s.players.blue.deployed, 1);
    assert.equal(s.units[blue('v3')].r, 8); assert.equal(s.units[blue('v3')].deployed, 5);
  });
  await check('主动攻击及一次反击，技能追加攻击与击败涨价', async () => {
    await hoverUnitAt(6, 6); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^攻击/ }).click();
    await cell(4, 6); await confirm();
    let s = await state(); assert.equal(s.units[red('c1')].hp, 9); assert.equal(s.units[blue('n1')].hp, 10);
    assert.equal(s.players.blue.cp, 19);
    await hoverUnitAt(6, 6); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^开启技能/ }).click();
    await hoverUnitAt(6, 6); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^攻击/ }).click(); await cell(4, 6); await confirm();
    s = await state(); assert.equal(s.units[red('c1')], undefined); assert.equal(s.cards[red('c1')].cost, 21);
    assert.equal(s.cards[red('c1')].zone, 'discard'); assert.equal(s.units[blue('n1')].hp, 2);
    assert.equal(s.units[blue('n1')].ammo, 2); assert.equal(s.players.blue.cp, 17);
  });
  await check('医疗治疗与先锋直线两格推进', async () => {
    await hoverUnitAt(7, 4); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^治疗/ }).click(); await cell(6, 4); await confirm();
    await hoverUnitAt(7, 5); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^移动/ }).click(); await cell(5, 5); await confirm();
    const s = await state(); assert.equal(s.units[blue('g1')].hp, 24); assert.equal(s.units[blue('v1')].r, 5);
    assert.equal(s.players.blue.cp, 12);
  });
  await check('烟雾、寒冷、灼燃指令与对应实例费用增长', async () => {
    await dragCard('card-mist', 6, 4); await confirm();
    await dragCard('card-cold', 4, 4); await confirm();
    await dragCard('card-burn', 4, 4); await confirm();
    const s = await state(); assert.equal(s.units[blue('g1')].smoke, true);
    assert.equal(s.units[red('d1')].cold, 2); assert.equal(s.units[red('d1')].hp, 29); assert.equal(s.units[red('d1')].elements.burn, 3);
    assert.equal(s.players.blue.cp, 3);
    assert.equal(s.cards[blue('cold')].cost, 18); assert.equal(s.cards[blue('burn')].cost, 19);
    assert.ok(Object.values(s.cards).some(c => c.owner === 'blue' && c.definition === 'mist' && c.cost === 17 && c.zone === 'discard'));
  });
  await check('撤退进入弃牌堆、不返费、不恢复部署额度', async () => {
    await hoverUnitAt(8, 5); await page.locator('.floating-tooltip.unit .operator-actions').getByRole('button', { name: /^撤退/ }).click(); await confirm();
    const s = await state(); assert.equal(s.cards[blue('v3')].zone, 'discard'); assert.equal(s.cards[blue('v3')].cost, 8);
    assert.equal(s.players.blue.cp, 3); assert.equal(s.players.blue.deployed, 1);
    await page.screenshot({ path: 'artifacts/battle-played.png' });
  });
  await check('换人遮屏、红方旋转视角、敌方手牌仅显示背面', async () => {
    await page.getByRole('button', { name: /^结束回合/ }).click();
    await page.locator('.handoff-screen').waitFor();
    assert.equal(await page.locator('.friendly-rail .hand-card').count(), 0);
    await page.screenshot({ path: 'artifacts/handoff.png' });
    await page.getByRole('button', { name: /我是红方/ }).click();
    assert.match(await page.locator('.round-info').innerText(), /红方视角/);
    assert.equal(await page.locator('.enemy-hand .card-back').count(), 1);
    assert.equal(await page.locator('.enemy-hand .hand-card').count(), 0);
    await hoverUnitAt(4, 4, 'red'); assert.equal(await page.locator('.floating-tooltip.unit .tooltip-title h2').innerText(), '磐石');
    let s = await state(); assert.equal(s.turn, 6); assert.equal(s.players.red.cp, 32); assert.equal(s.units[red('d1')].cold, 1);
    await page.screenshot({ path: 'artifacts/red-view.png' });
    await page.getByRole('button', { name: /^结束回合/ }).click(); await page.getByRole('button', { name: /我是蓝方/ }).click();
    s = await state(); assert.equal(s.turn, 7); assert.equal(s.players.blue.cp, 11); assert.equal(s.units[red('d1')].cold, 0);
  });
  let saved;
  await check('手动存档、刷新继续、JSON 导入恢复完全相同的状态', async () => {
    saved = await state();
    await page.getByRole('button', { name: '对局存档', exact: true }).click();
    await page.getByRole('button', { name: '保存当前对局', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已保存当前对局' }).waitFor();
    await page.reload(); await page.getByRole('button', { name: /继续已保存对局/ }).click();
    await page.getByRole('button', { name: /我是蓝方/ }).click(); assert.deepEqual(await state(), saved);
    await page.getByRole('button', { name: /^结束回合/ }).click(); await page.getByRole('button', { name: /我是红方/ }).click();
    await importState(saved); await page.getByRole('button', { name: /我是蓝方/ }).click(); assert.deepEqual(await state(), saved);
  });
  await check('损坏存档拒绝导入，当前对局不变', async () => {
    await importState({ ...saved, schema: 99 });
    await page.getByRole('status').filter({ hasText: /不兼容/ }).waitFor(); assert.deepEqual(await state(), saved);
  });
  await check('超限弃牌界面要求精确数量，不增加费用', async () => {
    const overflow = structuredClone(saved), p = overflow.players.blue;
    while (p.hand.length < 10) { const id = p.deck.shift(); p.hand.push(id); overflow.cards[id].zone = 'hand'; }
    overflow.phase = 'discard'; overflow.pendingStart = false;
    await importState(overflow); await page.getByRole('button', { name: /我是蓝方/ }).click();
    const choice = page.getByRole('dialog', { name: /手牌超限/ });
    assert.equal(await choice.getByRole('button', { name: /确认弃置/ }).isEnabled(), false);
    await choice.locator('.discard-options button').nth(0).click(); await choice.locator('.discard-options button').nth(1).click();
    await choice.getByRole('button', { name: /确认弃置 2 张/ }).click();
    const s = await state(); assert.equal(s.players.blue.hand.length, 8); assert.equal(s.phase, 'action');
    for (const id of p.hand.slice(0, 2)) { assert.equal(s.cards[id].zone, 'discard'); assert.equal(s.cards[id].cost, overflow.cards[id].cost); }
  });
  await check('第 40 回合的终局面板与上限决胜', async () => {
    const last = structuredClone(saved); last.turn = 40; last.active = 'red';
    last.players.blue.ownTurn = last.players.red.ownTurn = 20; last.players.blue.cap = 120;
    await importState(last); await page.getByRole('button', { name: /我是红方/ }).click();
    await page.getByRole('button', { name: /^结束回合/ }).click();
    await page.getByRole('dialog', { name: /蓝方胜利/ }).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /20 回合/);
    await page.screenshot({ path: 'artifacts/game-over.png' });
  });
  await check('卡牌悬停磁贴、手持拖拽回位与拖拽部署选向', async () => {
    await page.goto(`${base}/?demo`);
    await page.locator('canvas').waitFor();
    const operatorCard = page.getByTestId('card-v3');
    const handCount = await page.locator('.friendly-rail .hand-card').count();
    await operatorCard.hover();
    assert.equal(await page.locator('.floating-tooltip.card .tooltip-title h2').innerText(), '引路');
    await page.mouse.move(700, 500); // 移开 → 磁贴消失
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.floating-tooltip.card').count(), 0);
    await page.keyboard.press('Escape');

    const handLabel = await page.locator('.hand-label').boundingBox();
    const cardBox = await operatorCard.boundingBox();
    assert.ok(handLabel && cardBox);
    const neighborBefore = await page.locator('.friendly-rail .hand-card').nth(1).boundingBox();
    assert.ok(neighborBefore);
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handLabel.x + handLabel.width / 2, handLabel.y + handLabel.height / 2, { steps: 8 });
    await page.locator('.hand-card.drag-card-proxy').waitFor();
    const dragOpacity = await page.locator('.hand-card.drag-card-proxy').evaluate(el => Number.parseFloat(getComputedStyle(el).opacity));
    assert.ok(dragOpacity <= .7, `拖动卡牌应保持半透明，实际 opacity=${dragOpacity}`);
    const neighborDuring = await page.locator('.friendly-rail .hand-card').nth(1).boundingBox();
    assert.ok(neighborDuring && Math.abs(neighborDuring.x - neighborBefore.x) > 1);
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.friendly-rail .hand-card').count(), handCount);
    assert.equal(await page.locator('.hand-card.drag-card-proxy').count(), 0);

    // 拖拽部署 v3（朝向 0）
    await dragCard('card-v3', 8, 5);
    await page.locator('.board-canvas.aiming').waitFor();
    await dragDirection(8, 5, 0, -44);
    assert.equal(await page.locator('.friendly-rail .hand-card').count(), handCount - 1);

    // 拖拽部署 d3（朝向 1，向右）
    await dragCard('card-d3', 9, 3);
    await page.locator('.board-canvas.aiming').waitFor();
    await dragDirection(9, 3, 44, 0);
    const uxState = await state();
    const dragDeployed = card(uxState, 'blue', 'v3');
    const clickDeployed = card(uxState, 'blue', 'd3');
    assert.equal(uxState.units[dragDeployed.id].direction, 0);
    assert.equal(uxState.units[clickDeployed.id].direction, 1);
  });
  await check('全局指令拖到画布边距区也可释放', async () => {
    // 构造含 draw 的 demo 存档：把蓝方手牌首张换回牌堆，把 draw 放进手牌
    const g = structuredClone(initial);
    const first = g.players.blue.hand.shift();
    g.players.blue.deck.push(first); g.cards[first].zone = 'deck';
    const drawId = Object.values(g.cards).find(c => c.owner === 'blue' && c.definition === 'draw').id;
    g.players.blue.deck = g.players.blue.deck.filter(id => id !== drawId);
    g.players.blue.hand.push(drawId); g.cards[drawId].zone = 'hand';
    await page.goto(`${base}/?demo`);
    await page.locator('canvas').waitFor();
    await importState(g); await page.getByRole('button', { name: /我是蓝方/ }).click();
    const drawBox = await page.getByTestId('card-draw').boundingBox();
    assert.ok(drawBox, '找不到 draw 指令卡');
    const rect = await page.locator('canvas').boundingBox();
    await page.mouse.move(drawBox.x + drawBox.width / 2, drawBox.y + drawBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + 30, rect.y + rect.height / 2, { steps: 8 }); // 画布左侧边距区（PAD 内，无格子）
    await page.mouse.up();
    await page.getByRole('dialog', { name: /使用「/ }).waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: '取消', exact: true }).click();
  });
  assert.deepEqual(errors, [], `浏览器错误：${errors.join('\n')}`);
  await writeFile('artifacts/browser-results.json', JSON.stringify({ date: new Date().toISOString(), base, checks, browserErrors: errors }, null, 2));
  console.log(`Browser acceptance: ${checks.length} groups passed; no page or console errors.`);
} catch (error) {
  await page.screenshot({ path: 'artifacts/browser-failure.png', fullPage: true });
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
