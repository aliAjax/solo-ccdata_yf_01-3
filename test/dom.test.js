'use strict';
/* 界面冒烟测试：在 jsdom 中真实启动页面，模拟主要交互流程 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

function stubCanvas(win) {
  const ctx2d = () => ({ fillStyle: '', clearRect() {}, fillRect() {} });
  win.HTMLCanvasElement.prototype.getContext = function () { return ctx2d(); };
  win.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
}
function boot(extra) {
  const dom = new JSDOM(html, Object.assign({ url: 'http://localhost/', runScripts: 'outside-only' }, extra));
  stubCanvas(dom.window);
  return dom;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('界面：启动渲染图层树与时间轴', () => {
  const dom = boot();
  dom.window.eval(src);
  const w = dom.window, d = w.document;
  assert.ok(w.PixelLoom, '模型句柄已暴露');
  assert.strictEqual(d.querySelectorAll('#layers .lrow').length, 4); // 组+主体+阴影+背景
  assert.strictEqual(d.querySelectorAll('#frames .frame').length, 1);
  assert.strictEqual(d.querySelector('#layers .lrow.active .lname').textContent, '主体');
  w.close();
});

test('界面：绘制 → 自动保存 → 重新打开后本地恢复', async () => {
  const dom = boot();
  dom.window.eval(src);
  const w = dom.window, d = w.document, M = w.PixelLoom;
  // 模拟画布点击绘制（320px 画布 / 16 格 → 每格 20px）
  const canvas = d.querySelector('#canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 });
  canvas.dispatchEvent(new w.MouseEvent('pointerdown', { clientX: 30, clientY: 30, bubbles: true }));
  w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }));
  const layer = M.state.activeLayer;
  assert.strictEqual(M.getCel(0, layer)[1 * 16 + 1], '#ff7aa8'); // (1,1) 已上色
  // 新建帧 + 添加图层（界面按钮）
  d.querySelector('#addFrame').click();
  d.querySelector('#addLayer').click();
  assert.strictEqual(M.state.frames.length, 2);
  assert.strictEqual(d.querySelectorAll('#layers .lrow').length, 5);
  // 等待防抖自动保存
  await sleep(700);
  const saved = w.localStorage.getItem('pixelLoom.v2');
  assert.ok(saved, '已写入 localStorage');
  assert.strictEqual(JSON.parse(saved).frames.length, 2);
  w.close();
  // 用保存的数据重新启动 → 本地恢复
  const dom2 = boot();
  dom2.window.localStorage.setItem('pixelLoom.v2', saved);
  dom2.window.eval(src);
  const M2 = dom2.window.PixelLoom;
  assert.strictEqual(M2.state.frames.length, 2);
  assert.strictEqual(M2.composite(0)[1 * 16 + 1], '#ff7aa8');
  assert.strictEqual(dom2.window.document.querySelectorAll('#layers .lrow').length, 5);
  dom2.window.close();
});

test('界面：多选帧 / 重命名 / 撤销 / 导出 / 播放', async () => {
  const dom = boot();
  dom.window.eval(src);
  const w = dom.window, d = w.document, M = w.PixelLoom;
  // 造 3 帧
  d.querySelector('#addFrame').click();
  d.querySelector('#addFrame').click();
  assert.strictEqual(M.state.frames.length, 3);
  // Ctrl+点击多选帧
  const thumbs = d.querySelectorAll('#frames .frame');
  thumbs[0].dispatchEvent(new w.MouseEvent('click', { ctrlKey: true, bubbles: true }));
  assert.strictEqual(M.state.selected.length, 2);
  // 双击重命名第一个图层行（组「角色」）
  const nameEl = d.querySelector('#layers .lrow .lname');
  nameEl.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
  const inp = d.querySelector('#layers .lrename');
  assert.ok(inp, '出现重命名输入框');
  inp.value = '新组名';
  inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.strictEqual(M.state.layers[0].name, '新组名');
  // 撤销重命名
  d.querySelector('#undo').click();
  assert.strictEqual(M.state.layers[0].name, '角色');
  d.querySelector('#redo').click();
  assert.strictEqual(M.state.layers[0].name, '新组名');
  // 导出（桩化 toDataURL，应不报错并更新状态栏）
  d.querySelector('#export').click();
  assert.match(d.querySelector('#status').textContent, /已导出当前帧/);
  d.querySelector('#exportSheet').click();
  assert.match(d.querySelector('#status').textContent, /精灵表/);
  // 播放 → 停止
  d.querySelector('#play').click();
  assert.strictEqual(d.querySelector('#play').textContent, '■ 停止预览');
  await sleep(350);
  d.querySelector('#play').click();
  assert.strictEqual(d.querySelector('#play').textContent, '▶ 播放动画');
  w.close();
});

test('界面：锁定/隐藏图层后绘制被拒绝并提示', () => {
  const dom = boot();
  dom.window.eval(src);
  const w = dom.window, d = w.document, M = w.PixelLoom;
  const canvas = d.querySelector('#canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 320, right: 320, bottom: 320 });
  // 点击锁定按钮（活动层「主体」所在行的锁）
  const activeRow = d.querySelector('#layers .lrow.active');
  activeRow.querySelector('.lock').click();
  assert.strictEqual(M.activeEditable(), false);
  canvas.dispatchEvent(new w.MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));
  assert.strictEqual(M.getCel(0, M.state.activeLayer), null); // 未写入
  assert.match(d.querySelector('#status').textContent, /不可编辑/);
  assert.match(d.querySelector('#layerHint').textContent, /不可编辑/);
  w.close();
});
