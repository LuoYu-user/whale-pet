'use strict';

const { app, BrowserWindow, Tray, Menu, screen, ipcMain, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const IS_DEV = process.argv.includes('--dev');

// ---------- 配置持久化 ----------
const userDataPath = () => app.getPath('userData');
const configPath = () => path.join(userDataPath(), 'config.json');

const defaultConfig = {
  petName: '鲸鱼娘',
  pomodoroWork: 25,
  pomodoroRest: 5,
  roamEnabled: false,
  roamIntervalSec: 45,
  hideOnFullscreen: true,
  bubblesEnabled: true,
  bubbleIntervalSec: 90,
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',
  systemPrompt:
    '你是一只可爱的鲸鱼娘，是用户的桌面宠物。用简短、活泼、俏皮的中文口语回答，' +
    '每次回答不超过两句话，偶尔加上 🐳 之类的表情符号。你不只是宠物，也是一个聪明的 AI 助手，' +
    '回答问题要准确有帮助，但保持可爱的语气。',
  lastX: null,
  lastY: null,
};

let config;
function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    config = { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    config = { ...defaultConfig };
  }
  // 环境变量优先（.env / DEEPSEEK_API_KEY）
  if (process.env.DEEPSEEK_API_KEY) config.deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  if (!config.deepseekApiKey) {
    try {
      const envPath = path.join(__dirname, '.env');
      if (fs.existsSync(envPath)) {
        const line = fs.readFileSync(envPath, 'utf8').split('\n').find(l => l.startsWith('DEEPSEEK_API_KEY='));
        if (line) config.deepseekApiKey = line.slice('DEEPSEEK_API_KEY='.length).trim();
      }
    } catch {}
  }
}
function saveConfig() {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch (e) {
    if (IS_DEV) console.error('saveConfig', e);
  }
}

// ---------- 窗口 ----------
let petWin = null;
let chatWin = null;
let tray = null;
let isQuitting = false;

const PET_SIZE = { width: 200, height: 260 };
// 鲸鱼本体在窗口内的区域（与渲染层 PET_BOX 一致）；上方留白给气泡
const PET_BOX = { x: 20, y: 90, w: 160, h: 130 };

function createPetWindow() {
  petWin = new BrowserWindow({
    ...PET_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  let savePosTimer = null;
  petWin.on('moved', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    config.lastX = x;
    config.lastY = y;
    // 防抖：游动动画高频触发 moved，不能每次都写磁盘
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(saveConfig, 500);
  });
  // 透明区域点击穿透：鼠标不在鲸鱼本体区域时，点击事件直接传给桌面
  const area = { ...PET_BOX };
  let lastInPet = null;
  setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const [px, py] = petWin.getPosition();
    const inX = cursor.x >= px + area.x && cursor.x <= px + area.x + area.w;
    const inY = cursor.y >= py + area.y && cursor.y <= py + area.y + area.h;
    const inPet = inX && inY;
    petWin.setIgnoreMouseEvents(!inPet, { forward: true });
    if (inPet !== lastInPet) {
      lastInPet = inPet;
      petWin.webContents.send('pet:mouse-in-pet', { inPet });
    }
  }, 120).unref();
  if (IS_DEV) petWin.webContents.openDevTools({ mode: 'detach' });
}

