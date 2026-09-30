'use strict';
// Public source snapshots only. Application polygons are not building footprints.
const $=id=>document.getElementById(id);
const radians=Math.PI/180;
const distance=(a,b)=>{const h=Math.sin((b.lat-a.lat)*radians/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin((b.lon-a.lon)*radians/2)**2;return 12742017.6*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));};
const formatDistance=m=>m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m';
const configs=[
 {id:'existing-buildings',title:'Existing buildings · 3D',color:'#a3b4a9',kind:'buildings',remote:true,source:'https://gisservices.surrey.ca/arcgis/rest/services/OpenData/MapServer/155',fields:[['NAME','Name'],['LOCATION','Location'],['BUILDING_HEIGHT','Published height (m)'],['STATUS','Published status'],['FACILITY_TYPE','Building type']]},
 {id:'proposed-buildings',title:'Proposed buildings · sample 3D',color:'#d89a49',kind:'proposed',fields:[['name','Building part'],['project_no','Application'],['storeys','Published storeys'],['height_m','Model height (m)'],['height_basis','Height basis'],['footprint_basis','Footprint basis'],['model_note','Model note']]},
 {id:'developments',title:'Application sites',color:'#668976',kind:'polygon',fields:[['PROJECT_NO','Application'],['STATUS','Status'],['DESCRIPTION','Description']]},
 {id:'bus-routes',title:'Bus routes',color:'#c48147',kind:'line',width:2,fields:[['ROUTE_NO','Route'],['ROUTE_NAME','Route name'],['SERVICE_TYPE','Service type']]},
 {id:'bus-stops',title:'Active bus stops',color:'#b4773b',kind:'point',size:5,minScale:30000,fields:[['LOCATION','Location'],['BUS_STOP_NO','Stop number'],['TRANSIT_ROUTES','Routes'],['STOP_STATUS','Status'],['ACCESSIBLE','Accessible'],['BUS_SHELTERS','Shelter']]},
 {id:'bike-routes',title:'Cycling routes',color:'#52a08a',kind:'line',width:1.8,fields:[['BIKE_INFRASTRUCTURE_TYPE','Infrastructure'],['ROUTE_TYPE2','Route type'],['STATUS','Status'],['MATERIAL','Surface']]},
 {id:'skytrain-routes',title:'SkyTrain line',color:'#4768c5',kind:'line',width:4,fields:[['LINEABBR','Line']]},
 {id:'skytrain-stations',title:'SkyTrain stations',color:'#294bb0',kind:'point',size:12,fields:[['PL_NAME','Station']]},
 {id:'truck-routes',title:'Truck routes & restrictions',color:'#576e82',kind:'truck',source:'https://gisservices.surrey.ca/arcgis/rest/services/OpenData/MapServer/117',fields:[['ROAD_NAME','Road'],['TRUCK_ROUTE','Route designation'],['STATUS','Published status'],['RD_CLASS','Road class'],['MAJOR_ROAD_NETWORK','Major road network']]},
 {id:'bike-parking',title:'Bike racks / parking',color:'#934697',kind:'point',size:7,minScale:30000,fields:[['BIKE_RACK_TYPE','Parking type'],['ADDRESS','Address'],['CAPACITY','Capacity'],['OWNER','Owner'],['COMMENTS','Notes']]}
];
const areas={centre:{lon:-122.8484,lat:49.1887,scale:14500},surrey:{lon:-122.797,lat:49.113,scale:175000},fleetwood:{lon:-122.780,lat:49.163,scale:17000},campbell:{lon:-122.696,lat:49.059,scale:35000},newton:{lon:-122.842,lat:49.132,scale:21000},cloverdale:{lon:-122.732,lat:49.105,scale:19000},guildford:{lon:-122.804,lat:49.188,scale:18000}};
configs.push(
 {id:'destinations',title:'Nearby places',color:'#8157aa',kind:'point',size:13,fields:[['NAME','Destination'],['ADDRESS','Address'],['CATEGORY','Type'],['SERVICE_NOTE','Service details'],['CHECKED_DATE','Source checked'],['LOCATION_BASIS','Location basis']]},
 {id:'parks',title:'Parks',color:'#33866c',kind:'polygon',fields:[['PARK_NAME','Park'],['LOCATION','Location'],['AMENITY_CLASS','Type'],['STATUS','Published status']]},
 {id:'outdoor-recreation',title:'Outdoor recreation',color:'#b97734',kind:'polygon',fields:[['DESCRIPTION','Facility'],['PARK','Park'],['OUTDOOR_REC_FAC_TYPE2','Facility type'],['COURT_TYPE','Court type'],['COMMUNITY','Community'],['STATUS','Published status']]},
 {id:'playgrounds',title:'Playgrounds',color:'#9d6399',kind:'polygon',fields:[['DESCRIPTION','Playground'],['PARK','Park'],['PLAYGROUND_TYPE','Type'],['TARGET_AGE_GROUP','Age group'],['COMMUNITY','Community']]}
);
const data={},layers={};let applications=[],matches=[],selected=null,limit=60,view,Graphic,Polygon,Point,measureLayer,selectionLayer,ready=false,measuring=false,measurePoints=[],manifest,developmentSource,amenitySource,projectMarkers,routeDestinationMarker;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let browse='developments',transportMatches=[],featuredOnly=true,pilotFilter='surrey',renderingDependencyFailed=false,showProposals=true;
const initiallyVisible=new Set(['existing-buildings','proposed-buildings','skytrain-routes','skytrain-stations']);
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function safeLink(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function link(label,url){const a=el('a',label);const href=safeLink(url);if(!href)return null;a.href=href;a.target='_blank';a.rel='noopener';a.setAttribute('aria-label',label.replace(/\s*↗$/, '')+', opens in a new tab');return a;}
function centre(feature){let b=feature.bbox;if(!b){const points=[];function walk(c){if(typeof c[0]==='number')points.push(c);else c.forEach(walk);}walk(feature.geometry.coordinates);b=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}return {lon:(b[0]+b[2])/2,lat:(b[1]+b[3])/2};}
function nearest(p,key){let result=null;for(const feature of data[key]?.features||[]){const q={lon:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1]};const metres=distance(p,q);if(!result||metres<result.metres)result={feature,...q,metres};}return result;}
function mode(top){$('view-top').classList.toggle('active',top);$('view-top').setAttribute('aria-pressed',String(top));$('view-3d').classList.toggle('active',!top);$('view-3d').setAttribute('aria-pressed',String(!top));}
async function move(target){try{await view.goTo(target,{animate:!reduced,duration:650});}catch(e){if(e.name!=='AbortError')console.warn(e);}}
function setStatus(text){$('status').textContent=text;}
function drawList(){
 if(browse!=='developments'){drawTransportList();return;}
 $('projects').replaceChildren();$('count').textContent=matches.length.toLocaleString();$('list-announcement').textContent=matches.length.toLocaleString()+' matching projects';
 for(const p of matches.slice(0,limit)){
  const models=projectModels(p.number),info=profile(p),area=projectArea(p);
  const b=el('button',undefined,'project-card');b.dataset.application=p.id;
  if(area)b.append(el('small',area,'area-label'));
  b.append(el('strong',projectTitle(p)),el('small',p.status));
  b.append(el('span',p.raw.STAFF_EDITED?p.description:info.headline||(p.raw.STAFF_ADDED?'Staff-added location pin':p.description),'excerpt'));
  b.addEventListener('click',()=>models.length?selectModelProject(p.number):select(p,true));$('projects').append(b);
 }
 if(!matches.length)$('projects').append(el('p','No matches. Try another search or show all 3D projects.','secondary'));
 $('load-more').hidden=limit>=matches.length;
}
let filterTimer;
function filter(){const q=$('search').value.trim().toLowerCase(),status=$('status-filter').value;limit=60;if(browse!=='developments'){transportMatches=(data[browse]?.features||[]).filter(f=>!q||Object.values(f.properties).join(' ').toLowerCase().includes(q));drawList();return;}matches=applications.filter(p=>(!featuredOnly||q||isFeatured(p))&&(!featuredOnly||q||inPilot(p))&&(!status||p.status===status)&&(!q||(p.number+' '+p.name+' '+p.description+' '+p.status+' '+JSON.stringify(profile(p))).toLowerCase().includes(q)));if(featuredOnly)matches.sort((a,b)=>(profile(b).residential_units||0)-(profile(a).residential_units||0));drawList();if(layers.developments){layers.developments.definitionExpression=matches.length===applications.length?'1=1':matches.length?'OBJECTID IN ('+matches.map(p=>p.id).join(',')+')':'1=0';}if(projectMarkers){const ids=new Set(matches.map(p=>p.id));projectMarkers.graphics.forEach(g=>g.visible=ids.has(g.attributes.OBJECTID));}if(selected&&!matches.includes(selected)){$('browse-panel').hidden=false;$('detail').hidden=true;$('project-map-card').hidden=true;selectionLayer?.removeAll();selected=null;invalidateRoutes();cancelPicking();stopAddressSearch();updateDestinationLayer();}}
function drawTransportList(){const config=configs.find(c=>c.id===browse);$('projects').replaceChildren();$('count').textContent=transportMatches.length.toLocaleString()+' records';$('list-announcement').textContent=transportMatches.length.toLocaleString()+' matching places or routes';for(const feature of transportMatches.slice(0,limit)){const p=feature.properties,b=el('button',undefined,'project-card'),body=el('span');let title=p.NAME||p.PARK_NAME||p.DESCRIPTION||p.PL_NAME||p.LOCATION||p.ADDRESS||p.BIKE_INFRASTRUCTURE_TYPE||config.title;if(p.ROUTE_NO)title='Bus '+p.ROUTE_NO+' · '+p.ROUTE_NAME;body.append(el('strong',title));body.append(el('small',config.fields.map(([key])=>p[key]).filter(v=>v!==null&&v!==undefined&&v!=='').join(' · '),'excerpt'));b.append(body);b.addEventListener('click',()=>{showFeature(config,p);const target=feature.geometry.type==='Point'?{lon:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1]}:centre(feature);if(ready)move({target:[target.lon,target.lat],scale:config.kind==='point'?5000:22000,tilt:20,heading:0});});$('projects').append(b);}if(!transportMatches.length)$('projects').append(el('p','No matching records.','no-results'));$('load-more').hidden=limit>=transportMatches.length;}
function updateScope(){
 if(!featuredOnly){pilotFilter='surrey';$('area').value='surrey';}
 $('area').disabled=!featuredOnly||browse!=='developments';areaContext();
 $('scope-examples').setAttribute('aria-pressed',String(featuredOnly));$('scope-all').setAttribute('aria-pressed',String(!featuredOnly));
 $('list-title').textContent=browse==='developments'?(featuredOnly?'Featured projects':'All 3D projects'):configs.find(c=>c.id===browse).title;
 $('model-count').hidden=!featuredOnly||browse!=='developments';
 $('list-note').textContent=browse==='developments'?(featuredOnly?pilotFilter==='surrey'?'Public-source projects.':'Public-source projects in this area.':'Public-source 3D projects.'):'Select a place to see its location.';
}
for(const [id,value] of [['scope-examples',true],['scope-all',false]])$(id).addEventListener('click',()=>{featuredOnly=value;$('browse-data').value='developments';$('browse-data').dispatchEvent(new Event('change'));});
$('browse-data').addEventListener('change',()=>{
 browse=$('browse-data').value;$('search').value='';$('status-filter').disabled=browse!=='developments';closeProject();$('feature-info').hidden=true;
 $('search').placeholder=browse==='developments'?'Find a development by name or address':'Search places or routes';document.querySelector('label[for="search"]').textContent=browse==='developments'?'Find a development':'Find a place or route';updateScope();filter();
});
function profile(p){return data['project-profiles']?.profiles?.[p.number]||{};}
function isFeatured(p){return profile(p).featured===true||projectModels(p.number).length>0||p.raw.STAFF_ADDED;}
function projectArea(p){return projectModels(p.number)[0]?.properties.area||profile(p).area||'';}
function profileSourceLabel(info){return info.source_label||(info.source_kind==='application'?'Application record':'Planning report');}
function projectTitle(p){return p.name||profile(p).title||projectModels(p.number).find(f=>f.properties.component==='building')?.properties.name||'Application '+p.number;}
function inPilot(p){
 if(pilotFilter==='surrey')return true;
 const area=projectArea(p).toLowerCase();
 return pilotFilter==='centre'?area==='city centre':pilotFilter==='campbell'?area.includes('campbell'):area===pilotFilter;
}
function areaContext(){
 const text={surrey:'City Centre, Guildford, Fleetwood and Campbell Heights.',centre:'Explore mixed-use proposals alongside the existing SkyTrain line, City Hall and SFU Surrey.',fleetwood:'Explore the submitted tower proposal and its surrounding transport and amenities.',guildford:'Explore residential proposals around Guildford Town Centre.',campbell:'Explore industrial proposals in Campbell Heights and South Campbell Heights.'};
 $('area-context').textContent=text[$('area').value];
}
function renderProjectOverview(p){
 const info=profile(p);
 $('project-area').textContent=[projectArea(p),info.use].filter(Boolean).join(' · ');
 $('project-area').hidden=!$('project-area').textContent;
 $('project-address').textContent=info.address||'';$('project-address').hidden=!info.address;
 $('project-summary').textContent=p.raw.STAFF_EDITED?p.description:(info.headline||info.summary||p.description||'');
 $('application-reference').textContent='Application '+p.number;
 $('detail-description').textContent=p.raw.STAFF_EDITED?p.description:(info.summary||p.description||'');
 const snapshot=developmentSource?.fetchedAt?.slice(0,10)||'source manifest';
 $('profile-provenance').textContent=(p.raw.STAFF_EDITED?'Details from the published local staff revision.':'Application status snapshot: '+snapshot+'.')+(info.source_date?' '+(info.source_date_label||profileSourceLabel(info))+': '+info.source_date+'.':'');
 $('profile-caution').textContent=info.status_note||'';$('profile-caution').hidden=!info.status_note;
 $('proposal-note').textContent=p.number==='23-0085-00'?'Design changes requested.':p.number==='22-0152-00'?'Showing the Lot C building only.':'';
 $('proposal-note').hidden=!$('proposal-note').textContent;
 $('fit-project').hidden=false;
 if(info.source_url){const report=link(profileSourceLabel(info)+' ↗',info.source_url);if(report)$('source-links').append(report);}
}
$('project-details-link').addEventListener('click',()=>{$('detail').open=true;$('detail').scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});$('detail').querySelector('summary').focus();});
function projectModels(number){return (data['proposed-buildings']?.features||[]).filter(f=>f.properties.project_no===number);}
function projectModelSummary(p){
 const buildings=projectModels(p.number).filter(f=>f.properties.component==='building').map(f=>f.properties);
 if(!buildings.length)return p.raw.STAFF_ADDED?'Staff-added location · No 3D model':'';
 if(buildings.length===1){const b=buildings[0];return (b.storeys&&profile(p).use!=='Industrial'?b.storeys+' storeys · ':'')+b.height_m+' m tall · Approximate shape';}
 const floors=buildings.map(b=>b.storeys).filter(Number.isFinite),heights=buildings.map(b=>b.height_m).filter(Number.isFinite);
 const storeys=floors.length?Math.min(...floors)+(Math.min(...floors)===Math.max(...floors)?'':'–'+Math.max(...floors))+' storeys':'';
 return [buildings.length+' buildings',storeys,heights.length?'Up to '+Math.max(...heights)+' m':'','Approximate shapes'].filter(Boolean).join(' · ');
}
function renderModelDetails(p){
 const host=$('model-detail');host.replaceChildren();const models=projectModels(p.number);host.hidden=!models.length;document.querySelector('.geometry-note').textContent=p.raw.STAFF_ADDED?'Staff-added location pin. No site boundary or 3D model has been supplied.':models.length?'Outline = application area. Gold shapes = approximate proposed-building samples; dimensions and sources are shown on the map card.':'Outline = application area, not a building footprint. Verified heights are not in this application dataset.';
 if(!models.length)return;
 host.append(el('summary','Building dimensions & sources'));host.open=false;
 const list=el('ul');
 for(const f of models){const a=f.properties,li=el('li');li.append(el('strong',a.name),el('span',(a.storeys?a.storeys+' storeys · ':'')+a.height_m+' m model height'));
 const notes=el('details'),summary=el('summary','Dimensions & source');notes.append(summary,el('p',a.height_basis),el('p',a.footprint_basis));
 if(a.area)notes.append(el('p','Pilot area: '+a.area));
 for(const [field,label] of [['commercial_size_m2','Commercial floor area'],['industrial_size_m2','Industrial floor area'],['total_floor_area_m2','Total floor area']])if(a[field])notes.append(el('p',label+': '+a[field].toLocaleString()+' m² (proposed project total, not available leasing space)'));
 if(a.area_basis)notes.append(el('p',a.area_basis));
 if(a.model_note)notes.append(el('p',a.model_note));const source=link('City source ↗',a.source_url);if(source)notes.append(source);li.append(notes);list.append(li);}
 host.append(list,el('p','Simple massing for the demo. Not construction drawings or the City-selected RFP dataset.','model-caveat'));
}
function selectModelProject(number){
 const p=applications.find(p=>p.number===number);if(!ready||!p)return;
 browse='developments';$('browse-data').value='developments';$('status-filter').disabled=false;
 if(!matches.includes(p)){featuredOnly=true;pilotFilter='surrey';$('area').value='surrey';$('search').value='';$('status-filter').value='';}
 closeProject();updateScope();filter();
 setScenario(true);
 select(p,false);mode(false);$('layers-panel').open=false;
 frameProject();
 if(innerWidth<700)$('project-map-card').scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});
}
function renderModelProjects(){
 const features=data['proposed-buildings']?.features||[],numbers=[...new Set(features.map(f=>f.properties.project_no))];
 $('model-count').textContent=numbers.length+' projects with 3D models';
 $('show-models').disabled=!numbers.length;$('show-models').onclick=()=>{if(numbers.length)selectModelProject(numbers[0]);};
}
function select(p,fly){if(ready)setScenario(true);if(layers['truck-routes']){const industrial=profile(p).use==='Industrial';layers['truck-routes'].visible=industrial;$('layer-truck-routes').checked=industrial;}SurreyEvents.record('project_open',p.number);renderModelDetails(p);renderNearby(p);stopAddressSearch();cancelPicking();clearMeasure();selected=p;connectionVisible=false;if(['nearest','nearest-bus'].includes($('travel-destination').value)||($('travel-destination').value==='custom'&&!resolvedDestination))$('travel-destination').value=profile(p).use==='Industrial'?'nearest-bus':'nearest';$('browse-panel').hidden=true;$('project-map-card').hidden=false;updateDestinationLayer();document.querySelector('.sidebar').scrollTop=0;$('feature-info').hidden=true;$('map-project-title').textContent=projectTitle(p);$('model-summary').textContent=projectModelSummary(p);$('model-summary').hidden=!$('model-summary').textContent;$('map-project-status').textContent=p.status;$('map-project-description').textContent=p.description;$('map-project-links').replaceChildren();const official=link(p.raw.STAFF_EDITED?'Staff-supplied project link ↗':'Official project information ↗',p.raw.WEBLINK);if(official)$('map-project-links').append(official);$('detail').hidden=false;$('detail').open=false;$('detail-name').textContent=p.name?p.name+' · '+p.number:'Application '+p.number;$('detail-type').textContent=p.status;$('detail-description').textContent=p.description||'No description published.';$('source-links').replaceChildren();for(const [label,url] of [[p.raw.STAFF_EDITED?'Staff-supplied project link ↗':'Official inquiry ↗',p.raw.WEBLINK],['Application documents ↗',p.raw.APPLICATION_DOCUMENTS_WEBLINK]]){const a=link(label,url);if(a)$('source-links').append(a);}renderProjectOverview(p);const rail=nearest(p,'skytrain-stations'),bus=nearest(p,'bus-stops');$('rail-distance').textContent=rail?formatDistance(rail.metres):'Unavailable';$('bus-distance').textContent=bus?formatDistance(bus.metres):'Unavailable';$('nearest-details').textContent=[rail?.feature.properties.PL_NAME,bus?.feature.properties.LOCATION].filter(Boolean).join(' · ');$('station-distance').disabled=!rail;renderTravel();drawList();if(ready){selectionLayer.removeAll();if(p.feature.geometry.type==='Point'){selectionLayer.add(new Graphic({geometry:new Point({longitude:p.lon,latitude:p.lat}),symbol:{type:'simple-marker',color:'#0071e3',size:15,outline:{color:'white',width:2}}}));}else{const coords=p.feature.geometry.type==='Polygon'?p.feature.geometry.coordinates:p.feature.geometry.coordinates.flat();selectionLayer.add(new Graphic({geometry:new Polygon({rings:coords,spatialReference:{wkid:4326}}),symbol:{type:'simple-fill',color:[0,113,227,.12],outline:{color:'#0071e3',width:2}}}));}if(fly){frameProject();if(innerWidth<700)$('project-map-card').scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});}}setStatus('Selected '+p.number+' · '+p.status);$('map-project-title').focus({preventScroll:true});}
let placeCoverage={};
const recreationCategories=['Stadium','Swimming pool','Ice arena','Tennis court','Pickleball court','Basketball court','Soccer field','Baseball field','Cricket field','Volleyball court','Athletics track','Skate park','Bike park','Lacrosse court','Ball hockey court'];
const hiddenNearbyCategories=new Set(['Sports field','Outdoor recreation']);
const nearbyExplorers={nearby:{places:[],shown:0,origin:null}};
let amenityGroups=[],amenityPlaces=new Map();
function categoryLabel(name){return name==='Park'?'Parks':placeCoverage[name]?.label||name;}
function selectedNearbyCategory(){return $('nearby-category').value;}
function renderAmenityDirectory(){
 const host=$('nearby-category-grid');host.replaceChildren();
 const groups=SurreyCategoryMenu.filterGroups(amenityGroups,$('nearby-category-search').value);
 $('nearby-category-empty').hidden=groups.length>0;$('category-announcement').textContent=groups.reduce((count,group)=>count+group.options.length,0)+' matching categories';
 groups.forEach((group,i)=>{
  const section=el('section',undefined,'amenity-group'),heading=el('h3',group.label);
  heading.id='amenity-group-'+i;section.setAttribute('aria-labelledby',heading.id);
  const grid=el('div',undefined,'amenity-grid');
  for(const option of group.options){
   const place=amenityPlaces.get(option.value)?.[0],button=el('button',undefined,'amenity-card');
   button.type='button';button.dataset.category=option.value;button.setAttribute('aria-controls','nearby-category-detail');
   button.append(el('span',option.label,'amenity-label'));
   if(place){
    button.append(el('span',place.name.replace(/ — SkyTrain station$/,''),'amenity-nearest'),el('span',formatDistance(place.metres)+' →','amenity-distance'));
    button.setAttribute('aria-label',option.label+': '+place.name+', '+formatDistance(place.metres)+' straight-line distance. View locations.');
   }else button.append(el('span','No mapped location','amenity-nearest'));
   button.addEventListener('click',()=>{
    $('nearby-category').value=option.value;$('nearby-category').dispatchEvent(new Event('change'));
    $('nearby-explorer').scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});
    $('nearby-category-title').focus({preventScroll:true});
   });grid.append(button);
  }
  section.append(heading,grid);host.append(section);
 });
}
function showAmenityDirectory(focus=false){
 $('nearby-overview').hidden=false;$('nearby-category-detail').hidden=true;
 updateDestinationLayer();
 if(focus){const button=Array.from($('nearby-category-grid').querySelectorAll('button')).find(b=>b.dataset.category===selectedNearbyCategory());(button||$('nearby-category-search')).focus();}
}
function prepareAmenityDirectory(p){
 amenityPlaces=new Map(amenityGroups.flatMap(group=>group.options).map(option=>[option.value,SurreyNearby.venues(p,data,option.value)]));
 $('nearby-category-search').value='';renderAmenityDirectory();showAmenityDirectory();
 $('directions-panel').open=true;
}
$('nearby-category-search').addEventListener('input',renderAmenityDirectory);
$('nearby-category-search').addEventListener('keydown',event=>{if(event.key==='Escape'){$('nearby-category-search').value='';renderAmenityDirectory();}});
$('nearby-category-back').addEventListener('click',()=>showAmenityDirectory(true));
function renderNearbyCategory(p,key='nearby'){
 const state=nearbyExplorers[key];if(!p)return;
 state.origin=p;state.places=amenityPlaces.get(selectedNearbyCategory())||SurreyNearby.venues(p,data,selectedNearbyCategory());state.shown=0;
 $('nearby-overview').hidden=true;$('nearby-category-detail').hidden=false;
 $('nearby-category-title').textContent=categoryLabel(selectedNearbyCategory());
 $(key+'-category-results').replaceChildren();$(key+'-category-results').scrollTop=0;
 $(key+'-category-fit').disabled=!state.places.length;
 appendNearbyPlaces(key);updateDestinationLayer();
}
function appendNearbyPlaces(key='nearby',focusNew=false){
 const state=nearbyExplorers[key];
 const category=selectedNearbyCategory(),host=$(key+'-category-results'),previous=host.children.length,end=Math.min(state.shown+12,state.places.length);
 for(const place of state.places.slice(state.shown,end)){
  const row=el('article',undefined,'category-place'),button=el('button',undefined,'nearby-place'),props=place.feature.properties;
  button.type='button';button.setAttribute('aria-label',place.name+', '+formatDistance(place.metres)+' straight-line distance. Choose as destination.');const heading=el('span',undefined,'place-heading');heading.append(el('strong',place.name),el('span',formatDistance(place.metres),'place-distance'));
  const address=props.ADDRESS||props.CITY||props.SITE_NAME||(place.lat.toFixed(4)+', '+place.lon.toFixed(4));button.append(heading,el('small',address));
  button.addEventListener('click',()=>{$('travel-destination').value='custom';chooseAddress({...place,label:place.name,source:props.SOURCE_NAME||'Regional place inventory',locationType:'approximate reference point'});$('directions-panel').open=true;$('directions-panel').scrollIntoView({block:'nearest',behavior:reduced?'instant':'smooth'});$('travel-custom').focus({preventScroll:true});});row.append(button);
  if(props.SERVICE_NOTE){const note=el('p',props.SERVICE_NOTE,'category-service-note');if(props.SERVICE_NOTE.length>180){const details=el('details',undefined,'place-access');details.append(el('summary',category==='Recycling & disposal'?'Materials and access':'Service details'),note);row.append(details);}else row.append(note);}
  const a=link(props.SOURCE_URL?.includes('openstreetmap.org')?'Map source ↗':category==='Recycling & disposal'?'Accepted materials & fees ↗':props.SOURCE_DATASET?'Source record ↗':'Location details ↗',props.SOURCE_URL);if(a)row.append(a);host.append(row);
 }
 state.shown=end;
 const count=state.places.length;
 $(key+'-category-more').hidden=end>=count;
 $(key+'-category-more').textContent='Show more';
 if(!count)host.append(el('p','No locations in the current map data.','secondary'));
 if(focusNew)host.children[previous]?.querySelector('button')?.focus();
}
function updateDestinationLayer(){
 const layer=layers.destinations;if(!layer)return;
 const key='nearby';
 const open=!$('nearby-category-detail').hidden&&!$('project-map-card').hidden;
 const category=selectedNearbyCategory();
 layer.definitionExpression=open&&category?"CATEGORY IN ("+SurreyNearby.viewCategories(category).map(value=>"'"+value.replace(/'/g,"''")+"'").join(",")+")":'1=1';
 layer.visible=open;$('layer-destinations').checked=open;
 $('feature-info').hidden=true;
}
for(const key of Object.keys(nearbyExplorers)){
 $(key+'-category-more').addEventListener('click',()=>appendNearbyPlaces(key,true));
 $(key+'-category-fit').addEventListener('click',()=>{const state=nearbyExplorers[key];if(!ready||!state.origin||!state.places.length)return;connectionVisible=false;drawConnection();const points=[state.origin,...state.places.slice(0,12)];mode(true);move({target:points.map(p=>new Point({longitude:p.lon,latitude:p.lat})),tilt:0,heading:0});});
 $(key+'-category-results').addEventListener('scroll',()=>{const list=$(key+'-category-results'),state=nearbyExplorers[key];if(state.shown<state.places.length&&list.scrollHeight-list.scrollTop-list.clientHeight<70)appendNearbyPlaces(key);});
 $(key+'-category').addEventListener('change',()=>renderNearbyCategory(selected,key));

}
function renderNearby(p){
 const host=$('nearby-places');host.replaceChildren();
 prepareAmenityDirectory(p);
 const places=SurreyNearby.find(p,data);
 for(const place of places){
  const item=el('button',undefined,'nearby-place');item.type='button';
  item.append(el('small',place.category),el('strong',place.name),el('span',formatDistance(place.metres)+' · Compare →'));
  if(place.key==='bus-stops'){const props=place.feature.properties,flag=props.ACCESSIBLE;item.append(el('small','Source accessibility flag: '+(flag===null||flag===undefined||flag===''?'Not published':flag)+(props.TRANSIT_ROUTES?' · Routes '+props.TRANSIT_ROUTES:'')));}
  item.addEventListener('click',()=>{$('travel-destination').value='custom';chooseAddress({...place,label:place.name,source:'Public source snapshot',locationType:'approximate reference point'});$('directions-panel').open=true;$('directions-panel').scrollIntoView({block:'nearest'});$('travel-custom').focus({preventScroll:true});});host.append(item);
 }
}
// Address lookup is the only journey service used here. Actual routes open in Google Maps.
let journeyDestination=null,pickedDestination=null,pickingDestination=false,resolvedDestination=null,connectionVisible=false;
let addressResults=[],addressActive=-1,addressVersion=0,addressAbort,addressTimer,addressLimit=20,addressHasMore=false,addressLoading=false;
// Travel controls stay directly below the selected project heading.
function closeSuggestions(){
 $('address-suggestions').hidden=true;$('more-addresses').hidden=true;$('travel-custom').setAttribute('aria-expanded','false');
 $('travel-custom').removeAttribute('aria-activedescendant');addressActive=-1;
}
function stopAddressSearch(){clearTimeout(addressTimer);addressVersion++;addressLoading=false;addressAbort?.abort();$('address-suggestions').setAttribute('aria-busy','false');closeSuggestions();}
function invalidateRoutes(){routeDestinationMarker?.removeAll();$('connection-summary').hidden=true;}
function drawConnection(){
 invalidateRoutes();
 if(!selected||!journeyDestination||typeof journeyDestination==='string')return;
 $('connection-summary').hidden=false;
 $('connection-distance').textContent=formatDistance(distance(selected,journeyDestination));
 const inbound=$('travel-direction').value==='inbound';
 $('connection-endpoints').textContent=(inbound?'B':'A')+': Development '+selected.number+' · '+(inbound?'A':'B')+': '+journeyDestination.label;
 if(!ready||!connectionVisible)return;
 routeDestinationMarker.add(new Graphic({geometry:{type:'polyline',paths:[[[selected.lon,selected.lat],[journeyDestination.lon,journeyDestination.lat]]],spatialReference:{wkid:4326}},symbol:{type:'simple-line',color:'#254cb5',width:3,style:'dash'}}));
 for(const [p,label,color] of [[selected,inbound?'B':'A','#c56c28'],[journeyDestination,inbound?'A':'B','#254cb5']]){
  const geometry=new Point({longitude:p.lon,latitude:p.lat});
  routeDestinationMarker.add(new Graphic({geometry,symbol:{type:'point-3d',symbolLayers:[{type:'icon',size:21,resource:{primitive:'circle'},material:{color},outline:{color:'white',size:2}}],verticalOffset:{screenLength:8,minWorldLength:5,maxWorldLength:30}}}));
  routeDestinationMarker.add(new Graphic({geometry,symbol:{type:'text',text:label,color:'white',haloColor:color,haloSize:1,font:{size:12,weight:'bold'},yoffset:8}}));
 }
}
function fitConnection(){
 if(!ready||!selected||!journeyDestination||typeof journeyDestination==='string')return;
 connectionVisible=true;drawConnection();mode(true);$('layers-panel').open=false;
 const a=selected,b=journeyDestination,dx=Math.max(Math.abs(a.lon-b.lon)*.85,.004),dy=Math.max(Math.abs(a.lat-b.lat)*.85,.003);
 const cx=(a.lon+b.lon)/2,cy=(a.lat+b.lat)/2;
 move({target:new Polygon({rings:[[[cx-dx,cy-dy],[cx+dx,cy-dy],[cx+dx,cy+dy],[cx-dx,cy+dy],[cx-dx,cy-dy]]],spatialReference:{wkid:4326}}),tilt:0,heading:0});
}
function renderTravel(){
 if(!selected)return;
 const choice=$('travel-destination').value;
 let destination,label;
 if(choice==='nearest-bus'){const bus=nearest(selected,'bus-stops');if(bus){label=bus.feature.properties.LOCATION;destination={lon:bus.lon,lat:bus.lat,label};}}
 else if(choice==='map-point'){destination=pickedDestination;label=destination?'Selected map point':'Choose a destination on the map.';}
 else if(choice.startsWith('destination:')){const feature=data.destinations?.features[Number(choice.slice(12))];if(feature){label=feature.properties.NAME;destination={...SurreyNearby.point(feature),label};}}
 else if(choice==='custom'){destination=resolvedDestination||$('travel-custom').value.trim();label=resolvedDestination?.label||destination;}
 else{const station=choice==='nearest'?nearest(selected,'skytrain-stations'):null;const feature=choice.startsWith('station:')?data['skytrain-stations']?.features[Number(choice.slice(8))]:station?.feature;if(feature){label=feature.properties.PL_NAME;destination={lon:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1],label};}}
 if(destination&&typeof destination!=='string'&&!destination.label)destination.label=label;
 journeyDestination=destination;
 $('travel-custom-wrap').hidden=false;if(choice!=='custom'){$('travel-custom').value=label||'';$('address-status').textContent='';} $('travel-links').replaceChildren();
 $('travel-destination-name').textContent=label||'Choose an address, station or map point.';$('travel-destination-name').hidden=true;
 drawConnection();
 $('google-hint').textContent=!destination?'Choose a destination to view travel times.':typeof destination==='string'?'Choose a suggestion to pin the destination.':'Times in Google Maps';
 if(!destination){for(const title of ['Walk','Transit','Drive']){const button=el('button',title);button.disabled=true;$('travel-links').append(button);}return;}
 const inbound=$('travel-direction').value==='inbound';
 try{for(const [mode,title] of [['walking','Walk'],['transit','Transit'],['driving','Drive']]){const a=el('a');a.append(modeIcon(mode),el('span',title));a.href=SurreyTravel.build(inbound?destination:selected,inbound?selected:destination,mode);a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',mode+' directions and times in Google Maps, both locations filled in (new tab)');$('travel-links').append(a);}}
 catch(e){$('travel-destination-name').textContent=e.message;}
}
function modeIcon(mode){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const shapes={walking:'<circle cx="13" cy="4" r="2"/><path d="m7 12 3-4 4 1 3 4h3M11 9l-2 7-4 5m5-8 4 3 2 5"/>',transit:'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 10h14M8 19v2m8-2v2M8 6h8M8 15h1m6 0h1"/>',driving:'<path d="m4 10 2-6h12l2 6M4 10h16v9H4zM7 19v2m10-2v2M7 14h2m6 0h2"/>'};svg.innerHTML=shapes[mode];return svg;
}
function chooseAddress(result){
 stopAddressSearch();resolvedDestination=result;$('travel-custom').value=result.label;
 $('address-status').textContent='';$('address-announcement').textContent='Destination selected: '+result.label;
 renderTravel();fitConnection();$('travel-custom').focus({preventScroll:true});
}
function setActiveAddress(index,scroll=true){
 addressActive=index;
 const options=Array.from($('address-suggestions').children);
 for(const [i,item] of options.entries())item.setAttribute('aria-selected',String(i===addressActive));
 const item=options[addressActive];
 if(!item){$('travel-custom').removeAttribute('aria-activedescendant');return;}
 $('travel-custom').setAttribute('aria-activedescendant',item.id);
 if(scroll)item.scrollIntoView({block:'nearest'});
}
function showSuggestions(results,preserveScroll=false){
 const list=$('address-suggestions'),scroll=preserveScroll?list.scrollTop:0,previous=preserveScroll?addressResults[addressActive]:null;
 addressResults=results;addressActive=-1;list.replaceChildren();$('travel-custom').removeAttribute('aria-activedescendant');
 results.forEach((result,i)=>{const item=el('li');item.id='address-option-'+i;item.setAttribute('role','option');item.setAttribute('aria-selected','false');item.append(el('strong',result.title||result.label),el('small',result.subtitle||result.address||result.locationType));item.addEventListener('mousedown',e=>e.preventDefault());item.addEventListener('click',()=>chooseAddress(result));list.append(item);});
 list.hidden=!results.length;list.scrollTop=scroll;$('travel-custom').setAttribute('aria-expanded',String(!!results.length));
 $('more-addresses').hidden=!addressHasMore||!results.length;
 if(previous)setActiveAddress(results.findIndex(result=>result.label===previous.label&&result.lon===previous.lon&&result.lat===previous.lat),false);
 $('address-announcement').textContent=results.length?results.length+' suggestions available. Use the arrow keys to choose.':'';
}
async function searchAddress(more=false){
 const query=$('travel-custom').value.trim();if(query.length<3||addressLoading)return;
 if(more){if(!addressHasMore)return;addressLimit=Math.min(50,addressLimit+20);}
 const version=addressVersion;addressLoading=true;addressAbort=new AbortController();const controller=addressAbort;
 const timeout=setTimeout(()=>{if(version===addressVersion){controller.abort();$('address-status').textContent='Online search is taking too long. Choose a local match or try again.';}},10000);
 $('address-status').textContent=more?'Finding more matches…':'Finding addresses and places…';$('more-addresses').disabled=true;$('address-suggestions').setAttribute('aria-busy','true');
 try{
  const origin=selected?{lon:selected.lon,lat:selected.lat}:undefined,options={signal:controller.signal,origin,limit:addressLimit};
  if(!more){const local=await SurreyAddressSearch.search(query,{...options,localOnly:true});if(version!==addressVersion)return;if(local.length){showSuggestions(local);$('address-status').textContent='Searching…';}}
  const results=await SurreyAddressSearch.search(query,options);if(version!==addressVersion)return;
  addressHasMore=(results.hasMore??results.length>=addressLimit)&&addressLimit<50;showSuggestions(results,more);
  $('address-status').textContent=results.length?'':'No match. Try a street number or city.';
 }catch(e){if(e.name!=='AbortError'&&version===addressVersion){addressHasMore=false;$('more-addresses').hidden=true;$('address-status').textContent=addressResults.length?'Showing local matches. Online address search is unavailable.':'Address search is unavailable. Choose a map point or use Google Maps below.';}}
 finally{clearTimeout(timeout);if(version===addressVersion){addressLoading=false;$('more-addresses').disabled=false;$('address-suggestions').setAttribute('aria-busy','false');}}
}
$('address-suggestions').addEventListener('scroll',()=>{const list=$('address-suggestions');if(!list.hidden&&list.scrollTop>0&&list.scrollTop+list.clientHeight>=list.scrollHeight-45)searchAddress(true);});
$('more-addresses').addEventListener('click',()=>searchAddress(true));
$('travel-custom').addEventListener('input',()=>{
 stopAddressSearch();addressLoading=false;addressLimit=20;addressHasMore=false;resolvedDestination=null;addressResults=[];$('travel-destination').value='custom';renderTravel();
 if($('travel-custom').value.trim().length<3){$('address-status').textContent='Type at least 3 characters for suggestions.';return;}
 $('address-status').textContent='Searching…';addressTimer=setTimeout(searchAddress,700);
});
$('travel-custom').addEventListener('keydown',e=>{
 if(e.key==='Tab'){stopAddressSearch();return;}
 if(e.key==='Escape'){if(!$('address-suggestions').hidden)e.stopPropagation();stopAddressSearch();return;}
 if(e.key==='Enter'){e.preventDefault();if(!$('address-suggestions').hidden&&addressResults.length)chooseAddress(addressResults[Math.max(0,addressActive)]);else{stopAddressSearch();searchAddress();}return;}
 if(['ArrowDown','ArrowUp'].includes(e.key)&&!$('address-suggestions').hidden&&addressResults.length){e.preventDefault();setActiveAddress(addressActive<0?(e.key==='ArrowDown'?0:addressResults.length-1):(addressActive+(e.key==='ArrowDown'?1:-1)+addressResults.length)%addressResults.length);}
});
document.querySelector('.address-search').addEventListener('focusout',e=>{if(!e.currentTarget.contains(e.relatedTarget))stopAddressSearch();});
document.addEventListener('click',e=>{if(!e.target.closest('.address-search'))stopAddressSearch();});
$('travel-destination').addEventListener('change',()=>{stopAddressSearch();renderTravel();if($('travel-destination').value==='custom')$('travel-custom').focus();else fitConnection();});
$('travel-direction').addEventListener('change',renderTravel);
$('fit-connection').addEventListener('click',fitConnection);
function cancelPicking(){pickingDestination=false;updatePickTarget();$('destination-prompt').hidden=true;$('pick-destination').setAttribute('aria-pressed','false');if(view)view.container.style.cursor='';}
function closeProject(){$('fit-project').hidden=true;$('project-map-card').hidden=true;$('browse-panel').hidden=false;cancelPicking();clearMeasure();stopAddressSearch();selected=null;selectionLayer?.removeAll();invalidateRoutes();updateDestinationLayer();}
$('close-project-card').addEventListener('click',()=>{const id=selected?.id;closeProject();const button=[...$('projects').querySelectorAll('button')].find(b=>b.dataset.application===String(id));(button||$('search')).focus({preventScroll:true});});
$('pick-destination').addEventListener('click',()=>{if(!ready)return;stopAddressSearch();clearMeasure();pickingDestination=!pickingDestination;updatePickTarget();if(pickingDestination&&innerWidth<700)document.querySelector('.map-section').scrollIntoView({block:'start'});$('destination-prompt').hidden=!pickingDestination;$('pick-destination').setAttribute('aria-pressed',String(pickingDestination));view.container.style.cursor=pickingDestination?'crosshair':'';if(pickingDestination){view.focus();setStatus('Choose a map point, or use arrow keys and press Enter at the crosshair. Escape cancels.');}});
document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(pickingDestination){cancelPicking();$('project-map-card').hidden=false;$('pick-destination').focus();}else if(measuring||!$('measure-panel').hidden){clearMeasure();$('measure').focus();}});
function updatePickTarget(){$('map-pick-target').hidden=!measuring&&!pickingDestination;}
function clearMeasure(){measuring=false;updatePickTarget();measurePoints=[];measureLayer?.removeAll();$('measure').setAttribute('aria-pressed','false');$('measure-panel').hidden=true;if(view)view.container.style.cursor='';}
function acceptMapPoint(point,keyboard=false){
 if(!point||!Number.isFinite(point.longitude)||!Number.isFinite(point.latitude))return false;
 const location={lon:point.longitude,lat:point.latitude};
 if(pickingDestination){
  pickedDestination=location;cancelPicking();$('project-map-card').hidden=false;$('travel-destination').value='map-point';renderTravel();fitConnection();
  setStatus('Map destination selected. Walking, transit and driving directions are ready.');
  if(keyboard)$('travel-custom').focus();
  return true;
 }
 if(!measuring)return false;
 measurePoints.push(location);
 if(measurePoints.length===1){
  $('measure-result').textContent='First point set. Choose the second point, or move with the arrow keys and press Enter.';
  measureLayer.add(new Graphic({geometry:point,symbol:{type:'simple-marker',color:'#1942be',size:9}}));
 }else{
  drawMeasurement(...measurePoints);measuring=false;updatePickTarget();$('measure').setAttribute('aria-pressed','false');view.container.style.cursor='';
  if(keyboard)$('measure-result').focus();
 }
 return true;
}
$('viewDiv').addEventListener('keydown',event=>{
 if(event.key!=='Enter'||(!measuring&&!pickingDestination)||event.target.closest('button,input,select,a,summary'))return;
 event.preventDefault();event.stopPropagation();
 const point=view?.toMap({x:view.width/2,y:view.height/2});
 if(!acceptMapPoint(point,true))setStatus('The crosshair is outside the ground. Move the map down and try again.');
},true);
function drawMeasurement(a,b){measureLayer.removeAll();measureLayer.add(new Graphic({geometry:{type:'polyline',paths:[[[a.lon,a.lat],[b.lon,b.lat]]],spatialReference:{wkid:4326}},symbol:{type:'simple-line',color:'#1942be',width:3,style:'dash'}}));for(const p of [a,b])measureLayer.add(new Graphic({geometry:new Point({longitude:p.lon,latitude:p.lat}),symbol:{type:'simple-marker',size:9,color:'#1942be',outline:{color:'white',width:2}}}));$('measure-panel').hidden=false;$('measure-result').textContent=formatDistance(distance(a,b))+' · straight line, not a walking route';}
let featureReturnFocus=null;
function showFeature(config,attributes){if($('feature-info').hidden)featureReturnFocus=document.activeElement;$('feature-info').hidden=false;const title=config.id==='bus-routes'?'Bus '+attributes.ROUTE_NO:config.id==='skytrain-stations'?attributes.PL_NAME:config.id==='bus-stops'?'Bus stop '+attributes.BUS_STOP_NO:config.id==='destinations'?attributes.NAME:config.title;$('feature-title').textContent=title;$('feature-properties').replaceChildren();for(const [field,label] of config.fields){const value=attributes[field];if(value!==null&&value!==undefined&&value!=='')$('feature-properties').append(el('dt',label),el('dd',field==='BUILDING_HEIGHT'?Number(value).toLocaleString('en-CA',{maximumFractionDigits:1}):String(value)));}const source=attributes.SOURCE_URL||config.source||[...manifest.layers,...(amenitySource?.layers||[])].find(x=>x.id===config.id)?.source;const a=$('feature-source');a.hidden=!safeLink(source);if(safeLink(source))a.href=source;$('feature-title').focus({preventScroll:true});if(innerWidth<700)$('feature-info').scrollIntoView({block:'nearest'});}
function closeFeature(){$('feature-info').hidden=true;if(featureReturnFocus?.isConnected)featureReturnFocus.focus({preventScroll:true});else view?.focus();}
$('feature-info').addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();closeFeature();}});
// The comparison changes visibility only: camera position and height scale stay fixed.
function setScenario(proposed){
 showProposals=proposed;
 if(layers['proposed-buildings'])layers['proposed-buildings'].visible=proposed;
 if($('layer-proposed-buildings'))$('layer-proposed-buildings').checked=proposed;
 for(const layer of [projectMarkers,selectionLayer])if(layer)layer.visible=proposed;
 $('compare-existing').setAttribute('aria-pressed',String(!proposed));
 $('compare-proposed').setAttribute('aria-pressed',String(proposed));
 $('key-proposed').hidden=!proposed;
 updateScenarioNote();
}
function updateScenarioNote(){
 $('scenario-note').textContent=layers['existing-buildings']&&!layers['existing-buildings'].visible?'Existing building layer hidden':view?.scale>25000?'Zoom in to see existing buildings':showProposals?'Approximate shapes · proposals may change':'Published building heights · flat ground';
}
function applicationGeometry(p){
 if(p.feature.geometry.type==='Point')return new Point({longitude:p.lon,latitude:p.lat});
 return new Polygon({rings:p.feature.geometry.type==='Polygon'?p.feature.geometry.coordinates:p.feature.geometry.coordinates.flat(),spatialReference:{wkid:4326}});
}
function frameProject(){
 if(!ready||!selected)return;
 connectionVisible=false;drawConnection();
 const models=projectModels(selected.number);
 const target=models.length?new Polygon({rings:models.flatMap(f=>f.geometry.type==='Polygon'?f.geometry.coordinates:f.geometry.coordinates.flat()),spatialReference:{wkid:4326}}):applicationGeometry(selected);
 const extent=target.extent;
 const siteSpan=extent?distance({lon:extent.xmin,lat:extent.ymin},{lon:extent.xmax,lat:extent.ymax}):0;
 const buildings=models.filter(f=>f.properties.component==='building').length;
 const height=Math.max(0,...models.map(f=>f.properties.height_m));
 mode(false);move({target,scale:models.length?Math.max(4000,siteSpan*11,height*26):Math.max(5500,siteSpan*8),tilt:models.length?(buildings>2?54:62):48,heading:325});
}
for(const [id,proposed] of [['compare-existing',false],['compare-proposed',true]])$(id).addEventListener('click',()=>{
 if(!ready)return;
 // Keep a useful baseline even if the user previously hid it in Layers.
 layers['existing-buildings'].visible=true;$('layer-existing-buildings').checked=true;document.querySelector('.key-existing').hidden=false;
 setScenario(proposed);SurreyEvents.record('building_comparison',proposed?'with-proposals':'existing');
 setStatus(proposed?'Proposed buildings shown in gold.':'Proposed buildings hidden. Camera position unchanged.');
});
$('fit-project').addEventListener('click',frameProject);
function addControl(config,count){const label=el('label'),input=el('input');input.type='checkbox';input.checked=layers[config.id].visible;input.id='layer-'+config.id;input.addEventListener('change',()=>{SurreyEvents.record('layer_toggle',config.id+':'+input.checked);if(config.id==='proposed-buildings')setScenario(input.checked);else if(layers[config.id])layers[config.id].visible=input.checked;if(config.id==='existing-buildings')document.querySelector('.key-existing').hidden=!input.checked;updateScenarioNote();});const swatch=el('i');swatch.style.background=config.color;label.append(input,swatch,el('span',config.title),el('small',count.toLocaleString()));$('layer-controls').append(label);}
function renderer(config){if(config.id==='destinations')return {type:'simple',symbol:{type:'point-3d',symbolLayers:[{type:'icon',size:12,resource:{primitive:'circle'},material:{color:config.color},outline:{color:'#ffffff',size:1.5}}],verticalOffset:{screenLength:55,minWorldLength:50,maxWorldLength:250},callout:{type:'line',color:'#8157aa99',size:1}}};if(config.kind==='truck')return {type:'unique-value',field:'TRUCK_ROUTE',defaultSymbol:{type:'simple-line',color:'#576e82',width:2},uniqueValueInfos:[{value:'Truck Routes',symbol:{type:'simple-line',color:'#576e82',width:2.5}},{value:'Truck Routes with Restrictions',symbol:{type:'simple-line',color:'#ab7132',width:3,style:'dash'}},{value:'Dangerous Goods Routes',symbol:{type:'simple-line',color:'#975e79',width:2,style:'dot'}}]};if(config.kind==='proposed')return {type:'simple',symbol:{type:'polygon-3d',symbolLayers:[{type:'extrude',material:{color:'#d5ae70'},edges:{type:'solid',color:'#82653d',size:.6}}]},visualVariables:[{type:'size',field:'height_m',valueUnit:'meters',axis:'height'}]};if(config.kind==='buildings')return {type:'simple',symbol:{type:'polygon-3d',symbolLayers:[{type:'extrude',material:{color:'#d4d8dd'},edges:{type:'solid',color:'#9da5af55',size:.4}}]},visualVariables:[{type:'size',field:'BUILDING_HEIGHT',valueUnit:'meters',axis:'height'}]};if(config.kind==='polygon')return {type:'simple',symbol:{type:'simple-fill',color:config.color+'38',outline:{color:config.color,width:1}}};if(config.kind==='line')return {type:'simple',symbol:{type:'simple-line',color:config.color,width:config.width}};return {type:'simple',symbol:{type:'simple-marker',color:config.color,size:config.size,outline:{color:'#ffffff',width:1.2}}};}
function dataURL(url){const key=url.replace(/^data\//,'').replace(/\.geojson$/,'');let inline=data[key]||window.__SURREY_DATA?.[url];if(key==='developments'&&inline)inline={...inline,features:inline.features.filter(f=>f.geometry.type!=='Point')};return inline?URL.createObjectURL(new Blob([JSON.stringify(inline)],{type:'application/geo+json'})):new URL(url,location.href).href;}
async function fetchJSON(url){let result=window.__SURREY_DATA?.[url];if(!result){const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error(url+' returned '+r.status);result=await r.json();}return SurreyPublishing.apply(result,url);}
function failure(message){$('loading').hidden=true;$('map-error').hidden=false;$('map-error-message').textContent=message;setStatus('Some data could not load. See map message.');}
function mapDependencyError(error){const message=String(error?.message||error||'');if(message.includes('scriptError')&&message.includes('js.arcgis.com')){renderingDependencyFailed=true;failure('Some map graphics could not load. Reload the map, or use the text view.');}}
addEventListener('error',event=>mapDependencyError(event.error||event.message));addEventListener('unhandledrejection',event=>mapDependencyError(event.reason));
$('data-tools').addEventListener('click',()=>{const notes=$('source-details');notes.open=true;notes.scrollIntoView({block:'start',behavior:reduced?'instant':'smooth'});notes.querySelector('summary').focus({preventScroll:true});});
$('search').addEventListener('input',()=>{if($('search').value.trim()){featuredOnly=false;updateScope();}clearTimeout(filterTimer);filterTimer=setTimeout(filter,140);});$('status-filter').addEventListener('change',filter);$('load-more').addEventListener('click',()=>{const previous=$('projects').children.length;limit+=60;drawList();$('projects').children[previous]?.focus();});
$('area').addEventListener('change',()=>{if(!ready)return;pilotFilter=$('area').value;closeProject();$('search').value='';$('status-filter').value='';featuredOnly=true;updateScope();filter();const area=areas[$('area').value];SurreyEvents.record('pilot_area',$('area').value);mode(false);move({target:[area.lon,area.lat],scale:area.scale,tilt:$('area').value==='surrey'?15:48,heading:$('area').value==='surrey'?0:325});});
$('view-top').addEventListener('click',()=>{if(ready){mode(true);move({tilt:0,heading:0});}});$('view-3d').addEventListener('click',()=>{if(ready){mode(false);move({tilt:48,heading:325});}});
$('measure').addEventListener('click',()=>{if(!ready)return;const next=!measuring;clearMeasure();measuring=next;updatePickTarget();$('measure').setAttribute('aria-pressed',String(next));$('measure-panel').hidden=!next;$('measure-result').textContent='Choose two map points, or use the arrow keys and Enter at the crosshair. Escape cancels.';if(next){cancelPicking();view.focus();}view.container.style.cursor=next?'crosshair':'';});$('clear-measure').addEventListener('click',clearMeasure);$('close-feature').addEventListener('click',closeFeature);
$('station-distance').addEventListener('click',()=>{if(!ready||!selected)return;const rail=nearest(selected,'skytrain-stations');if(!rail)return;clearMeasure();drawMeasurement(selected,rail);move({target:[[selected.lon,selected.lat],[rail.lon,rail.lat]],tilt:25,heading:0});});
if(innerWidth<700)$('layers-panel').open=false;
const watchdog=setTimeout(()=>{if(!ready)failure('The map is taking longer than expected. Check internet access and WebGL support. Public data files remain available in Sources.');},60000);
if(typeof require!=='function'){clearTimeout(watchdog);failure('The mapping library could not load. Check internet access and reload.');}
else require(['esri/Map','esri/Basemap','esri/layers/WebTileLayer','esri/views/SceneView','esri/layers/GeoJSONLayer','esri/layers/GraphicsLayer','esri/Graphic','esri/geometry/Polygon','esri/geometry/Point','esri/layers/FeatureLayer'],async(Map,Basemap,WebTileLayer,SceneView,GeoJSONLayer,GraphicsLayer,GraphicClass,PolygonClass,PointClass,FeatureLayer)=>{
 try{
  Graphic=GraphicClass;Polygon=PolygonClass;Point=PointClass;
  await SurreyPublishing.load();$('revision-label').textContent=SurreyPublishing.describe();$('revision-label').classList.toggle('draft',SurreyPublishing.state.mode==='draft');
  data['project-profiles']=await fetchJSON('data/project-profiles.json').catch(()=>({profiles:{}}));
  [manifest,developmentSource,amenitySource]=await Promise.all([fetchJSON('data/transport-sources.json'),fetchJSON('data/development-source.json'),fetchJSON('data/amenity-sources.json')]);
  placeCoverage=(await fetchJSON('data/destinations-sources.json')).category_coverage||{};
  const snapshotDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',dateStyle:'medium'}).format(new Date(manifest.retrieved));$('snapshot-date').textContent=snapshotDate+' (Toronto)';
  const results=await Promise.allSettled(configs.map(async c=>{if(!c.remote)data[c.id]=await fetchJSON('data/'+c.id+'.geojson');return c.id;}));
  // Filter the displayed inventories; downloaded source files stay intact.
  const shownParks=new Set(SurreyNearby.venues(areas.centre,data,'Park').flatMap(place=>place.members||[place]).map(place=>place.feature));
  if(data.destinations)data.destinations={...data.destinations,features:data.destinations.features.filter(feature=>feature.properties.CATEGORY!=='Park'||shownParks.has(feature))};
  if(data.parks)data.parks={...data.parks,features:data.parks.features.filter(SurreyNearby.eligiblePark)};
  const regionalStations=(data.destinations?.features||[]).filter(f=>f.properties.CATEGORY==='SkyTrain station');
  if(regionalStations.length)data['skytrain-stations']={type:'FeatureCollection',features:regionalStations.map(f=>({...f,properties:{...f.properties,PL_NAME:f.properties.NAME}}))};
  if(window.__SURREY_DATA)document.querySelectorAll('a[href^="data/"]').forEach(a=>a.href=dataURL(a.getAttribute('href')));
  const failed=results.flatMap((r,i)=>r.status==='rejected'?[configs[i].title]:[]);
  if(!data.developments)throw Error('Development data could not load.');
  // Keep source records intact on disk; the public catalogue contains modelled sites only.
  const modelledProjects=new Set((data['proposed-buildings']?.features||[]).map(f=>f.properties.project_no));
  data.developments={...data.developments,features:data.developments.features.filter(f=>modelledProjects.has(f.properties.PROJECT_NO)||(SurreyPublishing.state.mode==='draft'&&f.properties.STAFF_ADDED))};
  applications=data.developments.features.map(f=>({id:f.properties.OBJECTID,number:f.properties.PROJECT_NO,name:f.properties.DISPLAY_NAME||'',status:f.properties.STATUS,description:f.properties.DESCRIPTION||'',raw:f.properties,feature:f,...centre(f)}));
  applications.sort((a,b)=>distance(a,areas.centre)-distance(b,areas.centre));
  for(const status of [...new Set(applications.map(p=>p.status))].sort())$('status-filter').append(new Option(status,status));
  SurreyAddressSearch.setFeatures(data.destinations?.features||[]);
  matches=applications;filter();
  (data['skytrain-stations']?.features||[]).forEach((f,i)=>$('travel-destination').append(new Option(f.properties.PL_NAME,'station:'+i)));
  const destinationGroups=[['Everyday essentials',['SkyTrain station','Groceries','Pharmacy','Park','Bus stop','Gym','Playground','Hospital']],['Schools & childcare',['Childcare','Elementary school','Secondary school','Middle school','Combined school','Other school','University','Library']],['Getting around',['Passenger rail','Bike parking','Airport','Ferry terminal','Carpool location','Park & ride']],['Shopping & services',['Hardware store','Furniture store','Hotel','Car rental','Recycling & disposal','Border crossing']],['Neighbourhoods & culture',['Neighbourhood','Museum','Art gallery','Civic destination']],['Parks & nature',['Regional park','Provincial park','National park']]];
  const availableCategories=new Set((data.destinations?.features||[]).map(f=>f.properties.CATEGORY));
  const groupedCategories=new Set([...destinationGroups.flatMap(([,categories])=>categories),...recreationCategories,...hiddenNearbyCategories]);
  const extraCategories=[...availableCategories].filter(c=>!groupedCategories.has(c)).sort();if(extraCategories.length)destinationGroups.push(['Other places',extraCategories]);
  destinationGroups.push(['Sports & recreation',recreationCategories]);
  for(const [label,categories] of destinationGroups){const group=el('optgroup');group.label=label;for(const category of categories.filter(c=>availableCategories.has(c)))group.append(new Option(categoryLabel(category),category));if(group.children.length)$('nearby-category').append(group);}
  amenityGroups=Array.from($('nearby-category').children).map(group=>({label:group.label,options:Array.from(group.children).map(option=>({value:option.value,label:option.textContent}))}));
  for(const category of [...new Set((data.destinations?.features||[]).map(f=>f.properties.CATEGORY))]){const group=el('optgroup');group.label=category;(data.destinations?.features||[]).forEach((f,i)=>{if(f.properties.CATEGORY===category)group.append(new Option(f.properties.NAME,'destination:'+i));});$('travel-destination').append(group);}
  const sourceList=el('ul');for(const row of [{title:'Development applications',count:applications.length,source:developmentSource.sourceUrl},...manifest.layers,...amenitySource.layers]){const li=el('li'),a=link(row.title+' — '+row.count.toLocaleString()+' records',row.source);if(a)li.append(a);sourceList.append(li);}const buildingNote=el('li');buildingNote.append(link('Existing building footprints and heights — fetched on demand',configs[0].source));sourceList.append(buildingNote);for(const category of [...new Set((data.destinations?.features||[]).map(f=>f.properties.CATEGORY))]){sourceList.append(el('li',category+' — '+data.destinations.features.filter(f=>f.properties.CATEGORY===category).length+' indexed locations'));}$('source-notes').append(sourceList);
  const map=new Map({basemap:new Basemap({baseLayers:[new WebTileLayer({opacity:.48,urlTemplate:'https://tile.openstreetmap.org/{level}/{col}/{row}.png',copyright:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · Data: City of Surrey'})]}),ground:{surfaceColor:'#f3f4f5'}});
  for(const config of configs){if(!data[config.id]&&!config.remote)continue;const layer=config.remote?new FeatureLayer({url:config.source,title:config.title,definitionExpression:"BUILDING_HEIGHT > 0 AND STATUS='In Service'",renderer:renderer(config),outFields:['NAME','LOCATION','BUILDING_HEIGHT','STATUS','FACILITY_TYPE'],popupEnabled:false,minScale:25000,elevationInfo:{mode:'on-the-ground'}}):new GeoJSONLayer({url:dataURL('data/'+config.id+'.geojson'),title:config.title,renderer:renderer(config),outFields:['*'],popupEnabled:false,minScale:config.minScale||0,elevationInfo:{mode:'on-the-ground'}});layer.visible=initiallyVisible.has(config.id);layers[config.id]=layer;map.add(layer);addControl(config,config.remote?'nearby':data[config.id].features.length);}
  selectionLayer=new GraphicsLayer({title:'Selected application site',elevationInfo:{mode:'relative-to-ground',offset:.4}});measureLayer=new GraphicsLayer({title:'Straight-line measurement',elevationInfo:{mode:'relative-to-ground',offset:1}});map.addMany([selectionLayer,measureLayer]);
  projectMarkers=new GraphicsLayer({title:'Clickable project locations',elevationInfo:{mode:'relative-to-ground',offset:25}});routeDestinationMarker=new GraphicsLayer({title:'Journey destination',elevationInfo:{mode:'relative-to-ground',offset:2}});map.addMany([projectMarkers,routeDestinationMarker]);
  projectMarkers.addMany(applications.map(p=>new Graphic({geometry:new Point({longitude:p.lon,latitude:p.lat}),attributes:{OBJECTID:p.id,PROJECT_NO:p.number},symbol:{type:'point-3d',symbolLayers:[{type:'icon',size:10,resource:{primitive:'circle'},material:{color:'#0071e3'},outline:{color:'#ffffff',size:1.5}}],verticalOffset:{screenLength:15,minWorldLength:10,maxWorldLength:100}}}))); 
  view=new SceneView({container:'viewDiv',map,qualityProfile:'medium',center:[areas.centre.lon,areas.centre.lat],scale:14500,environment:{background:{type:'color',color:'#f3f4f5'},starsEnabled:false,atmosphereEnabled:false,lighting:{type:'virtual',directShadowsEnabled:false}},ui:{components:['zoom','compass','navigation-toggle','attribution']}});view.ui.move(['zoom','compass','navigation-toggle'],'top-right');
  await view.when();
  view.watch('scale',updateScenarioNote);
  const layerResults=await Promise.allSettled(Object.values(layers).map(l=>l.load()));
  const loadFailures=layerResults.flatMap((r,i)=>r.status==='rejected'?[Object.values(layers)[i].title]:[]);
  await view.goTo({target:[areas.centre.lon,areas.centre.lat],scale:14500,tilt:48,heading:325},{animate:false});
  ready=true;setScenario(showProposals);$('compare-existing').disabled=false;$('compare-proposed').disabled=false;renderModelProjects();updateScope();filter();if(selected)drawConnection();clearTimeout(watchdog);$('loading').hidden=true;if(!renderingDependencyFailed)$('map-error').hidden=true;$('loaded-count').textContent=(Object.keys(layers).length-loadFailures.length)+'/'+configs.length;
  setStatus(applications.length.toLocaleString()+' modelled projects · Public-source demonstration');
  if(failed.length||loadFailures.length)failure('Unavailable layers: '+[...failed,...loadFailures].join(', ')+'. Other layers remain usable.');
  view.on('click',async event=>{try{if(pickingDestination||measuring){acceptMapPoint(event.mapPoint);return;}const result=await view.hitTest(event,{include:[...Object.values(layers),projectMarkers].filter(l=>l.visible)});const hits=result.results.filter(r=>r.graphic?.layer);const hit=hits.find(r=>r.graphic.layer===layers['proposed-buildings'])||hits.find(r=>r.graphic.layer===projectMarkers)||hits.find(r=>r.graphic.layer===layers.developments)||hits[0];if(!hit)return;const config=configs.find(c=>layers[c.id]===hit.graphic.layer);if(config?.id==='proposed-buildings'){const p=applications.find(p=>p.number===hit.graphic.attributes.project_no);if(p){select(p,false);setStatus('Proposed 3D sample · '+hit.graphic.attributes.name);}return;}if(config?.id==='developments'||hit.graphic.layer===projectMarkers){const p=applications.find(p=>p.number===hit.graphic.attributes.PROJECT_NO);if(p){select(p,false);$('feature-info').hidden=true;}}else if(config)showFeature(config,hit.graphic.attributes);}catch(e){console.error(e);}});
  const requestedProject=new URLSearchParams(location.search).get('project');if(requestedProject){const project=applications.find(p=>p.number===requestedProject);if(project){if(projectModels(project.number).length)selectModelProject(project.number);else select(project,true);}}
  window.surreyDemo={get ready(){return ready;},view,layers,data,applications,measureLayer,selectionLayer,projectMarkers,get selected(){return selected;},get journeyDestination(){return journeyDestination;},routeDestinationMarker,distance,nearest};
 }catch(e){window.__appErrors.push(String(e));console.error(e);clearTimeout(watchdog);failure('Unable to load the public-data map: '+e.message);}
},e=>{clearTimeout(watchdog);failure('Unable to load the mapping library: '+e);});
