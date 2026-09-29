(function(){
  'use strict';
  const key='surrey-demo-events-v1',allowed=new Set(['project_open','layer_toggle','pilot_area','building_comparison']);
  let events=[];try{events=JSON.parse(sessionStorage.getItem(key)||'[]');if(!Array.isArray(events))events=[];}catch{}
  events=events.filter(e=>e&&allowed.has(e.event)&&typeof e.value==='string').slice(-50);
  function render(){const host=document.getElementById('demo-events-list');if(!host)return;host.replaceChildren();
    for(const event of events.slice(-8).reverse()){const li=document.createElement('li');li.textContent=event.event.replaceAll('_',' ')+' · '+event.value+' · '+new Date(event.time).toLocaleTimeString();host.append(li);}
    document.getElementById('demo-events-count').textContent=events.length+' local events in this tab';
  }
  window.SurreyEvents={record(event,value){if(!allowed.has(event))return;events.push({event,value:String(value).slice(0,80),time:new Date().toISOString()});events=events.slice(-50);try{sessionStorage.setItem(key,JSON.stringify(events));}catch{}render();}};
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('clear-demo-events')?.addEventListener('click',()=>{events=[];try{sessionStorage.removeItem(key);}catch{}render();});
    if(location.hash==='#demo-events')document.getElementById('demo-events').open=true;
    render();
  });
})();
