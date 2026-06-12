/**
 * Cheatly — Landing Page Interactivity
 */

// Demo cards: double-click to reveal answers
document.querySelectorAll(".demo-card").forEach((card) => {
  card.addEventListener("dblclick", () => {
    card.classList.add("revealed");
    const answer = card.querySelector(".demo-answer");
    if (answer) {
      answer.classList.remove("hidden");
    }
  });

  // Also allow single click on mobile
  card.addEventListener("click", (e) => {
    if (window.innerWidth <= 768) {
      card.classList.add("revealed");
      const answer = card.querySelector(".demo-answer");
      if (answer) {
        answer.classList.remove("hidden");
      }
    }
  });
});

// Smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute("href"));
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Fade-in animation on scroll
const observerOptions = {
  threshold: 0.1,
  rootMargin: "0px 0px -50px 0px",
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = "1";
      entry.target.style.transform = "translateY(0)";
    }
  });
}, observerOptions);

document.querySelectorAll(".feature-card, .mode-card, .step, .faq-item, .demo-card").forEach((el) => {
  el.style.opacity = "0";
  el.style.transform = "translateY(20px)";
  el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  observer.observe(el);
});
