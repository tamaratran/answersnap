/**
 * AnswerSnap Desktop — Onboarding Renderer
 *
 * Handles the Terms of Use accept/decline buttons.
 */

const acceptBtn = document.getElementById("accept");
const declineBtn = document.getElementById("decline");

acceptBtn.addEventListener("click", () => {
  window.cheatly.acceptTerms();
});

declineBtn.addEventListener("click", () => {
  window.cheatly.declineTerms();
});
