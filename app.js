/* S45 Jeans Co. site scripts */
(function () {
'use strict';

// Mobile menu
var burger = document.getElementById('burger');
var links = document.getElementById('links');

burger.addEventListener('click', function () {
  burger.classList.toggle('open');
  links.classList.toggle('open');
});

links.querySelectorAll('a').forEach(function (a) {
  a.addEventListener('click', function () {
    burger.classList.remove('open');
    links.classList.remove('open');
  });
});

// Fade-in on scroll
var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.08 });

document.querySelectorAll('.rv').forEach(function (el) {
  observer.observe(el);
});

// Enquiry form (contact page only)
var form = document.getElementById('enquiryForm');

if (form) {
  var SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxgJP4GnT2-azA5AIu8WZsasBBF7FmlqeANmnLUOIPYuMLVzFsQ3u0tDZifi0uNyPFR/exec';
  var statusBox = document.getElementById('st');
  var button = form.querySelector('button');

  var val = function (id) {
    return form.querySelector('#' + id).value.trim();
  };

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    var data = {
      Name: val('fname'),
      Business: val('fbusiness'),
      Phone: val('fphone'),
      City: val('fcity') || 'Not specified',
      Type: val('ftype'),
      Message: val('fmessage') || '(No message)'
    };

    button.disabled = true;
    button.textContent = 'Sending…';
    statusBox.style.display = 'block';
    statusBox.textContent = 'Submitting your enquiry…';

    try {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 25000);
      var res = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(data), signal: controller.signal });
      clearTimeout(timer);
      var json = await res.json();
      if (json.result !== 'success') throw new Error('Script error');

      statusBox.style.color = '#1a8f4c';
      statusBox.textContent = '✓ Sent. We will respond within one business day.';
      button.textContent = 'Enquiry sent ✓';
      form.reset();
    } catch (err) {
      statusBox.style.color = '#b33';
      statusBox.textContent = 'Something went wrong. Please try again or message us on WhatsApp.';
      button.textContent = 'Try again';
    }

    setTimeout(function () {
      button.disabled = false;
      button.textContent = 'Submit enquiry →';
    }, 4000);
  });
}
})();
