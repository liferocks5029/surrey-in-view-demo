(function (root) {
  'use strict';
  const radians = Math.PI / 180;
  function distance(a,b) {const h=Math.sin((b.lat-a.lat)*radians/2)**2+Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin((b.lon-a.lon)*radians/2)**2;return 12742017.6*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));}
  function point(feature) {
    if (feature.geometry.type === 'Point') return {lon:feature.geometry.coordinates[0],lat:feature.geometry.coordinates[1]};
    const points=[];function walk(c){if(typeof c[0]==='number')points.push(c);else c.forEach(walk);}walk(feature.geometry.coordinates);
    return {lon:(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,lat:(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2};
  }
  const title = p => p.NAME || p.PL_NAME || p.PARK_NAME || p.LOCATION || p.DESCRIPTION || p.ADDRESS || 'Mapped place';
  const groups = [['skytrain-stations','SkyTrain station'],['bus-stops','Bus stop'],['parks','Park'],['outdoor-recreation','Recreation inventory']];
  function eligiblePark(feature) {
    const p=feature.properties||{},name=String(p.PARK_NAME||p.NAME||'').trim();
    // The combined destinations snapshot keeps the source classification in SERVICE_NOTE.
    const classification=String(p.AMENITY_CLASS??String(p.SERVICE_NOTE||'').split(' · ')[0]).trim().toLowerCase();
    if(!name||String(p.PARK_OWNERSHIP||'').toLowerCase()==='private')return false;
    if(/greenbelt|greenway|walkway|corridor|utility|\brow\b|unimproved|undeveloped|detention\s*pond|\bbuffer\b|\beasement\b|\bberm\b|cemetery|heritage stump|recreation cent(?:re|er)|community hall|games court/i.test(name))return false;
    if(['active','amenity park'].includes(classification))return true;
    // Passive and natural-area classifications also contain genuine named parks.
    return ['passive','natural area only'].includes(classification)&&/\bpark\b|tot[- ]?lot/i.test(name);
  }
  function category(origin,data,name) {
    return (data.destinations?.features||[]).filter(f=>!name||f.properties.CATEGORY===name).map(feature=>{const location=point(feature);return {feature,...location,key:"destinations",category:feature.properties.CATEGORY||"Other destination",name:title(feature.properties),metres:distance(origin,location)};}).sort((a,b)=>a.metres-b.metres);
  }
  function viewCategories(name) {
    return ['Elementary school','Secondary school'].includes(name)?[name,'Combined school']:[name];
  }
  function venues(origin,data,name) {
    let places=viewCategories(name).flatMap(categoryName=>category(origin,data,categoryName)).sort((a,b)=>a.metres-b.metres);
    if(name==='Park'){
      const sources=new Map((data.parks?.features||[]).map(feature=>[String(feature.properties.OBJECTID),feature]));
      places=places.filter(place=>eligiblePark(sources.get(String(place.feature.properties.SOURCE_OBJECTID))||place.feature));
      if(!data.destinations&&data.parks)places=data.parks.features.filter(eligiblePark).map(feature=>{const location=point(feature);return {feature,...location,key:'parks',category:'Park',name:title(feature.properties),metres:distance(origin,location)};}).sort((a,b)=>a.metres-b.metres);
    }
    const groups=new Map(),result=[];
    const sport=new Set(['Stadium','Swimming pool','Ice arena','Tennis court','Pickleball court','Basketball court','Soccer field','Baseball field','Cricket field','Volleyball court','Athletics track','Skate park','Bike park','Lacrosse court','Ball hockey court','Sports field','Outdoor recreation']);
    if(!sport.has(name)&&name!=='Childcare'&&name!=='Park'&&name!=='Bike parking'&&!places.some(place=>place.feature.properties.DISPLAY_SITE_ID))return places;
    for(const place of places){
      const props=place.feature.properties;
      const childcare=name==='Childcare',bikeParking=name==='Bike parking',reviewedSite=Boolean(props.DISPLAY_SITE_ID);
      const site=String(childcare||reviewedSite?props.DISPLAY_SITE_NAME||'':name==='Park'?props.PARK_NAME||props.NAME||'':bikeParking?props.ADDRESS||'':props.PARK||props.SITE_NAME||'').trim();
      // Named source sites only: anonymous court labels are not venue identities.
      if(!site){result.push(place);continue;}
      const key=(childcare||reviewedSite?props.DISPLAY_SITE_ID||site:site).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const candidates=groups.get(key)||[];
      // Same-named sites in different neighbourhoods must remain separate.
      const existing=candidates.find(group=>distance(group,place)<(bikeParking?25:2000));
      if(existing){existing.members.push(place);continue;}
      const feature=childcare||reviewedSite?{...place.feature,properties:{...props,ADDRESS:props.DISPLAY_SITE_ADDRESS||props.ADDRESS,SOURCE_URL:props.DISPLAY_SITE_URL||props.SOURCE_URL}}:place.feature;
      const group={...place,name:bikeParking?place.name:site,feature,members:[place]};
      candidates.push(group);groups.set(key,candidates);result.push(group);
    }
    return result;
  }
  function metrics(origin,data,radius=1000) {
    const count=name=>data.destinations?category(origin,data,name).filter(p=>p.metres<=radius).length:null;
    const station=category(origin,data,'SkyTrain station')[0]||null;
    const parkData=data.parks?{parks:data.parks}:data;
    const parks=venues(origin,parkData,'Park').filter(place=>place.metres<=radius);
    const hasParkSource=Boolean(data.parks)||(data.destinations?.features||[]).some(feature=>feature.properties.CATEGORY==='Park');
    return {station,groceries:count('Groceries'),campuses:count('University'),parks:hasParkSource?parks.length:null,radius};
  }
  function find(origin, data) {
    const general=groups.flatMap(([key,category]) => {
      if(key==='parks')return venues(origin,data,'Park').slice(0,1);
      const candidates=(data[key]?.features||[]).map(feature=>({feature,...point(feature)}));
      for(const p of candidates)p.metres=distance(origin,p);
      candidates.sort((a,b)=>a.metres-b.metres);
      return candidates.slice(0,key==='destinations'?2:1).map(p=>({...p,category,name:title(p.feature.properties),key}));
    });
    const destinations=(data.destinations?.features||[]).map(feature=>({feature,...point(feature),key:'destinations',category:feature.properties.CATEGORY||'Other destination',name:title(feature.properties)}));
    for(const p of destinations)p.metres=distance(origin,p);
    const summarized=new Set(['Bus stop','SkyTrain station','Park','Outdoor recreation']);
    const selected=[...new Set(destinations.map(p=>p.category))].filter(category=>!summarized.has(category)).flatMap(category=>destinations.filter(p=>p.category===category).sort((a,b)=>a.metres-b.metres).slice(0,['University','Groceries'].includes(category)?2:1));
    return [...general,...selected];
  }
  function format(m){return m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m';}
  const api={point,distance,find,category,venues,viewCategories,eligiblePark,metrics,format,title};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.SurreyNearby=api;
})(typeof window==='object'?window:this);
