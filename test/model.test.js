'use strict';
/* 数据模型测试：直接加载 index.html 中的模型层（无 DOM 依赖） */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const { createModel, N } = mod.exports;

const idx = (x, y) => y * N + x;
// 取初始种子中的节点 id
function seed(M) {
  const leaves = M.leafLayers();
  return {
    group: M.state.layers[0],
    main: leaves[0].node.id,   // 主体
    shade: leaves[1].node.id,  // 阴影
    bg: leaves[2].node.id,     // 背景
  };
}

test('初始状态：嵌套图层组 + 单帧 + 活动图层', () => {
  const M = createModel();
  const s = seed(M);
  assert.strictEqual(M.state.frames.length, 1);
  assert.strictEqual(s.group.type, 'group');
  assert.strictEqual(s.group.children.length, 2);
  assert.strictEqual(M.leafLayers().length, 3);
  assert.strictEqual(M.state.activeLayer, s.main);
  assert.strictEqual(M.state.selected.length, 1);
});

test('每帧按图层保存像素：帧与帧、层与层互不影响', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(1, 1, '#ff0000');                 // f0 / 主体
  M.addFrame();                                // 切到 f1
  M.setPixel(2, 2, '#00ff00');                 // f1 / 主体
  M.state.activeLayer = s.bg;
  M.setPixel(3, 3, '#0000ff');                 // f1 / 背景
  assert.strictEqual(M.getCel(0, s.main)[idx(1, 1)], '#ff0000');
  assert.strictEqual(M.getCel(0, s.main)[idx(2, 2)], '');
  assert.strictEqual(M.getCel(1, s.main)[idx(2, 2)], '#00ff00');
  assert.strictEqual(M.getCel(1, s.bg)[idx(3, 3)], '#0000ff');
  assert.strictEqual(M.getCel(0, s.bg), null); // 未写入不创建
  assert.strictEqual(M.composite(0)[idx(1, 1)], '#ff0000');
  assert.strictEqual(M.composite(1)[idx(3, 3)], '#0000ff');
});

test('子层改名 / 显隐 / 锁定', () => {
  const M = createModel();
  const s = seed(M);
  assert.strictEqual(M.renameNode(s.main, '  身体  '), true);
  assert.strictEqual(M.findNode(s.main).node.name, '身体');
  assert.strictEqual(M.renameNode(s.main, '   '), false); // 空名拒绝
  M.setPixel(0, 0, '#ffffff');
  M.toggleVisible(s.main);
  assert.strictEqual(M.composite(0)[idx(0, 0)], '');      // 隐藏后不参与合成
  assert.strictEqual(M.layerEditable(s.main), false);     // 隐藏层不可编辑
  M.toggleVisible(s.main);
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ffffff');
  M.toggleLocked(s.main);
  assert.strictEqual(M.layerEditable(s.main), false);
  assert.strictEqual(M.setPixel(1, 1, '#ffffff'), false); // 锁定层拒绝写入
});

test('隐藏或锁定组会限制整组', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(0, 0, '#ff0000');                 // 主体
  M.state.activeLayer = s.shade;
  M.setPixel(1, 1, '#00ff00');                 // 阴影
  M.toggleVisible(s.group.id);                 // 隐藏整组
  const flat = M.flatten(false);
  const gMain = flat.find(e => e.node.id === s.main);
  const gShade = flat.find(e => e.node.id === s.shade);
  assert.strictEqual(gMain.effVisible, false);
  assert.strictEqual(gShade.effVisible, false);
  assert.strictEqual(M.composite(0)[idx(0, 0)], '');
  assert.strictEqual(M.composite(0)[idx(1, 1)], '');
  assert.strictEqual(M.setPixel(2, 2, '#fff'), false); // 组内层不可编辑
  M.toggleVisible(s.group.id);                 // 恢复
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ff0000');
  M.toggleLocked(s.group.id);                  // 锁定整组
  assert.strictEqual(M.layerEditable(s.main), false);
  assert.strictEqual(M.layerEditable(s.shade), false);
  assert.strictEqual(M.layerEditable(s.bg), true); // 组外不受影响
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ff0000'); // 锁定不影响可见性
});

