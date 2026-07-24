/**
 * Cheatly — Onboarding step 2: live demo + success stories
 */

const demoPlatform = document.getElementById('demo-platform');
const demoQuizTitle = document.getElementById('demo-quiz-title');
const demoStatus = document.getElementById('demo-status');
const demoCursor = document.getElementById('demo-cursor');
const demoReplay = document.getElementById('demo-replay');
const demoQuestion = document.getElementById('demo-quiz-question');
const demoOptions = document.querySelectorAll('.demo-quiz-option');
const selectedSummary = document.getElementById('selected-summary');

let demoTimers = [];
let demoRunning = false;

let platform = 'Canvas';
try {
  platform = sessionStorage.getItem('cheatly_platform') || platform;
} catch (_) {}

demoPlatform.textContent = platform;
demoQuizTitle.textContent = platform + ' \u2014 Quiz 4';
const strong = document.createElement('strong');
strong.textContent = platform;
selectedSummary.append(strong, ' \u2014 Supported with 100% accuracy');

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

demoReplay.addEventListener('click', runDemo);

if (typeof gtag === 'function') {
  gtag('event', 'demo_viewed', { platform });
}
runDemo();
