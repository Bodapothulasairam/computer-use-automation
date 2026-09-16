import { brand, documentHtml } from "./ui.js";

const script = `
const token=location.hash.slice(1);
history.replaceState(null,'',location.pathname);
let state=null, pending=true, closed=false, unavailable=false;
const el=id=>document.getElementById(id);
const messages={
 SESSION_EXPIRED:['Session expired','Restore the existing session, then return control to automation.'],
 PERMISSION_DENIED:['Access needs review','An authorized operator must review this session before it can continue.'],
 UNEXPECTED_DIALOG:['Confirmation needs review','Review the available action before continuing this session.'],
 MODEL_STUCK:['Assistance requested','Complete the next available step, then let automation continue.']
};
const api=async(path,data)=>{
 const r=await fetch(path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
 const value=await r.json();
 if(!r.ok)throw new Error(value.code);
 return value;
};
function render(){
 const owned=state?.owner==='human', ready=!!state?.canResume;
 const locked=pending||closed||unavailable;
 el('claim').disabled=locked||state?.owner!=='paused';
 el('resume').disabled=locked||!ready;
 el('abort').disabled=locked||!owned;
 el('abort').hidden=!owned||closed;
 el('claim-copy').textContent=owned?'Control claimed. Automation is paused while you work.':'Claim this session to unlock its recovery action.';
 el('resolve-copy').textContent=ready?'Recovery verified. You can now resume automation.':owned?'Use the available action to resolve this interruption.':'Recovery actions unlock after you claim control.';
 el('resume-copy').textContent=ready?'The expected application state is verified. Return control when ready.':'Resume unlocks after the recovery step is verified.';
 el('owner').textContent=closed?'Handoff complete':owned?'You have control':'Awaiting operator';
 el('owner').className='chip'+(owned?'':' neutral');
 el('instructions').textContent=closed?'Control returned. You may close this window.':pending?'Updating the live session…':ready?'Step 3 of 3 · Resume automation':owned?'Step 2 of 3 · Resolve the interruption':'Step 1 of 3 · Claim control to begin';
 el('instructions').setAttribute('aria-busy',String(pending));
 for(let i=1;i<=3;i++){const current=!closed&&(ready?3:owned?2:1)===i;el('progress-'+i).setAttribute('aria-current',current?'step':'false');el('progress-'+i).className=(closed||i<(ready?3:owned?2:1))?'done':'';}
 if(state){
  const copy=messages[state.reason]||['Session needs attention','Complete the available recovery step before continuing.'];
  if(!closed){el('reason-title').textContent=ready?(state.reason==='SESSION_EXPIRED'?'Session restored':'Recovery verified'):copy[0];el('reason-copy').textContent=ready?'The expected application state is verified. Resume to continue the workflow.':copy[1];}
  el('instructions').parentElement.className='notice'+(ready?' success':'');
  el('session').textContent=state.sessionId;el('step').textContent=state.step;el('screen').textContent=state.observation?.headings?.map(t=>t.name).join(', ')||'State unavailable';
  el('state').textContent=JSON.stringify(state,null,2);
 }
 const controls=el('controls');controls.replaceChildren();
 if(!ready&&!closed){
  for(const target of state?.allowedControls||[]){
   const button=document.createElement('button');button.textContent=target.name;button.disabled=locked||!owned;
   button.onclick=()=>request('/action',{action:{kind:'click',target}});controls.append(button);
  }
  if(state?.canFill){
   const input=document.createElement('input');input.placeholder='5 digits (e.g. 12345)';input.inputMode='numeric';input.maxLength=5;input.setAttribute('aria-label','Member number');input.disabled=locked||!owned;
   const button=document.createElement('button');button.textContent='Fill member number';button.disabled=true;
   input.oninput=()=>{button.disabled=locked||!owned||!/^[0-9]{5}$/.test(input.value);};
   button.onclick=()=>request('/action',{action:{kind:'fill',target:{frame:'workspace',strategy:'table-label',name:'Member number'},parameter:'memberId'},parameters:{memberId:input.value}});
   controls.append(input,button);
  }
  if(!controls.children.length){const p=document.createElement('p');p.textContent='No permitted recovery action is currently available.';controls.append(p);}
 }
 el('error').hidden=!el('error').textContent;
}
async function request(path,data={}){
 if(pending||closed||unavailable)return;
 pending=true;el('error').textContent='';render();
 try{
  await api(path,data);
  if(path==='/resume'||path==='/abort'){
   closed=true;
   el('reason-title').textContent=path==='/resume'?'Automation resumed':'Run stopped';
   el('reason-copy').textContent=path==='/resume'?'The same browser session is continuing from the verified checkpoint.':'This run has ended. No further actions can be taken.';
  }else state=await api('/state');
 }catch(error){el('error').textContent=error.message==='RECOVERY_NOT_VERIFIED'?'Complete the recovery step before resuming.':'The action could not be completed. '+error.message;}
 finally{pending=false;render();if(closed){el('instructions').textContent=path==='/resume'?'Control returned. You may close this window.':'Run stopped. You may close this window.';el('instructions').focus();}}
}
el('claim').onclick=()=>request('/claim');
el('resume').onclick=()=>request('/resume');
el('abort').onclick=()=>request('/abort');
api('/state').then(s=>{state=s;}).catch(()=>{unavailable=true;el('error').textContent='This intervention is unavailable or has expired. Check the active run in your terminal.';}).finally(()=>{pending=false;render();});
`;

