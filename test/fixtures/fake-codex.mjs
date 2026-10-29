import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
for await(const line of createInterface({input:process.stdin})){
  const m=JSON.parse(line);if(!m.id)continue;
  if(process.env.RELAY_TEST_COUNT)appendFileSync(process.env.RELAY_TEST_COUNT,m.method+'\n');
  const result=m.method==='account/rateLimits/read'?{rateLimitsByLimitId:{codex:{primary:{usedPercent:96,windowDurationMins:300}}}}:{};
  process.stdout.write(JSON.stringify({id:m.id,result})+'\n');
}