test('调整层级：上下移动改变合成顺序，可移入/移出组', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(0, 0, '#ff0000');                 // 主体（上层）
  M.state.activeLayer = s.bg;
  M.setPixel(0, 0, '#0000ff');                 // 背景（下层）
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ff0000'); // 上层赢
  // 主体下移到底部 → 背景赢
  M.state.activeLayer = s.main;
  M.moveNodeVertical(s.main, 1);               // 组内下移
  M.moveNodeVertical(s.main, 1);               // 移出组到根
  M.moveNodeVertical(s.main, 1);               // 移到根底部
  let order = M.flatten(false).map(e => e.node.id);
  assert.strictEqual(order[order.length - 1], s.main);
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#0000ff');
  // 移入组：背景移到组顶部
  assert.strictEqual(M.moveNode(s.bg, s.group.id, 0), true);
  assert.strictEqual(M.findNode(s.bg).parent.id, s.group.id);
  // 移出组：背景移回根
  assert.strictEqual(M.moveNode(s.bg, null, 0), true);
  assert.strictEqual(M.findNode(s.bg).parent, null);
  // 组不能移入自己的后代
  const g2 = M.addGroup(s.group.id);
  assert.strictEqual(M.moveNode(s.group.id, g2, 0), false);
  assert.strictEqual(M.moveNode(s.group.id, s.group.id, 0), false);
});

test('帧操作：新建 / 复制（深拷贝）/ 删除保护 / 拖拽换序', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(0, 0, '#ff0000');
  M.duplicateFrame();
  assert.strictEqual(M.state.frames.length, 2);
  assert.strictEqual(M.getCel(1, s.main)[idx(0, 0)], '#ff0000');
  M.setPixel(1, 1, '#00ff00');                 // 改副本
  assert.strictEqual(M.getCel(0, s.main)[idx(1, 1)], ''); // 原帧不受影响
  M.addFrame();                                // 3 帧
  assert.strictEqual(M.state.frames.length, 3);
  // 换序：把第 0 帧拖到第 2 位
  const first = M.state.frames[0].id;
  M.reorderFrames(0, 2);
  assert.strictEqual(M.state.frames[2].id, first);
  assert.strictEqual(M.state.current, 2);
  // 删除保护：删到只剩一帧后拒绝
  M.deleteFrames([0, 1]);
  assert.strictEqual(M.state.frames.length, 1);
  assert.strictEqual(M.deleteFrames([0]), false);
  assert.strictEqual(M.state.frames.length, 1);
});

test('多选帧：点击 / Ctrl 切换 / Shift 范围', () => {
  const M = createModel();
  for (let i = 0; i < 4; i++) M.addFrame();    // 共 5 帧
  M.selectFrame(1);
  assert.deepStrictEqual(M.state.selected, [1]);
  M.selectFrame(3, { ctrl: true });
  assert.deepStrictEqual(M.state.selected, [1, 3]);
  M.selectFrame(3, { ctrl: true });            // 再点取消
  assert.deepStrictEqual(M.state.selected, [1]);
  M.selectFrame(4, { shift: true });           // 从当前(3)到 4
  assert.deepStrictEqual(M.state.selected, [3, 4]);
  M.selectFrame(0, { shift: true });           // 从当前(4)到 0
  assert.deepStrictEqual(M.state.selected, [0, 1, 2, 3, 4]);
});

