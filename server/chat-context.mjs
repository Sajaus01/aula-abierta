// Context labels and routes are always obtained from current, accessible records.
export function createChatContext({db,fail,supervises,person,permission,removed}){
 const one=(sql,...p)=>db.prepare(sql).get(...p),all=(sql,...p)=>db.prepare(sql).all(...p);
 function resolve(input,auth,c){
  if(!input||typeof input!=='object'||Array.isArray(input)||input.courseId!==c.id)fail(400,'El origen de la pregunta no es válido.');
  for(const key of ['courseId','moduleId','resourceId','quickResourceId','activityId'])if(input[key]!=null&&(typeof input[key]!=='string'||!input[key]||input[key].length>100))fail(400,'El origen de la pregunta no es válido.');
  if([input.resourceId,input.quickResourceId,input.activityId].filter(Boolean).length>1)fail(400,'Selecciona un solo origen para la pregunta.');
  const staff=supervises(auth,c);let module=null,resource=null,quick=null,activity=null,cfg=null;
  const unavailable=()=>fail(404,'El contenido de esta pregunta no está disponible.');
  if(input.resourceId){
   resource=one('SELECT r.*,m.course_id FROM resources r JOIN modules m ON m.id=r.module_id WHERE r.id=? AND m.course_id=?',input.resourceId,c.id);
   if(!resource||!staff&&!resource.published)unavailable();
   module=one('SELECT * FROM modules WHERE id=?',resource.module_id);
  }else if(input.quickResourceId){
   quick=one('SELECT * FROM quick_resources WHERE id=? AND course_id=?',input.quickResourceId,c.id);if(!quick||!staff&&!quick.visible)unavailable();
  }else if(input.activityId){
   activity=one('SELECT * FROM activities WHERE id=? AND course_id=?',input.activityId,c.id);if(!activity)unavailable();
   cfg=JSON.parse(activity.config);
   if(!staff&&(cfg.status!=='published'||cfg.opensAt&&cfg.opensAt>new Date().toISOString()))unavailable();
   if(activity.module_id)module=one('SELECT * FROM modules WHERE id=?',activity.module_id);
  }else if(input.moduleId){module=one('SELECT * FROM modules WHERE id=? AND course_id=?',input.moduleId,c.id);if(!module)unavailable();}
  if(input.moduleId&&(module?.id!==input.moduleId)||module&&(!staff&&!module.published||module.course_id!==c.id))unavailable();
  const base={courseId:c.id,courseTitle:c.title,moduleId:module?.id||null,moduleTitle:module?.title||null};
  if(resource)return {...base,resourceId:resource.id,type:'resource',kind:resource.kind,title:resource.title,href:`#curso/${c.id}?resource=${resource.id}`};
  if(quick)return {...base,quickResourceId:quick.id,type:'resource',kind:quick.kind,title:quick.title,href:`#curso/${c.id}?quickResource=${quick.id}`};
  if(activity)return {...base,activityId:activity.id,type:'activity',kind:cfg.kind,title:cfg.title,href:`#actividad/${activity.id}`};
  if(module)return {...base,type:'module',kind:'module',title:module.title,href:`#curso/${c.id}?module=${module.id}`};
  return {...base,type:'course',kind:'course',title:c.title,href:`#curso/${c.id}`};
 }
 function teachers(auth,c){
  let ids=all("SELECT s.user_id FROM course_staff s JOIN users u ON u.id=s.user_id WHERE s.course_id=? AND u.active=1 AND u.account_status='active' ORDER BY u.name",c.id).map(x=>x.user_id);
  const teaching=ids.filter(id=>person(id,c)?.roles?.includes('teacher'));if(teaching.length)ids=teaching;
  if(!ids.length){const owner=one("SELECT s.owner_id FROM storage_course_limits s JOIN users u ON u.id=s.owner_id WHERE s.course_id=? AND u.active=1 AND u.account_status='active'",c.id)?.owner_id;if(owner)ids=[owner];}
  return ids.filter(id=>id!==auth.user.id).map(id=>{
   const pair=[auth.user.id,id].sort(),existing=one('SELECT * FROM chat_conversations WHERE user_a=? AND user_b=?',...pair),reason=existing&&removed(existing,c)?'El docente retiró esta conversación en este grupo.':permission(c,auth.user.id,id);
   return {...person(id,c),canMessage:!reason,reason,sendGroupId:reason?null:c.id};
  });
 }
 return {resolve,teachers};
}
