'use strict';
(function(root){
  const aliases={
    Groceries:'grocery supermarket food market',
    Pharmacy:'drugstore chemist prescriptions',
    Childcare:'daycare day care child care preschool nursery',
    University:'college campus higher education',
    'Elementary school':'primary school',
    'Secondary school':'high school',
    'Civic destination':'city hall municipal hall',
    Gym:'fitness workout',
    'Swimming pool':'swim aquatic centre',
    'Ice arena':'ice rink skating hockey',
    'Athletics track':'running track',
    'SkyTrain station':'rapid transit metro train',
    'Passenger rail':'train railway',
    'Bike parking':'bicycle cycling',
    'Carpool location':'rideshare ride share',
    'Park & ride':'park and ride transit parking',
    'Car rental':'rental car hire',
    'Recycling & disposal':'recycle waste garbage depot landfill',
    'Fast food':'quick service restaurant takeout takeaway mcdonalds mcdonald a&w aw burger pizza subway',
    'Restaurant':'restaurants dining dinner lunch boston pizza white spot cactus club earls joey browns',
    'Coffee shop':'coffee cafe cafes espresso tim hortons tims starbucks second cup blenz waves',
    'Post office':'post postal canada post mail parcel stamps',
    'Office supplies':'office stationery printing printer staples',
    'Discount store':'discount dollar store dollarama dollar tree',
    'Clothing store':'clothing clothes apparel fashion h&m hm uniqlo old navy gap zara winners marshalls marks',
    'Department store':'department general retail simons walmart costco',
    'Hardware store':'hardware home improvement canadian tire home depot rona tools',
    'Furniture store':'furniture ikea jysk brick leons structube',
    'Neighbourhood':'neighborhood community'
  };
  const words={groceries:'grocery',daycares:'daycare',schools:'school',universities:'university',colleges:'college',parks:'park',pharmacies:'pharmacy',hospitals:'hospital',libraries:'library',museums:'museum',galleries:'gallery',courts:'court',fields:'field',pools:'pool',rinks:'rink',arenas:'arena',stations:'station',trains:'train',gyms:'gym',hotels:'hotel',stores:'store',centers:'centre',centres:'centre',center:'centre',neighborhoods:'neighbourhood',neighbourhoods:'neighbourhood',neighborhood:'neighbourhood',sports:'sport'};
  function normalize(value){
    return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/\b(?:day|child)\s+care\b/g,'childcare').replace(/\bdaycares?\b/g,'childcare')
      .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).map(word=>words[word]||word).join(' ');
  }
  function filterGroups(groups,query){
    const terms=normalize(query).split(' ').filter(Boolean);
    if(!terms.length)return groups.map(group=>({...group,options:group.options.slice()}));
    const matches=value=>{const tokens=normalize(value).split(' ');return terms.every(term=>tokens.some(token=>token.startsWith(term)));};
    const direct=groups.map(group=>({...group,options:group.options.filter(option=>matches([option.label,option.value,aliases[option.value]||''].join(' ')))})).filter(group=>group.options.length);
    // A category match takes precedence, so “daycare” does not return every school.
    return direct.length?direct:groups.filter(group=>matches(group.label)).map(group=>({...group,options:group.options.slice()}));
  }
  function mount(select){
    if(!select||!select.options.length||select.dataset.searchable)return null;
    select.dataset.searchable='true';
    const doc=select.ownerDocument;
    const groups=Array.from(select.children).map(group=>({label:group.label,options:Array.from(group.children).filter(option=>!option.disabled).map(option=>({value:option.value,label:option.textContent}))})).filter(group=>group.options.length);
    const create=(tag,className)=>{const node=doc.createElement(tag);if(className)node.className=className;return node;};
    const menu=create('div','category-menu'),field=create('div','category-field'),input=create('input'),chevron=create('span','category-chevron');
    const popover=create('div','category-popover'),list=create('div','category-options'),empty=create('p','category-empty'),hint=create('span','sr-only');
    input.id=select.id+'-search';input.type='text';input.placeholder='Search categories';input.autocomplete='off';input.spellcheck=false;
    input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls',select.id+'-options');input.setAttribute('aria-describedby',select.id+'-hint');
    chevron.setAttribute('aria-hidden','true');
    list.id=select.id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','Nearby categories');
    empty.textContent='No categories found.';empty.setAttribute('role','status');empty.hidden=true;
    hint.id=select.id+'-hint';hint.textContent='Type to find a category. Use the arrow keys, then Enter to select. Escape closes the menu.';
    field.append(input,chevron);popover.append(list,empty);menu.append(field,popover,hint);popover.hidden=true;
    select.before(menu);select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const label=doc.querySelector('label[for="'+select.id+'"]');if(label)label.htmlFor=input.id;
    let expanded=false,active=-1,rows=[],ignoreFocus=false;
    const selectedLabel=()=>select.selectedOptions[0]?.textContent||'';
    function fitPopover(){
      const win=doc.defaultView,viewport=win.visualViewport;
      let top=viewport?.offsetTop||0,bottom=top+(viewport?.height||win.innerHeight);
      for(let parent=menu.parentElement;parent;parent=parent.parentElement){
        if(/auto|scroll|hidden|clip/.test(win.getComputedStyle(parent).overflowY)){
          const bounds=parent.getBoundingClientRect();top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);
        }
      }
      const bounds=field.getBoundingClientRect(),below=Math.max(0,bottom-bounds.bottom-13),above=Math.max(0,bounds.top-top-13);
      const needed=Math.min(240,list.hidden?empty.offsetHeight:list.scrollHeight),up=below<needed&&above>below;
      menu.classList.toggle('opens-up',up);
      menu.style.setProperty('--category-available-height',Math.floor(up?above:below)+'px');
    }
    function setActive(index,scroll=true){
      active=index;
      rows.forEach((row,i)=>row.node.classList.toggle('is-active',i===active));
      const row=rows[active]?.node;
      if(!row){input.removeAttribute('aria-activedescendant');return;}
      input.setAttribute('aria-activedescendant',row.id);
      // Scroll only the menu, leaving the project and map in place.
      if(scroll){const top=row.offsetTop,bottom=top+row.offsetHeight;if(top<list.scrollTop)list.scrollTop=top;else if(bottom>list.scrollTop+list.clientHeight)list.scrollTop=bottom-list.clientHeight;}
    }
    function render(query,preferredValue){
      list.replaceChildren();rows=[];list.scrollTop=0;
      filterGroups(groups,query).forEach((group,groupIndex)=>{
        const section=create('div','category-group'),heading=create('div','category-group-heading');
        heading.id=select.id+'-group-'+groupIndex;heading.textContent=group.label;section.setAttribute('role','group');section.setAttribute('aria-labelledby',heading.id);section.append(heading);
        group.options.forEach(option=>{
          const node=create('button','category-option');node.type='button';node.tabIndex=-1;node.id=select.id+'-option-'+rows.length;node.textContent=option.label;node.setAttribute('role','option');node.setAttribute('aria-selected',String(option.value===select.value));
          const index=rows.length;rows.push({node,value:option.value});
          node.addEventListener('mousedown',event=>event.preventDefault());
          node.addEventListener('pointermove',event=>{if(event.pointerType!=='touch')setActive(index,false);});
          node.addEventListener('click',()=>choose(index));section.append(node);
        });
        list.append(section);
      });
      empty.hidden=rows.length>0;list.hidden=!rows.length;
      fitPopover();
      const preferred=rows.findIndex(row=>row.value===preferredValue);setActive(preferred>=0?preferred:rows.length?0:-1);
    }
    function open(){
      if(expanded)return;
      expanded=true;popover.hidden=false;menu.classList.add('is-open');input.setAttribute('aria-expanded','true');input.value='';render('',select.value);
    }
    function close(){
      expanded=false;popover.hidden=true;menu.classList.remove('is-open');input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');input.value=selectedLabel();
    }
    function choose(index){
      if(!rows[index])return;
      select.value=rows[index].value;close();ignoreFocus=true;input.focus({preventScroll:true});ignoreFocus=false;
      select.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
    }
    input.value=selectedLabel();
    input.addEventListener('focus',()=>{if(!ignoreFocus)open();});
    input.addEventListener('click',open);
    input.addEventListener('beforeinput',()=>{if(!expanded)open();});
    input.addEventListener('input',()=>{const query=input.value;open();input.value=query;render(query);});
    input.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();if(!expanded){open();return;}
        if(rows.length)setActive((active+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length);
      }else if(event.key==='Enter'){
        event.preventDefault();if(expanded)choose(active);else open();
      }else if(event.key==='Escape'&&expanded){event.preventDefault();event.stopPropagation();close();}
      else if(event.key==='Tab')close();
      else if(!expanded&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)open();
    });
    menu.addEventListener('focusout',event=>{if(!menu.contains(event.relatedTarget))close();});
    doc.addEventListener('pointerdown',event=>{if(expanded&&!menu.contains(event.target))close();});
    const reposition=()=>{if(expanded){fitPopover();setActive(active);}};
    doc.defaultView.addEventListener('resize',reposition);
    doc.defaultView.visualViewport?.addEventListener('resize',reposition);
    doc.defaultView.visualViewport?.addEventListener('scroll',reposition);
    doc.addEventListener('scroll',event=>{if(event.target.contains?.(menu))reposition();},true);
    select.addEventListener('change',close);
    select.closest('details')?.addEventListener('toggle',event=>{if(!event.target.open)close();});
    return {close,input};
  }
  const api={normalize,filterGroups,mount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.SurreyCategoryMenu=api;
})(typeof window!=='undefined'?window:globalThis);
