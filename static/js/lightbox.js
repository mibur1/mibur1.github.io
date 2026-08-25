/* =============================================================
   Gallery lightbox.

   Progressive enhancement: the grid is plain <button> elements wrapping
   thumbnails, so with JS off the page is still a legible contact sheet. This
   only adds the full-size viewer on top.

   Keyboard: arrows step, Escape closes, focus returns to the thumbnail that
   opened it.
   ============================================================= */
(function () {
  var box = document.getElementById('lightbox');
  var items = Array.prototype.slice.call(document.querySelectorAll('.gallery__item'));
  if (!box || !items.length) return;

  var img = document.getElementById('lightbox-img');
  var count = document.getElementById('lightbox-count');
  var btnClose = box.querySelector('.lightbox__close');
  var btnPrev = box.querySelector('.lightbox__nav--prev');
  var btnNext = box.querySelector('.lightbox__nav--next');

  var index = 0;
  var opener = null;

  function show(i) {
    index = (i + items.length) % items.length;          // wrap both ways
    var item = items[index];
    img.src = item.getAttribute('data-full');
    img.alt = item.getAttribute('aria-label') || '';
    count.textContent = (index + 1) + ' / ' + items.length;
    preload(index + 1);
    preload(index - 1);
  }

  // Fetch the neighbours so stepping through does not flash a blank frame.
  function preload(i) {
    var item = items[(i + items.length) % items.length];
    if (!item) return;
    var pre = new Image();
    pre.src = item.getAttribute('data-full');
  }

  function open(i, from) {
    opener = from || null;
    show(i);
    box.hidden = false;
    document.documentElement.style.overflow = 'hidden';   // stop background scroll
    btnClose.focus();
  }

  function close() {
    box.hidden = true;
    img.removeAttribute('src');
    document.documentElement.style.overflow = '';
    if (opener) opener.focus();
  }

  items.forEach(function (item, i) {
    item.addEventListener('click', function () { open(i, item); });
  });

  btnClose.addEventListener('click', close);
  btnPrev.addEventListener('click', function () { show(index - 1); });
  btnNext.addEventListener('click', function () { show(index + 1); });

  // Click the backdrop (but not the image or the controls) to dismiss.
  box.addEventListener('click', function (e) {
    if (e.target === box || e.target.classList.contains('lightbox__stage')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowRight') { show(index + 1); }
    else if (e.key === 'ArrowLeft') { show(index - 1); }
    else if (e.key === 'Tab') {
      // keep focus inside the overlay while it is open
      var focusable = [btnClose, btnPrev, btnNext];
      var i = focusable.indexOf(document.activeElement);
      e.preventDefault();
      focusable[(i + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length].focus();
    }
  });

  // Swipe on touch devices.
  var x0 = null;
  box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });
})();
