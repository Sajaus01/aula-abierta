export const ENGAGEMENT_PULSE_MS=15_000;
export const ENGAGEMENT_RECENT_MS=60_000;

export function engagementContext(state,hash=''){
 const s=state||{},course=s.currentCourse;
 if(!s.user||s.preview||s.assurance!=='password'||s.user.mustChangePassword||!(s.user.role==='student'||s.viewMode==='learning'))return null;
 if(!/^(curso|actividad|actividades|calificaciones)\//.test(String(hash).replace(/^#/,''))||course?.entityKind!=='group')return null;
 return {userId:s.user.id,courseId:course.id};
}
export function engagementActive({hidden,focused,lastInputAt,at=Date.now()}){
 const gap=at-lastInputAt;
 return !hidden&&focused&&Number.isFinite(lastInputAt)&&gap>=0&&gap<=ENGAGEMENT_RECENT_MS;
}

export function createEngagementTracker({api,getState,environment={}}){
 const win=environment.window||window,doc=environment.document||document,nav=environment.navigator||navigator;
 const clock=environment.clock||Date.now,timer=environment.setInterval||setInterval,uuid=environment.uuid||(()=>crypto.randomUUID());
 const tabId=uuid();let current=null,eventSeq=0,lastInputAt=null,inputOwner=null,lastSentAt=-Infinity,wasActive=false,blocked=null;
 const context=()=>engagementContext(getState(),win.location.hash);
 const active=()=>engagementActive({hidden:doc.hidden,focused:doc.hasFocus(),lastInputAt,at:clock()});
 function send(kind,ctx=current){
  if(!ctx||ctx.userId!==getState().user?.id||nav.onLine===false)return;
  const key=ctx.userId+'|'+ctx.courseId;if(blocked===key&&kind!=='leave')return;
  const isActive=kind!=='leave'&&active(),sequence=++eventSeq;
  if(kind!=='leave'){lastSentAt=clock();wasActive=isActive;}else wasActive=false;
  void api('/learning-activity',{method:'POST',body:{tabId,courseId:ctx.courseId,eventSeq:sequence,kind,active:isActive}}).catch(error=>{
   if(sequence!==eventSeq)return;
   wasActive=false;lastSentAt=-Infinity;
   if([401,403,404].includes(error?.status))blocked=key;
  });
 }
 function leave(){send('leave');wasActive=false;lastSentAt=-Infinity;}
 function enhance(){
  const next=context(),same=next&&current&&next.userId===current.userId&&next.courseId===current.courseId;
  if(same)return;
  if(current&&current.userId===getState().user?.id)leave();
  if(!next||next.userId!==inputOwner){lastInputAt=null;inputOwner=next?.userId||null;blocked=null;}
  current=next;wasActive=false;lastSentAt=-Infinity;
  if(current)send('enter');
 }
 function pulse(){
  const next=context();
  if(!next||!current||next.userId!==current.userId||next.courseId!==current.courseId){enhance();return;}
  if(!active()){
   if(wasActive)leave();
   return;
  }
  if(clock()-lastSentAt>=ENGAGEMENT_PULSE_MS)send('pulse');
 }
 function interaction(event){
  if(!event.isTrusted||doc.hidden||!doc.hasFocus())return;
  const prior=active();lastInputAt=clock();inputOwner=getState().user?.id||null;
  if(current&&!prior){lastSentAt=-Infinity;pulse();}
 }
 // Wheel/touch/keys cover user scrolling. A scroll event alone may also be
 // produced by application code, so it does not establish user interaction.
 for(const type of ['pointerdown','pointermove','keydown','input','wheel','touchmove'])doc.addEventListener(type,interaction,{capture:true,passive:true});
 const resume=()=>{enhance();wasActive=false;lastSentAt=-Infinity;if(current)send('enter');};
 win.addEventListener('blur',leave);win.addEventListener('pagehide',leave);
 win.addEventListener('focus',resume);
 win.addEventListener('offline',()=>{wasActive=false;lastSentAt=-Infinity;});
 win.addEventListener('online',resume);
 doc.addEventListener('visibilitychange',()=>{if(doc.hidden)leave();else resume();});
 timer(pulse,ENGAGEMENT_PULSE_MS);
 return {enhance,leave};
}
