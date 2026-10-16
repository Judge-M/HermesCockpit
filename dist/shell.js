(async()=>{
 const shell=window.__HERMES_SHELL__||await fetch('shell.json').then(r=>r.json());
 document.getElementById('shared-header').innerHTML=shell.header;
 document.getElementById('shared-sidebar').innerHTML=shell.aside;
 const paths=['live-control','mesh-topology','tool-registry','acp-telemetry','runtime-config-settings'];
 document.querySelectorAll('#shared-sidebar a').forEach(a=>{
 const active=a.dataset.path===window.currentPage;
 a.href=a.dataset.path+'.html';a.className='flex items-center justify-center w-10 h-10 rounded-lg transition-all '+(active?'bg-surface-secondary text-primary font-bold shadow-sm':'text-text-secondary hover:bg-surface-container-high hover:text-text-primary');
 a.firstElementChild.className='material-symbols-outlined text-[20px] '+(active?'text-primary':'text-text-quaternary hover:text-text-primary');
 if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
 });
 document.addEventListener('keydown',e=>{const n=Number(e.key.slice(1));if(/^F[1-5]$/.test(e.key)){e.preventDefault();location.href=paths[n-1]+'.html';}});
 const notice=document.createElement('div');notice.id='demo-notice';notice.textContent='Frontend preview · sample data';notice.title='No Hermes instance is connected. Controls change this preview only.';document.body.append(notice);
 const toast=document.createElement('div');toast.id='toast';toast.setAttribute('role','status');document.body.append(toast);
 function tell(t){toast.textContent=t;toast.classList.add('visible');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>toast.classList.remove('visible'),3500)}
 document.querySelectorAll('#shared-header button').forEach(b=>b.addEventListener('click',()=>{
 const text=b.textContent.trim();
 if(text==='Node'){const name=prompt('Add a demo agent session name','Agent-Gamma');if(name){const tab=document.createElement('button');tab.textContent=name;tab.className='px-3 py-1 text-xs text-primary border border-border rounded';b.before(tab);tell('Demo session added: '+name)}}
 else if(b.title?.includes('Terminal')||text==='terminal'){const t=document.querySelector('main [id*="terminal"],main [id*="Terminal"]');if(t)t.hidden=!t.hidden;else tell('Terminal drawer is available on Live Control.');}
 else tell('Preview control — backend connection will be added later.');
 }));
 const storage=(()=>{try{return window.localStorage}catch{return null}})();
 document.querySelectorAll('input,select,textarea').forEach((el,i)=>{const key=currentPage+':'+(el.id||i);const v=storage?.getItem(key);if(v!==null&&v!==undefined){if(el.type==='checkbox')el.checked=v==='true';else el.value=v}if(storage)el.addEventListener('change',()=>storage.setItem(key,el.type==='checkbox'?el.checked:el.value))});
 document.querySelectorAll('main button').forEach(b=>{if(!b.onclick)b.addEventListener('click',()=>{if(/Save|Reload Engine/.test(b.textContent))tell('Preview settings saved locally. No engine is connected.');if(/Export/.test(b.textContent)){const data=JSON.stringify({prototype:true,page:currentPage,settings:Object.fromEntries(Object.entries(storage||{}).filter(([k])=>k.startsWith(currentPage)))},null,2);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));a.download='hermes-preview.json';a.click();URL.revokeObjectURL(a.href)}})});
})().catch(console.error);