test('批量处理：停留时长 / 清空当前层 / 翻转，只作用于选中帧', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(0, 0, '#ff0000');                 // f0
  M.addFrame(); M.setPixel(0, 15, '#00ff00');  // f1
  M.addFrame(); M.setPixel(15, 0, '#0000ff');  // f2
  M.selectFrame(0); M.selectFrame(2, { ctrl: true });
  M.setDuration(M.state.selected, 300);
  assert.strictEqual(M.state.frames[0].duration, 300);
  assert.strictEqual(M.state.frames[1].duration, 125); // 未选中不变
  assert.strictEqual(M.state.frames[2].duration, 300);
  M.flipCels([0], s.main, 'h');
  assert.strictEqual(M.getCel(0, s.main)[idx(15, 0)], '#ff0000'); // (0,0)->(15,0)
  M.flipCels([1], s.main, 'v');
  assert.strictEqual(M.getCel(1, s.main)[idx(0, 0)], '#00ff00');  // (0,15)->(0,0)
  M.clearCels([0, 2], s.main);
  assert.strictEqual(M.getCel(0, s.main)[idx(15, 0)], '');
  assert.strictEqual(M.getCel(2, s.main)[idx(15, 0)], '');
  assert.strictEqual(M.getCel(1, s.main)[idx(0, 0)], '#00ff00'); // 未选中保留
});

test('跨帧跨层复制粘贴，锁定层拒绝粘贴', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(5, 5, '#ff0000');                 // f0 / 主体
  M.copyCel();
  M.addFrame();                                // f1
  M.state.activeLayer = s.bg;                  // 换层
  assert.strictEqual(M.pasteCel(), true);
  assert.strictEqual(M.getCel(1, s.bg)[idx(5, 5)], '#ff0000');
  assert.strictEqual(M.getCel(1, s.main), null); // 未污染其他层
  M.toggleLocked(s.bg);
  assert.strictEqual(M.pasteCel(), false);     // 锁定拒绝
});

test('撤销 / 重做：绘制与结构变更都可回退', () => {
  const M = createModel();
  const s = seed(M);
  M.pushHistory();
  M.setPixel(0, 0, '#ff0000');
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ff0000');
  M.undo();
  assert.strictEqual(M.composite(0)[idx(0, 0)], '');
  M.redo();
  assert.strictEqual(M.composite(0)[idx(0, 0)], '#ff0000');
  // 结构：加组 + 删除图层可撤销
  M.pushHistory();
  const g = M.addGroup(null);
  assert.strictEqual(M.findNode(g).node.type, 'group');
  M.undo();
  assert.strictEqual(M.findNode(g), null);
  M.pushHistory();
  M.setPixel(2, 2, '#00ff00');
  M.pushHistory();
  M.removeNode(s.main);
  assert.strictEqual(M.findNode(s.main), null);
  assert.strictEqual(M.leafLayers().length, 2);
  M.undo();                                    // 恢复图层及其像素
  assert.strictEqual(M.findNode(s.main).node.name, '主体');
  assert.strictEqual(M.getCel(0, s.main)[idx(2, 2)], '#00ff00');
  assert.strictEqual(M.state.activeLayer, s.main);
  // 操作被拒绝时丢弃冗余快照
  const depth = (() => { let n = 0; const M2 = M; return null; })();
  M.pushHistory();
  const ok = M.deleteFrames([0]);              // 只剩一帧 → 拒绝
  assert.strictEqual(ok, false);
  M.historyPop();
  assert.strictEqual(M.canUndo(), true);       // 仍有更早的快照，且不包含这次空操作
});

