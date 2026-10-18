const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('path'),fs=require('fs'),{spawn}=require('child_process');
let win;
function create(){win=new BrowserWindow({width:1300,height:820,backgroundColor:'#1e1e1e',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});win.loadFile('index.html');}
app.whenReady().then(create); app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
ipcMain.handle('open-folder',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});if(r.canceled)return null;return tree(r.filePaths[0]);});
function tree(root){function walk(p){return fs.readdirSync(p,{withFileTypes:true}).filter(x=>!['node_modules','.git'].includes(x.name)).map(x=>{let f=path.join(p,x.name);return x.isDirectory()?{name:x.name,path:f,dir:true,children:walk(f)}:{name:x.name,path:f,dir:false};});}return {root,children:walk(root)};}
ipcMain.handle('read-file',(_,p)=>fs.readFileSync(p,'utf8'));
ipcMain.handle('save-file',(_,p,c)=>{fs.writeFileSync(p,c,'utf8');return true});
ipcMain.handle('new-file',async(_,dir)=>{let r=await dialog.showSaveDialog(win,{defaultPath:dir||app.getPath('documents')});if(r.canceled)return null;fs.writeFileSync(r.filePath,'','utf8');return r.filePath});
ipcMain.handle('run',(_,cwd,cmd)=>new Promise(resolve=>{let useShell=true;let p=spawn(cmd,{cwd,shell:useShell});let out='';p.stdout.on('data',d=>{out+=d;win.webContents.send('run-output',d.toString())});p.stderr.on('data',d=>{out+=d;win.webContents.send('run-output',d.toString())});p.on('close',c=>resolve(c));}));
