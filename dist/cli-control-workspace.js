(()=>{
    'use strict';
    const API_BASE='/hermes/api/plugins/judge-m-control-plane';
    const OUTPUT_LIMIT=50000;
    const POLL_INTERVAL=1200;
    const TERMINAL_STATES=new Set(['completed','success','succeeded','failed','error','cancelled','canceled','stopped','timed_out']);
    const HIGH_RISKS=new Set(['high','critical','dangerous','destructive']);
    const state={operations:[],filtered:[],jobs:[],selectedId:'',openFamilies:new Set(),job:null,pollTimer:null,polling:false,pending:null,loading:false,jobsInterval:null};
    const el=id=>document.getElementById(id);
    const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n};
    const text=value=>value===undefined||value===null?'':String(value);
    const pretty=value=>text(value).replace(/[-_.]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase()).trim();
    const normalizeRisk=value=>text(value||'low').trim().toLowerCase();
    const isAvailable=operation=>{const value=operation.availability;if(value&&typeof value==='object'){if(typeof value.available==='boolean')return value.available;if(typeof value.enabled==='boolean')return value.enabled;return['available','ready','enabled','supported'].includes(text(value.status).toLowerCase())}return value===true||['available','ready','enabled','supported','true'].includes(text(value).toLowerCase())};
    const isHighRisk=operation=>HIGH_RISKS.has(normalizeRisk(operation.risk));
    const safeId=value=>encodeURIComponent(text(value));
    const jobOf=value=>value&&value.job&&typeof value.job==='object'?value.job:value;
    const statusOf=value=>{const job=jobOf(value);return text((job&&(job.status||job.state))||'unknown').toLowerCase()};
    const jobIdOf=value=>{const job=jobOf(value);return job&&(job.job_id||job.id||job.jobId)};
    const setStatus=(kind,message)=>{el('catalogStatus').dataset.state=kind;el('catalogStatusText').textContent=message};
    const clearPolling=()=>{if(state.pollTimer)clearTimeout(state.pollTimer);state.pollTimer=null;state.polling=false};
    const apiError=message=>{const n=node('div','cc-error');n.setAttribute('role','alert');n.textContent=message;return n};
    const describeKind=field=>field.multiple?`${pretty(field.kind||'text')} list`:pretty(field.kind||'text');
    const availableLabel=operation=>isAvailable(operation)?'Available':'Unavailable';

    function normalizeField(raw,index){
      const field=raw&&typeof raw==='object'?raw:{};
      return{name:text(field.name||`value_${index+1}`),label:text(field.label||pretty(field.name||`Value ${index+1}`)),kind:text(field.kind||'string').toLowerCase(),required:Boolean(field.required),choices:Array.isArray(field.choices)?field.choices:[],default:field.default,help:text(field.help),multiple:Boolean(field.multiple),sensitive:Boolean(field.sensitive)};
    }
    function normalizeOperation(raw,index){
      const operation=raw&&typeof raw==='object'?raw:{};
      const availabilityReason=operation.availability&&typeof operation.availability==='object'?(operation.availability.reason||operation.availability.unavailable_reason):'';
      return{id:text(operation.id||`operation-${index+1}`),command:text(operation.command),title:text(operation.title||pretty(operation.id)||`Action ${index+1}`),description:text(operation.description),family:text(operation.family||'Other'),coverage:text(operation.coverage||'cli_only'),coverage_label:text(operation.coverage_label||'CLI-only family'),risk:normalizeRisk(operation.risk),confirmation:operation.confirmation,interactive:Boolean(operation.interactive),long_running:Boolean(operation.long_running),availability:operation.availability,unavailable_reason:text(operation.unavailable_reason||availabilityReason),arguments:(Array.isArray(operation.arguments)?operation.arguments:[]).map(normalizeField),positionals:(Array.isArray(operation.positionals)?operation.positionals:[]).map(normalizeField)};
    }
    function riskIcon(operation){if(isHighRisk(operation))return'warning';if(operation.risk==='medium')return'priority_high';return'play_arrow'}
    function searchText(operation){return[operation.id,operation.title,operation.description,operation.family,operation.coverage,operation.coverage_label,operation.risk,operation.unavailable_reason,...operation.arguments.flatMap(item=>[item.name,item.label,item.help]),...operation.positionals.flatMap(item=>[item.name,item.label,item.help])].join(' ').toLowerCase()}

    function renderFilters(){
      const availability=el('availabilityFilter'),coverage=el('coverageFilter');
      availability.value=['','available','unavailable'].includes(availability.value)?availability.value:'';
      coverage.value=['','partial_api_gap','cli_only'].includes(coverage.value)?coverage.value:'';
    }
    function applyFilters(){
      const query=el('searchInput').value.trim().toLowerCase(),availability=el('availabilityFilter').value,coverage=el('coverageFilter').value;
      state.filtered=state.operations.filter(operation=>(!query||searchText(operation).includes(query))&&(!availability||(availability==='available')===isAvailable(operation))&&(!coverage||operation.coverage===coverage));
      renderCatalog();
    }
    function renderCatalog(){
      const root=el('operationGroups');root.replaceChildren();el('operationCount').textContent=`${state.filtered.length} of ${state.operations.length}`;
      if(!state.filtered.length){const empty=node('div','cc-empty compact');empty.append(node('span','material-symbols-outlined','search_off'),node('strong','',state.operations.length?'No matching actions':'No actions available'),node('span','',state.operations.length?'Try a different search or availability filter.':'Hermes returned an empty operation catalog.'));root.append(empty);return}
      const groups=new Map();state.filtered.forEach(operation=>{if(!groups.has(operation.family))groups.set(operation.family,[]);groups.get(operation.family).push(operation)});
      [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).forEach(([family,operations],groupIndex)=>{
        const group=node('section','cc-group');const initiallyOpen=state.openFamilies.has(family)||(!state.openFamilies.size&&groupIndex===0);group.dataset.open=String(initiallyOpen);if(initiallyOpen)state.openFamilies.add(family);
        const toggle=node('button','cc-group-title');toggle.type='button';toggle.setAttribute('aria-expanded',String(initiallyOpen));const label=node('span','',family);const right=node('span','');right.style.display='flex';right.style.alignItems='center';right.style.gap='7px';right.append(node('span','cc-count',String(operations.length)),node('span','material-symbols-outlined','expand_more'));toggle.append(label,right);
        toggle.addEventListener('click',()=>{const open=group.dataset.open!=='true';group.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open));if(open)state.openFamilies.add(family);else state.openFamilies.delete(family)});
        const list=node('div','cc-operations');operations.sort((a,b)=>a.title.localeCompare(b.title)).forEach(operation=>{
          const button=node('button','cc-operation');button.type='button';button.dataset.operationId=operation.id;button.setAttribute('aria-current',String(state.selectedId===operation.id));button.setAttribute('aria-label',`${operation.title}, ${availableLabel(operation)}`);
          const icon=node('span','cc-action-icon');icon.dataset.risk=operation.risk;icon.append(node('span','material-symbols-outlined',isAvailable(operation)?riskIcon(operation):'block'));
          const copy=node('span','cc-op-copy');copy.append(node('span','cc-op-title',operation.title),node('span','cc-op-description',isAvailable(operation)?(operation.description||`${pretty(operation.risk)} risk`):(operation.unavailable_reason||'Not available on this host')));button.append(icon,copy);
          button.addEventListener('click',()=>selectOperation(operation.id));list.append(button);
        });group.append(toggle,list);root.append(group);
      });
    }
    function selectOperation(id){
      clearPolling();state.job=null;state.selectedId=id;const operation=state.operations.find(item=>item.id===id);renderCatalog();renderOperation(operation);if(window.innerWidth<981)el('operationWorkspace').scrollIntoView({behavior:'smooth',block:'start'});
    }

    function rememberJob(value){
      const job=jobOf(value);if(!job||!jobIdOf(job))return;const index=state.jobs.findIndex(item=>jobIdOf(item)===jobIdOf(job));if(index>=0)state.jobs[index]=job;else state.jobs.unshift(job);state.jobs.sort((a,b)=>Number(b.created_at||0)-Number(a.created_at||0));renderJobList();
    }
    function attachJob(job){
      const operation=state.operations.find(item=>item.id===job.operation_id);if(!operation)return;selectOperation(operation.id);state.job=job;renderJob(operation,job);const jobId=jobIdOf(job);if(jobId&&!TERMINAL_STATES.has(statusOf(job)))schedulePoll(operation,jobId,0);
    }
    function renderJobList(){
      const root=el('cliJobList');root.replaceChildren();if(!state.jobs.length){root.append(node('span','cc-job-empty','No advanced-control jobs have run in this signed-in session.'));return}const active=state.jobs.filter(job=>!TERMINAL_STATES.has(statusOf(job))),finished=state.jobs.filter(job=>TERMINAL_STATES.has(statusOf(job))),visible=[...active,...finished].slice(0,12);visible.forEach(job=>{const operation=state.operations.find(item=>item.id===job.operation_id),status=statusOf(job),button=node('button','cc-job-card');button.type='button';button.append(node('span','material-symbols-outlined',TERMINAL_STATES.has(status)?(status==='completed'?'check_circle':'error'):'progress_activity'));const copy=node('span','cc-job-card-copy');copy.append(node('span','cc-job-card-title',operation?.title||pretty(job.command||job.operation_id)),node('span','cc-job-card-meta',`${pretty(status)} · ${job.profile||'default'}`));const badge=node('span','cc-job-status',pretty(status));badge.dataset.state=status;button.append(copy,badge);button.addEventListener('click',()=>attachJob(job));root.append(button)});
    }
    async function loadJobs(silent=false){
      const button=el('refreshJobs');if(button&&!silent)button.disabled=true;try{const response=await fetch(`${API_BASE}/cli-jobs`,{credentials:'same-origin',headers:{Accept:'application/json'}});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Could not load jobs (${response.status}).`));state.jobs=Array.isArray(data.jobs)?data.jobs:[];renderJobList()}catch(error){if(!silent)el('cliJobList').replaceChildren(apiError(`Could not load job history: ${error.message}`))}finally{if(button)button.disabled=false}}

    function fieldDefault(field){return field.default===undefined||field.default===null?'':field.default}
    function inputType(field){
      if(field.sensitive||['password','secret','token'].includes(field.kind))return'password';
      if(['integer','int','number','float'].includes(field.kind))return'number';
      if(['path','file','directory','dir'].includes(field.kind))return'text';
      return'text';
    }
    function choiceValue(choice){return choice&&typeof choice==='object'&&'value'in choice?choice.value:choice}
    function choiceLabel(choice){return choice&&typeof choice==='object'?(choice.label??choice.value):choice}
    function renderField(field,location,index){
      const wrapper=node('label',`cc-field ${field.multiple&&!field.choices.length?'full':''}`);const heading=node('span','cc-field-label');heading.append(node('span','',field.label+(field.required?' *':'')),node('span','cc-field-meta',describeKind(field)));wrapper.append(heading);
      const name=`${location}-${index}-${field.name}`;let input;
      if(['boolean','bool','flag','switch'].includes(field.kind)&&!field.multiple){
        const box=node('span','cc-check');input=document.createElement('input');input.type='checkbox';input.checked=field.default===true;box.append(input,node('span','',field.help||`Enable ${field.label.toLowerCase()}`));wrapper.append(box);
      }else if(field.choices.length){
        input=node('select','cc-select');if(field.multiple){input.multiple=true;input.size=Math.min(6,Math.max(3,field.choices.length))}else if(!field.required){const option=document.createElement('option');option.value='';option.textContent='Use default';input.append(option)}
        field.choices.forEach(choice=>{const option=document.createElement('option');const value=choiceValue(choice);option.value=text(value);option.textContent=text(choiceLabel(choice));if(field.multiple?Array.isArray(field.default)&&field.default.map(text).includes(text(value)):field.default!==undefined&&text(field.default)===text(value))option.selected=true;input.append(option)});wrapper.append(input);
      }else if(field.multiple||['json','object','array','list','multiline','text'].includes(field.kind)){
        input=node('textarea','cc-textarea');input.value=Array.isArray(field.default)?field.default.join('\n'):typeof field.default==='object'&&field.default!==null?JSON.stringify(field.default,null,2):text(fieldDefault(field));input.placeholder=field.multiple?'One value per line':field.kind==='json'||field.kind==='object'?'Valid JSON':'';wrapper.append(input);
      }else{
        input=node('input','cc-input');input.type=inputType(field);if(input.type==='number'&&['integer','int'].includes(field.kind))input.step='1';input.value=text(fieldDefault(field));input.autocomplete=field.sensitive?'new-password':'off';wrapper.append(input);
      }
      input.name=name;input.dataset.fieldName=field.name;input.dataset.location=location;input.dataset.kind=field.kind;input.dataset.required=String(field.required);input.dataset.multiple=String(field.multiple);input.dataset.sensitive=String(field.sensitive);if(field.required&&input.type!=='checkbox')input.required=true;if(field.help&&!(input.type==='checkbox'))wrapper.append(node('span','cc-field-help',field.help));return wrapper;
    }
    function renderFieldSection(title,fields,location){
      const section=node('section','cc-section'),head=node('div','cc-section-head');head.append(node('h3','cc-section-title',title),node('span','cc-required','* required'));const grid=node('div','cc-fields');fields.forEach((field,index)=>grid.append(renderField(field,location,index)));section.append(head,grid);return section;
    }
    function renderOperation(operation){
      const workspace=el('operationWorkspace');workspace.replaceChildren();if(!operation){workspace.append(apiError('This action is no longer in the current Hermes catalog.'));return}
      const form=node('form','');form.id='cliOperationForm';form.noValidate=false;
      const head=node('header','cc-operation-head'),ident=node('div','cc-operation-ident'),icon=node('span','cc-action-icon');icon.dataset.risk=operation.risk;icon.append(node('span','material-symbols-outlined',isAvailable(operation)?riskIcon(operation):'block'));const copy=node('div','');copy.append(node('h2','cc-operation-title',operation.title));if(operation.description)copy.append(node('p','cc-description',operation.description));const tags=node('div','cc-tags');const familyTag=node('span','cc-tag',operation.family),coverageTag=node('span','cc-tag',operation.coverage_label),riskTag=node('span','cc-tag',`${pretty(operation.risk)} risk`),availabilityTag=node('span','cc-tag',availableLabel(operation));riskTag.dataset.risk=operation.risk;tags.append(familyTag,coverageTag,riskTag,availabilityTag);copy.append(tags);ident.append(icon,copy);head.append(ident);form.append(head);
      if(!isAvailable(operation)){const unavailable=node('div','cc-unavailable');unavailable.setAttribute('role','status');unavailable.textContent=operation.unavailable_reason||'This action is not available on the current Hermes host.';form.append(unavailable)}
      const profileSection=node('section','cc-section'),profileHead=node('div','cc-section-head');profileHead.append(node('h3','cc-section-title','Where to run it'));const profileFields=node('div','cc-fields'),profileLabel=node('label','cc-field');const profileTitle=node('span','cc-field-label');profileTitle.append(node('span','','Hermes profile'),node('span','cc-field-meta','optional'));const profileInput=node('input','cc-input');profileInput.id='profileInput';profileInput.name='profile';profileInput.placeholder='Use active profile';profileInput.autocomplete='off';profileLabel.append(profileTitle,profileInput,node('span','cc-field-help','Leave blank to use the active Hermes profile.'));profileFields.append(profileLabel);profileSection.append(profileHead,profileFields);form.append(profileSection);
      if(operation.positionals.length)form.append(renderFieldSection('Required values and targets',operation.positionals,'positionals'));
      if(operation.arguments.length)form.append(renderFieldSection('Options',operation.arguments,'arguments'));
      if(!operation.positionals.length&&!operation.arguments.length)form.append(node('p','cc-section cc-field-help','This action does not need any additional values.'));
      const actions=node('div','cc-actions'),reset=node('button','cc-button ghost','Reset');reset.type='reset';const run=node('button',`cc-button ${isHighRisk(operation)?'danger':'primary'}`);run.type='submit';run.disabled=!isAvailable(operation);run.append(node('span','material-symbols-outlined',isHighRisk(operation)?'warning':'play_arrow'),node('span','',isAvailable(operation)?'Review and run':'Unavailable'));actions.append(reset,run);form.append(actions);
      const details=node('details','cc-operation-details'),summary=node('summary','','Technical CLI details');details.append(summary,node('pre','cc-scroll',[`Operation ID: ${operation.id}`,`Command: ${operation.command||operation.family}`,`Family: ${operation.family}`,`Coverage: ${operation.coverage_label}`,`Risk: ${operation.risk}`,`Interactive: ${operation.interactive?'yes':'no'}`,`Long running: ${operation.long_running?'yes':'no'}`,`Arguments: ${operation.arguments.map(item=>item.name).join(', ')||'none'}`,`Positionals: ${operation.positionals.map(item=>item.name).join(', ')||'none'}`].join('\n')));form.append(details);
      form.addEventListener('submit',event=>{event.preventDefault();form.querySelector('.cc-error')?.remove();if(!form.reportValidity())return;try{openConfirmation(operation,buildPayload(operation,form))}catch(error){showFormError(form,error.message)}});
      form.addEventListener('reset',()=>setTimeout(()=>{renderOperation(operation)},0));workspace.append(form);
    }

    function parseField(input){
      const kind=input.dataset.kind,multiple=input.dataset.multiple==='true',required=input.dataset.required==='true';
      if(input.type==='checkbox')return input.checked;
      if(input.tagName==='SELECT'&&input.multiple){const values=[...input.selectedOptions].map(option=>option.value);if(required&&!values.length)throw new Error(`${input.dataset.fieldName} is required.`);return values.length?values:undefined}
      const raw=input.value.trim();if(!raw){if(required)throw new Error(`${input.dataset.fieldName} is required.`);return undefined}
      if(multiple){if(['json','object','array'].includes(kind)){let value;try{value=JSON.parse(raw)}catch(_){throw new Error(`${input.dataset.fieldName} must be valid JSON.`)}if(!Array.isArray(value))throw new Error(`${input.dataset.fieldName} must be a JSON array.`);return value}return raw.split(/\r?\n/).map(item=>item.trim()).filter(Boolean)}
      if(['integer','int'].includes(kind)){const value=Number(raw);if(!Number.isInteger(value))throw new Error(`${input.dataset.fieldName} must be a whole number.`);return value}
      if(['number','float'].includes(kind)){const value=Number(raw);if(!Number.isFinite(value))throw new Error(`${input.dataset.fieldName} must be a number.`);return value}
      if(['json','object','array'].includes(kind)){try{return JSON.parse(raw)}catch(_){throw new Error(`${input.dataset.fieldName} must be valid JSON.`)}}
      return raw;
    }
    function buildPayload(operation,form){
      const payload={profile:form.elements.profile.value.trim()||null,arguments:{},positionals:{},confirmation:null};
      form.querySelectorAll('[data-location="arguments"]').forEach(input=>{const value=parseField(input);if(value!==undefined)payload.arguments[input.dataset.fieldName]=value});
      form.querySelectorAll('[data-location="positionals"]').forEach(input=>{const value=parseField(input);if(value!==undefined)payload.positionals[input.dataset.fieldName]=value});
      return payload;
    }
    function showFormError(form,message){const error=apiError(message);form.querySelector('.cc-actions').before(error);error.scrollIntoView({behavior:'smooth',block:'nearest'})}

    function requiredPhrase(operation){
      if(typeof operation.confirmation==='string'&&operation.confirmation.trim())return operation.confirmation.trim();
      if(operation.confirmation&&typeof operation.confirmation==='object'){return text(operation.confirmation.phrase||operation.confirmation.value||operation.confirmation.text||operation.confirmation.prompt).trim()}
      if(operation.confirmation===true)return'CONFIRM';
      return isHighRisk(operation)?'CONFIRM':'';
    }
    function openConfirmation(operation,payload){
      state.pending={operation,payload};const body=el('confirmBody');body.replaceChildren();el('confirmTitle').textContent=operation.title;
      const summary=node('dl','cc-confirm-summary');[['Action',operation.title],['Control area',operation.family],['Profile',payload.profile||'Active profile'],['Risk',pretty(operation.risk)]].forEach(([term,value])=>summary.append(node('dt','',term),node('dd','',value)));body.append(summary);
      const suppliedCount=Object.keys(payload.arguments).length+Object.keys(payload.positionals).length;if(suppliedCount)body.append(node('p','cc-field-help',`${suppliedCount} configured ${suppliedCount===1?'value':'values'} will be sent to Hermes. Sensitive values are not displayed here.`));
      const phrase=requiredPhrase(operation),mustType=isHighRisk(operation)||Boolean(phrase);if(mustType){body.append(node('div','cc-warning',operation.unavailable_reason||'This action can make significant changes. Review the target and values before continuing.'));const label=node('label','cc-field'),heading=node('span','cc-field-label');heading.append(node('span','',`Type ${phrase||'CONFIRM'} to continue`),node('span','cc-field-meta','required'));const input=node('input','cc-input');input.id='confirmationInput';input.autocomplete='off';input.spellcheck=false;label.append(heading,input);body.append(label);el('confirmRun').disabled=true;input.addEventListener('input',()=>{el('confirmRun').disabled=input.value!==(phrase||'CONFIRM')});setTimeout(()=>input.focus(),0)}else{el('confirmRun').disabled=false;setTimeout(()=>el('confirmRun').focus(),0)}
      el('confirmRun').className=`cc-button ${isHighRisk(operation)?'danger':'primary'}`;el('confirmRun').textContent=isHighRisk(operation)?'Run high-risk action':'Run action';el('confirmDialog').hidden=false;document.body.style.overflow='hidden';
    }
    function closeConfirmation(){el('confirmDialog').hidden=true;document.body.style.overflow='';state.pending=null}

    async function runOperation(operation,payload){
      const form=el('cliOperationForm');if(!form)return;form.querySelector('.cc-error')?.remove();form.querySelector('.cc-job')?.remove();const runButton=form.querySelector('[type="submit"]');runButton.disabled=true;runButton.textContent='Starting…';
      try{
        const response=await fetch(`${API_BASE}/cli-operations/${safeId(operation.id)}/run`,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Hermes rejected the action (${response.status}).`));const job=jobOf(data),jobId=jobIdOf(job);if(!jobId)throw new Error('Hermes started the action but did not return a job ID.');state.job=job;rememberJob(job);renderJob(operation,job);schedulePoll(operation,jobId,0);
      }catch(error){showFormError(form,error.message)}finally{runButton.disabled=!isAvailable(operation);runButton.replaceChildren(node('span','material-symbols-outlined',isHighRisk(operation)?'warning':'play_arrow'),node('span','',isAvailable(operation)?'Review and run':'Unavailable'))}
    }
    async function readResponse(response){const contentType=response.headers.get('content-type')||'',raw=await response.text();if(!raw)return{};if(contentType.includes('json')){try{return JSON.parse(raw)}catch(_){return{message:raw}}}try{return JSON.parse(raw)}catch(_){return{message:raw}}}
    function errorMessage(data,fallback){const value=data&&(data.detail||data.error||data.message);if(value&&typeof value==='object'){try{return JSON.stringify(value)}catch(_){return fallback}}return text(value||fallback)}
    function schedulePoll(operation,jobId,delay=POLL_INTERVAL){clearPolling();state.pollTimer=setTimeout(()=>pollJob(operation,jobId),delay)}
    async function pollJob(operation,jobId){
      if(state.polling||state.selectedId!==operation.id)return;state.polling=true;
      try{const response=await fetch(`${API_BASE}/cli-jobs/${safeId(jobId)}`,{credentials:'same-origin',headers:{Accept:'application/json'}});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Could not load job status (${response.status}).`));const job=jobOf(data);state.job=job;rememberJob(job);renderJob(operation,job);if(!TERMINAL_STATES.has(statusOf(job))&&state.selectedId===operation.id)schedulePoll(operation,jobId)}
      catch(error){renderJob(operation,state.job||{job_id:jobId,status:'unknown'},{error:error.message});if(state.selectedId===operation.id)schedulePoll(operation,jobId,3000)}finally{state.polling=false}
    }
    async function stopJob(operation,jobId,button){
      button.disabled=true;button.textContent='Stopping…';
      try{const response=await fetch(`${API_BASE}/cli-jobs/${safeId(jobId)}`,{method:'DELETE',credentials:'same-origin',headers:{Accept:'application/json'}});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Hermes could not stop the job (${response.status}).`));state.job=Object.assign({},state.job||{},jobOf(data));rememberJob(state.job);renderJob(operation,state.job);schedulePoll(operation,jobId,300)}catch(error){renderJob(operation,state.job||{job_id:jobId,status:'unknown'},{error:error.message})}
    }
    async function sendJobInput(jobId,input,button){const value=input.value;if(!value)return;button.disabled=true;try{const response=await fetch(`${API_BASE}/cli-jobs/${safeId(jobId)}/input`,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({text:value})});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Hermes rejected the input (${response.status}).`));input.value='';input.focus()}catch(error){const form=el('cliOperationForm');if(form)showFormError(form,error.message)}finally{button.disabled=false}}
    function outputParts(job){
      const output=job&&job.output;let stdout=job&&(job.stdout??job.standard_output),stderr=job&&(job.stderr??job.standard_error);
      if(output&&typeof output==='object'){stdout=stdout??output.stdout??output.output??output.text;stderr=stderr??output.stderr}
      else if(stdout===undefined&&output!==undefined)stdout=output;
      return{stdout:formatOutput(stdout),stderr:formatOutput(stderr)};
    }
    function formatOutput(value){if(value===undefined||value===null)return'';if(Array.isArray(value))return value.map(item=>typeof item==='string'?item:JSON.stringify(item)).join('\n');if(typeof value==='object')return JSON.stringify(value,null,2);return String(value)}
    function bounded(value){const source=text(value);if(source.length<=OUTPUT_LIMIT)return{text:source,truncated:false,omitted:0};return{text:source.slice(-OUTPUT_LIMIT),truncated:true,omitted:source.length-OUTPUT_LIMIT}}
    function redactOutput(value){return text(value).replace(/((?:password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|client[_-]?secret)["'\s:=]+)([^\s,}"']+)/gi,'$1[redacted]').replace(/\b(?:Bearer\s+|Basic\s+|sk-|sk_live_|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9+/_=.-]{8,}/gi,'[redacted]')}
    function renderStream(label,value,className=''){
      const result=bounded(redactOutput(value)),section=node('section','cc-stream'),head=node('div','cc-stream-head');head.append(node('span','',label),node('span','',`${text(value).length.toLocaleString()} chars`));const pre=node('pre',`cc-output cc-scroll ${className}`);if(result.text)pre.textContent=result.text;else{pre.textContent='No output yet.';pre.classList.add('cc-output-empty')}section.append(head,pre);if(result.truncated)section.append(node('div','cc-truncated',`Showing the newest ${OUTPUT_LIMIT.toLocaleString()} characters; ${result.omitted.toLocaleString()} earlier characters are hidden.`));return section;
    }
    function renderJob(operation,value,notice={}){
      const job=jobOf(value)||{};
      const form=el('cliOperationForm');if(!form||state.selectedId!==operation.id)return;form.querySelector('.cc-job')?.remove();const jobId=jobIdOf(job),status=statusOf(job),terminal=TERMINAL_STATES.has(status),section=node('section','cc-job');section.setAttribute('aria-live','polite');
      const head=node('div','cc-job-head'),title=node('div','cc-job-title');title.append(node('span','material-symbols-outlined',terminal?(status==='completed'||status==='success'||status==='succeeded'?'check_circle':'error'):'progress_activity'),node('span','','Job output'),node('span','cc-job-status',pretty(status)));title.lastChild.dataset.state=status;head.append(title,node('span','cc-job-meta',jobId?`Job ${jobId}`:'Job status'));section.append(head);
      const streams=node('div','cc-streams'),parts=outputParts(job);streams.append(renderStream('Standard output',parts.stdout),renderStream('Errors and warnings',parts.stderr,'stderr'));section.append(streams);
      if(jobId&&!terminal&&job.accepts_input){const inputSection=node('div','cc-section'),inputHead=node('div','cc-section-head');inputHead.append(node('h3','cc-section-title','Respond to Hermes'),node('span','cc-field-meta','interactive prompt'));const inputRow=node('div','cc-actions'),input=node('input','cc-input');input.type='password';input.placeholder='Enter the requested response';input.autocomplete='new-password';const send=node('button','cc-button primary','Send response');send.type='button';send.addEventListener('click',()=>sendJobInput(jobId,input,send));input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();send.click()}});inputRow.append(input,send);inputSection.append(inputHead,inputRow);section.append(inputSection)}
      const actions=node('div','cc-job-actions'),message=node('div','cc-job-message',notice.error||(!terminal?'This page updates automatically while the action is running.':'The action has finished.'));actions.append(message);if(jobId&&!terminal){const stop=node('button','cc-button danger');stop.type='button';stop.append(node('span','material-symbols-outlined','stop_circle'),node('span','','Stop job'));stop.addEventListener('click',()=>stopJob(operation,jobId,stop));actions.append(stop)}section.append(actions);
      const technical=node('details','cc-technical'),summary=node('summary','','Technical job details');const safeJob={job_id:jobId||null,status,operation_id:operation.id,family:operation.family,started_at:job.started_at||job.created_at||null,finished_at:job.finished_at||job.completed_at||null,exit_code:job.exit_code??job.return_code??null};technical.append(summary,node('pre','cc-scroll',JSON.stringify(safeJob,null,2)));section.append(technical);form.append(section);
    }

    async function loadOperations(){
      if(state.loading)return;state.loading=true;clearPolling();state.job=null;setStatus('loading','Loading actions…');el('reloadButton').disabled=true;el('operationGroups').replaceChildren(node('div','cc-empty compact','Loading the operation catalog…'));
      try{const response=await fetch(`${API_BASE}/cli-operations`,{credentials:'same-origin',headers:{Accept:'application/json'}});const data=await readResponse(response);if(!response.ok)throw new Error(errorMessage(data,`Could not load actions (${response.status}).`));if(!data||!Array.isArray(data.operations))throw new Error('Hermes returned an invalid operation catalog.');state.operations=data.operations.map(normalizeOperation).filter(operation=>operation.id);renderFilters();applyFilters();const available=state.operations.filter(isAvailable).length;setStatus('ready',`${available} available · ${state.operations.length} total`);if(state.selectedId){const selected=state.operations.find(operation=>operation.id===state.selectedId);if(selected)renderOperation(selected);else{state.selectedId='';renderEmptyWorkspace()}}await loadJobs(true)}
      catch(error){state.operations=[];state.filtered=[];applyFilters();setStatus('error','Actions unavailable');const workspace=el('operationWorkspace');workspace.replaceChildren(apiError(`Could not load the Hermes CLI operation catalog: ${error.message}`))}finally{state.loading=false;el('reloadButton').disabled=false}
    }
    function renderEmptyWorkspace(){const workspace=el('operationWorkspace'),empty=node('div','cc-empty');empty.append(node('span','material-symbols-outlined','terminal'),node('strong','','Choose an advanced action'),node('span','','Select an action on the left to review its safe, typed controls.'));workspace.replaceChildren(empty)}

    el('searchInput').addEventListener('input',applyFilters);el('coverageFilter').addEventListener('change',applyFilters);el('availabilityFilter').addEventListener('change',applyFilters);el('reloadButton').addEventListener('click',loadOperations);el('refreshJobs').addEventListener('click',()=>loadJobs(false));
    el('confirmCancel').addEventListener('click',closeConfirmation);el('confirmClose').addEventListener('click',closeConfirmation);el('confirmDialog').addEventListener('click',event=>{if(event.target===el('confirmDialog'))closeConfirmation()});
    el('confirmRun').addEventListener('click',()=>{const pending=state.pending;if(!pending)return;const input=el('confirmationInput');pending.payload.confirmation=input?input.value:(typeof pending.operation.confirmation==='string'?pending.operation.confirmation:null);closeConfirmation();runOperation(pending.operation,pending.payload)});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('confirmDialog').hidden)closeConfirmation()});window.addEventListener('beforeunload',()=>{clearPolling();if(state.jobsInterval)clearInterval(state.jobsInterval)});
    state.jobsInterval=setInterval(()=>loadJobs(true),5000);loadOperations();
  })();
