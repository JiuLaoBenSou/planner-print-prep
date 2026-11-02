import './design-variants.css';
import './design-pop.css';
import './design-github.css';

type Direction='teaching'|'study'|'home'|'pop'|'github';
const directions:Record<Direction,{name:string;eyebrow:string;title:string;intro:string;edition:string;sheetTitle:string;sheetLines:string[];fileTitle:string;previewTitle:string;closingTitle:string}>={
  pop:{name:'D · Paper pop',eyebrow:'YOUR PDF. A FRESH START.',title:'BIG PLANS.<br> RIGHT FIT.',intro:'Less printer wrestling. More making things happen. Fit your existing planner PDF, check both sides, and give one sheet a test run.',edition:'PAPER POP / D<br>LOCAL PDF → REAL PAPER',sheetTitle:'MAKE ROOM.',sheetLines:['01 / Big ideas','02 / Small steps','03 / A little room to grow'],fileTitle:'Drop into your next plan.',previewTitle:'LOOK BOTH<br> WAYS.',closingTitle:'TEST ONE.<br> THEN GO.'},
  teaching:{name:'A · Teaching desk',eyebrow:'MORE CLARITY. BEFORE THE FIRST CLASS.',title:'Print-ready.<br> Class-ready.',intro:'Bring your lesson planner PDF. Choose the paper, check both sides, and start with one test sheet.',edition:'TEACHING DESK<br>01 / A CLEARER WORKFLOW',sheetTitle:'This week’s lessons',sheetLines:['MON  /  Weekly focus','TUE   /  Lesson notes','WED /  Things to prepare'],fileTitle:'Start with your planner.',previewTitle:'Check the paper.<br> Then the details.',closingTitle:'One test sheet.<br> A clearer start.'},
  study:{name:'B · Study notebook',eyebrow:'A SMALL RESET FOR YOUR STUDY DESK.',title:'Your plans.<br> Your paper.',intro:'Your timetable, deadlines and study plans, fitted to the paper you use. Start with a PDF you already have.',edition:'STUDY NOTEBOOK<br>MAKE ROOM FOR THE WEEK',sheetTitle:'A week with a little room',sheetLines:['01  /  Make a small plan','02  /  Leave some breathing room','03  /  Begin wherever you are'],fileTitle:'Bring your favourite PDF.',previewTitle:'A first look at<br> your next good plan.',closingTitle:'A little less setup.<br> A little more doing.'},
  home:{name:'C · Everyday paper',eyebrow:'A LITTLE PREPARATION. A LIGHTER WEEK.',title:'A little space<br> for everyday life.',intro:'Turn your existing planner PDF into pages for the week ahead. We’ll help you get the size and sides right, one step at a time.',edition:'EVERYDAY PAPER<br>MADE FOR YOUR OWN RHYTHM',sheetTitle:'Room for the everyday',sheetLines:['The week ahead','Little things to remember','A moment for yourself'],fileTitle:'Let’s begin with your PDF.',previewTitle:'Make a little room<br> for what matters.',closingTitle:'Take it one<br> sheet at a time.'},
  github:{name:'E · GitHub style',eyebrow:'Planner Print Prep',title:'Resize planner PDFs for printing.',intro:'Use the planner PDF you already have. Choose A5, A6, Half Letter or a custom insert size, check both sides, then print on A4 or Letter paper.',edition:'FILES STAY ON YOUR DEVICE<br>FREE CORE · OPTIONAL PLUS',sheetTitle:'',sheetLines:[],fileTitle:'Source document',previewTitle:'Output preview',closingTitle:'Before you print'},
};
const nodes={eyebrow:document.querySelector<HTMLElement>('.hero-copy .eyebrow')!,title:document.querySelector<HTMLElement>('h1')!,intro:document.querySelector<HTMLElement>('.intro')!,edition:document.querySelector<HTMLElement>('.edition')!,note:document.querySelector<HTMLElement>('.hero-note')!,fileTitle:document.querySelector<HTMLElement>('.file-section h2')!,previewTitle:document.querySelector<HTMLElement>('.preview-title h2')!,closingTitle:document.querySelector<HTMLElement>('.closing h2')!};
const original=Object.fromEntries(Object.entries(nodes).map(([k,v])=>[k,v.innerHTML]));
const initial=new URL(location.href).searchParams.get('ui');
const isPreview=initial==='original'||!!initial&&Object.hasOwn(directions,initial);
const nav=document.querySelector('.site-header nav');
if(nav&&isPreview){const compare=document.createElement('a');compare.href=import.meta.env.BASE_URL+'designs/';compare.textContent='Compare designs';nav.append(compare);}
let switcher:HTMLElement|null=null;
function apply(direction:Direction|'original') {
  if(direction==='original'){
    delete document.body.dataset.ui;
    for(const [key,node] of Object.entries(nodes))node.innerHTML=original[key];
  }else{
    const d=directions[direction];document.body.dataset.ui=direction;
    for(const key of ['eyebrow','title','intro','edition','fileTitle','previewTitle','closingTitle'] as const)nodes[key].innerHTML=d[key];
    nodes.note.innerHTML=`<div class="theme-sheet"><span class="sheet-label">LAYOUT ILLUSTRATION / A5</span><h3>${d.sheetTitle}</h3><div class="sheet-tabs"><span>MON</span><span>TUE</span><span>WED</span><span>THU</span><span>FRI</span></div>${d.sheetLines.map(line=>`<p>${line}</p>`).join('')}<span class="sheet-foot">YOUR EXISTING PDF · YOUR OWN ROUTINE</span></div><span class="theme-note">One insert per side. A4 or Letter paper.</span>`;
    if(direction==='pop')nodes.note.insertAdjacentHTML('afterbegin','<span class="pop-sticker" aria-hidden="true">PDF<br>↓<br>PAPER</span><svg class="pop-spark" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 59 30 85 15 70 41 100 50 70 59 85 85 59 70 50 100 41 70 15 85 30 59 0 50 30 41 15 15 41 30Z"/></svg>');
  }
  const url=new URL(location.href);url.searchParams.set('ui',direction);
  history.replaceState(null,'',url);
  switcher?.querySelectorAll<HTMLButtonElement>('[data-design-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.designChoice===direction)));
}
if(isPreview){
  const robots=document.createElement('meta');robots.name='robots';robots.content='noindex,follow';document.head.append(robots);
  switcher=document.createElement('aside');switcher.className='design-switcher';switcher.setAttribute('aria-label','Local design comparison');
  const note=document.createElement('span');note.textContent='LOCAL DESIGN PREVIEW';switcher.append(note);
  const choices=document.createElement('div');choices.className='design-choices';
  for(const [id,name] of [...Object.entries(directions).map(([id,d])=>[id,d.name]),['original','Original']]){
    const button=document.createElement('button');button.type='button';button.dataset.designChoice=id;button.textContent=name;
    button.addEventListener('click',()=>apply(id as Direction|'original'));choices.append(button);
  }
  switcher.append(choices);const gallery=document.createElement('a');gallery.href=import.meta.env.BASE_URL+'designs/';gallery.textContent='All directions ↗';switcher.append(gallery);
  document.body.prepend(switcher);apply(initial as Direction|'original');
}
