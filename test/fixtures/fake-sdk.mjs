import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const notify = (method,params) => send({jsonrpc:'2.0',method,params});
let model;
for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);
  if(m.method==='initialize'){
    model=m.params.model;
    if(model==='invalid'){send({id:m.id,error:{code:-32602,message:'Unavailable exact model'}});continue}
    send({id:m.id,result:{serverInfo:{name:'deepseek-harness-sdk-runtime',version:'fixture'}}});
  }else if(m.method==='session/prompt'){
    if(process.env.RELAY_TEST_COUNT)appendFileSync(process.env.RELAY_TEST_COUNT,'prompt\n');
    const sessionId=m.params.sessionId;
    if(model==='no-receipt')continue;
    send({id:m.id,result:{messageId:'receipt-'+sessionId}});
    notify('session.status',{sessionId,status:'running'});
    if(model==='crash'){setTimeout(()=>process.exit(7),20);continue}
    if(model==='hang')continue;
    setTimeout(()=>{
      notify('session.event',{sessionId,event:{type:'tool/call',data:{}}});
      notify('session.event',{sessionId,event:{type:'assistant/message',data:{message:{content:[{type:'text',text:model==='waiting'?'Need a decision.\nRELAY_STATUS: waiting_user':'Fixture completed.\nRELAY_STATUS: completed'}]}}}});
      notify('session.event',{sessionId,event:{type:'turn/end',data:{reason:{kind:'completed'}}}});
      notify('session.status',{sessionId,status:'idle'});
    },Number(process.env.RELAY_TEST_DELAY||60));
  }else if(m.method==='shutdown'){send({id:m.id,result:{}});process.exit(0)}
}
