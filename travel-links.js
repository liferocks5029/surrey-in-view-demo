'use strict';
(function(root){
  const modes=['walking','driving','transit'];
  function endpoint(value){
    if(typeof value==='string'){
      const clean=value.trim();
      if(!clean||clean.length>200)throw Error('Enter a destination of 1–200 characters.');
      return clean;
    }
    if(!value||!Number.isFinite(value.lat)||!Number.isFinite(value.lon)||Math.abs(value.lat)>90||Math.abs(value.lon)>180)throw Error('Invalid location.');
    return value.lat.toFixed(6)+','+value.lon.toFixed(6);
  }
  function build(origin,destination,mode){
    if(!modes.includes(mode))throw Error('Unsupported travel mode.');
    const url=new URL('https://www.google.com/maps/dir/');
    url.search=new URLSearchParams({api:'1',origin:endpoint(origin),destination:endpoint(destination),travelmode:mode}).toString();
    return url.href;
  }
  const api={build};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SurreyTravel=api;
})(typeof window==='object'?window:globalThis);