function createChatWindow() {
  chatWin = new BrowserWindow({
    width: 380,
    height: 520,
    frame: false,
    resizable: true,
    transparent: true,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWin.setAlwaysOnTop(true, 'floating');
  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  let chatShownAt = 0;
  chatWin.on('show', () => { chatShownAt = Date.now(); });
  chatWin.on('blur', () => {
    // 显示后 500ms 内的失焦是窗口切换抖动，忽略，避免“闪现即隐藏”
    if (!chatWin || chatWin.isDestroyed()) return;
    if (Date.now() - chatShownAt < 500) return;
    if (!chatWin.webContents.isDevToolsOpened()) chatWin.hide();
  });
}

function showChatNearPet() {
  if (!chatWin) createChatWindow();
  // 已打开则收起（再次点击鲸鱼=切换聊天窗口）；刚显示的 400ms 内不响应切换，防双击误关
  if (chatWin.isVisible() && Date.now() - chatShownAt > 400) {
    chatWin.hide();
    return;
  }
  const pos = petWin ? petWin.getPosition() : [100, 100];
  const [px, py] = pos;
  const display = screen.getDisplayNearestPoint({ x: px, y: py });
  const { width, height } = display.workAreaSize;
  let x = px + 60;
  let y = py + 80;
  if (x + 380 > display.workArea.x + width) x = px - 380 + 60;
  if (y + 520 > display.workArea.y + height) y = Math.max(display.workArea.y, py - 520 + 100);
  chatWin.setBounds({ x, y, width: 380, height: 520 });
  chatWin.show();
  chatWin.focus();
  // Windows 可能拒绝后台进程窗口抢焦点，延迟再聚焦一次确保输入框可用
  setTimeout(() => { if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible()) chatWin.focus(); }, 350);
  chatWin.webContents.send('chat:focus-input');
}

// ---------- DeepSeek API ----------
async function callDeepSeek(messages) {
  const key = config.deepseekApiKey;
  if (!key) {
    return {
      ok: false,
      error: '还没配置 DeepSeek API 密钥。请点击托盘菜单「设置」，或在 .env 文件中填写 DEEPSEEK_API_KEY。',
    };
  }
  try {
    const res = await fetch(`${config.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        messages: [{ role: 'system', content: config.systemPrompt }, ...messages],
        max_tokens: 300,
        temperature: 0.8,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `API 错误 (${res.status})：${text.slice(0, 200)}` };
    }
    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) return { ok: false, error: 'API 返回为空' };
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, error: `网络错误：${e.message}` };
  }
}

// ---------- 番茄钟 ----------
const pomodoro = {
  mode: 'idle', // idle | work | rest
  remaining: 0,
  timer: null,
};

function pomodoroTick() {
  pomodoro.remaining -= 1;
  const total = pomodoro.mode === 'work' ? config.pomodoroWork * 60 : config.pomodoroRest * 60;
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send('pomodoro:state', {
      mode: pomodoro.mode,
      remaining: pomodoro.remaining,
      total,
    });
  }
  if (pomodoro.remaining <= 0) {
    if (pomodoro.mode === 'work') {
      startPomodoro('rest');
      notify('番茄钟完成 🍅', '工作结束啦！休息一下吧～');
    } else {
      stopPomodoro();
      notify('休息结束 💪', '精力恢复！随时可以开始下一个番茄钟');
    }
  }
}

function startPomodoro(mode) {
  stopPomodoro();
  pomodoro.mode = mode;
  pomodoro.remaining = (mode === 'work' ? config.pomodoroWork : config.pomodoroRest) * 60;
  pomodoro.timer = setInterval(pomodoroTick, 1000);
  if (petWin) petWin.webContents.send('pomodoro:state', { mode, remaining: pomodoro.remaining, total: pomodoro.remaining });
}

function stopPomodoro() {
  if (pomodoro.timer) clearInterval(pomodoro.timer);
  pomodoro.timer = null;
  pomodoro.mode = 'idle';
  pomodoro.remaining = 0;
  if (petWin) petWin.webContents.send('pomodoro:state', { mode: 'idle', remaining: 0, total: 0 });
}

function notify(title, body) {
  if (petWin) petWin.webContents.send('pet:say', { text: body, kind: 'system' });
  if (process.platform === 'win32' || !tray) {
    new (require('electron').Notification)({ title, body }).show();
  } else if (tray) {
    tray.displayBalloon ? tray.displayBalloon({ title, content: body }) : new (require('electron').Notification)({ title, body }).show();
  }
}

// ---------- 游动 ----------
let roamTimer = null;

function petPosition() {
  if (!petWin) return null;
  const [x, y] = petWin.getPosition();
  return { x, y };
}

function randomRoamPoint() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const nx = x + Math.random() * (width - PET_SIZE.width);
  const ny = y + Math.random() * (height - PET_SIZE.height);
  return { x: Math.round(nx), y: Math.round(ny) };
}

function roamStep() {
  if (!petWin || !config.roamEnabled || petWin.isDestroyed()) return;
  if (pomodoro.mode === 'work') return; // 工作中不打扰，避免拖拽冲突
  const cur = petPosition();
  if (!cur) return;
  const target = randomRoamPoint();
  const duration = 3000 + Math.random() * 3000;
  const start = Date.now();
  const from = { ...cur };
  const forward = target.x >= from.x;
  if (petWin) petWin.webContents.send('pet:flip', { facing: forward ? 'right' : 'left' });
  petWin.webContents.send('pet:swim', {});
  const step = () => {
    if (!petWin || petWin.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    petWin.setPosition(
      Math.round(from.x + (target.x - from.x) * eased),
      Math.round(from.y + (target.y - from.y) * eased)
    );
    if (t < 1) setTimeout(step, 16);
    else petWin.webContents.send('pet:swim-end', {});
  };
  step();
}

function startRoaming() {
  if (roamTimer) clearInterval(roamTimer);
  roamTimer = setInterval(() => roamStep(), config.roamIntervalSec * 1000);
}

// ---------- 全屏检测 ----------
let fullscreenTimer = null;
let hiddenByFullscreen = false;

let lastWorkAreaSig = '';
function checkFullscreen() {
  if (!config.hideOnFullscreen || !petWin || petWin.isDestroyed()) return;
  // 只在 workArea 签名变化时判定，避免任务栏自动隐藏的用户被误判
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sig = `${display.id}:${display.workArea.x},${display.workArea.y},${display.workArea.width},${display.workArea.height}`;
  const changed = sig !== lastWorkAreaSig;
  lastWorkAreaSig = sig;
  if (!changed) return;
  const isFs =
    display.workArea.y === display.bounds.y &&
    display.workArea.x === display.bounds.x &&
    display.workArea.width === display.bounds.width &&
    display.workArea.height === display.bounds.height &&
    display.bounds.height - display.workArea.height === 0;
  // 连续两次确认才触发，防止瞬间抖动
  if (isFs && !hiddenByFullscreen) {
    hiddenByFullscreen = true;
    petWin.hide();
    if (chatWin && chatWin.isVisible()) chatWin.hide();
  } else if (!isFs && hiddenByFullscreen) {
    hiddenByFullscreen = false;
    petWin.show();
  }
}

function startFullscreenWatch() {
  if (fullscreenTimer) clearInterval(fullscreenTimer);
  fullscreenTimer = setInterval(checkFullscreen, 2000);
}

// ---------- 托盘图标（首次运行自动生成 PNG） ----------
function ensureTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  if (fs.existsSync(iconPath)) return iconPath;
  const zlib = require('zlib');
  const W = 32, H = 32;
  const px = new Uint8Array(W * H * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ex = (x - 18) / 10, ey = (y - 16) / 7;
      const body = ex * ex + ey * ey <= 1;
      const tail = x > 3 && x < 10 && Math.abs(y - 16) < (x - 3) * 1.2 && Math.abs(y - 16) > (x - 4) * 0.35;
      const spout = x >= 20 && x <= 22 && y >= 6 && y <= 9;
      if (body || tail || spout) set(x, y, 77, 107, 254);
      if (tail && Math.abs(y - 16) < 1.5) set(x, y, 0, 0, 0, 0);
    }
  }
  set(14, 14, 26, 35, 64);
  for (let y = 18; y <= 19; y++) for (let x = 12; x <= 14; x++) set(x, y, 255, 158, 181, 200);
  const raw = Buffer.alloc(H * (1 + W * 4));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      raw[o++] = px[i]; raw[o++] = px[i + 1]; raw[o++] = px[i + 2]; raw[o++] = px[i + 3];
    }
  }
  const idat = zlib.deflateSync(raw);
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    let crc = 0xffffffff;
    for (const b of Buffer.concat([t, data])) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, t, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.mkdirSync(path.dirname(iconPath), { recursive: true });
  fs.writeFileSync(iconPath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return iconPath;
}

// ---------- 托盘 ----------
let trayIconPath = null;
function createTray() {
  trayIconPath = ensureTrayIcon();
  tray = new Tray(trayIconPath);
  rebuildTrayMenu();
  tray.setToolTip('鲸鱼娘桌宠 🐳');
}

function rebuildTrayMenu() {
  const pomoLabel =
    pomodoro.mode === 'work'
      ? `🍅 工作中 ${fmt(pomodoro.remaining)}（点击暂停）`
      : pomodoro.mode === 'rest'
      ? `😴 休息中 ${fmt(pomodoro.remaining)}`
      : '🍅 番茄钟：未运行';
  const menu = Menu.buildFromTemplate([
    { label: pomoLabel, enabled: pomodoro.mode !== 'idle', click: () => { stopPomodoro(); } },
    { label: '开始工作番茄钟', enabled: pomodoro.mode === 'idle', click: () => startPomodoro('work') },
    { label: '开始休息', enabled: pomodoro.mode === 'idle', click: () => startPomodoro('rest') },
    { type: 'separator' },
    {
      label: `${config.roamEnabled ? '✓' : '　'}边缘游动`,
      click: () => {
        config.roamEnabled = !config.roamEnabled;
        saveConfig();
        rebuildTrayMenu();
        if (petWin) petWin.webContents.send('pet:roam-changed', { enabled: config.roamEnabled });
      },
    },
    {
      label: `${config.hideOnFullscreen ? '✓' : '　'}全屏自动隐藏`,
      click: () => {
        config.hideOnFullscreen = !config.hideOnFullscreen;
        saveConfig();
        rebuildTrayMenu();
      },
    },
    {
      label: `${config.bubblesEnabled ? '✓' : '　'}随机气泡`,
      click: () => {
        config.bubblesEnabled = !config.bubblesEnabled;
        saveConfig();
        rebuildTrayMenu();
        if (petWin) petWin.webContents.send('pet:bubbles-changed', { enabled: config.bubblesEnabled });
      },
    },
    { type: 'separator' },
    { label: '💬 和鲸鱼娘聊天', click: () => showChatNearPet() },
    {
      label: '⚙️ 打开配置文件',
      click: () => shell.showItemInFolder(configPath()),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('config:get', () => ({
    petName: config.petName,
    roamEnabled: config.roamEnabled,
    bubblesEnabled: config.bubblesEnabled,
    pomodoroWork: config.pomodoroWork,
    pomodoroRest: config.pomodoroRest,
    hasApiKey: !!config.deepseekApiKey,
    model: config.deepseekModel,
  }));
  ipcMain.handle('chat:send', async (_e, messages) => {
    if (!Array.isArray(messages) || messages.length === 0) return { ok: false, error: '空消息' };
    return callDeepSeek(messages);
  });
  ipcMain.on('pet:drag', (_e, { dx, dy }) => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    petWin.setPosition(x + dx, y + dy, false);
  });
  ipcMain.on('pet:open-chat', () => showChatNearPet());
  ipcMain.on('pomodoro:toggle-work', () => {
    if (pomodoro.mode === 'idle') startPomodoro('work');
    else stopPomodoro();
  });
  ipcMain.on('pomodoro:toggle-rest', () => {
    if (pomodoro.mode === 'idle') startPomodoro('rest');
    else stopPomodoro();
  });
  ipcMain.on('chat:close', () => chatWin && chatWin.hide());
  ipcMain.on('config:open-file', () => shell.showItemInFolder(configPath()));
  ipcMain.on('pet:toggle-roam', () => {
    config.roamEnabled = !config.roamEnabled;
    saveConfig();
    rebuildTrayMenu();
    if (petWin) petWin.webContents.send('pet:roam-changed', { enabled: config.roamEnabled });
  });
  ipcMain.on('app:quit', () => {
    isQuitting = true;
    app.quit();
  });
}

// ---------- 启动 ----------
app.whenReady().then(() => {
  loadConfig();
  createPetWindow();
  createChatWindow();
  createTray();
  setupIpc();
  startRoaming();
  startFullscreenWatch();
  rebuildTrayMenu();

  // 恢复位置
  if (config.lastX != null && config.lastY != null) {
    const valid = screen.getAllDisplays().some(d => {
      const { x, y, width, height } = d.workArea;
      return config.lastX >= x - 50 && config.lastX <= x + width && config.lastY >= y - 50 && config.lastY <= y + height;
    });
    if (valid) petWin.setPosition(config.lastX, config.lastY);
  }

  if (IS_DEV) console.log('whale-pet started, config at', configPath());
});

app.on('before-quit', () => {
  isQuitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
