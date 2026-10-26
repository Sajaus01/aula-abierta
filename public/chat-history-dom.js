// Keep existing audio elements connected while new messages and receipts arrive.
// Replacing the history HTML would interrupt playback every time the chat polls.
export function syncChatHistory(current,next){
 const key=node=>node.nodeType===1?(node.hasAttribute('data-message')?'message:'+node.getAttribute('data-message'):node.classList.contains('chat-day')?'day:'+node.textContent:null):null;
 function sync(target,source){
  if(target.nodeType===3){if(target.data!==source.data)target.data=source.data;return;}
  for(const attribute of [...target.attributes])if(!source.hasAttribute(attribute.name)&&!(target.tagName==='DETAILS'&&attribute.name==='open'))target.removeAttribute(attribute.name);
  for(const attribute of [...source.attributes])if(target.getAttribute(attribute.name)!==attribute.value)target.setAttribute(attribute.name,attribute.value);
  const existing=[...target.childNodes],used=new Set();let cursor=target.firstChild;
  for(const child of [...source.childNodes]){
   const id=key(child);let match=id?existing.find(node=>!used.has(node)&&key(node)===id):existing.find(node=>!used.has(node)&&!key(node)&&node.nodeType===child.nodeType&&node.nodeName===child.nodeName&&(node.nodeType!==1||node.className===child.className));
   if(!match){match=child.cloneNode(true);target.insertBefore(match,cursor);}else{used.add(match);if(match!==cursor)target.insertBefore(match,cursor);sync(match,child);}
   cursor=match.nextSibling;
  }
  for(const node of existing)if(!used.has(node)&&node.parentNode===target)node.remove();
 }
 sync(current,next);
}

export function updateChatWindow(node,html,{preserveComposer=false}={}){
 const oldLog=node.querySelector('.chat-messages');
 if(!oldLog){node.innerHTML=html;return;}
 const shell=node.ownerDocument.createElement('div');shell.innerHTML=html;
 node.querySelector('.chat-window-head').replaceWith(shell.querySelector('.chat-window-head'));
 const content=node.querySelector('.chat-window-content'),next=shell.querySelector('.chat-window-content'),composer=preserveComposer&&content.querySelector('.chat-compose');
 syncChatHistory(oldLog,next.querySelector('.chat-messages'));
 const desired=[...next.children].map(child=>child.matches('.chat-messages')?oldLog:composer&&child.matches('.chat-compose')?composer:child);
 for(const child of [...content.children])if(!desired.includes(child))child.remove();
 let cursor=content.firstChild;
 for(const child of desired){if(child!==cursor)content.insertBefore(child,cursor);cursor=child.nextSibling;}
}
