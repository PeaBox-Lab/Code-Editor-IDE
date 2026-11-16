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
    replace: (payload) => invoke('workspace:replace', payload),
    watchStart: (dir) => invoke('workspace:watchStart', dir),
    watchStop: () => invoke('workspace:watchStop'),
    stat: (path) => invoke('workspace:stat', path),
    createFile: (payload) => invoke('workspace:createFile', payload),
    createFolder: (payload) => invoke('workspace:createFolder', payload)
  },

  file: {
    read: (path) => invoke('file:read', path),
    write: (path, content, expectedMtime) => invoke('file:write', path, content, expectedMtime),
    stat: (path) => invoke('fs:stat', path),
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
    stageHunk: (payload) => invoke('git:stageHunk', payload),
    unstageHunk: (payload) => invoke('git:unstageHunk', payload),
    discard: (payload) => invoke('git:discard', payload),
    stageAll: (cwd) => invoke('git:stageAll', cwd),
    unstageAll: (cwd) => invoke('git:unstageAll', cwd),
    commit: (payload) => invoke('git:commit', payload),
    switchBranch: (payload) => invoke('git:switch', payload),
    createBranch: (payload) => invoke('git:createBranch', payload),
    deleteBranch: (payload) => invoke('git:deleteBranch', payload),
    diffLines: (payload) => invoke('git:diffLines', payload),
    pull: (cwd) => invoke('git:pull', cwd),
    push: (cwd) => invoke('git:push', cwd),
    fetch: (cwd) => invoke('git:fetch', cwd),
    stash: (cwd) => invoke('git:stash', cwd),
    stashPop: (cwd) => invoke('git:stashPop', cwd),
    show: (payload) => invoke('git:show', payload),
    log: (cwd) => invoke('git:log', { cwd: cwd }),
    blame: (cwd) => invoke('git:blame', { cwd: cwd }),
    remote: (cwd) => invoke('git:remote', cwd)
  },

  run: {
    start: (payload) => invoke('run:start', payload),
    stop: () => invoke('run:stop'),
    input: (text) => invoke('run:input', text),
    check: (exe) => invoke('run:check', exe)
  },
  problems: {
    check: (payload) => invoke('problems:check', payload)
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

  lsp: {
    start: (payload) => invoke('lsp:start', payload),
    stop: (payload) => invoke('lsp:stop', payload),
    request: (payload) => invoke('lsp:request', payload),
    notify: (payload) => invoke('lsp:notify', payload),
    list: () => invoke('lsp:list'),
    diagnostics: (payload) => send('lsp:diagnostics', payload),
    definition: (payload) => invoke('lsp:definition', payload),
    references: (payload) => invoke('lsp:references', payload),
    rename: (payload) => invoke('lsp:rename', payload),
    typeDefinition: (payload) => invoke('lsp:typeDefinition', payload),
    implementation: (payload) => invoke('lsp:implementation', payload),
    peekDefinition: (payload) => invoke('lsp:peekDefinition', payload),
    peekReferences: (payload) => invoke('lsp:peekReferences', payload)
  },

  ai: {
    providers: () => invoke('ai:providers'),
    keyStatus: () => invoke('ai:keyStatus'),
    setKey: (payload) => invoke('ai:setKey', payload),
    diagnose: (payload) => invoke('ai:diagnose', payload),
    complete: (payload) => invoke('ai:complete', payload),
    chat: (payload) => invoke('ai:chat', payload),
    createFile: (payload) => invoke('ai:createFile', payload),
    createFolder: (payload) => invoke('ai:createFolder', payload),
    codegen: (payload) => invoke('ai:codegen', payload),
    scaffold: (payload) => invoke('ai:scaffold', payload),
    edit: (payload) => invoke('ai:edit', payload)
  },

  recovery: {
    list: () => invoke('recovery:list'),
    read: (file) => invoke('recovery:read', file),
    save: (payload) => invoke('recovery:save', payload),
    clear: (file) => invoke('recovery:clear', file)
  },

  session: {
    load: () => invoke('session:load'),
    save: (session) => invoke('session:save', session)
  },

  on: {
    menu: (cb) => subscribe('menu:command', cb),
    fileChanged: (cb) => subscribe('file:changed', cb),
    workspaceChanged: (cb) => subscribe('workspace:changed', cb),
    runOutput: (cb) => subscribe('run:output', cb),
    runExit: (cb) => subscribe('run:exit', cb),
    terminalData: (cb) => subscribe('terminal:data', cb),
    terminalExit: (cb) => subscribe('terminal:exit', cb),
    lspDiagnostics: (cb) => subscribe('lsp:diagnostics', cb),
    closeRequest: (cb) => subscribe('app:close-request', cb)
  }
});
