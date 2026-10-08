const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  chatSend: (messages) => ipcRenderer.invoke('chat:send', messages),
  dragBy: (dx, dy) => ipcRenderer.send('pet:drag', { dx, dy }),
  openChat: () => ipcRenderer.send('pet:open-chat'),
  togglePomodoroWork: () => ipcRenderer.send('pomodoro:toggle-work'),
  togglePomodoroRest: () => ipcRenderer.send('pomodoro:toggle-rest'),
  closeChat: () => ipcRenderer.send('chat:close'),
  openConfigFile: () => ipcRenderer.send('config:open-file'),
  onSay: (cb) => {
    ipcRenderer.on('pet:say', (_e, data) => cb(data));
  },
  onPomodoroState: (cb) => {
    ipcRenderer.on('pomodoro:state', (_e, data) => cb(data));
  },
  onFlip: (cb) => {
    ipcRenderer.on('pet:flip', (_e, data) => cb(data));
  },
  onSwim: (cb) => {
    ipcRenderer.on('pet:swim', (_e, data) => cb(data));
  },
  onSwimEnd: (cb) => {
    ipcRenderer.on('pet:swim-end', (_e, data) => cb(data));
  },
  onRoamChanged: (cb) => {
    ipcRenderer.on('pet:roam-changed', (_e, data) => cb(data));
  },
  onBubblesChanged: (cb) => {
    ipcRenderer.on('pet:bubbles-changed', (_e, data) => cb(data));
  },
  onChatFocus: (cb) => {
    ipcRenderer.on('chat:focus-input', (_e) => cb());
  },
});
