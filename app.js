document.addEventListener('error',e=>{if(e.target.tagName==='IMG'&&e.target.dataset.i)e.target.style.display='none'},true);
const b=document.getElementById('burger'),l=document.getElementById('links');
b.onclick=()=>{b.classList.toggle('open');l.classList.toggle('open')};
l.querySelectorAll('a').forEach(a=>a.onclick=()=>{b.classList.remove('open');l.classList.remove('open')});
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.08});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));
const f=document.getElementById('enquiryForm');
if(f){const URL='https://script.google.com/macros/s/AKfycbxgJP4GnT2-azA5AIu8WZsasBBF7FmlqeANmnLUOIPYuMLVzFsQ3u0tDZifi0uNyPFR/exec',st=document.getElementById('st'),btn=f.querySelector('button');
f.onsubmit=async e=>{e.preventDefault();const v=id=>f.querySelector('#'+id).value.trim();
const d={Name:v('fname'),Business:v('fbusiness'),Phone:v('fphone'),City:v('fcity')||'Not specified',Type:v('ftype'),Message:v('fmessage')||'(No message)'};
btn.disabled=true;btn.textContent='Sending…';st.style.display='block';st.textContent='Submitting your enquiry…';
try{const r=await fetch(URL,{method:'POST',body:JSON.stringify(d)});const j=await r.json();if(j.result!=='success')throw 0;
st.style.color='#1a8f4c';st.textContent='✓ Sent. We will respond within one business day.';f.reset();btn.textContent='Enquiry sent ✓';
}catch(_){st.style.color='#b33';st.textContent='Something went wrong. Please try again or message us on WhatsApp.';btn.textContent='Try again'}
setTimeout(()=>{btn.disabled=false;btn.textContent='Submit enquiry →'},4000)}}
