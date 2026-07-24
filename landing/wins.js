(function () {
  const track = document.getElementById('carousel-track');
  const slides = track.querySelectorAll('.win-slide');
  const dotsWrap = document.getElementById('carousel-dots');
  const prevBtn = document.getElementById('carousel-prev');
  const nextBtn = document.getElementById('carousel-next');
  const carousel = document.getElementById('wins-carousel');
  const viewport = carousel.querySelector('.carousel-viewport');

  let index = 0;
  let autoTimer = null;
  let hovering = false;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
    dot.addEventListener('click', () => {
      goTo(i);
      restartAuto();
    });
    dotsWrap.appendChild(dot);
  });

  const dots = dotsWrap.querySelectorAll('.carousel-dot');

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.style.transform = 'translateX(-' + index * viewport.clientWidth + 'px)';
    dots.forEach((d, di) => d.classList.toggle('active', di === index));
  }

  function restartAuto() {
    if (autoTimer) clearInterval(autoTimer);
    if (hovering) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    autoTimer = setInterval(() => goTo(index + 1), 5000);
  }

  prevBtn.addEventListener('click', () => {
    goTo(index - 1);
    restartAuto();
  });

  nextBtn.addEventListener('click', () => {
    goTo(index + 1);
    restartAuto();
  });

  carousel.addEventListener('mouseenter', () => {
    hovering = true;
    if (autoTimer) clearInterval(autoTimer);
  });

  carousel.addEventListener('mouseleave', () => {
    hovering = false;
    restartAuto();
  });

  let touchStartX = null;

  carousel.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) goTo(index + (dx < 0 ? 1 : -1));
    touchStartX = null;
    restartAuto();
  }, { passive: true });

  window.addEventListener('resize', () => goTo(index));

  restartAuto();
})();
