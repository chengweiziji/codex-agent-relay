const $ = id => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('relay-token');
if (token) sessionStorage.setItem('relay-token', token);
let selected = fragment.get('job') || '';
const setupProject = fragment.get('project') || '';
const settingsRequested = fragment.get('view') === 'settings';
history.replaceState(null, '', location.pathname);
let data, stream, streamJob = '', cursor = 0, reconnectTimer, settingsLoaded = false, addingProject = false;
const names = { preparing:'正在交接',accepted:'对方已接收',running:'Agent 执行中',waiting_user:'等待用户',ended:'执行已结束',failed:'交接或执行失败',cancelled:'已停止',active:'Codex 正在执行',paused:'已暂停',completed:'任务已完成',handed_off:'已交接',handoff_failed:'未能完成交接' };
function showError(e){$('error').hidden=false;$('error').textContent=e.message||String(e)}
async function api(name,input={}){const r=await fetch('/api/'+name,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)});const v=await r.json();if(!r.ok)throw Error(v.error||'连接失败');return v}
function options(select,items,value){select.replaceChildren(...items.map(([id,text])=>{const o=document.createElement('option');o.value=id;o.textContent=text;return o}));select.value=value}
function appendEvent(e){if(e.seq<=cursor)return;cursor=e.seq;const li=document.createElement('li');const time=document.createElement('time');time.textContent=new Date(e.at).toLocaleTimeString()+' · '+e.kind;const p=document.createElement('p');p.textContent=e.text;li.append(time,p);$('events').append(li);$('events').scrollTop=$('events').scrollHeight}
async function connectStream(id){
  stream?.abort();clearTimeout(reconnectTimer);stream=new AbortController();const current=stream;
  try{const r=await fetch('/events?job='+encodeURIComponent(id)+'&after='+cursor,{headers:{Authorization:'Bearer '+token},signal:current.signal});if(!r.ok)throw Error('事件连接失败');$('stream-state').textContent='实时连接';
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let boundary;while((boundary=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const line=frame.split('\n').find(l=>l.startsWith('data: '));if(line)appendEvent(JSON.parse(line.slice(6)));}}
  }catch(e){if(current.signal.aborted)return;$('stream-state').textContent='连接中断，正在重连'}
  if(!current.signal.aborted)reconnectTimer=setTimeout(()=>connectStream(id),1500);
}
async function refresh(){
  try{data=await api('status');$('connection').textContent='● 本地服务已连接';$('error').hidden=true;
    const jobs=[...data.jobs].reverse();if(!jobs.some(j=>j.id===selected))selected=jobs[0]?.id||'';
    options($('jobs'),jobs.length?jobs.map(j=>[j.id,`${names[j.state]} · ${j.config.model} · ${j.checkpoint.goal.slice(0,50)}`]):[['','暂无交接记录']],selected);
    const job=jobs.find(j=>j.id===selected),task=job?data.tasks.find(t=>t.id===job.taskId):data.tasks.at(-1);
    $('state').textContent=names[job?.state||task?.state]||'等待任务';
    $('route').textContent=job?`${job.config.agent} / ${job.config.model}`:task?.checkpoint.goal||'在已配置的项目中开始一个执行任务。';
    $('quota').replaceChildren(document.createTextNode(task?.remainingPercent!=null?task.remainingPercent+'%':'—'),Object.assign(document.createElement('small'),{textContent:task?.remainingPercent!=null?'Codex 剩余':'额度未知'}));
    $('job-detail').hidden=!job;$('empty').hidden=!!job;
    if(job){$('goal').textContent=job.checkpoint.goal;$('metadata').textContent=job.cwd+'\n'+job.id;$('brief').textContent=job.instruction+'\n\n'+JSON.stringify(job.checkpoint,null,2);$('result').textContent=job.error||job.result||'等待接收 Agent 返回结果。';$('verification').textContent=job.verification?'已记录证据 · 未自动验收':(job.reportedComplete?'Agent 自报完成 · 未记录证据':'未记录证据');$('stop').hidden=!['preparing','accepted','running'].includes(job.state);
      document.querySelectorAll('.phase-row span').forEach((s,i)=>s.classList.toggle('reached',i===0||(i===1&&!!job.receipt)||(i===2&&['ended','waiting_user'].includes(job.state))));
      if(streamJob!==job.id){streamJob=job.id;cursor=0;$('events').replaceChildren();connectStream(job.id)}
    }
    const projects=data.projects||[...new Set(data.tasks.map(t=>t.project))];const prev=$('project').value;options($('project'),projects.map(p=>[p,p]),prev||projects[0]);options($('agent'),data.agents.map(a=>[a,a]),$('agent').value);
    $('existing-settings').hidden=!projects.length;$('setup-card').hidden=!!projects.length&&!addingProject;
    if(!settingsLoaded&&(!$('settings-view').hidden||!projects.length)){await openSettings();settingsLoaded=true}
  }catch(e){$('connection').textContent='连接不可用';showError(e)}
}
let configRequest=0, configReady=false, loadedConfigProject='';
const configFields=['agent','provider','model','threshold','bucket','enabled'];
function enableConfigForm(enabled){for(const id of configFields)$(id).disabled=!enabled;$('config-form').querySelector('button[type="submit"]').disabled=!enabled}
async function loadConfig(){
  const project=$('project').value,request=++configRequest;
  configReady=false;loadedConfigProject='';enableConfigForm(false);
  for(const id of ['agent','provider','model'])$(id).value='';
  $('threshold').value=5;$('bucket').value='codex';$('enabled').checked=false;$('saved').textContent='';
  if(!project)return;
  try{
    const c=await api('config',{project});
    if(request!==configRequest||project!==$('project').value)return;
    if(c){$('agent').value=c.agent;$('provider').value=c.provider;$('model').value=c.model;$('threshold').value=c.thresholdPercent;$('bucket').value=c.quotaBucket;$('enabled').checked=c.enabled}
    else $('saved').textContent='此项目尚未批准，或启动配置已变更。请重新选择接收方并确认。Approval missing or revoked. Choose this project’s target again and confirm.';
    loadedConfigProject=project;configReady=true;enableConfigForm(true);
  }catch(e){if(request===configRequest)showError(e)}
}
$('jobs').onchange=()=>{selected=$('jobs').value;refresh()};$('refresh').onclick=refresh;
$('live-tab').onclick=()=>{$('live-view').hidden=false;$('settings-view').hidden=true;$('live-tab').classList.add('selected');$('settings-tab').classList.remove('selected')};
async function openSettings(){
  settingsLoaded=true;
  $('live-view').hidden=true;$('settings-view').hidden=false;$('settings-tab').classList.add('selected');$('live-tab').classList.remove('selected');
  await loadConfig();
  try{const info=await api('setup_info');$('setup-harness').value=info.harnessPath;$('setup-credential').value=info.credentialEnv;if(!$('setup-project').value)$('setup-project').value=setupProject}catch(e){showError(e)}
}
$('settings-tab').onclick=openSettings;$('project').onchange=loadConfig;
$('add-project').onclick=()=>{addingProject=true;$('setup-card').hidden=false;$('setup-project').focus()};
$('setup-form').onsubmit=async e=>{
  e.preventDefault();if(!confirmDisclosure($('setup-project').value,$('setup-agent').value,$('setup-provider').value,$('setup-model').value))return;const button=e.submitter;if(button)button.disabled=true;
  try{
    const result=await api('setup_save',{confirmed:true,project:$('setup-project').value,agent:$('setup-agent').value,harnessPath:$('setup-harness').value,provider:$('setup-provider').value,model:$('setup-model').value,thresholdPercent:Number($('setup-threshold').value),quotaBucket:$('setup-bucket').value,credentialEnv:$('setup-credential').value});
    addingProject=true;
    $('setup-result').textContent='已保存配置。真实自动派发因隔离和模型核验缺口暂停。Saved; real dispatch is blocked pending verified isolation and model identity.'+(result.credentialAvailable===false?' 当前服务未读取到该环境变量，设置后重启服务。Credential variable is missing; set it and restart the service.':'');
    await refresh();$('project').value=result.project;await loadConfig();
  }catch(e){showError(e)}finally{if(button)button.disabled=false}
};
$('config-form').onsubmit=async e=>{e.preventDefault();if(!configReady||loadedConfigProject!==$('project').value){showError(Error('请等待此项目设置加载。Wait for this project’s settings to load.'));return}if(!confirmDisclosure($('project').value,$('agent').value,$('provider').value,$('model').value))return;try{await api('config',{confirmed:true,project:$('project').value,config:{version:1,enabled:$('enabled').checked,agent:$('agent').value,provider:$('provider').value,model:$('model').value,thresholdPercent:Number($('threshold').value),quotaBucket:$('bucket').value}});$('saved').textContent='已保存，下次交接生效。'}catch(e){showError(e)}};
$('stop').onclick=async()=>{if(!confirm('停止当前 Harness 运行？已产生的修改会保留。'))return;try{await api('stop',{jobId:selected});await refresh()}catch(e){showError(e)}};
$('download-result').onclick=()=>{const job=data?.jobs.find(j=>j.id===selected);if(!job)return;const content=['# '+job.checkpoint.goal,'Agent: '+job.config.agent,'Model: '+job.config.model,'Status: '+job.state,job.error||job.result||'No result yet.',job.verification?'Evidence record: '+JSON.stringify(job.verification):'No evidence recorded.'].join('\n\n');const url=URL.createObjectURL(new Blob([content],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='relay-result-'+job.id+'.md';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
if(settingsRequested){$('live-view').hidden=true;$('settings-view').hidden=false}
refresh();setInterval(refresh,3000);

function confirmDisclosure(project,agent,provider,model){return confirm(`确认此项目配置 / Approve project configuration?\n${project}\n${agent} / ${provider} / ${model}\n任务说明、代码和工具输出可能发送到模型服务。保留期限取决于供应商及账户政策，Relay 不保证零保留。\nTask context, code and tool output may leave this computer. Provider retention depends on its policy and your account.\n当前内置接收器尚不能验证目录、网络隔离及实际模型；真实派发保持禁用。\nReceiver isolation and actual model are unverified; real dispatch remains disabled.`)}
