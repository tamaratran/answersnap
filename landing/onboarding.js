/**
 * Cheatly — Onboarding step 1: platform selection
 */

const cards = document.querySelectorAll('.platform-card');
const searchInput = document.getElementById('platform-search');
const searchResult = document.getElementById('search-result');
const searchChecking = document.getElementById('search-checking');
const searchConfirmed = document.getElementById('search-confirmed');
const confirmedPlatform = document.getElementById('confirmed-platform');

let searchTimeout = null;

function selectPlatform(platform) {
  try {
    sessionStorage.setItem('cheatly_platform', platform);
  } catch (_) {}
  if (typeof gtag === 'function') {
    gtag('event', 'platform_selected', { platform });
  }
  window.location.href = 'onboarding-demo.html';
}

cards.forEach(card => {
  card.addEventListener('click', () => {
    cards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    searchInput.value = '';
    searchResult.classList.add('hidden');
    setTimeout(() => selectPlatform(card.dataset.platform), 350);
  });
});

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();

  if (searchTimeout) clearTimeout(searchTimeout);

  if (!query) {
    searchResult.classList.add('hidden');
    return;
  }

  cards.forEach(c => c.classList.remove('selected'));

  searchResult.classList.remove('hidden', 'confirmed');
  searchChecking.classList.remove('hidden');
  searchConfirmed.classList.add('hidden');

  searchTimeout = setTimeout(() => {
    searchChecking.classList.add('hidden');
    searchConfirmed.classList.remove('hidden');
    searchResult.classList.add('confirmed');
    confirmedPlatform.textContent = query;
    setTimeout(() => selectPlatform(query), 900);
  }, 800);
});
