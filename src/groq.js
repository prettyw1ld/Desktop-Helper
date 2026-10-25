const MODEL = 'qwen/qwen3.8-27b';
async function completion(settings, messages, extra={}) {
  const key=settings.groqKey || (/groq\.com/.test(settings.sttUrl||'')?settings.sttKey:'');
  if(!key)throw new Error('Добавьте ключ Groq для подключения модели.');
  const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{
    method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},
    body:JSON.stringify({model:settings.groqModel||MODEL,messages,max_completion_tokens:1200,...extra}),
    signal:AbortSignal.timeout(45000),
  });
  if(!res.ok){let error;try{error=(await res.json()).error?.message;}catch{}
    if(res.status===429)throw new Error('Лимит Groq исчерпан. Подождите немного и повторите.');
    throw new Error(error||'Ошибка Groq: '+res.status);
  }
  const msg=(await res.json()).choices?.[0]?.message;
  if(!msg)throw new Error('Groq вернул пустой ответ.');
  return msg;
}
async function vision(settings,{system,text,jpeg,schema}){
  const msg=await completion(settings,[{role:'system',content:system+'\nReturn ONLY valid JSON matching the following schema. The status must be one of step, done, not_found, explain, danger. Required keys: status and say. Schema: '+JSON.stringify(schema)},{role:'user',content:[{type:'text',text},{type:'image_url',image_url:{url:'data:image/jpeg;base64,'+jpeg}}]}],{response_format:{type:'json_object'}});
  const out=JSON.parse(msg.content||'{}');
  if(!out || !['step','done','not_found','explain','danger'].includes(out.status)||typeof out.say!=='string')throw new Error('Groq вернул непонятную подсказку. Повторите запрос.');
  return out;
}
module.exports={completion,vision,MODEL};
