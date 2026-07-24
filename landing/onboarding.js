/**
 * Cheatly — Onboarding: platform selection, live demo, success stories
 */

const cards = document.querySelectorAll('.platform-card');
const searchInput = document.getElementById('platform-search');
const searchResult = document.getElementById('search-result');
const searchChecking = document.getElementById('search-checking');
const searchConfirmed = document.getElementById('search-confirmed');
const confirmedPlatform = document.getElementById('confirmed-platform');
const ctaSection = document.getElementById('onboarding-cta');
const selectedSummary = document.getElementById('selected-summary');
const demoSection = document.getElementById('onboarding-demo');
const demoPlatform = document.getElementById('demo-platform');
const demoQuizTitle = document.getElementById('demo-quiz-title');
const demoStatus = document.getElementById('demo-status');
const demoCursor = document.getElementById('demo-cursor');
const demoReplay = document.getElementById('demo-replay');
const demoQuestion = document.getElementById('demo-quiz-question');
const demoOptions = document.querySelectorAll('.demo-quiz-option');
const storiesSection = document.getElementById('success-stories');
const storiesGrid = document.getElementById('stories-grid');
const steps = [
  document.getElementById('step-1'),
  document.getElementById('step-2'),
  document.getElementById('step-3'),
];

let searchTimeout = null;
let demoTimers = [];
let demoRunning = false;

function setStep(index) {
  steps.forEach((step, i) => {
    step.classList.remove('active', 'completed');
    if (i < index) {
      step.classList.add('completed');
      step.textContent = '\u2713';
    } else {
      step.textContent = String(i + 1);
      if (i === index) step.classList.add('active');
    }
  });
}

function clearDemoTimers() {
  demoTimers.forEach(clearTimeout);
  demoTimers = [];
}

function resetDemoState() {
  clearDemoTimers();
  demoOptions.forEach((opt) => opt.classList.remove('picked'));
  demoQuestion.classList.remove('highlighted');
  demoStatus.className = 'demo-status';
  demoStatus.textContent = '';
  demoCursor.classList.remove('visible', 'at-question', 'at-answer', 'clicking');
  demoReplay.classList.add('hidden');
}

function runDemo() {
  if (demoRunning) return;
  demoRunning = true;
  resetDemoState();

  const at = (ms, fn) => demoTimers.push(setTimeout(fn, ms));

  at(400, () => demoCursor.classList.add('visible'));
  at(900, () => demoCursor.classList.add('at-question'));
  at(1800, () => {
    demoCursor.classList.add('clicking');
    demoQuestion.classList.add('highlighted');
  });
  at(2100, () => demoCursor.classList.remove('clicking'));
  at(2300, () => {
    demoStatus.className = 'demo-status thinking';
    demoStatus.innerHTML = '<span class="demo-spinner"></span> Cheatly is reading the question...';
  });
  at(4300, () => {
    demoStatus.className = 'demo-status';
    demoStatus.textContent = '';
    demoCursor.classList.remove('at-question');
    demoCursor.classList.add('at-answer');
  });
  at(5200, () => demoCursor.classList.add('clicking'));
  at(5500, () => {
    demoCursor.classList.remove('clicking');
    document.querySelector('.demo-quiz-option[data-correct]').classList.add('picked');
  });
  at(6000, () => {
    demoCursor.classList.remove('visible');
    demoStatus.className = 'demo-status done';
    demoStatus.innerHTML = '&#10003; Answered correctly in 2.3s';
  });
  at(6800, () => {
    demoReplay.classList.remove('hidden');
    demoRunning = false;
  });
}

function showDemo(platform) {
  demoPlatform.textContent = platform;
  demoQuizTitle.textContent = platform + ' \u2014 Quiz 4';
  selectedSummary.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = platform;
  selectedSummary.append(strong, ' \u2014 Supported with 100% accuracy');

  // Show platform-matching story first
  const match = storiesGrid.querySelector(`.story-card[data-platform="${CSS.escape(platform)}"]`);
  if (match) storiesGrid.prepend(match);

  demoSection.classList.remove('hidden');
  storiesSection.classList.remove('hidden');
  const winsSection = document.getElementById('onboarding-wins');
  if (winsSection) winsSection.classList.remove('hidden');
  ctaSection.classList.remove('hidden');
  setStep(1);
  demoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof gtag === 'function') {
    gtag('event', 'demo_viewed', { platform });
  }
  runDemo();
}

demoReplay.addEventListener('click', runDemo);

document.querySelector('a.onboarding-btn').addEventListener('click', () => {
  setStep(2);
});

// Platform card click
cards.forEach(card => {
  card.addEventListener('click', () => {
    // Deselect all
    cards.forEach(c => c.classList.remove('selected'));
    // Select this one
    card.classList.add('selected');

    // Clear search
    searchInput.value = '';
    searchResult.classList.add('hidden');

    showDemo(card.dataset.platform);
  });
});

// Search input
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();

  if (searchTimeout) clearTimeout(searchTimeout);

  if (!query) {
    searchResult.classList.add('hidden');
    return;
  }

  // Deselect cards when typing
  cards.forEach(c => c.classList.remove('selected'));

  // Show checking state
  searchResult.classList.remove('hidden', 'confirmed');
  searchChecking.classList.remove('hidden');
  searchConfirmed.classList.add('hidden');

  // Simulate checking delay (800ms)
  searchTimeout = setTimeout(() => {
    searchChecking.classList.add('hidden');
    searchConfirmed.classList.remove('hidden');
    searchResult.classList.add('confirmed');
    confirmedPlatform.textContent = query;
    showDemo(query);
  }, 800);
});
