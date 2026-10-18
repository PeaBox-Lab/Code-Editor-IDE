const{spawnSync}=require('child_process');let a=spawnSync(process.execPath,[require.resolve('pyright/index.js'),'--outputjson','-p',process.cwd()],{stdio:'inherit'});process.exit(a.status||0);
