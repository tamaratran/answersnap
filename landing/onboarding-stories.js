/**
 * Cheatly — Onboarding step 3: success stories
 */

const storiesGrid = document.getElementById('stories-grid');

let platform = 'Canvas';
try {
  platform = sessionStorage.getItem('cheatly_platform') || platform;
} catch (_) {}

const match = storiesGrid.querySelector(`.story-card[data-platform="${CSS.escape(platform)}"]`);
if (match) storiesGrid.prepend(match);
