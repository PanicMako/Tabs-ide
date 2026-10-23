// Browser storage is scoped by Tabs' extension identity and assigned profile.
// A new installation starts empty; existing data is never replaced by example notes.
try {
  if (!localStorage.getItem('relay-studio-v3')) localStorage.setItem('relay-studio-v3', JSON.stringify({
    version:3,projects:['My project'],projectDetails:{'My project':{description:'A place to pick up where you left off.',color:'#3259ed'}},folders:[],cards:[],
  }));
} catch { /* The normal save status explains when durable storage is unavailable. */ }

// Tabs forbids inline styles. Convert app-generated style attributes into rules
// on a packaged stylesheet before inserting markup, preserving the host CSP.
const relayRules = new Map();
const relaySheet = document.querySelector('#relay-runtime-styles').sheet;
const relayDecode = document.createElement('textarea');
function relayMarkup(markup) {
  return markup.replace(/\sstyle="([^"]*)"/g, (_, encoded) => {
    relayDecode.innerHTML = encoded;
    const declaration = relayDecode.value;
    let name = relayRules.get(declaration);
    if (!name) {
      name = 'relay-style-'+relayRules.size;
      relaySheet.insertRule('[data-relay-style="'+name+'"]{'+declaration+'}', relaySheet.cssRules.length);
      relayRules.set(declaration, name);
    }
    return ' data-relay-style="'+name+'"';
  });
}
