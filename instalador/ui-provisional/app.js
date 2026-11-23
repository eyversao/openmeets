const T={es:{titulo:'Instalar OpenMeets',sub:'Competencias de powerlifting en vivo.',carpeta:'Carpeta de instalación',elegir:'Cambiar…',esc:'Acceso directo en el escritorio',ini:'Acceso directo en el menú Inicio',abr:'Abrir OpenMeets al terminar',go:'Instalar',prog:'Instalando…',fin:'Todo listo',abrir:'Abrir OpenMeets',cerrar:'Cerrar',err:'Algo salió mal',volver:'Volver',dt:'Desinstalar OpenMeets',dgo:'Desinstalar',dprog:'Desinstalando…',dfin:'OpenMeets se desinstaló. Tus datos se conservan.'},
en:{titulo:'Install OpenMeets',sub:'Live powerlifting competitions.',carpeta:'Install folder',elegir:'Change…',esc:'Desktop shortcut',ini:'Start menu shortcut',abr:'Open OpenMeets when done',go:'Install',prog:'Installing…',fin:'All set',abrir:'Open OpenMeets',cerrar:'Close',err:'Something went wrong',volver:'Back',dt:'Uninstall OpenMeets',dgo:'Uninstall',dprog:'Uninstalling…',dfin:'OpenMeets was uninstalled. Your data is kept.'}};
const $=i=>document.getElementById(i),post=o=>window.ipc.postMessage(JSON.stringify(o));
let t=T.es,modo='instalar';
const ver=s=>{for(const x of ['s-inicio','s-prog','s-fin','s-err'])$(x).hidden=x!==s};
window.instalador={
 datos(d){t=T[d.idioma]||T.en;modo=d.modo;document.documentElement.lang=d.idioma;$('ver').textContent='v'+d.version;$('ruta').value=d.carpetaPorDefecto;
  const u=modo==='desinstalar';$('t-titulo').textContent=u?t.dt:t.titulo;$('t-sub').textContent=u?d.carpetaPorDefecto:t.sub;
  $('t-carpeta').textContent=t.carpeta;$('elegir').textContent=t.elegir;$('t-esc').textContent=t.esc;$('t-ini').textContent=t.ini;$('t-abr').textContent=t.abr;
  $('go').textContent=u?t.dgo:t.go;$('t-prog').textContent=u?t.dprog:t.prog;$('t-fin').textContent=u?t.dfin:t.fin;$('abrir').textContent=t.abrir;$('cerrar2').textContent=t.cerrar;$('t-err').textContent=t.err;$('volver').textContent=t.volver;
  if(u)for(const e of document.querySelectorAll('.campo,label'))e.hidden=true;
  $('abrir').hidden=u},
 carpeta(r){$('ruta').value=r},
 progreso(p,x){ver('s-prog');$('rel').style.width=p+'%';$('txt').textContent=x},
 listo(){ver('s-fin')},
 error(m){ver('s-err');$('msg').textContent=m}};
$('cab').addEventListener('mousedown',e=>{if(e.target.tagName!=='BUTTON')post({accion:'arrastrar'})});
$('min').onclick=()=>post({accion:'minimizar'});$('cer').onclick=$('cerrar2').onclick=()=>post({accion:'cerrar'});
$('elegir').onclick=()=>post({accion:'elegirCarpeta'});$('abrir').onclick=()=>post({accion:'abrirApp'});$('volver').onclick=()=>ver('s-inicio');
$('go').onclick=()=>modo==='desinstalar'?post({accion:'desinstalar'}):post({accion:'instalar',carpeta:$('ruta').value,escritorio:$('c-esc').checked,inicio:$('c-ini').checked,abrir:$('c-abr').checked});
