# 🐳 鲸鱼娘桌宠（Whale Pet）

DeepSeek 风格的鲸鱼娘桌面宠物，基于 Electron，支持 AI 聊天。

## 功能

- **漂浮动画** —— 上下浮动、摆尾、眨眼
- **鼠标拖拽** —— 拖到屏幕任意位置，位置自动记忆
- **气泡说话** —— 随机俏皮话气泡，双击喂食会说好吃
- **喂食互动** —— 双击鲸鱼娘投喂鱼/饼干，触发开心表情
- **番茄钟** 🍅 —— 托盘或宠物身上的圆形按钮启动，工作/休息自动切换，结束提醒
- **心情系统** —— 互动越多越开心，久不理会睡觉、心情低落会委屈
- **托盘菜单** —— 番茄钟控制、开关游动/气泡/全屏隐藏、打开聊天、设置、退出
- **边缘游动** —— 定时在桌面范围内游来游去，自动转向
- **全屏自动隐藏** —— 检测到全屏应用（看视频/演示）时自动躲起来
- **AI 聊天** —— 接入 DeepSeek API，右键鲸鱼娘或点 💬 按钮即可对话

## 安装与运行

```bash
npm install
npm start
```

开发模式（带 DevTools）：

```bash
npm run dev
```

## 配置 API 密钥（聊天功能）

**方式一：`.env` 文件（推荐）**

复制 `.env.example` 为 `.env`，填入你的密钥：

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

**方式二：** 环境变量 `DEEPSEEK_API_KEY`

密钥只存在本地，`.env` 已加入 `.gitignore`，不会泄露。

## 其他配置

托盘菜单「设置」会打开配置文件（`config.json`，位于系统用户数据目录），可修改：

| 配置项 | 默认 | 说明 |
|---|---|---|
| `petName` | 鲸鱼娘 | 宠物名字 |
| `pomodoroWork` | 25 | 工作时长（分钟） |
| `pomodoroRest` | 5 | 休息时长（分钟） |
| `roamEnabled` | true | 边缘游动开关 |
| `roamIntervalSec` | 45 | 游动间隔（秒） |
| `hideOnFullscreen` | true | 全屏自动隐藏 |
| `bubblesEnabled` | true | 随机气泡 |
| `deepseekModel` | deepseek-chat | 模型名 |

## 交互速查

| 操作 | 效果 |
|---|---|
| 按住拖动 | 移动位置 |
| 双击 | 喂食 🍪 |
| 右键 / 悬停点 💬 | 打开聊天窗口 |
| 点宠物身上的 🍅 | 开始/停止番茄钟 |

## 自定义形象

把你的图片放到项目根目录（与 `main.js` 同级）：

| 文件名 | 作用 |
|---|---|
| `pet.png` | 默认形象（没有则使用内置 SVG 鲸鱼） |
| `pet-happy.png` | 开心表情（可选） |
| `pet-sleep.png` | 睡觉表情（可选） |
| `pet-sad.png` | 委屈表情（可选） |

建议比例约 5:4（如 500×400），重启生效。图片只存本地，不进仓库。

## 说明

默认形象为致敬 DeepSeek 的原创绘制 SVG（蓝色小鲸 + 水柱），未使用任何官方素材，可自行修改 `renderer/index.html` 中的 SVG 调整外观。

## 打包发布（可选）

```bash
npm install --save-dev electron-builder
npx electron-builder --win   # 或 --mac / --linux
```
