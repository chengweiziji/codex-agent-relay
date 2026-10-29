import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir=join('docs','images');mkdirSync(dir,{recursive:true});
const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
for(const language of ['en','zh'] as const){
  const zh=language==='zh';
  const title=zh?'首次设置':'First-time setup';
  const subtitle=zh?'安装一次，选好接收方；真实派发在隔离与模型核验完成前保持禁用。':'Install once, choose a receiver; real dispatch stays blocked until isolation and model identity are verified.';
  const steps=zh?[
    ['安装插件','下载完整项目并运行安装脚本。','在 Codex 中安装插件，审核并信任 Hooks。'],
    ['选择项目和模型','打开设置页，填写右侧这些字段。','模型由你选择；这里不会发起模型调用。'],
    ['开始聊天','在配置过的项目中正常开始执行任务。','额度接近阈值时保存检查点；真实派发需已核验的适配器。'],
  ]:[
    ['Install the plugin','Download the full project and run the installer.','Install in Codex; review and trust its Hooks.'],
    ['Choose a project and model','Open Settings and fill in the fields shown here.','You choose the model. Saving makes no model call.'],
    ['Start a project chat','Work normally in your configured project.','Near the threshold Codex saves a checkpoint; real dispatch needs a verified adapter.'],
  ];
  const fields=[
    [zh?'项目目录':'Project folder','D:/work/my-project'],
    [zh?'接收 Agent':'Receiving Agent','DeepSeek Harness'],
    [zh?'Harness 安装目录':'Harness installation folder','D:/Apps/DeepSeek-Harness-App'],
    ['Provider','deepseek-official'],
    [zh?'模型 — 由你填写':'Model — your choice',zh?'填写可用的模型 ID':'Enter an available model ID'],
    [zh?'剩余阈值':'Remaining quota threshold','5%'],
  ];
  const text=(x:number,y:number,value:string,size=16,fill='#24292f',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${escape(value)}</text>`;
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="960" viewBox="0 0 1200 960" role="img" aria-labelledby="title desc"><title id="title">${title}</title><desc id="desc">${zh?'首次设置示意图，显示安装、选择模型、交接准备三个步骤。':'Setup guide showing installation, model selection, and handoff preparation.'}</desc><rect width="1200" height="960" rx="12" fill="#ffffff"/><g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif">`,text(48,58,'CODEX AGENT RELAY',14,'#57606a',600),text(48,102,title,30,'#24292f',650),text(48,139,subtitle,17,'#57606a'),'<path d="M48 165H1152" stroke="#d0d7de"/>'];
  steps.forEach((step,i)=>{
    const y=220+i*180;
    parts.push(`<rect x="48" y="${y-24}" width="32" height="32" rx="6" fill="#0969da"/>`,text(58,y-1,String(i+1),18,'white',600),text(96,y,step[0]!,21,'#24292f',600),text(96,y+37,step[1]!,15,'#57606a'),text(96,y+65,step[2]!,15,'#57606a'));
  });
  parts.push('<rect x="610" y="195" width="542" height="646" rx="10" fill="#f6f8fa" stroke="#d0d7de"/>',text(636,231,zh?'设置 / 首次设置':'Settings / First-time setup',17,'#24292f',600),'<path d="M610 252H1152" stroke="#d0d7de"/>');
  fields.forEach(([label,value],i)=>{
    const y=282+i*77;
    parts.push(text(636,y,label!,13,'#57606a',500),`<rect x="636" y="${y+10}" width="490" height="38" rx="5" fill="white" stroke="${i===4?'#0969da':'#d0d7de'}"/>`,text(650,y+35,value!,15,i===4?'#6e7781':'#24292f'));
  });
  parts.push(text(636,766,zh?'凭证：环境变量名或 Harness 已有凭证':'Credentials: environment name or existing Harness login',13,'#57606a'),'<rect x="636" y="785" width="230" height="36" rx="5" fill="#0969da"/>',text(652,809,zh?'保存并启用此项目':'Save and enable project',15,'#fff',600),'<path d="M48 869H1152" stroke="#d0d7de"/>',text(48,902,zh?'以后换模型：设置 → 选择项目 → 修改 Agent / Provider / 模型 → 保存。':'Change the model later: Settings → project → Agent / Provider / Model → Save.',17,'#24292f',500),text(48,932,zh?'说明图，使用示例路径。内置适配器暂不派发真实任务；其他 Agent 需要另加适配器。':'Illustration with example paths. The bundled adapter does not dispatch real tasks; other Agents need an adapter.',13,'#6e7781'),'</g></svg>');
  writeFileSync(join(dir,`first-run-${language}.svg`),parts.join('\n'));
}
console.log('Wrote docs/images/first-run-en.svg and first-run-zh.svg');
