import test from 'node:test';
import assert from 'node:assert/strict';
import {browserNotificationCandidates,courseInitials,decodePushKey,mergeNotificationItems,notificationGroups,notificationHref,parseCourseDeepLink} from '../public/notifications.js';
import {courseHelpContextLabel,courseHelpDescriptor} from '../public/course-help.js';
import {createArrivalSoundGate} from '../public/notification-sound.js';

test('notification links remain inside known application routes',()=>{
 assert.equal(notificationHref('#curso/course?resource=material'),'#curso/course?resource=material');
 for(const value of ['https://example.com','#unknown/a','javascript:alert(1)','#curso/x\nscript','#curso/x\"'])assert.equal(notificationHref(value),'#notificaciones');
 assert.equal(courseInitials('  Simulación aplicada  '),'SA');
});
test('course deep links preserve the course id while accepting material and chapter aliases',()=>{
 assert.deepEqual(parseCourseDeepLink('curso/course?resource=r&module=m&quickResource=q'),{courseId:'course',resourceId:'r',moduleId:'m',quickResourceId:'q'});
 assert.equal(parseCourseDeepLink('curso/course?material=r&capitulo=m').resourceId,'r');
 assert.equal(parseCourseDeepLink('curso/course?material=r&capitulo=m').moduleId,'m');
 assert.equal(parseCourseDeepLink('actividad/x'),null);
});
test('poll snapshots deduplicate read state and do not alert for initial or read history',()=>{
 const first={id:1,read:false,course:{id:'a'}},updated={...first,read:true},second={id:2,read:false,course:{id:'a'}},other={id:3,readAt:'date',course:{id:'b'}};
 assert.deepEqual(mergeNotificationItems([first],[updated,second]),[second,updated]);
 assert.deepEqual(browserNotificationCandidates([first,second,other],1),[second]);
 assert.equal(notificationGroups([first,second,other]).length,2);
 assert.deepEqual(mergeNotificationItems([{id:'event-1'}],[{id:'event-2'}]).map(item=>item.id),['event-2','event-1']);
 assert.deepEqual([...decodePushKey('AAEC_w')],[0,1,2,255]);
});
const state={user:{id:'student',role:'student',roles:['student']},assurance:'password',currentCourse:{id:'course',entityKind:'group',modules:[{id:'chapter',resources:[{id:'material'}]}],quickResources:[{id:'quick'}]}};
test('teacher help selects trusted identifiers for materials, quick resources and activity attachments',()=>{
 assert.deepEqual(courseHelpDescriptor({...state,activeResourceId:'material'},'curso/course'),{courseId:'course',resourceId:'material'});
 assert.deepEqual(courseHelpDescriptor({...state,activeResourceId:'quick'},'curso/course'),{courseId:'course',quickResourceId:'quick'});
 assert.deepEqual(courseHelpDescriptor({...state,activeResourceId:'academic-file-a'},'actividad/activity'),{courseId:'course',activityId:'activity'});
 assert.deepEqual(courseHelpDescriptor(state,'curso/course?module=chapter'),{courseId:'course',moduleId:'chapter'});
 assert.equal(courseHelpDescriptor({...state,preview:'course'},'curso/course'),null);
 assert.equal(courseHelpDescriptor({...state,assurance:'document'},'curso/course'),null);
 assert.equal(courseHelpDescriptor({...state,user:{roles:['teacher'],role:'admin'}},'curso/course'),null);
 assert.equal(courseHelpDescriptor(state,'mensajes'),null);
 assert.equal(courseHelpContextLabel({courseTitle:'Circuitos',moduleTitle:'RC',title:'RC',type:'module'}),'Circuitos › RC');
});
test('arrival sound gate ignores history before activation and deduplicates throttled bursts',()=>{
 let time=10000;const gate=createArrivalSoundGate({now:()=>time});
 assert.equal(gate.accept('before',{ready:false}),false);
 assert.equal(gate.accept('before'),false);
 assert.equal(gate.accept('new'),true);
 assert.equal(gate.accept('new'),false);
 assert.equal(gate.accept('burst'),false);
 time+=2100;assert.equal(gate.accept('after'),true);
 time+=2100;assert.equal(gate.accept('muted',{enabled:false}),false);
 assert.equal(gate.accept('recording',{suppressed:true}),false);
 gate.remember('other-tab');assert.equal(gate.accept('other-tab'),false);
});