export const operatorHtml = documentHtml(
  '<div class="operator-page"><header class="topbar">' +
    brand +
    '<div class="row"><span class="crumb">Operator workspace</span><span class="chip neutral">Live handoff</span></div></header><div class="page-heading"><div><div class="eyebrow">Human assistance</div><h1>Keep the workflow moving.</h1><p>Resolve the interruption and return this session to automation.</p></div><span class="chip neutral" id="owner">Awaiting operator</span></div><main class="operator-card"><ol class="flow" aria-label="Handoff progress"><li id="progress-1" aria-current="step"><span class="num">1</span>Claim control</li><li id="progress-2"><span class="num">2</span>Resolve</li><li id="progress-3"><span class="num">3</span>Resume</li></ol><div class="operator-grid"><section><div class="eyebrow">Intervention</div><h2 id="reason-title">Loading session</h2><p id="reason-copy">Connecting to the paused workflow.</p><div class="notice"><p id="instructions" class="status-copy" role="status" aria-live="polite" tabindex="-1">Loading live session…</p></div><div class="step-card"><div class="step-heading"><span class="step-badge">1</span><h3>Take ownership</h3></div><p id="claim-copy">Claim this session to unlock its recovery action.</p><button id="claim" disabled>Claim control</button></div><div class="step-card"><div class="step-heading"><span class="step-badge">2</span><h3>Resolve the interruption</h3></div><p id="resolve-copy">Recovery actions unlock after you claim control.</p><div id="controls" class="operator-actions"></div></div><div class="step-card"><div class="step-heading"><span class="step-badge">3</span><h3>Return control</h3></div><p id="resume-copy">Resume unlocks after the recovery step is verified.</p><div class="operator-actions"><button id="resume" disabled>Resume automation</button><button id="abort" class="danger" disabled hidden>Abort run</button></div></div><p id="error" class="notice error" role="alert" hidden></p></section><aside class="info-panel"><h3>Session context</h3><dl class="session-meta"><div><dt>Workflow</dt><dd>Member savings balance</dd></div><div><dt>Current screen</dt><dd id="screen">Connecting…</dd></div><div><dt>Paused step</dt><dd id="step">—</dd></div><div><dt>Session ID</dt><dd id="session">—</dd></div></dl><p>Actions use the same live session. Automation waits while you have control.</p></aside></div><details class="debug"><summary>Technical details</summary><pre id="state"></pre></details></main><div class="footer-note">Ledger operator workspace &nbsp;·&nbsp; Field values are excluded from the activity log.</div></div><script>' +
    script +
    "</script>",
  "",
  "Ledger | Operator handoff",
);
