const attribute=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function renderSeoMetadata({site,canonical,title,description,breadcrumb,indexable=true}){
 const tags=`<link rel="canonical" href="${attribute(canonical)}"><meta property="og:url" content="${attribute(canonical)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${attribute(title)}"><meta name="twitter:description" content="${attribute(description)}">`;
 if(!indexable)return tags;
 const websiteId=site+'#website',pageId=canonical+'#webpage';
 const nodes=[
  {'@type':'WebSite','@id':websiteId,url:site,name:'Planner Print Prep',inLanguage:'en'},
  {'@type':'WebPage','@id':pageId,url:canonical,name:title,description,inLanguage:'en',isPartOf:{'@id':websiteId}}
 ];
 if(breadcrumb&&canonical!==site){
  const id=canonical+'#breadcrumb';nodes[1].breadcrumb={'@id':id};
  nodes.push({'@type':'BreadcrumbList','@id':id,itemListElement:[{'@type':'ListItem',position:1,name:'Print workspace',item:site},{'@type':'ListItem',position:2,name:breadcrumb,item:canonical}]});
 }
 const json=JSON.stringify({'@context':'https://schema.org','@graph':nodes}).replaceAll('<','\\u003c');
 return tags+`<script type="application/ld+json">${json}</script>`;
}
