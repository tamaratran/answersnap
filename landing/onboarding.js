/**
 * Cheatly — Onboarding Platform Selection
 */

const cards = document.querySelectorAll('.platform-card');
const searchInput = document.getElementById('platform-search');
const searchResult = document.getElementById('search-result');
const searchChecking = document.getElementById('search-checking');
const searchConfirmed = document.getElementById('search-confirmed');
const confirmedPlatform = document.getElementById('confirmed-platform');
const ctaSection = document.getElementById('onboarding-cta');
const selectedSummary = document.getElementById('selected-summary');

let selectedPlatform = null;
let searchTimeout = null;

function showCTA(platform) {
  selectedPlatform = platform;
  selectedSummary.innerHTML = `<strong>${platform}</strong> — Supported with 100% accuracy`;
  ctaSection.classList.remove('hidden');
  ctaSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Update progress indicator
  document.querySelectorAll('.progress-step')[0].classList.add('completed');
  document.querySelectorAll('.progress-step')[0].textContent = '\u2713';
  document.querySelectorAll('.progress-step')[1].classList.add('active');
}

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

    const platform = card.dataset.platform;
    showCTA(platform);
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
    showCTA(query);
  }, 800);
});
