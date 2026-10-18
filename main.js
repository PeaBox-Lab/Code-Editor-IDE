const {app,BrowserWindow,ipcMain,dialog,Menu}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'); let win,proc=null;
function create(){win=new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:600,backgroundColor:'#1e1e1e',title:'PeaBox IDE',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}}); win.loadFile('index.html');}
app.whenReady().then(()=>{Menu.setApplicationMenu(null);create()}); app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
function walk(root){function rec(p){let out=[];for(const x of fs.readdirSync(p,{withFileTypes:true})){if(['node_modules','.git','dist','.venv','__pycache__'].includes(x.name))continue;let f=path.join(p,x.name);out.push(x.isDirectory()?{name:x.name,path:f,dir:true,children:rec(f)}:{name:x.name,path:f,dir:false});}return out.sort((a,b)=>Number(b.dir)-Number(a.dir)||a.name.localeCompare(b.name));}return {root,children:rec(root)};}
ipcMain.handle('folder:open',async()=>{let r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:walk(r.filePaths[0])});
ipcMain.handle('folder:refresh',(_,p)=>walk(p));
ipcMain.handle('file:read',(_,p)=>({content:fs.readFileSync(p,'utf8'),mtime:fs.statSync(p).mtimeMs}));
ipcMain.handle('file:write',(_,p,c)=>{fs.writeFileSync(p,c,'utf8');return fs.statSync(p).mtimeMs});
ipcMain.handle('file:new',async(_,dir)=>{let r=await dialog.showSaveDialog(win,{defaultPath:dir||app.getPath('documents')});if(r.canceled)return null;fs.writeFileSync(r.filePath,'','utf8');return r.filePath});
ipcMain.handle('file:rename',(_,p,n)=>{let q=path.join(path.dirname(p),n);fs.renameSync(p,q);return q});
ipcMain.handle('file:delete',async(_,p)=>{let r=await dialog.showMessageBox(win,{type:'warning',buttons:['Cancel','Delete'],defaultId:0,cancelId:0,message:'Delete this item?',detail:p});if(r.response!==1)return false;fs.rmSync(p,{recursive:true,force:true});return true});
ipcMain.handle('folder:new',(_,dir,n)=>{let p=path.join(dir,n);fs.mkdirSync(p,{recursive:true});return p});
ipcMain.handle('project:search',(_,root,q)=>{let hits=[];function rec(d){for(let x of fs.readdirSync(d,{withFileTypes:true})){if(['node_modules','.git','dist','.venv','__pycache__'].includes(x.name))continue;let p=path.join(d,x.name);if(x.isDirectory())rec(p);else if(hits.length<250){try{let s=fs.statSync(p);if(s.size>2e6)continue;let lines=fs.readFileSync(p,'utf8').split(/\r?\n/);lines.forEach((v,i)=>{if(hits.length<250&&v.toLowerCase().includes(q.toLowerCase()))hits.push({path:p,line:i+1,text:v.trim().slice(0,180)})})}catch{}}}}rec(root);return hits});
ipcMain.handle('process:run',(_,cwd,cmd)=>{if(proc)return {ok:false,error:'A process is already running'};proc=spawn(cmd,{cwd,shell:true,env:process.env});proc.stdout.on('data',d=>win.webContents.send('process:output',d.toString()));proc.stderr.on('data',d=>win.webContents.send('process:output',d.toString()));proc.on('close',c=>{win.webContents.send('process:exit',c);proc=null});return {ok:true}});
ipcMain.handle('process:stop',()=>{if(!proc)return false;proc.kill();proc=null;return true});
ipcMain.handle('shell:show',(_,p)=>require('electron').shell.showItemInFolder(p));
ipcMain.handle('git:status',(_,cwd)=>new Promise(resolve=>{let p=spawn('git',['status','--short','--branch'],{cwd,shell:true});let s='';p.stdout.on('data',d=>s+=d);p.stderr.on('data',d=>s+=d);p.on('close',c=>resolve({code:c,text:s}))}));
ipcMain.handle('git:diff',(_,cwd)=>new Promise(resolve=>{let p=spawn('git',['diff'],{cwd,shell:true});let s='';p.stdout.on('data',d=>s+=d);p.stderr.on('data',d=>s+=d);p.on('close',c=>resolve({code:c,text:s}))}));
ipcMain.handle('file:duplicate',(_,p)=>{let ext=path.extname(p),base=p.slice(0,-ext.length),q=base+' copy'+ext,i=2;while(fs.existsSync(q))q=base+' copy '+(i++)+ext;fs.copyFileSync(p,q);return q});
