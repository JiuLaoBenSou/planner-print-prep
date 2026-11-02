export function restoreMailer(key:string|undefined,from:string|undefined){
 if(!key||!from)return undefined;
 return async(message:{to:string;url:string})=>{
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({from,to:[message.to],subject:'Restore your Planner Print Prep Plus access',text:`You requested access to Planner Print Prep Plus.\n\nOpen this link on the device you want to use:\n${message.url}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email. Never forward this link.\n\nSupport: fanghong1994@gmail.com`}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Recovery email could not be sent.');
 };
}