test('序列化与本地恢复：往返一致，v1 旧格式自动迁移', () => {
  const M = createModel();
  const s = seed(M);
  M.setPixel(3, 4, '#ff0000');
  M.addFrame(); M.setPixel(7, 8, '#00ff00');
  M.setLoop(0, 1, true);
  M.setPlayMode('pingpong');
  const json = M.serialize();
  const M2 = createModel();
  const r = M2.loadState(json);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.migrated, false);
  assert.deepStrictEqual(M2.composite(0), M.composite(0));
  assert.deepStrictEqual(M2.composite(1), M.composite(1));
  assert.strictEqual(M2.state.loop.enabled, true);
  assert.strictEqual(M2.state.playMode, 'pingpong');
  assert.strictEqual(M2.state.activeLayer, M.state.activeLayer);
  // v1：frames 为单层像素数组
  const v1 = JSON.stringify({ frames: [Array(N * N).fill('').map((_, i) => i === 0 ? '#ffffff' : '')], fps: 10 });
  const M3 = createModel();
  const r3 = M3.loadState(v1);
  assert.strictEqual(r3.ok, true);
  assert.strictEqual(r3.migrated, true);
  assert.strictEqual(M3.leafLayers().length, 1);
  assert.strictEqual(M3.composite(0)[0], '#ffffff');
  assert.strictEqual(M3.state.frames[0].duration, 100); // 1000/10
  // 坏数据拒绝
  assert.strictEqual(createModel().loadState('{"foo":1}').ok, false);
  assert.strictEqual(createModel().loadState('not json').ok, false);
});

test('播放器：区间循环 / 单次 / 往复 / 逐帧停留', () => {
  const M = createModel();
  for (let i = 0; i < 3; i++) M.addFrame();    // 4 帧
  M.setDuration([0, 1, 2, 3], 100);
  M.state.frames[1].duration = 250;            // 逐帧停留
  // 区间循环 [1,2]
  M.setLoop(1, 2, true);
  M.setPlayMode('loop');
  let pl = M.createPlayer();
  let seq = [];
  for (let i = 0; i < 5; i++) seq.push(M.playStep(pl).index);
  assert.deepStrictEqual(seq, [1, 2, 1, 2, 1]);
  // 逐帧停留：第二帧 delay=250
  pl = M.createPlayer();
  M.playStep(pl);
  assert.strictEqual(M.playStep(pl).delay, 100); // 显示帧2? 先看序列
  // 单次：走到区间末尾即完成
  M.setPlayMode('once');
  pl = M.createPlayer();
  const seen = [];
  for (let i = 0; i < 10 && !pl.done; i++) seen.push(M.playStep(pl).index);
  assert.deepStrictEqual(seen, [1, 2]);
  // 往复：从第 0 帧出发 0,1,2,3,2,1,0,1（到端点反弹）
  M.setLoop(0, 3, true);
  M.setPlayMode('pingpong');
  M.state.current = 0;
  pl = M.createPlayer();
  seq = [];
  for (let i = 0; i < 8; i++) seq.push(M.playStep(pl).index);
  assert.deepStrictEqual(seq, [0, 1, 2, 3, 2, 1, 0, 1]);
  // 停留时长取自当前显示帧
  M.setPlayMode('loop');
  M.setLoop(0, 3, true);
  pl = M.createPlayer();
  const d0 = M.playStep(pl);                   // 显示 f0 (100ms)
  const d1 = M.playStep(pl);                   // 显示 f1 (250ms)
  assert.strictEqual(d0.delay, 100);
  assert.strictEqual(d1.delay, 250);
  // 删除帧后循环区间自动收敛
  M.deleteFrames([3]);
  assert.strictEqual(M.state.loop.end, 2);
});

test('填充工具：只填充连通区域，同色为无操作', () => {
  const M = createModel();
  M.setPixel(0, 0, '#ff0000');
  M.setPixel(1, 0, '#ff0000');                 // 顶部两个连通
  assert.strictEqual(M.fillWouldChange(0, 0, '#00ff00'), true);
  M.floodFill(0, 0, '#00ff00');
  assert.strictEqual(M.getCel(0, M.state.activeLayer)[idx(0, 0)], '#00ff00');
  assert.strictEqual(M.getCel(0, M.state.activeLayer)[idx(1, 0)], '#00ff00');
  assert.strictEqual(M.getCel(0, M.state.activeLayer)[idx(0, 1)], ''); // 不连通不填
  assert.strictEqual(M.fillWouldChange(0, 0, '#00ff00'), false);       // 同色无操作
  assert.strictEqual(M.floodFill(0, 0, '#00ff00'), false);
});
