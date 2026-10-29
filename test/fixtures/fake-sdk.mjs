import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const notify = (method,params) => send({jsonrpc:'2.0',method,params});
const sessionEvent = (sessionId,type,data) => notify('session.event',{sessionId,event:{type,seq:0,time:Date.now(),data}});
let model, provider, sessionId;
const actualModel = () => model==='wrong-route'||model==='child-route' ? 'fallback' : model;
for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.method==='initialize'){
    provider=m.params.provider; model=m.params.model;
    if(model==='invalid'){send({id:m.id,error:{code:-32602,message:'Unavailable exact model'}});continue}
    send({id:m.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime',version:'fixture'}}});
  }else if(m.method==='session/prompt'){
    if(process.env.RELAY_TEST_COUNT)appendFileSync(process.env.RELAY_TEST_COUNT,'prompt\n');
    sessionId=m.params.sessionId;
    if(model==='no-receipt')continue;
    send({id:m.id,result:{messageId:'receipt-'+sessionId}});
    notify('session.status',{sessionId,status:'running'});
    const childOnlyAttest=model==='child-attest';
    const attestId=childOnlyAttest?sessionId+'-child':sessionId;
    if(childOnlyAttest)notify('subagent.started',{parentSessionId:sessionId,childSessionId:attestId});
    sessionEvent(attestId,'permission/preset',{preset:'workspace-write'});
    sessionEvent(attestId,'sandbox/mode',{mode:model==='danger'?'danger-full-access':'workspace-write'});
    sessionEvent(attestId,'approval/policy',{policy:model==='bad-policy'?'always':'ask'});
    if(model!=='no-route'&&!childOnlyAttest){
      sessionEvent(sessionId,'request/header',{header:{config:{provider,model:actualModel()}},reason:'initial'});
      sessionEvent(sessionId,'request/context',{provider,model:actualModel(),contextWindow:1000000});
    }
    if(model==='child-attest')continue;
    if(model==='child-route'){
      const child=sessionId+'-child';
      notify('subagent.started',{parentSessionId:sessionId,childSessionId:child});
      sessionEvent(child,'request/header',{header:{config:{provider,model:'fallback'}},reason:'initial'});
      continue;
    }
    if(model==='crash'){setTimeout(()=>process.exit(7),20);continue}
    if(model==='hang')continue;
    setTimeout(()=>{
      notify('session.event',{sessionId,event:{type:'tool/call',data:{}}});
      notify('session.event',{sessionId,event:{type:'assistant/message',data:{message:{source:{kind:'model',provider,model:actualModel()},content:[{type:'text',text:model==='waiting'?'Need a decision.\nRELAY_STATUS: waiting_user':'Fixture completed.\nRELAY_STATUS: completed'}]}}}});
      if(model==='idle-first')notify('session.status',{sessionId,status:'idle'});
      notify('session.event',{sessionId,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
      if(model==='idle-first')return;
      notify('session.status',{sessionId,status:'idle'});
    },Number(process.env.RELAY_TEST_DELAY||60));
  }else if(m.method==='shutdown'){send({id:m.id,result:{}});process.exit(0)}
}
