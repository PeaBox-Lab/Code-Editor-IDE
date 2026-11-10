'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, payload) => ipcRenderer.send(channel, payload);

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  app: {
    info: () => invoke('app:info'),
    loadState: () => invoke('app:loadState'),
    saveState: (state) => invoke('app:saveState', state),
    copy: (text) => invoke('app:copy', text),
    close: (action) => invoke('app:close', action)
  },

  workspace: {
    choose: () => invoke('workspace:choose'),
    load: (dir) => invoke('workspace:load', dir),
    refresh: (dir) => invoke('workspace:refresh', dir),
    children: (dir) => invoke('workspace:children', dir),
    files: (payload) => invoke('workspace:files', payload),
    search: (payload) => invoke('workspace:search', payload),
    watchStart: (dir) => invoke('workspace:watchStart', dir),
    watchStop: () => invoke('workspace:watchStop'),
    stat: (path) => invoke('workspace:stat', path),
    createFile: (payload) => invoke('workspace:createFile', payload),
    createFolder: (payload) => invoke('workspace:createFolder', payload)
  },

  file: {
    read: (path) => invoke('file:read', path),
    write: (path, content) => invoke('file:write', path, content),
    newFile: (root) => invoke('file:new', root),
    openDialog: () => invoke('dialog:file'),
    rename: (path, name) => invoke('file:rename', path, name),
    remove: (path) => invoke('file:delete', path),
    reveal: (path) => invoke('file:reveal', path),
    watchStart: (path) => invoke('watch:start', path),
    watchStop: (path) => invoke('watch:stop', path),
    encoding: (file) => invoke('file:encoding', { file }),
    eol: (file) => invoke('file:eol', { file })
  },

  git: {
    status: (cwd) => invoke('git:status', cwd),
    branches: (cwd) => invoke('git:branches', cwd),
    diff: (payload) => invoke('git:diff', payload),
    stage: (payload) => invoke('git:stage', payload),
    unstage: (payload) => invoke('git:unstage', payload),
    discard: (payload) => invoke('git:discard', payload),
    stageAll: (cwd) => invoke('git:stageAll', cwd),
    unstageAll: (cwd) => invoke('git:unstageAll', cwd),
    commit: (payload) => invoke('git:commit', payload),
    switchBranch: (payload) => invoke('git:switch', payload),
    createBranch: (payload) => invoke('git:createBranch', payload),
    pull: (cwd) => invoke('git:pull', cwd),
    push: (cwd) => invoke('git:push', cwd),
    fetch: (cwd) => invoke('git:fetch', cwd),
    stash: (cwd) => invoke('git:stash', cwd),
    stashPop: (cwd) => invoke('git:stashPop', cwd),
    remote: (cwd) => invoke('git:remote', cwd)
  },

  run: {
    start: (payload) => invoke('run:start', payload),
    stop: () => invoke('run:stop'),
    check: (exe) => invoke('run:check', exe)
  },

  runtime: {
    detect: (payload) => invoke('runtime:detect', payload)
  },

  terminal: {
    create: (payload) => invoke('terminal:create', payload),
    input: (payload) => send('terminal:input', payload),
    resize: (payload) => send('terminal:resize', payload),
    kill: (id) => invoke('terminal:kill', id)
  },

  recovery: {
    list: () => invoke('recovery:list'),
    read: (file) => invoke('recovery:read', file),
    save: (payload) => invoke('recovery:save', payload),
    clear: (file) => invoke('recovery:clear', file)
  },

  on: {
    menu: (cb) => subscribe('menu:command', cb),
    fileChanged: (cb) => subscribe('file:changed', cb),
    workspaceChanged: (cb) => subscribe('workspace:changed', cb),
    runOutput: (cb) => subscribe('run:output', cb),
    runExit: (cb) => subscribe('run:exit', cb),
    terminalData: (cb) => subscribe('terminal:data', cb),
    terminalExit: (cb) => subscribe('terminal:exit', cb),
    closeRequest: (cb) => subscribe('app:close-request', cb)
  }
});
